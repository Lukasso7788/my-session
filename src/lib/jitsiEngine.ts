// src/lib/jitsiEngine.ts

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
    onReaction?: (emoji: string) => void;
    onError?: (message: string) => void;
};

const JITSI_DOMAIN = "jitsi.lukassodesign.site";
const JITSI_CONFIG_URL = `https://${JITSI_DOMAIN}/config.js`;
const JITSI_LIB_URL = `https://${JITSI_DOMAIN}/libs/lib-jitsi-meet.min.js`;

let jitsiLoaderPromise: Promise<void> | null = null;

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

export class JitsiEngine {
    private callbacks: JitsiEngineCallbacks;
    private JitsiMeetJS: any | null = null;
    private config: any | null = null;
    private connection: any | null = null;
    private conference: any | null = null;
    private dataChannel: any | null = null;

    private participants: Record<string, JitsiParticipant> = {};
    private localUserId: string | null = null;
    private localScreenshareTrack: JitsiTrack | null = null;
    private disposed = false;

    constructor(callbacks: JitsiEngineCallbacks = {}) {
        this.callbacks = callbacks;
    }

    // =====================================================
    // PUBLIC API
    // =====================================================
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

        const onConnectionSuccess = () => {
            if (this.disposed) return;
            this.setupConference(roomName, userName);
        };

        connection.addEventListener(
            this.JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
            onConnectionSuccess
        );

        connection.addEventListener(
            this.JitsiMeetJS.events.connection.CONNECTION_FAILED,
            () => this.callbacks.onError?.("Jitsi connection failed")
        );

