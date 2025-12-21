// src/components/VideoRoom.tsx

/*
================================================================================
CHANGELOG (AS CODE)
================================================================================
ADD:
- const SCROLL_STEP = 5;  // шаг “прокрутки” участников (не “страницы”)
- const [scrollIndex, setScrollIndex] = useState(0); // вместо page/page switching
- canScroll + goPrev/goNext логика для “scroll-to-rest” поведения (offset window)
- overlay label: "Showing X–Y of N" вместо "Page A/B"

CHANGE:
- AudioSink wrapper: БОЛЬШЕ НЕ display:none (className="hidden")
  -> теперь это невидимый, но РЕАЛЬНО существующий в DOM контейнер (0x0 + opacity-0),
     чтобы браузер НЕ глушил audio playback.
- pageParticipants/screenOthers slicing: теперь slice по scrollIndex, а не по page.
- clamp: scrollIndex теперь clamped под (0..maxStart) когда меняются participants/screenSharer.

REMOVE:
- УБРАНО только одно: className="hidden" у AudioSink контейнера (т.к. это ломало звук).
  (Остальная архитектура — P2PLayout/GridLayout/ScreenShareLayout/layoutVersion — сохранена.)
================================================================================
*/

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
    // приходит из RoomPage (у тебя уже передаётся)
    activeScreenSharer?: string | null;

    // реакции, которые пришли по сети (у тебя уже передаётся)
    incomingReactions?: { id: number; type: ReactionType }[];

    // новый коллбек: какие ids сейчас реально видны на экране (для подписок SFU)
    onVisibleVideoIdsChange?: (ids: string[]) => void;

    // опционально: если захочешь наружу прокидывать реакцию в engine
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

function safeTrackId(track?: any): string {
    if (!track) return "none";
    try {
        if (typeof track.getId === "function") return String(track.getId());
    } catch { }
    // fallback: чтобы key менялся при смене инстанса
    return String((track as any)?._id ?? "track");
}

function attachTrackToMedia(
    track: JitsiTrack | undefined,
    element: HTMLMediaElement | null
) {
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

// ----------------------- Icons -----------------------
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
            <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
            />
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

// ----------------------- Audio sink -----------------------
// ВАЖНО: аудио должно работать даже если участник НЕ отображается на текущем “окне” (20 tiles).
function AudioSinkItem({ p }: { p: JitsiParticipant }) {
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (!audioRef.current) return;
        if (!p.audioTrack) return;
        if (p.isLocal) return;

        p.audioTrack.attach(audioRef.current);

        return () => {
            try {
                p.audioTrack.detach(audioRef.current!);
            } catch { }
        };
    }, [p.audioTrack, p.isLocal]);

    // Скрытый (но НЕ display:none) audio-элемент
    return <audio ref={audioRef} autoPlay playsInline preload="auto" />;
}

function AudioSink({ participants }: { participants: JitsiParticipant[] }) {
    // только remote
    const remotes = useMemo(
        () => participants.filter((p) => !p.isLocal),
        [participants]
    );

    return (
        // НЕЛЬЗЯ className="hidden" / display:none — браузер может НЕ играть звук.
        <div className="absolute w-0 h-0 overflow-hidden opacity-0 pointer-events-none">
            {remotes.map((p) => {
                const key = `${p.id}:${safeTrackId(p.audioTrack)}`;
                return <AudioSinkItem key={key} p={p} />;
            })}
        </div>
    );
}

