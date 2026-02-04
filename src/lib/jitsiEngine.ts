// src/lib/jitsiEngine.ts
// SFU-only (P2P OFF) + track-based + reactions + SAFE background effects
// Ultra-stable subscriptions + targeted “black video” recovery + resume/self-heal
//
// PATCH: freeze-after-leave fix
// - No global selectParticipants([])/setLastN(0) on USER_LEFT/TRACK_REMOVED
// - Do NOT call selectParticipants for small rooms (<=2 remote videos)
// - Receiver-constraint tickle (0 -> h) on leave to force fresh keyframe behavior
// - Delay subscription apply on leave (650ms) to avoid racing internal resubscribe
// - Best-effort keyframe requests (PLI/FIR) after subs changes + reattach
// - Cancel any pending delayed hard-reset scheduled before a leave

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

export type JitsiEngineOptions = {
  /** Can be host ("meet2.mysession.club") or origin ("https://meet2.mysession.club") */
  jitsiDomain?: string;
  /** Default: "/config.js" */
  configPath?: string;
  /** Default: "/libs/lib-jitsi-meet.min.js" */
  libPath?: string;

  joinSound?: {
    enabled?: boolean;
    volume?: number; // 0..1
    respectVisibility?: boolean; // default true
  };
};

// ----------------------------------------------------------------------------
// Default Jitsi domain (EU by default)
// Priority:
// 1) Vite env:  VITE_JITSI_DOMAIN
// 2) runtime:   window.__JITSI_DOMAIN / globalThis.__JITSI_DOMAIN
// 3) fallback:  "meet-eu.mysession.club"
// ----------------------------------------------------------------------------
function pickDefaultJitsiDomain(): string {
  const g: any = typeof globalThis !== "undefined" ? (globalThis as any) : (window as any);

  const fromGlobal = (g?.__JITSI_DOMAIN || g?.JITSI_DOMAIN || "").toString().trim();

  let fromVite = "";
  try {
    fromVite = ((import.meta as any)?.env?.VITE_JITSI_DOMAIN || "").toString().trim();
  } catch {
    // ignore
  }

  return (fromVite || fromGlobal || "meet-eu.mysession.club").trim();
}

const DEFAULT_JITSI_DOMAIN = pickDefaultJitsiDomain();
const DEFAULT_CONFIG_PATH = "/config.js";
const DEFAULT_LIB_PATH = "/libs/lib-jitsi-meet.min.js";

const DISABLE_P2P = true;

// ============================================================================
// URL helpers
// ============================================================================
type ResolvedJitsiEndpoints = {
  origin: string; // "https://meet.example.com"
  host: string; // "meet.example.com"
  configSrc: string; // absolute
  libSrc: string; // absolute
};

function resolveOriginAndHost(domainOrOrigin: string): { origin: string; host: string } {
  const raw = (domainOrOrigin || "").trim() || DEFAULT_JITSI_DOMAIN;

  try {
    const asUrl =
      raw.startsWith("http://") || raw.startsWith("https://")
        ? new URL(raw)
        : raw.startsWith("//")
          ? new URL("https:" + raw)
          : new URL("https://" + raw);

    return { origin: asUrl.origin, host: asUrl.host };
  } catch {
    const host = raw.replace(/^https?:\/\//i, "").replace(/^\/\//, "").replace(/\/+$/, "");
    return { origin: "https://" + host, host };
  }
}

function buildAbsoluteFromOrigin(origin: string, pathOrUrl: string): string {
  const p = (pathOrUrl || "").trim();
  if (!p) return origin;

  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith("//")) return "https:" + p;
  if (p.startsWith("/")) return origin + p;
  return origin + "/" + p;
}

function resolveJitsiEndpoints(opts: {
  domainOrOrigin: string;
  configPath: string;
  libPath: string;
}): ResolvedJitsiEndpoints {
  const { origin, host } = resolveOriginAndHost(opts.domainOrOrigin);
  const configSrc = buildAbsoluteFromOrigin(origin, opts.configPath);
  const libSrc = buildAbsoluteFromOrigin(origin, opts.libPath);
  return { origin, host, configSrc, libSrc };
}

// ============================================================================
// SCRIPT LOADER (per-domain config/lib)
// ============================================================================
const jitsiLoaderPromises = new Map<string, Promise<void>>();

