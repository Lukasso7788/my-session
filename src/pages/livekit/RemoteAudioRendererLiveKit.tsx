import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Room,
    RoomEvent,
    Track,
    RemoteParticipant,
    RemoteAudioTrack,
    RemoteTrackPublication,
} from "livekit-client";

type RemoteAudioItem = {
    id: string;
    track: RemoteAudioTrack;
    label: string;
    participantUserId?: string;
    participantIdentity?: string;
};

type AudioWithSinkId = HTMLAudioElement & {
    setSinkId?: (deviceId: string) => Promise<void>;
};

type AudioGraph = {
    audioContext: AudioContext;
    source: MediaElementAudioSourceNode;
    gainNode: GainNode;
};

function isProbablyMobileOrTablet() {
    if (typeof window === "undefined") return false;

    try {
        if (window.matchMedia("(max-width: 1023px)").matches) return true;
    } catch { }

    try {
        const ua = String(navigator.userAgent || "").toLowerCase();
        return /android|iphone|ipad|ipod|mobile|tablet/.test(ua);
    } catch {
        return false;
    }
}

function canUseSinkSelection() {
    if (typeof document === "undefined") return false;

    try {
        const el = document.createElement("audio") as AudioWithSinkId;
        return typeof el.setSinkId === "function";
    } catch {
        return false;
    }
}

function sameTrackList(a: RemoteAudioItem[], b: RemoteAudioItem[]) {
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i += 1) {
        if (a[i].id !== b[i].id) return false;
        if (a[i].track !== b[i].track) return false;
        if (a[i].label !== b[i].label) return false;
        if (a[i].participantUserId !== b[i].participantUserId) return false;
        if (a[i].participantIdentity !== b[i].participantIdentity) return false;
    }

    return true;
}

function isRemoteAudioTrack(track: unknown): track is RemoteAudioTrack {
    if (!track || typeof track !== "object") return false;

    const maybeTrack = track as {
        kind?: unknown;
        attach?: unknown;
        detach?: unknown;
    };

    return (
        maybeTrack.kind === Track.Kind.Audio &&
        typeof maybeTrack.attach === "function" &&
        typeof maybeTrack.detach === "function"
    );
}

function looksLikeUuid(v: string) {
    const s = String(v || "").trim().toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
}

function getParticipantVolumeKey(args: {
    id: string;
    participantUserId?: string;
    participantIdentity?: string;
}) {
    const userId = String(args.participantUserId || "").toLowerCase();
    if (userId && looksLikeUuid(userId)) return `user:${userId}`;

    const identity = String(args.participantIdentity || "").trim().toLowerCase();
    if (identity) return `identity:${identity}`;

    return `tile:${String(args.id || "")}`;
}

function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n));
}

function getSafePct(v: unknown, fallback: number) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return clamp(Math.round(n), 0, 300);
}

function getEffectiveVolumeMultiplier(args: {
    defaultRemoteVolumePct: number;
    participantVolumePct?: number;
}) {
    const defaultPct = getSafePct(args.defaultRemoteVolumePct, 125);
    const participantPct = getSafePct(args.participantVolumePct, 100);
    return (defaultPct / 100) * (participantPct / 100);
}

function makeAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;

    try {
        const AnyWindow = window as Window & {
            AudioContext?: typeof AudioContext;
            webkitAudioContext?: typeof AudioContext;
        };

        const Ctor = AnyWindow.AudioContext || AnyWindow.webkitAudioContext;
        if (!Ctor) return null;

        return new Ctor();
    } catch {
        return null;
    }
}

