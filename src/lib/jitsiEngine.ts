// ============================================================================
// src/lib/jitsiEngine.ts — SFU-only (P2P OFF) + track-based + reactions via endpoint messages
// Fixes: "3+ participants => everyone sees mostly self / remote audio missing / broken P2P"
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

const JITSI_DOMAIN = "jitsi.lukassodesign.site";
const JITSI_CONFIG_URL = "https://" + JITSI_DOMAIN + "/config.js";
const JITSI_LIB_URL = "https://" + JITSI_DOMAIN + "/libs/lib-jitsi-meet.min.js";

// Жёстко запрещаем P2P. Для продукта 2→100+ это must-have.
const DISABLE_P2P = true;

// Сколько remote video подписывать одновременно (аудио не зависит от lastN)
const LAST_N = 20;

let jitsiLoaderPromise: Promise<void> | null = null;

// ============================================================================
// SCRIPT LOADER
// ============================================================================
async function loadJitsiScripts(): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Jitsi can only be loaded in browser");
  }

  if (window.JitsiMeetJS && window.config) {
    return;
  }

  if (jitsiLoaderPromise) return jitsiLoaderPromise;

  jitsiLoaderPromise = new Promise<void>((resolve, reject) => {
    let loaded = 0;

    const done = () => {
      loaded += 1;
      if (loaded === 2) {
        if (window.JitsiMeetJS && window.config) {
          resolve();
        } else {
          reject(new Error("Jitsi scripts loaded but globals are missing"));
        }
      }
    };

    const onError = (src: string) => {
      reject(new Error("Failed to load Jitsi script: " + src));
    };

    if (!document.querySelector('script[src="' + JITSI_CONFIG_URL + '"]')) {
      const scConfig = document.createElement("script");
      scConfig.src = JITSI_CONFIG_URL;
      scConfig.async = true;
      scConfig.onload = done;
      scConfig.onerror = () => onError(JITSI_CONFIG_URL);
      document.head.appendChild(scConfig);
    } else {
      done();
    }

    if (!document.querySelector('script[src="' + JITSI_LIB_URL + '"]')) {
      const scLib = document.createElement("script");
      scLib.src = JITSI_LIB_URL;
      scLib.async = true;
      scLib.onload = done;
      scLib.onerror = () => onError(JITSI_LIB_URL);
      document.head.appendChild(scLib);
    } else {
      done();
    }
  });

  return jitsiLoaderPromise;
}

// ============================================================================
// JITSI ENGINE
// ============================================================================
export class JitsiEngine {
  private callbacks: JitsiEngineCallbacks;
  private subsWatchdog: any = null;
  private JitsiMeetJS: any | null = null;
  private config: any | null = null;
  private connection: any | null = null;
  private conference: any | null = null;
  // DTO participants (UI-friendly). НЕ источник истины для треков.
  private participants: Record<string, JitsiParticipant> = {};
  private localUserId: string | null = null;

  // Track store — источник истины для audio/video/screen
  private tracksByParticipant = new Map<
    string,
    { audio?: JitsiTrack; video?: JitsiTrack; screen?: JitsiTrack }
  >();

  // Локальные треки отдельно (для toggle/dispose)
  private localAudioTrack: JitsiTrack | null = null;
  private localVideoTrack: JitsiTrack | null = null;
  private localScreenshareTrack: JitsiTrack | null = null;

  private disposed = false;

  constructor(callbacks: JitsiEngineCallbacks = {}) {
    this.callbacks = callbacks;
  }

