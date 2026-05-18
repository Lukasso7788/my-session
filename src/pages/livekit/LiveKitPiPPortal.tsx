import React, { useMemo, useState } from "react";
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
    pipFeaturedTile,
    pipStripTiles,
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
    onOpenIntentionsPanel,
}: {
    isLight: boolean;
    theme: RoomTheme;
    sessionTitle: string;
    participantsCount: number;
    remainingTime: string;
    pipMode: "focus" | "gallery";
    pipFeaturedTile: any | null;
    pipStripTiles: any[];
    pipGalleryTiles: any[];
    pipGalleryColumns: number;
    renderTile: (tile: any) => React.ReactNode;
    micOn: boolean;
    camOn: boolean;
    screenShareOn: boolean;
    onToggleMic: () => void;
    onToggleCam: () => void;
    onToggleScreenShare: () => void;
    onSendReaction: (type: ReactionType) => void;
    onSetPipMode: (mode: "focus" | "gallery") => void;
    onOpenIntentionsPanel?: () => void;
}) {
    const [showReactionsMenu, setShowReactionsMenu] = useState(false);

    const shellBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
    const headerBg = isLight
        ? "border-black/10 bg-white/85"
        : "border-white/10 bg-[#020617]/88";
    const footerBg = isLight
        ? "border-black/10 bg-white/88"
        : "border-white/10 bg-[#020617]/90";

    const pillActive = isLight ? "bg-black text-white" : "bg-white text-black";
    const pillIdle = isLight
        ? "bg-black/5 text-black/70 hover:bg-black/10"
        : "bg-white/10 text-white/75 hover:bg-white/15";

    const ctlBtnBase = useMemo(
        () =>
            `relative flex h-[2.9rem] w-[2.9rem] items-center justify-center rounded-full border transition ${isLight
                ? "border-black/10 bg-white text-black hover:bg-black/5"
                : "border-white/10 bg-white/5 text-white hover:bg-white/10"
            }`,
        [isLight]
    );

    const reactionMenuSurface = isLight
        ? "border-black/10 bg-white text-black shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
        : "border-white/10 bg-[#020617] text-white shadow-[0_16px_40px_rgba(0,0,0,0.45)]";

    const reactionTypes = Object.keys(REACTION_EMOJI) as ReactionType[];


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
                            className={`text-[clamp(0.56rem,1.05vw,0.67rem)] ${isLight ? "text-black/50" : "text-white/50"
                                }`}
                        >
                            {participantsCount} participants
                            {remainingTime ? ` • ${remainingTime}` : ""}
                        </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-[0.35rem]">
                        <div
                            className={`rounded-xl px-[0.68rem] py-[0.42rem] text-[0.7rem] font-medium ${pillActive}`}
                            title="Picture-in-Picture now uses Gallery mode by default"
                        >
                            Gallery
                        </div>

                        {onOpenIntentionsPanel ? (
                            <button
                                type="button"
                                onClick={onOpenIntentionsPanel}
                                className={`rounded-xl px-[0.68rem] py-[0.42rem] text-[0.7rem] font-medium transition ${pillIdle}`}
                                title="Switch back to Intentions"
                                aria-label="Switch back to Intentions"
                            >
                                Intentions
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 min-w-0 overflow-hidden p-[clamp(0.28rem,0.9vw,0.56rem)]">
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
                    <div className={`flex h-full items-center justify-center text-[0.8rem] ${isLight ? "text-black/45" : "text-white/45"}`}>
                        No video tiles yet
                    </div>
                )}
            </div>

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
                                                onSendReaction(reactionType);
                                            }}
                                            className={`flex h-[2.85rem] items-center justify-center rounded-xl border text-[1.1rem] transition ${isLight
                                                ? "border-black/10 bg-black/5 hover:bg-black/10"
                                                : "border-white/10 bg-white/5 hover:bg-white/10"
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