export function RemoteAudioRenderer({
    room,
    audioOutputId,
    defaultRemoteVolumePct,
    volumePctByParticipantKey,
    recoveryTick,
}: {
    room: Room | null;
    audioOutputId: string;
    defaultRemoteVolumePct: number;
    volumePctByParticipantKey: Record<string, number>;
    recoveryTick: number;
}) {
    const [tracks, setTracks] = useState<RemoteAudioItem[]>([]);
    const tracksRef = useRef<RemoteAudioItem[]>([]);

    const rebuild = useCallback(() => {
        if (!room) {
            tracksRef.current = [];
            setTracks([]);
            return;
        }

        const next: RemoteAudioItem[] = [];

        room.remoteParticipants.forEach((participant: RemoteParticipant) => {
            participant.audioTrackPublications.forEach((pub: RemoteTrackPublication) => {
                if (pub.source !== Track.Source.Microphone) return;
                if (!pub.isSubscribed) return;

                const maybeTrack = pub.track;
                if (!isRemoteAudioTrack(maybeTrack)) return;

                const label =
                    String(participant.name || participant.identity || "Guest").trim() || "Guest";

                next.push({
                    id: `${participant.sid}:${String(pub.trackSid || "")}`,
                    track: maybeTrack,
                    label,
                    participantUserId: String((participant as any)?.identity || ""),
                    participantIdentity: String(participant.identity || ""),
                });
            });
        });

        next.sort((a, b) => a.id.localeCompare(b.id));

        if (sameTrackList(tracksRef.current, next)) return;

        tracksRef.current = next;
        setTracks(next);
    }, [room]);

    useEffect(() => {
        rebuild();
        if (!room) return;

        const onAny = () => {
            rebuild();
        };

        room.on(RoomEvent.ParticipantConnected, onAny);
        room.on(RoomEvent.ParticipantDisconnected, onAny);
        room.on(RoomEvent.TrackSubscribed, onAny);
        room.on(RoomEvent.TrackUnsubscribed, onAny);
        room.on(RoomEvent.TrackMuted, onAny);
        room.on(RoomEvent.TrackUnmuted, onAny);
        room.on(RoomEvent.Reconnected, onAny);
        room.on(RoomEvent.ConnectionStateChanged, onAny);

        return () => {
            room.off(RoomEvent.ParticipantConnected, onAny);
            room.off(RoomEvent.ParticipantDisconnected, onAny);
            room.off(RoomEvent.TrackSubscribed, onAny);
            room.off(RoomEvent.TrackUnsubscribed, onAny);
            room.off(RoomEvent.TrackMuted, onAny);
            room.off(RoomEvent.TrackUnmuted, onAny);
            room.off(RoomEvent.Reconnected, onAny);
            room.off(RoomEvent.ConnectionStateChanged, onAny);
        };
    }, [room, rebuild]);

    return (
        <>
            {tracks.map((item) => {
                const participantVolumeKey = getParticipantVolumeKey({
                    id: item.id,
                    participantUserId: item.participantUserId,
                    participantIdentity: item.participantIdentity,
                });

                const participantVolumePct = volumePctByParticipantKey[participantVolumeKey];

                return (
                    <AudioEl
                        key={item.id}
                        track={item.track}
                        audioOutputId={audioOutputId}
                        debugLabel={item.label}
                        defaultRemoteVolumePct={defaultRemoteVolumePct}
                        participantVolumePct={participantVolumePct}
                        recoveryTick={recoveryTick}
                    />
                );
            })}
        </>
    );
}

