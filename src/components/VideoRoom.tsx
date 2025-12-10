// src/components/VideoRoom.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import type { JitsiParticipant, JitsiTrack } from "../lib/jitsiEngine";

type ReactionType = "fire" | "laugh" | "clap" | "heart" | "thumbsUp" | "thumbsDown";

type Reaction = {
    id: number;
    type: ReactionType;
};

type VideoRoomProps = {
    participants: JitsiParticipant[];
    onToggleAudio: () => void;
    onToggleVideo: () => void;
    onToggleScreenShare: () => void;
    onLeave?: () => void;
};

const reactionEmoji: Record<ReactionType, string> = {
    fire: "🔥",
    laugh: "😂",
    clap: "👏",
    heart: "❤️",
    thumbsUp: "👍",
    thumbsDown: "👎",
};

function attachTrackToMedia(track: JitsiTrack | undefined, element: HTMLMediaElement | null) {
    if (!track || !element) return;

    try {
        track.attach(element);
    } catch (e) {
        console.error("attach error", e);
    }

    return () => {
        try {
            track.detach(element);
        } catch {
            // ignore
        }
    };
}

function VideoTile({ participant }: { participant: JitsiParticipant }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // attach video (camera)
    useEffect(() => {
        if (!videoRef.current || !participant.videoTrack) return;
        return attachTrackToMedia(participant.videoTrack, videoRef.current);
    }, [participant.videoTrack]);

    // attach audio (remote only)
    useEffect(() => {
        if (participant.isLocal) return;
        if (!audioRef.current || !participant.audioTrack) return;
        return attachTrackToMedia(participant.audioTrack, audioRef.current);
    }, [participant.audioTrack, participant.isLocal]);

    return (
        <div className="relative bg-black rounded-2xl overflow-hidden flex items-center justify-center">
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={participant.isLocal}
                className="w-full h-full object-cover"
            />
            {!participant.videoTrack && (
                <div className="w-full h-full flex items-center justify-center bg-[#111827]">
                    <span className="text-3xl font-semibold">
                        {participant.displayName?.[0]?.toUpperCase() || "?"}
                    </span>
                </div>
            )}

            {/* name + mic status */}
            <div className="absolute left-3 bottom-3 rounded-md bg-black/55 px-2 py-1 text-[11px] flex items-center gap-2">
                <span className="text-white/80">
                    {participant.isLocal ? "You" : participant.displayName || "Guest"}
                </span>
                <span
                    className={
                        "w-2 h-2 rounded-full " +
                        (participant.audioMuted ? "bg-red-500" : "bg-green-400")
                    }
                ></span>
            </div>

            <audio ref={audioRef} autoPlay />
        </div>
    );
}

function ScreenShareLayout({
    screenSharer,
    others,
}: {
    screenSharer: JitsiParticipant;
    others: JitsiParticipant[];
}) {
    const screenVideoRef = useRef<HTMLVideoElement | null>(null);

    // screen track
    useEffect(() => {
        if (!screenVideoRef.current || !screenSharer.screenTrack) return;
        return attachTrackToMedia(screenSharer.screenTrack, screenVideoRef.current);
    }, [screenSharer.screenTrack]);

    const cameraParticipant = screenSharer.videoTrack ? screenSharer : undefined;

    return (
        <div className="relative w-full h-full flex flex-col md:flex-row gap-2">
            {/* main screenshare */}
            <div className="relative flex-1 bg-black rounded-2xl overflow-hidden">
                <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    muted={screenSharer.isLocal}
                    className="w-full h-full object-contain bg-black"
                />
                <div className="absolute left-3 bottom-3 rounded-md bg-black/60 px-2 py-1 text-[11px]">
                    <span className="text-white/80">
                        {screenSharer.isLocal ? "You (screen)" : `${screenSharer.displayName} (screen)`}
                    </span>
                </div>

                {cameraParticipant && (
                    <div className="hidden md:block absolute top-3 right-3 w-40 h-24 rounded-xl overflow-hidden border border-white/30 shadow-lg">
                        <VideoTile participant={cameraParticipant} />
                    </div>
                )}
            </div>

            {/* strip of others */}
            <div className="flex md:flex-col gap-2 md:w-52 w-full md:h-full">
                {others.map((p) => (
                    <div key={p.id} className="flex-1 min-h-[70px]">
                        <VideoTile participant={p} />
                    </div>
                ))}
            </div>
        </div>
    );
}

