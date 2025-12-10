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

    /** Важное: движок передаёт callback для глобальных реакций */
    onExternalReaction?: (cb: (emoji: string) => void) => void;
};

const reactionEmoji: Record<ReactionType, string> = {
    fire: "🔥",
    laugh: "😂",
    clap: "👏",
    heart: "❤️",
    thumbsUp: "👍",
    thumbsDown: "👎",
};

function attachTrack(track: JitsiTrack | undefined, element: HTMLMediaElement | null) {
    if (!track || !element) return;
    try {
        track.attach(element);
        return () => track.detach(element);
    } catch (e) {
        console.error("attach error", e);
    }
}

function VideoTile({ participant }: { participant: JitsiParticipant }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // attach video
    useEffect(() => {
        if (!videoRef.current) return;
        if (participant.videoMuted || !participant.videoTrack) return;
        return attachTrack(participant.videoTrack, videoRef.current);
    }, [participant.videoTrack, participant.videoMuted]);

    // attach remote audio
    useEffect(() => {
        if (participant.isLocal) return;
        if (!audioRef.current || !participant.audioTrack) return;
        return attachTrack(participant.audioTrack, audioRef.current);
    }, [participant.audioTrack, participant.isLocal]);

    return (
        <div className="relative bg-black rounded-2xl overflow-hidden flex items-center justify-center">
            {!participant.videoMuted && participant.videoTrack ? (
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={participant.isLocal}
                    className="w-full h-full object-contain bg-black"
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center bg-[#111827]">
                    <span className="text-3xl font-semibold">
                        {participant.displayName?.[0]?.toUpperCase() || "?"}
                    </span>
                </div>
            )}

            {/* Info bar */}
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
    const ref = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        if (!ref.current || !screenSharer.screenTrack) return;
        return attachTrack(screenSharer.screenTrack, ref.current);
    }, [screenSharer.screenTrack]);

    const cameraTile = screenSharer.videoTrack && !screenSharer.videoMuted ? (
        <div className="absolute top-3 right-3 w-40 h-24 rounded-xl overflow-hidden border border-white/40 shadow-lg bg-black">
            <VideoTile participant={screenSharer} />
        </div>
    ) : null;

    return (
        <div className="relative w-full h-full flex flex-col md:flex-row gap-2">
            <div className="relative flex-1 rounded-2xl overflow-hidden bg-black">
                <video
                    ref={ref}
                    autoPlay
                    playsInline
                    muted={screenSharer.isLocal}
                    className="w-full h-full object-contain bg-black"
                />
                <div className="absolute left-3 bottom-3 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/80">
                    {screenSharer.isLocal
                        ? "You (screen)"
                        : `${screenSharer.displayName} (screen)`}
                </div>
                {cameraTile}
            </div>

            {/* Others */}
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

export function VideoRoom({
    participants,
    onToggleAudio,
    onToggleVideo,
    onToggleScreenShare,
    onLeave,
    onExternalReaction,
}: VideoRoomProps) {
    const [reactions, setReactions] = useState<Reaction[]>([]);
    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    const [counter, setCounter] = useState(0);
    const menuRef = useRef<HTMLDivElement | null>(null);

    const spawnReaction = (type: ReactionType) => {
        const id = counter + 1;
        setCounter(id);
        setReactions((p) => [...p, { id, type }]);

        setTimeout(() => {
            setReactions((p) => p.filter((r) => r.id !== id));
        }, 1600); // увеличено
    };

    // global reactions from engine
    useEffect(() => {
        if (!onExternalReaction) return;
        onExternalReaction((emoji) => spawnReaction(emoji as ReactionType));
    }, [onExternalReaction]);

    // close menu on outside click
    useEffect(() => {
        function handleOutside(e: any) {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setShowReactionsMenu(false);
            }
        }
        document.addEventListener("mousedown", handleOutside);
        return () => document.removeEventListener("mousedown", handleOutside);
    }, []);

    const screenSharer = useMemo(
        () => participants.find((p) => p.isScreenSharing && p.screenTrack),
        [participants]
    );

    const others = useMemo(() => {
        if (!screenSharer) return [];
        return participants.filter((p) => p.id !== screenSharer.id);
    }, [participants, screenSharer]);

    const count = participants.length;

    const gridCols =
        count <= 1
            ? "grid-cols-1"
            : count === 2
                ? "grid-cols-2"
                : count <= 4
                    ? "grid-cols-2 sm:grid-cols-2"
                    : count <= 9
                        ? "grid-cols-3"
                        : "grid-cols-4";

    return (
        <div className="relative w-full h-full flex flex-col">
            {/* VIDEO */}
            <div className="flex-1 relative overflow-hidden rounded-2xl bg-black/80">
                {!screenSharer ? (
                    <div className={`w-full h-full grid gap-2 p-2 ${gridCols}`}>
                        {participants.map((p) => (
                            <VideoTile key={p.id} participant={p} />
                        ))}
                    </div>
                ) : (
                    <div className="w-full h-full p-2">
                        <ScreenShareLayout screenSharer={screenSharer} others={others} />
                    </div>
                )}

                {/* Floating reactions */}
                {reactions.length > 0 && (
                    <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-20">
                        {reactions.map((r) => (
                            <div key={r.id} className="text-4xl drop-shadow-xl animate-bounce">
                                {reactionEmoji[r.type]}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* CONTROLS */}
            <div className="mt-3 flex items-center justify-center">
                <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-[#020617]/90 border border-white/10 shadow-lg">

                    {/* MIC */}
                    <button
                        onClick={onToggleAudio}
                        className="icon-btn"
                    >
                        <img src="/icons/mic.svg" className="w-5 h-5 opacity-90" />
                    </button>

                    {/* CAMERA */}
                    <button
                        onClick={onToggleVideo}
                        className="icon-btn"
                    >
                        <img src="/icons/camera.svg" className="w-5 h-5 opacity-90" />
                    </button>

                    {/* SCREEN SHARE */}
                    <button
                        onClick={onToggleScreenShare}
                        className="icon-btn"
                    >
                        <img src="/icons/screenshare.svg" className="w-5 h-5 opacity-90" />
                    </button>

                    {/* REACTIONS */}
                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={() => setShowReactionsMenu((v) => !v)}
                            className="icon-btn"
                        >
                            <img src="/icons/reactions.svg" className="w-5 h-5 opacity-90" />
                        </button>

                        {showReactionsMenu && (
                            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-[#020617] border border-white/10 rounded-2xl px-3 py-2 flex gap-2 text-xl">
                                {(
                                    ["fire", "laugh", "clap", "heart", "thumbsUp", "thumbsDown"] as ReactionType[]
                                ).map((t) => (
                                    <button
                                        key={t}
                                        onClick={() => {
                                            spawnReaction(t);
                                        }}
                                        className="hover:scale-125 transition"
                                    >
                                        {reactionEmoji[t]}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* LEAVE */}
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
