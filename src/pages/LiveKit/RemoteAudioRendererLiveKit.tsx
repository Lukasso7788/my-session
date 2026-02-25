import React, { useEffect, useRef, useState } from "react";
import {
    Room,
    RoomEvent,
    Track,
    RemoteParticipant,
    RemoteAudioTrack,
    RemoteAudioTrackPublication,
} from "livekit-client";

export function RemoteAudioRenderer({
    room,
    audioOutputId,
}: {
    room: Room | null;
    audioOutputId: string;
}) {
    const [tracks, setTracks] = useState<{ id: string; track: RemoteAudioTrack; label: string }[]>(
        []
    );

    const rebuild = () => {
        if (!room) {
            setTracks([]);
            return;
        }

        const next: { id: string; track: RemoteAudioTrack; label: string }[] = [];

        room.remoteParticipants.forEach((p: RemoteParticipant) => {
            p.audioTrackPublications.forEach((pub: RemoteAudioTrackPublication) => {
                if (pub.source !== Track.Source.Microphone) return;
                const t = pub.track;
                if (!t) return;
                const label = (p.name || p.identity || "Guest").trim() || "Guest";
                next.push({ id: `${p.sid}:${pub.trackSid}`, track: t, label });
            });
        });

        setTracks(next);
    };

    useEffect(() => {
        rebuild();
        if (!room) return;

        const onAny = () => rebuild();

        room.on(RoomEvent.ParticipantConnected, onAny);
        room.on(RoomEvent.ParticipantDisconnected, onAny);
        room.on(RoomEvent.TrackSubscribed, onAny);
        room.on(RoomEvent.TrackUnsubscribed, onAny);
        room.on(RoomEvent.Reconnected, onAny);

        return () => {
            room.off(RoomEvent.ParticipantConnected, onAny);
            room.off(RoomEvent.ParticipantDisconnected, onAny);
            room.off(RoomEvent.TrackSubscribed, onAny);
            room.off(RoomEvent.TrackUnsubscribed, onAny);
            room.off(RoomEvent.Reconnected, onAny);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [room]);

    return (
        <>
            {tracks.map((t) => (
                <AudioEl key={t.id} track={t.track} audioOutputId={audioOutputId} debugLabel={t.label} />
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

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        try {
            track.attach(el);
        } catch (e) {
            console.error("attach audio failed:", e);
        }

        (async () => {
            try {
                const anyEl = el as any;
                if (audioOutputId && audioOutputId !== "default" && typeof anyEl.setSinkId === "function") {
                    await anyEl.setSinkId(audioOutputId);
                }
            } catch {
                // ignore unsupported browsers
            }

            try {
                await el.play();
            } catch (e) {
                console.warn("audio play blocked for", debugLabel, e);
            }
        })();

        return () => {
            try {
                track.detach(el);
            } catch { }
        };
    }, [track, audioOutputId, debugLabel]);

    return <audio ref={ref} autoPlay playsInline />;
}

export default RemoteAudioRenderer;