export function VideoRoom(props: VideoRoomProps) {
    const { participants, onToggleAudio, onToggleVideo, onToggleScreenShare, onLeave } =
        props;

    const [reactions, setReactions] = useState<Reaction[]>([]);
    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    const [reactionCounter, setReactionCounter] = useState(0);

    const screenSharer = useMemo(
        () => participants.find((p) => p.isScreenSharing && p.screenTrack),
        [participants]
    );

    const othersForScreen = useMemo(() => {
        if (!screenSharer) return [];
        return participants.filter((p) => p.id !== screenSharer.id);
    }, [participants, screenSharer]);

    const handleReactionClick = (type: ReactionType) => {
        const id = reactionCounter + 1;
        setReactionCounter(id);
        setReactions((prev) => [...prev, { id, type }]);
        setShowReactionsMenu(false);

        setTimeout(() => {
            setReactions((prev) => prev.filter((r) => r.id !== id));
        }, 1200);
    };

    const count = participants.length;

    const gridColsClass =
        count <= 1
            ? "grid-cols-1 sm:grid-cols-1 md:grid-cols-1"
            : count === 2
                ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-2"
                : count <= 4
                    ? "grid-cols-2 sm:grid-cols-2 md:grid-cols-2"
                    : count <= 9
                        ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-3"
                        : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";

    return (
        <div className="relative w-full h-full flex flex-col">
            {/* VIDEO AREA */}
            <div className="flex-1 relative overflow-hidden rounded-2xl bg-black/80">
                {!screenSharer && (
                    <div className={`w-full h-full grid gap-2 p-2 ${gridColsClass}`}>
                        {participants.map((p) => (
                            <VideoTile key={p.id} participant={p} />
                        ))}
                    </div>
                )}

                {screenSharer && (
                    <div className="w-full h-full p-2">
                        <ScreenShareLayout screenSharer={screenSharer} others={othersForScreen} />
                    </div>
                )}

                {/* REACTIONS FLOATING OVERLAY */}
                {reactions.length > 0 && (
                    <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-20">
                        {reactions.map((r) => (
                            <div
                                key={r.id}
                                className="text-4xl drop-shadow-lg animate-pulse"
                            >
                                {reactionEmoji[r.type]}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* CONTROLS BAR */}
            <div className="mt-3 flex items-center justify-center">
                <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-[#020617]/90 border border-white/10 shadow-lg">
                    <button
                        onClick={onToggleAudio}
                        className="w-10 h-10 rounded-full bg-[#111827] flex items-center justify-center text-white hover:bg-[#1f2937] text-sm"
                    >
                        🎙
                    </button>
                    <button
                        onClick={onToggleVideo}
                        className="w-10 h-10 rounded-full bg-[#111827] flex items-center justify-center text-white hover:bg-[#1f2937] text-sm"
                    >
                        🎥
                    </button>
                    <button
                        onClick={onToggleScreenShare}
                        className="w-10 h-10 rounded-full bg-[#111827] flex items-center justify-center text-white hover:bg-[#1f2937] text-sm"
                    >
                        🖥
                    </button>

                    {/* reactions */}
                    <div className="relative">
                        <button
                            onClick={() => setShowReactionsMenu((v) => !v)}
                            className="w-10 h-10 rounded-full bg-[#111827] flex items-center justify-center text-white hover:bg-[#1f2937] text-sm"
                        >
                            😊
                        </button>
                        {showReactionsMenu && (
                            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-[#020617] border border-white/10 rounded-2xl px-3 py-2 flex gap-2 text-xl">
                                <button onClick={() => handleReactionClick("fire")}>🔥</button>
                                <button onClick={() => handleReactionClick("laugh")}>😂</button>
                                <button onClick={() => handleReactionClick("clap")}>👏</button>
                                <button onClick={() => handleReactionClick("heart")}>❤️</button>
                                <button onClick={() => handleReactionClick("thumbsUp")}>👍</button>
                                <button onClick={() => handleReactionClick("thumbsDown")}>👎</button>
                            </div>
                        )}
                    </div>

                    {/* leave */}
                    {onLeave && (
                        <button
                            onClick={onLeave}
                            className="ml-2 px-3 h-9 rounded-full bg-red-600 text-white text-xs font-medium hover:bg-red-700"
                        >
                            Leave
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
