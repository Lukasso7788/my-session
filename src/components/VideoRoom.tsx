// src/components/VideoRoom.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import type { JitsiParticipant, JitsiTrack } from "../lib/jitsiEngine";

export type ReactionType =
    | "fire"
    | "laugh"
    | "clap"
    | "heart"
    | "thumbsUp"
    | "thumbsDown";

export type Reaction = {
    id: number;
    type: ReactionType;
};

type VideoRoomProps = {
    participants: JitsiParticipant[];
    onToggleAudio: () => void;
    onToggleVideo: () => void;
    onToggleScreenShare: () => void;
    onLeave?: () => void;

    // NEW:
    incomingReactions?: { id: number; fromId: string; type: ReactionType }[];
    onSendReaction?: (type: ReactionType) => void;
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
        } catch { }
    };
}

function MicIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            <path
                d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"
                fill="currentColor"
            />
            <path
                d="M6 11a1 1 0 0 0-2 0 8 8 0 0 0 7 7.93V21H9a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2h-2v-2.07A8 8 0 0 0 20 11a1 1 0 0 0-2 0 6 6 0 0 1-12 0z"
                fill="currentColor"
            />
        </svg>
    );
}

function CameraIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            <rect x="4" y="6" width="11" height="12" rx="2" fill="currentColor" />
            <path d="M17 9.5 21 7v10l-4-2.5z" fill="currentColor" />
        </svg>
    );
}

function ScreenIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            <rect x="3" y="4" width="18" height="12" rx="2" fill="currentColor" />
            <rect x="9" y="18" width="6" height="2" rx="1" fill="currentColor" />
        </svg>
    );
}

function SmileIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="9" cy="10" r="0.8" fill="currentColor" />
            <circle cx="15" cy="10" r="0.8" fill="currentColor" />
            <path
                d="M9 15c.7.8 1.6 1.2 3 1.2s2.3-.4 3-1.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
            />
        </svg>
    );
}

function LeaveIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
            <path
                d="M5 5h6a1 1 0 0 1 0 2H7v10h4a1 1 0 0 1 0 2H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
                fill="currentColor"
            />
            <path
                d="M13.7 8.3a1 1 0 0 1 1.4 0L19 12l-3.9 3.7a1 1 0 0 1-1.4-1.4L15.6 13H11a1 1 0 0 1 0-2h4.6l-1.3-1.3a1 1 0 0 1 0-1.4z"
                fill="currentColor"
            />
        </svg>
    );
}