async function loadJitsiScripts(endpoints: ResolvedJitsiEndpoints): Promise<void> {
  if (typeof window === "undefined") throw new Error("Jitsi can only be loaded in browser");

  const key = `${endpoints.configSrc}|${endpoints.libSrc}`;
  const existing = jitsiLoaderPromises.get(key);
  if (existing) return existing;

  const p = new Promise<void>((resolve, reject) => {
    let loaded = 0;

    const done = () => {
      loaded += 1;
      if (loaded === 2) {
        if (window.JitsiMeetJS && window.config) resolve();
        else reject(new Error("Jitsi scripts loaded but globals are missing"));
      }
    };

    const onError = (src: string) => reject(new Error("Failed to load Jitsi script: " + src));

    // Always ensure config.js for the requested domain is present (it overwrites window.config)
    if (!document.querySelector(`script[src="${endpoints.configSrc}"]`)) {
      const sc = document.createElement("script");
      sc.src = endpoints.configSrc;
      sc.async = true;
      sc.onload = done;
      sc.onerror = () => onError(endpoints.configSrc);
      document.head.appendChild(sc);
    } else {
      done();
    }

    // Load lib-jitsi-meet only if not already loaded
    if (window.JitsiMeetJS) {
      done();
    } else if (!document.querySelector(`script[src="${endpoints.libSrc}"]`)) {
      const sc = document.createElement("script");
      sc.src = endpoints.libSrc;
      sc.async = true;
      sc.onload = done;
      sc.onerror = () => onError(endpoints.libSrc);
      document.head.appendChild(sc);
    } else {
      done();
    }
  });

  jitsiLoaderPromises.set(key, p);
  return p;
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

  // last join args (safe rejoin)
  private lastJoinRoomName: string | null = null;
  private lastJoinUserName: string | null = null;
  private lastSafeRejoinAt = 0;

  // guard against double mount / double join
  private joinInFlight = false;
  private joinToken = 0;

  // VIDEO SUBS
  private selectedVideoIds: string[] = [];
  private qualityMode: "auto" | "low" | "medium" | "high" = "auto";
  private readonly MAX_LAST_N = 36;

  private subsApplyTimer: any = null;
  private subsHardResetTimer: any = null;
  private subsHardResetInFlight = false;

  private lastSubsKey = "";
  private lastSubsAppliedAt = 0;
  private hardResetCooldownUntil = 0;

  private subsWatchdog: any = null;

  // Leave recovery + keyframe refresh
  private lastLeaveRecoveryAt = 0;

  private lastKeyframeRefreshAt = 0;
  private keyframeRefreshTimer: any = null;

  // BG state / prefs
  private bgPrefs: { mode: BgMode; imageUrl?: string } = { mode: "none" };
  private bgApplying = false;

  private bgOpQueue: Promise<void> = Promise.resolve();
  private bgOpSeq = 0;

  private camOpQueue: Promise<void> = Promise.resolve();
  private camOpSeq = 0;
  private camToggling = false;

  // resume recovery
  private resumeHandlersAttached = false;
  private hiddenAt: number | null = null;
  private resumeRecoverTimer: any = null;
  private resumeRemovers: (() => void) | null = null;

  // post-join heal
  private postJoinHealTimer: any = null;

  // setEffect-based (A)
  private videoEffect: any | undefined = undefined;
  private effectsSupported = false;
  private effectsCompatibility: "unknown" | "ok" | "incompatible" = "unknown";
  private effectsIncompatReason: string | null = null;

  private bgStrategy: "auto" | "setEffect" | "replaceTrack" = "auto";
  private bgImplMode: "none" | "setEffect" | "replaceTrack" = "none";

  // replaceTrack (B)
  private bgBaseVideoTrack: JitsiTrack | null = null;
  private bgProcessedTrack: JitsiTrack | null = null;
  private bgProcessor: any | null = null;
  private bgProcessedStream: MediaStream | null = null;
  private bgReplaceRetryCount = 0;

  private canvasBgFactoryLoaded = false;
  private canvasBgFactory: ((opts: any) => any) | null = null;

  // per-track effect serializer
  private effectOpSeq = 0;
  private effectQueueByTrack = new WeakMap<any, Promise<void>>();

  private readonly PASSTHROUGH_EFFECT = {
    startEffect: (s: MediaStream) => s,
    stopEffect: () => { },
    dispose: () => { },
    isEnabled: () => true,
    isSupported: () => true,
  };

  // Targeted black-video recovery
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

  // runtime-configurable jitsi endpoints
  private jitsiDomainOrOrigin: string = DEFAULT_JITSI_DOMAIN;
  private jitsiConfigPath: string = DEFAULT_CONFIG_PATH;
  private jitsiLibPath: string = DEFAULT_LIB_PATH;

  // join sound
  private joinSoundEnabled = true;
  private joinSoundVolume = 0.35;
  private joinSoundRespectVisibility = true;

  private audioUnlocked = false;
  private joinSoundEl?: HTMLAudioElement;

  private lastJoinSoundAt = 0;
  private joinSoundByPid = new Map<string, number>(); // pid -> lastPlayedAt
  private readonly JOIN_SOUND_COOLDOWN_MS = 850;
  private readonly JOIN_SOUND_PER_PID_COOLDOWN_MS = 7000;

  // internal timers/refs
  private applySubsSoonTimer: any = null;

  constructor(callbacks: JitsiEngineCallbacks = {}, opts: JitsiEngineOptions = {}) {
    this.callbacks = callbacks;

    if (opts.jitsiDomain) this.jitsiDomainOrOrigin = opts.jitsiDomain;
    if (opts.configPath) this.jitsiConfigPath = opts.configPath;
    if (opts.libPath) this.jitsiLibPath = opts.libPath;

    if (opts.joinSound) this.configureJoinSound(opts.joinSound);
  }

  // ========================================================================
  // small helpers
  // ========================================================================
  private delay(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }
  private safe(fn: () => void) {
    try {
      fn();
    } catch { }
  }
  private async safeAsync<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  }
  private clearTimeoutRef(ref: any) {
    if (ref) clearTimeout(ref);
  }
  private clearIntervalRef(ref: any) {
    if (ref) clearInterval(ref);
  }
  private isLiveNode(el: any): el is HTMLVideoElement {
    try {
      if (!el) return false;
      if (typeof el.isConnected === "boolean") return el.isConnected;
      return document.contains(el);
    } catch {
      return false;
    }
  }

  private getJitsiEndpoints(): ResolvedJitsiEndpoints {
    return resolveJitsiEndpoints({
      domainOrOrigin: this.jitsiDomainOrOrigin,
      configPath: this.jitsiConfigPath,
      libPath: this.jitsiLibPath,
    });
  }

  // ========================================================================
  // Public config
  // ========================================================================
  public setJitsiDomain(domainOrOrigin: string) {
    this.jitsiDomainOrOrigin = (domainOrOrigin || "").trim() || DEFAULT_JITSI_DOMAIN;
  }

  public setJitsiScriptPaths(paths: { configPath?: string; libPath?: string }) {
    if (paths.configPath) this.jitsiConfigPath = paths.configPath;
    if (paths.libPath) this.jitsiLibPath = paths.libPath;
  }

  public configureJoinSound(opts: { enabled?: boolean; volume?: number; respectVisibility?: boolean }) {
    if (typeof opts.enabled === "boolean") this.joinSoundEnabled = opts.enabled;
    if (typeof opts.volume === "number") this.joinSoundVolume = Math.max(0, Math.min(1, opts.volume));
    if (typeof opts.respectVisibility === "boolean") this.joinSoundRespectVisibility = opts.respectVisibility;
    if (this.joinSoundEl) this.joinSoundEl.volume = this.joinSoundVolume;
  }

  // must be called from a user gesture (click/tap) to help autoplay policies
  public async unlockAudio(): Promise<void> {
    if (typeof window === "undefined") return;
    if (this.audioUnlocked) return;

    const a = this.ensureJoinSoundEl();
    if (!a) {
      this.audioUnlocked = true;
      return;
    }

    try {
      const prevMuted = a.muted;
      const prevVol = a.volume;

      a.muted = true;
      a.volume = 0;

      a.currentTime = 0;
      const p = a.play();
      if (p && typeof (p as any).catch === "function") await (p as any).catch(() => { });
      a.pause();

      a.currentTime = 0;
      a.muted = prevMuted;
      a.volume = prevVol;

      this.audioUnlocked = true;
    } catch {
      // user can retry on next gesture
    }
  }

  // ========================================================================
  // Devices
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
  // Register <video> elements (for black-video recovery)
  // ========================================================================
  public registerVideoElement(pid: string, el: HTMLVideoElement | null | undefined, kind: "video" | "screen" = "video") {
    if (!pid) return;
    const map = kind === "screen" ? this.screenElByPid : this.videoElByPid;
    if (!el) {
      map.delete(pid);
      return;
    }
    map.set(pid, el);
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
    this.clearIntervalRef(this.videoHealthTimer);
    this.videoHealthTimer = null;

    this.clearTimeoutRef(this.healthSoonTimer);
    this.healthSoonTimer = null;

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

  private getSubscribedRemoteIds(): { ids: string[]; desiredLastN: number } {
    const finalRemoteIds = this.computeFinalRemoteIds();
    const desiredLastN = Math.min(finalRemoteIds.length, this.MAX_LAST_N);
    return { ids: finalRemoteIds.slice(0, desiredLastN), desiredLastN };
  }

  // ========================================================================
  // BEST-EFFORT KEYFRAME REQUESTS (PLI/FIR)
  // ========================================================================
  private requestKeyframe(pid: string, kind: "video" | "screen", _reason: string) {
    if (!this.conference || this.disposed) return;

    const p = this.participants[pid];
    const track = kind === "screen" ? p?.screenTrack : p?.videoTrack;

    this.safe(() => (track as any)?.requestKeyFrame?.());
    this.safe(() => (track as any)?.requestKeyframe?.());

    const anyConf: any = this.conference as any;
    this.safe(() => anyConf?.rtc?.requestKeyFrame?.(pid));
    this.safe(() => anyConf?.rtc?._requestKeyframe?.(pid));
    this.safe(() => anyConf?._room?.requestKeyframe?.(pid));
    this.safe(() => anyConf?._room?.sendKeyframeRequest?.(pid));
  }

  private requestKeyframesForSubscribed(reason: string) {
    if (!this.conference || this.disposed) return;

    const { ids } = this.getSubscribedRemoteIds();
    if (!ids.length) return;

    let d = 0;
    for (const pid of ids) {
      const p = this.participants[pid];
      if (!p || p.isLocal) continue;

      const hasScreen = !!p.screenTrack && this.screenElByPid.has(pid);
      const kind: "video" | "screen" = hasScreen ? "screen" : "video";

      setTimeout(() => {
        if (this.disposed) return;
        this.requestKeyframe(pid, kind, reason);
      }, d);

      d += 70;
    }
  }

  private scheduleKeyframeRefresh(delayMs: number, reason: string) {
    if (!this.conference || this.disposed) return;

    const now = Date.now();
    if (now - this.lastKeyframeRefreshAt < 700) return;

    this.clearTimeoutRef(this.keyframeRefreshTimer);
    this.keyframeRefreshTimer = setTimeout(() => {
      this.keyframeRefreshTimer = null;
      if (!this.conference || this.disposed) return;

      const t = Date.now();
      if (t - this.lastKeyframeRefreshAt < 700) return;
      this.lastKeyframeRefreshAt = t;

      this.requestKeyframesForSubscribed(`scheduled:${reason}`);
    }, delayMs);
  }

  // ========================================================================
  // Join sound (HTMLAudioElement)
  // ========================================================================
  private ensureJoinSoundEl(): HTMLAudioElement | null {
    try {
      if (!this.joinSoundEl) {
        const a = new Audio("/sounds/join.wav");
        a.preload = "auto";
        a.volume = this.joinSoundVolume;
        this.joinSoundEl = a;
      }
      return this.joinSoundEl;
    } catch {
      return null;
    }
  }

  private playJoinSound(pid?: string, _reason?: string) {
    try {
      if (!this.joinSoundEnabled) return;
      if (this.joinSoundRespectVisibility && typeof document !== "undefined" && document.visibilityState === "hidden") return;

      const now = Date.now();

      // global cooldown
      if (now - this.lastJoinSoundAt < this.JOIN_SOUND_COOLDOWN_MS) return;

      // per-participant cooldown
      if (pid) {
        const lastForPid = this.joinSoundByPid.get(pid) || 0;
        if (now - lastForPid < this.JOIN_SOUND_PER_PID_COOLDOWN_MS) return;
      }

      const a = this.ensureJoinSoundEl();
      if (!a) return;

      a.volume = this.joinSoundVolume;

      // allow fast replays
      a.currentTime = 0;

      const p = a.play();
      if (p && typeof (p as any).catch === "function") (p as any).catch(() => { });

      this.lastJoinSoundAt = now;
      if (pid) this.joinSoundByPid.set(pid, now);
    } catch (e) {
      console.warn("Join sound failed:", e);
    }
  }

  // ========================================================================
  // Subscriptions patch helpers
  // ========================================================================
  private cancelPendingHardReset(_reason: string) {
    this.clearTimeoutRef(this.subsHardResetTimer);
    this.subsHardResetTimer = null;
    this.subsHardResetInFlight = false;
  }

  // For small rooms we skip selectParticipants entirely
  private shouldUseSelectParticipants(desiredLastN: number) {
    return desiredLastN > 2;
  }

  // Receiver constraint tickle: 0 -> h to encourage fresh keyframe after leave/resubscribe
  private tickleReceiverVideoConstraint(h: number, reason: string) {
    if (!this.conference || this.disposed) return;
    this.safe(() => this.conference.setReceiverVideoConstraint?.(0));
    setTimeout(() => {
      if (this.disposed || !this.conference) return;
      this.safe(() => this.conference.setReceiverVideoConstraint?.(h));
      this.scheduleKeyframeRefresh(90, `constraintTickle:${reason}`);
    }, 110);
  }

  private scheduleConstraintTickle(delayMs: number, reason: string) {
    if (!this.conference || this.disposed) return;
    setTimeout(() => {
      if (this.disposed || !this.conference) return;
      try {
        const finalRemoteIds = this.computeFinalRemoteIds();
        const desiredLastN = Math.min(finalRemoteIds.length, this.MAX_LAST_N);
        const h = this.pickReceiverConstraintHeight(desiredLastN);
        this.tickleReceiverVideoConstraint(h, reason);
      } catch { }
    }, delayMs);
  }

  // ========================================================================
  // Queues (bg/cam)
  // ========================================================================
  private enqueueBgOp(label: string, fn: () => Promise<void>) {
    const id = ++this.bgOpSeq;
    this.bgOpQueue = this.bgOpQueue
      .catch(() => { })
      .then(async () => {
        await fn();
      })
      .catch((e) => console.warn(`[bgQ#${id}] FAIL ${label}:`, e));
    return this.bgOpQueue;
  }
  private async waitBgIdle() {
    try {
      await this.bgOpQueue;
    } catch { }
  }
  private enqueueCamOp(label: string, fn: () => Promise<void>) {
    const id = ++this.camOpSeq;
    this.camOpQueue = this.camOpQueue
      .catch(() => { })
      .then(async () => {
        await fn();
      })
      .catch((e) => console.warn(`[camQ#${id}] FAIL ${label}:`, e));
    return this.camOpQueue;
  }

  // ========================================================================
  // Effect serializer
  // ========================================================================
  private async runEffectOpOnTrack(track: any, fn: () => Promise<void>) {
    if (!track) return;
    const prev = this.effectQueueByTrack.get(track) || Promise.resolve();
    const opId = ++this.effectOpSeq;
    const next = prev
      .catch(() => { })
      .then(async () => {
        await fn();
      })
      .catch((e) => {
        console.warn(`[effect#${opId}] fail`, e);
        throw e;
      });
    this.effectQueueByTrack.set(track, next);
    return next;
  }
  private async waitEffectIdle(track: any) {
    const p = this.effectQueueByTrack.get(track);
    if (!p) return;
    try {
      await p;
    } catch { }
  }
  private async safeSetEffect(track: any, effect: any) {
    if (!track || typeof track.setEffect !== "function") return;
    await this.runEffectOpOnTrack(track, async () => {
      const attempt = async () => track.setEffect(effect);
      try {
        await attempt();
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if (msg.includes("setEffect already in progress")) {
          await this.delay(120);
          await attempt();
        } else throw e;
      }
    });
  }
  private async safeDisposeTrack(track: any) {
    if (!track) return;
    await this.waitEffectIdle(track);
    this.safe(() => track.dispose?.());
  }

  // ========================================================================
  // Join / Conference lifecycle
  // ========================================================================
  async initAndJoin(roomName: string, userName: string, opts?: JitsiEngineOptions): Promise<void> {
    // allow passing domain/paths here too
    if (opts?.jitsiDomain) this.setJitsiDomain(opts.jitsiDomain);
    if (opts?.configPath || opts?.libPath) this.setJitsiScriptPaths({ configPath: opts.configPath, libPath: opts.libPath });
    if (opts?.joinSound) this.configureJoinSound(opts.joinSound);

    const endpoints = this.getJitsiEndpoints();
    await loadJitsiScripts(endpoints);

    // store args for safe rejoin
    this.lastJoinRoomName = roomName;
    this.lastJoinUserName = userName;

    if (this.joinInFlight) return;
    this.joinInFlight = true;
    const myToken = ++this.joinToken;

    this.JitsiMeetJS = window.JitsiMeetJS;
    this.config = window.config;
    if (!this.JitsiMeetJS || !this.config) {
      this.joinInFlight = false;
      throw new Error("Jitsi globals not available");
    }

    this.safe(() => {
      const lvl = this.JitsiMeetJS?.logLevels?.ERROR;
      if (typeof lvl !== "undefined") this.JitsiMeetJS.setLogLevel(lvl);
    });

    this.JitsiMeetJS.init({ disableP2P: true, disableAudioLevels: true });

    const serviceUrl = this.config.websocket || this.config.bosh || `wss://${endpoints.host}/xmpp-websocket`;
    const options = { hosts: this.config.hosts, serviceUrl, clientNode: this.config.clientNode, p2p: { enabled: false } };

    const connection = new this.JitsiMeetJS.JitsiConnection(null, undefined, options);
    this.connection = connection;

    connection.addEventListener(this.JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, () => {
      if (this.disposed) return;
      if (myToken !== this.joinToken) return;
      this.setupConference(roomName, userName);
    });

    connection.addEventListener(this.JitsiMeetJS.events.connection.CONNECTION_FAILED, () => {
      if (this.disposed) return;
      if (myToken !== this.joinToken) return;
      this.joinInFlight = false;
      this.callbacks.onError?.("Jitsi connection failed");
    });

    connection.addEventListener?.(this.JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED, () => {
      if (this.disposed) return;
      if (myToken !== this.joinToken) return;
      this.joinInFlight = false;
      this.callbacks.onError?.("Jitsi connection disconnected");
    });

    connection.connect();
  }

  private setupConference(roomName: string, userName: string) {
    if (!this.connection || !this.JitsiMeetJS || !this.config) return;

    const conferenceOptions: any = { ...(this.config.conference || {}) };
    if (DISABLE_P2P) {
      conferenceOptions.p2p = { enabled: false };
      conferenceOptions.disableP2P = true;
    }
    if (userName) conferenceOptions.statisticsId = userName.toLowerCase();

    const baseRoomName = roomName?.trim()?.length ? roomName : "default-room";
    let safeRoomName = baseRoomName.toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (!safeRoomName) safeRoomName = "session-" + Math.random().toString(36).slice(2, 8);

    const conf = this.connection.initJitsiConference(safeRoomName, conferenceOptions);
    this.conference = conf;

    const events = this.JitsiMeetJS.events;

    const applySubsSoon = (force = false) => {
      if (this.disposed) return;
      this.clearTimeoutRef(this.applySubsSoonTimer);
      this.applySubsSoonTimer = setTimeout(() => {
        this.applySubsSoonTimer = null;
        if (this.disposed) return;
        this.scheduleApplyVideoSubscriptions(0, force);
      }, 80);
    };

    // rare hard reset for wedged stacks, but cancel if someone leaves
    const topologyChanged = () => this.scheduleHardResetSubscriptions(4500);

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
        this.joinInFlight = false;
        this.callbacks.onError?.("Failed to resolve local user id");
        return;
      }

      this.localUserId = localId;
      this.joinInFlight = false;

      if (userName && typeof anyConf.setDisplayName === "function") anyConf.setDisplayName(userName);

      this.ensureLocalParticipant(userName);
      if (!this.tracksByParticipant.has(localId)) this.tracksByParticipant.set(localId, {});

      this.attachResumeHandlers();
      this.callbacks.onConferenceJoin?.();

      applySubsSoon(true);
      topologyChanged();

      // watchdog
      this.clearIntervalRef(this.subsWatchdog);
      this.subsWatchdog = setInterval(() => {
        if (this.disposed) return;
        if (Date.now() - this.lastSubsAppliedAt > 9000) this.scheduleApplyVideoSubscriptions(0, false);
      }, 10000);

      this.startVideoHealthMonitor();
      this.schedulePostJoinSelfHeal();

      setTimeout(() => {
        if (this.disposed) return;
        void this.createLocalTracks();
      }, 0);
    });

    conf.on(events.conference.USER_JOINED, (id: string, user: any) => {
      if (this.disposed) return;

      // join sound for remote only
      if (id && id !== this.localUserId) this.playJoinSound(id, "USER_JOINED");

      this.ensureRemoteParticipant(id, user?._displayName || "Guest");
      if (!this.tracksByParticipant.has(id)) this.tracksByParticipant.set(id, {});
      this.emitParticipants();

      applySubsSoon(true);
      topologyChanged();
      this.scheduleHealthTickSoon();
      this.scheduleKeyframeRefresh(180, "USER_JOINED");
    });

    conf.on(events.conference.USER_LEFT, (id: string) => {
      if (this.disposed) return;

      // critical: cancel any delayed hard reset scheduled earlier
      this.cancelPendingHardReset("USER_LEFT");

      delete this.participants[id];
      this.tracksByParticipant.delete(id);

      this.selectedVideoIds = (this.selectedVideoIds || []).filter((x) => x && x !== id);
      this.lastSubsKey = "";

      this.videoElByPid.delete(id);
      this.screenElByPid.delete(id);
      this.videoHealthState.delete(id);

      this.emitParticipants();

      // patched: delay subs apply to avoid racing internal resubscribe
      this.scheduleApplyVideoSubscriptions(650, true);

      // cheap keyframe enforcer
      this.scheduleConstraintTickle(720, "USER_LEFT");
      this.scheduleKeyframeRefresh(120, "USER_LEFT");
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

      if (isLocalCameraOrAudio(track)) applySubsSoon(false);
      else {
        applySubsSoon(true);
        topologyChanged();
        this.scheduleKeyframeRefresh(160, "TRACK_ADDED");
      }
      this.scheduleHealthTickSoon();
    });

    conf.on(events.conference.TRACK_REMOVED, (track: any) => {
      if (this.disposed) return;
      this.handleTrackRemoved(track);

      if (isLocalCameraOrAudio(track)) {
        applySubsSoon(false);
      } else {
        // critical: cancel any delayed hard reset scheduled earlier
        this.cancelPendingHardReset("TRACK_REMOVED(remote)");

        // patched: delay subs apply to avoid racing internal resubscribe
        this.scheduleApplyVideoSubscriptions(650, true);

        this.scheduleConstraintTickle(720, "TRACK_REMOVED(remote)");
        this.scheduleKeyframeRefresh(140, "TRACK_REMOVED");
        this.triggerLeaveRecovery("TRACK_REMOVED");
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

  // ========================================================================
  // Public controls
  // ========================================================================
  public sendReaction(type: string) {
    this.broadcastLocalEvent({ kind: "reaction", reaction: type });
  }

  public setQualityMode(mode: "auto" | "low" | "medium" | "high") {
    this.qualityMode = mode;
    this.scheduleApplyVideoSubscriptions(150, true);
    this.scheduleHealthTickSoon();
    this.scheduleKeyframeRefresh(160, "setQualityMode");
  }

  public setVisibleVideoParticipants(ids: string[]) {
    this.selectedVideoIds = Array.isArray(ids) ? ids : [];
    this.scheduleApplyVideoSubscriptions(150, false);
    this.scheduleHealthTickSoon();
    this.scheduleKeyframeRefresh(160, "setVisibleVideoParticipants");
  }

  async toggleAudioMute(): Promise<void> {
    if (!this.localUserId) return;
    const local = this.participants[this.localUserId];
    if (!local || !this.localAudioTrack) return;

    const t = this.localAudioTrack;
    await this.safeAsync(async () => {
      if (t.isMuted && t.isMuted()) {
        await t.unmute();
        local.audioMuted = false;
      } else {
        await t.mute();
        local.audioMuted = true;
      }
      this.emitParticipants();
    });
  }

  async toggleVideoMute(): Promise<void> {
    return this.enqueueCamOp("toggleVideoMute", async () => {
      if (!this.localUserId) return;
      const local = this.participants[this.localUserId];
      if (!local) return;

      await this.waitBgIdle();
      this.camToggling = true;

      try {
        const confTrack = this.getConferenceLocalVideoTrack();
        const hasVideo = !!(this.localVideoTrack || confTrack);

        if (hasVideo) {
          await this.disableLocalVideoHard("toggleVideoMute");
          local.videoMuted = true;
          this.emitParticipants();
          return;
        }

        await this.enableLocalVideoHard("toggleVideoMute");
        try {
          local.videoMuted = this.localVideoTrack ? this.localVideoTrack.isMuted?.() === true : true;
        } catch {
          local.videoMuted = false;
        }
        this.emitParticipants();
      } finally {
        this.camToggling = false;

        // reapply bg after toggle
        if (this.bgPrefs.mode !== "none") {
          void this.enqueueBgOp("toggleVideoMute:post-bg", async () => {
            await this.applyBgNow("toggleVideoMute:post-bg");
          });
        }

        this.scheduleApplyVideoSubscriptions(0, false);
        this.scheduleHealthTickSoon();
        this.scheduleKeyframeRefresh(180, "toggleVideoMute");
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
        screenTrack.addEventListener(trackEvents.LOCAL_TRACK_STOPPED, () => void this.handleLocalScreenshareStopped());
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
      this.scheduleKeyframeRefresh(200, "toggleScreenShare");
    } catch {
      this.callbacks.onError?.("Screen share failed");
    }
  }

  // ========================================================================
  // Dispose
  // ========================================================================
  async dispose(): Promise<void> {
    this.disposed = true;
    this.joinInFlight = false;

    this.clearTimeoutRef(this.subsApplyTimer);
    this.clearTimeoutRef(this.subsHardResetTimer);
    this.subsApplyTimer = null;
    this.subsHardResetTimer = null;

    this.clearIntervalRef(this.subsWatchdog);
    this.subsWatchdog = null;

    this.clearTimeoutRef(this.postJoinHealTimer);
    this.postJoinHealTimer = null;

    this.clearTimeoutRef(this.resumeRecoverTimer);
    this.resumeRecoverTimer = null;

    this.clearTimeoutRef(this.keyframeRefreshTimer);
    this.keyframeRefreshTimer = null;

    this.clearTimeoutRef(this.applySubsSoonTimer);
    this.applySubsSoonTimer = null;

    // remove resume handlers
    this.safe(() => this.resumeRemovers?.());
    this.resumeRemovers = null;
    this.resumeHandlersAttached = false;

    this.stopVideoHealthMonitor();

    // Clear BG
    await this.safeAsync(async () => {
      await this.clearAnyBg(false, "dispose");
    });

    // screenshare
    await this.safeAsync(async () => {
      if (this.localScreenshareTrack) {
        await this.safeAsync(async () => this.conference?.removeTrack?.(this.localScreenshareTrack));
        await this.safeDisposeTrack(this.localScreenshareTrack);
        this.localScreenshareTrack = null;
      }
    });

    // audio
    await this.safeAsync(async () => {
      if (this.localAudioTrack) {
        await this.safeAsync(async () => this.conference?.removeTrack?.(this.localAudioTrack));
        await this.safeDisposeTrack(this.localAudioTrack);
        this.localAudioTrack = null;
      }
    });

    // video (outgoing + base if different)
    await this.safeAsync(async () => {
      const outgoing = this.localVideoTrack;
      if (outgoing) {
        await this.safeAsync(async () => this.conference?.removeTrack?.(outgoing));
        await this.safeDisposeTrack(outgoing);
      }
      const base = this.bgBaseVideoTrack;
      if (base && base !== outgoing) await this.safeDisposeTrack(base);

      this.localVideoTrack = null;
      this.bgBaseVideoTrack = null;
      this.bgProcessedTrack = null;
    });

    this.tracksByParticipant.clear();
    this.participants = {};
    this.emitParticipants();

    await this.safeAsync(async () => this.conference?.leave?.());
    await this.safeAsync(async () => this.connection?.disconnect?.());

    this.conference = null;
    this.connection = null;
    this.localUserId = null;

    // join sound state
    this.joinSoundByPid.clear();
    this.lastJoinSoundAt = 0;
  }

  // ========================================================================
  // Resume/self-heal
  // ========================================================================
  private async resumeAllAudioElements() {
    try {
      const audios = Array.from(document.querySelectorAll("audio")) as HTMLAudioElement[];
      for (const a of audios) this.safe(() => void a.play().catch(() => { }));
    } catch { }
  }

  private schedulePostJoinSelfHeal() {
    this.clearTimeoutRef(this.postJoinHealTimer);
    this.postJoinHealTimer = setTimeout(() => {
      this.postJoinHealTimer = null;
      if (this.disposed) return;
      void this.postJoinSelfHeal();
    }, 2500);
  }

  private async postJoinSelfHeal() {
    await this.resumeAllAudioElements();
    await this.ensureLocalAudioTrack();
    await this.ensureLocalVideoTrack();
    this.scheduleHealthTickSoon();
    this.scheduleKeyframeRefresh(220, "postJoinSelfHeal");
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

      void this.resumeAllAudioElements();
      if (dt > 15_000) this.scheduleResumeRecovery("visibility");
    };

    const onFocus = () => {
      if (!this.disposed) this.scheduleResumeRecovery("focus");
    };
    const onOnline = () => {
      if (!this.disposed) this.scheduleResumeRecovery("online");
    };
    const onPageShow = (ev: any) => {
      if (!this.disposed && ev?.persisted) this.scheduleResumeRecovery("pageshow:bfcache");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);

    this.resumeRemovers = () => {
      this.safe(() => document.removeEventListener("visibilitychange", onVisibility));
      this.safe(() => window.removeEventListener("focus", onFocus));
      this.safe(() => window.removeEventListener("online", onOnline));
      this.safe(() => window.removeEventListener("pageshow", onPageShow));
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
    await this.waitBgIdle().catch(() => { });
    await this.camOpQueue.catch(() => { });

    await this.resumeAllAudioElements();
    await this.ensureLocalAudioTrack();
    await this.ensureLocalVideoTrack();

    this.scheduleKeyframeRefresh(240, `resume:${reason}`);

    setTimeout(() => {
      if (this.disposed) return;
      void this.maybeSafeRejoin(`resume:${reason}`);
    }, 3500);
  }

  private async isConferenceLikelyHealthy(): Promise<boolean> {
    if (!this.conference || this.disposed || !this.localUserId) return false;
    const local = this.participants[this.localUserId];
    const audioWanted = !local?.audioMuted;
    const videoWanted = !local?.videoMuted;
    if (!audioWanted && !videoWanted) return true;

    if (audioWanted) {
      try {
        const t = this.localAudioTrack || this.getConferenceLocalAudioTrack();
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
        const t = base || this.getConferenceLocalVideoTrack();
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
    if (!room || !user) return;

    const savedMedia = { ...this.mediaSettings };
    const savedBgPrefs = { ...this.bgPrefs };
    const savedBgStrategy = this.bgStrategy;
    const savedQuality = this.qualityMode;
    const savedSelected = [...(this.selectedVideoIds || [])];

    const savedJitsiDomain = this.jitsiDomainOrOrigin;
    const savedConfigPath = this.jitsiConfigPath;
    const savedLibPath = this.jitsiLibPath;

    const savedJoinSound = {
      enabled: this.joinSoundEnabled,
      volume: this.joinSoundVolume,
      respectVisibility: this.joinSoundRespectVisibility,
    };

    await this.dispose().catch(() => { });
    this.disposed = false;

    this.mediaSettings = savedMedia;
    this.bgPrefs = savedBgPrefs;
    this.bgStrategy = savedBgStrategy;
    this.qualityMode = savedQuality;
    this.selectedVideoIds = savedSelected;

    this.jitsiDomainOrOrigin = savedJitsiDomain;
    this.jitsiConfigPath = savedConfigPath;
    this.jitsiLibPath = savedLibPath;

    this.configureJoinSound(savedJoinSound);

    this.lastSubsKey = "";
    this.lastSubsAppliedAt = 0;
    this.hardResetCooldownUntil = 0;

    await this.initAndJoin(room, user);
  }

  // ========================================================================
  // Local track helpers
  // ========================================================================
  private getConferenceLocalVideoTrack(): any | null {
    try {
      const conf = this.conference;
      if (!conf) return null;
      const arr: any[] = conf.getLocalTracks?.() || [];
      return (
        arr.find((t) => !this.isDesktopTrack(t) && t?.getType?.() === "video") ||
        arr.find((t) => t?.getType?.() === "video") ||
        null
      );
    } catch {
      return null;
    }
  }

  private getConferenceLocalAudioTrack(): any | null {
    try {
      const conf = this.conference;
      if (!conf) return null;
      const arr: any[] = conf.getLocalTracks?.() || [];
      return arr.find((t) => !this.isDesktopTrack(t) && t?.getType?.() === "audio") || null;
    } catch {
      return null;
    }
  }

  private async replaceOrAddLocalVideoTrack(newVideo: any) {
    if (!this.conference || this.disposed) throw new Error("conference not ready");
    const conf = this.conference;
    const existing = this.getConferenceLocalVideoTrack();

    if (existing && existing !== newVideo) {
      try {
        if (typeof conf.replaceTrack === "function") await conf.replaceTrack(existing, newVideo);
        else {
          this.safe(() => void conf.removeTrack?.(existing));
          await conf.addTrack(newVideo);
        }
      } finally {
        await this.safeDisposeTrack(existing);
      }
      return;
    }

    await conf.addTrack(newVideo);
  }

  private async replaceOrAddLocalAudioTrack(newAudio: any) {
    if (!this.conference || this.disposed) throw new Error("conference not ready");
    const conf = this.conference;
    const existing = this.getConferenceLocalAudioTrack();

    if (existing && existing !== newAudio) {
      try {
        if (typeof conf.replaceTrack === "function") await conf.replaceTrack(existing, newAudio);
        else {
          this.safe(() => void conf.removeTrack?.(existing));
          await conf.addTrack(newAudio);
        }
      } finally {
        await this.safeDisposeTrack(existing);
      }
      return;
    }

    await conf.addTrack(newAudio);
  }

  private refreshEffectsSupport(track?: any) {
    const t = track ?? this.localVideoTrack;
    this.effectsSupported = typeof (t as any)?.setEffect === "function";
    return this.effectsSupported;
  }

  // ========================================================================
  // Background effects: strategy + unified apply
  // ========================================================================
  public setBackgroundStrategy(strategy: "auto" | "setEffect" | "replaceTrack") {
    this.bgStrategy = strategy;
    if (this.bgPrefs.mode !== "none") {
      void this.enqueueBgOp("setBackgroundStrategy", () => this.applyBgNow("setBackgroundStrategy"));
    }
  }

  public async setBackgroundEffect(opts: { mode: BgMode; imageUrl?: string }) {
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

  private markEffectsIncompatible(reason: string) {
    if (this.effectsCompatibility !== "incompatible") {
      this.effectsCompatibility = "incompatible";
      this.effectsIncompatReason = reason;
    }
  }
  private markEffectsOk() {
    if (this.effectsCompatibility !== "ok") {
      this.effectsCompatibility = "ok";
      this.effectsIncompatReason = null;
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
    if (typeof nativeFactory === "function") return { factory: nativeFactory, kind: "native" as const };
    return { factory: createVendoredVirtualBackgroundEffect, kind: "vendored" as const };
  }

  private isAsyncFunction(fn: any) {
    try {
      return typeof fn === "function" && fn.constructor && fn.constructor.name === "AsyncFunction";
    } catch {
      return false;
    }
  }

  private wrapEffectToForceMediaStream(effect: any) {
    if (!effect || typeof effect.startEffect !== "function") return effect;
    if ((effect as any).__msWrapped) return effect;

    const original = effect.startEffect.bind(effect);
    (effect as any).__msWrapped = true;

    effect.startEffect = (streamLike: any) => {
      let s: any = streamLike;

      if (s && typeof s.getTracks !== "function") {
        if (typeof MediaStreamTrack !== "undefined" && s instanceof MediaStreamTrack) s = new MediaStream([s]);
        else if (s?.track && typeof MediaStreamTrack !== "undefined" && s.track instanceof MediaStreamTrack) s = new MediaStream([s.track]);
        else if (typeof s?.getOriginalStream === "function") {
          const maybe = s.getOriginalStream();
          if (maybe && typeof maybe.then === "function") throw new Error("[bg] startEffect expects sync MediaStream");
          s = maybe;
        }
      }

      if (!s || typeof s.getTracks !== "function") throw new Error("[bg] startEffect received non-MediaStream");
      const out = original(s);
      if (out && typeof out.then === "function") throw new Error("[bg] startEffect returned Promise (sync required)");
      return out;
    };

    if (typeof effect.isEnabled !== "function") effect.isEnabled = () => true;
    return effect;
  }

  private async createEffectObject(vb: any) {
    const pick = this.getEffectFactory();
    const created = pick.factory?.(vb);
    const effect = await Promise.resolve(created);
    if (!effect) {
      this.markEffectsIncompatible(`${pick.kind} factory returned empty effect`);
      return null;
    }

    if (this.isAsyncFunction(effect.startEffect)) {
      this.markEffectsIncompatible(`${pick.kind} effect.startEffect is async`);
      return null;
    }

    if (typeof effect.isEnabled !== "function") effect.isEnabled = () => true;
    this.markEffectsOk();
    return effect;
  }

  private async clearBgEffectOnTrack_setEffect(track: any) {
    if (!track) return;
    if (typeof track.setEffect === "function") await this.safeSetEffect(track, this.PASSTHROUGH_EFFECT);
    await this.safeAsync(async () => this.videoEffect?.dispose?.());
    await this.safeAsync(async () => (this.videoEffect as any)?.stopEffect?.());
    this.videoEffect = undefined;
  }

  private async applyBgEffectToTrack_setEffect(track: any) {
    this.refreshEffectsSupport(track);
    if (!this.effectsSupported) throw new Error("setEffect not supported");
    if (this.effectsCompatibility === "incompatible") throw new Error(`setEffect incompatible: ${this.effectsIncompatReason}`);

    const wasMuted = (() => {
      try {
        return track.isMuted?.() === true;
      } catch {
        return false;
      }
    })();
    if (wasMuted) return;

    try {
      const ms = await Promise.resolve(track.getOriginalStream?.());
      if (!ms || typeof ms.getTracks !== "function") return;
    } catch {
      return;
    }

    if (this.bgPrefs.mode === "none") {
      await this.clearBgEffectOnTrack_setEffect(track);
      return;
    }

    await this.clearBgEffectOnTrack_setEffect(track);

    const vb = this.buildVirtualBackgroundOptions();
    if (!vb) return;

    this.bgApplying = true;
    try {
      let effect = await this.createEffectObject(vb);
      if (!effect) throw new Error(`setEffect unavailable: ${this.effectsIncompatReason || "no effect"}`);
      effect = this.wrapEffectToForceMediaStream(effect);

      if (typeof effect.isSupported === "function" && !effect.isSupported(track)) throw new Error("isSupported=false");
      if (typeof effect.isEnabled === "function" && !effect.isEnabled(track)) throw new Error("isEnabled=false");

      await this.safeSetEffect(track, effect);
      this.videoEffect = effect;

      this.safeAsync(async () => {
        const nowMuted = track.isMuted?.() === true;
        if (!wasMuted && nowMuted && typeof track.unmute === "function") await track.unmute();
      });
    } catch (e: any) {
      await this.safeAsync(async () => this.safeSetEffect(track, this.PASSTHROUGH_EFFECT));
      await this.safeAsync(async () => this.videoEffect?.dispose?.());
      await this.safeAsync(async () => (this.videoEffect as any)?.stopEffect?.());
      this.videoEffect = undefined;
      this.markEffectsIncompatible(`setEffect apply failed: ${String(e?.message || e || "")}`);
      throw e;
    } finally {
      setTimeout(() => (this.bgApplying = false), 250);
    }
  }

  // replaceTrack (Canvas/MediaPipe)
  private async loadCanvasBgFactory(): Promise<((opts: any) => any) | null> {
    if (this.canvasBgFactoryLoaded) return this.canvasBgFactory;
    this.canvasBgFactoryLoaded = true;

    try {
      const mod: any = await import("./backgroundEffect");
      const fn = mod?.createBackgroundEffect || mod?.createCanvasVirtualBgEffect || mod?.default || null;
      this.canvasBgFactory = typeof fn === "function" ? fn : null;
      return this.canvasBgFactory;
    } catch {
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
      await this.delay(60);
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
    throw new Error("createLocalTracksFromMediaStreams not available");
  }

  private async stopReplaceTrackProcessor() {
    await this.safeAsync(async () => this.bgProcessor?.stopEffect?.());
    await this.safeAsync(async () => this.bgProcessor?.dispose?.());
    this.bgProcessor = null;
    this.bgProcessedStream = null;
  }

  private async disableBg_replaceTrack(_reason: string, keepPrefs: boolean) {
    if (!this.conference || this.disposed) return;

    const base = this.bgBaseVideoTrack;
    const processed = this.bgProcessedTrack;

    if (processed && base) {
      if (typeof this.conference.replaceTrack === "function") await this.safeAsync(async () => this.conference.replaceTrack(processed, base));
      else {
        await this.safeAsync(async () => this.conference.removeTrack?.(processed));
        await this.safeAsync(async () => this.conference.addTrack?.(base));
      }
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

    if (processed) await this.safeDisposeTrack(processed);
    this.bgProcessedTrack = null;

    await this.stopReplaceTrackProcessor();

    if (!keepPrefs) this.bgBaseVideoTrack = null;
    this.bgImplMode = "none";
  }

  private async enableBg_replaceTrack(_reason: string) {
    if (!this.conference || this.disposed) return;
    if (this.bgPrefs.mode === "none") return;
    if (!this.localVideoTrack) return;

    // clear stale base
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

    try {
      if (this.bgBaseVideoTrack?.isMuted?.() === true) return;
    } catch { }

    const factory = await this.loadCanvasBgFactory();
    if (!factory) return;

    const baseTrack = this.bgBaseVideoTrack || this.localVideoTrack;
    const baseStream = (await this.waitBaseStream(baseTrack, 2000)) || null;
    if (!baseStream) {
      setTimeout(() => {
        if (this.disposed) return;
        void this.applyBgNow("retry:base-stream");
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
        await this.stopReplaceTrackProcessor();
        return;
      }

      const processedStream = await Promise.resolve(processor.startEffect(baseStream));
      if (!processedStream || typeof processedStream.getTracks !== "function") {
        await this.stopReplaceTrackProcessor();
        return;
      }

      this.bgProcessedStream = processedStream;

      const processedJitsiTrack = await this.createJitsiVideoTrackFromStream(processedStream);
      this.bgProcessedTrack = processedJitsiTrack;

      const oldOutgoing = this.localVideoTrack;

      // update refs first
      this.localVideoTrack = processedJitsiTrack;
      if (this.localUserId) {
        const entry = this.tracksByParticipant.get(this.localUserId) || {};
        entry.video = processedJitsiTrack;
        this.tracksByParticipant.set(this.localUserId, entry);
        this.rebuildParticipantsFromTracks();
        this.emitParticipants();
      }

      if (oldOutgoing && typeof this.conference.replaceTrack === "function") await this.conference.replaceTrack(oldOutgoing, processedJitsiTrack);
      else if (oldOutgoing) {
        await this.safeAsync(async () => this.conference.removeTrack?.(oldOutgoing));
        await this.conference.addTrack(processedJitsiTrack);
      } else {
        await this.conference.addTrack(processedJitsiTrack);
      }

      this.bgImplMode = "replaceTrack";
      this.bgReplaceRetryCount = 0;
    } catch {
      await this.safeAsync(async () => this.disableBg_replaceTrack("enable-failed", false));
      await this.safeAsync(async () => this.ensureLocalVideoTrack());

      this.bgReplaceRetryCount += 1;
      if (this.bgReplaceRetryCount <= 3 && this.bgPrefs.mode !== "none") {
        const delay = 250 * this.bgReplaceRetryCount;
        setTimeout(() => {
          if (this.disposed) return;
          void this.enqueueBgOp(`replaceTrack-retry#${this.bgReplaceRetryCount}`, () => this.applyBgNow(`replaceTrack-retry#${this.bgReplaceRetryCount}`));
        }, delay);
      }
    } finally {
      setTimeout(() => (this.bgApplying = false), 250);
    }
  }

  private async clearAnyBg(keepPrefs: boolean, reason: string) {
    if (this.bgImplMode === "replaceTrack") {
      await this.disableBg_replaceTrack(reason, keepPrefs);
      return;
    }

    if (this.localVideoTrack) await this.safeAsync(async () => this.clearBgEffectOnTrack_setEffect(this.localVideoTrack));
    this.bgImplMode = "none";

    if (!keepPrefs) {
      this.bgBaseVideoTrack = null;
      this.bgProcessedTrack = null;
      this.bgProcessor = null;
      this.bgProcessedStream = null;
    }
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
        if (this.bgPrefs.mode !== "none" && !this.videoEffect) throw new Error("setEffect produced no effect");
        this.bgImplMode = "setEffect";
        return;
      } catch {
        // fall through
      }
    }

    if (this.bgImplMode === "setEffect") await this.safeAsync(async () => this.clearBgEffectOnTrack_setEffect(track));

    this.bgBaseVideoTrack = this.bgBaseVideoTrack || this.localVideoTrack;
    this.bgImplMode = "none";
    await this.enableBg_replaceTrack(`fallback:${reason}`);
  }

  private async reapplyBgIfNeeded() {
    if (!this.localVideoTrack) return;
    if (this.bgPrefs.mode === "none") return;
    await this.enqueueBgOp("reapplyBgIfNeeded", () => this.applyBgNow("reapplyBgIfNeeded"));
  }

  // ========================================================================
  // Local A/V ensure
  // ========================================================================
  private async ensureLocalAudioTrack(): Promise<void> {
    if (this.disposed || !this.JitsiMeetJS || !this.conference || !this.localUserId) return;

    const local = this.participants[this.localUserId];
    if (local?.audioMuted) return;

    try {
      if (this.localAudioTrack) {
        const ms = await Promise.resolve(this.localAudioTrack.getOriginalStream?.());
        const at = ms?.getAudioTracks?.()?.[0];
        if (at && at.readyState === "live" && at.enabled !== false) return;
      }
    } catch { }

    try {
      const confAudio = this.getConferenceLocalAudioTrack();
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

    try {
      const tracks = await this.JitsiMeetJS.createLocalTracks({
        devices: ["audio"],
        constraints: { audio: this.mediaSettings.audioInputId ? { deviceId: { exact: this.mediaSettings.audioInputId } } : true },
      });

      const newAudio = tracks.find((t: any) => t.getType?.() === "audio") || null;
      if (!newAudio) return;

      await this.replaceOrAddLocalAudioTrack(newAudio);
      this.localAudioTrack = newAudio;

      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      entry.audio = newAudio;
      this.tracksByParticipant.set(this.localUserId, entry);

      this.rebuildParticipantsFromTracks();
      this.emitParticipants();
    } catch { }
  }

  private async ensureLocalVideoTrack(): Promise<void> {
    if (this.disposed || !this.JitsiMeetJS || !this.conference) return;

    try {
      if (this.localUserId && this.participants[this.localUserId]?.videoMuted) return;
    } catch { }

    const needBase = this.bgImplMode === "replaceTrack" && this.bgBaseVideoTrack;
    const baseCandidate = needBase ? this.bgBaseVideoTrack : this.localVideoTrack;

    try {
      const ms = await Promise.resolve(baseCandidate?.getOriginalStream?.());
      const vt = ms?.getVideoTracks?.()?.[0];
      if (baseCandidate && vt && vt.readyState !== "ended") {
        if (!needBase) return;

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
      await this.safeAsync(async () => this.disableBg_replaceTrack("ensureLocalVideoTrack:recreate", true));
      await this.safeAsync(async () => this.replaceOrAddLocalVideoTrack(newCamera));

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

      if (oldOutgoing && oldOutgoing !== newCamera && oldOutgoing !== oldBase) await this.safeDisposeTrack(oldOutgoing);
      if (oldBase && oldBase !== newCamera && oldBase !== oldOutgoing) await this.safeDisposeTrack(oldBase);

      await this.applyBgNow("ensureLocalVideoTrack:re-enable");
      return;
    }

    const oldVideo = this.localVideoTrack;

    if (oldVideo) {
      await this.waitEffectIdle(oldVideo);
      await this.safeAsync(async () => this.clearBgEffectOnTrack_setEffect(oldVideo));

      if (typeof this.conference.replaceTrack === "function") {
        await this.conference.replaceTrack(oldVideo, newCamera);
        await this.safeDisposeTrack(oldVideo);
      } else {
        await this.safeAsync(async () => this.conference.removeTrack?.(oldVideo));
        await this.safeDisposeTrack(oldVideo);
        await this.conference.addTrack(newCamera);
      }
    } else {
      await this.replaceOrAddLocalVideoTrack(newCamera);
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
  // Hard toggle camera (remove/add) — stable with BG
  // ========================================================================
  private async disableLocalVideoHard(_reason: string) {
    if (this.disposed || !this.conference || !this.localUserId) return;
    await this.waitBgIdle();

    let track = this.localVideoTrack || this.getConferenceLocalVideoTrack();
    if (!track) {
      const p = this.participants[this.localUserId];
      if (p) {
        p.videoMuted = true;
        this.emitParticipants();
      }
      return;
    }

    try {
      await this.waitEffectIdle(track);
      await this.safeAsync(async () => this.clearAnyBg(true, "disableLocalVideoHard"));

      track = this.getConferenceLocalVideoTrack() || this.localVideoTrack || track;

      await this.safeAsync(async () => this.conference.removeTrack?.(track));
      await this.safeDisposeTrack(track);

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
      console.warn("[cam] disableLocalVideoHard failed:", e);
    }
  }

  private async enableLocalVideoHard(_reason: string) {
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

      await this.replaceOrAddLocalVideoTrack(newVideo);

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
      this.rebuildParticipantsFromTracks();

      const p = this.participants[this.localUserId];
      if (p) p.videoMuted = newVideo.isMuted?.() === true;

      this.emitParticipants();

      this.scheduleApplyVideoSubscriptions(0, false);
      this.scheduleHealthTickSoon();
    } catch (e) {
      console.warn("[cam] enableLocalVideoHard failed:", e);
      this.callbacks.onError?.("Failed to enable camera");
    }
  }

  // ========================================================================
  // Input devices
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
      await this.safeAsync(async () => this.disableBg_replaceTrack("applyInputDevices:pre-video-switch", true));
    }

    if (audioChanged) {
      await this.safeAsync(async () => {
        if (this.localAudioTrack && typeof this.localAudioTrack.setDevice === "function") await this.localAudioTrack.setDevice(audioInputId);
      });
    }

    if (videoChanged) {
      const ok = await this.safeAsync(async () => {
        if (this.localVideoTrack && typeof this.localVideoTrack.setDevice === "function") {
          if (this.bgImplMode === "setEffect" && this.bgPrefs.mode !== "none") await this.clearBgEffectOnTrack_setEffect(this.localVideoTrack);
          await this.localVideoTrack.setDevice(videoInputId);
          setTimeout(() => void this.applyBgNow("applyInputDevices:post-setDevice"), 0);
          return true;
        }
        return false;
      });
      if (ok) return { audio: this.localAudioTrack, video: this.localVideoTrack };
    }

    const J = (window as any).JitsiMeetJS;
    if (!J?.createLocalTracks) throw new Error("JitsiMeetJS.createLocalTracks not found");

    const newTracks = await J.createLocalTracks({
      devices: ["audio", "video"],
      constraints: {
        audio: audioInputId ? { deviceId: { exact: audioInputId } } : true,
        video: videoInputId ? { deviceId: { exact: videoInputId } } : true,
      },
    });

    const newAudio = newTracks.find((t: any) => t.getType?.() === "audio") || null;
    const newVideo = newTracks.find((t: any) => t.getType?.() === "video") || null;

    if (this.conference) {
      if (newAudio) await this.replaceOrAddLocalAudioTrack(newAudio);
      if (newVideo) {
        if (this.bgPrefs.mode !== "none") await this.clearAnyBg(true, "applyInputDevices:pre-video-replace");
        await this.replaceOrAddLocalVideoTrack(newVideo);
      }
      if (newAudio) this.localAudioTrack = newAudio;
      if (newVideo) this.localVideoTrack = newVideo;
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
  // Create initial local tracks
  // ========================================================================
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
        if (type === "video") await this.replaceOrAddLocalVideoTrack(t);
        else if (type === "audio") await this.replaceOrAddLocalAudioTrack(t);
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
      this.scheduleKeyframeRefresh(250, "createLocalTracks");
    } catch (e) {
      console.error("createLocalTracks error", e);
      this.callbacks.onError?.("Failed to access camera/microphone");
    }
  }

  // ========================================================================
  // Subscriptions
  // ========================================================================
  private scheduleApplyVideoSubscriptions(delayMs = 150, force = false) {
    if (!this.conference || this.disposed) return;
    this.clearTimeoutRef(this.subsApplyTimer);
    this.subsApplyTimer = setTimeout(() => {
      this.subsApplyTimer = null;
      this.applyVideoSubscriptions(force);
    }, delayMs);
  }

  private scheduleHardResetSubscriptions(delayMs = 4500) {
    if (!this.conference || this.disposed) return;
    this.clearTimeoutRef(this.subsHardResetTimer);
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

    const ui = (this.selectedVideoIds || [])
      .filter((id) => id && id !== localId)
      .filter((id) => {
        const known = !!this.participants[id] || this.tracksByParticipant.has(id);
        if (!known) return false;
        const t = this.tracksByParticipant.get(id);
        return !!(t?.video || t?.screen);
      })
      .slice()
      .sort();

    const merged: string[] = [];
    for (const id of active) if (!merged.includes(id)) merged.push(id);
    for (const id of ui) if (!merged.includes(id)) merged.push(id);

    return merged;
  }

  private buildSubsKey(finalRemoteIds: string[], desiredLastN: number, h: number) {
    return `${this.qualityMode}|${desiredLastN}|${h}|${finalRemoteIds.join(",")}`;
  }

  private applyVideoSubscriptions(force = false) {
    if (!this.conference) return;

    try {
      const finalRemoteIds = this.computeFinalRemoteIds();
      const desiredLastN = Math.min(finalRemoteIds.length, this.MAX_LAST_N);
      const h = this.pickReceiverConstraintHeight(desiredLastN);
      const key = this.buildSubsKey(finalRemoteIds, desiredLastN, h);

      if (!force && key === this.lastSubsKey) return;

      this.lastSubsKey = key;
      this.lastSubsAppliedAt = Date.now();

      const shouldSelect = this.shouldUseSelectParticipants(desiredLastN);

      this.conference.setLastN?.(desiredLastN);
      this.conference.setReceiverVideoConstraint?.(h);
      this.conference.setReceiverAudioConstraint?.(true);

      // Skip selectParticipants for small rooms
      if (shouldSelect && typeof this.conference.selectParticipants === "function") {
        this.conference.selectParticipants(finalRemoteIds.slice(0, desiredLastN));
      }

      this.scheduleKeyframeRefresh(120, "applyVideoSubscriptions");
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
      const shouldSelect = this.shouldUseSelectParticipants(desiredLastN);

      // kept for rare wedged cases; avoid global nudge for small rooms
      if (shouldSelect) {
        this.safe(() => this.conference.selectParticipants?.([]));
        this.safe(() => this.conference.setLastN?.(0));
      } else {
        this.tickleReceiverVideoConstraint(h, "hardReset:smallRoom");
      }

      setTimeout(() => {
        if (this.disposed || !this.conference) {
          this.subsHardResetInFlight = false;
          return;
        }
        try {
          this.conference.setLastN?.(desiredLastN);
          this.conference.setReceiverVideoConstraint?.(h);
          this.conference.setReceiverAudioConstraint?.(true);

          if (shouldSelect) {
            this.conference.selectParticipants?.(finalRemoteIds.slice(0, desiredLastN));
          }

          this.lastSubsKey = "";
          this.lastSubsAppliedAt = Date.now();
        } finally {
          this.hardResetCooldownUntil = Date.now() + 20000;
          this.subsHardResetInFlight = false;
          this.scheduleHealthTickSoon();
          this.scheduleKeyframeRefresh(160, "hardResetAndApplyVideoSubscriptions");
        }
      }, 220);
    } catch {
      this.subsHardResetInFlight = false;
    }
  }

  // ========================================================================
  // Leave recovery (lightweight)
  // ========================================================================
  private async reattachAllSubscribedRemoteVideos(reason: string) {
    if (!this.conference || this.disposed) return;

    const { ids } = this.getSubscribedRemoteIds();
    if (!ids.length) return;

    for (const pid of ids) {
      const p = this.participants[pid];
      if (!p || p.isLocal) continue;

      const hasScreen = !!p.screenTrack && this.screenElByPid.has(pid);
      const kind: "video" | "screen" = hasScreen ? "screen" : "video";
      const el = kind === "screen" ? this.screenElByPid.get(pid) : this.videoElByPid.get(pid);
      const track = kind === "screen" ? p.screenTrack : p.videoTrack;
      if (!el || !track) continue;
      if (!this.isLiveNode(el)) continue;

      try {
        if (typeof track.detach === "function") {
          this.safe(() => track.detach(el));
          this.safe(() => track.detach());
        }
        await this.delay(30);
        if (typeof track.attach === "function") this.safe(() => track.attach(el));
        this.safe(() => void el.play().catch(() => { }));

        this.requestKeyframe(pid, kind, `reattachAllSubscribedRemoteVideos:${reason}`);
      } catch { }
    }

    this.scheduleKeyframeRefresh(120, `reattachAll:${reason}`);
  }

  private triggerLeaveRecovery(reason: string) {
    if (this.disposed || !this.conference) return;

    const now = Date.now();
    if (now - this.lastLeaveRecoveryAt < 900) return;
    this.lastLeaveRecoveryAt = now;

    const { ids } = this.getSubscribedRemoteIds();
    if (!ids.length) return;

    setTimeout(() => {
      if (!this.disposed) void this.reattachAllSubscribedRemoteVideos(`leaveRecovery:now:${reason}`);
    }, 0);

    setTimeout(() => {
      if (!this.disposed) void this.reattachAllSubscribedRemoteVideos(`leaveRecovery:retry:${reason}`);
    }, 420);

    this.scheduleKeyframeRefresh(160, `leaveRecovery:${reason}`);
    this.scheduleHealthTickSoon();
  }

  // ========================================================================
  // Health tick (black video recovery)
  // ========================================================================
  private healthTick() {
    if (!this.conference || this.disposed) return;

    const { ids } = this.getSubscribedRemoteIds();
    if (!ids.length) return;

    const now = Date.now();

    for (const pid of Array.from(this.videoHealthState.keys())) {
      if (!ids.includes(pid)) this.videoHealthState.delete(pid);
    }

    for (const pid of ids) {
      const p = this.participants[pid];
      if (!p || p.isLocal) continue;

      const hasScreen = !!p.screenTrack && this.screenElByPid.has(pid);
      const kind: "video" | "screen" = hasScreen ? "screen" : "video";

      const el = kind === "screen" ? this.screenElByPid.get(pid) : this.videoElByPid.get(pid);
      const track = kind === "screen" ? p.screenTrack : p.videoTrack;
      if (!el || !track) continue;

      if (!this.isLiveNode(el)) {
        if (kind === "screen") this.screenElByPid.delete(pid);
        else this.videoElByPid.delete(pid);
        continue;
      }

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
    if (!this.isLiveNode(el)) return;

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

      this.safe(() => ((el as any).srcObject = null));
      await this.delay(40);

      if (typeof track.attach === "function") this.safe(() => track.attach(el));
      this.safe(() => void el.play().catch(() => { }));

      this.requestKeyframe(pid, kind, "recoverParticipantVideo");

      st.stuckSince = Date.now();
      st.lastProgressAt = Date.now();

      if (st.reattachAttemptsInWindow >= 2) this.bumpParticipantSubscription(pid, st, kind);
    } catch {
      this.bumpParticipantSubscription(pid, st, kind);
    }
  }

  private bumpParticipantSubscription(pid: string, st: { lastBumpAt: number }, kindHint?: "video" | "screen") {
    const now = Date.now();
    if (!this.conference || this.disposed) return;
    if (now - (st.lastBumpAt || 0) < this.BUMP_COOLDOWN_MS) return;

    st.lastBumpAt = now;

    this.safe(() => {
      const { ids, desiredLastN } = this.getSubscribedRemoteIds();
      if (!ids.includes(pid)) return;

      const h = this.pickReceiverConstraintHeight(desiredLastN);
      const shouldSelect = this.shouldUseSelectParticipants(desiredLastN);

      if (!shouldSelect) {
        this.tickleReceiverVideoConstraint(h, "bumpParticipantSubscription");
        const p = this.participants[pid];
        const kind: "video" | "screen" = kindHint || (!!p?.screenTrack && this.screenElByPid.has(pid) ? "screen" : "video");
        this.requestKeyframe(pid, kind, "bumpParticipantSubscription:smallRoom");
        return;
      }

      const original = ids.slice(0, desiredLastN);
      const without = original.filter((x) => x !== pid);

      this.safe(() => this.conference.selectParticipants?.(without));

      setTimeout(() => {
        if (this.disposed || !this.conference) return;
        this.safe(() => this.conference.selectParticipants?.(original));

        const p = this.participants[pid];
        const kind: "video" | "screen" = kindHint || (!!p?.screenTrack && this.screenElByPid.has(pid) ? "screen" : "video");
        this.requestKeyframe(pid, kind, "bumpParticipantSubscription");
      }, 220);
    });
  }

  // ========================================================================
  // Endpoint messaging (reactions)
  // ========================================================================
  private broadcastLocalEvent(ev: any) {
    if (!this.conference || !this.localUserId) return;
    for (const id of Object.keys(this.participants)) {
      if (id === this.localUserId) continue;
      this.safe(() => this.conference.sendEndpointMessage(id, ev));
    }
  }

  private handleEndpointMessage(senderId: string, payload: any) {
    if (!payload) return;
    if (payload.kind === "reaction" && payload.reaction) {
      this.callbacks.onReactionReceived?.(senderId, payload.reaction);
    }
  }

  // ========================================================================
  // Participants / DTO
  // ========================================================================
  private ensureLocalParticipant(displayName: string) {
    if (!this.localUserId) return;
    const id = this.localUserId;
    if (!this.participants[id]) {
      this.participants[id] = {
        id,
        displayName: displayName || "Me",
        isLocal: true,
        audioMuted: false,
        videoMuted: false,
        isScreenSharing: false,
      };
    } else if (displayName) {
      this.participants[id].displayName = displayName;
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

  // ========================================================================
  // Tracks
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
      if (pid === this.localUserId && type === "audio" && this.localAudioTrack === track) this.localAudioTrack = null;
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
    if (type === "audio") p.audioMuted = track.isMuted ? track.isMuted() : p.audioMuted;
    else if (type === "video") {
      if (!this.isDesktopTrack(track)) {
        if (!(pid === this.localUserId && this.bgApplying)) p.videoMuted = track.isMuted ? track.isMuted() : p.videoMuted;
        if (pid === this.localUserId) {
          this.safe(() => {
            const nowMuted = track.isMuted?.() === true;
            if (!nowMuted && !this.camToggling) {
              void this.enqueueBgOp("TRACK_MUTE_CHANGED:unmuted", () => this.applyBgNow("TRACK_MUTE_CHANGED:unmuted"));
            }
          });
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

    await this.safeAsync(async () => this.conference.removeTrack(this.localScreenshareTrack));
    await this.safeDisposeTrack(this.localScreenshareTrack);

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
    this.scheduleKeyframeRefresh(220, "handleLocalScreenshareStopped");
  }
}
