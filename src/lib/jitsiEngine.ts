// ============================================================================
// src/lib/jitsiEngine.ts — SFU-only (P2P OFF) + track-based + reactions + REAL background effects
// ============================================================================

import { createBackgroundEffect, BgMode, JitsiStreamEffect } from "./backgroundEffect";

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
const JITSI_CONFIG_URL = "https://" + JITSI_DOMAIN + "/config.js";
const JITSI_LIB_URL = "https://" + JITSI_DOMAIN + "/libs/lib-jitsi-meet.min.js";

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

  private tracksByParticipant = new Map<
    string,
    { audio?: JitsiTrack; video?: JitsiTrack; screen?: JitsiTrack }
  >();

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
  private subsWatchdog: any = null;

  // REAL BG EFFECT
  private videoEffect: JitsiStreamEffect | null = null;

  // BG PREFS (persist)
  private bgPrefs: { mode: BgMode; imageUrl?: string } = { mode: "none" as BgMode };

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

  // ========================================================================
  // BACKGROUND EFFECT (persist + reapply on track changes)
  // ========================================================================
  public async setBackgroundEffect(opts: { mode: BgMode; imageUrl?: string }) {
    // persist
    this.bgPrefs = { mode: opts.mode, imageUrl: opts.imageUrl };

    // keep mirror state
    this.mediaSettings.bgMode = opts.mode;
    this.mediaSettings.bgImageUrl = opts.imageUrl;

    // apply now (reapply)
    await this.reapplyBackgroundEffect();

    // subscription reset helps in some SFU builds after track pipeline change
    this.scheduleHardResetSubscriptions(0);
  }

  private async reapplyBackgroundEffect() {
    const mode = this.bgPrefs?.mode || ("none" as BgMode);
    const imageUrl = this.bgPrefs?.imageUrl;

    console.log("[bg] reapply", mode, "imageUrl", imageUrl);
    console.log("[bg] has localVideoTrack", !!this.localVideoTrack);
    console.log("[bg] has setEffect", typeof (this.localVideoTrack as any)?.setEffect);
    console.log("[bg] has JitsiMeetJS.effects", !!(window as any).JitsiMeetJS?.effects);

    const t: any = this.localVideoTrack;
    if (!t) return;

    const hasSetEffect = typeof t.setEffect === "function";
    if (!hasSetEffect) {
      console.warn("[JitsiEngine] localVideoTrack.setEffect is not available in this lib-jitsi-meet build");
      return;
    }

    // clear effect
    if (mode === "none") {
      try {
        await t.setEffect(null);
      } catch { }
      try {
        this.videoEffect?.dispose?.();
      } catch { }
      this.videoEffect = null;
      return;
    }

    // create/update effect instance
    if (!this.videoEffect) {
      this.videoEffect = createBackgroundEffect({
        mode,
        imageUrl,
        blurPx: 14,
        maskBlurPx: 6,
        fps: 30,
      });
    } else {
      this.videoEffect.setConfig?.({ mode, imageUrl });
    }

    try {
      await t.setEffect(this.videoEffect);
    } catch (e) {
      console.warn("[JitsiEngine] setEffect failed, fallback to none:", e);
      try {
        await t.setEffect(null);
      } catch { }
    }
  }

  // 0) Replace input devices (cam/mic) and re-apply background effect
  public async applyInputDevices(opts: { videoInputId: string; audioInputId: string }) {
    const { videoInputId, audioInputId } = opts;

    this.mediaSettings.videoInputId = videoInputId;
    this.mediaSettings.audioInputId = audioInputId;

    try {
      if (this.localAudioTrack) {
        await this.conference?.removeTrack?.(this.localAudioTrack);
        this.localAudioTrack.dispose?.();
        this.localAudioTrack = null;
      }
      if (this.localVideoTrack) {
        // clear effect before removing track (avoids dangling canvases in some builds)
        try {
          await this.localVideoTrack.setEffect?.(null);
        } catch { }
        await this.conference?.removeTrack?.(this.localVideoTrack);
        this.localVideoTrack.dispose?.();
        this.localVideoTrack = null;
      }
    } catch { }

    const JitsiMeetJS = (window as any).JitsiMeetJS;
    if (!JitsiMeetJS?.createLocalTracks) {
      throw new Error("JitsiMeetJS.createLocalTracks not found");
    }

    const tracks = await JitsiMeetJS.createLocalTracks({
      devices: ["audio", "video"],
      constraints: {
        audio: audioInputId ? { deviceId: { exact: audioInputId } } : true,
        video: videoInputId ? { deviceId: { exact: videoInputId } } : true,
      },
    });

    for (const t of tracks) {
      const type = t.getType?.();
      if (type === "audio") this.localAudioTrack = t;
      if (type === "video") this.localVideoTrack = t;
    }

    if (this.conference) {
      if (this.localAudioTrack) await this.conference.addTrack(this.localAudioTrack);
      if (this.localVideoTrack) await this.conference.addTrack(this.localVideoTrack);
    }

    // update store
    if (this.localUserId) {
      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      if (this.localAudioTrack) entry.audio = this.localAudioTrack;
      if (this.localVideoTrack) entry.video = this.localVideoTrack;
      this.tracksByParticipant.set(this.localUserId, entry);
      this.rebuildParticipantsFromTracks();
      this.emitParticipants();
    }

    // re-apply background effect ALWAYS (none/blur/image) after new localVideoTrack is set
    await this.reapplyBackgroundEffect();

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

    this.JitsiMeetJS.setLogLevel(this.JitsiMeetJS.logLevels.ERROR);

    this.JitsiMeetJS.init({
      disableP2P: true,
      disableAudioLevels: true,
    });

    const serviceUrl =
      this.config.websocket || this.config.bosh || `wss://${JITSI_DOMAIN}/xmpp-websocket`;

    const options = {
      hosts: this.config.hosts,
      serviceUrl,
      clientNode: this.config.clientNode,
      p2p: { enabled: false },
    };

    const connection = new this.JitsiMeetJS.JitsiConnection(null, undefined, options);
    this.connection = connection;

    connection.addEventListener(
      this.JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
      () => {
        if (this.disposed) return;
        this.setupConference(roomName, userName);
      }
    );

    connection.addEventListener(
      this.JitsiMeetJS.events.connection.CONNECTION_FAILED,
      () => {
        if (this.disposed) return;
        this.callbacks.onError?.("Jitsi connection failed");
      }
    );

    connection.addEventListener?.(
      this.JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
      () => {
        if (this.disposed) return;
        this.callbacks.onError?.("Jitsi connection disconnected");
      }
    );

    connection.connect();
  }

  public sendReaction(type: string) {
    this.broadcastLocalEvent({ kind: "reaction", reaction: type });
  }

  public setQualityMode(mode: "auto" | "low" | "medium" | "high") {
    this.qualityMode = mode;
    this.scheduleApplyVideoSubscriptions();
  }

  public setVisibleVideoParticipants(ids: string[]) {
    this.selectedVideoIds = Array.isArray(ids) ? ids : [];
    this.scheduleApplyVideoSubscriptions();
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
    const local = this.participants[this.localUserId];
    if (!local || !this.localVideoTrack) return;

    const track = this.localVideoTrack;
    try {
      if (track.isMuted && track.isMuted()) {
        await track.unmute();
        local.videoMuted = false;
      } else {
        await track.mute();
        local.videoMuted = true;
      }
      this.emitParticipants();
      this.scheduleHardResetSubscriptions(0);
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
      this.scheduleHardResetSubscriptions(0);
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

    try {
      this.videoEffect?.dispose?.();
    } catch { }
    this.videoEffect = null;

    try {
      if (this.localScreenshareTrack) {
        try { await this.conference?.removeTrack?.(this.localScreenshareTrack); } catch { }
        try { this.localScreenshareTrack.dispose?.(); } catch { }
        this.localScreenshareTrack = null;
      }
    } catch { }

    try {
      if (this.localAudioTrack) {
        try { await this.conference?.removeTrack?.(this.localAudioTrack); } catch { }
        try { this.localAudioTrack.dispose?.(); } catch { }
        this.localAudioTrack = null;
      }
      if (this.localVideoTrack) {
        try { await this.localVideoTrack.setEffect?.(null); } catch { }
        try { await this.conference?.removeTrack?.(this.localVideoTrack); } catch { }
        try { this.localVideoTrack.dispose?.(); } catch { }
        this.localVideoTrack = null;
      }
    } catch { }

    this.tracksByParticipant.clear();
    this.participants = {};
    this.emitParticipants();

    try { await this.conference?.leave?.(); } catch { }
    try { await this.connection?.disconnect?.(); } catch { }

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

    const applySubsSoon = () => {
      if (this.disposed) return;
      clearTimeout((this as any).__applySubsT);
      (this as any).__applySubsT = setTimeout(() => {
        if (this.disposed) return;
        this.scheduleApplyVideoSubscriptions(0);
      }, 50);
    };

    const updateRemoteSubscriptions = () => {
      if (!this.conference) return;
      this.scheduleApplyVideoSubscriptions(0);
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
      updateRemoteSubscriptions();

      if (this.subsWatchdog) clearInterval(this.subsWatchdog);
      this.subsWatchdog = setInterval(() => {
        if (this.disposed) return;
        this.scheduleApplyVideoSubscriptions(0);
      }, 3000);

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
      updateRemoteSubscriptions();
    });

    conf.on(events.conference.USER_LEFT, (id: string) => {
      if (this.disposed) return;

      delete this.participants[id];
      this.tracksByParticipant.delete(id);
      this.emitParticipants();
      updateRemoteSubscriptions();
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
      applySubsSoon();
      this.scheduleHardResetSubscriptions(120);
    });

    conf.on(events.conference.TRACK_REMOVED, (track: any) => {
      if (this.disposed) return;
      this.handleTrackRemoved(track);
      applySubsSoon();
      this.scheduleHardResetSubscriptions(120);
    });

    conf.on(events.conference.TRACK_MUTE_CHANGED, (track: any) => {
      if (this.disposed) return;
      this.handleTrackMuteChanged(track);
      applySubsSoon();
      this.scheduleHardResetSubscriptions(120);
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
          audio: this.mediaSettings.audioInputId
            ? { deviceId: { exact: this.mediaSettings.audioInputId } }
            : true,
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

      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      if (this.localAudioTrack) entry.audio = this.localAudioTrack;
      if (this.localVideoTrack) entry.video = this.localVideoTrack;
      this.tracksByParticipant.set(this.localUserId, entry);

      // Apply (or clear) background effect after localVideoTrack is created
      await this.reapplyBackgroundEffect();

      this.rebuildParticipantsFromTracks();
      this.emitParticipants();
      this.scheduleHardResetSubscriptions(0);
    } catch (e) {
      console.error("createLocalTracks error", e);
      this.callbacks.onError?.("Failed to access camera/microphone");
    }
  }

  // ========================================================================
  // VIDEO SUBSCRIPTIONS
  // ========================================================================
  private scheduleApplyVideoSubscriptions(delayMs: number = 150) {
    if (!this.conference || this.disposed) return;
    if (this.subsApplyTimer) clearTimeout(this.subsApplyTimer);
    this.subsApplyTimer = setTimeout(() => {
      this.subsApplyTimer = null;
      this.applyVideoSubscriptions();
    }, delayMs);
  }

  private scheduleHardResetSubscriptions(delayMs: number = 120) {
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
    const screens: string[] = [];
    const videos: string[] = [];

    for (const [pid, tracks] of this.tracksByParticipant.entries()) {
      if (!pid) continue;
      if (localId && pid === localId) continue;

      if (tracks?.screen) screens.push(pid);
      if (tracks?.video) videos.push(pid);
    }

    const out: string[] = [];
    for (const id of screens) if (!out.includes(id)) out.push(id);
    for (const id of videos) if (!out.includes(id)) out.push(id);
    return out;
  }

  private computeFinalRemoteIds(): string[] {
    const localId = this.localUserId;

    const uiRemoteIds = (this.selectedVideoIds || []).filter((id) => id && id !== localId);
    const activeRemoteIds = this.getRemoteIdsWithAnyVideoOrScreen();

    const finalRemoteIds: string[] = [];
    for (const id of activeRemoteIds)
      if (id && id !== localId && !finalRemoteIds.includes(id)) finalRemoteIds.push(id);
    for (const id of uiRemoteIds)
      if (id && id !== localId && !finalRemoteIds.includes(id)) finalRemoteIds.push(id);

    return finalRemoteIds;
  }

  private applyVideoSubscriptions() {
    if (!this.conference) return;

    try {
      const finalRemoteIds = this.computeFinalRemoteIds();
      const desiredLastN = Math.min(finalRemoteIds.length, this.MAX_LAST_N);

      this.conference.setLastN?.(desiredLastN);

      const h = this.pickReceiverConstraintHeight(desiredLastN);
      this.conference.setReceiverVideoConstraint?.(h);
      this.conference.setReceiverAudioConstraint?.(true);

      if (typeof this.conference.selectParticipants === "function") {
        this.conference.selectParticipants(finalRemoteIds.slice(0, desiredLastN));
      }
    } catch { }
  }

  private hardResetAndApplyVideoSubscriptions() {
    if (!this.conference || this.subsHardResetInFlight) return;

    this.subsHardResetInFlight = true;

    try {
      const finalRemoteIds = this.computeFinalRemoteIds();
      const desiredLastN = Math.min(finalRemoteIds.length, this.MAX_LAST_N);
      const h = this.pickReceiverConstraintHeight(desiredLastN);

      try { this.conference.selectParticipants?.([]); } catch { }
      try { this.conference.setLastN?.(0); } catch { }

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
        } catch {
          // ignore
        } finally {
          this.subsHardResetInFlight = false;
        }
      }, 180);
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

    if (this.isDesktopTrack(track)) entry.screen = track;
    else {
      const type = track.getType?.();
      if (type === "audio") entry.audio = track;
      if (type === "video") entry.video = track;
    }

    this.tracksByParticipant.set(pid, entry);
    this.rebuildParticipantsFromTracks();
    this.emitParticipants();
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
  }

  private handleTrackMuteChanged(track: any) {
    const pid = this.resolveTrackParticipantId(track);
    if (!pid) return;

    const p = this.participants[pid];
    if (!p) return;

    const type = track.getType?.();
    if (type === "audio") p.audioMuted = track.isMuted ? track.isMuted() : p.audioMuted;
    else if (type === "video") {
      if (!this.isDesktopTrack(track)) p.videoMuted = track.isMuted ? track.isMuted() : p.videoMuted;
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

    try { await this.conference.removeTrack(this.localScreenshareTrack); } catch { }
    try { this.localScreenshareTrack.dispose?.(); } catch { }

    const pid = this.localUserId;
    const entry = this.tracksByParticipant.get(pid);
    if (entry?.screen === this.localScreenshareTrack) {
      delete entry.screen;
      this.tracksByParticipant.set(pid, entry);
    }

    this.localScreenshareTrack = null;

    this.rebuildParticipantsFromTracks();
    this.emitParticipants();
    this.scheduleHardResetSubscriptions(0);
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