  // ========================================================================
  // PUBLIC API
  // ========================================================================
  async initAndJoin(roomName: string, userName: string): Promise<void> {
    await loadJitsiScripts();

    this.JitsiMeetJS = window.JitsiMeetJS;
    this.config = window.config;

    if (!this.JitsiMeetJS || !this.config) {
      throw new Error("Jitsi globals not available");
    }

    this.JitsiMeetJS.setLogLevel(this.JitsiMeetJS.logLevels.ERROR);

    // ВАЖНО: отключаем P2P на уровне init
    this.JitsiMeetJS.init({
      disableP2P: true,
      disableAudioLevels: true,
    });

    const serviceUrl =
      this.config.websocket ||
      this.config.bosh ||
      ("wss://" + JITSI_DOMAIN + "/xmpp-websocket");

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

  // локальный юзер кликает реакцию
  public sendReaction(type: string) {
    this.broadcastLocalEvent({ kind: "reaction", reaction: type });
  }

  // ========== VIDEO SUBSCRIPTIONS (UI-aware) ==========
  private selectedVideoIds: string[] = [];
  private qualityMode: "auto" | "low" | "medium" | "high" = "auto";

  // верхний потолок, чтобы случайно не подписаться на 100 видеопотоков
  private readonly MAX_LAST_N = 36;

  // debounce applyVideoSubscriptions
  private subsApplyTimer: any = null;

  public setQualityMode(mode: "auto" | "low" | "medium" | "high") {
    this.qualityMode = mode;
    this.scheduleApplyVideoSubscriptions();
  }

  public setVisibleVideoParticipants(ids: string[]) {
    // ids должны быть REMOTE (можно передать и local — мы отфильтруем ниже)
    this.selectedVideoIds = Array.isArray(ids) ? ids : [];
    this.scheduleApplyVideoSubscriptions();
  }

  private scheduleApplyVideoSubscriptions(delayMs: number = 150) {
    if (!this.conference) return;
    if (this.disposed) return;

    try {
      if (this.subsApplyTimer) clearTimeout(this.subsApplyTimer);
      this.subsApplyTimer = setTimeout(() => {
        this.subsApplyTimer = null;
        this.applyVideoSubscriptions();
      }, delayMs);
    } catch {
      // ignore
    }
  }

  private pickReceiverConstraintHeight(n: number): number {
    // глобальный max-height (Jitsi потом сам выберет layer/битрейт, если simulcast включён)
    if (this.qualityMode === "high") return 720;
    if (this.qualityMode === "medium") return 360;
    if (this.qualityMode === "low") return 180;

    // auto:
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

    // screens first
    const out: string[] = [];
    for (const id of screens) if (!out.includes(id)) out.push(id);
    for (const id of videos) if (!out.includes(id)) out.push(id);
    return out;
  }

  private applyVideoSubscriptions() {
    if (!this.conference) return;

    try {
      const localId = this.localUserId;

      // только remote ids из UI
      const uiRemoteIds = (this.selectedVideoIds || []).filter((id) => id && id !== localId);

      // fallback: если UI ещё не успел пересчитать, или треки только что появились
      const activeRemoteIds = this.getRemoteIdsWithAnyVideoOrScreen();

      // финальный приоритетный список:
      // 1) активные screen/video (чтобы не зависеть от "порядка включения")
      // 2) UI-visible ids (если есть, но без дублей)
      const finalRemoteIds: string[] = [];

      for (const id of activeRemoteIds) {
        if (id && id !== localId && !finalRemoteIds.includes(id)) finalRemoteIds.push(id);
      }
      for (const id of uiRemoteIds) {
        if (id && id !== localId && !finalRemoteIds.includes(id)) finalRemoteIds.push(id);
      }

      // lastN = сколько remote video реально хотим
      const desiredLastN = Math.min(finalRemoteIds.length, this.MAX_LAST_N);

      this.conference.setLastN?.(desiredLastN);

      const h = this.pickReceiverConstraintHeight(desiredLastN);
      this.conference.setReceiverVideoConstraint?.(h);
      this.conference.setReceiverAudioConstraint?.(true);

      if (typeof this.conference.selectParticipants === "function") {
        this.conference.selectParticipants(finalRemoteIds.slice(0, desiredLastN));
      }

      // optional debug
      console.log("[JITSI] applyVideoSubscriptions", {
        desiredLastN,
        receiverMaxHeight: h,
        selected: finalRemoteIds.slice(0, desiredLastN).length,
      });
    } catch (e) {
      console.warn("[JITSI] applyVideoSubscriptions failed", e);
    }
  }

  private broadcastLocalEvent(ev: any) {
    // Реакции/сигналы: только endpoint messages (надежно и не зависит от P2P)
    if (!this.conference || !this.localUserId) return;

    const ids = Object.keys(this.participants);
    for (const id of ids) {
      if (id === this.localUserId) continue;
      try {
        this.conference.sendEndpointMessage(id, ev);
      } catch {
        // ignore
      }
    }
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
    } catch (e) {
      console.error("toggleAudioMute error", e);
    }
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
      this.scheduleApplyVideoSubscriptions(0);
    } catch (e) {
      console.error("toggleVideoMute error", e);
    }
  }

  async toggleScreenShare(): Promise<void> {
    if (!this.conference || !this.JitsiMeetJS || !this.localUserId) return;

    // stop (через нашу кнопку)
    if (this.localScreenshareTrack) {
      await this.handleLocalScreenshareStopped();
      return;
    }

    // start
    try {
      const tracks = await this.JitsiMeetJS.createLocalTracks({
        devices: ["desktop"],
      });

      const screenTrack =
        tracks.find((t: any) => this.isDesktopTrack(t)) ||
        tracks.find((t: any) => t.getType && t.getType() === "desktop");

      if (!screenTrack) return;

      this.localScreenshareTrack = screenTrack;

      // подписка на локальный STOP (когда юзер жмёт "Stop sharing" в браузере)
      const trackEvents = this.JitsiMeetJS.events?.track;
      if (trackEvents?.LOCAL_TRACK_STOPPED) {
        screenTrack.addEventListener(trackEvents.LOCAL_TRACK_STOPPED, () => {
          this.handleLocalScreenshareStopped();
        });
      }

      await this.conference.addTrack(screenTrack);

      // обновляем track-store (источник истины)
      const pid = this.localUserId;
      const entry = this.tracksByParticipant.get(pid) || {};
      entry.screen = screenTrack;
      this.tracksByParticipant.set(pid, entry);

      this.rebuildParticipantsFromTracks();
      this.emitParticipants();
      this.scheduleApplyVideoSubscriptions(0);
    } catch (e) {
      console.error("toggleScreenShare error", e);
      this.callbacks.onError?.("Screen share failed");
    }
  }

  private async handleLocalScreenshareStopped() {
    if (!this.localScreenshareTrack || !this.conference || !this.localUserId) {
      this.localScreenshareTrack = null;
      return;
    }

    try {
      await this.conference.removeTrack(this.localScreenshareTrack);
    } catch {
      // ignore
    }
    try {
      this.localScreenshareTrack.dispose?.();
    } catch {
      // ignore
    }

    // чистим store
    const pid = this.localUserId;
    const entry = this.tracksByParticipant.get(pid);
    if (entry?.screen === this.localScreenshareTrack) {
      delete entry.screen;
      this.tracksByParticipant.set(pid, entry);
    }

    this.localScreenshareTrack = null;

    this.rebuildParticipantsFromTracks();
    this.emitParticipants();
    this.scheduleApplyVideoSubscriptions(0);
  }

  async dispose(): Promise<void> {
    this.disposed = true;

    if (this.subsApplyTimer) {
      clearTimeout(this.subsApplyTimer);
      this.subsApplyTimer = null;
    }

    // stop watchdog
    if (this.subsWatchdog) {
      clearInterval(this.subsWatchdog);
      this.subsWatchdog = null;
    }

    // Локальный screenshare
    try {
      if (this.localScreenshareTrack) {
        try {
          await this.conference?.removeTrack(this.localScreenshareTrack);
        } catch { }
        try {
          this.localScreenshareTrack.dispose?.();
        } catch { }
        this.localScreenshareTrack = null;
      }
    } catch {
      // ignore
    }

    // Локальные A/V треки
    try {
      if (this.localAudioTrack) {
        try {
          await this.conference?.removeTrack(this.localAudioTrack);
        } catch { }
        try {
          this.localAudioTrack.dispose?.();
        } catch { }
        this.localAudioTrack = null;
      }
      if (this.localVideoTrack) {
        try {
          await this.conference?.removeTrack(this.localVideoTrack);
        } catch { }
        try {
          this.localVideoTrack.dispose?.();
        } catch { }
        this.localVideoTrack = null;
      }
    } catch {
      // ignore
    }

    // Не пытаемся dispose remote tracks вручную — Jitsi сам управляет их жизненным циклом.
    this.tracksByParticipant.clear();

    this.participants = {};
    this.emitParticipants();

    try {
      await this.conference?.leave();
    } catch {
      // ignore
    }

    try {
      await this.connection?.disconnect();
    } catch {
      // ignore
    }

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

    // Дублируем запрет P2P на уровне конференции (belt+suspenders)
    if (DISABLE_P2P) {
      conferenceOptions.p2p = { enabled: false };
      conferenceOptions.disableP2P = true;
    }

    if (userName) {
      conferenceOptions.statisticsId = userName.toLowerCase();
    }

    const baseRoomName = roomName && roomName.trim().length > 0 ? roomName : "default-room";

    let safeRoomName = baseRoomName.toLowerCase().replace(/[^a-z0-9-_]/g, "");

    if (!safeRoomName) {
      safeRoomName = "session-" + Math.random().toString(36).substring(2, 8);
    }

    console.log("Joining Jitsi room:", {
      rawRoomName: roomName,
      safeRoomName,
      disableP2P: DISABLE_P2P,
    });

    const conf = this.connection.initJitsiConference(safeRoomName, conferenceOptions);
    this.conference = conf;

    console.log("[JITSI] conf created", {
      room: safeRoomName,
      serviceUrl: this.config?.websocket || this.config?.bosh,
      disableP2P: DISABLE_P2P,
    });

    const events = this.JitsiMeetJS.events;

    const applySubsSoon = () => {
      if (this.disposed) return;
      // debounce на микротик, чтобы несколько событий подряд схлопнулись в 1 apply
      clearTimeout((this as any).__applySubsT);
      (this as any).__applySubsT = setTimeout(() => {
        if (this.disposed) return;
        this.applyVideoSubscriptions();
      }, 50);
    };

    const updateRemoteSubscriptions = () => {
      if (!this.conference) return;
      this.scheduleApplyVideoSubscriptions(0);
    };

    // ------------------------ CONFERENCE_JOINED ------------------------
    conf.on(events.conference.CONFERENCE_JOINED, () => {
      if (this.disposed) return;

      const anyConf = conf as any;
      let localId: string | null = null;

      if (typeof anyConf.getLocalUserId === "function") {
        localId = anyConf.getLocalUserId();
      } else if (typeof anyConf.myUserId === "function") {
        localId = anyConf.myUserId();
      }

      console.log("[JITSI] joined", { localId });

      if (!localId) {
        this.callbacks.onError?.("Failed to resolve local user id");
        return;
      }

      this.localUserId = localId;

      // имя из Supabase → в Jitsi
      if (userName && typeof anyConf.setDisplayName === "function") {
        anyConf.setDisplayName(userName);
      }

      // создаём local participant DTO
      this.ensureLocalParticipant(userName);

      // создаём пустую запись в track-store для local
      if (!this.tracksByParticipant.has(localId)) {
        this.tracksByParticipant.set(localId, {});
      }

      this.callbacks.onConferenceJoin?.();

      // CRITICAL: включаем приём remote (после join)
      updateRemoteSubscriptions();

      // watchdog — помогает восстановиться после перегруза/залипания
      if (this.subsWatchdog) clearInterval(this.subsWatchdog);
      this.subsWatchdog = setInterval(() => {
        if (this.disposed) return;
        this.scheduleApplyVideoSubscriptions(0);
      }, 3000);

      // ⚠️ ВАЖНО: даём Jitsi микротик, чтобы conference полностью инициализировался
      setTimeout(() => {
        if (this.disposed) return;
        this.createLocalTracks();
      }, 0);
    });

    // --------------------------- USER_JOINED ---------------------------
    conf.on(events.conference.USER_JOINED, (id: string, user: any) => {
      if (this.disposed) return;

      console.log("[JITSI] user joined", { id, name: user?._displayName });

      this.ensureRemoteParticipant(id, user?._displayName || "Guest");

      // Инициализируем store для remote (track events могут прийти чуть позже)
      if (!this.tracksByParticipant.has(id)) {
        this.tracksByParticipant.set(id, {});
      }

      this.emitParticipants();

      // CRITICAL: пересчёт подписок при новом юзере
      updateRemoteSubscriptions();
    });

    // --------------------------- USER_LEFT -----------------------------
    conf.on(events.conference.USER_LEFT, (id: string) => {
      if (this.disposed) return;

      console.log("[JITSI] user left", { id });

      delete this.participants[id];
      this.tracksByParticipant.delete(id);

      this.emitParticipants();

      updateRemoteSubscriptions();
    });

    // ----------------------- DISPLAY_NAME_CHANGED ----------------------
    conf.on(events.conference.DISPLAY_NAME_CHANGED, (id: string, displayName: string) => {
      if (this.disposed) return;
      const p = this.participants[id];
      if (p) {
        p.displayName = displayName || p.displayName;
      } else {
        this.ensureRemoteParticipant(id, displayName || "Guest");
      }
      this.emitParticipants();
    });

    // -------------------------- TRACKS ---------------------------------
    conf.on(events.conference.TRACK_ADDED, (track: any) => {
      if (this.disposed) return;
      this.handleTrackAdded(track);
      applySubsSoon();
    });

    conf.on(events.conference.TRACK_REMOVED, (track: any) => {
      if (this.disposed) return;
      this.handleTrackRemoved(track);
      applySubsSoon();
    });

    conf.on(events.conference.TRACK_MUTE_CHANGED, (track: any) => {
      if (this.disposed) return;
      this.handleTrackMuteChanged(track);
      applySubsSoon();
    });

    // ------------------- ENDPOINT MESSAGE (reactions) -------------------
    conf.on(events.conference.ENDPOINT_MESSAGE_RECEIVED, (senderId: string, payload: any) => {
      this.handleEndpointMessage(senderId, payload);
    });

    conf.join();
  }

  // ========================================================================
  // PARTICIPANTS (DTO layer)
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
      // обновим имя если пришло
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
  // TRACKS (source of truth)
  // ========================================================================
  private async createLocalTracks() {
    if (!this.JitsiMeetJS || !this.conference || !this.localUserId) return;

    try {
      const tracks = await this.JitsiMeetJS.createLocalTracks({
        devices: ["audio", "video"],
        // часто работает:
        resolution: 720,
        constraints: {
          video: {
            height: { ideal: 720, max: 720 },
            width: { ideal: 1280, max: 1280 },
            frameRate: { ideal: 30, max: 30 },
          },
        },
      });

      for (const track of tracks) {
        const t = track;
        const type = t.getType?.();

        await this.conference.addTrack(t);

        // сохраняем ссылки на локальные треки
        if (type === "audio") this.localAudioTrack = t;
        if (type === "video") this.localVideoTrack = t;
      }

      // Обновляем store на локального
      const entry = this.tracksByParticipant.get(this.localUserId) || {};
      if (this.localAudioTrack) entry.audio = this.localAudioTrack;
      if (this.localVideoTrack) entry.video = this.localVideoTrack;
      this.tracksByParticipant.set(this.localUserId, entry);

      this.rebuildParticipantsFromTracks();
      this.emitParticipants();
      this.scheduleApplyVideoSubscriptions(0);
    } catch (e) {
      console.error("createLocalTracks error", e);
      this.callbacks.onError?.("Failed to access camera/microphone");
    }
  }

  private handleTrackAdded(track: any) {
    console.log("[JITSI] track added", {
      isLocal: track?.isLocal?.(),
      type: track?.getType?.(),
      videoType: track?.getVideoType?.(),
      pid: track?.getParticipantId?.(),
    });

    const pid = this.resolveTrackParticipantId(track);
    if (!pid) return;

    const isLocal = track.isLocal?.() === true;

    if (isLocal) {
      this.ensureLocalParticipant(this.participants[pid]?.displayName || "");
    } else {
      this.ensureRemoteParticipant(pid, this.participants[pid]?.displayName || "Guest");
    }

    const entry = this.tracksByParticipant.get(pid) || {};

    if (this.isDesktopTrack(track)) {
      entry.screen = track;
    } else {
      const type = track.getType?.();
      if (type === "audio") entry.audio = track;
      if (type === "video") entry.video = track;
    }

    this.tracksByParticipant.set(pid, entry);

    this.rebuildParticipantsFromTracks();
    this.emitParticipants();
    this.scheduleApplyVideoSubscriptions(0);
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
      if (pid !== this.localUserId) {
        this.tracksByParticipant.delete(pid);
      } else {
        this.tracksByParticipant.set(pid, entry);
      }
    } else {
      this.tracksByParticipant.set(pid, entry);
    }

    if (pid === this.localUserId && this.localScreenshareTrack === track) {
      this.localScreenshareTrack = null;
    }

    this.rebuildParticipantsFromTracks();
    this.emitParticipants();
    this.scheduleApplyVideoSubscriptions(0);
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
      }
    }

    p.isScreenSharing = !!p.screenTrack;

    this.emitParticipants();
    this.scheduleApplyVideoSubscriptions(0);
  }

  private rebuildParticipantsFromTracks() {
    for (const [pid, tracks] of this.tracksByParticipant.entries()) {
      if (pid === this.localUserId) {
        this.ensureLocalParticipant(this.participants[pid]?.displayName || "Me");
      } else {
        this.ensureRemoteParticipant(pid, this.participants[pid]?.displayName || "Guest");
      }

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

    const pid = track?.getParticipantId?.();
    return pid || null;
  }

  private isDesktopTrack(track: any): boolean {
    const type = track?.getType?.();
    const videoType = track?.getVideoType?.();

    if (videoType === "desktop") return true;
    if (type === "desktop") return true;

    return false;
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
  // ENDPOINT MESSAGE (reactions only)
  // ========================================================================
  private handleEndpointMessage(senderId: string, payload: any) {
    if (!payload) return;

    if (payload.kind === "reaction" && payload.reaction) {
      this.callbacks.onReactionReceived?.(senderId, payload.reaction);
      return;
    }
  }
}
