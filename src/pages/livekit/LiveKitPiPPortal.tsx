import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Icon,
    reactionEmoji as REACTION_EMOJI,
    type ReactionType,
    type RoomTheme,
} from "./LiveKitUI";

export default function LiveKitPiPPortal({
    isLight,
    theme,
    sessionTitle,
    participantsCount,
    remainingTime,
    pipMode,
    pipGalleryTiles,
    pipGalleryColumns,
    renderTile,
    micOn,
    camOn,
    screenShareOn,
    onToggleMic,
    onToggleCam,
    onToggleScreenShare,
    onSendReaction,
    onSetPipMode,
    onOpenTasksPanel,
    chatPanel,
}: {
    isLight: boolean;
    theme: RoomTheme;
    sessionTitle: string;
    participantsCount: number;
    remainingTime: string;
    pipMode: "gallery" | "chat";
    pipGalleryTiles: any[];
    pipGalleryColumns: number;
    renderTile: (tile: any) => React.ReactNode;
    micOn: boolean;
    camOn: boolean;
    screenShareOn: boolean;
    onToggleMic: () => void;
    onToggleCam: () => void;
    onToggleScreenShare: () => void;
    onSendReaction: (type: ReactionType) => boolean;
    onSetPipMode: (mode: "gallery" | "chat") => void;
    onOpenTasksPanel?: () => void;
    chatPanel?: React.ReactNode;
}) {
    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    const [sentReaction, setSentReaction] = useState<ReactionType | null>(null);
    const sentReactionTimerRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (sentReactionTimerRef.current != null) {
                window.clearTimeout(sentReactionTimerRef.current);
            }
        };
    }, []);

    const shellBg = isLight ? "bg-[#F3F1F1] text-[#1F1F1F]" : "bg-[#1B1B1B] text-white";
    const headerBg = isLight
        ? "border-[#D8D0D0] bg-[#F3F1F1]"
        : "border-[#252525] bg-[#1B1B1B]";
    const footerBg = isLight
        ? "border-[#D8D0D0] bg-[#F3F1F1]"
        : "border-[#252525] bg-[#1B1B1B]";

    const pillActive = isLight ? "bg-[#1B1B1B] text-white" : "bg-[#F3F1F1] text-[#1B1B1B]";
    const pillIdle = isLight
        ? "bg-[#E6E6E6] text-black/70 hover:bg-[#DCDCDC]"
        : "bg-[#242424] text-white/80 hover:bg-[#303030]";

    const ctlBtnBase = useMemo(
        () =>
            `relative flex h-[2.9rem] w-[2.9rem] items-center justify-center rounded-full border transition ${isLight
                ? "border-[#D8D0D0] bg-[#E6E6E6] text-black/75 hover:bg-[#DCDCDC]"
                : "border-[#252525] bg-[#242424] text-white/90 hover:bg-[#303030]"
            }`,
        [isLight]
    );

    const reactionMenuSurface = isLight
        ? "border-[#D8D0D0] bg-[#F3F1F1] text-black shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
        : "border-[#252525] bg-[#1B1B1B] text-white shadow-[0_16px_40px_rgba(0,0,0,0.45)]";

    const reactionTypes = Object.keys(REACTION_EMOJI) as ReactionType[];

    const showReactionSentFeedback = (reactionType: ReactionType) => {
        if (sentReactionTimerRef.current != null) {
            window.clearTimeout(sentReactionTimerRef.current);
        }
        setSentReaction(reactionType);
        sentReactionTimerRef.current = window.setTimeout(() => {
            sentReactionTimerRef.current = null;
            setSentReaction(null);
        }, 1_500);
    };
    const resolvedGalleryColumns = useMemo(() => {
        const count = pipGalleryTiles.length;
        if (count <= 1) return 1;
        if (count === 2) return 2;
        if (count <= 4) return 2;
        if (count <= 6) return 3;
        return Math.max(3, pipGalleryColumns || 3);
    }, [pipGalleryColumns, pipGalleryTiles.length]);

    const resolvedGalleryRows = useMemo(() => {
        const count = Math.max(1, pipGalleryTiles.length);
        return Math.max(1, Math.ceil(count / Math.max(1, resolvedGalleryColumns)));
    }, [pipGalleryTiles.length, resolvedGalleryColumns]);
    return (
        <div className={`h-full w-full min-h-0 min-w-0 flex flex-col overflow-hidden ${shellBg}`}>
            <div
                className={`shrink-0 border-b px-[clamp(0.5rem,1.7vw,0.85rem)] py-[clamp(0.42rem,1.4vw,0.68rem)] ${headerBg}`}
            >
                <div className="flex items-center justify-between gap-[clamp(0.35rem,0.9vw,0.7rem)]">
                    <div className="min-w-0">
                        <div className="truncate text-[clamp(0.68rem,1.35vw,0.82rem)] font-semibold">
                            {sessionTitle}
                        </div>
                        <div
                            className={`text-[clamp(0.56rem,1.05vw,0.67rem)] ${isLight ? "text-black/55" : "text-white/55"
                                }`}
                        >
                            {participantsCount} participants
                            {remainingTime ? ` • ${remainingTime}` : ""}
                        </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-[0.35rem]">
                        <button
                            type="button"
                            onClick={() => onSetPipMode("gallery")}
                            className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${pipMode === "gallery"
                                ? `${pillActive} border-transparent`
                                : `${pillIdle} border-transparent`
                                }`}
                            title="Gallery"
                            aria-label="Show gallery"
                            aria-pressed={pipMode === "gallery"}
                        >
                            <Icon
                                name="pip"
                                theme={pipMode === "gallery" ? (isLight ? "dark" : "light") : theme}
                                className="h-[1rem] w-[1rem]"
                                alt="Picture in Picture"
                            />
                        </button>

                        {chatPanel ? (
                            <button
                                type="button"
                                onClick={() => onSetPipMode("chat")}
                                className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${pipMode === "chat"
                                    ? `${pillActive} border-transparent`
                                    : `${pillIdle} border-transparent`
                                    }`}
                                title="Chat"
                                aria-label="Show chat"
                                aria-pressed={pipMode === "chat"}
                            >
                                <Icon
                                    name="chat"
                                    theme={pipMode === "chat" ? (isLight ? "dark" : "light") : theme}
                                    className="h-[1rem] w-[1rem]"
                                />
                            </button>
                        ) : null}

                        {onOpenTasksPanel ? (
                            <button
                                type="button"
                                onClick={onOpenTasksPanel}
                                className={`flex h-9 w-9 items-center justify-center rounded-xl border border-transparent transition ${pillIdle}`}
                                title="Open Tasks panel"
                                aria-label="Open Tasks panel"
                            >
                                <img
                                    src={isLight ? "/icons/tasks-light.svg" : "/icons/tasks.svg"}
                                    alt=""
                                    className="h-[1rem] w-[1rem] object-contain"
                                    draggable={false}
                                />
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>

            <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
                <div
                    className={`h-full min-h-0 min-w-0 overflow-hidden p-[clamp(0.28rem,0.9vw,0.56rem)] ${pipMode === "gallery" ? "block" : "hidden"}`}
                    aria-hidden={pipMode !== "gallery"}
                >
                    {pipGalleryTiles.length ? (
                        <div
                            className="grid h-full w-full min-h-0 min-w-0 overflow-hidden"
                            style={{
                                gridTemplateColumns: `repeat(${resolvedGalleryColumns}, minmax(0, 1fr))`,
                                gridTemplateRows: `repeat(${resolvedGalleryRows}, minmax(0, 1fr))`,
                                gap: "clamp(0.28rem,0.8vw,0.5rem)",
                            }}
                        >
                            {pipGalleryTiles.map((t) => (
                                <div
                                    key={`pip-gallery-${t.id}`}
                                    className="min-h-0 min-w-0 overflow-hidden rounded-2xl"
                                    style={{ minHeight: 0, minWidth: 0 }}
                                >
                                    {renderTile(t)}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={`flex h-full items-center justify-center text-[0.8rem] ${isLight ? "text-black/45" : "text-white/50"}`}>
                            No video tiles yet
                        </div>
                    )}
                </div>

                {chatPanel && pipMode === "chat" ? (
                    <div
                        className="ms-pip-chat-panel h-full min-h-0 min-w-0 overflow-hidden"
                    >
                        {chatPanel}
                    </div>
                ) : null}

                {sentReaction ? (
                    <div
                        className={`pointer-events-none absolute left-1/2 top-3 z-[95] flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-2 text-[0.72rem] font-semibold shadow-lg backdrop-blur animate-pulse ${isLight
                            ? "border-emerald-200 bg-white/95 text-emerald-700"
                            : "border-emerald-400/30 bg-[#242424]/95 text-emerald-200"
                            }`}
                        role="status"
                        aria-live="polite"
                    >
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#81DB86] text-[0.65rem] text-[#143818]">✓</span>
                        <span>Sent</span>
                        <span className="text-[1rem] leading-none">{REACTION_EMOJI[sentReaction]}</span>
                    </div>
                ) : null}
            </div>

            <style>{`
                .ms-pip-chat-panel .custom-scrollbar {
                    scrollbar-width: auto !important;
                    scrollbar-color: #8f9993 #e7e3e3 !important;
                    -ms-overflow-style: auto !important;
                }
                .ms-pip-chat-panel .custom-scrollbar::-webkit-scrollbar {
                    width: 14px !important;
                    height: 14px !important;
                    display: block !important;
                }
                .ms-pip-chat-panel .custom-scrollbar::-webkit-scrollbar-track {
                    border-radius: 999px;
                    background: #e7e3e3;
                }
                .ms-pip-chat-panel .custom-scrollbar::-webkit-scrollbar-thumb {
                    min-height: 44px;
                    border: 3px solid #e7e3e3;
                    border-radius: 999px;
                    background: #8f9993;
                    background-clip: padding-box;
                }
                .ms-pip-chat-panel .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #66716b;
                    background-clip: padding-box;
                }
                .ms-pip-chat-panel .custom-scrollbar::-webkit-scrollbar-thumb:active {
                    background: #46504b;
                    background-clip: padding-box;
                }
            `}</style>

            <div
                className={`shrink-0 border-t px-[clamp(0.48rem,1.4vw,0.72rem)] py-[clamp(0.42rem,1.3vw,0.68rem)] ${footerBg}`}
            >
                <div className="flex flex-wrap items-center justify-center gap-[0.48rem]">
                    <button
                        type="button"
                        onClick={onToggleMic}
                        className={ctlBtnBase}
                        title={micOn ? "Mute microphone" : "Unmute microphone"}
                        aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
                    >
                        <Icon
                            name={micOn ? "mic-on" : "mic-off"}
                            theme={theme}
                            className="h-[1.15rem] w-[1.15rem]"
                        />
                    </button>

                    <button
                        type="button"
                        onClick={onToggleCam}
                        className={ctlBtnBase}
                        title={camOn ? "Turn camera off" : "Turn camera on"}
                        aria-label={camOn ? "Turn camera off" : "Turn camera on"}
                    >
                        <Icon
                            name={camOn ? "camera-on" : "camera-off"}
                            theme={theme}
                            className="h-[1.15rem] w-[1.15rem]"
                        />
                    </button>

                    <button
                        type="button"
                        onClick={onToggleScreenShare}
                        className={`${ctlBtnBase} ${screenShareOn
                            ? isLight
                                ? "ring-2 ring-black/20"
                                : "ring-2 ring-white/20"
                            : ""
                            }`}
                        title={screenShareOn ? "Stop screen share" : "Start screen share"}
                        aria-label={screenShareOn ? "Stop screen share" : "Start screen share"}
                    >
                        <Icon
                            name="screen-share"
                            theme={theme}
                            className="h-[1.15rem] w-[1.15rem]"
                        />
                    </button>

                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setShowReactionsMenu((v) => !v)}
                            className={ctlBtnBase}
                            title="Reactions"
                            aria-label="Reactions"
                        >
                            <Icon
                                name="reaction"
                                theme={theme}
                                className="h-[1.15rem] w-[1.15rem]"
                            />
                        </button>

                        {showReactionsMenu ? (
                            <div
                                className={`absolute bottom-[calc(100%+0.55rem)] right-0 z-[80] w-[min(18rem,80vw)] rounded-2xl border p-2 ${reactionMenuSurface}`}
                            >
                                <div className="grid grid-cols-4 gap-2">
                                    {reactionTypes.map((reactionType) => (
                                        <button
                                            key={reactionType}
                                            type="button"
                                            onClick={() => {
                                                const sent = onSendReaction(reactionType);
                                                if (!sent) return;
                                                showReactionSentFeedback(reactionType);
                                            }}
                                            className={`flex h-[2.85rem] items-center justify-center rounded-xl border text-[1.1rem] transition ${isLight
                                                ? "border-[#D8D0D0] bg-[#E6E6E6] hover:bg-[#DCDCDC]"
                                                : "border-[#252525] bg-[#242424] hover:bg-[#303030]"
                                                }`}
                                            title={reactionType}
                                            aria-label={reactionType}
                                        >
                                            {REACTION_EMOJI[reactionType]}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
