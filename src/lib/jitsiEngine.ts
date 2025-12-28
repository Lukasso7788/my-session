// ============================================================================
// src/lib/jitsiEngine.ts — SFU-only (P2P OFF) + track-based + reactions + SAFE background effects
// Ultra-stable subscriptions: no-op caching + delayed hard reset + cooldown
// ✅ Added: targeted “black video” recovery (reattach per participant + optional subs bump)
// ✅ Fixed: do NOT treat local camera/audio track add/remove as topology change (prevents global resub churn on toggleVideo)
//
// ✅ IMPORTANT (Effects compatibility guard):
// Some lib-jitsi-meet builds expect EFFECT OBJECT to be sync and effect.startEffect() to be sync,
// but JitsiMeetJS.effects.createVirtualBackgroundEffect(...) may return Promise in other builds.
// If we detect "factory returned Promise" => mark effects as INCOMPATIBLE and STOP applying effects
// (to prevent camera from getting stuck on toggle / track replacement).
//
// ✅ PATCHES:
// - Per-track serialized setEffect queue preserved (no races).
// - setEffect calls are timed out (prevents deadlocks).
// - If effects are incompatible => we keep video working and simply skip applying background.
// ============================================================================

declare global {
  interface Window {
    JitsiMeetJS?: any;
    config?: any;
  }
}

export type JitsiTrack = any;

export type JitsiParticipant = {
  id: string;
  displayName: string;
  isLocal: boolean;
  audioMuted: boolean;
  videoMuted: boolean;
  isScreenSharing: boolean;
  audioTrack?: JitsiTrack;
  videoTrack?: JitsiTrack;
  screenTrack?: JitsiTrack;
};

export type JitsiEngineCallbacks = {
  onParticipantsUpdate?: (participants: JitsiParticipant[]) => void;
  onConferenceJoin?: () => void;
  onReactionReceived?: (fromId: string, reaction: string) => void;
  onError?: (message: string) => void;
};

export type BgMode = "none" | "blur" | "image";

const JITSI_DOMAIN = "jitsi.lukassodesign.site";

// грузим assets с ТВОЕГО домена приложения
const JITSI_CONFIG_URL = "/config.js";
const JITSI_LIB_URL = "/libs/lib-jitsi-meet.min.js";

const DISABLE_P2P = true;

let jitsiLoaderPromise: Promise<void> | null = null;

// ============================================================================
// SCRIPT LOADER
// ============================================================================
async function loadJitsiScripts(): Promise<void> {
  if (typeof window === "undefined") throw new Error("Jitsi can only be loaded in browser");

  if (window.JitsiMeetJS && window.config) return;
  if (jitsiLoaderPromise) return jitsiLoaderPromise;

  jitsiLoaderPromise = new Promise<void>((resolve, reject) => {
    let loaded = 0;

    const done = () => {
      loaded += 1;
      if (loaded === 2) {
        if (window.JitsiMeetJS && window.config) resolve();
        else reject(new Error("Jitsi scripts loaded but globals are missing"));
      }
    };

    const onError = (src: string) => reject(new Error("Failed to load Jitsi script: " + src));

    if (!document.querySelector(`script[src="${JITSI_CONFIG_URL}"]`)) {
      const scConfig = document.createElement("script");
      scConfig.src = JITSI_CONFIG_URL;
      scConfig.async = true;
      scConfig.onload = done;
      scConfig.onerror = () => onError(JITSI_CONFIG_URL);
      document.head.appendChild(scConfig);
    } else done();

    if (!document.querySelector(`script[src="${JITSI_LIB_URL}"]`)) {
      const scLib = document.createElement("script");
      scLib.src = JITSI_LIB_URL;
      scLib.async = true;
      scLib.onload = done;
      scLib.onerror = () => onError(JITSI_LIB_URL);
      document.head.appendChild(scLib);
    } else done();
  });

  return jitsiLoaderPromise;
}

// ============================================================================
// JITSI ENGINE
// ============================================================================
export class JitsiEngine {
  public mediaSettings = {
    videoInputId: "",
    audioInputId: "",
    audioOutputId: "default",
    bgMode: "none" as BgMode,
    bgImageUrl: undefined as string | undefined,
  };

  private callbacks: JitsiEngineCallbacks;
  private JitsiMeetJS: any | null = null;
  private config: any | null = null;

  private connection: any | null = null;
  private conference: any | null = null;

  private participants: Record<string, JitsiParticipant> = {};
  private localUserId: string | null = null;

  private tracksByParticipant = new Map<string, { audio?: JitsiTrack; video?: JitsiTrack; screen?: JitsiTrack }>();

  private localAudioTrack: JitsiTrack | null = null;
  private localVideoTrack: JitsiTrack | null = null;
  private localScreenshareTrack: JitsiTrack | null = null;

  private disposed = false;

  // VIDEO SUBS
  private selectedVideoIds: string[] = [];
  private qualityMode: "auto" | "low" | "medium" | "high" = "auto";
  private readonly MAX_LAST_N = 36;

  private subsApplyTimer: any = null;
  private subsHardResetTimer: any = null;
  private subsHardResetInFlight = false;

  // ✅ stable: no-op caching
  private lastSubsKey = "";
  private lastSubsAppliedAt = 0;

  // ✅ stable: delayed recovery reset + cooldown
  private hardResetCooldownUntil = 0;

  // ✅ stable: soft watchdog (not every 3s)
  private subsWatchdog: any = null;

  // REAL BG EFFECT (Native Jitsi effect object)
  private videoEffect: any | undefined = undefined;
  private bgPrefs: { mode: BgMode; imageUrl?: string } = { mode: "none" };
  private bgApplying = false;

  private effectsSupported = false;

  // ✅ effects compatibility guard (your logs show: factory returns Promise but setEffect expects sync)
  private effectsCompat: "unknown" | "compatible" | "incompatible" = "unknown";
  private effectsCompatReason = "";
  private effectsCompatLogged = false;

  // ========================================================================
  // ✅ EFFECT OPS SERIALIZER + DEBUG (per-track)
  // ========================================================================
  private effectOpSeq = 0;
  private effectQueueByTrack = new WeakMap<any, Promise<void>>();

  // Some lib builds don’t tolerate null/undefined in setEffect — they expect an object with isEnabled().
  // Use a passthrough effect that returns the original stream synchronously.
  private readonly PASSTHROUGH_EFFECT = {
    startEffect: (stream: MediaStream) => stream, // MUST be sync in sync builds
    stopEffect: () => { },
    dispose: () => { },
    isEnabled: () => true,
    isSupported: () => true,
  };

  constructor(callbacks: JitsiEngineCallbacks = {}) {
    this.callbacks = callbacks;
  }

  // ========================================================================
  // UTILS
  // ========================================================================
  private isAsyncFunction(fn: any) {
    try {
      return typeof fn === "function" && fn.constructor && fn.constructor.name === "AsyncFunction";
    } catch {
      return false;
    }
  }

