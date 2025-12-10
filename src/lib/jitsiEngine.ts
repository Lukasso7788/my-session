// ============================================================================
// src/lib/jitsiEngine.ts — NEW VERSION WITH RTCDataChannel BROADCAST
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
    onReactionReceived?: (id: string, reaction: string) => void;
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
    if (typeof window === "undefined") throw new Error("Jitsi must run in browser");

    if (window.JitsiMeetJS && window.config) return;

    if (jitsiLoaderPromise) return jitsiLoaderPromise;

    jitsiLoaderPromise = new Promise<void>((resolve, reject) => {
        let loaded = 0;
        const done = () => {
            loaded += 1;
            if (loaded === 2) {
                if (window.JitsiMeetJS && window.config) resolve();
                else reject(new Error("Jitsi loaded but globals missing"));
            }
        };
        const fail = (src: string) => reject(new Error(`Failed JS: ${src}`));

        if (!document.querySelector(`script[src="${JITSI_CONFIG_URL}"]`)) {
            const s = document.createElement("script");
            s.src = JITSI_CONFIG_URL;
            s.onload = done;
            s.onerror = () => fail(JITSI_CONFIG_URL);
            document.head.appendChild(s);
        } else done();

        if (!document.querySelector(`script[src="${JITSI_LIB_URL}"]`)) {
            const s = document.createElement("script");
            s.src = JITSI_LIB_URL;
            s.onload = done;
            s.onerror = () => fail(JITSI_LIB_URL);
            document.head.appendChild(s);
        } else done();
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

    // NEW: P2P RTC infra
    private peerConnections = new Map<string, RTCPeerConnection>();
    private dataChannels = new Map<string, RTCDataChannel>();

    constructor(callbacks: JitsiEngineCallbacks = {}) {
        this.callbacks = callbacks;
    }

    // ============================================================================
    // PUBLIC API
    // ============================================================================
    async initAndJoin(roomName: string, userName: string): Promise<void> {
        await loadJitsiScripts();

        this.JitsiMeetJS = window.JitsiMeetJS;
        this.config = window.config;

        if (!this.JitsiMeetJS || !this.config)
            throw new Error("Jitsi globals missing");

        this.JitsiMeetJS.setLogLevel(this.JitsiMeetJS.logLevels.ERROR);
        this.JitsiMeetJS.init(this.config);

        const options = {
            hosts: this.config.hosts,
            serviceUrl: this.config.websocket || this.config.bosh,
            clientNode: this.config.clientNode
        };

        const conn = new this.JitsiMeetJS.JitsiConnection(null, undefined, options);
        this.connection = conn;

        conn.addEventListener(
            this.JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
            () => !this.disposed && this.setupConference(roomName, userName)
        );
        conn.addEventListener(
            this.JitsiMeetJS.events.connection.CONNECTION_FAILED,
            () => this.callbacks.onError?.("Connection failed")
        );

        conn.connect();
    }

    public sendReaction(type: string) {
        this.broadcastLocalEvent({ kind: "reaction", reaction: type });
    }

    private broadcastLocalEvent(ev: any) {
        const msg = JSON.stringify(ev);

        for (const dc of this.dataChannels.values()) {
            if (dc.readyState === "open") dc.send(msg);
        }
    }

    async toggleAudioMute() {
        if (!this.conference || !this.localUserId) return;
        const p = this.participants[this.localUserId];
        if (!p?.audioTrack) return;

        try {
            if (p.audioTrack.isMuted()) await p.audioTrack.unmute();
            else await p.audioTrack.mute();
            p.audioMuted = p.audioTrack.isMuted();
            this.emitParticipants();
        } catch (e) {
            console.error(e);
        }
    }

    async toggleVideoMute() {
        if (!this.conference || !this.localUserId) return;
        const p = this.participants[this.localUserId];
        if (!p?.videoTrack) return;

        try {
            if (p.videoTrack.isMuted()) await p.videoTrack.unmute();
            else await p.videoTrack.mute();
            p.videoMuted = p.videoTrack.isMuted();
            this.emitParticipants();
        } catch (e) {
            console.error(e);
        }
    }

    async toggleScreenShare() {
        if (!this.conference || !this.localUserId || !this.JitsiMeetJS) return;

        const local = this.participants[this.localUserId];

        if (this.localScreenshareTrack) {
            await this.conference.removeTrack(this.localScreenshareTrack).catch(() => { });
            this.localScreenshareTrack.dispose?.();
            this.localScreenshareTrack = null;

            local.isScreenSharing = false;
            local.screenTrack = undefined;
            this.emitParticipants();
            return;
        }

        try {
            const tracks = await this.JitsiMeetJS.createLocalTracks({ devices: ["desktop"] });
            const screenTrack =
                tracks.find((t: any) => t.getType?.() === "desktop") ||
                tracks.find((t: any) => t.getVideoType?.() === "desktop");

            if (!screenTrack) return;

            this.localScreenshareTrack = screenTrack;
            await this.conference.addTrack(screenTrack);

            local.isScreenSharing = true;
            local.screenTrack = screenTrack;
            this.emitParticipants();
        } catch (e) {
            console.error(e);
            this.callbacks.onError?.("Screen share failed");
        }
    }

    async dispose() {
        this.disposed = true;

        for (const dc of this.dataChannels.values()) {
            try { dc.close(); } catch { }
        }
        for (const pc of this.peerConnections.values()) {
            try { pc.close(); } catch { }
        }

        this.dataChannels.clear();
        this.peerConnections.clear();

        if (this.localScreenshareTrack) {
            try { await this.conference?.removeTrack(this.localScreenshareTrack); } catch { }
            try { this.localScreenshareTrack.dispose(); } catch { }
        }

        for (const p of Object.values(this.participants)) {
            for (const t of [p.videoTrack, p.audioTrack, p.screenTrack]) {
                try { t?.dispose?.(); } catch { }
            }
        }

        this.participants = {};
        this.emitParticipants();

        try { await this.conference?.leave(); } catch { }
        try { await this.connection?.disconnect(); } catch { }

        this.conference = null;
        this.connection = null;
        this.localUserId = null;
    }

    // ============================================================================
    // INTERNAL
    // ============================================================================
    private setupConference(roomName: string, userName: string) {
        if (!this.connection || !this.JitsiMeetJS || !this.config) return;

        const options = { ...(this.config.conference || {}) };
        if (userName) options.statisticsId = userName.toLowerCase();

        const safe = (roomName || "default")
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, "") || "room";

        const conf = this.connection.initJitsiConference(safe, options);
        this.conference = conf;

        const events = this.JitsiMeetJS.events;

        // ------------------------------- USER JOINED -------------------------------
        conf.on(events.conference.USER_JOINED, (id: string, user: any) => {
            this.ensureRemoteParticipant(id, user?._displayName || "Guest");
            this.createPeerConnectionFor(id);
        });

        // ------------------------------ USER LEFT ---------------------------------
        conf.on(events.conference.USER_LEFT, (id: string) => {
            this.peerConnections.get(id)?.close();
            this.dataChannels.get(id)?.close();
            this.peerConnections.delete(id);
            this.dataChannels.delete(id);

            delete this.participants[id];
            this.emitParticipants();
        });

        // -------------------------- CONFERENCE JOINED -----------------------------
        conf.on(events.conference.CONFERENCE_JOINED, () => {
            const anyConf = conf as any;
            const id =
                anyConf.getLocalUserId?.() ||
                anyConf.myUserId?.() ||
                null;

            if (!id) {
                this.callbacks.onError?.("Local user id missing");
                return;
            }

            this.localUserId = id;

            if (userName && conf.setDisplayName)
                conf.setDisplayName(userName);

            this.ensureLocalParticipant(userName);
            this.callbacks.onConferenceJoin?.();
            this.createLocalTracks();
        });

        // --------------------------- TRACK EVENTS ----------------------------------
        conf.on(events.conference.TRACK_ADDED, (track: any) => {
            if (!this.disposed) this.handleTrackAdded(track);
        });

        conf.on(events.conference.TRACK_REMOVED, (track: any) => {
            if (!this.disposed) this.handleTrackRemoved(track);
        });

        conf.on(events.conference.TRACK_MUTE_CHANGED, (track: any) => {
            if (!this.disposed) this.handleTrackMuteChanged(track);
        });

        // -------------------------- DATA-CHANNEL SIGNALING --------------------------
        conf.on(
            events.conference.ENDPOINT_MESSAGE_RECEIVED,
            (senderId: string, payload: any) => {
                this.handleEndpointMessage(senderId, payload);
            }
        );

        conf.join();
    }

    // ============================================================================
    // PARTICIPANTS
    // ============================================================================
    private ensureLocalParticipant(displayName: string) {
        if (!this.localUserId) return;

        if (!this.participants[this.localUserId]) {
            this.participants[this.localUserId] = {
                id: this.localUserId,
                displayName: displayName || "Me",
                isLocal: true,
                audioMuted: false,
                videoMuted: false,
                isScreenSharing: false
            };
            this.emitParticipants();
        }
    }

    private ensureRemoteParticipant(id: string, displayName: string) {
        if (!this.participants[id]) {
            this.participants[id] = {
                id,
                displayName,
                isLocal: false,
                audioMuted: false,
                videoMuted: false,
                isScreenSharing: false
            };
            this.emitParticipants();
        }
    }

    // ============================================================================
    // TRACKS
    // ============================================================================
    private async createLocalTracks() {
        if (!this.JitsiMeetJS || !this.conference) return;

        try {
            const tracks = await this.JitsiMeetJS.createLocalTracks({
                devices: ["audio", "video"]
            });

            for (const t of tracks) {
                await this.conference.addTrack(t);
            }
        } catch {
            this.callbacks.onError?.("Failed to access camera/microphone");
        }
    }

    private handleTrackAdded(track: any) {
        const type = track.getType?.();
        const videoType = track.getVideoType?.();
        const isLocal = track.isLocal?.();
        const pid = isLocal ? this.localUserId : track.getParticipantId?.();

        if (!pid) return;

        if (isLocal) this.ensureLocalParticipant("");
        else this.ensureRemoteParticipant(pid, "Guest");

        const p = this.participants[pid];
        if (!p) return;

        const isDesktop = type === "desktop" || videoType === "desktop";

        if (isDesktop) {
            p.screenTrack = track;
            p.isScreenSharing = true;
        } else if (type === "audio") {
            p.audioTrack = track;
            p.audioMuted = track.isMuted?.() ?? false;
        } else if (type === "video") {
            p.videoTrack = track;
            p.videoMuted = track.isMuted?.() ?? false;
        }

        this.emitParticipants();
    }

    private handleTrackRemoved(track: any) {
        const type = track.getType?.();
        const videoType = track.getVideoType?.();
        const isDesktop = type === "desktop" || videoType === "desktop";
        const pid = track.isLocal?.()
            ? this.localUserId
            : track.getParticipantId?.();

        if (!pid) return;
        const p = this.participants[pid];
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
        const type = track.getType?.();
        const pid = track.isLocal?.()
            ? this.localUserId
            : track.getParticipantId?.();

        if (!pid) return;
        const p = this.participants[pid];
        if (!p) return;

        if (type === "audio") {
            p.audioMuted = track.isMuted?.() ?? p.audioMuted;
        } else if (type === "video") {
            p.videoMuted = track.isMuted?.() ?? p.videoMuted;
        }

        this.emitParticipants();
    }

    private emitParticipants() {
        this.callbacks.onParticipantsUpdate?.(Object.values(this.participants));
    }

    // ============================================================================
    // ----------------------------- P2P WEBRTC -----------------------------------
    // ============================================================================
    private createPeerConnectionFor(id: string) {
        if (this.peerConnections.has(id)) return;

        const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
        });
        this.peerConnections.set(id, pc);

        pc.onicecandidate = (ev) => {
            if (ev.candidate)
                this.sendSignal(id, {
                    kind: "ice",
                    candidate: ev.candidate
                });
        };

        pc.ondatachannel = (ev) => {
            const dc = ev.channel;
            this.setupDataChannel(dc, id);
        };

        // Create our own outbound channel
        const dc = pc.createDataChannel("mysession");
        this.setupDataChannel(dc, id);

        // Make initial offer
        (async () => {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignal(id, { kind: "offer", sdp: offer });
        })();
    }

    private setupDataChannel(dc: RTCDataChannel, id: string) {
        this.dataChannels.set(id, dc);

        dc.onopen = () => console.log("DC open", id);
        dc.onerror = (e) => console.error("DC error", e);

        dc.onmessage = (msg) => {
            try {
                const data = JSON.parse(msg.data);
                if (data.kind === "reaction") {
                    this.callbacks.onReactionReceived?.(id, data.reaction);
                }
            } catch (e) {
                console.error("Bad DC message", e);
            }
        };

        dc.onclose = () => {
            this.dataChannels.delete(id);
        };
    }

    // ============================================================================
    // SIGNALING THROUGH JITSI ENDPOINT MESSAGES
    // ============================================================================
    private sendSignal(targetId: string, payload: any) {
        if (!this.conference) return;
        this.conference.sendEndpointMessage(targetId, payload);
    }

    private async handleEndpointMessage(senderId: string, payload: any) {
        if (!payload?.kind) return;

        const pc = this.peerConnections.get(senderId);
        if (!pc) return;

        switch (payload.kind) {
            case "offer":
                await pc.setRemoteDescription(payload.sdp);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.sendSignal(senderId, { kind: "answer", sdp: answer });
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

// ============================================================================
// END
// ============================================================================