function VideoTile({ participant }: { participant: JitsiParticipant }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (!videoRef.current || !participant.videoTrack || participant.videoMuted) return;
        return attachTrackToMedia(participant.videoTrack, videoRef.current);
    }, [participant.videoTrack, participant.videoMuted]);

    useEffect(() => {
        if (participant.isLocal) return;
        if (!audioRef.current || !participant.audioTrack) return;
        return attachTrackToMedia(participant.audioTrack, audioRef.current);
    }, [participant.audioTrack, participant.isLocal]);

    const showVideo = !!participant.videoTrack && !participant.videoMuted;

    return (
        <div className="relative bg-black rounded-2xl overflow-hidden flex items-center justify-center">
            {showVideo && (
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={participant.isLocal}
                    className="w-full h-full object-contain"
                />
            )}

            {!showVideo && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[#111827]">
                    <div className="w-16 h-16 rounded-full bg-[#374151] flex items-center justify-center text-2xl font-semibold">
                        {participant.displayName?.[0]?.toUpperCase() || "?"}
                    </div>
                    <span className="mt-2 text-sm text-white/80">
                        {participant.isLocal ? "You" : participant.displayName || "Guest"}
                    </span>
                </div>
            )}

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

    useEffect(() => {
        if (!screenVideoRef.current || !screenSharer.screenTrack) return;
        return attachTrackToMedia(screenSharer.screenTrack, screenVideoRef.current);
    }, [screenSharer.screenTrack]);

    const cameraParticipant =
        screenSharer.videoTrack && !screenSharer.videoMuted ? screenSharer : undefined;

    return (
        <div className="relative w-full h-full flex flex-col md:flex-row gap-2">
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
                        {screenSharer.isLocal
                            ? "You (screen)"
                            : `${screenSharer.displayName || "Guest"} (screen)`}
                    </span>
                </div>

                {cameraParticipant && (
                    <div className="hidden md:block absolute top-3 right-3 w-40 h-24 rounded-xl overflow-hidden border border-white/30 shadow-lg">
                        <VideoTile participant={cameraParticipant} />
                    </div>
                )}
            </div>

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
    const {
        participants,
        onToggleAudio,
        onToggleVideo,
        onToggleScreenShare,
        onLeave,
        incomingReactions,
        onSendReaction,
    } = props;

    const [reactions, setReactions] = useState<Reaction[]>([]);
    const [reactionCounter, setReactionCounter] = useState(0);
    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    const addReaction = (type: ReactionType) => {
        const id = reactionCounter + 1;
        setReactionCounter(id);

        setReactions((prev) => [...prev, { id, type }]);

        setTimeout(() => {
            setReactions((prev) => prev.filter((r) => r.id !== id));
        }, 1600);
    };

    const handleReactionClick = (type: ReactionType) => {
        addReaction(type);
        onSendReaction?.(type);
    };

    useEffect(() => {
        if (!incomingReactions || incomingReactions.length === 0) return;
        incomingReactions.forEach((r) => addReaction(r.type));
    }, [incomingReactions]);

    useEffect(() => {
        if (!showReactionsMenu) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (!menuRef.current) return;
            if (!menuRef.current.contains(e.target as Node)) {
                setShowReactionsMenu(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [showReactionsMenu]);

    const screenSharer = useMemo(
        () => participants.find((p) => p.isScreenSharing && p.screenTrack),
        [participants]
    );

    const othersForScreen = useMemo(() => {
        if (!screenSharer) return [];
        return participants.filter((p) => p.id !== screenSharer.id);
    }, [participants, screenSharer]);

    const localParticipant = useMemo(
        () => participants.find((p) => p.isLocal) || null,
        [participants]
    );

    const isAudioMuted = !!localParticipant?.audioMuted;
    const isVideoMuted = !!localParticipant?.videoMuted;
    const isScreenSharing = !!localParticipant?.isScreenSharing;

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

    const baseBtn =
        "w-10 h-10 rounded-full flex items-center justify-center text-white text-sm transition";

    return (
        <div className="relative w-full h-full flex flex-col">
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
                        <ScreenShareLayout
                            screenSharer={screenSharer}
                            others={othersForScreen}
                        />
                    </div>
                )}

                {reactions.length > 0 && (
                    <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-20">
                        {reactions.map((r) => (
                            <div key={r.id} className="text-4xl drop-shadow-lg animate-bounce">
                                {reactionEmoji[r.type]}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="mt-3 flex items-center justify-center">
                <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-[#020617]/90 border border-white/10 shadow-lg">

                    <button
                        onClick={onToggleAudio}
                        className={
                            baseBtn +
                            " " +
                            (isAudioMuted
                                ? "bg-red-600 hover:bg-red-700"
                                : "bg-[#111827] hover:bg-[#1f2937]")
                        }
                    >
                        <MicIcon />
                    </button>

                    <button
                        onClick={onToggleVideo}
                        className={
                            baseBtn +
                            " " +
                            (isVideoMuted
                                ? "bg-red-600 hover:bg-red-700"
                                : "bg-[#111827] hover:bg-[#1f2937]")
                        }
                    >
                        <CameraIcon />
                    </button>

                    <button
                        onClick={onToggleScreenShare}
                        className={
                            baseBtn +
                            " " +
                            (isScreenSharing
                                ? "bg-blue-600 hover:bg-blue-700"
                                : "bg-[#111827] hover:bg-[#1f2937]")
                        }
                    >
                        <ScreenIcon />
                    </button>

                    {/* reactions */}
                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={() => setShowReactionsMenu((v) => !v)}
                            className={baseBtn + " bg-[#111827] hover:bg-[#1f2937]"}
                        >
                            <SmileIcon />
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

                    {onLeave && (
                        <button
                            onClick={onLeave}
                            className="ml-2 px-3 h-9 rounded-full bg-red-600 text-white text-xs font-medium hover:bg-red-700 inline-flex items-center gap-1"
                        >
                            <LeaveIcon />
                            <span>Leave</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
