// ============================================================================
// src/lib/jitsiEngine.ts — SFU-only (P2P OFF) + track-based + reactions
// ✅ BG moved to BgManager (auto setEffect -> replaceTrack fallback)
// ✅ Video health moved to VideoHealthMonitor
// ============================================================================

import { BgManager, BgMode } from "./jitsiEngine/bgManager";
import { VideoHealthMonitor } from "./jitsiEngine/videoHealthMonitor";

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

const JITSI_DOMAIN = "jitsi.lukassodesign.site";
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

  // Remember last join args (for safe rejoin)
  private lastJoinRoomName: string | null = null;
  private lastJoinUserName: string | null = null;
  private lastSafeRejoinAt = 0;

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

  // Cam ops serializer (kept local)
  private camOpQueue: Promise<void> = Promise.resolve();
  private camOpSeq = 0;
  private camToggling = false;

  // Resume / wake recovery
  private resumeHandlersAttached = false;
  private hiddenAt: number | null = null;
  private resumeRecoverTimer: any = null;

  // Post-join local A/V self-heal
  private postJoinHealTimer: any = null;

  // Managers
  private bg: BgManager;
  private health: VideoHealthMonitor;

  constructor(callbacks: JitsiEngineCallbacks = {}) {
    this.callbacks = callbacks;

    this.bg = new BgManager({
      getConference: () => this.conference,
      getJitsiMeetJS: () => this.JitsiMeetJS,
      getLocalUserId: () => this.localUserId,
      getLocalVideoTrack: () => this.localVideoTrack,
      setLocalVideoTrack: (t) => { this.localVideoTrack = t; },
      setMediaBg: (mode, imageUrl) => {
        this.mediaSettings.bgMode = mode;
        this.mediaSettings.bgImageUrl = imageUrl;
      },
      upsertLocalVideoMapping: (t) => {
        if (!this.localUserId) return;
        const entry = this.tracksByParticipant.get(this.localUserId) || {};
        if (t) entry.video = t;
        else if (entry.video) delete entry.video;
        this.tracksByParticipant.set(this.localUserId, entry);
        this.rebuildParticipantsFromTracks();
        this.emitParticipants();
      },
      rebuildParticipantsFromTracks: () => this.rebuildParticipantsFromTracks(),
      emitParticipants: () => this.emitParticipants(),
      isDesktopTrack: (t) => this.isDesktopTrack(t),
      safeDisposeTrack: (t, reason) => this.safeDisposeTrack(t, reason),
      ensureLocalVideoTrack: (opts) => this.ensureLocalVideoTrack(opts),
      replaceOrAddLocalVideoTrack: (t, reason) => this.replaceOrAddLocalVideoTrack(t, reason),
    });

    this.health = new VideoHealthMonitor({
      isDisposed: () => this.disposed,
      getConference: () => this.conference,
      getParticipants: () => this.participants,
      getSubscribedRemoteIds: () => this.getSubscribedRemoteIds(),
    });
  }

  // ========================================================================
  // CAM OPS QUEUE
  // ========================================================================
  private enqueueCamOp(label: string, fn: () => Promise<void>) {
    const id = ++this.camOpSeq;
    this.camOpQueue = this.camOpQueue
      .catch(() => {})
      .then(async () => {
        try { console.debug(`[camQ#${id}] BEGIN ${label}`); } catch {}
        await fn();
        try { console.debug(`[camQ#${id}] END ${label}`); } catch {}
      })
      .catch((e) => {
        console.warn(`[camQ#${id}] FAIL ${label}:`, e);
      });

    return this.camOpQueue;
  }

  // ========================================================================
  // DEVICES
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
  // VIDEO ELEMENT REGISTRATION (for black-video recovery)
  // ========================================================================
  public registerVideoElement(
    participantId: string,
    el: HTMLVideoElement | null | undefined,
    kind: "video" | "screen" = "video"
  ) {
    this.health.registerVideoElement(participantId, el, kind);
  }

  // ========================================================================
  // BG API
  // ========================================================================
  public setBackgroundStrategy(strategy: "auto" | "setEffect" | "replaceTrack") {
    this.bg.setStrategy(strategy);
  }

  public async setBackgroundEffect(opts: { mode: BgMode; imageUrl?: string }) {
    await this.bg.setBackgroundEffect(opts);
  }

  // ========================================================================
  // LOCAL TRACK DISPOSE SAFETY
  // ========================================================================
  private async safeDisposeTrack(track: any, reason: string) {
    if (!track) return;
    await this.bg.waitEffectIdle(track);
    try {
      track.dispose?.();
      try { console.debug(`[track] dispose(${reason}) OK`); } catch {}
    } catch (e) {
      try { console.debug(`[track] dispose(${reason}) FAIL`, e); } catch {}
    }
  }

  // ========================================================================
  // LOCAL CONFERENCE TRACK HELPERS (prevents "Cannot add second video track")
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
    if (existing && existing !== newVideo) {
      try {
        if (typeof conf.replaceTrack === "function") await conf.replaceTrack(existing, newVideo);
        else {
          try { await conf.removeTrack?.(existing); } catch {}
          await conf.addTrack(newVideo);
        }
      } finally {
        try { await this.safeDisposeTrack(existing, `replaceOrAddLocalVideoTrack:${reason}:old`); } catch {}
      }
      return;
    }

    await conf.addTrack(newVideo);
  }

  private async replaceOrAddLocalAudioTrack(newAudio: any, reason: string) {
    if (!this.conference || this.disposed) throw new Error("conference not ready");
    const conf = this.conference;

    const existing = this.getConferenceLocalAudioTrack();
    if (existing && existing !== newAudio) {
      try {
        if (typeof conf.replaceTrack === "function") await conf.replaceTrack(existing, newAudio);
        else {
          try { await conf.removeTrack?.(existing); } catch {}
          await conf.addTrack(newAudio);
        }
      } finally {
        try { await this.safeDisposeTrack(existing, `replaceOrAddLocalAudioTrack:${reason}:old`); } catch {}
      }
      return;
    }

    await conf.addTrack(newAudio);
  }

  // ========================================================================
  // QUALITY / VISIBLE
  // ========================================================================
  public setQualityMode(mode: "auto" | "low" | "medium" | "high") {
    this.qualityMode = mode;
    this.scheduleApplyVideoSubscriptions(150, true);
    this.health.tickSoon();
  }

  public setVisibleVideoParticipants(ids: string[]) {
    this.selectedVideoIds = Array.isArray(ids) ? ids : [];
    this.scheduleApplyVideoSubscriptions(150, false);
    this.health.tickSoon();
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

    try {
      const lvl = this.JitsiMeetJS?.logLevels?.ERROR;
      if (typeof lvl !== "undefined") this.JitsiMeetJS.setLogLevel(lvl);
    } catch {}

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
    } catch {}
  }

  // ========================================================================
  // ✅ HARD TOGGLE LOCAL VIDEO
  // ========================================================================
  private async disableLocalVideoHard(reason: string) {
    if (this.disposed || !this.conference || !this.localUserId) return;

    await this.bg.waitIdle();

    let track = this.localVideoTrack;
    const confExisting = this.getConferenceLocalVideoTrack();
    if (!track && confExisting) track = confExisting;

    if (!track) {
      const p = this.participants[this.localUserId];
      if (p) { p.videoMuted = true; this.emitParticipants(); }
      return;
    }

    try {
      // clear BG first (keep prefs)
      await this.bg.clearAnyBg(true, `disableLocalVideoHard:${reason}`);

      // refresh to real conf local video after BG cleared
      const nowConfVideo = this.getConferenceLocalVideoTrack();
      if (nowConfVideo) track = nowConfVideo;
      else if (this.localVideoTrack) track = this.localVideoTrack;

      try { await this.conference.removeTrack?.(track); } catch {}
      await this.safeDisposeTrack(track, `disableLocalVideoHard:${reason}`);

      // pointers reset but prefs preserved
      this.localVideoTrack = null;
      this.bg.resetForCameraStopped();

      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      if (entry.video) delete entry.video;
      this.tracksByParticipant.set(this.localUserId, entry);

      this.rebuildParticipantsFromTracks();

      const p = this.participants[this.localUserId];
      if (p) p.videoMuted = true;

      this.emitParticipants();

      this.scheduleApplyVideoSubscriptions(0, false);
      this.health.tickSoon();
    } catch (e) {
      console.warn("[cam] disableLocalVideoHard failed:", e);
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
            : {
                height: { ideal: 720, max: 720 },
                width: { ideal: 1280, max: 1280 },
                frameRate: { ideal: 30, max: 30 },
              },
        },
      });

      const newVideo = tracks.find((t: any) => t.getType?.() === "video");
      if (!newVideo) return;

      await this.replaceOrAddLocalVideoTrack(newVideo, `enableLocalVideoHard:${reason}`);

      // reset BG pointers, prefs stay
      this.bg.resetForNewCamera();
      this.localVideoTrack = newVideo;
      this.bg.onNewCameraTrack(newVideo);

      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      entry.video = newVideo;
      this.tracksByParticipant.set(this.localUserId, entry);

      this.rebuildParticipantsFromTracks();

      const p = this.participants[this.localUserId];
      if (p) p.videoMuted = newVideo.isMuted?.() === true ? true : false;

      this.emitParticipants();

      // re-apply bg if enabled
      setTimeout(() => {
        if (this.disposed) return;
        if (this.camToggling) return;
        this.bg.reapplyIfNeeded("enableLocalVideoHard");
      }, 0);

      this.scheduleApplyVideoSubscriptions(0, false);
      this.health.tickSoon();
    } catch (e) {
      console.warn("[cam] enableLocalVideoHard failed:", e);
      this.callbacks.onError?.("Failed to enable camera");
    }
  }

  async toggleVideoMute(): Promise<void> {
    return this.enqueueCamOp("toggleVideoMute", async () => {
      if (!this.localUserId) return;

      const local = this.participants[this.localUserId];
      if (!local) return;

      await this.bg.waitIdle();

      this.camToggling = true;
      try {
        const confTrack = this.getConferenceLocalVideoTrack();
        const hasVideoInConf = !!confTrack;
        const hasVideoInEngine = !!this.localVideoTrack;

        if (hasVideoInEngine || hasVideoInConf) {
          await this.disableLocalVideoHard("toggleVideoMute");
          local.videoMuted = true;
          this.emitParticipants();
          return;
        }

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
        console.warn("[cam] toggleVideoMute failed:", e);
      } finally {
        this.camToggling = false;
        this.scheduleApplyVideoSubscriptions(0, false);
        this.health.tickSoon();
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

      this.health.tickSoon();
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

    if (this.postJoinHealTimer) clearTimeout(this.postJoinHealTimer);
    this.postJoinHealTimer = null;

    if (this.resumeRecoverTimer) clearTimeout(this.resumeRecoverTimer);
    this.resumeRecoverTimer = null;

    try { (this as any).__resumeRemovers?.(); } catch {}
    (this as any).__resumeRemovers = null;
    this.resumeHandlersAttached = false;

    this.health.stop();

    // Clear BG (both modes)
    try { await this.bg.clearAnyBg(false, "dispose"); } catch {}

    // Dispose screenshare
    try {
      if (this.localScreenshareTrack) {
        try { await this.conference?.removeTrack?.(this.localScreenshareTrack); } catch {}
        await this.safeDisposeTrack(this.localScreenshareTrack, "dispose:screen");
        this.localScreenshareTrack = null;
      }
    } catch {}

    // Dispose audio
    try {
      if (this.localAudioTrack) {
        try { await this.conference?.removeTrack?.(this.localAudioTrack); } catch {}
        await this.safeDisposeTrack(this.localAudioTrack, "dispose:audio");
        this.localAudioTrack = null;
      }
    } catch {}

    // Dispose video outgoing
    try {
      const outgoing = this.localVideoTrack;
      if (outgoing) {
        try { await this.conference?.removeTrack?.(outgoing); } catch {}
        await this.safeDisposeTrack(outgoing, "dispose:video:outgoing");
      }
      this.localVideoTrack = null;
    } catch {}

    this.tracksByParticipant.clear();
    this.participants = {};
    this.emitParticipants();

    try { await this.conference?.leave?.(); } catch {}
    try { await this.connection?.disconnect?.(); } catch {}

    this.conference = null;
    this.connection = null;
    this.localUserId = null;
  }

  // ========================================================================
  // INTERNAL: conference setup
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

      this.health.start();

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

      this.health.tickSoon();
    });

    conf.on(events.conference.USER_LEFT, (id: string) => {
      if (this.disposed) return;

      delete this.participants[id];
      this.tracksByParticipant.delete(id);
      this.emitParticipants();

      this.health.unregisterParticipant(id);

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
      else { applySubsSoon(true); topologyChanged(); }

      this.health.tickSoon();
    });

    conf.on(events.conference.TRACK_REMOVED, (track: any) => {
      if (this.disposed) return;
      this.handleTrackRemoved(track);

      if (isLocalCameraOrAudio(track)) applySubsSoon(false);
      else { applySubsSoon(true); topologyChanged(); }

      this.health.tickSoon();
    });

    conf.on(events.conference.TRACK_MUTE_CHANGED, (track: any) => {
      if (this.disposed) return;
      this.handleTrackMuteChanged(track);

      applySubsSoon(false);
      this.health.tickSoon();
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
        if (type === "video") await this.replaceOrAddLocalVideoTrack(t, "createLocalTracks");
        else if (type === "audio") await this.replaceOrAddLocalAudioTrack(t, "createLocalTracks");
        else await this.conference.addTrack(t);

        if (type === "audio") this.localAudioTrack = t;
        if (type === "video") this.localVideoTrack = t;
      }

      // prewarm background pipeline for instant first click
      this.bg.prewarmReplaceTrackFactory();

      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      if (this.localAudioTrack) entry.audio = this.localAudioTrack;
      if (this.localVideoTrack) entry.video = this.localVideoTrack;
      this.tracksByParticipant.set(this.localUserId, entry);

      // apply bg prefs if any
      await this.bg.applyNow("createLocalTracks");

      this.schedulePostJoinSelfHeal();

      this.rebuildParticipantsFromTracks();
      this.emitParticipants();

      this.scheduleApplyVideoSubscriptions(0, true);
      this.scheduleHardResetSubscriptions(4500);

      this.health.tickSoon();
    } catch (e) {
      console.error("createLocalTracks error", e);
      this.callbacks.onError?.("Failed to access camera/microphone");
    }
  }

  // ========================================================================
  // LOCAL VIDEO RECOVERY (now BG-aware via BgManager)
  // ========================================================================
  private async ensureLocalVideoTrack(opts?: { reapplyBg?: boolean }): Promise<void> {
    const reapplyBg = opts?.reapplyBg !== false;

    if (this.disposed || !this.JitsiMeetJS || !this.conference) return;

    // if replaceTrack mode active, base track is stored in bg manager
    const impl = this.bg.getImplMode();
    const baseCandidate = impl === "replaceTrack" ? this.bg.getBaseVideoTrack() : this.localVideoTrack;

    try {
      const msAny = baseCandidate?.getOriginalStream?.();
      const ms = await Promise.resolve(msAny);
      const vt = ms?.getVideoTracks?.()?.[0];
      if (baseCandidate && vt && vt.readyState !== "ended") {
        // outgoing must exist too in replaceTrack mode
        if (impl !== "replaceTrack") return;

        if (this.localVideoTrack) {
          try {
            const outMsAny = this.localVideoTrack?.getOriginalStream?.();
            const outMs = await Promise.resolve(outMsAny);
            const outVt = outMs?.getVideoTracks?.()?.[0];
            if (outVt && outVt.readyState !== "ended") return;
          } catch {}
        }
      }
    } catch {}

    const tracks = await this.JitsiMeetJS.createLocalTracks({
      devices: ["video"],
      constraints: {
        video: this.mediaSettings.videoInputId ? { deviceId: { exact: this.mediaSettings.videoInputId } } : true,
      },
    });

    const newCamera = tracks.find((t: any) => t.getType?.() === "video");
    if (!newCamera) return;

    // If BG replaceTrack was active, clear bg first (keep prefs), then replace camera
    if (impl === "replaceTrack") {
      try { await this.bg.clearAnyBg(true, "ensureLocalVideoTrack:recreate"); } catch {}

      await this.replaceOrAddLocalVideoTrack(newCamera, "ensureLocalVideoTrack:replaceTrack");

      const oldOutgoing = this.localVideoTrack;
      this.localVideoTrack = newCamera;

      // bind bg base to this new camera
      this.bg.onNewCameraTrack(newCamera);

      if (this.localUserId) {
        const entry = this.tracksByParticipant.get(this.localUserId) || {};
        entry.video = newCamera;
        this.tracksByParticipant.set(this.localUserId, entry);
      }

      this.rebuildParticipantsFromTracks();
      this.emitParticipants();

      if (oldOutgoing && oldOutgoing !== newCamera) {
        await this.safeDisposeTrack(oldOutgoing, "ensureLocalVideoTrack:oldOutgoing");
      }

      if (reapplyBg) this.bg.reapplyIfNeeded("ensureLocalVideoTrack:re-enable");
      return;
    }

    // Non-replaceTrack path
    const oldVideo = this.localVideoTrack;

    if (oldVideo) {
      try { await this.bg.clearSetEffectOnTrack(oldVideo, "ensureLocalVideoTrack:clearOld"); } catch {}

      if (typeof this.conference.replaceTrack === "function") {
        await this.conference.replaceTrack(oldVideo, newCamera);
        await this.safeDisposeTrack(oldVideo, "ensureLocalVideoTrack:oldVideo");
      } else {
        try { await this.conference.removeTrack?.(oldVideo); } catch {}
        await this.safeDisposeTrack(oldVideo, "ensureLocalVideoTrack:oldVideo");
        await this.conference.addTrack(newCamera);
      }
    } else {
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

    if (reapplyBg) this.bg.reapplyIfNeeded("ensureLocalVideoTrack");
  }

  // ========================================================================
  // INPUT DEVICES (BG-aware)
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

    // if video changes and bg is active, temporarily clear bg (keep prefs)
    if (videoChanged && this.bg.getImplMode() === "replaceTrack" && this.mediaSettings.bgMode !== "none") {
      try { await this.bg.clearAnyBg(true, "applyInputDevices:pre-video-switch"); } catch {}
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
          // clear setEffect (if any) before switching device
          await this.bg.clearSetEffectOnTrack(this.localVideoTrack, "applyInputDevices:pre-setDevice");
          await this.localVideoTrack.setDevice(videoInputId);

          setTimeout(() => {
            void this.bg.applyNow("applyInputDevices:post-setDevice");
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
          try { await this.conference.removeTrack?.(oldAudio); } catch {}
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

        if (this.mediaSettings.bgMode !== "none") {
          await this.bg.clearAnyBg(true, "applyInputDevices:pre-video-replace");
        }

        if (oldVideo && typeof this.conference.replaceTrack === "function") {
          await this.conference.replaceTrack(oldVideo, newVideo);
          await this.safeDisposeTrack(oldVideo, "applyInputDevices:oldVideo");
          this.localVideoTrack = newVideo;
        } else if (oldVideo) {
          try { await this.conference.removeTrack?.(oldVideo); } catch {}
          await this.safeDisposeTrack(oldVideo, "applyInputDevices:oldVideo");
          await this.conference.addTrack(newVideo);
          this.localVideoTrack = newVideo;
        } else {
          await this.replaceOrAddLocalVideoTrack(newVideo, "applyInputDevices:newVideo");
          this.localVideoTrack = newVideo;
        }

        this.bg.onNewCameraTrack(this.localVideoTrack);
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

    this.bg.prewarmReplaceTrackFactory();
    await this.bg.applyNow("applyInputDevices:final");

    return { audio: this.localAudioTrack, video: this.localVideoTrack };
  }

  // ========================================================================
  // SUBSCRIPTIONS + HEALTH
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

      this.health.tickSoon();
    } catch {}
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

      try { this.conference.selectParticipants?.([]); } catch {}
      try { this.conference.setLastN?.(0); } catch {}

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
          this.health.tickSoon();
        }
      }, 220);
    } catch {
      this.subsHardResetInFlight = false;
    }
  }

  /** used by VideoHealthMonitor */
  private getSubscribedRemoteIds(): { ids: string[]; desiredLastN: number } {
    const finalRemoteIds = this.computeFinalRemoteIds();
    const desiredLastN = Math.min(finalRemoteIds.length, this.MAX_LAST_N);
    return { ids: finalRemoteIds.slice(0, desiredLastN), desiredLastN };
  }

  // ========================================================================
  // PARTICIPANTS + TRACKS
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

        if (!this.camToggling && !this.bg.isApplying() && this.bg.getImplMode() !== "replaceTrack") {
          this.bg.reapplyIfNeeded("TRACK_ADDED:localVideo");
        }
      }

      if (isLocal && type === "audio") this.localAudioTrack = track;
    }

    this.tracksByParticipant.set(pid, entry);
    this.rebuildParticipantsFromTracks();
    this.emitParticipants();

    this.health.tickSoon();
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
        // if we were in setEffect mode, clear effect on removed track (safe)
        if (this.bg.getImplMode() === "setEffect") {
          void this.bg.clearSetEffectOnTrack(track, "TRACK_REMOVED:localVideo");
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

    this.health.tickSoon();
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
        p.videoMuted = track.isMuted ? track.isMuted() : p.videoMuted;

        if (pid === this.localUserId) {
          try {
            const nowMuted = track.isMuted?.() === true;
            if (!nowMuted && !this.camToggling) {
              this.bg.reapplyIfNeeded("TRACK_MUTE_CHANGED:unmuted");
            }
          } catch {}
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

  // ========================================================================
  // SCREEN STOP
  // ========================================================================
  private async handleLocalScreenshareStopped() {
    if (!this.localScreenshareTrack || !this.conference || !this.localUserId) {
      this.localScreenshareTrack = null;
      return;
    }

    try { await this.conference.removeTrack(this.localScreenshareTrack); } catch {}
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

    this.health.tickSoon();
  }

  // ========================================================================
  // REACTIONS
  // ========================================================================
  private broadcastLocalEvent(ev: any) {
    if (!this.conference || !this.localUserId) return;

    const ids = Object.keys(this.participants);
    for (const id of ids) {
      if (id === this.localUserId) continue;
      try { this.conference.sendEndpointMessage(id, ev); } catch {}
    }
  }

  private handleEndpointMessage(senderId: string, payload: any) {
    if (!payload) return;
    if (payload.kind === "reaction" && payload.reaction) {
      this.callbacks.onReactionReceived?.(senderId, payload.reaction);
    }
  }

  // ========================================================================
  // RESUME / SELF-HEAL (unchanged logic, compacted)
  // ========================================================================
  private async resumeAllAudioElements() {
    try {
      const audios = Array.from(document.querySelectorAll("audio")) as HTMLAudioElement[];
      for (const a of audios) {
        try { await a.play().catch(() => {}); } catch {}
      }
    } catch {}
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
    await this.resumeAllAudioElements();
    await this.ensureLocalAudioTrack();
    await this.ensureLocalVideoTrack({ reapplyBg: true });
    this.health.tickSoon();
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

    const onFocus = () => { if (!this.disposed) this.scheduleResumeRecovery("focus"); };
    const onOnline = () => { if (!this.disposed) this.scheduleResumeRecovery("online"); };
    const onPageShow = (ev: any) => { if (!this.disposed && ev?.persisted) this.scheduleResumeRecovery("pageshow:bfcache"); };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);

    (this as any).__resumeRemovers = () => {
      try { document.removeEventListener("visibilitychange", onVisibility); } catch {}
      try { window.removeEventListener("focus", onFocus); } catch {}
      try { window.removeEventListener("online", onOnline); } catch {}
      try { window.removeEventListener("pageshow", onPageShow); } catch {}
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

      await this.bg.waitIdle();
      await this.camOpQueue.catch(() => {});

      await this.resumeAllAudioElements();
      await this.ensureLocalAudioTrack();
      await this.ensureLocalVideoTrack({ reapplyBg: true });

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
      } catch { return false; }
    }

    if (videoWanted) {
      try {
        const t = this.localVideoTrack || this.getConferenceLocalVideoTrack();
        const ms = await Promise.resolve(t?.getOriginalStream?.());
        const vt = ms?.getVideoTracks?.()?.[0];
        if (!vt || vt.readyState !== "live" || vt.enabled === false) return false;
      } catch { return false; }
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

    const savedMedia = { ...this.mediaSettings };
    const savedBg = this.bg.getPrefs();
    const savedQuality = this.qualityMode;
    const savedSelected = [...(this.selectedVideoIds || [])];

    await this.dispose().catch(() => {});
    this.disposed = false;

    this.mediaSettings = savedMedia;
    this.qualityMode = savedQuality;
    this.selectedVideoIds = savedSelected;

    // restore bg prefs
    await this.bg.setBackgroundEffect(savedBg);

    this.lastSubsKey = "";
    this.lastSubsAppliedAt = 0;
    this.hardResetCooldownUntil = 0;

    await this.initAndJoin(room, user);
  }

  // ========================================================================
  // LOCAL AUDIO SELF-HEAL
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
    } catch {}

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
    } catch {}

    try {
      const tracks = await this.JitsiMeetJS.createLocalTracks({
        devices: ["audio"],
        constraints: {
          audio: this.mediaSettings.audioInputId ? { deviceId: { exact: this.mediaSettings.audioInputId } } : true,
        },
      });

      const newAudio = tracks.find((t: any) => t.getType?.() === "audio") || null;
      if (!newAudio) return;

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

  // ========================================================================
  // EMIT
  // ========================================================================
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
}