  private async withTimeout<T>(p: Promise<T> | T, ms: number, label: string): Promise<T> {
    const pr = Promise.resolve(p);
    let t: any = null;
    const timeout = new Promise<T>((_, rej) => {
      t = setTimeout(() => rej(new Error(`[bg] ${label} timeout ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([pr, timeout]);
    } finally {
      if (t) clearTimeout(t);
    }
  }

  private getTrackDbg(track: any) {
    try {
      const msAny = track?.getOriginalStream?.();
      const isPromise = !!msAny && typeof msAny.then === "function";
      return {
        type: track?.getType?.(),
        videoType: track?.getVideoType?.(),
        local: !!track?.isLocal?.(),
        muted: !!track?.isMuted?.(),
        trackId: track?.getTrackId?.() || track?.getId?.() || undefined,
        hasSetEffect: typeof track?.setEffect === "function",
        origStreamPromise: isPromise,
      };
    } catch {
      return { hasSetEffect: typeof track?.setEffect === "function" };
    }
  }

  private logEffect(opId: number, phase: string, extra?: any) {
    try {
      console.debug(`[bg][op#${opId}] ${phase}`, extra ?? "");
    } catch { }
  }

  private async runEffectOpOnTrack(track: any, label: string, fn: () => Promise<void>) {
    if (!track) return;

    const prev = this.effectQueueByTrack.get(track) || Promise.resolve();
    const opId = ++this.effectOpSeq;

    const next = prev
      .catch(() => { })
      .then(async () => {
        this.logEffect(opId, `BEGIN ${label}`, this.getTrackDbg(track));
        const t0 = performance.now();
        try {
          await fn();
          this.logEffect(opId, `OK ${label} +${Math.round(performance.now() - t0)}ms`, this.getTrackDbg(track));
        } catch (e) {
          this.logEffect(opId, `FAIL ${label} +${Math.round(performance.now() - t0)}ms`, e);
          throw e;
        }
      });

    this.effectQueueByTrack.set(track, next);
    return next;
  }

  private async waitEffectIdle(track: any) {
    const p = this.effectQueueByTrack.get(track);
    if (p) {
      try {
        await p;
      } catch { }
    }
  }

  private async safeSetEffect(track: any, effect: any, reason: string) {
    if (!track || typeof track.setEffect !== "function") return;

    await this.runEffectOpOnTrack(track, `setEffect(${reason})`, async () => {
      const attempt = async () => {
        // setEffect may be sync or return Promise depending on build
        return this.withTimeout(Promise.resolve(track.setEffect(effect)), 2500, `setEffect(${reason})`);
      };

      try {
        await attempt();
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if (msg.includes("setEffect already in progress")) {
          this.logEffect(++this.effectOpSeq, `RETRY setEffect(${reason}) after in-progress`);
          await new Promise((r) => setTimeout(r, 120));
          await attempt();
        } else {
          throw e;
        }
      }
    });
  }

  private async safeDisposeTrack(track: any, reason: string) {
    if (!track) return;
    await this.waitEffectIdle(track);
    try {
      track.dispose?.();
      this.logEffect(++this.effectOpSeq, `dispose(${reason}) OK`, this.getTrackDbg(track));
    } catch (e) {
      this.logEffect(++this.effectOpSeq, `dispose(${reason}) FAIL`, e);
    }
  }

  // ========================================================================
  // ✅ TARGETED BLACK-VIDEO RECOVERY
  // ========================================================================
  private videoElByPid = new Map<string, HTMLVideoElement>();
  private screenElByPid = new Map<string, HTMLVideoElement>();

  private videoHealthTimer: any = null;
  private healthSoonTimer: any = null;

  private readonly HEALTH_TICK_MS = 1500;
  private readonly STUCK_THRESHOLD_MS = 2500;

  private readonly REATTACH_COOLDOWN_MS = 4000;
  private readonly BUMP_COOLDOWN_MS = 8000;

  private videoHealthState = new Map<
    string,
    {
      lastFrameCount: number | null;
      lastCurrentTime: number;
      lastProgressAt: number;
      stuckSince: number | null;
      lastReattachAt: number;
      lastBumpAt: number;
      reattachAttemptsInWindow: number;
      lastAttemptWindowAt: number;
    }
  >();

  public async listMediaDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      videoInputs: devices.filter((d) => d.kind === "videoinput"),
      audioInputs: devices.filter((d) => d.kind === "audioinput"),
      audioOutputs: devices.filter((d) => d.kind === "audiooutput"),
    };
  }

  public setAudioOutputDevice(deviceId: string) {
    this.mediaSettings.audioOutputId = deviceId || "default";
  }

  public registerVideoElement(
    participantId: string,
    el: HTMLVideoElement | null | undefined,
    kind: "video" | "screen" = "video"
  ) {
    if (!participantId) return;
    const map = kind === "screen" ? this.screenElByPid : this.videoElByPid;

    if (!el) {
      map.delete(participantId);
      return;
    }

    map.set(participantId, el);
    this.scheduleHealthTickSoon();
  }

  private scheduleHealthTickSoon() {
    this.startVideoHealthMonitor();

    if (this.healthSoonTimer) return;
    this.healthSoonTimer = setTimeout(() => {
      this.healthSoonTimer = null;
      if (this.disposed) return;
      this.healthTick();
    }, 0);
  }

  private startVideoHealthMonitor() {
    if (this.videoHealthTimer) return;
    this.videoHealthTimer = setInterval(() => {
      if (this.disposed) return;
      this.healthTick();
    }, this.HEALTH_TICK_MS);
  }

  private stopVideoHealthMonitor() {
    if (this.videoHealthTimer) clearInterval(this.videoHealthTimer);
    this.videoHealthTimer = null;

    if (this.healthSoonTimer) clearTimeout(this.healthSoonTimer);
    this.healthSoonTimer = null;

    this.videoHealthState.clear();
    this.videoElByPid.clear();
    this.screenElByPid.clear();
  }

  private getFrameCount(el: HTMLVideoElement): number | null {
    try {
      const anyEl = el as any;

      if (typeof anyEl.webkitDecodedFrameCount === "number") {
        return Number(anyEl.webkitDecodedFrameCount);
      }

      if (typeof el.getVideoPlaybackQuality === "function") {
        const q = el.getVideoPlaybackQuality();
        const n = Number((q as any)?.totalVideoFrames);
        return Number.isFinite(n) ? n : null;
      }
    } catch { }
    return null;
  }

  private getOrInitHealth(pid: string) {
    const now = Date.now();
    const cur = this.videoHealthState.get(pid);
    if (cur) return cur;

    const init = {
      lastFrameCount: null as number | null,
      lastCurrentTime: 0,
      lastProgressAt: now,
      stuckSince: null as number | null,
      lastReattachAt: 0,
      lastBumpAt: 0,
      reattachAttemptsInWindow: 0,
      lastAttemptWindowAt: now,
    };

    this.videoHealthState.set(pid, init);
    return init;
  }

  private getSubscribedRemoteIds(): { ids: string[]; desiredLastN: number } {
    const finalRemoteIds = this.computeFinalRemoteIds();
    const desiredLastN = Math.min(finalRemoteIds.length, this.MAX_LAST_N);
    return { ids: finalRemoteIds.slice(0, desiredLastN), desiredLastN };
  }

  private healthTick() {
    if (!this.conference || this.disposed) return;

    const { ids: subscribedRemoteIds } = this.getSubscribedRemoteIds();
    if (!subscribedRemoteIds.length) return;

    const now = Date.now();

    for (const pid of Array.from(this.videoHealthState.keys())) {
      if (!subscribedRemoteIds.includes(pid)) {
        this.videoHealthState.delete(pid);
      }
    }

    for (const pid of subscribedRemoteIds) {
      const p = this.participants[pid];
      if (!p || p.isLocal) continue;

      const hasScreen = !!p.screenTrack && this.screenElByPid.has(pid);
      const kind: "video" | "screen" = hasScreen ? "screen" : "video";

      const el = kind === "screen" ? this.screenElByPid.get(pid) : this.videoElByPid.get(pid);
      const track = kind === "screen" ? p.screenTrack : p.videoTrack;

      if (!el || !track) continue;

      if (kind === "video" && p.videoMuted) {
        const st = this.getOrInitHealth(pid);
        st.stuckSince = null;
        st.lastProgressAt = now;
        st.lastFrameCount = this.getFrameCount(el);
        st.lastCurrentTime = el.currentTime || 0;
        continue;
      }

      const ready = el.readyState >= 2;
      const hasSize = (el.videoWidth || 0) > 0 && (el.videoHeight || 0) > 0;

      const st = this.getOrInitHealth(pid);

      const frames = this.getFrameCount(el);
      const curTime = Number(el.currentTime || 0);

      let progressed = false;
      if (frames != null && st.lastFrameCount != null) {
        progressed = frames > st.lastFrameCount;
      } else {
        progressed = curTime > (st.lastCurrentTime || 0);
      }

      if (ready && hasSize && progressed) {
        st.lastProgressAt = now;
        st.stuckSince = null;
        st.lastFrameCount = frames;
        st.lastCurrentTime = curTime;
        continue;
      }

      if (st.stuckSince == null) st.stuckSince = now;

      st.lastFrameCount = frames;
      st.lastCurrentTime = curTime;

      const stuckFor = now - st.stuckSince;
      if (stuckFor < this.STUCK_THRESHOLD_MS) continue;

      void this.recoverParticipantVideo(pid, kind, track, el, st);
    }
  }

  private async recoverParticipantVideo(
    pid: string,
    kind: "video" | "screen",
    track: any,
    el: HTMLVideoElement,
    st: {
      lastFrameCount: number | null;
      lastCurrentTime: number;
      lastProgressAt: number;
      stuckSince: number | null;
      lastReattachAt: number;
      lastBumpAt: number;
      reattachAttemptsInWindow: number;
      lastAttemptWindowAt: number;
    }
  ) {
    const now = Date.now();
    if (now - st.lastReattachAt < this.REATTACH_COOLDOWN_MS) return;

    if (now - st.lastAttemptWindowAt > 12000) {
      st.lastAttemptWindowAt = now;
      st.reattachAttemptsInWindow = 0;
    }
    st.reattachAttemptsInWindow += 1;

    st.lastReattachAt = now;

    try {
      if (typeof track.detach === "function") {
        try {
          track.detach(el);
        } catch { }
      }
      if (typeof track.detach === "function") {
        try {
          track.detach();
        } catch { }
      }

      await new Promise((r) => setTimeout(r, 40));

      if (typeof track.attach === "function") {
        try {
          track.attach(el);
        } catch { }
      }

      try {
        if (typeof (el as any).play === "function") {
          await el.play().catch(() => { });
        }
      } catch { }

      st.stuckSince = Date.now();
      st.lastProgressAt = Date.now();

      if (st.reattachAttemptsInWindow >= 2) {
        this.bumpParticipantSubscription(pid, st);
      }
    } catch {
      this.bumpParticipantSubscription(pid, st);
    }
  }

  private bumpParticipantSubscription(pid: string, st: { lastBumpAt: number }) {
    const now = Date.now();
    if (!this.conference || this.disposed) return;
    if (now - (st.lastBumpAt || 0) < this.BUMP_COOLDOWN_MS) return;

    st.lastBumpAt = now;

    try {
      const { ids: subscribedRemoteIds, desiredLastN } = this.getSubscribedRemoteIds();
      if (!subscribedRemoteIds.includes(pid)) return;

      const original = subscribedRemoteIds.slice(0, desiredLastN);
      const without = original.filter((x) => x !== pid);

      try {
        this.conference.selectParticipants?.(without);
      } catch { }

      setTimeout(() => {
        if (this.disposed || !this.conference) return;
        try {
          this.conference.selectParticipants?.(original);
        } catch { }
      }, 220);
    } catch { }
  }

  // ========================================================================
  // EFFECT SUPPORT DETECTION + COMPAT CHECK
  // ========================================================================
  private refreshEffectsSupport(track?: any) {
    const t = track ?? this.localVideoTrack;
    const hasSetEffect = typeof (t as any)?.setEffect === "function";
    this.effectsSupported = !!hasSetEffect;

    try {
      console.log(
        "[Jitsi][effects] track.setEffect:",
        typeof (t as any)?.setEffect,
        "=> supported:",
        this.effectsSupported
      );
    } catch { }

    return this.effectsSupported;
  }

  private markEffectsIncompatible(reason: string) {
    this.effectsCompat = "incompatible";
    this.effectsCompatReason = reason || "unknown";
    if (!this.effectsCompatLogged) {
      this.effectsCompatLogged = true;
      console.warn("[bg] Effects marked INCOMPATIBLE:", this.effectsCompatReason);
    }
  }

  private async ensureEffectsCompatible(): Promise<boolean> {
    if (!this.effectsSupported) return false;
    if (this.effectsCompat === "compatible") return true;
    if (this.effectsCompat === "incompatible") return false;

    // Try detect from factory return shape
    try {
      const anyJitsi = (window as any).JitsiMeetJS;
      const nativeFactory = anyJitsi?.effects?.createVirtualBackgroundEffect;

      if (typeof nativeFactory !== "function") {
        this.markEffectsIncompatible("JitsiMeetJS.effects.createVirtualBackgroundEffect is missing");
        return false;
      }

      const testVb = { backgroundType: "blur" };
      const created = nativeFactory(testVb);

      if (created && typeof created.then === "function") {
        this.markEffectsIncompatible("createVirtualBackgroundEffect returned Promise (sync build expects object)");
        return false;
      }

      const effect = created;
      if (!effect || typeof effect.startEffect !== "function") {
        this.markEffectsIncompatible("factory returned invalid effect object");
        return false;
      }

      if (this.isAsyncFunction(effect.startEffect)) {
        this.markEffectsIncompatible("effect.startEffect is async (sync build expects sync)");
        return false;
      }

      // Some builds assume isEnabled exists even during clearing
      if (typeof effect.isEnabled !== "function") effect.isEnabled = () => true;
      if (typeof effect.isSupported !== "function") effect.isSupported = () => true;

      // If we got here — looks compatible enough
      this.effectsCompat = "compatible";
      this.effectsCompatReason = "";
      console.log("[bg] Effects marked COMPATIBLE");
      return true;
    } catch (e: any) {
      this.markEffectsIncompatible(String(e?.message || e || "compat check failed"));
      return false;
    }
  }

  // ========================================================================
  // BG EFFECT CORE
  // ========================================================================
  private async clearBgEffectOnTrack(track: any) {
    if (!track) return;

    // If incompatible — do not touch setEffect at all (avoids stuck camera cases)
    if (this.effectsCompat === "incompatible") {
      try {
        await this.videoEffect?.dispose?.();
      } catch { }
      try {
        await (this.videoEffect as any)?.stopEffect?.();
      } catch { }
      this.videoEffect = undefined;
      return;
    }

    const hasSetEffect = typeof track.setEffect === "function";
    if (hasSetEffect) {
      try {
        await this.safeSetEffect(track, this.PASSTHROUGH_EFFECT, "clear");
      } catch (e) {
        console.warn("[bg] clear setEffect(passthrough) failed:", e);
      }
    }

    try {
      await this.videoEffect?.dispose?.();
    } catch { }
    try {
      await (this.videoEffect as any)?.stopEffect?.();
    } catch { }
    this.videoEffect = undefined;
  }

  private buildVirtualBackgroundOptions() {
    if (this.bgPrefs.mode === "blur") {
      return { backgroundType: "blur" };
    }
    if (this.bgPrefs.mode === "image") {
      if (!this.bgPrefs.imageUrl) return null;
      return { backgroundType: "image", virtualSource: this.bgPrefs.imageUrl };
    }
    return null;
  }

  private async applyBgEffectToTrack(track: any) {
    if (!track) return;

    this.refreshEffectsSupport(track);
    if (!this.effectsSupported) {
      console.warn("[bg] effects are NOT supported (track.setEffect missing)");
      return;
    }

    // Don’t apply if muted
    const wasMuted = (() => {
      try {
        return track.isMuted?.() === true;
      } catch {
        return false;
      }
    })();
    if (wasMuted) return;

    // If no effect desired — just clear
    if (this.bgPrefs.mode === "none") {
      await this.clearBgEffectOnTrack(track);
      return;
    }

    // Compatibility guard (fixes your exact crash)
    const compatible = await this.ensureEffectsCompatible();
    if (!compatible) {
      // Keep preference stored, but do not apply (prevents camera stuck)
      if (!this.effectsCompatLogged) {
        this.effectsCompatLogged = true;
        console.warn("[bg] Skipping background effect due to incompatible lib build:", this.effectsCompatReason);
      }
      return;
    }

    const vb = this.buildVirtualBackgroundOptions();
    if (!vb) {
      console.warn("[bg] invalid vb options (missing imageUrl?)");
      return;
    }

    // Extra safety: original stream should be ready
    try {
      const msAny = track.getOriginalStream?.();
      const ms = await Promise.resolve(msAny);
      if (!ms || typeof ms.getTracks !== "function") {
        console.warn("[bg] original stream not ready; skip applying effect");
        return;
      }
    } catch { }

    // Clear previous effect safely
    await this.clearBgEffectOnTrack(track);

    this.bgApplying = true;
    try {
      console.debug("[bg] apply request:", this.bgPrefs, "track:", this.getTrackDbg(track));

      const anyJitsi = (window as any).JitsiMeetJS;
      const nativeFactory = anyJitsi?.effects?.createVirtualBackgroundEffect;

      if (typeof nativeFactory !== "function") {
        this.markEffectsIncompatible("nativeFactory missing at apply time");
        return;
      }

      let effect: any = nativeFactory(vb as any);

      // If factory suddenly returns Promise — mark incompatible and stop
      if (effect && typeof effect.then === "function") {
        this.markEffectsIncompatible("createVirtualBackgroundEffect returned Promise at apply time");
        return;
      }

      if (!effect || typeof effect.startEffect !== "function") {
        console.warn("[bg] invalid effect object; clearing");
        await this.safeSetEffect(track, this.PASSTHROUGH_EFFECT, "invalid-effect-clear");
        return;
      }

      // Guard: async startEffect breaks sync builds
      if (this.isAsyncFunction(effect.startEffect)) {
        this.markEffectsIncompatible("effect.startEffect is async");
        return;
      }

      // Ensure required helpers exist
      if (typeof effect.isEnabled !== "function") effect.isEnabled = () => true;
      if (typeof effect.isSupported !== "function") effect.isSupported = () => true;

      // Guard: isSupported / isEnabled
      try {
        if (typeof effect.isSupported === "function") {
          const ok = effect.isSupported(track);
          if (!ok) {
            console.warn("[bg] effect.isSupported returned false; leaving passthrough");
            await this.safeSetEffect(track, this.PASSTHROUGH_EFFECT, "isSupported-false");
            return;
          }
        }
      } catch { }

      try {
        if (typeof effect.isEnabled === "function") {
          const ok = effect.isEnabled(track);
          if (!ok) {
            console.warn("[bg] effect.isEnabled returned false; leaving passthrough");
            await this.safeSetEffect(track, this.PASSTHROUGH_EFFECT, "isEnabled-false");
            return;
          }
        }
      } catch { }

      await this.safeSetEffect(track, effect, `apply/${this.bgPrefs.mode}`);
      this.videoEffect = effect;

      // Some builds may flip mute state — try to restore
      try {
        const nowMuted = track.isMuted?.() === true;
        if (nowMuted && typeof track.unmute === "function") {
          await track.unmute();
        }
      } catch { }
    } catch (e) {
      console.warn("[bg] setEffect failed, clearing:", e);
      try {
        await this.safeSetEffect(track, this.PASSTHROUGH_EFFECT, "fail-clear");
      } catch { }
      try {
        await this.videoEffect?.dispose?.();
      } catch { }
      try {
        await (this.videoEffect as any)?.stopEffect?.();
      } catch { }
      this.videoEffect = undefined;
    } finally {
      setTimeout(() => {
        this.bgApplying = false;
      }, 250);
    }
  }

  private async reapplyBgIfNeeded() {
    if (!this.localVideoTrack) return;
    if (this.bgPrefs.mode === "none") return;
    // If incompatible — don't even try
    if (this.effectsCompat === "incompatible") return;
    await this.applyBgEffectToTrack(this.localVideoTrack);
  }

  public async setBackgroundEffect(opts: { mode: BgMode; imageUrl?: string }) {
    console.debug("[bg] setBackgroundEffect request:", opts, "track:", this.getTrackDbg(this.localVideoTrack));

    this.bgPrefs = { mode: opts.mode, imageUrl: opts.imageUrl };
    this.mediaSettings.bgMode = opts.mode;
    this.mediaSettings.bgImageUrl = opts.imageUrl;

    await this.ensureLocalVideoTrack();

    const t = this.localVideoTrack;
    if (!t) return;

    this.refreshEffectsSupport(t);

    if (!this.effectsSupported) {
      console.warn("[bg] Requested", opts.mode, "but track.setEffect not supported. Keeping video as-is.");
      return;
    }

    if (opts.mode === "none") {
      await this.clearBgEffectOnTrack(t);
      return;
    }

    // If incompatible — do not apply (prevents camera stuck), but keep preference
    const ok = await this.ensureEffectsCompatible();
    if (!ok) {
      console.warn("[bg] Effect requested but incompatible build:", this.effectsCompatReason);
      return;
    }

    await this.applyBgEffectToTrack(t);

    try {
      if (this.localUserId && this.participants[this.localUserId]) {
        this.participants[this.localUserId].videoMuted = t.isMuted?.() === true;
        this.emitParticipants();
      }
    } catch { }
  }

  // ========================================================================
  // LOCAL VIDEO RECOVERY (prevents "camera stuck off")
  // ========================================================================
  private async ensureLocalVideoTrack(): Promise<void> {
    if (this.disposed || !this.JitsiMeetJS || !this.conference) return;

    try {
      const ms = this.localVideoTrack?.getOriginalStream?.();
      const vt = ms?.getVideoTracks?.()?.[0];
      if (this.localVideoTrack && vt && vt.readyState !== "ended") return;
    } catch { }

    const tracks = await this.JitsiMeetJS.createLocalTracks({
      devices: ["video"],
      constraints: {
        video: this.mediaSettings.videoInputId
          ? { deviceId: { exact: this.mediaSettings.videoInputId } }
          : true,
      },
    });

    const newVideo = tracks.find((t: any) => t.getType?.() === "video");
    if (!newVideo) return;

    const oldVideo = this.localVideoTrack;

    if (oldVideo) {
      // Clear bg safely only if we are not in incompatible mode (prevents camera issues)
      try {
        if (this.effectsCompat !== "incompatible" && this.bgPrefs.mode !== "none") {
          await this.clearBgEffectOnTrack(oldVideo);
        }
      } catch { }

      if (typeof this.conference.replaceTrack === "function") {
        await this.conference.replaceTrack(oldVideo, newVideo);
        await this.safeDisposeTrack(oldVideo, "ensureLocalVideoTrack:oldVideo");
      } else {
        try {
          await this.conference.removeTrack?.(oldVideo);
        } catch { }
        await this.safeDisposeTrack(oldVideo, "ensureLocalVideoTrack:oldVideo");
        await this.conference.addTrack(newVideo);
      }
    } else {
      await this.conference.addTrack(newVideo);
    }

    this.localVideoTrack = newVideo;

    if (this.localUserId) {
      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      entry.video = newVideo;
      this.tracksByParticipant.set(this.localUserId, entry);

      this.rebuildParticipantsFromTracks();
      const p = this.participants[this.localUserId];
      if (p) p.videoMuted = newVideo?.isMuted?.() === true;
      this.emitParticipants();
    }

    this.refreshEffectsSupport(newVideo);

    // Reapply only if compatible
    await this.reapplyBgIfNeeded();
  }

  // ========================================================================
  // INPUT DEVICES
  // ========================================================================
  public async applyInputDevices(opts: { videoInputId: string; audioInputId: string }) {
    const { videoInputId, audioInputId } = opts;

    const prevVideo = this.mediaSettings.videoInputId || "";
    const prevAudio = this.mediaSettings.audioInputId || "";

    this.mediaSettings.videoInputId = videoInputId;
    this.mediaSettings.audioInputId = audioInputId;

    const videoChanged = !!videoInputId && videoInputId !== prevVideo;
    const audioChanged = !!audioInputId && audioInputId !== prevAudio;

    if (!videoChanged && !audioChanged) {
      return { audio: this.localAudioTrack, video: this.localVideoTrack };
    }

    if (audioChanged) {
      try {
        if (this.localAudioTrack && typeof this.localAudioTrack.setDevice === "function") {
          await this.localAudioTrack.setDevice(audioInputId);
        }
      } catch (e) {
        console.warn("[applyInputDevices] audio setDevice failed:", e);
      }
    }

    if (videoChanged) {
      try {
        if (this.localVideoTrack && typeof this.localVideoTrack.setDevice === "function") {
          // Clear effect before switching device only if compatible
          const hasSetEffect = typeof (this.localVideoTrack as any)?.setEffect === "function";
          if (hasSetEffect && this.effectsCompat !== "incompatible" && this.bgPrefs.mode !== "none") {
            await this.clearBgEffectOnTrack(this.localVideoTrack);
          }

          await this.localVideoTrack.setDevice(videoInputId);

          // Re-apply after device switch (effect often drops)
          setTimeout(() => {
            void this.reapplyBgIfNeeded();
          }, 0);

          return { audio: this.localAudioTrack, video: this.localVideoTrack };
        }
      } catch (e) {
        console.warn("[applyInputDevices] video setDevice failed:", e);
      }
    }

    const JitsiMeetJS = (window as any).JitsiMeetJS;
    if (!JitsiMeetJS?.createLocalTracks) throw new Error("JitsiMeetJS.createLocalTracks not found");

    const newTracks = await JitsiMeetJS.createLocalTracks({
      devices: ["audio", "video"],
      constraints: {
        audio: audioInputId ? { deviceId: { exact: audioInputId } } : true,
        video: videoInputId ? { deviceId: { exact: videoInputId } } : true,
      },
    });

    const newAudio = newTracks.find((t: any) => t.getType?.() === "audio") || null;
    const newVideo = newTracks.find((t: any) => t.getType?.() === "video") || null;

    if (this.conference) {
      if (newAudio) {
        if (this.localAudioTrack && typeof this.conference.replaceTrack === "function") {
          const oldAudio = this.localAudioTrack;
          await this.conference.replaceTrack(oldAudio, newAudio);
          await this.safeDisposeTrack(oldAudio, "applyInputDevices:oldAudio");
          this.localAudioTrack = newAudio;
        } else if (this.localAudioTrack) {
          const oldAudio = this.localAudioTrack;
          try {
            await this.conference.removeTrack?.(oldAudio);
          } catch { }
          await this.safeDisposeTrack(oldAudio, "applyInputDevices:oldAudio");
          await this.conference.addTrack(newAudio);
          this.localAudioTrack = newAudio;
        } else {
          await this.conference.addTrack(newAudio);
          this.localAudioTrack = newAudio;
        }
      }

      if (newVideo) {
        const oldVideo = this.localVideoTrack;
        const hasSetEffect = typeof (oldVideo as any)?.setEffect === "function";

        if (oldVideo && typeof this.conference.replaceTrack === "function") {
          if (hasSetEffect && this.effectsCompat !== "incompatible" && this.bgPrefs.mode !== "none") {
            await this.clearBgEffectOnTrack(oldVideo);
          }
          await this.conference.replaceTrack(oldVideo, newVideo);
          await this.safeDisposeTrack(oldVideo, "applyInputDevices:oldVideo");
          this.localVideoTrack = newVideo;
        } else if (oldVideo) {
          if (hasSetEffect && this.effectsCompat !== "incompatible" && this.bgPrefs.mode !== "none") {
            await this.clearBgEffectOnTrack(oldVideo);
          }
          try {
            await this.conference.removeTrack?.(oldVideo);
          } catch { }
          await this.safeDisposeTrack(oldVideo, "applyInputDevices:oldVideo");
          await this.conference.addTrack(newVideo);
          this.localVideoTrack = newVideo;
        } else {
          await this.conference.addTrack(newVideo);
          this.localVideoTrack = newVideo;
        }
      }
    }

    if (this.localUserId) {
      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      if (this.localAudioTrack) entry.audio = this.localAudioTrack;
      if (this.localVideoTrack) entry.video = this.localVideoTrack;
      this.tracksByParticipant.set(this.localUserId, entry);
      this.rebuildParticipantsFromTracks();
      this.emitParticipants();
    }

    this.refreshEffectsSupport(this.localVideoTrack);
    await this.reapplyBgIfNeeded();

    return { audio: this.localAudioTrack, video: this.localVideoTrack };
  }

  // ========================================================================
  // PUBLIC API
  // ========================================================================
  async initAndJoin(roomName: string, userName: string): Promise<void> {
    await loadJitsiScripts();

    this.JitsiMeetJS = window.JitsiMeetJS;
    this.config = window.config;

    if (!this.JitsiMeetJS || !this.config) throw new Error("Jitsi globals not available");

    try {
      const lvl = this.JitsiMeetJS?.logLevels?.ERROR;
      if (typeof lvl !== "undefined") this.JitsiMeetJS.setLogLevel(lvl);
    } catch { }

    this.JitsiMeetJS.init({
      disableP2P: true,
      disableAudioLevels: true,
    });

    const serviceUrl = this.config.websocket || this.config.bosh || `wss://${JITSI_DOMAIN}/xmpp-websocket`;

    const options = {
      hosts: this.config.hosts,
      serviceUrl,
      clientNode: this.config.clientNode,
      p2p: { enabled: false },
    };

    const connection = new this.JitsiMeetJS.JitsiConnection(null, undefined, options);
    this.connection = connection;

    connection.addEventListener(this.JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, () => {
      if (this.disposed) return;
      this.setupConference(roomName, userName);
    });

    connection.addEventListener(this.JitsiMeetJS.events.connection.CONNECTION_FAILED, () => {
      if (this.disposed) return;
      this.callbacks.onError?.("Jitsi connection failed");
    });

    connection.addEventListener?.(this.JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED, () => {
      if (this.disposed) return;
      this.callbacks.onError?.("Jitsi connection disconnected");
    });

    connection.connect();
  }

  public sendReaction(type: string) {
    this.broadcastLocalEvent({ kind: "reaction", reaction: type });
  }

  public setQualityMode(mode: "auto" | "low" | "medium" | "high") {
    this.qualityMode = mode;
    this.scheduleApplyVideoSubscriptions(150, true);
    this.scheduleHealthTickSoon();
  }

  public setVisibleVideoParticipants(ids: string[]) {
    this.selectedVideoIds = Array.isArray(ids) ? ids : [];
    this.scheduleApplyVideoSubscriptions(150, false);
    this.scheduleHealthTickSoon();
  }

  async toggleAudioMute(): Promise<void> {
    if (!this.localUserId) return;
    const local = this.participants[this.localUserId];
    if (!local || !this.localAudioTrack) return;

    const track = this.localAudioTrack;
    try {
      if (track.isMuted && track.isMuted()) {
        await track.unmute();
        local.audioMuted = false;
      } else {
        await track.mute();
        local.audioMuted = true;
      }
      this.emitParticipants();
    } catch { }
  }

  async toggleVideoMute(): Promise<void> {
    if (!this.localUserId) return;

    console.debug("[cam] toggleVideoMute request. track:", this.getTrackDbg(this.localVideoTrack), "bg:", this.bgPrefs);

    try {
      await this.ensureLocalVideoTrack();
    } catch { }

    const local = this.participants[this.localUserId];
    if (!local || !this.localVideoTrack) return;

    const track = this.localVideoTrack;
    try {
      if (track.isMuted && track.isMuted()) {
        await track.unmute();
        local.videoMuted = false;

        // Reapply bg (only if compatible)
        await this.reapplyBgIfNeeded();
      } else {
        // Before muting, make sure no effect op is in-flight
        await this.waitEffectIdle(track);
        await track.mute();
        local.videoMuted = true;
      }

      this.emitParticipants();

      // ✅ IMPORTANT: no hard reset on local mute/unmute
      this.scheduleApplyVideoSubscriptions(0, false);
      this.scheduleHealthTickSoon();
    } catch { }
  }

  async toggleScreenShare(): Promise<void> {
    if (!this.conference || !this.JitsiMeetJS || !this.localUserId) return;

    if (this.localScreenshareTrack) {
      await this.handleLocalScreenshareStopped();
      return;
    }

    try {
      const tracks = await this.JitsiMeetJS.createLocalTracks({ devices: ["desktop"] });

      const screenTrack =
        tracks.find((t: any) => this.isDesktopTrack(t)) ||
        tracks.find((t: any) => t.getType && t.getType() === "desktop");

      if (!screenTrack) return;

      this.localScreenshareTrack = screenTrack;

      const trackEvents = this.JitsiMeetJS.events?.track;
      if (trackEvents?.LOCAL_TRACK_STOPPED) {
        screenTrack.addEventListener(trackEvents.LOCAL_TRACK_STOPPED, () => {
          this.handleLocalScreenshareStopped();
        });
      }

      await this.conference.addTrack(screenTrack);

      const pid = this.localUserId;
      const entry = this.tracksByParticipant.get(pid) || {};
      entry.screen = screenTrack;
      this.tracksByParticipant.set(pid, entry);

      this.rebuildParticipantsFromTracks();
      this.emitParticipants();

      // topology-ish: screen share sometimes causes receiver glitches -> allow recovery
      this.scheduleApplyVideoSubscriptions(0, true);
      this.scheduleHardResetSubscriptions(4500);

      this.scheduleHealthTickSoon();
    } catch {
      this.callbacks.onError?.("Screen share failed");
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;

    if (this.subsApplyTimer) clearTimeout(this.subsApplyTimer);
    if (this.subsHardResetTimer) clearTimeout(this.subsHardResetTimer);
    this.subsApplyTimer = null;
    this.subsHardResetTimer = null;

    if (this.subsWatchdog) clearInterval(this.subsWatchdog);
    this.subsWatchdog = null;

    this.stopVideoHealthMonitor();

    try {
      await this.videoEffect?.dispose?.();
    } catch { }
    try {
      await (this.videoEffect as any)?.stopEffect?.();
    } catch { }
    this.videoEffect = undefined;

    try {
      if (this.localScreenshareTrack) {
        try {
          await this.conference?.removeTrack?.(this.localScreenshareTrack);
        } catch { }
        await this.safeDisposeTrack(this.localScreenshareTrack, "dispose:screen");
        this.localScreenshareTrack = null;
      }
    } catch { }

    try {
      if (this.localAudioTrack) {
        try {
          await this.conference?.removeTrack?.(this.localAudioTrack);
        } catch { }
        await this.safeDisposeTrack(this.localAudioTrack, "dispose:audio");
        this.localAudioTrack = null;
      }
      if (this.localVideoTrack) {
        try {
          await this.clearBgEffectOnTrack(this.localVideoTrack);
        } catch { }
        try {
          await this.conference?.removeTrack?.(this.localVideoTrack);
        } catch { }
        await this.safeDisposeTrack(this.localVideoTrack, "dispose:video");
        this.localVideoTrack = null;
      }
    } catch { }

    this.tracksByParticipant.clear();
    this.participants = {};
    this.emitParticipants();

    try {
      await this.conference?.leave?.();
    } catch { }
    try {
      await this.connection?.disconnect?.();
    } catch { }

    this.conference = null;
    this.connection = null;
    this.localUserId = null;
  }

  // ========================================================================
  // INTERNAL
  // ========================================================================
  private setupConference(roomName: string, userName: string) {
    if (!this.connection || !this.JitsiMeetJS || !this.config) return;

    const conferenceOptions: any = { ...(this.config.conference || {}) };

    if (DISABLE_P2P) {
      conferenceOptions.p2p = { enabled: false };
      conferenceOptions.disableP2P = true;
    }

    if (userName) conferenceOptions.statisticsId = userName.toLowerCase();

    const baseRoomName = roomName && roomName.trim().length > 0 ? roomName : "default-room";
    let safeRoomName = baseRoomName.toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (!safeRoomName) safeRoomName = "session-" + Math.random().toString(36).substring(2, 8);

    const conf = this.connection.initJitsiConference(safeRoomName, conferenceOptions);
    this.conference = conf;

    const events = this.JitsiMeetJS.events;

    const applySubsSoon = (force: boolean = false) => {
      if (this.disposed) return;
      clearTimeout((this as any).__applySubsT);
      (this as any).__applySubsT = setTimeout(() => {
        if (this.disposed) return;
        this.scheduleApplyVideoSubscriptions(0, force);
      }, 80);
    };

    const topologyChanged = () => {
      this.scheduleHardResetSubscriptions(4500);
    };

    const isLocalCameraOrAudio = (track: any) => {
      try {
        if (!track?.isLocal?.()) return false;
        if (this.isDesktopTrack(track)) return false;
        const type = track.getType?.();
        return type === "video" || type === "audio";
      } catch {
        return false;
      }
    };

    conf.on(events.conference.CONFERENCE_JOINED, () => {
      if (this.disposed) return;

      const anyConf = conf as any;
      let localId: string | null = null;

      if (typeof anyConf.getLocalUserId === "function") localId = anyConf.getLocalUserId();
      else if (typeof anyConf.myUserId === "function") localId = anyConf.myUserId();

      if (!localId) {
        this.callbacks.onError?.("Failed to resolve local user id");
        return;
      }

      this.localUserId = localId;

      if (userName && typeof anyConf.setDisplayName === "function") {
        anyConf.setDisplayName(userName);
      }

      this.ensureLocalParticipant(userName);
      if (!this.tracksByParticipant.has(localId)) this.tracksByParticipant.set(localId, {});

      this.callbacks.onConferenceJoin?.();

      // initial apply (force) + recovery window
      applySubsSoon(true);
      topologyChanged();

      if (this.subsWatchdog) clearInterval(this.subsWatchdog);
      this.subsWatchdog = setInterval(() => {
        if (this.disposed) return;
        const now = Date.now();
        if (now - this.lastSubsAppliedAt > 9000) {
          this.scheduleApplyVideoSubscriptions(0, false);
        }
      }, 10000);

      this.startVideoHealthMonitor();

      setTimeout(() => {
        if (this.disposed) return;
        this.createLocalTracks();
      }, 0);
    });

    conf.on(events.conference.USER_JOINED, (id: string, user: any) => {
      if (this.disposed) return;

      this.ensureRemoteParticipant(id, user?._displayName || "Guest");
      if (!this.tracksByParticipant.has(id)) this.tracksByParticipant.set(id, {});
      this.emitParticipants();

      applySubsSoon(true);
      topologyChanged();

      this.scheduleHealthTickSoon();
    });

    conf.on(events.conference.USER_LEFT, (id: string) => {
      if (this.disposed) return;

      delete this.participants[id];
      this.tracksByParticipant.delete(id);
      this.emitParticipants();

      // cleanup dom refs / health for this pid
      this.videoElByPid.delete(id);
      this.screenElByPid.delete(id);
      this.videoHealthState.delete(id);

      applySubsSoon(true);
      topologyChanged();
    });

    conf.on(events.conference.DISPLAY_NAME_CHANGED, (id: string, displayName: string) => {
      if (this.disposed) return;
      const p = this.participants[id];
      if (p) p.displayName = displayName || p.displayName;
      else this.ensureRemoteParticipant(id, displayName || "Guest");
      this.emitParticipants();
    });

    conf.on(events.conference.TRACK_ADDED, (track: any) => {
      if (this.disposed) return;
      this.handleTrackAdded(track);

      // ✅ FIX: local camera/audio track changes should NOT trigger global recovery hard reset
      if (isLocalCameraOrAudio(track)) {
        applySubsSoon(false);
      } else {
        applySubsSoon(true);
        topologyChanged();
      }

      this.scheduleHealthTickSoon();
    });

    conf.on(events.conference.TRACK_REMOVED, (track: any) => {
      if (this.disposed) return;
      this.handleTrackRemoved(track);

      // ✅ FIX: local camera/audio track changes should NOT trigger global recovery hard reset
      if (isLocalCameraOrAudio(track)) {
        applySubsSoon(false);
      } else {
        applySubsSoon(true);
        topologyChanged();
      }

      this.scheduleHealthTickSoon();
    });

    conf.on(events.conference.TRACK_MUTE_CHANGED, (track: any) => {
      if (this.disposed) return;
      this.handleTrackMuteChanged(track);

      // ✅ IMPORTANT: no hard reset on mute
      applySubsSoon(false);

      // health can re-validate after unmute
      this.scheduleHealthTickSoon();
    });

    conf.on(events.conference.ENDPOINT_MESSAGE_RECEIVED, (senderId: string, payload: any) => {
      this.handleEndpointMessage(senderId, payload);
    });

    conf.join();
  }

  private async createLocalTracks() {
    if (!this.JitsiMeetJS || !this.conference || !this.localUserId) return;

    try {
      const tracks = await this.JitsiMeetJS.createLocalTracks({
        devices: ["audio", "video"],
        resolution: 720,
        constraints: {
          audio: this.mediaSettings.audioInputId ? { deviceId: { exact: this.mediaSettings.audioInputId } } : true,
          video: this.mediaSettings.videoInputId
            ? { deviceId: { exact: this.mediaSettings.videoInputId } }
            : {
              height: { ideal: 720, max: 720 },
              width: { ideal: 1280, max: 1280 },
              frameRate: { ideal: 30, max: 30 },
            },
        },
      });

      for (const t of tracks) {
        const type = t.getType?.();
        await this.conference.addTrack(t);
        if (type === "audio") this.localAudioTrack = t;
        if (type === "video") this.localVideoTrack = t;
      }

      this.refreshEffectsSupport(this.localVideoTrack);

      try {
        console.log("[dbg] localVideoTrack setEffect:", typeof (this.localVideoTrack as any)?.setEffect);
      } catch { }

      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      if (this.localAudioTrack) entry.audio = this.localAudioTrack;
      if (this.localVideoTrack) entry.video = this.localVideoTrack;
      this.tracksByParticipant.set(this.localUserId, entry);

      await this.reapplyBgIfNeeded();

      this.rebuildParticipantsFromTracks();
      this.emitParticipants();

      // initial apply (force) + recovery
      this.scheduleApplyVideoSubscriptions(0, true);
      this.scheduleHardResetSubscriptions(4500);

      this.scheduleHealthTickSoon();
    } catch (e) {
      console.error("createLocalTracks error", e);
      this.callbacks.onError?.("Failed to access camera/microphone");
    }
  }

  // ========================================================================
  // VIDEO SUBSCRIPTIONS (stable)
  // ========================================================================
  private scheduleApplyVideoSubscriptions(delayMs: number = 150, force: boolean = false) {
    if (!this.conference || this.disposed) return;
    if (this.subsApplyTimer) clearTimeout(this.subsApplyTimer);
    this.subsApplyTimer = setTimeout(() => {
      this.subsApplyTimer = null;
      this.applyVideoSubscriptions(force);
    }, delayMs);
  }

  private scheduleHardResetSubscriptions(delayMs: number = 4500) {
    if (!this.conference || this.disposed) return;
    if (this.subsHardResetTimer) clearTimeout(this.subsHardResetTimer);
    this.subsHardResetTimer = setTimeout(() => {
      this.subsHardResetTimer = null;
      this.hardResetAndApplyVideoSubscriptions();
    }, delayMs);
  }

  private pickReceiverConstraintHeight(n: number): number {
    if (this.qualityMode === "high") return 720;
    if (this.qualityMode === "medium") return 360;
    if (this.qualityMode === "low") return 180;

    if (n <= 2) return 720;
    if (n <= 6) return 540;
    if (n <= 12) return 360;
    if (n <= 25) return 180;
    return 180;
  }

  private getRemoteIdsWithAnyVideoOrScreen(): string[] {
    const localId = this.localUserId;
    const out: string[] = [];

    for (const [pid, tracks] of this.tracksByParticipant.entries()) {
      if (!pid) continue;
      if (localId && pid === localId) continue;

      if (tracks?.screen || tracks?.video) out.push(pid);
    }

    // stable ordering
    out.sort();
    return out;
  }

  private computeFinalRemoteIds(): string[] {
    const localId = this.localUserId;

    const active = this.getRemoteIdsWithAnyVideoOrScreen();
    const ui = (this.selectedVideoIds || []).filter((id) => id && id !== localId).slice().sort();

    const merged: string[] = [];
    for (const id of active) if (!merged.includes(id)) merged.push(id);
    for (const id of ui) if (!merged.includes(id)) merged.push(id);

    return merged;
  }

  private buildSubsKey(finalRemoteIds: string[], desiredLastN: number, h: number) {
    // include qualityMode so changing mode re-applies
    return `${this.qualityMode}|${desiredLastN}|${h}|${finalRemoteIds.join(",")}`;
  }

  private applyVideoSubscriptions(force: boolean = false) {
    if (!this.conference) return;

    try {
      const finalRemoteIds = this.computeFinalRemoteIds();
      const desiredLastN = Math.min(finalRemoteIds.length, this.MAX_LAST_N);
      const h = this.pickReceiverConstraintHeight(desiredLastN);

      const key = this.buildSubsKey(finalRemoteIds, desiredLastN, h);

      // ✅ no-op if nothing actually changed
      if (!force && key === this.lastSubsKey) return;

      this.lastSubsKey = key;
      this.lastSubsAppliedAt = Date.now();

      this.conference.setLastN?.(desiredLastN);
      this.conference.setReceiverVideoConstraint?.(h);
      this.conference.setReceiverAudioConstraint?.(true);

      if (typeof this.conference.selectParticipants === "function") {
        this.conference.selectParticipants(finalRemoteIds.slice(0, desiredLastN));
      }

      this.scheduleHealthTickSoon();
    } catch { }
  }

  private hardResetAndApplyVideoSubscriptions() {
    if (!this.conference || this.subsHardResetInFlight) return;

    const now = Date.now();
    if (now < this.hardResetCooldownUntil) return;

    this.subsHardResetInFlight = true;

    try {
      const finalRemoteIds = this.computeFinalRemoteIds();
      const desiredLastN = Math.min(finalRemoteIds.length, this.MAX_LAST_N);
      const h = this.pickReceiverConstraintHeight(desiredLastN);

      // hard reset (rare)
      try {
        this.conference.selectParticipants?.([]);
      } catch { }
      try {
        this.conference.setLastN?.(0);
      } catch { }

      setTimeout(() => {
        if (this.disposed || !this.conference) {
          this.subsHardResetInFlight = false;
          return;
        }

        try {
          this.conference.setLastN?.(desiredLastN);
          this.conference.setReceiverVideoConstraint?.(h);
          this.conference.setReceiverAudioConstraint?.(true);
          this.conference.selectParticipants?.(finalRemoteIds.slice(0, desiredLastN));

          // force refresh cache
          this.lastSubsKey = "";
          this.lastSubsAppliedAt = Date.now();
        } catch {
          // ignore
        } finally {
          // ✅ cooldown so we don't spam resets
          this.hardResetCooldownUntil = Date.now() + 20000; // 20s
          this.subsHardResetInFlight = false;

          this.scheduleHealthTickSoon();
        }
      }, 220);
    } catch {
      this.subsHardResetInFlight = false;
    }
  }

  private broadcastLocalEvent(ev: any) {
    if (!this.conference || !this.localUserId) return;

    const ids = Object.keys(this.participants);
    for (const id of ids) {
      if (id === this.localUserId) continue;
      try {
        this.conference.sendEndpointMessage(id, ev);
      } catch { }
    }
  }

  // ========================================================================
  // PARTICIPANTS (DTO)
  // ========================================================================
  private ensureLocalParticipant(displayName: string) {
    if (!this.localUserId) return;
    if (!this.participants[this.localUserId]) {
      this.participants[this.localUserId] = {
        id: this.localUserId,
        displayName: displayName || "Me",
        isLocal: true,
        audioMuted: false,
        videoMuted: false,
        isScreenSharing: false,
      };
    } else {
      if (displayName) this.participants[this.localUserId].displayName = displayName;
    }
    this.emitParticipants();
  }

  private ensureRemoteParticipant(id: string, displayName: string) {
    if (!this.participants[id]) {
      this.participants[id] = {
        id,
        displayName: displayName || "Guest",
        isLocal: false,
        audioMuted: false,
        videoMuted: false,
        isScreenSharing: false,
      };
    }
  }

  // ========================================================================
  // TRACKS
  // ========================================================================
  private handleTrackAdded(track: any) {
    const pid = this.resolveTrackParticipantId(track);
    if (!pid) return;

    const isLocal = track.isLocal?.() === true;
    if (isLocal) this.ensureLocalParticipant(this.participants[pid]?.displayName || "");
    else this.ensureRemoteParticipant(pid, this.participants[pid]?.displayName || "Guest");

    const entry = this.tracksByParticipant.get(pid) || {};

    if (this.isDesktopTrack(track)) {
      entry.screen = track;
    } else {
      const type = track.getType?.();
      if (type === "audio") entry.audio = track;
      if (type === "video") entry.video = track;

      if (isLocal && type === "video") {
        this.localVideoTrack = track;
        this.refreshEffectsSupport(track);
        void this.reapplyBgIfNeeded();
      }
      if (isLocal && type === "audio") {
        this.localAudioTrack = track;
      }
    }

    this.tracksByParticipant.set(pid, entry);
    this.rebuildParticipantsFromTracks();
    this.emitParticipants();

    this.scheduleHealthTickSoon();
  }

  private handleTrackRemoved(track: any) {
    const pid = this.resolveTrackParticipantId(track);
    if (!pid) return;

    const entry = this.tracksByParticipant.get(pid);
    if (!entry) return;

    if (this.isDesktopTrack(track)) {
      if (entry.screen === track) delete entry.screen;
    } else {
      const type = track.getType?.();
      if (type === "audio" && entry.audio === track) delete entry.audio;
      if (type === "video" && entry.video === track) delete entry.video;

      if (pid === this.localUserId && type === "video" && this.localVideoTrack === track) {
        this.clearBgEffectOnTrack(track);
        this.localVideoTrack = null;
      }
      if (pid === this.localUserId && type === "audio" && this.localAudioTrack === track) {
        this.localAudioTrack = null;
      }
    }

    if (!entry.audio && !entry.video && !entry.screen) {
      if (pid !== this.localUserId) this.tracksByParticipant.delete(pid);
      else this.tracksByParticipant.set(pid, entry);
    } else {
      this.tracksByParticipant.set(pid, entry);
    }

    if (pid === this.localUserId && this.localScreenshareTrack === track) this.localScreenshareTrack = null;

    this.rebuildParticipantsFromTracks();
    this.emitParticipants();

    this.scheduleHealthTickSoon();
  }

  private handleTrackMuteChanged(track: any) {
    const pid = this.resolveTrackParticipantId(track);
    if (!pid) return;

    const p = this.participants[pid];
    if (!p) return;

    const type = track.getType?.();
    if (type === "audio") {
      p.audioMuted = track.isMuted ? track.isMuted() : p.audioMuted;
    } else if (type === "video") {
      if (!this.isDesktopTrack(track)) {
        if (!(pid === this.localUserId && this.bgApplying)) {
          p.videoMuted = track.isMuted ? track.isMuted() : p.videoMuted;
        }

        if (pid === this.localUserId) {
          try {
            const nowMuted = track.isMuted?.() === true;
            if (!nowMuted) void this.reapplyBgIfNeeded();
          } catch { }
        }
      }
    }

    p.isScreenSharing = !!p.screenTrack;
    this.emitParticipants();
  }

  private rebuildParticipantsFromTracks() {
    for (const [pid, tracks] of this.tracksByParticipant.entries()) {
      if (pid === this.localUserId) this.ensureLocalParticipant(this.participants[pid]?.displayName || "Me");
      else this.ensureRemoteParticipant(pid, this.participants[pid]?.displayName || "Guest");

      const p = this.participants[pid];
      if (!p) continue;

      p.audioTrack = tracks.audio;
      p.videoTrack = tracks.video;
      p.screenTrack = tracks.screen;
      p.isScreenSharing = !!tracks.screen;

      if (tracks.audio?.isMuted) p.audioMuted = !!tracks.audio.isMuted();
      if (tracks.video?.isMuted) p.videoMuted = !!tracks.video.isMuted();
    }
  }

  private resolveTrackParticipantId(track: any): string | null {
    const isLocal = track?.isLocal?.() === true;
    if (isLocal) return this.localUserId;
    return track?.getParticipantId?.() || null;
  }

  private isDesktopTrack(track: any): boolean {
    const type = track?.getType?.();
    const videoType = track?.getVideoType?.();
    return videoType === "desktop" || type === "desktop";
  }

  private async handleLocalScreenshareStopped() {
    if (!this.localScreenshareTrack || !this.conference || !this.localUserId) {
      this.localScreenshareTrack = null;
      return;
    }

    try {
      await this.conference.removeTrack(this.localScreenshareTrack);
    } catch { }
    await this.safeDisposeTrack(this.localScreenshareTrack, "handleLocalScreenshareStopped:screen");

    const pid = this.localUserId;
    const entry = this.tracksByParticipant.get(pid);
    if (entry?.screen === this.localScreenshareTrack) {
      delete entry.screen;
      this.tracksByParticipant.set(pid, entry);
    }

    this.localScreenshareTrack = null;

    this.rebuildParticipantsFromTracks();
    this.emitParticipants();

    this.scheduleApplyVideoSubscriptions(0, true);
    this.scheduleHardResetSubscriptions(4500);

    this.scheduleHealthTickSoon();
  }

  private emitParticipants() {
    const arr = Object.values(this.participants);

    arr.sort((a, b) => {
      if (a.isLocal && !b.isLocal) return -1;
      if (!a.isLocal && b.isLocal) return 1;
      const an = (a.displayName || "").toLowerCase();
      const bn = (b.displayName || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return a.id.localeCompare(b.id);
    });

    this.callbacks.onParticipantsUpdate?.(arr);
  }

  private handleEndpointMessage(senderId: string, payload: any) {
    if (!payload) return;
    if (payload.kind === "reaction" && payload.reaction) {
      this.callbacks.onReactionReceived?.(senderId, payload.reaction);
    }
  }
}