// ----------------------- Tiles -----------------------
function ParticipantTile({
    participant,
    tileKey,
}: {
    participant: JitsiParticipant;
    tileKey: string;
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const videoTrackId = useMemo(
        () => safeTrackId(participant.videoTrack),
        [participant.videoTrack]
    );

    // attach camera video только если есть трек и он не muted
    useEffect(() => {
        if (!videoRef.current) return;
        if (!participant.videoTrack) return;

        return attachTrackToMedia(participant.videoTrack, videoRef.current);
    }, [videoTrackId]);

    const showVideo = !!participant.videoTrack && !participant.videoMuted;

    return (
        <div
            className="relative bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-white/5"
            data-tile-key={tileKey}
        >
            {/* 16:9 frame внутри ячейки */}
            <div className="w-full h-full flex items-center justify-center">
                <div className="w-full max-w-full aspect-video bg-black">
                    {showVideo ? (
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted={participant.isLocal}
                            className="w-full h-full object-contain bg-black"
                        />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-[#111827]">
                            <div className="w-16 h-16 rounded-full bg-[#374151] flex items-center justify-center text-2xl font-semibold">
                                {participant.displayName?.[0]?.toUpperCase() || "?"}
                            </div>
                            <span className="mt-2 text-sm text-white/80">
                                {participant.isLocal ? "You" : participant.displayName || "Guest"}
                            </span>
                        </div>
                    )}
                </div>
            </div>

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
                />
            </div>
        </div>
    );
}

// ----------------------- Layouts -----------------------
function computeGrid(count: number) {
    if (count <= 1) return { cols: 1, rows: 1 };

    // square-ish grid
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    return { cols, rows };
}

function GridLayout({
    pageParticipants,
    layoutVersion,
}: {
    pageParticipants: JitsiParticipant[];
    layoutVersion: number;
}) {
    const { cols, rows } = useMemo(
        () => computeGrid(pageParticipants.length),
        [pageParticipants.length]
    );

    return (
        <div
            key={`grid:${layoutVersion}:${pageParticipants.length}:${cols}x${rows}`}
            className="w-full h-full grid gap-2 p-2"
            style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
        >
            {pageParticipants.map((p) => {
                const tileKey = `${p.id}:${safeTrackId(p.videoTrack)}:${safeTrackId(
                    p.screenTrack
                )}`;
                return <ParticipantTile key={tileKey} participant={p} tileKey={tileKey} />;
            })}
        </div>
    );
}

function P2PLayout({
    pageParticipants,
    layoutVersion,
}: {
    pageParticipants: JitsiParticipant[];
    layoutVersion: number;
}) {
    // 1 или 2 участника: делаем стабильный split без “пляски”
    const count = pageParticipants.length;

    return (
        <div
            key={`p2p:${layoutVersion}:${count}`}
            className="w-full h-full grid gap-2 p-2"
            style={{
                gridTemplateColumns: count <= 1 ? "1fr" : "1fr 1fr",
                gridTemplateRows: "1fr",
            }}
        >
            {pageParticipants.map((p) => {
                const tileKey = `${p.id}:${safeTrackId(p.videoTrack)}`;
                return <ParticipantTile key={tileKey} participant={p} tileKey={tileKey} />;
            })}
        </div>
    );
}

function ScreenShareLayout({
    screenSharer,
    others,
    layoutVersion,
}: {
    screenSharer: JitsiParticipant;
    others: JitsiParticipant[];
    layoutVersion: number;
}) {
    const screenVideoRef = useRef<HTMLVideoElement | null>(null);
    const screenTrackId = useMemo(
        () => safeTrackId(screenSharer.screenTrack),
        [screenSharer.screenTrack]
    );

    useEffect(() => {
        if (!screenVideoRef.current) return;
        if (!screenSharer.screenTrack) return;
        return attachTrackToMedia(screenSharer.screenTrack, screenVideoRef.current);
    }, [screenTrackId]);

    // мини-камера поверх (если у шарера есть камера)
    const cameraParticipant =
        screenSharer.videoTrack && !screenSharer.videoMuted ? screenSharer : undefined;

    return (
        <div
            key={`screen:${layoutVersion}:${screenSharer.id}:${screenTrackId}`}
            className="relative w-full h-full flex flex-col md:flex-row gap-2 p-2"
        >
            {/* main screenshare */}
            <div className="relative flex-1 bg-black rounded-2xl overflow-hidden border border-white/5">
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
                    <div className="hidden md:block absolute top-3 right-3 w-44 aspect-video rounded-xl overflow-hidden border border-white/20 shadow-lg bg-black">
                        <ParticipantTile
                            participant={cameraParticipant}
                            tileKey={`${cameraParticipant.id}:${safeTrackId(cameraParticipant.videoTrack)}`}
                        />
                    </div>
                )}
            </div>

            {/* strip of others */}
            <div className="flex md:flex-col gap-2 md:w-56 w-full">
                {others.map((p) => {
                    const tileKey = `${p.id}:${safeTrackId(p.videoTrack)}`;
                    return (
                        <div key={tileKey} className="md:h-[140px] w-full">
                            <ParticipantTile participant={p} tileKey={tileKey} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ----------------------- Main -----------------------
export function VideoRoom(props: VideoRoomProps) {
    const {
        participants,
        onToggleAudio,
        onToggleVideo,
        onToggleScreenShare,
        onLeave,
        onSendReaction,
        incomingReactions,
        onVisibleVideoIdsChange,
    } = props;

    const PAGE_SIZE = 25;
    const SCROLL_STEP = 5; // “скроллится к остатку”, а не “переключает страницу”

    // реакции UI
    const [reactions, setReactions] = useState<Reaction[]>([]);
    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    const [reactionCounter, setReactionCounter] = useState(0);
    const menuRef = useRef<HTMLDivElement | null>(null);

    // “scroll window” participants (offset), НЕ page switching
    const [scrollIndex, setScrollIndex] = useState(0);

    // layout reset — помогает при SFU ↔ P2P переходах и резких сменах состава
    const [layoutVersion, setLayoutVersion] = useState(0);

    const screenSharer = useMemo(
        () => participants.find((p) => p.isScreenSharing && p.screenTrack),
        [participants]
    );

    const isP2P = useMemo(() => participants.length <= 2, [participants.length]);

    const localParticipant = useMemo(
        () => participants.find((p) => p.isLocal) || null,
        [participants]
    );

    // базовый список участников для grid (если screen share — шарер отдельно)
    const baseParticipants = useMemo(() => {
        return screenSharer ? participants.filter((p) => p.id !== screenSharer.id) : participants;
    }, [participants, screenSharer]);

    const maxStartIndex = useMemo(() => {
        return Math.max(0, baseParticipants.length - PAGE_SIZE);
    }, [baseParticipants.length]);

    const canScroll = useMemo(
        () => baseParticipants.length > PAGE_SIZE,
        [baseParticipants.length]
    );

    // clamp scrollIndex when participants change
    useEffect(() => {
        setScrollIndex((i) => Math.min(Math.max(0, i), maxStartIndex));
    }, [maxStartIndex]);

    // IMPORTANT: при смене треков пересобираем layout DOM (стабилизирует attach/detach)
    const tracksSignature = useMemo(() => {
        return participants
            .flatMap((p) => [safeTrackId(p.videoTrack), safeTrackId(p.screenTrack)])
            .join("|");
    }, [participants]);

    useEffect(() => {
        setLayoutVersion((v) => v + 1);
    }, [tracksSignature]);

    // “окно” участников на экране (visual only)
    const pageParticipants = useMemo(() => {
        const start = scrollIndex;
        const end = start + PAGE_SIZE;
        return baseParticipants.slice(start, end);
    }, [baseParticipants, scrollIndex]);

    // others in screenshare layout (тоже “окно”, потому что может быть 100)
    const screenOthers = useMemo(() => {
        if (!screenSharer) return [];
        const start = scrollIndex;
        const end = start + PAGE_SIZE;
        return baseParticipants.slice(start, end);
    }, [baseParticipants, screenSharer, scrollIndex]);

    // ids remote участников, которые реально видны (для SFU подписок)
    const visibleRemoteIds = useMemo(() => {
        const visibleList = screenSharer ? [screenSharer, ...screenOthers] : pageParticipants;
        return visibleList
            .map((p) => p.id)
            .filter((id) => id && id !== localParticipant?.id);
    }, [screenSharer, screenOthers, pageParticipants, localParticipant?.id]);

    useEffect(() => {
        const t = setTimeout(() => onVisibleVideoIdsChange?.(visibleRemoteIds), 150);
        return () => clearTimeout(t);
    }, [onVisibleVideoIdsChange, visibleRemoteIds]);

    const isAudioMuted = !!localParticipant?.audioMuted;
    const isVideoMuted = !!localParticipant?.videoMuted;
    const isScreenSharing = !!localParticipant?.isScreenSharing;

    const handleReactionClick = (type: ReactionType) => {
        const id = reactionCounter + 1;
        setReactionCounter(id);
        setReactions((prev) => [...prev, { id, type }]);

        // наружу (в engine) — если подключишь:
        onSendReaction?.(type);

        setTimeout(() => {
            setReactions((prev) => prev.filter((r) => r.id !== id));
        }, 1500);
    };

    // закрытие меню реакций при клике вне
    useEffect(() => {
        if (!showReactionsMenu) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (!menuRef.current || !target) return;
            if (!menuRef.current.contains(target)) {
                setShowReactionsMenu(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [showReactionsMenu]);

    const baseBtn =
        "w-10 h-10 rounded-full flex items-center justify-center text-white text-sm transition";

    const goPrev = () => setScrollIndex((i) => Math.max(0, i - SCROLL_STEP));
    const goNext = () => setScrollIndex((i) => Math.min(maxStartIndex, i + SCROLL_STEP));

    const shownStart = canScroll ? scrollIndex + 1 : Math.min(1, baseParticipants.length);
    const shownEnd = Math.min(scrollIndex + PAGE_SIZE, baseParticipants.length);

    return (
        <div className="relative w-full h-full flex flex-col">
            {/* Always-on audio for all remote participants */}
            <AudioSink participants={participants} />

            {/* VIDEO AREA */}
            <div className="flex-1 relative overflow-hidden rounded-2xl bg-black/80">
                {!screenSharer && (
                    <>
                        {isP2P ? (
                            <P2PLayout pageParticipants={pageParticipants} layoutVersion={layoutVersion} />
                        ) : (
                            <GridLayout pageParticipants={pageParticipants} layoutVersion={layoutVersion} />
                        )}
                    </>
                )}

                {screenSharer && (
                    <ScreenShareLayout
                        screenSharer={screenSharer}
                        others={screenOthers}
                        layoutVersion={layoutVersion}
                    />
                )}

                {/* Reactions floating overlay (local + incoming) */}
                {((reactions?.length || 0) + (incomingReactions?.length || 0) > 0) && (
                    <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-20 gap-2">
                        {reactions.map((r) => (
                            <div key={`local-${r.id}`} className="text-4xl drop-shadow-lg animate-bounce">
                                {reactionEmoji[r.type]}
                            </div>
                        ))}

                        {(incomingReactions || []).map((r) => (
                            <div key={`in-${r.id}`} className="text-4xl drop-shadow-lg animate-bounce">
                                {reactionEmoji[r.type]}
                            </div>
                        ))}
                    </div>
                )}

                {/* Scroll overlay (only if > 20 shown) */}
                {canScroll && (
                    <div className="absolute top-3 right-3 flex items-center gap-2">
                        <button
                            onClick={goPrev}
                            disabled={scrollIndex === 0}
                            className={
                                "px-3 h-9 rounded-full bg-black/55 border border-white/10 text-white text-sm " +
                                (scrollIndex === 0 ? "opacity-40 cursor-not-allowed" : "hover:bg-black/70")
                            }
                            title="Scroll back"
                        >
                            ←
                        </button>

                        <div className="px-3 h-9 rounded-full bg-black/55 border border-white/10 text-white text-xs flex items-center">
                            Showing {shownStart}–{shownEnd} of {baseParticipants.length}
                        </div>

                        <button
                            onClick={goNext}
                            disabled={scrollIndex >= maxStartIndex}
                            className={
                                "px-3 h-9 rounded-full bg-black/55 border border-white/10 text-white text-sm " +
                                (scrollIndex >= maxStartIndex ? "opacity-40 cursor-not-allowed" : "hover:bg-black/70")
                            }
                            title="Scroll forward"
                        >
                            →
                        </button>
                    </div>
                )}
            </div>

            {/* CONTROLS BAR */}
            <div className="mt-3 flex items-center justify-center">
                <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-[#020617]/90 border border-white/10 shadow-lg">
                    <button
                        onClick={onToggleAudio}
                        className={
                            baseBtn +
                            " " +
                            (isAudioMuted ? "bg-red-600 hover:bg-red-700" : "bg-[#111827] hover:bg-[#1f2937]")
                        }
                    >
                        <MicIcon />
                    </button>

                    <button
                        onClick={onToggleVideo}
                        className={
                            baseBtn +
                            " " +
                            (isVideoMuted ? "bg-red-600 hover:bg-red-700" : "bg-[#111827] hover:bg-[#1f2937]")
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

                    {/* leave */}
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
