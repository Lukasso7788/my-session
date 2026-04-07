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
};

type AudioWithSinkId = HTMLAudioElement & {
    setSinkId?: (deviceId: string) => Promise<void>;
};

function isProbablyMobileOrTablet() {
    if (typeof window === "undefined") return false;

    try {
        if (window.matchMedia("(max-width: 1023px)").matches) return true;
    } catch {
        // ignore
    }

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

export function RemoteAudioRenderer({
    room,
    audioOutputId,
}: {
    room: Room | null;
    audioOutputId: string;
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

    const renderedTracks = useMemo(() => tracks, [tracks]);

    return (
        <>
            {renderedTracks.map((item) => (
                <AudioEl
                    key={item.id}
                    track={item.track}
                    audioOutputId={audioOutputId}
                    debugLabel={item.label}
                />
            ))}
        </>
    );
}

function AudioEl({
    track,
    audioOutputId,
    debugLabel,
}: {
    track: RemoteAudioTrack;
    audioOutputId: string;
    debugLabel: string;
}) {
    const ref = useRef<HTMLAudioElement | null>(null);
    const retryTimerRef = useRef<number | null>(null);
    const mountedRef = useRef(false);
    const lastPlayAttemptAtRef = useRef(0);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

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

        const scheduleRetry = (reason: string, delayMs: number) => {
            if (cancelled || !mountedRef.current) return;

            clearRetryTimer();
            retryTimerRef.current = window.setTimeout(() => {
                void tryPlay(`${reason}-retry`);
            }, delayMs);
        };

        const tryPlay = async (reason: string) => {
            if (cancelled || !mountedRef.current) return;
            if (!ref.current) return;

            const now = Date.now();
            if (now - lastPlayAttemptAtRef.current < 120) return;
            lastPlayAttemptAtRef.current = now;

            try {
                await ref.current.play();
            } catch (error) {
                console.warn(`Remote audio play failed for ${debugLabel} (${reason})`, error);
                scheduleRetry(reason, 900);
            }
        };

        const applySinkIfPossible = async () => {
            if (cancelled || !mountedRef.current) return;
            if (!ref.current) return;
            if (isMobile) return;
            if (!audioOutputId || audioOutputId === "default") return;
            if (!canUseSinkSelection()) return;

            const audioEl = ref.current as AudioWithSinkId;

            try {
                if (typeof audioEl.setSinkId === "function") {
                    await audioEl.setSinkId(audioOutputId);
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

        try {
            el.autoplay = true;
            el.preload = "auto";
            el.muted = false;
            el.volume = 1;
            el.setAttribute("playsinline", "true");
        } catch {
            // ignore
        }

        try {
            track.attach(el);
        } catch (error) {
            console.error(`Remote audio attach failed for ${debugLabel}`, error);
        }

        el.addEventListener("loadedmetadata", onLoadedMetadata);
        el.addEventListener("canplay", onCanPlay);
        document.addEventListener("visibilitychange", onVisibilityChange);

        void (async () => {
            await applySinkIfPossible();
            await tryPlay("initial");
        })();

        return () => {
            cancelled = true;
            clearRetryTimer();

            el.removeEventListener("loadedmetadata", onLoadedMetadata);
            el.removeEventListener("canplay", onCanPlay);
            document.removeEventListener("visibilitychange", onVisibilityChange);

            try {
                track.detach(el);
            } catch {
                // ignore
            }

            try {
                el.pause();
                el.srcObject = null;
                el.removeAttribute("src");
                el.load();
            } catch {
                // ignore
            }
        };
    }, [track, audioOutputId, debugLabel]);

    return <audio ref={ref} autoPlay />;
}

export default RemoteAudioRenderer;