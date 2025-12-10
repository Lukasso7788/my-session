// ============================================================================
// src/lib/jitsiEngine.ts — версия с P2P + fallback для реакций + фикс скриншера
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
const JITSI_CONFIG_URL = `https://${JITSI_DOMAIN}/config.js`;
const JITSI_LIB_URL = `https://${JITSI_DOMAIN}/libs/lib-jitsi-meet.min.js`;

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
            reject(new Error(`Failed to load Jitsi script: ${src}`));
        };

        if (!document.querySelector(`script[src="${JITSI_CONFIG_URL}"]`)) {
            const scConfig = document.createElement("script");
            scConfig.src = JITSI_CONFIG_URL;
            scConfig.async = true;
            scConfig.onload = done;
            scConfig.onerror = () => onError(JITSI_CONFIG_URL);
            document.head.appendChild(scConfig);
        } else {
            done();
        }

        if (!document.querySelector(`script[src="${JITSI_LIB_URL}"]`)) {
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

    private JitsiMeetJS: any | null = null;
    private config: any | null = null;
    private connection: any | null = null;
    private conference: any | null = null;

    private participants: Record<string, JitsiParticipant> = {};
    private localUserId: string | null = null;

    private localScreenshareTrack: JitsiTrack | null = null;
    private disposed = false;

    // P2P datachannel infra (оставляем, но реакции теперь дублируем через endpoint messages)
    private peerConnections = new Map<string, RTCPeerConnection>();
    private dataChannels = new Map<string, RTCDataChannel>();

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
        this.JitsiMeetJS.init(this.config);

        const options = {
            hosts: this.config.hosts,
            serviceUrl: this.config.websocket || this.config.bosh,
            clientNode: this.config.clientNode,
        };

        const connection = new this.JitsiMeetJS.JitsiConnection(
            null,
            undefined,
            options
        );
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

        connection.connect();
    }

    // локальный юзер кликает реакцию
    public sendReaction(type: string) {
        this.broadcastLocalEvent({ kind: "reaction", reaction: type });
    }

    private broadcastLocalEvent(ev: any) {
        const msg = JSON.stringify(ev);

        // 1) через datachannel (если P2P взлетит)
        for (const dc of this.dataChannels.values()) {
            if (dc.readyState === "open") {
                try {
                    dc.send(msg);
                } catch {
                    // ignore
                }
            }
        }

        // 2) fallback через Jitsi endpoint messages (надёжно)
        if (this.conference && this.localUserId) {
            Object.keys(this.participants).forEach((id) => {
                if (id === this.localUserId) return;
                try {
                    this.conference!.sendEndpointMessage(id, ev);
                } catch {
                    // ignore
                }
            });
        }
    }

    async toggleAudioMute(): Promise<void> {
        if (!this.conference || !this.localUserId) return;
        const local = this.participants[this.localUserId];
        if (!local || !local.audioTrack) return;

        const track = local.audioTrack;
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
        if (!this.conference || !this.localUserId) return;
        const local = this.participants[this.localUserId];
        if (!local || !local.videoTrack) return;

        const track = local.videoTrack;
        try {
            if (track.isMuted && track.isMuted()) {
                await track.unmute();
                local.videoMuted = false;
            } else {
                await track.mute();
                local.videoMuted = true;
            }
            this.emitParticipants();
        } catch (e) {
            console.error("toggleVideoMute error", e);
        }
    }

    async toggleScreenShare(): Promise<void> {
        if (!this.conference || !this.JitsiMeetJS || !this.localUserId) return;

        const local = this.participants[this.localUserId];

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
                tracks.find((t: any) => t.getType && t.getType() === "desktop") ||
                tracks.find(
                    (t: any) => t.getVideoType && t.getVideoType() === "desktop"
                );

            if (!screenTrack) return;

            this.localScreenshareTrack = screenTrack;

            // подписка на локальный STOP (когда юзер жмёт "Stop sharing" в браузере)
            const trackEvents = this.JitsiMeetJS.events.track;
            if (trackEvents?.LOCAL_TRACK_STOPPED) {
                screenTrack.addEventListener(
                    trackEvents.LOCAL_TRACK_STOPPED,
                    () => {
                        this.handleLocalScreenshareStopped();
                    }
                );
            }

            await this.conference.addTrack(screenTrack);

            if (local) {
                local.isScreenSharing = true;
                local.screenTrack = screenTrack;
                this.emitParticipants();
            }
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

        const local = this.participants[this.localUserId];

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

        this.localScreenshareTrack = null;

        if (local) {
            local.isScreenSharing = false;
            local.screenTrack = undefined;
            this.emitParticipants();
        }
    }

    async dispose(): Promise<void> {
        this.disposed = true;

        // P2P
        for (const dc of this.dataChannels.values()) {
            try {
                dc.close();
            } catch {
                // ignore
            }
        }
        for (const pc of this.peerConnections.values()) {
            try {
                pc.close();
            } catch {
                // ignore
            }
        }
        this.dataChannels.clear();
        this.peerConnections.clear();

        // локальный скриншер
        try {
            if (this.localScreenshareTrack) {
                try {
                    await this.conference?.removeTrack(this.localScreenshareTrack);
                } catch { }
                try {
                    this.localScreenshareTrack.dispose();
                } catch { }
                this.localScreenshareTrack = null;
            }
        } catch {
            // ignore
        }

        // треки участников
        try {
            Object.values(this.participants).forEach((p) => {
                [p.videoTrack, p.audioTrack, p.screenTrack].forEach((t) => {
                    try {
                        t && t.dispose && t.dispose();
                    } catch {
                        // ignore
                    }
                });
            });
        } catch {
            // ignore
        }

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
        if (userName) {
            conferenceOptions.statisticsId = userName.toLowerCase();
        }

        const baseRoomName =
            roomName && roomName.trim().length > 0 ? roomName : "default-room";

        let safeRoomName = baseRoomName
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, "");

        if (!safeRoomName) {
            safeRoomName = "session-" + Math.random().toString(36).substring(2, 8);
        }

        console.log("Joining Jitsi room:", {
            rawRoomName: roomName,
            safeRoomName,
        });

        const conf = this.connection.initJitsiConference(
            safeRoomName,
            conferenceOptions
        );
        this.conference = conf;

        const events = this.JitsiMeetJS.events;

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

            console.log("Jitsi CONFERENCE_JOINED localId:", localId);

            if (!localId) {
                this.callbacks.onError?.("Failed to resolve local user id");
                return;
            }

            this.localUserId = localId;

            // имя из Supabase → в Jitsi
            if (userName && typeof anyConf.setDisplayName === "function") {
                anyConf.setDisplayName(userName);
            }

            this.ensureLocalParticipant(userName);
            this.callbacks.onConferenceJoin?.();
            this.createLocalTracks();
        });

        // --------------------------- USER_JOINED ---------------------------
        conf.on(events.conference.USER_JOINED, (id: string, user: any) => {
            if (this.disposed) return;
            this.ensureRemoteParticipant(id, user?._displayName || "Guest");
            // P2P handshake-инициализация (оставляем)
            this.createPeerConnectionFor(id);
        });

        // --------------------------- USER_LEFT -----------------------------
        conf.on(events.conference.USER_LEFT, (id: string) => {
            if (this.disposed) return;

            this.peerConnections.get(id)?.close();
            this.dataChannels.get(id)?.close();
            this.peerConnections.delete(id);
            this.dataChannels.delete(id);

            delete this.participants[id];
            this.emitParticipants();
        });

        // ----------------------- DISPLAY_NAME_CHANGED ----------------------
        conf.on(
            events.conference.DISPLAY_NAME_CHANGED,
            (id: string, displayName: string) => {
                if (this.disposed) return;
                const p = this.participants[id];
                if (p) {
                    p.displayName = displayName || p.displayName;
                    this.emitParticipants();
                } else {
                    this.ensureRemoteParticipant(id, displayName || "Guest");
                }
            }
        );

        // -------------------------- TRACKS ---------------------------------
        conf.on(events.conference.TRACK_ADDED, (track: any) => {
            if (this.disposed) return;
            this.handleTrackAdded(track);
        });

        conf.on(events.conference.TRACK_REMOVED, (track: any) => {
            if (this.disposed) return;
            this.handleTrackRemoved(track);
        });

        conf.on(events.conference.TRACK_MUTE_CHANGED, (track: any) => {
            if (this.disposed) return;
            this.handleTrackMuteChanged(track);
        });

        // ------------------- ENDPOINT MESSAGE (signal + reactions) ----------
        conf.on(
            events.conference.ENDPOINT_MESSAGE_RECEIVED,
            (senderId: string, payload: any) => {
                this.handleEndpointMessage(senderId, payload);
            }
        );

        conf.join();
    }

    // ========================================================================
    // PARTICIPANTS
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
            this.emitParticipants();
        }
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
            this.emitParticipants();
        }
    }

    // ========================================================================
    // TRACKS
    // ========================================================================
    private async createLocalTracks() {
        if (!this.JitsiMeetJS || !this.conference) return;

        try {
            const tracks = await this.JitsiMeetJS.createLocalTracks({
                devices: ["audio", "video"],
            });

            for (const track of tracks) {
                await this.conference.addTrack(track);
            }
        } catch (e) {
            console.error("createLocalTracks error", e);
            this.callbacks.onError?.("Failed to access camera/microphone");
        }
    }

    private handleTrackAdded(track: any) {
        const type = track.getType && track.getType();
        const videoType = track.getVideoType && track.getVideoType();
        const isLocal = track.isLocal && track.isLocal();
        const participantId = isLocal
            ? this.localUserId
            : track.getParticipantId
                ? track.getParticipantId()
                : null;

        if (!participantId) return;

        if (isLocal) {
            this.ensureLocalParticipant("");
        } else {
            this.ensureRemoteParticipant(participantId, "Guest");
        }

        const p = this.participants[participantId];
        if (!p) return;

        const isDesktop = type === "desktop" || videoType === "desktop";

        if (isDesktop) {
            p.screenTrack = track;
            p.isScreenSharing = true;
        } else if (type === "audio") {
            p.audioTrack = track;
            p.audioMuted = track.isMuted ? track.isMuted() : false;
        } else if (type === "video") {
            p.videoTrack = track;
            p.videoMuted = track.isMuted ? track.isMuted() : false;
        }

        this.emitParticipants();
    }

    private handleTrackRemoved(track: any) {
        const type = track.getType && track.getType();
        const videoType = track.getVideoType && track.getVideoType();
        const isDesktop = type === "desktop" || videoType === "desktop";

        const isLocal = track.isLocal && track.isLocal();
        const participantId = isLocal
            ? this.localUserId
            : track.getParticipantId
                ? track.getParticipantId()
                : null;

        if (!participantId) return;
        const p = this.participants[participantId];
        if (!p) return;

        if (isDesktop) {
            p.screenTrack = undefined;
            p.isScreenSharing = false;
        } else if (type === "audio" && p.audioTrack === track) {
            p.audioTrack = undefined;
        } else if (type === "video" && p.videoTrack === track) {
            p.videoTrack = undefined;
        }

        this.emitParticipants();
    }

    private handleTrackMuteChanged(track: any) {
        const type = track.getType && track.getType();
        const isLocal = track.isLocal && track.isLocal();
        const participantId = isLocal
            ? this.localUserId
            : track.getParticipantId
                ? track.getParticipantId()
                : null;

        if (!participantId) return;
        const p = this.participants[participantId];
        if (!p) return;

        if (type === "audio") {
            p.audioMuted = track.isMuted ? track.isMuted() : p.audioMuted;
        } else if (type === "video") {
            p.videoMuted = track.isMuted ? track.isMuted() : p.videoMuted;
        }

        this.emitParticipants();
    }

    private emitParticipants() {
        const arr = Object.values(this.participants);
        this.callbacks.onParticipantsUpdate?.(arr);
    }

    // ========================================================================
    // P2P WEBRTC (оставлено, но реакции теперь не завязаны ТОЛЬКО на него)
    // ========================================================================
    private createPeerConnectionFor(id: string) {
        if (this.peerConnections.has(id)) return;

        const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        this.peerConnections.set(id, pc);

        pc.onicecandidate = (ev) => {
            if (ev.candidate) {
                this.sendSignal(id, {
                    kind: "ice",
                    candidate: ev.candidate,
                });
            }
        };

        pc.ondatachannel = (ev) => {
            const dc = ev.channel;
            this.setupDataChannel(dc, id);
        };

        // создаём свой outbound канал
        const dc = pc.createDataChannel("mysession");
        this.setupDataChannel(dc, id);

        // создаём offer
        (async () => {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignal(id, { kind: "offer", sdp: offer });
        })();
    }

    private setupDataChannel(dc: RTCDataChannel, id: string) {
        this.dataChannels.set(id, dc);

        dc.onopen = () => {
            console.log("DataChannel open with", id);
        };
        dc.onerror = (e) => {
            console.error("DataChannel error", e);
        };
        dc.onclose = () => {
            this.dataChannels.delete(id);
        };

        dc.onmessage = (msg) => {
            try {
                const data = JSON.parse(msg.data);
                if (data.kind === "reaction" && data.reaction) {
                    this.callbacks.onReactionReceived?.(id, data.reaction);
                }
            } catch (e) {
                console.error("Bad DC message", e);
            }
        };
    }

    // ========================================================================
    // SIGNALING THROUGH JITSI ENDPOINT MESSAGES
    // ========================================================================
    private sendSignal(targetId: string, payload: any) {
        if (!this.conference) return;
        this.conference.sendEndpointMessage(targetId, payload);
    }

    private async handleEndpointMessage(senderId: string, payload: any) {
        if (!payload) return;

        // 1) реакции (работает даже если P2P не поднялся)
        if (payload.kind === "reaction" && payload.reaction) {
            this.callbacks.onReactionReceived?.(senderId, payload.reaction);
            return;
        }

        // 2) P2P сигналы
        if (!payload.kind) return;

        const pc = this.peerConnections.get(senderId);
        if (!pc) return;

        switch (payload.kind) {
            case "offer":
                await pc.setRemoteDescription(payload.sdp);
                {
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    this.sendSignal(senderId, { kind: "answer", sdp: answer });
                }
                break;
            case "answer":
                await pc.setRemoteDescription(payload.sdp);
                break;
            case "ice":
                try {
                    await pc.addIceCandidate(payload.candidate);
                } catch (e) {
                    console.error("ICE error", e);
                }
                break;
        }
    }
}
