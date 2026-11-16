import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarVisualizer } from "@livekit/components-react";
import { AudioLines, Maximize2, Minimize2 } from "lucide-react";
import type { LocalAudioTrack, RemoteAudioTrack } from "livekit-client";
import type { RoomPiPView } from "./useRoomPiPView";
import {
    Icon,
    reactionEmoji as REACTION_EMOJI,
    roomBottomControlPalette,
    roomMediaControlPalette,
    type ReactionType,
    type RoomTheme,
} from "./LiveKitUI";

class PiPChatBoundary extends React.Component<
    { children: React.ReactNode },
    { failed: boolean; retryCount: number }
> {
    state = { failed: false, retryCount: 0 };
    private retryTimer: ReturnType<typeof setTimeout> | null = null;

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: unknown) {
        console.error("[pip-chat] render failed", error);

        // The Document PiP window can need one extra frame before portals and
        // measurements are ready. Retry a fresh ChatPanel mount automatically
        // instead of leaving the PiP chat permanently stuck on the fallback.
        if (this.state.retryCount >= 2 || this.retryTimer) return;

        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.setState((state) => ({
                failed: false,
                retryCount: state.retryCount + 1,
            }));
        }, 250);
    }

    componentWillUnmount() {
        if (this.retryTimer) clearTimeout(this.retryTimer);
    }

    render() {
        if (this.state.failed) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-xs text-black/55">
                    <span>Chat is temporarily unavailable. Room controls remain active.</span>
                    {this.state.retryCount >= 2 ? (
                        <button
                            type="button"
                            className="rounded-xl bg-[#1B1B1B] px-3 py-2 font-semibold text-white transition hover:bg-[#303030]"
                            onClick={() => this.setState({ failed: false, retryCount: 0 })}
                        >
                            Try again
                        </button>
                    ) : null}
                </div>
            );
        }

        return this.props.children;
    }
}

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
    tasksPanel,
    onToggleCompact,
    activeSpeaker,
    localAudioTrack,
}: {
    isLight: boolean;
    theme: RoomTheme;
    sessionTitle: string;
    participantsCount: number;
    remainingTime: string;
    pipMode: RoomPiPView;
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
    tasksPanel?: React.ReactNode;
    onToggleCompact?: () => void;
    activeSpeaker?: { name: string; audioTrack?: LocalAudioTrack | RemoteAudioTrack };
    localAudioTrack?: LocalAudioTrack | RemoteAudioTrack;
}) {
    const compact = pipMode === "compact";
    const tasksExpanded = pipMode === "tasks";
    const showSpeech = Boolean(activeSpeaker) || micOn;
    const speechTrack = activeSpeaker ? activeSpeaker.audioTrack : localAudioTrack;
    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    const compactReactionsOpen = compact && showReactionsMenu;
    const reactionButtonRef = useRef<HTMLButtonElement | null>(null);
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

    const compactPalette = roomBottomControlPalette[theme];
    const ctlBtnShape = compact
        ? "relative flex h-10 w-[35px] shrink-0 items-center justify-center rounded-2xl transition min-[360px]:w-10"
        : "relative flex h-[2.9rem] w-[2.9rem] shrink-0 items-center justify-center rounded-full border transition";
    const ctlBtnBase = `${ctlBtnShape} ${compact
        ? compactPalette.idle
        : isLight ? "border-[#D8D0D0] bg-[#E6E6E6] text-black/75 hover:bg-[#DCDCDC]"
            : "border-[#252525] bg-[#242424] text-white/90 hover:bg-[#303030]"}`;

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
    const closeCompactReactions = () => {
        setShowReactionsMenu(false);
        reactionButtonRef.current?.focus();
    };
    const reactionButtons = showReactionsMenu ? reactionTypes.map((reactionType) => (
        <button
            key={reactionType}
            type="button"
            onClick={() => {
                if (!onSendReaction(reactionType)) return;
                showReactionSentFeedback(reactionType);
                if (compact) closeCompactReactions();
            }}
            className={compact
                ? `flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-base transition ${compactPalette.idle}`
                : `flex h-[2.85rem] shrink-0 items-center justify-center rounded-xl border text-[1.1rem] transition ${isLight
                    ? "border-[#D8D0D0] bg-[#E6E6E6] hover:bg-[#DCDCDC]"
                    : "border-[#252525] bg-[#242424] hover:bg-[#303030]"}`}
            title={reactionType}
            aria-label={reactionType}
        >
            {REACTION_EMOJI[reactionType]}
        </button>
    )) : null;
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
                hidden={compact}
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
                        {onToggleCompact ? (
                            <button
                                type="button"
                                onClick={() => {
                                    setShowReactionsMenu(false);
                                    onToggleCompact();
                                }}
                                className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${pillIdle}`}
                                title="Compact mode"
                                aria-label="Compact mode"
                            >
                                <Minimize2 size={16} aria-hidden="true" />
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => onSetPipMode("gallery")}
                            className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${!tasksExpanded && pipMode === "gallery"
                                ? `${pillActive} border-transparent`
                                : `${pillIdle} border-transparent`
                                }`}
                            title="Gallery"
                            aria-label="Show gallery"
                            aria-pressed={!tasksExpanded && pipMode === "gallery"}
                        >
                            <Icon
                                name="pip"
                                theme={!tasksExpanded && pipMode === "gallery" ? (isLight ? "dark" : "light") : theme}
                                className="h-[1rem] w-[1rem]"
                                alt="Picture in Picture"
                            />
                        </button>

                        {chatPanel ? (
                            <button
                                type="button"
                                onClick={() => onSetPipMode("chat")}
                                className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${!tasksExpanded && pipMode === "chat"
                                    ? `${pillActive} border-transparent`
                                    : `${pillIdle} border-transparent`
                                    }`}
                                title="Chat"
                                aria-label="Show chat"
                                aria-pressed={!tasksExpanded && pipMode === "chat"}
                            >
                                <Icon
                                    name="chat"
                                    theme={!tasksExpanded && pipMode === "chat" ? (isLight ? "dark" : "light") : theme}
                                    className="h-[1rem] w-[1rem]"
                                />
                            </button>
                        ) : null}

                        {onOpenTasksPanel ? (
                            <button
                                type="button"
                                onClick={onOpenTasksPanel}
                                className={`flex h-9 w-9 items-center justify-center rounded-xl border border-transparent transition ${tasksExpanded ? pillActive : pillIdle}`}
                                title={tasksExpanded ? "Collapse Tasks panel" : "Expand Tasks panel"}
                                aria-label={tasksExpanded ? "Collapse Tasks panel" : "Expand Tasks panel"}
                                aria-expanded={tasksExpanded}
                            >
                                <img
                                    src={isLight !== tasksExpanded ? "/icons/tasks-light.svg" : "/icons/tasks.svg"}
                                    alt=""
                                    className="h-[1rem] w-[1rem] object-contain"
                                    draggable={false}
                                />
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>

            <div hidden={compact} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                <div hidden={tasksExpanded} className="relative h-full min-h-0 min-w-0 overflow-hidden">
                    {pipMode === "gallery" || pipMode === "tasks" ? (
                        <div className="h-full min-h-0 min-w-0 overflow-hidden p-[clamp(0.28rem,0.9vw,0.56rem)]">
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
                    ) : null}

                    {chatPanel && pipMode === "chat" ? (
                        <div
                            className="ms-pip-chat-panel h-full min-h-0 min-w-0 overflow-hidden"
                        >
                            <PiPChatBoundary>{chatPanel}</PiPChatBoundary>
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
                {tasksPanel ? (
                    <aside
                        aria-label="Tasks"
                        hidden={!tasksExpanded}
                        data-panel-theme={theme}
                        className={`ms-room-side-panel ms-pip-tasks-panel h-full min-h-0 overflow-hidden ${headerBg}`}
                    >
                        {tasksPanel}
                    </aside>
                ) : null}
            </div>

            <style>{`
                .ms-pip-voice-line .lk-audio-bar[data-lk-bar-index="0"] { transform: scaleY(0.35); }
                .ms-pip-voice-line .lk-audio-bar[data-lk-bar-index="1"] { transform: scaleY(0.76); }
                .ms-pip-voice-line .lk-audio-bar[data-lk-bar-index="2"] { transform: scaleY(0.43); }
                .ms-pip-voice-line .lk-audio-bar[data-lk-bar-index="3"],
                .ms-pip-voice-line .lk-audio-bar[data-lk-bar-index="5"] { transform: scaleY(0.6); }
                .ms-pip-voice-line .lk-audio-bar[data-lk-bar-index="6"] { transform: scaleY(0.51); }

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
                className={compact
                    ? `flex min-h-0 flex-1 items-center px-2.5 ${compactPalette.surface}`
                    : `shrink-0 border-t px-[clamp(0.48rem,1.4vw,0.72rem)] py-[clamp(0.42rem,1.3vw,0.68rem)] ${footerBg}`}
            >
                <div
                    className={compact ? "flex w-full min-w-0 items-center gap-[5px] min-[360px]:gap-2" : "flex flex-wrap items-center justify-center gap-[0.48rem]"}
                    onKeyDown={(event) => {
                        if (compactReactionsOpen && event.key === "Escape") {
                            event.stopPropagation();
                            closeCompactReactions();
                        }
                    }}
                >
                    {!compactReactionsOpen ? (
                        <>
                            <button
                                type="button"
                                onClick={onToggleMic}
                                className={compact && !micOn ? `${ctlBtnShape} ${roomMediaControlPalette.off}` : ctlBtnBase}
                                title={micOn ? "Mute microphone" : "Unmute microphone"}
                                aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
                            >
                                <Icon
                                    name={micOn ? "mic-on" : "mic-off"}
                                    theme={compact && !micOn ? "dark" : theme}
                                    className="h-[1.15rem] w-[1.15rem]"
                                />
                            </button>

                            <button
                                type="button"
                                onClick={onToggleCam}
                                className={compact && !camOn ? `${ctlBtnShape} ${roomMediaControlPalette.off}` : ctlBtnBase}
                                title={camOn ? "Turn camera off" : "Turn camera on"}
                                aria-label={camOn ? "Turn camera off" : "Turn camera on"}
                            >
                                <Icon
                                    name={camOn ? "camera-on" : "camera-off"}
                                    theme={compact && !camOn ? "dark" : theme}
                                    className="h-[1.15rem] w-[1.15rem]"
                                />
                            </button>

                            <button
                                type="button"
                                onClick={onToggleScreenShare}
                                className={compact && screenShareOn
                                    ? `${ctlBtnShape} ${roomMediaControlPalette.sharing}`
                                    : `${ctlBtnBase} ${screenShareOn ? (isLight ? "ring-2 ring-black/20" : "ring-2 ring-white/20") : ""}`}
                                title={screenShareOn ? "Stop screen share" : "Start screen share"}
                                aria-label={screenShareOn ? "Stop screen share" : "Start screen share"}
                            >
                                <Icon
                                    name="screen-share"
                                    theme={compact && screenShareOn ? "dark" : theme}
                                    className="h-[1.15rem] w-[1.15rem]"
                                />
                            </button>
                        </>
                    ) : null}

                    <div className="relative shrink-0">
                        <button
                            ref={reactionButtonRef}
                            type="button"
                            onClick={() => setShowReactionsMenu((visible) => !visible)}
                            className={ctlBtnBase}
                            title="Reactions"
                            aria-label="Reactions"
                            aria-expanded={showReactionsMenu}
                        >
                            {compact && sentReaction && !showReactionsMenu ? (
                                <span role="status" aria-label="Reaction sent">{REACTION_EMOJI[sentReaction]}</span>
                            ) : (
                                <Icon name="reaction" theme={theme} className="h-[1.15rem] w-[1.15rem]" />
                            )}
                        </button>
                        {!compact && showReactionsMenu ? (
                            <div className={`absolute bottom-[calc(100%+0.55rem)] right-0 z-[80] w-[min(18rem,80vw)] rounded-2xl border p-2 ${reactionMenuSurface}`}>
                                <div className="grid grid-cols-4 gap-2">{reactionButtons}</div>
                            </div>
                        ) : null}
                    </div>

                    {compact ? (
                        <>
                            {compactReactionsOpen ? (
                                <div
                                    role="group"
                                    aria-label="Choose a reaction"
                                    className={`flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:thin] ${isLight
                                        ? "[scrollbar-color:#a5a5a5_transparent]"
                                        : "[scrollbar-color:#666_transparent]"}`}
                                >
                                    {reactionButtons}
                                </div>
                            ) : (
                                <div className="flex min-w-0 flex-1 items-center gap-2 pl-1" aria-live="polite" aria-atomic="true">
                                    {showSpeech ? (
                                        <>
                                            <div aria-hidden="true" className={`flex h-5 w-6 shrink-0 items-center justify-center min-[360px]:w-8 ${activeSpeaker
                                                ? "text-[#5286F6]" : isLight ? "text-black/55" : "text-white/60"
                                            }`}>
                                                {speechTrack ? (
                                                    <BarVisualizer
                                                        track={speechTrack}
                                                        barCount={7}
                                                        options={{ minHeight: activeSpeaker ? 38 : 20, maxHeight: 100 }}
                                                        className="ms-pip-voice-line flex h-[18px] items-center justify-center gap-[1.5px] min-[360px]:gap-0.5"
                                                    >
                                                        <span className="lk-audio-bar block w-0.5 rounded-full bg-current motion-safe:transition-[height] motion-safe:duration-[180ms] motion-safe:ease-out min-[360px]:w-[2.5px]" />
                                                    </BarVisualizer>
                                                ) : <AudioLines size={13} />}
                                            </div>
                                            <span className="truncate text-xs font-medium" title={activeSpeaker?.name}>{activeSpeaker?.name || "Mic on"}</span>
                                        </>
                                    ) : null}
                                </div>
                            )}
                            {remainingTime ? (
                                <span role="timer" aria-label="Time left in current block" className="flex shrink-0 items-center gap-1 whitespace-nowrap px-1 text-xs font-semibold tabular-nums">
                                    <Icon name="timer" theme={theme} className="hidden h-4 w-4 opacity-80 min-[360px]:block" alt="" />
                                    {remainingTime}
                                </span>
                            ) : null}
                            <button
                                type="button"
                                onClick={() => {
                                    setShowReactionsMenu(false);
                                    onToggleCompact?.();
                                }}
                                className={ctlBtnBase}
                                title="Exit compact mode"
                                aria-label="Exit compact mode"
                            >
                                <Maximize2 aria-hidden="true" size={16} />
                            </button>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
