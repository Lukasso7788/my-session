// ============================================================================
// src/lib/jitsiEngine.ts — SFU-only (P2P OFF) + track-based + reactions + SAFE background effects
// Ultra-stable subscriptions: no-op caching + delayed hard reset + cooldown
// ✅ Targeted “black video” recovery (reattach per participant + optional subs bump)
// ✅ Post-join local A/V self-heal + resume/visibility wake recovery + optional safe rejoin
// ✅ Do NOT treat local camera/audio add/remove as topology change (prevents global resub churn on toggleVideo)
//
// ✅ Background effects (2 variants):
// (A) track.setEffect(effect) (native Jitsi VB if present, else vendored) — serialized per-track
// (B) replaceTrack pipeline (Canvas/MediaPipe processor -> createLocalTracksFromMediaStreams -> conference.replaceTrack)
// Strategy: "auto" => prefer (A), fallback to (B) on any incompatibility/error.
// ============================================================================

import { createVirtualBackgroundEffect as createVendoredVirtualBackgroundEffect } from "./jitsiEffects/virtualBackground";

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

// assets from YOUR app domain
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

  // Remember last join args (safe rejoin)
  private lastJoinRoomName: string | null = null;
  private lastJoinUserName: string | null = null;
  private lastSafeRejoinAt = 0;

  // VIDEO SUBS
  private selectedVideoIds: string[] = [];
  private qualityMode: "auto" | "low" | "medium" | "high" = "auto";
  private readonly MAX_LAST_N = 36;

  private subsHardResetInFlight = false;
  private lastSubsKey = "";
  private lastSubsAppliedAt = 0;
  private hardResetCooldownUntil = 0;

  // BG PREFS
  private bgPrefs: { mode: BgMode; imageUrl?: string } = { mode: "none" };
  private bgApplying = false;

  // ✅ CAM state
  private camToggling = false;

  // Resume / wake recovery
  private resumeHandlersAttached = false;
  private hiddenAt: number | null = null;

  // ✅ BG strategy
  private bgStrategy: "auto" | "setEffect" | "replaceTrack" = "auto";

  // setEffect-based (A)
  private videoEffect: any | undefined = undefined;
  private effectsSupported = false;
  private effectsCompatibility: "unknown" | "ok" | "incompatible" = "unknown";
  private effectsIncompatReason: string | null = null;

  // replaceTrack-based (B)
  private bgImplMode: "none" | "setEffect" | "replaceTrack" = "none";
  private bgBaseVideoTrack: JitsiTrack | null = null; // raw camera feeding processor
  private bgProcessedTrack: JitsiTrack | null = null; // outgoing track used in conference when bg enabled
  private bgProcessor: any | null = null; // Canvas/MediaPipe effect instance
  private bgProcessedStream: MediaStream | null = null;
  private bgReplaceRetryCount = 0;

  // Lazy loader for src/lib/backgroundEffect.ts
  private canvasBgFactoryLoaded = false;
  private canvasBgFactory: ((opts: any) => any) | null = null;

  // ========================================================================
  // timers (centralized)
  // ========================================================================
  private t = {
    subsApply: null as any,
    subsHard: null as any,
    subsWatch: null as any,
    postJoinHeal: null as any,
    resumeRecover: null as any,
    health: null as any,
    healthSoon: null as any,
    applySubsSoon: null as any,
  };

  private clearTO(k: keyof typeof this.t) {
    if (this.t[k]) clearTimeout(this.t[k]);
    this.t[k] = null;
  }
  private clearIV(k: keyof typeof this.t) {
    if (this.t[k]) clearInterval(this.t[k]);
    this.t[k] = null;
  }
  private setTO(k: keyof typeof this.t, ms: number, fn: () => void) {
    this.clearTO(k);
    this.t[k] = setTimeout(fn, ms);
  }
  private setIV(k: keyof typeof this.t, ms: number, fn: () => void) {
    this.clearIV(k);
    this.t[k] = setInterval(fn, ms);
  }

  // ========================================================================
  // safe utils
  // ========================================================================
  private safe<T>(fn: () => T, fallback?: T): T {
    try {
      return fn();
    } catch {
      return fallback as T;
    }
  }
  private async safeAsync<T>(fn: () => Promise<T>, fallback?: T): Promise<T> {
    try {
      return await fn();
    } catch {
      return fallback as T;
    }
  }
  private sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  // ========================================================================
  // unified op queues (BG + CAM)
  // ========================================================================
  private makeOpQueue(prefix: string, log: boolean = true) {
    let seq = 0;
    let q: Promise<void> = Promise.resolve();

    const enqueue = (label: string, fn: () => Promise<void>) => {
      const id = ++seq;
      q = q
        .catch(() => { })
        .then(async () => {
          if (log) this.safe(() => console.debug(`[${prefix}#${id}] BEGIN ${label}`));
          await fn();
          if (log) this.safe(() => console.debug(`[${prefix}#${id}] END ${label}`));
        })
        .catch((e) => {
          this.safe(() => console.warn(`[${prefix}#${id}] FAIL ${label}:`, e));
        });
      return q;
    };

    const waitIdle = async () => {
      try {
        await q;
      } catch { }
    };

    return { enqueue, waitIdle, get promise() { return q; } };
  }

  private bgQ = this.makeOpQueue("bgQ");
  private camQ = this.makeOpQueue("camQ");

  private enqueueBgOp(label: string, fn: () => Promise<void>) {
    return this.bgQ.enqueue(label, fn);
  }
  private enqueueCamOp(label: string, fn: () => Promise<void>) {
    return this.camQ.enqueue(label, fn);
  }
  private async waitBgIdle() {
    return this.bgQ.waitIdle();
  }

  // ========================================================================
  // ✅ EFFECT OPS SERIALIZER + DEBUG (per-track)
  // ========================================================================
  private effectOpSeq = 0;
  private effectQueueByTrack = new WeakMap<any, Promise<void>>();

  private readonly PASSTHROUGH_EFFECT = {
    startEffect: (stream: MediaStream) => stream, // sync
    stopEffect: () => { },
    dispose: () => { },
    isEnabled: (_track?: any) => true,
    isSupported: (_track?: any) => true,
  };

  constructor(callbacks: JitsiEngineCallbacks = {}) {
    this.callbacks = callbacks;
  }

  // ========================================================================
  // PUBLIC small settings
  // ========================================================================
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

  // ========================================================================
  // effect support markers
  // ========================================================================
  private markEffectsIncompatible(reason: string) {
    if (this.effectsCompatibility !== "incompatible") {
      this.effectsCompatibility = "incompatible";
      this.effectsIncompatReason = reason;
      this.safe(() => console.warn("[bg] setEffect path marked INCOMPATIBLE:", reason));
    }
  }

  private markEffectsOk() {
    if (this.effectsCompatibility !== "ok") {
      this.effectsCompatibility = "ok";
      this.effectsIncompatReason = null;
      this.safe(() => console.log("[bg] setEffect path marked OK"));
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
    this.safe(() => console.debug(`[bg][op#${opId}] ${phase}`, extra ?? ""));
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
      const attempt = async () => track.setEffect(effect);

      try {
        await attempt();
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if (msg.includes("setEffect already in progress")) {
          this.logEffect(++this.effectOpSeq, `RETRY setEffect(${reason}) after in-progress`);
          await this.sleep(120);
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
  // ✅ LOCAL CONFERENCE TRACK HELPERS (prevents "Cannot add second video track")
  // ========================================================================
  private getConferenceLocalTrack(kind: "audio" | "video"): any | null {
    try {
      const conf = this.conference;
      if (!conf) return null;
      const arr: any[] = conf.getLocalTracks?.() || [];
      const pick = (t: any) => !this.isDesktopTrack(t) && t?.getType?.() === kind;
      return arr.find(pick) || arr.find((t) => t?.getType?.() === kind) || null;
    } catch {
      return null;
    }
  }

  private async replaceOrAddLocalTrack(kind: "audio" | "video", next: any, reason: string) {
    if (!this.conference || this.disposed) throw new Error("conference not ready");
    const conf = this.conference;

    const existing = this.getConferenceLocalTrack(kind);

    if (existing && existing !== next) {
      try {
        if (typeof conf.replaceTrack === "function") await conf.replaceTrack(existing, next);
        else {
          try {
            await conf.removeTrack?.(existing);
          } catch { }
          await conf.addTrack(next);
        }
      } finally {
        try {
          await this.safeDisposeTrack(existing, `replaceOrAddLocalTrack:${kind}:${reason}:old`);
        } catch { }
      }
      return;
    }

    await conf.addTrack(next);
  }

  // ========================================================================
  // ✅ TARGETED BLACK-VIDEO RECOVERY
  // ========================================================================
  private videoElByPid = new Map<string, HTMLVideoElement>();
  private screenElByPid = new Map<string, HTMLVideoElement>();

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

  /**
   * Optional: call from VideoRoom when you have the actual <video> element for a participant.
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
    if (this.t.healthSoon) return;
    this.t.healthSoon = setTimeout(() => {
      this.t.healthSoon = null;
      if (this.disposed) return;
      this.healthTick();
    }, 0);
  }

  private startVideoHealthMonitor() {
    if (this.t.health) return;
    this.setIV("health", this.HEALTH_TICK_MS, () => {
      if (this.disposed) return;
      this.healthTick();
    });
  }

  private stopVideoHealthMonitor() {
    this.clearIV("health");
    this.clearTO("healthSoon");
    this.videoHealthState.clear();
    this.videoElByPid.clear();
    this.screenElByPid.clear();
  }

  private getFrameCount(el: HTMLVideoElement): number | null {
    try {
      const anyEl = el as any;
      if (typeof anyEl.webkitDecodedFrameCount === "number") return Number(anyEl.webkitDecodedFrameCount);

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

  /** Mirror applyVideoSubscriptions logic. */
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
      if (!subscribedRemoteIds.includes(pid)) this.videoHealthState.delete(pid);
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
      if (frames != null && st.lastFrameCount != null) progressed = frames > st.lastFrameCount;
      else progressed = curTime > (st.lastCurrentTime || 0);

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
        this.safe(() => track.detach(el));
        this.safe(() => track.detach());
      }

      await this.sleep(40);

      if (typeof track.attach === "function") this.safe(() => track.attach(el));

      await this.safeAsync(async () => {
        const p = (el as any).play?.();
        if (p && typeof p.then === "function") await p.catch(() => { });
      });

      st.stuckSince = Date.now();
      st.lastProgressAt = Date.now();

      if (st.reattachAttemptsInWindow >= 2) this.bumpParticipantSubscription(pid, st);
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

      this.safe(() => this.conference.selectParticipants?.(without));

      setTimeout(() => {
        if (this.disposed || !this.conference) return;
        this.safe(() => this.conference.selectParticipants?.(original));
      }, 220);
    } catch { }
  }

  // ========================================================================
  // ✅ LOCAL A/V SELF-HEAL + RESUME RECOVERY
  // ========================================================================
  private async ensureLocalAudioTrack(): Promise<void> {
    if (this.disposed || !this.JitsiMeetJS || !this.conference || !this.localUserId) return;

    const local = this.participants[this.localUserId];
    if (local?.audioMuted) return;

    // If we have a usable audio track, stop.
    try {
      const t = this.localAudioTrack;
      if (t) {
        const ms = await Promise.resolve(t.getOriginalStream?.());
        const at = ms?.getAudioTracks?.()?.[0];
        if (at && at.readyState === "live" && at.enabled !== false) return;
      }
    } catch { }

    // Adopt conference track if usable
    try {
      const confAudio = this.getConferenceLocalTrack("audio");
      if (confAudio) {
        const ms = await Promise.resolve(confAudio.getOriginalStream?.());
        const at = ms?.getAudioTracks?.()?.[0];
        if (at && at.readyState === "live" && at.enabled !== false) {
          this.localAudioTrack = confAudio;
          const entry = this.tracksByParticipant.get(this.localUserId) || {};
          entry.audio = confAudio;
          this.tracksByParticipant.set(this.localUserId, entry);
          this.rebuildParticipantsFromTracks();
          this.emitParticipants();
          return;
        }
      }
    } catch { }

    // Create fresh audio track
    try {
      const tracks = await this.JitsiMeetJS.createLocalTracks({
        devices: ["audio"],
        constraints: {
          audio: this.mediaSettings.audioInputId ? { deviceId: { exact: this.mediaSettings.audioInputId } } : true,
        },
      });

      const newAudio = tracks.find((t: any) => t.getType?.() === "audio") || null;
      if (!newAudio) return;

      await this.replaceOrAddLocalTrack("audio", newAudio, "ensureLocalAudioTrack");

      this.localAudioTrack = newAudio;

      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      entry.audio = newAudio;
      this.tracksByParticipant.set(this.localUserId, entry);

      this.rebuildParticipantsFromTracks();
      this.emitParticipants();
    } catch (e) {
      this.safe(() => console.warn("[audio] ensureLocalAudioTrack failed:", e));
    }
  }

  private async resumeAllAudioElements() {
    try {
      const audios = Array.from(document.querySelectorAll("audio")) as HTMLAudioElement[];
      for (const a of audios) {
        await this.safeAsync(async () => {
          const p = a.play?.();
          if (p && typeof p.then === "function") await p.catch(() => { });
        });
      }
    } catch { }
  }

  private schedulePostJoinSelfHeal() {
    this.setTO("postJoinHeal", 2500, () => {
      if (this.disposed) return;
      void this.postJoinSelfHeal();
    });
  }

  private async postJoinSelfHeal() {
    await this.resumeAllAudioElements();
    await this.ensureLocalAudioTrack();
    await this.ensureLocalVideoTrack();
    this.scheduleHealthTickSoon();
  }

  private attachResumeHandlers() {
    if (this.resumeHandlersAttached) return;
    this.resumeHandlersAttached = true;

    const onVisibility = () => {
      if (this.disposed) return;

      if (document.visibilityState === "hidden") {
        this.hiddenAt = Date.now();
        return;
      }

      const dt = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
      this.hiddenAt = null;

      if (dt > 15_000) this.scheduleResumeRecovery("visibility");
      else void this.resumeAllAudioElements();
    };

    const onFocus = () => {
      if (this.disposed) return;
      this.scheduleResumeRecovery("focus");
    };

    const onOnline = () => {
      if (this.disposed) return;
      this.scheduleResumeRecovery("online");
    };

    const onPageShow = (ev: any) => {
      if (this.disposed) return;
      if (ev?.persisted) this.scheduleResumeRecovery("pageshow:bfcache");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);

    (this as any).__resumeRemovers = () => {
      this.safe(() => document.removeEventListener("visibilitychange", onVisibility));
      this.safe(() => window.removeEventListener("focus", onFocus));
      this.safe(() => window.removeEventListener("online", onOnline));
      this.safe(() => window.removeEventListener("pageshow", onPageShow));
    };
  }

  private scheduleResumeRecovery(reason: string) {
    if (this.t.resumeRecover) return;
    this.t.resumeRecover = setTimeout(() => {
      this.t.resumeRecover = null;
      if (this.disposed) return;
      void this.recoverAfterResume(reason);
    }, 250);
  }

  private async recoverAfterResume(reason: string) {
    try {
      this.safe(() => console.warn("[resume] recoverAfterResume:", reason));

      await this.waitBgIdle().catch(() => { });
      await this.camQ.promise.catch(() => { });

      await this.resumeAllAudioElements();
      await this.ensureLocalAudioTrack();
      await this.ensureLocalVideoTrack();

      setTimeout(() => {
        if (this.disposed) return;
        void this.maybeSafeRejoin(`resume:${reason}`);
      }, 3500);
    } catch (e) {
      this.safe(() => console.warn("[resume] recoverAfterResume failed:", e));
      void this.maybeSafeRejoin(`resume:${reason}:exception`);
    }
  }

  private async isConferenceLikelyHealthy(): Promise<boolean> {
    if (!this.conference || this.disposed || !this.localUserId) return false;

    const local = this.participants[this.localUserId];
    const audioWanted = !local?.audioMuted;
    const videoWanted = !local?.videoMuted;

    if (!audioWanted && !videoWanted) return true;

    if (audioWanted) {
      try {
        const t = this.localAudioTrack || this.getConferenceLocalTrack("audio");
        const ms = await Promise.resolve(t?.getOriginalStream?.());
        const at = ms?.getAudioTracks?.()?.[0];
        if (!at || at.readyState !== "live" || at.enabled === false) return false;
      } catch {
        return false;
      }
    }

    if (videoWanted) {
      try {
        const base = this.bgImplMode === "replaceTrack" ? this.bgBaseVideoTrack : this.localVideoTrack;
        const t = base || this.getConferenceLocalTrack("video");
        const ms = await Promise.resolve(t?.getOriginalStream?.());
        const vt = ms?.getVideoTracks?.()?.[0];
        if (!vt || vt.readyState !== "live" || vt.enabled === false) return false;
      } catch {
        return false;
      }
    }

    return true;
  }

  private async maybeSafeRejoin(tag: string) {
    const now = Date.now();
    if (now - this.lastSafeRejoinAt < 60_000) return;

    const ok = await this.isConferenceLikelyHealthy().catch(() => false);
    if (ok) return;

    await this.safeRejoin(tag);
  }

  private async safeRejoin(tag: string) {
    const now = Date.now();
    if (now - this.lastSafeRejoinAt < 60_000) return;
    this.lastSafeRejoinAt = now;

    const room = this.lastJoinRoomName;
    const user = this.lastJoinUserName;

    if (!room || !user) {
      this.safe(() => console.warn("[rejoin] no join args stored; skip safeRejoin", tag));
      return;
    }

    this.safe(() => console.warn("[rejoin] SAFE REJOIN:", tag));

    const savedMedia = { ...this.mediaSettings };
    const savedBgPrefs = { ...this.bgPrefs };
    const savedBgStrategy = this.bgStrategy;
    const savedQuality = this.qualityMode;
    const savedSelected = [...(this.selectedVideoIds || [])];

    await this.dispose().catch(() => { });

    this.disposed = false;

    this.mediaSettings = savedMedia;
    this.bgPrefs = savedBgPrefs;
    this.bgStrategy = savedBgStrategy;
    this.qualityMode = savedQuality;
    this.selectedVideoIds = savedSelected;

    this.lastSubsKey = "";
    this.lastSubsAppliedAt = 0;
    this.hardResetCooldownUntil = 0;

    await this.initAndJoin(room, user);
  }

  // ========================================================================
  // EFFECT SUPPORT DETECTION
  // ========================================================================
  private refreshEffectsSupport(track?: any) {
    const t = track ?? this.localVideoTrack;
    const hasSetEffect = typeof (t as any)?.setEffect === "function";
    this.effectsSupported = !!hasSetEffect;

    this.safe(() =>
      console.log("[Jitsi][effects] track.setEffect:", typeof (t as any)?.setEffect, "=> supported:", this.effectsSupported)
    );

    return this.effectsSupported;
  }

  private isAsyncFunction(fn: any) {
    try {
      return typeof fn === "function" && fn.constructor && fn.constructor.name === "AsyncFunction";
    } catch {
      return false;
    }
  }

  // ========================================================================
  // BG MANAGER — strategy setter
  // ========================================================================
  public setBackgroundStrategy(strategy: "auto" | "setEffect" | "replaceTrack") {
    this.bgStrategy = strategy;
    this.safe(() => console.log("[bg] strategy set to:", strategy));
    if (this.bgPrefs.mode !== "none") void this.enqueueBgOp("setBackgroundStrategy", () => this.applyBgNow("setBackgroundStrategy"));
  }

  // ========================================================================
  // BG EFFECT (A) — setEffect path
  // ========================================================================
  private wrapEffectToForceMediaStream(effect: any) {
    if (!effect || typeof effect.startEffect !== "function") return effect;
    if ((effect as any).__msWrapped) return effect;

    const makeAdapter = (target: any, callOriginal: (s: MediaStream) => any) => {
      target.startEffect = (streamLike: any) => {
        let s: any = streamLike;

        if (s && typeof s.getTracks !== "function") {
          if (typeof MediaStreamTrack !== "undefined" && s instanceof MediaStreamTrack) {
            s = new MediaStream([s]);
          } else if (s?.track && typeof MediaStreamTrack !== "undefined" && s.track instanceof MediaStreamTrack) {
            s = new MediaStream([s.track]);
          } else if (typeof s?.getOriginalStream === "function") {
            const maybe = s.getOriginalStream();
            if (maybe && typeof maybe.then === "function") {
              throw new Error("[bg] startEffect received async getOriginalStream; build expects sync MediaStream");
            }
            s = maybe;
          }
        }

        if (!s || typeof s.getTracks !== "function") throw new Error("[bg] startEffect received non-MediaStream");

        const out = callOriginal(s);
        if (out && typeof out.then === "function") throw new Error("[bg] startEffect returned Promise; this build expects sync MediaStream");
        return out;
      };

      if (typeof target.isEnabled !== "function") target.isEnabled = (_track?: any) => true;
      return target;
    };

    try {
      const original = effect.startEffect.bind(effect);
      (effect as any).__msWrapped = true;
      return makeAdapter(effect, original);
    } catch {
      const wrapped = Object.create(effect);
      const original = effect.startEffect.bind(effect);
      (wrapped as any).__msWrapped = true;
      return makeAdapter(wrapped, original);
    }
  }

  private buildVirtualBackgroundOptions() {
    if (this.bgPrefs.mode === "blur") return { backgroundType: "blur" };
    if (this.bgPrefs.mode === "image") {
      if (!this.bgPrefs.imageUrl) return null;
      return { backgroundType: "image", virtualSource: this.bgPrefs.imageUrl };
    }
    return null;
  }

  private getEffectFactory() {
    const anyJitsi = (window as any).JitsiMeetJS;
    const nativeFactory = anyJitsi?.effects?.createVirtualBackgroundEffect;
    if (typeof nativeFactory === "function") return { kind: "native" as const, factory: nativeFactory };
    return { kind: "vendored" as const, factory: createVendoredVirtualBackgroundEffect };
  }

  private async createEffectObject(vb: any) {
    const pick = this.getEffectFactory();
    if (!pick?.factory) {
      this.markEffectsIncompatible("No effect factory available");
      return null;
    }

    const created = pick.factory(vb);
    const effect = await Promise.resolve(created);

    if (!effect) {
      this.markEffectsIncompatible(`${pick.kind} factory returned empty effect`);
      return null;
    }

    if (this.isAsyncFunction(effect.startEffect)) {
      this.markEffectsIncompatible(`${pick.kind} effect.startEffect is async (incompatible with this build)`);
      return null;
    }

    if (typeof effect.isEnabled !== "function") effect.isEnabled = (_track?: any) => true;

    this.markEffectsOk();
    return effect;
  }

  private async clearBgEffectOnTrack_setEffect(track: any) {
    if (!track) return;

    if (typeof track.setEffect === "function") {
      await this.safeAsync(() => this.safeSetEffect(track, this.PASSTHROUGH_EFFECT, "clear:setEffect"));
    }

    await this.safeAsync(async () => this.videoEffect?.dispose?.());
    await this.safeAsync(async () => (this.videoEffect as any)?.stopEffect?.());
    this.videoEffect = undefined;
  }

  private async applyBgEffectToTrack_setEffect(track: any) {
    if (!track) return;

    this.refreshEffectsSupport(track);
    if (!this.effectsSupported) throw new Error("setEffect not supported");

    const wasMuted = this.safe(() => track.isMuted?.() === true, false);
    if (wasMuted) return;

    if (this.effectsCompatibility === "incompatible") throw new Error(`setEffect incompatible: ${this.effectsIncompatReason || "unknown"}`);

    try {
      const ms = await Promise.resolve(track.getOriginalStream?.());
      if (!ms || typeof ms.getTracks !== "function") return;
    } catch { }

    if (this.bgPrefs.mode === "none") {
      await this.clearBgEffectOnTrack_setEffect(track);
      return;
    }

    await this.clearBgEffectOnTrack_setEffect(track);

    const vb = this.buildVirtualBackgroundOptions();
    if (!vb) return;

    this.bgApplying = true;
    try {
      this.safe(() => console.debug("[bg] setEffect apply request:", this.bgPrefs, "track:", this.getTrackDbg(track)));

      let effect = await this.createEffectObject(vb);
      if (!effect) throw new Error(`setEffect unavailable: ${this.effectsIncompatReason || "no effect"}`);

      effect = this.wrapEffectToForceMediaStream(effect);

      // Guard optional checks
      if (typeof effect.isSupported === "function") {
        const ok = this.safe(() => effect.isSupported(track), true);
        if (!ok) throw new Error("setEffect isSupported=false");
      }
      if (typeof effect.isEnabled === "function") {
        const ok = this.safe(() => effect.isEnabled(track), true);
        if (!ok) throw new Error("setEffect isEnabled=false");
      }

      await this.safeSetEffect(track, effect, `apply:setEffect:${this.bgPrefs.mode}`);
      this.videoEffect = effect;

      const nowMuted = this.safe(() => track.isMuted?.() === true, false);
      if (!wasMuted && nowMuted && typeof track.unmute === "function") await this.safeAsync(() => track.unmute());
    } catch (e: any) {
      this.safe(() => console.warn("[bg] setEffect apply failed:", e));

      await this.safeAsync(() => this.safeSetEffect(track, this.PASSTHROUGH_EFFECT, "apply:setEffect:fail-clear"));
      await this.safeAsync(async () => this.videoEffect?.dispose?.());
      await this.safeAsync(async () => (this.videoEffect as any)?.stopEffect?.());
      this.videoEffect = undefined;

      this.markEffectsIncompatible(`setEffect apply failed: ${String(e?.message || e || "")}`);
      throw e;
    } finally {
      setTimeout(() => (this.bgApplying = false), 250);
    }
  }

  // ========================================================================
  // BG EFFECT (B) — replaceTrack path (Canvas/MediaPipe pipeline)
  // ========================================================================
  private async loadCanvasBgFactory(): Promise<((opts: any) => any) | null> {
    if (this.canvasBgFactoryLoaded) return this.canvasBgFactory;
    this.canvasBgFactoryLoaded = true;

    try {
      const mod: any = await import("./backgroundEffect");
      const fn = mod?.createBackgroundEffect || mod?.createCanvasVirtualBgEffect || mod?.default || null;

      if (typeof fn !== "function") {
        this.safe(() => console.warn("[bg] backgroundEffect module loaded but no factory function export found"));
        this.canvasBgFactory = null;
        return null;
      }

      this.canvasBgFactory = fn;
      return fn;
    } catch (e) {
      this.safe(() => console.warn("[bg] Failed to load ./backgroundEffect:", e));
      this.canvasBgFactory = null;
      return null;
    }
  }

  private async waitBaseStream(track: any, timeoutMs = 2000): Promise<MediaStream | null> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        const ms = await Promise.resolve(track?.getOriginalStream?.());
        const vt = ms?.getVideoTracks?.()?.[0];
        if (ms && vt && vt.readyState !== "ended") return ms as MediaStream;
      } catch { }
      await this.sleep(60);
    }
    return null;
  }

  private async createJitsiVideoTrackFromStream(stream: MediaStream): Promise<JitsiTrack> {
    const J = this.JitsiMeetJS;
    if (!J) throw new Error("JitsiMeetJS not ready");

    const vt = stream.getVideoTracks?.()?.[0];
    if (!vt) throw new Error("processed stream has no video track");

    if (typeof J.createLocalTracksFromMediaStreams === "function") {
      const infos = [{ mediaType: "video", sourceType: "external", stream, track: vt, videoType: "camera" }];
      const created = await J.createLocalTracksFromMediaStreams(infos);
      const t = (created || []).find((x: any) => x?.getType?.() === "video") || (created || [])[0];
      if (!t) throw new Error("createLocalTracksFromMediaStreams returned empty");
      return t;
    }

    throw new Error("createLocalTracksFromMediaStreams not available in this build");
  }

  private async stopReplaceTrackProcessor(reason: string) {
    await this.safeAsync(async () => this.bgProcessor?.stopEffect?.());
    await this.safeAsync(async () => this.bgProcessor?.dispose?.());
    this.bgProcessor = null;
    this.bgProcessedStream = null;
    this.safe(() => console.debug("[bg] replaceTrack processor stopped:", reason));
  }

  private async disableBg_replaceTrack(reason: string, keepPrefs: boolean) {
    if (!this.conference || this.disposed) return;

    const base = this.bgBaseVideoTrack;
    const processed = this.bgProcessedTrack;

    if (processed && base && typeof this.conference.replaceTrack === "function") {
      await this.safeAsync(() => this.conference.replaceTrack(processed, base));
    } else if (processed && base) {
      await this.safeAsync(() => this.conference.removeTrack?.(processed));
      await this.safeAsync(() => this.conference.addTrack?.(base));
    }

    if (base) {
      this.localVideoTrack = base;
      if (this.localUserId) {
        const entry = this.tracksByParticipant.get(this.localUserId) || {};
        entry.video = base;
        this.tracksByParticipant.set(this.localUserId, entry);
        this.rebuildParticipantsFromTracks();
        this.emitParticipants();
      }
    }

    if (processed) await this.safeDisposeTrack(processed, `bg:disable:processed:${reason}`);
    this.bgProcessedTrack = null;

    await this.stopReplaceTrackProcessor(`disable:${reason}`);

    if (!keepPrefs) this.bgBaseVideoTrack = null;

    this.bgImplMode = "none";
  }

  private async enableBg_replaceTrack(reason: string) {
    if (!this.conference || this.disposed) return;
    if (this.bgPrefs.mode === "none") return;
    if (!this.localVideoTrack) return;

    // If base stale/disposed -> reset
    if (this.bgBaseVideoTrack) {
      try {
        const ms = await Promise.resolve(this.bgBaseVideoTrack.getOriginalStream?.());
        const vt = ms?.getVideoTracks?.()?.[0];
        if (!vt || vt.readyState === "ended") this.bgBaseVideoTrack = null;
      } catch {
        this.bgBaseVideoTrack = null;
      }
    }
    if (!this.bgBaseVideoTrack) this.bgBaseVideoTrack = this.localVideoTrack;

    if (this.safe(() => this.bgBaseVideoTrack?.isMuted?.() === true, false)) return;

    const factory = await this.loadCanvasBgFactory();
    if (!factory) return;

    const baseTrack = this.bgBaseVideoTrack || this.localVideoTrack;
    const baseStream = (await this.waitBaseStream(baseTrack, 2000)) || null;

    if (!baseStream) {
      this.safe(() => console.warn("[bg] replaceTrack: base stream not ready -> retry soon"));
      setTimeout(() => {
        if (this.disposed) return;
        void this.applyBgNow("retry:base-stream-not-ready");
      }, 200);
      return;
    }

    if (this.bgProcessedTrack) await this.disableBg_replaceTrack("reconfigure", true);

    this.bgApplying = true;
    try {
      const opts = {
        mode: this.bgPrefs.mode,
        imageUrl: this.bgPrefs.imageUrl,
        backgroundType: this.bgPrefs.mode === "blur" ? "blur" : this.bgPrefs.mode === "image" ? "image" : "none",
        virtualSource: this.bgPrefs.imageUrl,
      };

      const processor = factory(opts);
      this.bgProcessor = processor;

      if (!processor || typeof processor.startEffect !== "function") {
        await this.stopReplaceTrackProcessor("invalid-processor");
        return;
      }

      const processedStreamAny = processor.startEffect(baseStream);
      const processedStream = await Promise.resolve(processedStreamAny);

      if (!processedStream || typeof processedStream.getTracks !== "function") {
        await this.stopReplaceTrackProcessor("invalid-processed-stream");
        return;
      }

      this.bgProcessedStream = processedStream;

      const processedJitsiTrack = await this.createJitsiVideoTrackFromStream(processedStream);
      this.bgProcessedTrack = processedJitsiTrack;

      const oldOutgoing = this.localVideoTrack;

      // Update refs BEFORE replace
      this.localVideoTrack = processedJitsiTrack;
      if (this.localUserId) {
        const entry = this.tracksByParticipant.get(this.localUserId) || {};
        entry.video = processedJitsiTrack;
        this.tracksByParticipant.set(this.localUserId, entry);
        this.rebuildParticipantsFromTracks();
        this.emitParticipants();
      }

      if (oldOutgoing && typeof this.conference.replaceTrack === "function") {
        await this.conference.replaceTrack(oldOutgoing, processedJitsiTrack);
      } else if (oldOutgoing) {
        await this.safeAsync(() => this.conference.removeTrack?.(oldOutgoing));
        await this.conference.addTrack(processedJitsiTrack);
      } else {
        await this.conference.addTrack(processedJitsiTrack);
      }

      this.bgImplMode = "replaceTrack";
      this.bgReplaceRetryCount = 0;

      this.safe(() =>
        console.log("[bg] replaceTrack enabled:", reason, {
          base: this.getTrackDbg(this.bgBaseVideoTrack),
          outgoing: this.getTrackDbg(this.localVideoTrack),
        })
      );
    } catch (e) {
      this.safe(() => console.warn("[bg] replaceTrack enable failed:", e));

      await this.safeAsync(() => this.disableBg_replaceTrack("enable-failed", false));
      await this.safeAsync(() => this.ensureLocalVideoTrack());

      this.bgReplaceRetryCount = this.bgReplaceRetryCount + 1;
      if (this.bgReplaceRetryCount <= 3 && this.bgPrefs.mode !== "none") {
        const delay = 250 * this.bgReplaceRetryCount;
        setTimeout(() => {
          if (this.disposed) return;
          void this.enqueueBgOp(`replaceTrack-retry#${this.bgReplaceRetryCount}`, () =>
            this.applyBgNow(`replaceTrack-retry#${this.bgReplaceRetryCount}`)
          );
        }, delay);
      }
    } finally {
      setTimeout(() => (this.bgApplying = false), 250);
    }
  }

  // ========================================================================
  // BG MANAGER — unified apply/clear entrypoints
  // ========================================================================
  private async clearAnyBg(keepPrefs: boolean, reason: string) {
    if (this.bgImplMode === "replaceTrack") {
      await this.disableBg_replaceTrack(reason, keepPrefs);
      return;
    }

    if (this.localVideoTrack) await this.safeAsync(() => this.clearBgEffectOnTrack_setEffect(this.localVideoTrack));
    this.bgImplMode = "none";

    if (!keepPrefs) {
      this.bgBaseVideoTrack = null;
      this.bgProcessedTrack = null;
      this.bgProcessor = null;
      this.bgProcessedStream = null;
    }
  }

  private async clearBgEffectOnTrack(_track: any) {
    if (this.bgPrefs.mode === "none") return;
    await this.clearAnyBg(true, "clearBgEffectOnTrack");
  }

  private canTrySetEffect(track: any) {
    if (!track) return false;
    if (this.bgStrategy === "replaceTrack") return false;
    if (this.effectsCompatibility === "incompatible") return false;
    return typeof track.setEffect === "function";
  }

  private async applyBgNow(reason: string) {
    if (!this.conference || this.disposed) return;

    await this.ensureLocalVideoTrack();

    const track = this.localVideoTrack;
    if (!track) return;

    if (this.bgPrefs.mode === "none") {
      await this.clearAnyBg(false, `applyBgNow:none:${reason}`);
      return;
    }

    if (this.bgImplMode === "replaceTrack") {
      await this.enableBg_replaceTrack(`reapply:${reason}`);
      return;
    }

    if (this.bgStrategy !== "replaceTrack" && this.canTrySetEffect(track)) {
      try {
        await this.applyBgEffectToTrack_setEffect(track);
        if (this.bgPrefs.mode !== "none" && !this.videoEffect) throw new Error("setEffect produced no effect instance");
        this.bgImplMode = "setEffect";
        return;
      } catch {
        // fall through to replaceTrack
      }
    }

    if (this.bgImplMode === "setEffect") await this.safeAsync(() => this.clearBgEffectOnTrack_setEffect(track));

    this.bgBaseVideoTrack = this.bgBaseVideoTrack || this.localVideoTrack;
    this.bgImplMode = "none";

    await this.enableBg_replaceTrack(`fallback:${reason}`);
  }

  private async reapplyBgIfNeeded() {
    if (!this.localVideoTrack) return;
    if (this.bgPrefs.mode === "none") return;
    await this.enqueueBgOp("reapplyBgIfNeeded", () => this.applyBgNow("reapplyBgIfNeeded"));
  }

  public async setBackgroundEffect(opts: { mode: BgMode; imageUrl?: string }) {
    this.safe(() => console.debug("[bg] setBackgroundEffect request:", opts, "track:", this.getTrackDbg(this.localVideoTrack)));

    this.bgPrefs = { mode: opts.mode, imageUrl: opts.imageUrl };
    this.mediaSettings.bgMode = opts.mode;
    this.mediaSettings.bgImageUrl = opts.imageUrl;

    await this.enqueueBgOp("setBackgroundEffect", () => this.applyBgNow("setBackgroundEffect"));

    this.safe(() => {
      if (this.localUserId && this.participants[this.localUserId] && this.localVideoTrack) {
        this.participants[this.localUserId].videoMuted = this.localVideoTrack.isMuted?.() === true;
        this.emitParticipants();
      }
    });
  }

  // ========================================================================
  // LOCAL VIDEO RECOVERY (prevents "camera stuck off")
  // ========================================================================
  private async ensureLocalVideoTrack(): Promise<void> {
    if (this.disposed || !this.JitsiMeetJS || !this.conference) return;

    const needBase = this.bgImplMode === "replaceTrack" && this.bgBaseVideoTrack;
    const baseCandidate = needBase ? this.bgBaseVideoTrack : this.localVideoTrack;

    // candidate alive?
    try {
      const ms = await Promise.resolve(baseCandidate?.getOriginalStream?.());
      const vt = ms?.getVideoTracks?.()?.[0];
      if (baseCandidate && vt && vt.readyState !== "ended") {
        if (!needBase) return;
        // ensure outgoing alive too
        if (this.localVideoTrack) {
          const outMs = await Promise.resolve(this.localVideoTrack.getOriginalStream?.());
          const outVt = outMs?.getVideoTracks?.()?.[0];
          if (outVt && outVt.readyState !== "ended") return;
        }
      }
    } catch { }

    const tracks = await this.JitsiMeetJS.createLocalTracks({
      devices: ["video"],
      constraints: { video: this.mediaSettings.videoInputId ? { deviceId: { exact: this.mediaSettings.videoInputId } } : true },
    });

    const newCamera = tracks.find((t: any) => t.getType?.() === "video");
    if (!newCamera) return;

    if (this.bgImplMode === "replaceTrack") {
      await this.safeAsync(() => this.disableBg_replaceTrack("ensureLocalVideoTrack:recreate", true));

      await this.safeAsync(() => this.replaceOrAddLocalTrack("video", newCamera, "ensureLocalVideoTrack:replaceTrack"));

      const oldBase = this.bgBaseVideoTrack;
      const oldOutgoing = this.localVideoTrack;

      this.localVideoTrack = newCamera;
      this.bgBaseVideoTrack = newCamera;

      if (this.localUserId) {
        const entry = this.tracksByParticipant.get(this.localUserId) || {};
        entry.video = newCamera;
        this.tracksByParticipant.set(this.localUserId, entry);
        this.rebuildParticipantsFromTracks();
        this.emitParticipants();
      }

      if (oldOutgoing && oldOutgoing !== newCamera && oldOutgoing !== oldBase) await this.safeDisposeTrack(oldOutgoing, "ensureLocalVideoTrack:oldOutgoing");
      if (oldBase && oldBase !== newCamera && oldBase !== oldOutgoing) await this.safeDisposeTrack(oldBase, "ensureLocalVideoTrack:oldBase");

      await this.applyBgNow("ensureLocalVideoTrack:re-enable");
      return;
    }

    // non-replaceTrack
    const oldVideo = this.localVideoTrack;

    if (oldVideo) {
      await this.safeAsync(() => this.waitEffectIdle(oldVideo));
      await this.safeAsync(() => this.clearBgEffectOnTrack_setEffect(oldVideo));

      if (typeof this.conference.replaceTrack === "function") {
        await this.conference.replaceTrack(oldVideo, newCamera);
        await this.safeDisposeTrack(oldVideo, "ensureLocalVideoTrack:oldVideo");
      } else {
        await this.safeAsync(() => this.conference.removeTrack?.(oldVideo));
        await this.safeDisposeTrack(oldVideo, "ensureLocalVideoTrack:oldVideo");
        await this.conference.addTrack(newCamera);
      }
    } else {
      await this.replaceOrAddLocalTrack("video", newCamera, "ensureLocalVideoTrack:no-oldVideo");
    }

    this.localVideoTrack = newCamera;

    if (this.localUserId) {
      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      entry.video = newCamera;
      this.tracksByParticipant.set(this.localUserId, entry);

      this.rebuildParticipantsFromTracks();
      const p = this.participants[this.localUserId];
      if (p) p.videoMuted = newCamera?.isMuted?.() === true;
      this.emitParticipants();
    }

    this.refreshEffectsSupport(newCamera);
    await this.reapplyBgIfNeeded();
  }

  // ========================================================================
  // ✅ HARD TOGGLE LOCAL VIDEO
  // ========================================================================
  private async disableLocalVideoHard(reason: string) {
    if (this.disposed || !this.conference || !this.localUserId) return;

    await this.waitBgIdle();

    let track = this.localVideoTrack;
    const confExisting = this.getConferenceLocalTrack("video");
    if (!track && confExisting) track = confExisting;

    if (!track) {
      const p = this.participants[this.localUserId];
      if (p) {
        p.videoMuted = true;
        this.emitParticipants();
      }
      return;
    }

    try {
      await this.safeAsync(() => this.waitEffectIdle(track));

      await this.safeAsync(() => this.clearBgEffectOnTrack(track));

      const nowConfVideo = this.getConferenceLocalTrack("video");
      if (nowConfVideo) track = nowConfVideo;
      else if (this.localVideoTrack) track = this.localVideoTrack;

      await this.safeAsync(() => this.conference.removeTrack?.(track));
      await this.safeDisposeTrack(track, `disableLocalVideoHard:${reason}`);

      this.localVideoTrack = null;
      this.bgBaseVideoTrack = null;
      this.bgProcessedTrack = null;
      this.bgProcessedStream = null;
      this.bgProcessor = null;
      this.bgImplMode = "none";
      this.videoEffect = undefined;

      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      if (entry.video) delete entry.video;
      this.tracksByParticipant.set(this.localUserId, entry);

      this.rebuildParticipantsFromTracks();

      const p = this.participants[this.localUserId];
      if (p) p.videoMuted = true;

      this.emitParticipants();

      this.scheduleApplyVideoSubscriptions(0, false);
      this.scheduleHealthTickSoon();
    } catch (e) {
      this.safe(() => console.warn("[cam] disableLocalVideoHard failed:", e));
    }
  }

  private async enableLocalVideoHard(reason: string) {
    if (this.disposed || !this.JitsiMeetJS || !this.conference || !this.localUserId) return;

    try {
      const tracks = await this.JitsiMeetJS.createLocalTracks({
        devices: ["video"],
        constraints: {
          video: this.mediaSettings.videoInputId
            ? { deviceId: { exact: this.mediaSettings.videoInputId } }
            : { height: { ideal: 720, max: 720 }, width: { ideal: 1280, max: 1280 }, frameRate: { ideal: 30, max: 30 } },
        },
      });

      const newVideo = tracks.find((t: any) => t.getType?.() === "video");
      if (!newVideo) return;

      await this.replaceOrAddLocalTrack("video", newVideo, `enableLocalVideoHard:${reason}`);

      this.bgBaseVideoTrack = null;
      this.bgProcessedTrack = null;
      this.bgProcessedStream = null;
      this.bgProcessor = null;
      this.bgImplMode = "none";
      this.videoEffect = undefined;

      this.localVideoTrack = newVideo;

      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      entry.video = newVideo;
      this.tracksByParticipant.set(this.localUserId, entry);

      this.refreshEffectsSupport(newVideo);

      setTimeout(() => {
        if (this.disposed) return;
        if (this.camToggling) return;
        void this.reapplyBgIfNeeded();
      }, 0);

      this.rebuildParticipantsFromTracks();

      const p = this.participants[this.localUserId];
      if (p) p.videoMuted = newVideo.isMuted?.() === true ? true : false;

      this.emitParticipants();

      this.scheduleApplyVideoSubscriptions(0, false);
      this.scheduleHealthTickSoon();
    } catch (e) {
      this.safe(() => console.warn("[cam] enableLocalVideoHard failed:", e));
      this.callbacks.onError?.("Failed to enable camera");
    }
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

    if (!videoChanged && !audioChanged) return { audio: this.localAudioTrack, video: this.localVideoTrack };

    if (videoChanged && this.bgImplMode === "replaceTrack" && this.bgPrefs.mode !== "none") {
      await this.safeAsync(() => this.disableBg_replaceTrack("applyInputDevices:pre-video-switch", true));
    }

    if (audioChanged) {
      await this.safeAsync(async () => {
        if (this.localAudioTrack && typeof this.localAudioTrack.setDevice === "function") {
          await this.localAudioTrack.setDevice(audioInputId);
        }
      });
    }

    if (videoChanged) {
      const ok = await this.safeAsync(async () => {
        if (this.localVideoTrack && typeof this.localVideoTrack.setDevice === "function") {
          if (this.bgImplMode === "setEffect" && this.bgPrefs.mode !== "none") {
            await this.clearBgEffectOnTrack_setEffect(this.localVideoTrack);
          }
          await this.localVideoTrack.setDevice(videoInputId);
          setTimeout(() => void this.applyBgNow("applyInputDevices:post-setDevice"), 0);
          return true;
        }
        return false;
      }, false);

      if (ok) return { audio: this.localAudioTrack, video: this.localVideoTrack };
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
        await this.replaceOrAddLocalTrack("audio", newAudio, "applyInputDevices:audio");
        this.localAudioTrack = newAudio;
      }

      if (newVideo) {
        if (this.bgPrefs.mode !== "none") await this.clearAnyBg(true, "applyInputDevices:pre-video-replace");
        await this.replaceOrAddLocalTrack("video", newVideo, "applyInputDevices:video");
        this.localVideoTrack = newVideo;
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
    void this.loadCanvasBgFactory();
    await this.applyBgNow("applyInputDevices:final");

    return { audio: this.localAudioTrack, video: this.localVideoTrack };
  }

  // ========================================================================
  // PUBLIC API
  // ========================================================================
  async initAndJoin(roomName: string, userName: string): Promise<void> {
    await loadJitsiScripts();

    this.lastJoinRoomName = roomName;
    this.lastJoinUserName = userName;

    this.JitsiMeetJS = window.JitsiMeetJS;
    this.config = window.config;

    if (!this.JitsiMeetJS || !this.config) throw new Error("Jitsi globals not available");

    this.safe(() => {
      const lvl = this.JitsiMeetJS?.logLevels?.ERROR;
      if (typeof lvl !== "undefined") this.JitsiMeetJS.setLogLevel(lvl);
    });

    this.JitsiMeetJS.init({ disableP2P: true, disableAudioLevels: true });

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

  // ✅ HARD toggle video (remove/add)
  async toggleVideoMute(): Promise<void> {
    return this.enqueueCamOp("toggleVideoMute", async () => {
      if (!this.localUserId) return;
      const local = this.participants[this.localUserId];
      if (!local) return;

      await this.waitBgIdle();

      this.camToggling = true;
      try {
        const confTrack = this.getConferenceLocalTrack("video");
        const hasVideoInConf = !!confTrack;
        const hasVideoInEngine = !!this.localVideoTrack;

        this.safe(() =>
          console.debug(
            "[cam] toggleVideoMute(HARD) request. engineTrack:",
            this.getTrackDbg(this.localVideoTrack),
            "confHasVideo:",
            hasVideoInConf,
            "bgPrefs:",
            this.bgPrefs,
            "bgImpl:",
            this.bgImplMode
          )
        );

        if (hasVideoInEngine || hasVideoInConf) {
          await this.disableLocalVideoHard("toggleVideoMute");
          local.videoMuted = true;
          this.emitParticipants();
          return;
        }

        await this.enableLocalVideoHard("toggleVideoMute");

        try {
          const t = this.localVideoTrack;
          local.videoMuted = t ? t.isMuted?.() === true : true;
        } catch {
          local.videoMuted = false;
        }
        this.emitParticipants();
      } catch (e) {
        this.safe(() => console.warn("[cam] toggleVideoMute(HARD) failed:", e));
      } finally {
        this.camToggling = false;
        this.scheduleApplyVideoSubscriptions(0, false);
        this.scheduleHealthTickSoon();
      }
    });
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
        tracks.find((t: any) => this.isDesktopTrack(t)) || tracks.find((t: any) => t.getType && t.getType() === "desktop");

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

    this.clearTO("subsApply");
    this.clearTO("subsHard");
    this.clearIV("subsWatch");
    this.clearTO("postJoinHeal");
    this.clearTO("resumeRecover");
    this.clearTO("healthSoon");
    this.clearIV("health");
    this.clearTO("applySubsSoon");

    try {
      (this as any).__resumeRemovers?.();
    } catch { }
    (this as any).__resumeRemovers = null;
    this.resumeHandlersAttached = false;

    this.stopVideoHealthMonitor();

    await this.safeAsync(() => this.clearAnyBg(false, "dispose"));

    // screenshare
    await this.safeAsync(async () => {
      if (this.localScreenshareTrack) {
        await this.safeAsync(() => this.conference?.removeTrack?.(this.localScreenshareTrack));
        await this.safeDisposeTrack(this.localScreenshareTrack, "dispose:screen");
        this.localScreenshareTrack = null;
      }
    });

    // audio
    await this.safeAsync(async () => {
      if (this.localAudioTrack) {
        await this.safeAsync(() => this.conference?.removeTrack?.(this.localAudioTrack));
        await this.safeDisposeTrack(this.localAudioTrack, "dispose:audio");
        this.localAudioTrack = null;
      }
    });

    // video outgoing + base (if different)
    await this.safeAsync(async () => {
      const outgoing = this.localVideoTrack;
      if (outgoing) {
        await this.safeAsync(() => this.conference?.removeTrack?.(outgoing));
        await this.safeDisposeTrack(outgoing, "dispose:video:outgoing");
      }

      const base = this.bgBaseVideoTrack;
      if (base && base !== outgoing) await this.safeDisposeTrack(base, "dispose:video:base");

      this.localVideoTrack = null;
      this.bgBaseVideoTrack = null;
      this.bgProcessedTrack = null;
    });

    this.tracksByParticipant.clear();
    this.participants = {};
    this.emitParticipants();

    await this.safeAsync(() => this.conference?.leave?.());
    await this.safeAsync(() => this.connection?.disconnect?.());

    this.conference = null;
    this.connection = null;
    this.localUserId = null;
  }

  // ========================================================================
  // INTERNAL — conference setup
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
      this.setTO("applySubsSoon", 80, () => {
        if (this.disposed) return;
        this.scheduleApplyVideoSubscriptions(0, force);
      });
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

      if (userName && typeof anyConf.setDisplayName === "function") anyConf.setDisplayName(userName);

      this.ensureLocalParticipant(userName);
      if (!this.tracksByParticipant.has(localId)) this.tracksByParticipant.set(localId, {});

      this.attachResumeHandlers();

      this.callbacks.onConferenceJoin?.();

      applySubsSoon(true);
      topologyChanged();

      this.setIV("subsWatch", 10000, () => {
        if (this.disposed) return;
        const now = Date.now();
        if (now - this.lastSubsAppliedAt > 9000) this.scheduleApplyVideoSubscriptions(0, false);
      });

      this.startVideoHealthMonitor();
      this.schedulePostJoinSelfHeal();

      setTimeout(() => {
        if (this.disposed) return;
        void this.createLocalTracks();
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

      if (isLocalCameraOrAudio(track)) applySubsSoon(false);
      else {
        applySubsSoon(true);
        topologyChanged();
      }

      this.scheduleHealthTickSoon();
    });

    conf.on(events.conference.TRACK_REMOVED, (track: any) => {
      if (this.disposed) return;
      this.handleTrackRemoved(track);

      if (isLocalCameraOrAudio(track)) applySubsSoon(false);
      else {
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
            : { height: { ideal: 720, max: 720 }, width: { ideal: 1280, max: 1280 }, frameRate: { ideal: 30, max: 30 } },
        },
      });

      for (const t of tracks) {
        const type = t.getType?.();
        if (type === "video") await this.replaceOrAddLocalTrack("video", t, "createLocalTracks");
        else if (type === "audio") await this.replaceOrAddLocalTrack("audio", t, "createLocalTracks");
        else await this.conference.addTrack(t);

        if (type === "audio") this.localAudioTrack = t;
        if (type === "video") this.localVideoTrack = t;
      }

      this.refreshEffectsSupport(this.localVideoTrack);
      void this.loadCanvasBgFactory();

      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      if (this.localAudioTrack) entry.audio = this.localAudioTrack;
      if (this.localVideoTrack) entry.video = this.localVideoTrack;
      this.tracksByParticipant.set(this.localUserId, entry);

      await this.enqueueBgOp("createLocalTracks", () => this.applyBgNow("createLocalTracks"));

      this.schedulePostJoinSelfHeal();

      this.rebuildParticipantsFromTracks();
      this.emitParticipants();

      this.scheduleApplyVideoSubscriptions(0, true);
      this.scheduleHardResetSubscriptions(4500);
      this.scheduleHealthTickSoon();
    } catch (e) {
      this.safe(() => console.error("createLocalTracks error", e));
      this.callbacks.onError?.("Failed to access camera/microphone");
    }
  }

  // ========================================================================
  // VIDEO SUBSCRIPTIONS (stable)
  // ========================================================================
  private scheduleApplyVideoSubscriptions(delayMs: number = 150, force: boolean = false) {
    if (!this.conference || this.disposed) return;
    this.setTO("subsApply", delayMs, () => {
      if (this.disposed) return;
      this.applyVideoSubscriptions(force);
    });
  }

  private scheduleHardResetSubscriptions(delayMs: number = 4500) {
    if (!this.conference || this.disposed) return;
    this.setTO("subsHard", delayMs, () => {
      if (this.disposed) return;
      this.hardResetAndApplyVideoSubscriptions();
    });
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

      this.safe(() => this.conference.selectParticipants?.([]));
      this.safe(() => this.conference.setLastN?.(0));

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
      this.safe(() => this.conference.sendEndpointMessage(id, ev));
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

        if (!this.camToggling && !this.bgApplying && this.bgImplMode !== "replaceTrack") void this.reapplyBgIfNeeded();
      }
      if (isLocal && type === "audio") this.localAudioTrack = track;
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
        if (this.bgImplMode === "setEffect") void this.clearBgEffectOnTrack_setEffect(track);
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
        if (!(pid === this.localUserId && this.bgApplying)) p.videoMuted = track.isMuted ? track.isMuted() : p.videoMuted;

        if (pid === this.localUserId) {
          const nowMuted = this.safe(() => track.isMuted?.() === true, false);
          if (!nowMuted && !this.camToggling) {
            void this.enqueueBgOp("TRACK_MUTE_CHANGED:unmuted", () => this.applyBgNow("TRACK_MUTE_CHANGED:unmuted"));
          }
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

    await this.safeAsync(() => this.conference.removeTrack(this.localScreenshareTrack));
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
    if (payload.kind === "reaction" && payload.reaction) this.callbacks.onReactionReceived?.(senderId, payload.reaction);
  }
}