        connection.connect();
    }

    sendReaction(emoji: string) {
        if (this.dataChannel) {
            this.dataChannel.send(
                JSON.stringify({ type: "reaction", emoji })
            );
        }
    }

    async toggleAudioMute(): Promise<void> {
        if (!this.conference || !this.localUserId) return;
        const local = this.participants[this.localUserId];
        if (!local?.audioTrack) return;

        try {
            if (local.audioTrack.isMuted()) {
                await local.audioTrack.unmute();
                local.audioMuted = false;
            } else {
                await local.audioTrack.mute();
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
        if (!local?.videoTrack) return;

        try {
            if (local.videoTrack.isMuted()) {
                await local.videoTrack.unmute();
                local.videoMuted = false;
            } else {
                await local.videoTrack.mute();
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

        if (this.localScreenshareTrack) {
            try {
                await this.conference.removeTrack(this.localScreenshareTrack);
                this.localScreenshareTrack.dispose();
            } catch { }

            this.localScreenshareTrack = null;
            local.isScreenSharing = false;
            local.screenTrack = undefined;
            this.emitParticipants();
            return;
        }

        try {
            const tracks = await this.JitsiMeetJS.createLocalTracks({
                devices: ["desktop"],
            });

            const screenTrack = tracks.find(
                (t: any) => t.getType() === "desktop"
            );

            if (!screenTrack) return;

            this.localScreenshareTrack = screenTrack;

            await this.conference.addTrack(screenTrack);

            local.isScreenSharing = true;
            local.screenTrack = screenTrack;
            this.emitParticipants();
        } catch (e) {
            this.callbacks.onError?.("Screen share failed");
        }
    }

    async dispose(): Promise<void> {
        this.disposed = true;

        try {
            if (this.localScreenshareTrack) {
                await this.conference?.removeTrack(this.localScreenshareTrack);
                this.localScreenshareTrack.dispose();
            }
        } catch { }

        try {
            Object.values(this.participants).forEach((p) => {
                [p.videoTrack, p.audioTrack, p.screenTrack].forEach((t) => {
                    try {
                        t?.dispose();
                    } catch { }
                });
            });
        } catch { }

        this.participants = {};

        try {
            await this.conference?.leave();
        } catch { }

        try {
            await this.connection?.disconnect();
        } catch { }

        this.conference = null;
        this.connection = null;
        this.localUserId = null;
    }

    // =====================================================
    // INTERNAL LOGIC
    // =====================================================
    private setupConference(roomName: string, userName: string) {
        if (!this.connection || !this.JitsiMeetJS || !this.config) return;

        const conferenceOptions = { ...(this.config.conference || {}) };
        if (userName) {
            conferenceOptions.statisticsId = userName.toLowerCase();
        }

        const safeName = roomName.toLowerCase().replace(/[^a-z0-9-_]/g, "");
        const conf = this.connection.initJitsiConference(safeName, conferenceOptions);
        this.conference = conf;

        const events = this.JitsiMeetJS.events;

        // ===========================================
        // CONFERENCE JOINED — где мы получаем userId
        // ===========================================
        conf.on(events.conference.CONFERENCE_JOINED, () => {
            const anyConf = conf as any;

            let localId: string | null = null;

            if (typeof anyConf.getLocalUserId === "function") {
                localId = anyConf.getLocalUserId();
            } else if (typeof anyConf.myUserId === "function") {
                localId = anyConf.myUserId();
            }

            if (!localId) {
                this.callbacks.onError?.("Failed to resolve local user id");
                return;
            }

            this.localUserId = localId;
            this.ensureLocalParticipant(userName);
            this.callbacks.onConferenceJoin?.();
            this.createLocalTracks();
        });

        // ===========================================================
        // DATA CHANNEL — глобальные реакции
        // ===========================================================
        conf.on(events.conference.DATA_CHANNEL_OPENED, (channel: any) => {
            this.dataChannel = channel;

            channel.onmessage = (msg: any) => {
                try {
                    const data = JSON.parse(msg.data);
                    if (data.type === "reaction") {
                        this.callbacks.onReaction?.(data.emoji);
                    }
                } catch { }
            };
        });

        // ===========================================================
        // TRACK EVENTS
        // ===========================================================
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

        // ===========================================================
        // PARTICIPANTS
        // ===========================================================
        conf.on(events.conference.USER_JOINED, (id: string, user: any) => {
            if (this.disposed) return;
            this.ensureRemoteParticipant(id, user?._displayName || "Guest");
        });

        conf.on(events.conference.USER_LEFT, (id: string) => {
            delete this.participants[id];
            this.emitParticipants();
        });

        conf.join();
    }

    private ensureLocalParticipant(displayName: string) {
        if (!this.localUserId) return;

        if (!this.participants[this.localUserId]) {
            this.participants[this.localUserId] = {
                id: this.localUserId,
                displayName,
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
                displayName,
                isLocal: false,
                audioMuted: false,
                videoMuted: false,
                isScreenSharing: false,
            };
            this.emitParticipants();
        }
    }

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
            this.callbacks.onError?.("Failed to access camera/microphone");
        }
    }

    private handleTrackAdded(track: any) {
        const type = track.getType();
        const isLocal = track.isLocal();

        const participantId = isLocal
            ? this.localUserId
            : track.getParticipantId?.() ||
            track?.ownerEndpointId ||
            track?.containers?.[0]?.id ||
            null;

        if (!participantId) return;

        if (isLocal) this.ensureLocalParticipant("");
        else this.ensureRemoteParticipant(participantId, "Guest");

        const p = this.participants[participantId];
        if (!p) return;

        if (type === "audio") {
            p.audioTrack = track;
            p.audioMuted = track.isMuted();
        } else if (type === "video") {
            p.videoTrack = track;
            p.videoMuted = track.isMuted();
        } else if (type === "desktop") {
            p.screenTrack = track;
            p.isScreenSharing = true;
        }

        this.emitParticipants();
    }

    private handleTrackRemoved(track: any) {
        const type = track.getType();
        const isLocal = track.isLocal();

        const participantId = isLocal
            ? this.localUserId
            : track.getParticipantId?.() ||
            track?.ownerEndpointId ||
            track?.containers?.[0]?.id ||
            null;

        if (!participantId) return;

        const p = this.participants[participantId];
        if (!p) return;

        if (type === "audio") {
            if (p.audioTrack === track) p.audioTrack = undefined;
        } else if (type === "video") {
            if (p.videoTrack === track) p.videoTrack = undefined;
        } else if (type === "desktop") {
            if (p.screenTrack === track) {
                p.screenTrack = undefined;
                p.isScreenSharing = false;
            }
        }

        this.emitParticipants();
    }

    private handleTrackMuteChanged(track: any) {
        const type = track.getType();
        const isLocal = track.isLocal();

        const participantId = isLocal
            ? this.localUserId
            : track.getParticipantId?.() ||
            track?.ownerEndpointId ||
            track?.containers?.[0]?.id ||
            null;

        if (!participantId) return;

        const p = this.participants[participantId];
        if (!p) return;

        if (type === "audio") {
            p.audioMuted = track.isMuted();
        } else if (type === "video") {
            p.videoMuted = track.isMuted();
        }

        this.emitParticipants();
    }

    private emitParticipants() {
        this.callbacks.onParticipantsUpdate?.(Object.values(this.participants));
    }
}
