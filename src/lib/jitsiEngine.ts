// ============================================================================
// src/lib/jitsiEngine.ts — SFU-only (P2P OFF) + track-based + reactions + SAFE background effects
// Ultra-stable subscriptions: no-op caching + delayed hard reset + cooldown
// ✅ Added: targeted “black video” recovery (reattach per participant + optional subs bump)
// ✅ Fixed: do NOT treat local camera/audio track add/remove as topology change (prevents global resub churn on toggleVideo)
//
// ✅ UPDATED (Native Jitsi background effects):
// - Removed custom ./backgroundEffect usage
// - Uses vendored Jitsi Meet virtual background implementation:
//   src/lib/jitsiEffects/virtualBackground/{index.ts, JitsiStreamBackgroundEffect.ts, vendor/tflite/*}
// - Applies effect via localVideoTrack.setEffect(effect)
// - Re-applies effect after camera change / track recreation
//
// ✅ PATCH (SAFE stream adapter for setEffect):
// - Ensures effect.startEffect(...) is SYNC and returns a real MediaStream
//   (fixes: this.stream.getTracks is not a function / Promise stream issues)
// ============================================================================

import { createVirtualBackgroundEffect } from "./jitsiEffects/virtualBackground";

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

  // ========================================================================
  // ✅ TARGETED BLACK-VIDEO RECOVERY
  // ========================================================================
  /**
   * Engine doesn’t own DOM by default. VideoRoom can (optionally) register <video> elements here.
   * If you don’t register, monitor won’t do anything (safe no-op).
   */
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

  constructor(callbacks: JitsiEngineCallbacks = {}) {
    this.callbacks = callbacks;
  }

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

  /**
   * ✅ Optional: call from VideoRoom when you have the actual <video> element for a participant.
   * - kind="video" for camera track
   * - kind="screen" for desktop track
   */
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

  /** Who are we actually subscribed to right now? Mirror applyVideoSubscriptions logic. */
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
  // EFFECT SUPPORT DETECTION
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

    if (this.localVideoTrack) {
      if (typeof this.conference.replaceTrack === "function") {
        try {
          await this.clearBgEffectOnTrack(this.localVideoTrack);
        } catch { }
        await this.conference.replaceTrack(this.localVideoTrack, newVideo);
        try {
          this.localVideoTrack.dispose?.();
        } catch { }
      } else {
        try {
          await this.clearBgEffectOnTrack(this.localVideoTrack);
        } catch { }
        try {
          await this.conference.removeTrack?.(this.localVideoTrack);
        } catch { }
        try {
          this.localVideoTrack.dispose?.();
        } catch { }
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
    await this.reapplyBgIfNeeded();
  }

  // ========================================================================
  // BG EFFECT CORE (Native Jitsi Virtual Background Effect)
  // ========================================================================

  /**
   * ✅ Robust coercion:
   * MUST return a real MediaStream whose getTracks() returns an array.
   * (We cannot rely on duck-typing only.)
   */
  private coerceToRealMediaStream(x: any): MediaStream | null {
    try {
      if (!x) return null;

      // Real MediaStream
      if (typeof x.getTracks === "function") {
        const tracks = x.getTracks();
        if (Array.isArray(tracks)) return x as MediaStream;
      }

      // MediaStreamTrack
      if (typeof MediaStreamTrack !== "undefined" && x instanceof MediaStreamTrack) {
        return new MediaStream([x]);
      }

      // { track: MediaStreamTrack }
      if (x?.track && typeof MediaStreamTrack !== "undefined" && x.track instanceof MediaStreamTrack) {
        return new MediaStream([x.track]);
      }

      // { stream: MediaStream }
      if (x?.stream && typeof x.stream.getTracks === "function" && Array.isArray(x.stream.getTracks())) {
        return x.stream as MediaStream;
      }

      // Jitsi wrapper exposing getOriginalStream()
      if (typeof x?.getOriginalStream === "function") {
        const s = x.getOriginalStream();
        if (s && typeof s.getTracks === "function" && Array.isArray(s.getTracks())) return s as MediaStream;
      }
    } catch { }
    return null;
  }

  /**
   * ✅ IMPORTANT:
   * Some lib-jitsi-meet builds DO NOT support async startEffect.
   * This patch enforces SYNC and MediaStream-in/MediaStream-out.
   */
  private patchStartEffectToForceMediaStream(effect: any) {
    if (!effect || typeof effect.startEffect !== "function") return effect;
    if ((effect as any).__mysession_patched_startEffect) return effect;
    (effect as any).__mysession_patched_startEffect = true;

    const original = effect.startEffect.bind(effect);

    effect.startEffect = (streamLike: any) => {
      const inMs = this.coerceToRealMediaStream(streamLike);
      if (!inMs) throw new Error("[bg] startEffect received non-MediaStream (input)");

      const out = original(inMs); // ✅ DO NOT await

      if (out && typeof out.then === "function") {
        // This lib build expects a sync MediaStream, not a Promise.
        throw new Error("[bg] startEffect returned Promise; this lib build expects sync MediaStream");
      }

      const outMs = this.coerceToRealMediaStream(out);
      if (outMs) return outMs;

      // Some implementations return undefined but mutate internal pipeline;
      // in that case just pass through the input stream.
      return inMs;
    };

    return effect;
  }

  // ✅ stable passthrough used to "clear" effect without passing null/undefined into setEffect
  private readonly PASSTHROUGH_EFFECT: any = {
    __mysession_passthrough: true,
    isEnabled: () => true,
    isSupported: () => true,
    startEffect: (streamLike: any) => {
      const ms = this.coerceToRealMediaStream(streamLike);
      if (!ms) throw new Error("[bg] passthrough received non-MediaStream");
      return ms; // ✅ SYNC MediaStream
    },
    stopEffect: () => { },
    dispose: () => { },
  };

  private async clearBgEffectOnTrack(track: any) {
    if (!track) return;

    const hasSetEffect = typeof track.setEffect === "function";
    if (hasSetEffect) {
      // ✅ Avoid passing null/undefined into lib builds that call isEnabled(effect)
      try {
        await track.setEffect(this.PASSTHROUGH_EFFECT);
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
      console.warn("[bg] effects are NOT supported by current lib build (track.setEffect missing)");
      return;
    }

    const hasSetEffect = typeof track.setEffect === "function";
    if (!hasSetEffect) {
      console.warn("[bg] track.setEffect is not available in this lib build");
      return;
    }

    const wasMuted = (() => {
      try {
        return track.isMuted?.() === true;
      } catch {
        return false;
      }
    })();

    if (wasMuted) return;

    // ✅ Extra safety: don’t try if original stream isn't ready yet
    try {
      const msAny = track.getOriginalStream?.();
      const ms = this.coerceToRealMediaStream(msAny);
      if (!ms) {
        console.warn("[bg] track original stream not ready; skip applying effect");
        return;
      }
    } catch { }

    if (this.bgPrefs.mode === "none") {
      await this.clearBgEffectOnTrack(track);
      return;
    }

    // Clear previous effect first (safe)
    await this.clearBgEffectOnTrack(track);

    const vb = this.buildVirtualBackgroundOptions();
    if (!vb) {
      console.warn("[bg] invalid vb options (missing imageUrl?)");
      return;
    }

    this.bgApplying = true;
    try {
      const anyJitsi = (window as any).JitsiMeetJS;
      const nativeFactory = anyJitsi?.effects?.createVirtualBackgroundEffect;

      let effect: any;
      if (typeof nativeFactory === "function") {
        effect = await nativeFactory(vb as any);
      } else {
        effect = await createVirtualBackgroundEffect(vb as any);
      }

      // ✅ Critical: patch startEffect to be SYNC and stream-safe
      effect = this.patchStartEffectToForceMediaStream(effect);

      // Optional: some builds expose isEnabled(track)
      try {
        if (effect?.isEnabled && typeof effect.isEnabled === "function") {
          const ok = effect.isEnabled(track);
          if (!ok) {
            console.warn("[bg] effect.isEnabled returned false; clearing");
            await track.setEffect(this.PASSTHROUGH_EFFECT);
            return;
          }
        }
      } catch { }

      // Optional: isSupported(track)
      try {
        if (typeof effect?.isSupported === "function") {
          const ok = effect.isSupported(track);
          if (!ok) {
            console.warn("[bg] effect.isSupported returned false; clearing");
            await track.setEffect(this.PASSTHROUGH_EFFECT);
            return;
          }
        }
      } catch { }

      await track.setEffect(effect);
      this.videoEffect = effect;

      try {
        const nowMuted = track.isMuted?.() === true;
        if (!wasMuted && nowMuted && typeof track.unmute === "function") {
          await track.unmute();
        }
      } catch { }
    } catch (e) {
      console.warn("[bg] setEffect failed, clearing:", e);
      try {
        await track.setEffect(this.PASSTHROUGH_EFFECT);
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
    await this.applyBgEffectToTrack(this.localVideoTrack);
  }

  public async setBackgroundEffect(opts: { mode: BgMode; imageUrl?: string }) {
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

    await this.applyBgEffectToTrack(t);

    try {
      if (this.localUserId && this.participants[this.localUserId]) {
        this.participants[this.localUserId].videoMuted = t.isMuted?.() === true;
        this.emitParticipants();
      }
    } catch { }
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
          const hasSetEffect = typeof (this.localVideoTrack as any)?.setEffect === "function";
          if (hasSetEffect && this.bgPrefs.mode !== "none") {
            await this.clearBgEffectOnTrack(this.localVideoTrack);
          }

          await this.localVideoTrack.setDevice(videoInputId);

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
          await this.conference.replaceTrack(this.localAudioTrack, newAudio);
          this.localAudioTrack.dispose?.();
          this.localAudioTrack = newAudio;
        } else if (this.localAudioTrack) {
          try {
            await this.conference.removeTrack?.(this.localAudioTrack);
          } catch { }
          try {
            this.localAudioTrack.dispose?.();
          } catch { }
          await this.conference.addTrack(newAudio);
          this.localAudioTrack = newAudio;
        } else {
          await this.conference.addTrack(newAudio);
          this.localAudioTrack = newAudio;
        }
      }

      if (newVideo) {
        const hasSetEffect = typeof (this.localVideoTrack as any)?.setEffect === "function";
        if (this.localVideoTrack && typeof this.conference.replaceTrack === "function") {
          if (hasSetEffect && this.bgPrefs.mode !== "none") {
            await this.clearBgEffectOnTrack(this.localVideoTrack);
          }
          await this.conference.replaceTrack(this.localVideoTrack, newVideo);
          this.localVideoTrack.dispose?.();
          this.localVideoTrack = newVideo;
        } else if (this.localVideoTrack) {
          if (hasSetEffect && this.bgPrefs.mode !== "none") {
            await this.clearBgEffectOnTrack(this.localVideoTrack);
          }
          try {
            await this.conference.removeTrack?.(this.localVideoTrack);
          } catch { }
          try {
            this.localVideoTrack.dispose?.();
          } catch { }
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
        await this.reapplyBgIfNeeded();
      } else {
        await track.mute();
        local.videoMuted = true;
      }
      this.emitParticipants();

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
        try {
          this.localScreenshareTrack.dispose?.();
        } catch { }
        this.localScreenshareTrack = null;
      }
    } catch { }

    try {
      if (this.localAudioTrack) {
        try {
          await this.conference?.removeTrack?.(this.localAudioTrack);
        } catch { }
        try {
          this.localAudioTrack.dispose?.();
        } catch { }
        this.localAudioTrack = null;
      }
      if (this.localVideoTrack) {
        try {
          await this.clearBgEffectOnTrack(this.localVideoTrack);
        } catch { }
        try {
          await this.conference?.removeTrack?.(this.localVideoTrack);
        } catch { }
        try {
          this.localVideoTrack.dispose?.();
        } catch { }
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

      applySubsSoon(false);
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
    return `${this.qualityMode}|${desiredLastN}|${h}|${finalRemoteIds.join(",")}`;
  }

  private applyVideoSubscriptions(force: boolean = false) {
    if (!this.conference) return;

    try {
      const finalRemoteIds = this.computeFinalRemoteIds();
      const desiredLastN = Math.min(finalRemoteIds.length, this.MAX_LAST_N);
      const h = this.pickReceiverConstraintHeight(desiredLastN);

      const key = this.buildSubsKey(finalRemoteIds, desiredLastN, h);

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

          this.lastSubsKey = "";
          this.lastSubsAppliedAt = Date.now();
        } catch {
        } finally {
          this.hardResetCooldownUntil = Date.now() + 20000;
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
    try {
      this.localScreenshareTrack.dispose?.();
    } catch { }

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
