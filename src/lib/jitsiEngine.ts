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
  private subsWatchdog: any = null;

  // REAL BG EFFECT (Jitsi virtual background effect object)
  private videoEffect: JitsiStreamEffect | undefined = undefined;

  // Persisted bg prefs (to re-apply on track replacement)
  private bgPrefs: { mode: BgMode; imageUrl?: string } = { mode: "none" };

  // Guard: some builds fire TRACK_MUTE_CHANGED during setEffect and UI thinks "camera off"
  private bgApplying = false;

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

  // ---------------- BG EFFECT CORE ----------------
  private async clearBgEffectOnTrack(track: any) {
    if (!track) return;

    try {
      if (typeof track.setEffect === "function") {
        await track.setEffect(undefined);
      }
    } catch { }

    try {
      this.videoEffect?.dispose?.();
    } catch { }
    this.videoEffect = undefined;
  }

  private async applyBgEffectToTrack(track: any) {
    if (!track) return;

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

    // If user is muted right now — don't start heavy pipeline.
    // We'll apply after unmute (TRACK_MUTE_CHANGED handler already calls reapplyBgIfNeeded).
    if (wasMuted) return;

    if (this.bgPrefs.mode === "none") {
      await this.clearBgEffectOnTrack(track);
      return;
    }

    // recreate effect (simple + reliable)
    await this.clearBgEffectOnTrack(track);

    const effect = await createBackgroundEffect({
      mode: this.bgPrefs.mode,
      imageUrl: this.bgPrefs.imageUrl,
      blurValue: 25,
    });

    if (!effect) {
      console.warn("[bg] createBackgroundEffect returned empty");
      return;
    }

    this.bgApplying = true;
    try {
      await track.setEffect(effect);
      this.videoEffect = effect;

      // ✅ FIX: some builds "mute" track transiently during setEffect — restore
      try {
        const nowMuted = track.isMuted?.() === true;
        if (!wasMuted && nowMuted && typeof track.unmute === "function") {
          await track.unmute();
        }
      } catch { }
    } catch (e) {
      console.warn("[bg] setEffect failed, clearing:", e);
      try {
        await track.setEffect(undefined);
      } catch { }
      try {
        effect.dispose?.();
      } catch { }
      this.videoEffect = undefined;
    } finally {
      // give some time for TRACK_MUTE_CHANGED spam to settle
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

  // Public API: set bg prefs + apply now
  public async setBackgroundEffect(opts: { mode: BgMode; imageUrl?: string }) {
    this.bgPrefs = { mode: opts.mode, imageUrl: opts.imageUrl };

    // reflect in settings (UI)
    this.mediaSettings.bgMode = opts.mode;
    this.mediaSettings.bgImageUrl = opts.imageUrl;

    const t = this.localVideoTrack;
    if (!t) return;

    if (opts.mode === "none") {
      await this.clearBgEffectOnTrack(t);
      this.scheduleHardResetSubscriptions(0);
      return;
    }

    await this.applyBgEffectToTrack(t);
    this.scheduleHardResetSubscriptions(0);
  }

  // 0) Replace input devices (cam/mic) and re-apply background effect
  public async applyInputDevices(opts: { videoInputId: string; audioInputId: string }) {
    const { videoInputId, audioInputId } = opts;

    this.mediaSettings.videoInputId = videoInputId;
    this.mediaSettings.audioInputId = audioInputId;

    // 1) AUDIO: try setDevice (best)
    try {
      if (this.localAudioTrack && typeof this.localAudioTrack.setDevice === "function" && audioInputId) {
        await this.localAudioTrack.setDevice(audioInputId);
      }
    } catch (e) {
      console.warn("[applyInputDevices] audio setDevice failed:", e);
    }

    // 2) VIDEO: try setDevice (best)
    try {
      if (this.localVideoTrack && typeof this.localVideoTrack.setDevice === "function" && videoInputId) {
        // если эффекты включены — сначала прибери (чтобы пайплайн не залипал)
        await this.clearBgEffectOnTrack(this.localVideoTrack);
        await this.localVideoTrack.setDevice(videoInputId);

        // иногда Jitsi “заменяет” инстанс трека — тогда TRACK_ADDED обновит this.localVideoTrack
        // но на всякий случай попробуем переапплаить эффект чуть позже
        setTimeout(() => this.reapplyBgIfNeeded(), 0);
        return { audio: this.localAudioTrack, video: this.localVideoTrack };
      }
    } catch (e) {
      console.warn("[applyInputDevices] video setDevice failed:", e);
    }

    // 3) Fallback: recreate tracks (если setDevice нет)
    // ВАЖНО: здесь используем replaceTrack, чтобы не было "second video track"
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
      if (newAudio && this.localAudioTrack && typeof this.conference.replaceTrack === "function") {
        await this.conference.replaceTrack(this.localAudioTrack, newAudio);
        this.localAudioTrack.dispose?.();
        this.localAudioTrack = newAudio;
      } else if (newAudio && !this.localAudioTrack) {
        await this.conference.addTrack(newAudio);
        this.localAudioTrack = newAudio;
      }

      if (newVideo && this.localVideoTrack && typeof this.conference.replaceTrack === "function") {
        await this.clearBgEffectOnTrack(this.localVideoTrack);
        await this.conference.replaceTrack(this.localVideoTrack, newVideo);
        this.localVideoTrack.dispose?.();
        this.localVideoTrack = newVideo;
      } else if (newVideo && !this.localVideoTrack) {
        await this.conference.addTrack(newVideo);
        this.localVideoTrack = newVideo;
      }
    }

    // store + UI update
    if (this.localUserId) {
      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      if (this.localAudioTrack) entry.audio = this.localAudioTrack;
      if (this.localVideoTrack) entry.video = this.localVideoTrack;
      this.tracksByParticipant.set(this.localUserId, entry);
      this.rebuildParticipantsFromTracks();
      this.emitParticipants();
    }

    // re-apply persisted bg effect (если оно вообще возможно)
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

    // ✅ IMPORTANT: point Jitsi effects to your /libs assets
    this.JitsiMeetJS.init({
      disableP2P: true,
      disableAudioLevels: true,
      effects: {
        tfliteModel: "/libs/selfie_segmentation_landscape.tflite",
        tfliteWasm: "/libs/tflite.wasm",
        tfliteSimdWasm: "/libs/tflite-simd.wasm",
        tfjsWasm: "/libs/tfjs-backend-wasm.wasm",
        tfjsSimdWasm: "/libs/tfjs-backend-wasm-simd.wasm",
        tfjsThreadedSimdWasm: "/libs/tfjs-backend-wasm-threaded-simd.wasm",
      },
    });

    // quick sanity logs
    try {
      const hasEffects = !!this.JitsiMeetJS?.effects;
      const hasCreate = typeof this.JitsiMeetJS?.effects?.createVirtualBackgroundEffect === "function";
      console.log("[Jitsi] effects:", hasEffects, "createVirtualBackgroundEffect:", hasCreate);
    } catch { }

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

        // IMPORTANT: re-apply effect after unmute
        await this.reapplyBgIfNeeded();
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

      // debug (optional)
      try {
        console.log(
          "[dbg] localVideoTrack setEffect:",
          typeof (this.localVideoTrack as any)?.setEffect,
          "protoSetEffect:",
          typeof (window as any)?.JitsiMeetJS?.JitsiLocalTrack?.prototype?.setEffect
        );
      } catch { }

      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      if (this.localAudioTrack) entry.audio = this.localAudioTrack;
      if (this.localVideoTrack) entry.video = this.localVideoTrack;
      this.tracksByParticipant.set(this.localUserId, entry);

      // IMPORTANT: re-apply persisted background effect (if any)
      await this.reapplyBgIfNeeded();

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
    for (const id of uiRemoteIds) if (id && id !== localId && !finalRemoteIds.includes(id)) finalRemoteIds.push(id);

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

    if (this.isDesktopTrack(track)) {
      entry.screen = track;
    } else {
      const type = track.getType?.();
      if (type === "audio") entry.audio = track;
      if (type === "video") entry.video = track;

      // IMPORTANT: keep local pointers in sync if Jitsi replaces tracks
      if (isLocal && type === "video") {
        this.localVideoTrack = track;
        this.reapplyBgIfNeeded();
      }
      if (isLocal && type === "audio") {
        this.localAudioTrack = track;
      }
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
        // ✅ ignore transient mute events during setEffect
        if (!(pid === this.localUserId && this.bgApplying)) {
          p.videoMuted = track.isMuted ? track.isMuted() : p.videoMuted;
        }

        if (pid === this.localUserId) {
          try {
            const nowMuted = track.isMuted?.() === true;
            if (!nowMuted) this.reapplyBgIfNeeded();
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