function AudioEl({
    track,
    audioOutputId,
    debugLabel,
    defaultRemoteVolumePct,
    participantVolumePct,
    recoveryTick,
}: {
    track: RemoteAudioTrack;
    audioOutputId: string;
    debugLabel: string;
    defaultRemoteVolumePct: number;
    participantVolumePct?: number;
    recoveryTick: number;
}) {
    const ref = useRef<HTMLAudioElement | null>(null);
    const retryTimerRef = useRef<number | null>(null);
    const mountedRef = useRef(false);
    const lastPlayAttemptAtRef = useRef(0);
    const graphRef = useRef<AudioGraph | null>(null);

    const effectiveVolumeMultiplier = useMemo(
        () =>
            getEffectiveVolumeMultiplier({
                defaultRemoteVolumePct,
                participantVolumePct,
            }),
        [defaultRemoteVolumePct, participantVolumePct]
    );

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // IMPORTANT:
    // volume changes must NOT rebuild / detach / close the whole audio pipeline.
    // Only update gain here.
    useEffect(() => {
        const graph = graphRef.current;
        const el = ref.current;

        if (graph) {
            try {
                graph.gainNode.gain.value = effectiveVolumeMultiplier;
            } catch { }
            return;
        }

        if (el) {
            try {
                el.volume = Math.max(0, Math.min(1, effectiveVolumeMultiplier));
            } catch { }
        }
    }, [effectiveVolumeMultiplier]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        let cancelled = false;
        const isMobile = isProbablyMobileOrTablet();

        const clearRetryTimer = () => {
            if (retryTimerRef.current !== null) {
                window.clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
        };

        const ensureAudioGraph = async () => {
            if (cancelled || !mountedRef.current) return;

            const existing = graphRef.current;
            if (existing) {
                try {
                    existing.gainNode.gain.value = effectiveVolumeMultiplier;
                } catch { }
                try {
                    if (existing.audioContext.state === "suspended") {
                        await existing.audioContext.resume();
                    }
                } catch { }
                return;
            }

            const audioContext = makeAudioContext();
            if (!audioContext) {
                try {
                    el.volume = Math.max(0, Math.min(1, effectiveVolumeMultiplier));
                } catch { }
                return;
            }

            try {
                const source = audioContext.createMediaElementSource(el);
                const gainNode = audioContext.createGain();

                gainNode.gain.value = effectiveVolumeMultiplier;

                source.connect(gainNode);
                gainNode.connect(audioContext.destination);

                graphRef.current = {
                    audioContext,
                    source,
                    gainNode,
                };

                if (audioContext.state === "suspended") {
                    await audioContext.resume();
                }
            } catch (error) {
                console.warn(`Audio graph init failed for ${debugLabel}`, error);
                try {
                    el.volume = Math.max(0, Math.min(1, effectiveVolumeMultiplier));
                } catch { }
            }
        };

        const scheduleRetry = (reason: string, delayMs: number) => {
            if (cancelled || !mountedRef.current) return;

            clearRetryTimer();
            retryTimerRef.current = window.setTimeout(() => {
                void tryPlay(`${reason}-retry`);
            }, delayMs);
        };

        const tryPlay = async (reason: string) => {
            if (cancelled || !mountedRef.current) return;
            const audioEl = ref.current;
            if (!audioEl) return;

            const now = Date.now();
            if (now - lastPlayAttemptAtRef.current < 120) return;
            lastPlayAttemptAtRef.current = now;

            try {
                await ensureAudioGraph();

                const graph = graphRef.current;
                if (graph?.audioContext?.state === "suspended") {
                    await graph.audioContext.resume();
                }

                await audioEl.play();
            } catch (error) {
                console.warn(`Remote audio play failed for ${debugLabel} (${reason})`, error);
                scheduleRetry(reason, 900);
            }
        };

        const applySinkIfPossible = async () => {
            if (cancelled || !mountedRef.current) return;
            const audioEl = ref.current;
            if (!audioEl) return;
            if (isMobile) return;
            if (!audioOutputId || audioOutputId === "default") return;
            if (!canUseSinkSelection()) return;

            const sinkEl = audioEl as AudioWithSinkId;

            try {
                if (typeof sinkEl.setSinkId === "function") {
                    await sinkEl.setSinkId(audioOutputId);
                }
            } catch (error) {
                console.warn(`setSinkId failed for ${debugLabel}`, error);
            }
        };

        const onLoadedMetadata = () => {
            void tryPlay("loadedmetadata");
        };

        const onCanPlay = () => {
            void tryPlay("canplay");
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                void tryPlay("visibilitychange");
            }
        };

        const onFocus = () => {
            void tryPlay("focus");
        };

        const onPageShow = () => {
            void tryPlay("pageshow");
        };

        try {
            el.autoplay = true;
            el.preload = "auto";
            el.muted = false;
            el.volume = 1;
            el.setAttribute("playsinline", "true");
        } catch { }

        try {
            track.attach(el);
        } catch (error) {
            console.error(`Remote audio attach failed for ${debugLabel}`, error);
        }

        el.addEventListener("loadedmetadata", onLoadedMetadata);
        el.addEventListener("canplay", onCanPlay);
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("focus", onFocus);
        window.addEventListener("pageshow", onPageShow);

        void (async () => {
            await applySinkIfPossible();
            await ensureAudioGraph();
            await tryPlay("initial");
        })();

        return () => {
            cancelled = true;
            clearRetryTimer();

            el.removeEventListener("loadedmetadata", onLoadedMetadata);
            el.removeEventListener("canplay", onCanPlay);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("focus", onFocus);
            window.removeEventListener("pageshow", onPageShow);

            try {
                track.detach(el);
            } catch { }

            try {
                el.pause();
            } catch { }

            try {
                const graph = graphRef.current;
                if (graph) {
                    graph.source.disconnect();
                    graph.gainNode.disconnect();
                    void graph.audioContext.close();
                    graphRef.current = null;
                }
            } catch { }
        };
    }, [track, audioOutputId, debugLabel]);

    useEffect(() => {
        if (!mountedRef.current) return;

        const graph = graphRef.current;
        if (graph?.audioContext?.state === "suspended") {
            graph.audioContext.resume().catch(() => { });
        }

        const el = ref.current;
        if (!el) return;

        el.play().catch(() => { });
    }, [recoveryTick]);

    return <audio ref={ref} autoPlay />;
}

export default RemoteAudioRenderer;