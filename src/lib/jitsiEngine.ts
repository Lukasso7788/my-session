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
    private participants: Record<string, JitsiParticipant> = {};
    private localUserId: string | null = null;
    private localScreenshareTrack: JitsiTrack | null = null;
    private disposed = false;

    constructor(callbacks: JitsiEngineCallbacks = {}) {
        this.callbacks = callbacks;
    }

    // ==============
    // PUBLIC API
    // ==============
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

        const onConnectionFailed = () => {
            if (this.disposed) return;
            this.callbacks.onError?.("Jitsi connection failed");
        };

        const onConnectionDisconnected = () => {
            // noop
        };

        connection.addEventListener(
            this.JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
            onConnectionSuccess
        );
        connection.addEventListener(
            this.JitsiMeetJS.events.connection.CONNECTION_FAILED,
            onConnectionFailed
        );
        connection.addEventListener(
            this.JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
            onConnectionDisconnected
        );

        connection.connect();
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

        // stop
        if (this.localScreenshareTrack) {
            try {
                await this.conference.removeTrack(this.localScreenshareTrack);
            } catch {
                // ignore
            }
            try {
                this.localScreenshareTrack.dispose();
            } catch {
                // ignore
            }
            this.localScreenshareTrack = null;
            if (local) {
                local.isScreenSharing = false;
                local.screenTrack = undefined;
                this.emitParticipants();
            }
            return;
        }

        // start
        try {
            const tracks = await this.JitsiMeetJS.createLocalTracks({
                devices: ["desktop"],
            });

            const screenTrack = tracks.find(
                (t: any) => t.getType && t.getType() === "desktop"
            );

            if (!screenTrack) return;

            this.localScreenshareTrack = screenTrack;

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

    async dispose(): Promise<void> {
        this.disposed = true;

        try {
            if (this.localScreenshareTrack) {
                try {
                    await this.conference?.removeTrack(this.localScreenshareTrack);
                } catch {
                    // ignore
                }
                try {
                    this.localScreenshareTrack.dispose();
                } catch {
                    // ignore
                }
                this.localScreenshareTrack = null;
            }
        } catch {
            // ignore
        }

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

    // ===========
    // INTERNAL
    // ===========
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

        conf.on(events.conference.CONFERENCE_JOINED, () => {
            if (this.disposed) return;
            this.localUserId = conf.getLocalUserId();
            this.ensureLocalParticipant(userName);
            this.callbacks.onConferenceJoin?.();
            this.createLocalTracks();
        });

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

        conf.on(events.conference.USER_JOINED, (id: string, user: any) => {
            if (this.disposed) return;
            this.ensureRemoteParticipant(id, user?._displayName || "Guest");
        });

        conf.on(events.conference.USER_LEFT, (id: string) => {
            if (this.disposed) return;
            delete this.participants[id];
            this.emitParticipants();
        });

        conf.on(events.conference.CONFERENCE_ERROR, (e: any) => {
            console.error("Jitsi conference error", e);
            this.callbacks.onError?.("Conference error");
        });

        conf.join();
    }

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

    private async createLocalTracks() {
        if (!this.JitsiMeetJS || !this.conference) return;

        try {
            const tracks = await this.JitsiMeetJS.createLocalTracks({
                devices: ["audio", "video"],
            });

            for (const track of tracks) {
                await this.conference.addTrack(track);
                // TRACK_ADDED обработает map participants
            }
        } catch (e) {
            console.error("createLocalTracks error", e);
            this.callbacks.onError?.("Failed to access camera/microphone");
        }
    }

    private handleTrackAdded(track: any) {
        const type = track.getType && track.getType();
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

        if (type === "audio") {
            p.audioTrack = track;
            p.audioMuted = track.isMuted ? track.isMuted() : false;
        } else if (type === "video") {
            p.videoTrack = track;
            p.videoMuted = track.isMuted ? track.isMuted() : false;
        } else if (type === "desktop") {
            p.screenTrack = track;
            p.isScreenSharing = true;
        }

        this.emitParticipants();
    }

    private handleTrackRemoved(track: any) {
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

        if (type === "audio" && p.audioTrack === track) {
            p.audioTrack = undefined;
        } else if (type === "video" && p.videoTrack === track) {
            p.videoTrack = undefined;
        } else if (type === "desktop" && p.screenTrack === track) {
            p.screenTrack = undefined;
            p.isScreenSharing = false;
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
}
