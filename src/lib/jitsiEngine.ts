// ============================================================================
// src/lib/jitsiEngine.ts — SFU-only (P2P OFF) + track-based + reactions + SAFE background effects
// Ultra-stable subscriptions: no-op caching + delayed hard reset + cooldown
// ✅ Added: targeted “black video” recovery (reattach per participant + optional subs bump)
// ✅ Added: post-join local A/V self-heal + resume/visibility wake recovery + optional safe rejoin
// ✅ Fixed: do NOT treat local camera/audio track add/remove as topology change (prevents global resub churn on toggleVideo)
//
// ✅ UPDATED (Background effects):
// - BG Manager supports 2 variants:
//   (A) track.setEffect(effect) (native Jitsi VB if present, else vendored)
//   (B) replaceTrack pipeline (Canvas/MediaPipe processor -> createLocalTracksFromMediaStreams -> conference.replaceTrack)
//
// - Strategy: "auto" (default):
//   Prefer (A) if compatible; if any incompatibility/error => fall back to (B).
//
// ✅ PATCH (SAFE stream adapter for startEffect input):
// - Wraps effect.startEffect(...) to always receive a MediaStream
//
// ✅ PATCH (SERIALIZED setEffect + SAFE dispose):
// - All track.setEffect calls go through per-track queue (prevents: "setEffect already in progress!")
// - Dispose waits for pending effect ops on that track
//
// ✅ PATCH #1 (CAM TOGGLE AFTER BLUR FIX):
// - When turning camera OFF and bg is enabled: clear effect BEFORE muting (or swap to base BEFORE muting in replaceTrack mode)
// - When turning camera ON: ensure track, unmute, then re-apply bg
//
// ✅ PATCH #2 (FIRST-CLICK BLUR APPLY FIX):
// - If setEffect path is incompatible (e.g., vendored effect.startEffect is async), THROW to trigger fallback to replaceTrack
// - Do not “silently succeed” by applying PASSTHROUGH and returning (that ate the first click)
//
// ✅ PATCH #3 (FIX "Cannot add second video track"):
// - Hard-toggle camera must never leave a hidden local video track inside the conference.
// - When disabling camera while replaceTrack bg was active, clearAnyBg swaps processed->base,
//   so we must remove/dispose THE CURRENT conference video track (base), not the stale reference (processed).
// - When enabling camera, if conference already has a local video track (even if engine lost ref),
//   we MUST replaceTrack/remove+add instead of addTrack.
// - Also clear stale bgBaseVideoTrack when camera is stopped, so blur re-apply uses the new camera.
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

  // Remember last join args (for safe rejoin after resume / broken states)
  private lastJoinRoomName: string | null = null;
  private lastJoinUserName: string | null = null;
  private lastSafeRejoinAt = 0;

  // ✅ LEAVE/FREEZE RECOVERY (anti “one remote video frozen after someone left”)
  private lastLeaveRecoveryAt = 0;
  private leaveRecoveryTimer: any = null;

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

  // ✅ SOFT RESET SUBS (lightweight bump without long cooldown)
  private softResetTimer: any = null;
  private softResetInFlight = false;
  private softResetCooldownUntil = 0;

  // BG PREFS
  private bgPrefs: { mode: BgMode; imageUrl?: string } = { mode: "none" };
  private bgApplying = false;

  // ✅ BG ops serializer (prevents races: join/apply/click/mute events)
  private bgOpQueue: Promise<void> = Promise.resolve();
  private bgOpSeq = 0;
  // ✅ CAM ops serializer (prevents races with bg queue on hard toggle)
  private camOpQueue: Promise<void> = Promise.resolve();
  private camOpSeq = 0;
  private camToggling = false;

  // Resume / wake recovery
  private resumeHandlersAttached = false;
  private hiddenAt: number | null = null;
  private resumeRecoverTimer: any = null;

  // Post-join local A/V self-heal
  private postJoinHealTimer: any = null;

  private enqueueCamOp(label: string, fn: () => Promise<void>) {
    const id = ++this.camOpSeq;

    this.camOpQueue = this.camOpQueue
      .catch(() => { })
      .then(async () => {
        try {
          console.debug(`[camQ#${id}] BEGIN ${label}`);
        } catch { }
        await fn();
        try {
          console.debug(`[camQ#${id}] END ${label}`);
        } catch { }
      })
      .catch((e) => {
        console.warn(`[camQ#${id}] FAIL ${label}:`, e);
      });

    return this.camOpQueue;
  }

  private async waitBgIdle() {
    try {
      await this.bgOpQueue;
    } catch { }
  }

  private enqueueBgOp(label: string, fn: () => Promise<void>) {
    const id = ++this.bgOpSeq;

    this.bgOpQueue = this.bgOpQueue
      .catch(() => { })
      .then(async () => {
        try {
          console.debug(`[bgQ#${id}] BEGIN ${label}`);
        } catch { }
        await fn();
        try {
          console.debug(`[bgQ#${id}] END ${label}`);
        } catch { }
      })
      .catch((e) => {
        console.warn(`[bgQ#${id}] FAIL ${label}:`, e);
      });

    return this.bgOpQueue;
  }

  // setEffect-based effect object (A)
  private videoEffect: any | undefined = undefined;
  private effectsSupported = false;

  // Effects compatibility (don’t spam logs)
  private effectsCompatibility: "unknown" | "ok" | "incompatible" = "unknown";
  private effectsIncompatReason: string | null = null;

  // ========================================================================
  // ✅ BG MANAGER (two variants)
  // ========================================================================
  // Strategy: auto => try setEffect first, else replaceTrack.
  // You can force it if needed.
  private bgStrategy: "auto" | "setEffect" | "replaceTrack" = "auto";

  /**
   * Optional: allow forcing strategy from UI/debug
   */
  public setBackgroundStrategy(strategy: "auto" | "setEffect" | "replaceTrack") {
    this.bgStrategy = strategy;
    try {
      console.log("[bg] strategy set to:", strategy);
    } catch { }
    // if bg is enabled — reapply under new strategy
    if (this.bgPrefs.mode !== "none") {
      void this.enqueueBgOp("setBackgroundStrategy", () => this.applyBgNow("setBackgroundStrategy"));
    }
  }

  // ReplaceTrack state (B)
  private bgImplMode: "none" | "setEffect" | "replaceTrack" = "none";
  private bgBaseVideoTrack: JitsiTrack | null = null; // raw camera track feeding processor
  private bgProcessedTrack: JitsiTrack | null = null; // outgoing track used in conference when bg enabled
  private bgProcessor: any | null = null; // Canvas/MediaPipe effect instance
  private bgProcessedStream: MediaStream | null = null;
  private bgReplaceRetryCount = 0;

  // Lazy loader for src/lib/backgroundEffect.ts
  private canvasBgFactoryLoaded = false;
  private canvasBgFactory: ((opts: any) => any) | null = null;

  // ========================================================================
  // ✅ EFFECT OPS SERIALIZER + DEBUG (per-track)
  // ========================================================================
  private effectOpSeq = 0;
  private effectQueueByTrack = new WeakMap<any, Promise<void>>();

  // Some lib builds don’t tolerate null/undefined in setEffect — they expect an object with isEnabled().
  // Use a passthrough effect that returns the original stream synchronously.
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

  private markEffectsIncompatible(reason: string) {
    if (this.effectsCompatibility !== "incompatible") {
      this.effectsCompatibility = "incompatible";
      this.effectsIncompatReason = reason;
      try {
        console.warn("[bg] setEffect path marked INCOMPATIBLE:", reason);
      } catch { }
    }
  }

  private markEffectsOk() {
    if (this.effectsCompatibility !== "ok") {
      this.effectsCompatibility = "ok";
      this.effectsIncompatReason = null;
      try {
        console.log("[bg] setEffect path marked OK");
      } catch { }
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
      const attempt = async () => track.setEffect(effect);

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
  // ✅ LOCAL CONFERENCE TRACK HELPERS (prevents "Cannot add second video track")
  // ========================================================================
  private getConferenceLocalVideoTrack(): any | null {
    try {
      const conf = this.conference;
      if (!conf) return null;
      const arr: any[] = conf.getLocalTracks?.() || [];
      const v =
        arr.find((t) => !this.isDesktopTrack(t) && t?.getType?.() === "video") ||
        arr.find((t) => t?.getType?.() === "video") ||
        null;
      return v || null;
    } catch {
      return null;
    }
  }

  private getConferenceLocalAudioTrack(): any | null {
    try {
      const conf = this.conference;
      if (!conf) return null;
      const arr: any[] = conf.getLocalTracks?.() || [];
      const a = arr.find((t) => !this.isDesktopTrack(t) && t?.getType?.() === "audio") || null;
      return a || null;
    } catch {
      return null;
    }
  }

  private async replaceOrAddLocalVideoTrack(newVideo: any, reason: string) {
    if (!this.conference || this.disposed) throw new Error("conference not ready");
    const conf = this.conference;

    const existing = this.getConferenceLocalVideoTrack();

    // If conference already has a local video track, we must replace/remove+add.
    if (existing && existing !== newVideo) {
      try {
        if (typeof conf.replaceTrack === "function") {
          await conf.replaceTrack(existing, newVideo);
        } else {
          try {
            await conf.removeTrack?.(existing);
          } catch { }
          await conf.addTrack(newVideo);
        }
      } finally {
        // Dispose the old track (stops camera capture on old)
        try {
          await this.safeDisposeTrack(existing, `replaceOrAddLocalVideoTrack:${reason}:old`);
        } catch { }
      }
      return;
    }

    // No existing => safe to add
    await conf.addTrack(newVideo);
  }

  private async replaceOrAddLocalAudioTrack(newAudio: any, reason: string) {
    if (!this.conference || this.disposed) throw new Error("conference not ready");
    const conf = this.conference;

    const existing = this.getConferenceLocalAudioTrack();

    if (existing && existing !== newAudio) {
      try {
        if (typeof conf.replaceTrack === "function") {
          await conf.replaceTrack(existing, newAudio);
        } else {
          try {
            await conf.removeTrack?.(existing);
          } catch { }
          await conf.addTrack(newAudio);
        }
      } finally {
        try {
          await this.safeDisposeTrack(existing, `replaceOrAddLocalAudioTrack:${reason}:old`);
        } catch { }
      }
      return;
    }

    await conf.addTrack(newAudio);
  }

  // ========================================================================
  // ✅ TARGETED BLACK-VIDEO RECOVERY
  // ========================================================================
  private videoElByPid = new Map<string, HTMLVideoElement>();
  private screenElByPid = new Map<string, HTMLVideoElement>();

  private videoHealthTimer: any = null;
  private healthSoonTimer: any = null;

  private readonly HEALTH_TICK_MS = 1500;
  private readonly STUCK_THRESHOLD_MS = 1600;

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

  private async reattachAllSubscribedRemoteVideos(reason: string) {
    if (!this.conference || this.disposed) return;

    const { ids: subscribedRemoteIds } = this.getSubscribedRemoteIds();
    if (!subscribedRemoteIds.length) return;

    for (const pid of subscribedRemoteIds) {
      const p = this.participants[pid];
      if (!p || p.isLocal) continue;

      const hasScreen = !!p.screenTrack && this.screenElByPid.has(pid);
      const kind: "video" | "screen" = hasScreen ? "screen" : "video";
      const el = kind === "screen" ? this.screenElByPid.get(pid) : this.videoElByPid.get(pid);
      const track = kind === "screen" ? p.screenTrack : p.videoTrack;
      if (!el || !track) continue;

      try {
        if (typeof track.detach === "function") {
          try { track.detach(el); } catch { }
          try { track.detach(); } catch { }
        }
        await new Promise((r) => setTimeout(r, 30));
        if (typeof track.attach === "function") {
          try { track.attach(el); } catch { }
        }
        try { await el.play().catch(() => { }); } catch { }
      } catch { }
    }

    // после массового reattach можно слегка пнуть подписки (не всегда нужно, но помогает)
    this.scheduleSoftResetSubscriptions(120, `reattachAll:${reason}`);
  }

  private triggerLeaveRecovery(reason: string) {
    if (this.disposed || !this.conference) return;

    const now = Date.now();

    // ✅ анти-спам: USER_LEFT + TRACK_REMOVED могут прийти пачкой
    if (now - this.lastLeaveRecoveryAt < 900) return;
    this.lastLeaveRecoveryAt = now;

    const { ids: subscribedRemoteIds } = this.getSubscribedRemoteIds();
    if (!subscribedRemoteIds.length) return;

    // 1) Мгновенный reattach (дешёво, часто чинит сразу)
    setTimeout(() => {
      if (this.disposed) return;
      void this.reattachAllSubscribedRemoteVideos(`leaveRecovery:now:${reason}`);
    }, 0);

    // 2) Повторный reattach через чуть-чуть (после пересборки потоков/SSRC)
    setTimeout(() => {
      if (this.disposed) return;
      void this.reattachAllSubscribedRemoteVideos(`leaveRecovery:retry:${reason}`);
    }, 420);

    // 3) Soft reset подписок (лёгкий “пинок”)
    this.scheduleSoftResetSubscriptions(120, `leaveRecovery:${reason}`);

    // 4) ВАЖНО: ранний hard reset (не жди 4500ms)
    // scheduleHardResetSubscriptions() сам очистит предыдущий таймер.
    this.scheduleHardResetSubscriptions(1200);

    // 5) Сразу health tick (пусть твой монитор быстрее заметит stuck)
    this.scheduleHealthTickSoon();
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
        try {
          track.detach(el);
        } catch { }
      }
      if (typeof track.detach === "function") {
        try {
          track.detach();
        } catch { }
      }

      try { (el as any).srcObject = null; } catch { }

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
  // ✅ LOCAL A/V SELF-HEAL + RESUME RECOVERY
  // ========================================================================
  private isLocalTrackUsable(track: any, kind: "audio" | "video") {
    if (!track) return false;

    try {
      // If user explicitly muted, we consider it "healthy" (it's intended).
      if (kind === "audio" && this.localUserId && this.participants[this.localUserId]?.audioMuted) return true;
      if (kind === "video" && this.localUserId && this.participants[this.localUserId]?.videoMuted) return true;

      // If track exposes muted state, and it's muted unexpectedly, treat as not-usable only for audio (optional).
      // For stability, we DO NOT force-unmute here.
      const msAny = track.getOriginalStream?.();
      // Some builds return promise; accept both
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      const check = async () => {
        const ms = await Promise.resolve(msAny);
        if (!ms || typeof ms.getTracks !== "function") return false;

        if (kind === "audio") {
          const at = ms.getAudioTracks?.()?.[0];
          if (!at) return false;
          if (at.readyState !== "live") return false;
          if (at.enabled === false) return false;
          return true;
        } else {
          const vt = ms.getVideoTracks?.()?.[0];
          if (!vt) return false;
          if (vt.readyState !== "live") return false;
          if (vt.enabled === false) return false;
          return true;
        }
      };

      // Synchronous fast path: if msAny isn't a Promise and looks like MediaStream
      if (msAny && typeof msAny.then !== "function" && typeof msAny.getTracks === "function") {
        if (kind === "audio") {
          const at = msAny.getAudioTracks?.()?.[0];
          return !!at && at.readyState === "live" && at.enabled !== false;
        } else {
          const vt = msAny.getVideoTracks?.()?.[0];
          return !!vt && vt.readyState === "live" && vt.enabled !== false;
        }
      }

      // Promise path: we can't await here; caller awaits a wrapper method.
      // Return "unknown false" so ensure method can await.
      return false;
    } catch {
      return false;
    }
  }

  private async ensureLocalAudioTrack(): Promise<void> {
    if (this.disposed || !this.JitsiMeetJS || !this.conference || !this.localUserId) return;

    const local = this.participants[this.localUserId];
    // If user muted, don't recreate (it will look like "bug" to user)
    if (local?.audioMuted) return;

    // If we have a usable audio track, stop.
    try {
      if (this.localAudioTrack) {
        const msAny = this.localAudioTrack.getOriginalStream?.();
        const ms = await Promise.resolve(msAny);
        const at = ms?.getAudioTracks?.()?.[0];
        if (at && at.readyState === "live" && at.enabled !== false) return;
      }
    } catch { }

    // If engine lost ref but conference still has it and it's usable: adopt it.
    try {
      const confAudio = this.getConferenceLocalAudioTrack();
      if (confAudio) {
        const msAny = confAudio.getOriginalStream?.();
        const ms = await Promise.resolve(msAny);
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

      // Replace-or-add safely
      await this.replaceOrAddLocalAudioTrack(newAudio, "ensureLocalAudioTrack");

      this.localAudioTrack = newAudio;

      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      entry.audio = newAudio;
      this.tracksByParticipant.set(this.localUserId, entry);

      this.rebuildParticipantsFromTracks();
      this.emitParticipants();
    } catch (e) {
      console.warn("[audio] ensureLocalAudioTrack failed:", e);
    }
  }

  private async resumeAllAudioElements() {
    try {
      const audios = Array.from(document.querySelectorAll("audio")) as HTMLAudioElement[];
      for (const a of audios) {
        try {
          await a.play().catch(() => { });
        } catch { }
      }
    } catch { }
  }

  private schedulePostJoinSelfHeal() {
    if (this.postJoinHealTimer) clearTimeout(this.postJoinHealTimer);
    this.postJoinHealTimer = setTimeout(() => {
      this.postJoinHealTimer = null;
      if (this.disposed) return;
      void this.postJoinSelfHeal();
    }, 2500);
  }

  private async postJoinSelfHeal() {
    // 1) Unlock audio playback if needed (autoplay policies)
    await this.resumeAllAudioElements();

    // 2) Ensure local tracks exist + are alive
    await this.ensureLocalAudioTrack();
    await this.ensureLocalVideoTrack();

    // 3) BG re-apply is already handled by createLocalTracks/ensureLocalVideoTrack
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

      // became visible
      const dt = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
      this.hiddenAt = null;

      // Cheap: unlock audio
      void this.resumeAllAudioElements();

      // If we were hidden long enough, do wake recovery.
      if (dt > 15_000) {
        this.scheduleResumeRecovery("visibility");
      }
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

    // Store removers in closures on the instance (lightweight)
    (this as any).__resumeRemovers = () => {
      try {
        document.removeEventListener("visibilitychange", onVisibility);
      } catch { }
      try {
        window.removeEventListener("focus", onFocus);
      } catch { }
      try {
        window.removeEventListener("online", onOnline);
      } catch { }
      try {
        window.removeEventListener("pageshow", onPageShow);
      } catch { }
    };
  }

  private scheduleResumeRecovery(reason: string) {
    if (this.resumeRecoverTimer) return;
    this.resumeRecoverTimer = setTimeout(() => {
      this.resumeRecoverTimer = null;
      if (this.disposed) return;
      void this.recoverAfterResume(reason);
    }, 250);
  }

  private async recoverAfterResume(reason: string) {
    try {
      console.warn("[resume] recoverAfterResume:", reason);

      // Avoid racing with BG/cam ops
      await this.waitBgIdle().catch(() => { });
      await this.camOpQueue.catch(() => { });

      await this.resumeAllAudioElements();
      await this.ensureLocalAudioTrack();
      await this.ensureLocalVideoTrack();

      // If still looks unhealthy after a short delay, consider safe rejoin.
      setTimeout(() => {
        if (this.disposed) return;
        void this.maybeSafeRejoin(`resume:${reason}`);
      }, 3500);
    } catch (e) {
      console.warn("[resume] recoverAfterResume failed:", e);
      void this.maybeSafeRejoin(`resume:${reason}:exception`);
    }
  }

  private async isConferenceLikelyHealthy(): Promise<boolean> {
    if (!this.conference || this.disposed || !this.localUserId) return false;

    // If user intentionally has both muted, we consider it fine.
    const local = this.participants[this.localUserId];
    const audioWanted = !local?.audioMuted;
    const videoWanted = !local?.videoMuted;

    // If nothing is wanted, it's "healthy" enough.
    if (!audioWanted && !videoWanted) return true;

    // Check local audio
    if (audioWanted) {
      try {
        const t = this.localAudioTrack || this.getConferenceLocalAudioTrack();
        const msAny = t?.getOriginalStream?.();
        const ms = await Promise.resolve(msAny);
        const at = ms?.getAudioTracks?.()?.[0];
        if (!at || at.readyState !== "live" || at.enabled === false) return false;
      } catch {
        return false;
      }
    }

    // Check local video (base when replaceTrack)
    if (videoWanted) {
      try {
        const base = this.bgImplMode === "replaceTrack" ? this.bgBaseVideoTrack : this.localVideoTrack;
        const t = base || this.getConferenceLocalVideoTrack();
        const msAny = t?.getOriginalStream?.();
        const ms = await Promise.resolve(msAny);
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
      console.warn("[rejoin] no join args stored; skip safeRejoin", tag);
      return;
    }

    console.warn("[rejoin] SAFE REJOIN:", tag);

    // Snapshot prefs we want to preserve
    const savedMedia = { ...this.mediaSettings };
    const savedBgPrefs = { ...this.bgPrefs };
    const savedBgStrategy = this.bgStrategy;
    const savedQuality = this.qualityMode;
    const savedSelected = [...(this.selectedVideoIds || [])];

    // Dispose current session
    await this.dispose().catch(() => { });

    // Re-arm engine for new join
    this.disposed = false;

    // Restore preserved state
    this.mediaSettings = savedMedia;
    this.bgPrefs = savedBgPrefs;
    this.bgStrategy = savedBgStrategy;
    this.qualityMode = savedQuality;
    this.selectedVideoIds = savedSelected;

    // Reset some volatile fields
    this.lastSubsKey = "";
    this.lastSubsAppliedAt = 0;
    this.hardResetCooldownUntil = 0;

    // Rejoin
    await this.initAndJoin(room, user);
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

  private isAsyncFunction(fn: any) {
    try {
      return typeof fn === "function" && fn.constructor && fn.constructor.name === "AsyncFunction";
    } catch {
      return false;
    }
  }

  // ========================================================================
  // BG EFFECT (A) — setEffect path
  // ========================================================================

  /**
   * SAFETY WRAPPER:
   * Some lib-jitsi-meet builds call effect.startEffect(...) with NOT a MediaStream.
   * Jitsi effects expect a MediaStream with getTracks().
   */
  private wrapEffectToForceMediaStream(effect: any) {
    if (!effect || typeof effect.startEffect !== "function") return effect;

    // Avoid double-wrapping
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

        if (!s || typeof s.getTracks !== "function") {
          throw new Error("[bg] startEffect received non-MediaStream");
        }

        const out = callOriginal(s);

        if (out && typeof out.then === "function") {
          throw new Error("[bg] startEffect returned Promise; this build expects sync MediaStream");
        }

        return out;
      };

      // Ensure isEnabled exists somewhere (some builds REQUIRE it)
      if (typeof target.isEnabled !== "function") {
        target.isEnabled = (_track?: any) => true;
      }

      return target;
    };

    // 1) Prefer in-place patch (keeps prototype 100%)
    try {
      const original = effect.startEffect.bind(effect);
      (effect as any).__msWrapped = true;
      return makeAdapter(effect, original);
    } catch {
      // 2) Fallback: wrapper with prototype chain preserved
      const wrapped = Object.create(effect);
      const original = effect.startEffect.bind(effect);
      (wrapped as any).__msWrapped = true;
      return makeAdapter(wrapped, original);
    }
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

  private getEffectFactory() {
    const anyJitsi = (window as any).JitsiMeetJS;
    const nativeFactory = anyJitsi?.effects?.createVirtualBackgroundEffect;

    if (typeof nativeFactory === "function") {
      return { kind: "native" as const, factory: nativeFactory };
    }
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

    // If startEffect is async => incompatible for setEffect path (camera toggle issues)
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

    const hasSetEffect = typeof track.setEffect === "function";
    if (hasSetEffect) {
      try {
        await this.safeSetEffect(track, this.PASSTHROUGH_EFFECT, "clear:setEffect");
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

  private async applyBgEffectToTrack_setEffect(track: any) {
    if (!track) return;

    this.refreshEffectsSupport(track);

    if (!this.effectsSupported) {
      console.warn("[bg] setEffect path: track.setEffect missing");
      throw new Error("setEffect not supported");
    }

    const wasMuted = (() => {
      try {
        return track.isMuted?.() === true;
      } catch {
        return false;
      }
    })();
    if (wasMuted) return;

    if (this.effectsCompatibility === "incompatible") {
      throw new Error(`setEffect incompatible: ${this.effectsIncompatReason || "unknown"}`);
    }

    try {
      const msAny = track.getOriginalStream?.();
      const ms = await Promise.resolve(msAny);
      if (!ms || typeof ms.getTracks !== "function") {
        console.warn("[bg] track original stream not ready; skip applying setEffect");
        return;
      }
    } catch { }

    if (this.bgPrefs.mode === "none") {
      await this.clearBgEffectOnTrack_setEffect(track);
      return;
    }

    await this.clearBgEffectOnTrack_setEffect(track);

    const vb = this.buildVirtualBackgroundOptions();
    if (!vb) {
      console.warn("[bg] invalid vb options (missing imageUrl?)");
      return;
    }

    this.bgApplying = true;
    try {
      console.debug("[bg] setEffect apply request:", this.bgPrefs, "track:", this.getTrackDbg(track));

      let effect = await this.createEffectObject(vb);
      if (!effect) {
        // ✅ PATCH #2: force fallback to replaceTrack on this same click
        throw new Error(`setEffect unavailable: ${this.effectsIncompatReason || "no effect"}`);
      }

      // Debug “isEnabled is not a function” root cause
      try {
        const dbg = {
          ctor: effect?.constructor?.name,
          keys: effect ? Object.keys(effect) : null,
          isEnabled: typeof effect?.isEnabled,
          startEffect: typeof effect?.startEffect,
          stopEffect: typeof effect?.stopEffect,
          dispose: typeof effect?.dispose,
        };
        console.debug("[bg] effect object before wrap", dbg, effect);
      } catch { }

      effect = this.wrapEffectToForceMediaStream(effect);

      try {
        if (typeof effect.isSupported === "function") {
          const ok = effect.isSupported(track);
          if (!ok) {
            console.warn("[bg] effect.isSupported returned false");
            throw new Error("setEffect isSupported=false");
          }
        }
      } catch { }

      try {
        if (typeof effect.isEnabled === "function") {
          const ok = effect.isEnabled(track);
          if (!ok) {
            console.warn("[bg] effect.isEnabled returned false");
            throw new Error("setEffect isEnabled=false");
          }
        }
      } catch { }

      await this.safeSetEffect(track, effect, `apply:setEffect:${this.bgPrefs.mode}`);
      this.videoEffect = effect;

      try {
        const nowMuted = track.isMuted?.() === true;
        if (!wasMuted && nowMuted && typeof track.unmute === "function") {
          await track.unmute();
        }
      } catch { }
    } catch (e) {
      console.warn("[bg] setEffect apply failed:", e);
      try {
        await this.safeSetEffect(track, this.PASSTHROUGH_EFFECT, "apply:setEffect:fail-clear");
      } catch { }
      try {
        await this.videoEffect?.dispose?.();
      } catch { }
      try {
        await (this.videoEffect as any)?.stopEffect?.();
      } catch { }
      this.videoEffect = undefined;

      // mark incompatible so auto strategy will fall back to replaceTrack
      this.markEffectsIncompatible(`setEffect apply failed: ${String((e as any)?.message || e || "")}`);
      throw e;
    } finally {
      setTimeout(() => {
        this.bgApplying = false;
      }, 250);
    }
  }

  // ========================================================================
  // BG EFFECT (B) — replaceTrack path (Canvas/MediaPipe pipeline)
  // ========================================================================
  private async loadCanvasBgFactory(): Promise<((opts: any) => any) | null> {
    if (this.canvasBgFactoryLoaded) return this.canvasBgFactory;
    this.canvasBgFactoryLoaded = true;

    try {
      // expected: src/lib/backgroundEffect.ts exports createBackgroundEffect(opts)
      const mod: any = await import("./backgroundEffect");
      const fn = mod?.createBackgroundEffect || mod?.createCanvasVirtualBgEffect || mod?.default || null;

      if (typeof fn !== "function") {
        console.warn("[bg] backgroundEffect module loaded but no factory function export found");
        this.canvasBgFactory = null;
        return null;
      }

      this.canvasBgFactory = fn;
      return fn;
    } catch (e) {
      console.warn("[bg] Failed to load ./backgroundEffect:", e);
      this.canvasBgFactory = null;
      return null;
    }
  }

  private async getBaseVideoStreamForBg(): Promise<MediaStream | null> {
    const base = this.bgBaseVideoTrack || this.localVideoTrack;
    if (!base) return null;

    try {
      const msAny = base.getOriginalStream?.();
      const ms = await Promise.resolve(msAny);
      if (!ms || typeof ms.getTracks !== "function") return null;
      return ms as MediaStream;
    } catch {
      return null;
    }
  }

  private async waitBaseStream(track: any, timeoutMs = 2000): Promise<MediaStream | null> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        const msAny = track?.getOriginalStream?.();
        const ms = await Promise.resolve(msAny);
        const vt = ms?.getVideoTracks?.()?.[0];
        if (ms && vt && vt.readyState !== "ended") return ms as MediaStream;
      } catch { }
      await new Promise((r) => setTimeout(r, 60));
    }
    return null;
  }

  private async createJitsiVideoTrackFromStream(stream: MediaStream): Promise<JitsiTrack> {
    const J = this.JitsiMeetJS;
    if (!J) throw new Error("JitsiMeetJS not ready");

    const vt = stream.getVideoTracks?.()?.[0];
    if (!vt) throw new Error("processed stream has no video track");

    if (typeof J.createLocalTracksFromMediaStreams === "function") {
      const infos = [
        {
          mediaType: "video",
          sourceType: "external",
          stream,
          track: vt,
          videoType: "camera",
        },
      ];

      const created = await J.createLocalTracksFromMediaStreams(infos);
      const t = (created || []).find((x: any) => x?.getType?.() === "video") || (created || [])[0];
      if (!t) throw new Error("createLocalTracksFromMediaStreams returned empty");
      return t;
    }

    throw new Error("createLocalTracksFromMediaStreams not available in this build");
  }

  private async stopReplaceTrackProcessor(reason: string) {
    try {
      await this.bgProcessor?.stopEffect?.();
    } catch { }
    try {
      await this.bgProcessor?.dispose?.();
    } catch { }
    this.bgProcessor = null;

    this.bgProcessedStream = null;

    // processed Jitsi track (outgoing) is disposed separately by caller
    try {
      console.debug("[bg] replaceTrack processor stopped:", reason);
    } catch { }
  }

  private async disableBg_replaceTrack(reason: string, keepPrefs: boolean) {
    if (!this.conference || this.disposed) return;

    const base = this.bgBaseVideoTrack;
    const processed = this.bgProcessedTrack;

    if (processed && base && typeof this.conference.replaceTrack === "function") {
      try {
        // switch outgoing back to base
        await this.conference.replaceTrack(processed, base);
      } catch (e) {
        console.warn("[bg] replaceTrack disable replaceTrack(processed->base) failed:", e);
      }
    } else if (processed && base) {
      // fallback path if replaceTrack missing
      try {
        await this.conference.removeTrack?.(processed);
      } catch { }
      try {
        await this.conference.addTrack?.(base);
      } catch { }
    }

    // Update refs: outgoing becomes base again
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

    // Dispose processed track + processor
    if (processed) {
      try {
        await this.safeDisposeTrack(processed, `bg:disable:processed:${reason}`);
      } catch { }
    }
    this.bgProcessedTrack = null;

    await this.stopReplaceTrackProcessor(`disable:${reason}`);

    // Decide whether to keep base track pointer
    if (!keepPrefs) {
      this.bgBaseVideoTrack = null;
    }

    if (!keepPrefs) {
      // also clear setEffect state if it existed
      this.videoEffect = undefined;
      this.effectsCompatibility = this.effectsCompatibility; // no-op, just explicit
    }

    this.bgImplMode = "none";
  }

  private async enableBg_replaceTrack(reason: string) {
    if (!this.conference || this.disposed) return;

    if (this.bgPrefs.mode === "none") return;

    // Ensure base video track exists and is a real camera track
    if (!this.localVideoTrack) return;

    // Base track is the raw camera feeding the processor
    // ✅ PATCH #3: if bgBaseVideoTrack is stale/disposed, reset it so we bind to the NEW camera
    if (this.bgBaseVideoTrack) {
      try {
        const msAny = this.bgBaseVideoTrack?.getOriginalStream?.();
        const ms = await Promise.resolve(msAny);
        const vt = ms?.getVideoTracks?.()?.[0];
        if (!vt || vt.readyState === "ended") {
          this.bgBaseVideoTrack = null;
        }
      } catch {
        this.bgBaseVideoTrack = null;
      }
    }
    if (!this.bgBaseVideoTrack) {
      this.bgBaseVideoTrack = this.localVideoTrack;
    }

    // Don’t apply if muted
    try {
      if (this.bgBaseVideoTrack?.isMuted?.() === true) return;
    } catch { }

    // Build processor instance
    const factory = await this.loadCanvasBgFactory();
    if (!factory) {
      console.warn("[bg] replaceTrack path unavailable: no backgroundEffect factory");
      return;
    }

    // Get base stream
    const baseTrack = this.bgBaseVideoTrack || this.localVideoTrack;
    const baseStream = (await this.waitBaseStream(baseTrack, 2000)) || (await this.getBaseVideoStreamForBg());
    if (!baseStream) {
      console.warn("[bg] replaceTrack: base stream not ready -> retry soon");
      setTimeout(() => {
        if (this.disposed) return;
        void this.applyBgNow("retry:base-stream-not-ready");
      }, 200);
      return;
    }

    // Stop previous processor/processed track if any (reconfigure)
    if (this.bgProcessedTrack) {
      await this.disableBg_replaceTrack("reconfigure", true);
    }

    // Create processor and processed stream (can be async safely here)
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
        console.warn("[bg] replaceTrack: factory returned invalid processor");
        await this.stopReplaceTrackProcessor("invalid-processor");
        return;
      }

      const processedStreamAny = processor.startEffect(baseStream);
      const processedStream = await Promise.resolve(processedStreamAny);

      if (!processedStream || typeof processedStream.getTracks !== "function") {
        console.warn("[bg] replaceTrack: processor returned invalid processed stream");
        await this.stopReplaceTrackProcessor("invalid-processed-stream");
        return;
      }

      this.bgProcessedStream = processedStream;

      // Create outgoing Jitsi track from processed stream
      const processedJitsiTrack = await this.createJitsiVideoTrackFromStream(processedStream);
      this.bgProcessedTrack = processedJitsiTrack;

      // Replace outgoing track in conference:
      const oldOutgoing = this.localVideoTrack;

      // Update local refs before replace to avoid TRACK_REMOVED handler nulling us
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
        try {
          await this.conference.removeTrack?.(oldOutgoing);
        } catch { }
        await this.conference.addTrack(processedJitsiTrack);
      } else {
        await this.conference.addTrack(processedJitsiTrack);
      }

      // Keep base track alive (not disposed) because it feeds processor
      this.bgImplMode = "replaceTrack";
      this.bgReplaceRetryCount = 0;

      try {
        console.log("[bg] replaceTrack enabled:", reason, {
          base: this.getTrackDbg(this.bgBaseVideoTrack),
          outgoing: this.getTrackDbg(this.localVideoTrack),
        });
      } catch { }
    } catch (e) {
      console.warn("[bg] replaceTrack enable failed:", e);

      // revert to base on failure
      try {
        await this.disableBg_replaceTrack("enable-failed", false);
      } catch { }

      // keep localVideoTrack safe: if we lost it, attempt ensure
      try {
        await this.ensureLocalVideoTrack();
      } catch { }

      // ✅ Auto-retry a few times (so user doesn't need 2-3 clicks)
      this.bgReplaceRetryCount = this.bgReplaceRetryCount + 1;
      if (this.bgReplaceRetryCount <= 3 && this.bgPrefs.mode !== "none") {
        const delay = 250 * this.bgReplaceRetryCount; // 250ms, 500ms, 750ms
        setTimeout(() => {
          if (this.disposed) return;
          void this.enqueueBgOp(`replaceTrack-retry#${this.bgReplaceRetryCount}`, () =>
            this.applyBgNow(`replaceTrack-retry#${this.bgReplaceRetryCount}`)
          );
        }, delay);
      }
    } finally {
      setTimeout(() => {
        this.bgApplying = false;
      }, 250);
    }
  }

  // ========================================================================
  // BG MANAGER — unified apply/clear entrypoints
  // ========================================================================
  private async clearAnyBg(keepPrefs: boolean, reason: string) {
    // Clear replaceTrack mode first (if active)
    if (this.bgImplMode === "replaceTrack") {
      await this.disableBg_replaceTrack(reason, keepPrefs);
      return;
    }

    // Clear setEffect mode if active or if track has setEffect
    if (this.localVideoTrack) {
      try {
        await this.clearBgEffectOnTrack_setEffect(this.localVideoTrack);
      } catch { }
    }

    this.bgImplMode = "none";

    if (!keepPrefs) {
      this.bgBaseVideoTrack = null;
      this.bgProcessedTrack = null;
      this.bgProcessor = null;
      this.bgProcessedStream = null;
    }
  }

  // Small helper (keeps TS happy + used by hard-toggle path)
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

    // User wants no bg
    if (this.bgPrefs.mode === "none") {
      await this.clearAnyBg(false, `applyBgNow:none:${reason}`);
      return;
    }

    // If we are already in replaceTrack mode, just reconfigure/ensure it
    if (this.bgImplMode === "replaceTrack") {
      await this.enableBg_replaceTrack(`reapply:${reason}`);
      return;
    }

    // Strategy "setEffect" or auto: try setEffect first if possible
    if (this.bgStrategy !== "replaceTrack" && this.canTrySetEffect(track)) {
      try {
        await this.applyBgEffectToTrack_setEffect(track);

        // ✅ PATCH #2: if we didn't end up with a real effect instance — treat as failure
        if (this.bgPrefs.mode !== "none" && !this.videoEffect) {
          throw new Error("setEffect produced no effect instance");
        }

        this.bgImplMode = "setEffect";
        return;
      } catch {
        // fall through to replaceTrack
      }
    }

    // Switch from setEffect -> replaceTrack
    if (this.bgImplMode === "setEffect") {
      try {
        await this.clearBgEffectOnTrack_setEffect(track);
      } catch { }
    }

    // ReplaceTrack enable expects base camera track
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
  console.debug("[bg] setBackgroundEffect request:", opts, "track:", this.getTrackDbg(this.localVideoTrack));

  this.bgPrefs = { mode: opts.mode, imageUrl: opts.imageUrl };
  this.mediaSettings.bgMode = opts.mode;
  this.mediaSettings.bgImageUrl = opts.imageUrl;

  await this.enqueueBgOp("setBackgroundEffect", () => this.applyBgNow("setBackgroundEffect"));

  try {
    if (this.localUserId && this.participants[this.localUserId] && this.localVideoTrack) {
      this.participants[this.localUserId].videoMuted = this.localVideoTrack.isMuted?.() === true;
      this.emitParticipants();
    }
  } catch { }
}

  // ========================================================================
  // LOCAL VIDEO RECOVERY (prevents "camera stuck off")
  // ========================================================================
  private async ensureLocalVideoTrack(): Promise < void> {
  if(this.disposed || !this.JitsiMeetJS || !this.conference) return;
  // ✅ DO NOT resurrect camera if user intentionally turned it off
  try {
    if(this.localUserId && this.participants[this.localUserId]?.videoMuted) {
  return;
}
    } catch { }

// If we're in replaceTrack mode, the outgoing track is processed and base track is the camera.
const needBase = this.bgImplMode === "replaceTrack" && this.bgBaseVideoTrack;
const baseCandidate = needBase ? this.bgBaseVideoTrack : this.localVideoTrack;

// If candidate exists and looks alive, we may be done.
try {
  const msAny = baseCandidate?.getOriginalStream?.();
  const ms = await Promise.resolve(msAny);
  const vt = ms?.getVideoTracks?.()?.[0];
  if (baseCandidate && vt && vt.readyState !== "ended") {
    if (!needBase) return;

    // ensure outgoing exists too
    if (this.localVideoTrack) {
      try {
        const outMsAny = this.localVideoTrack?.getOriginalStream?.();
        const outMs = await Promise.resolve(outMsAny);
        const outVt = outMs?.getVideoTracks?.()?.[0];
        if (outVt && outVt.readyState !== "ended") return;
      } catch {
        // continue to recreate outgoing below
      }
    }
  }
} catch {
  // continue to recreate
}

const tracks = await this.JitsiMeetJS.createLocalTracks({
  devices: ["video"],
  constraints: {
    video: this.mediaSettings.videoInputId ? { deviceId: { exact: this.mediaSettings.videoInputId } } : true,
  },
});

const newCamera = tracks.find((t: any) => t.getType?.() === "video");
if (!newCamera) return;

if (this.bgImplMode === "replaceTrack") {
  // We are in BG mode but the base/outgoing is broken: rebuild safely.
  try {
    await this.disableBg_replaceTrack("ensureLocalVideoTrack:recreate", true);
  } catch { }

  // ✅ PATCH #3: never add second local video track
  try {
    await this.replaceOrAddLocalVideoTrack(newCamera, "ensureLocalVideoTrack:replaceTrack");
  } catch { }

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

  if (oldOutgoing && oldOutgoing !== newCamera && oldOutgoing !== oldBase) {
    await this.safeDisposeTrack(oldOutgoing, "ensureLocalVideoTrack:oldOutgoing");
  }
  if (oldBase && oldBase !== newCamera && oldBase !== oldOutgoing) {
    await this.safeDisposeTrack(oldBase, "ensureLocalVideoTrack:oldBase");
  }

  await this.applyBgNow("ensureLocalVideoTrack:re-enable");
  return;
}

// Non-replaceTrack path
const oldVideo = this.localVideoTrack;

if (oldVideo) {
  try {
    await this.waitEffectIdle(oldVideo);
  } catch { }
  try {
    await this.clearBgEffectOnTrack_setEffect(oldVideo);
  } catch { }

  if (typeof this.conference.replaceTrack === "function") {
    await this.conference.replaceTrack(oldVideo, newCamera);
    await this.safeDisposeTrack(oldVideo, "ensureLocalVideoTrack:oldVideo");
  } else {
    try {
      await this.conference.removeTrack?.(oldVideo);
    } catch { }
    await this.safeDisposeTrack(oldVideo, "ensureLocalVideoTrack:oldVideo");
    await this.conference.addTrack(newCamera);
  }
} else {
  // ✅ PATCH #3: if conference already has a local video track (engine ref lost), replace instead of add
  await this.replaceOrAddLocalVideoTrack(newCamera, "ensureLocalVideoTrack:no-oldVideo");
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
  // ✅ HARD TOGGLE LOCAL VIDEO (more reliable than mute/unmute in some builds)
  // ========================================================================
  private async disableLocalVideoHard(reason: string) {
  if (this.disposed || !this.conference || !this.localUserId) return;

  // avoid racing with bg apply/reapply operations
  await this.waitBgIdle();

  let track = this.localVideoTrack;

  // If engine lost ref but conference still has local video track — grab it.
  const confExisting = this.getConferenceLocalVideoTrack();
  if (!track && confExisting) track = confExisting;

  if (!track) {
    // already off
    const p = this.participants[this.localUserId];
    if (p) {
      p.videoMuted = true;
      this.emitParticipants();
    }
    return;
  }

  try {
    // Ensure no effect op in-flight and clear effect (safe even if none)
    try {
      await this.waitEffectIdle(track);
    } catch { }

    // ✅ Important:
    // If BG was enabled via replaceTrack, clearAnyBg swaps processed->base and sets localVideoTrack=base.
    // So after clearing, we MUST remove/dispose the CURRENT local video track in conference (base),
    // not the stale one we started with (processed).
    try {
      await this.clearBgEffectOnTrack(track);
    } catch { }

    // Refresh to the real conference track (base after BG clear)
    const nowConfVideo = this.getConferenceLocalVideoTrack();
    if (nowConfVideo) track = nowConfVideo;
    else if (this.localVideoTrack) track = this.localVideoTrack;

    // Remove from conference
    try {
      await this.conference.removeTrack?.(track);
    } catch { }

    // Dispose track (stops camera)
    await this.safeDisposeTrack(track, `disableLocalVideoHard:${reason}`);

    // ✅ PATCH #3: camera is stopped -> base pointer is stale; clear BG internal tracks but keep prefs
    this.localVideoTrack = null;
    this.bgBaseVideoTrack = null;
    this.bgProcessedTrack = null;
    this.bgProcessedStream = null;
    this.bgProcessor = null;
    this.bgImplMode = "none";
    this.videoEffect = undefined;

    // Update mapping
    const entry = this.tracksByParticipant.get(this.localUserId) || {};
    if (entry.video) delete entry.video;
    this.tracksByParticipant.set(this.localUserId, entry);

    this.rebuildParticipantsFromTracks();

    const p = this.participants[this.localUserId];
    if (p) p.videoMuted = true;

    this.emitParticipants();

    // No topology churn, but let subs re-evaluate
    this.scheduleApplyVideoSubscriptions(0, false);
    this.scheduleHealthTickSoon();
  } catch (e) {
    console.warn("[cam] disableLocalVideoHard failed:", e);
  }
}

  private async enableLocalVideoHard(reason: string) {
  if (this.disposed || !this.JitsiMeetJS || !this.conference || !this.localUserId) return;

  try {
    // Create fresh video track
    const tracks = await this.JitsiMeetJS.createLocalTracks({
      devices: ["video"],
      constraints: {
        video: this.mediaSettings.videoInputId
          ? { deviceId: { exact: this.mediaSettings.videoInputId } }
          : {
            height: { ideal: 720, max: 720 },
            width: { ideal: 1280, max: 1280 },
            frameRate: { ideal: 30, max: 30 },
          },
      },
    });

    const newVideo = tracks.find((t: any) => t.getType?.() === "video");
    if (!newVideo) return;

    // ✅ PATCH #3: always replace existing local video track if conference still has one
    await this.replaceOrAddLocalVideoTrack(newVideo, `enableLocalVideoHard:${reason}`);

    // Reset BG track pointers (prefs stay) so reapply binds to THIS new camera
    this.bgBaseVideoTrack = null;
    this.bgProcessedTrack = null;
    this.bgProcessedStream = null;
    this.bgProcessor = null;
    this.bgImplMode = "none";
    this.videoEffect = undefined;

    this.localVideoTrack = newVideo;

    // Update mapping
    const entry = this.tracksByParticipant.get(this.localUserId) || {};
    entry.video = newVideo;
    this.tracksByParticipant.set(this.localUserId, entry);

    this.refreshEffectsSupport(newVideo);

    this.rebuildParticipantsFromTracks();

    const p = this.participants[this.localUserId];
    if (p) p.videoMuted = newVideo.isMuted?.() === true ? true : false;

    this.emitParticipants();

    this.scheduleApplyVideoSubscriptions(0, false);
    this.scheduleHealthTickSoon();
  } catch (e) {
    console.warn("[cam] enableLocalVideoHard failed:", e);
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

  if (!videoChanged && !audioChanged) {
    return { audio: this.localAudioTrack, video: this.localVideoTrack };
  }

  // If replaceTrack bg is active and video device changes, temporarily disable bg first.
  if (videoChanged && this.bgImplMode === "replaceTrack" && this.bgPrefs.mode !== "none") {
    try {
      await this.disableBg_replaceTrack("applyInputDevices:pre-video-switch", true);
    } catch { }
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
        // If setEffect mode active, clear effect before switching device (stable)
        if (this.bgImplMode === "setEffect" && this.bgPrefs.mode !== "none") {
          await this.clearBgEffectOnTrack_setEffect(this.localVideoTrack);
        }

        await this.localVideoTrack.setDevice(videoInputId);

        // Re-apply after device switch
        setTimeout(() => {
          void this.applyBgNow("applyInputDevices:post-setDevice");
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

      // If bg is active, fully clear before replacing tracks.
      if (this.bgPrefs.mode !== "none") {
        await this.clearAnyBg(true, "applyInputDevices:pre-video-replace");
      }

      if (oldVideo && typeof this.conference.replaceTrack === "function") {
        await this.conference.replaceTrack(oldVideo, newVideo);
        await this.safeDisposeTrack(oldVideo, "applyInputDevices:oldVideo");
        this.localVideoTrack = newVideo;
      } else if (oldVideo) {
        try {
          await this.conference.removeTrack?.(oldVideo);
        } catch { }
        await this.safeDisposeTrack(oldVideo, "applyInputDevices:oldVideo");
        await this.conference.addTrack(newVideo);
        this.localVideoTrack = newVideo;
      } else {
        // ✅ If engine lost ref but conf has one — replace instead of add
        await this.replaceOrAddLocalVideoTrack(newVideo, "applyInputDevices:newVideo");
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
  // ✅ preload BG factory so first blur/image click is instant
  void this.loadCanvasBgFactory();
  await this.applyBgNow("applyInputDevices:final");

  return { audio: this.localAudioTrack, video: this.localVideoTrack };
}

  // ========================================================================
  // PUBLIC API
  // ========================================================================
  async initAndJoin(roomName: string, userName: string): Promise < void> {
  await loadJitsiScripts();

    this.lastJoinRoomName = roomName;
  this.lastJoinUserName = userName;

  this.JitsiMeetJS = window.JitsiMeetJS;
  this.config = window.config;

  if(!this.JitsiMeetJS || !this.config) throw new Error("Jitsi globals not available");

  try {
    const lvl = this.JitsiMeetJS?.logLevels?.ERROR;
    if(typeof lvl !== "undefined") this.JitsiMeetJS.setLogLevel(lvl);
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

  async toggleAudioMute(): Promise < void> {
  if(!this.localUserId) return;
  const local = this.participants[this.localUserId];
  if(!local || !this.localAudioTrack) return;

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

  // ========================================================================
  // ✅ PATCH: Make video toggle fully HARD (remove/add) to avoid multi-participant + BG edge cases
  // ========================================================================
  async toggleVideoMute(): Promise < void> {
  return this.enqueueCamOp("toggleVideoMute", async () => {
    if (!this.localUserId) return;

    const local = this.participants[this.localUserId];
    if (!local) return;

    // ⚠️ wait any pending bg op to finish (join/apply/click)
    await this.waitBgIdle();

    this.camToggling = true;
    try {
      // If engine lost refs but conf still has local video => treat as ON.
      const confTrack = this.getConferenceLocalVideoTrack();
      const hasVideoInConf = !!confTrack;
      const hasVideoInEngine = !!this.localVideoTrack;

      console.debug(
        "[cam] toggleVideoMute(HARD) request. engineTrack:",
        this.getTrackDbg(this.localVideoTrack),
        "confHasVideo:",
        hasVideoInConf,
        "bgPrefs:",
        this.bgPrefs,
        "bgImpl:",
        this.bgImplMode
      );

      // ON -> OFF
      if (hasVideoInEngine || hasVideoInConf) {
        await this.disableLocalVideoHard("toggleVideoMute");
        local.videoMuted = true;
        this.emitParticipants();
        return;
      }

      // OFF -> ON
      await this.enableLocalVideoHard("toggleVideoMute");

      try {
        const t = this.localVideoTrack;
        if (t) local.videoMuted = t.isMuted?.() === true;
        else local.videoMuted = true;
      } catch {
        local.videoMuted = false;
      }
      this.emitParticipants();
    } catch (e) {
      console.warn("[cam] toggleVideoMute(HARD) failed:", e);
    } finally {
      this.camToggling = false;

      // ✅ IMPORTANT: re-apply BG AFTER camToggling=false,
      // иначе enableLocalVideoHard() мог пропустить реаплай
      if (this.bgPrefs.mode !== "none") {
        void this.enqueueBgOp("toggleVideoMute:post-reapply-bg", async () => {
          await this.applyBgNow("toggleVideoMute:post-reapply-bg");
        });
      }

      this.scheduleApplyVideoSubscriptions(0, false);
      this.scheduleHealthTickSoon();
    }
  });
}

  async toggleScreenShare(): Promise < void> {
  if(!this.conference || !this.JitsiMeetJS || !this.localUserId) return;

  if(this.localScreenshareTrack) {
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

  async dispose(): Promise < void> {
  this.disposed = true;

  if(this.subsApplyTimer) clearTimeout(this.subsApplyTimer);
  if(this.subsHardResetTimer) clearTimeout(this.subsHardResetTimer);
  this.subsApplyTimer = null;
  this.subsHardResetTimer = null;

  if(this.subsWatchdog) clearInterval(this.subsWatchdog);
  this.subsWatchdog = null;

  if(this.postJoinHealTimer) clearTimeout(this.postJoinHealTimer);
  this.postJoinHealTimer = null;

  if(this.resumeRecoverTimer) clearTimeout(this.resumeRecoverTimer);
  this.resumeRecoverTimer = null;

  // remove resume handlers
  try {
      (this as any).__resumeRemovers?.();
} catch { }
(this as any).__resumeRemovers = null;
this.resumeHandlersAttached = false;

this.stopVideoHealthMonitor();

// Clear BG (both modes)
try {
  await this.clearAnyBg(false, "dispose");
} catch { }

// Dispose screenshare
try {
  if (this.localScreenshareTrack) {
    try {
      await this.conference?.removeTrack?.(this.localScreenshareTrack);
    } catch { }
    await this.safeDisposeTrack(this.localScreenshareTrack, "dispose:screen");
    this.localScreenshareTrack = null;
  }
} catch { }

// Dispose audio
try {
  if (this.localAudioTrack) {
    try {
      await this.conference?.removeTrack?.(this.localAudioTrack);
    } catch { }
    await this.safeDisposeTrack(this.localAudioTrack, "dispose:audio");
    this.localAudioTrack = null;
  }
} catch { }

// Dispose video (outgoing) — if replaceTrack mode was used, also dispose base if it still exists and is different
try {
  const outgoing = this.localVideoTrack;
  if (outgoing) {
    try {
      await this.conference?.removeTrack?.(outgoing);
    } catch { }
    await this.safeDisposeTrack(outgoing, "dispose:video:outgoing");
  }

  const base = this.bgBaseVideoTrack;
  if (base && base !== outgoing) {
    await this.safeDisposeTrack(base, "dispose:video:base");
  }

  this.localVideoTrack = null;
  this.bgBaseVideoTrack = null;
  this.bgProcessedTrack = null;
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

    // Attach resume handlers once we are in a room
    this.attachResumeHandlers();

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

    // Post-join self-heal (handles: "after refresh audio/video dead" & autoplay unlock)
    this.schedulePostJoinSelfHeal();

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

    // ✅ новый усиленный антифриз
    this.triggerLeaveRecovery("USER_LEFT");
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

        // optional: иногда удаление remote track (без USER_LEFT) тоже может фризить
        // this.triggerLeaveRecovery("TRACK_REMOVED");
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
      // ✅ be defensive: if local video already exists (rare race), replace
      if (type === "video") {
        await this.replaceOrAddLocalVideoTrack(t, "createLocalTracks");
      } else if (type === "audio") {
        await this.replaceOrAddLocalAudioTrack(t, "createLocalTracks");
      } else {
        await this.conference.addTrack(t);
      }
      if (type === "audio") this.localAudioTrack = t;
      if (type === "video") this.localVideoTrack = t;
    }

    this.refreshEffectsSupport(this.localVideoTrack);

    // ✅ PATCH #2 perf: prewarm replaceTrack background pipeline so first click is instant
    void this.loadCanvasBgFactory();

    try {
      console.log("[dbg] localVideoTrack setEffect:", typeof (this.localVideoTrack as any)?.setEffect);
      console.log(
        "[dbg] createLocalTracksFromMediaStreams:",
        typeof (this.JitsiMeetJS as any)?.createLocalTracksFromMediaStreams
      );
    } catch { }

    const entry = this.tracksByParticipant.get(this.localUserId) || {};
    if (this.localAudioTrack) entry.audio = this.localAudioTrack;
    if (this.localVideoTrack) entry.video = this.localVideoTrack;
    this.tracksByParticipant.set(this.localUserId, entry);

    await this.enqueueBgOp("createLocalTracks", () => this.applyBgNow("createLocalTracks"));

    // After we actually have tracks, run self-heal again (covers rare races)
    this.schedulePostJoinSelfHeal();

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

  private scheduleSoftResetSubscriptions(delayMs: number, reason: string) {
  if (!this.conference || this.disposed) return;

  const now = Date.now();
  if (now < this.softResetCooldownUntil) return;

  if (this.softResetTimer) clearTimeout(this.softResetTimer);
  this.softResetTimer = setTimeout(() => {
    this.softResetTimer = null;
    this.softResetAndApplyVideoSubscriptions(reason);
  }, delayMs);
}

  private softResetAndApplyVideoSubscriptions(reason: string) {
  if (!this.conference || this.disposed || this.softResetInFlight) return;

  const now = Date.now();
  if (now < this.softResetCooldownUntil) return;

  this.softResetInFlight = true;

  try {
    // кратко "роняем" подписки
    try { this.conference.selectParticipants?.([]); } catch { }
    try { this.conference.setLastN?.(0); } catch { }

    setTimeout(() => {
      if (this.disposed || !this.conference) {
        this.softResetInFlight = false;
        return;
      }

      try {
        const finalRemoteIds = this.computeFinalRemoteIds();
        const desiredLastN = Math.min(finalRemoteIds.length, this.MAX_LAST_N);
        const h = this.pickReceiverConstraintHeight(desiredLastN);

        this.conference.setLastN?.(desiredLastN);
        this.conference.setReceiverVideoConstraint?.(h);
        this.conference.setReceiverAudioConstraint?.(true);
        this.conference.selectParticipants?.(finalRemoteIds.slice(0, desiredLastN));

        // сброс no-op caching чтобы следующий apply не игнорился
        this.lastSubsKey = "";
        this.lastSubsAppliedAt = Date.now();
      } finally {
        // короткий кулдаун, чтобы не дрожало от серии событий
        this.softResetCooldownUntil = Date.now() + 3500;
        this.softResetInFlight = false;
        this.scheduleHealthTickSoon();
      }
    }, 180);
  } catch {
    this.softResetInFlight = false;
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

      if (!this.camToggling && !this.bgApplying && this.bgImplMode !== "replaceTrack") {
        void this.reapplyBgIfNeeded();
      }
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
      // If setEffect mode, clear effect.
      // In replaceTrack mode, BG manager handles lifecycle elsewhere; do not nuke base pointers here.
      if (this.bgImplMode === "setEffect") {
        void this.clearBgEffectOnTrack_setEffect(track);
      }
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
          if (!nowMuted && !this.camToggling) {
            void this.enqueueBgOp("TRACK_MUTE_CHANGED:unmuted", () => this.applyBgNow("TRACK_MUTE_CHANGED:unmuted"));
          }
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
