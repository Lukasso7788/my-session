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
}) {
    const [showReactionsMenu, setShowReactionsMenu] = useState(false);

    const shellBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
    const headerBg = isLight
        ? "border-black/10 bg-white/85"
        : "border-white/10 bg-[#020617]/80";
    const footerBg = isLight
        ? "border-black/10 bg-white/88"
        : "border-white/10 bg-[#020617]/88";

    const pillActive = isLight
        ? "bg-black text-white"
        : "bg-white text-black";

    const pillIdle = isLight
        ? "bg-black/5 text-black/70 hover:bg-black/10"
        : "bg-white/10 text-white/75 hover:bg-white/15";

    const ctlBtnBase = useMemo(
        () =>
            `relative flex h-[3rem] w-[3rem] items-center justify-center rounded-full border transition ${isLight
                ? "border-black/10 bg-white text-black hover:bg-black/5"
                : "border-white/10 bg-white/5 text-white hover:bg-white/10"
            }`,
        [isLight]
    );

    const reactionMenuSurface = isLight
        ? "border-black/10 bg-white text-black shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
        : "border-white/10 bg-[#020617] text-white shadow-[0_16px_40px_rgba(0,0,0,0.45)]";

    const reactionTypes = Object.keys(REACTION_EMOJI) as ReactionType[];

    return (
        <div className={`h-full w-full min-h-0 min-w-0 flex flex-col overflow-hidden ${shellBg}`}>
            <div
                className={`shrink-0 border-b px-[clamp(0.55rem,1.8vw,0.85rem)] py-[clamp(0.45rem,1.5vw,0.7rem)] ${headerBg}`}
            >
                <div className="flex items-center justify-between gap-[clamp(0.4rem,1vw,0.7rem)]">
                    <div className="min-w-0">
                        <div className="truncate text-[clamp(0.7rem,1.4vw,0.82rem)] font-semibold">
                            {sessionTitle}
                        </div>
                        <div
                            className={`text-[clamp(0.58rem,1.15vw,0.68rem)] ${isLight ? "text-black/50" : "text-white/50"
                                }`}
                        >
                            {participantsCount} participants
                            {remainingTime ? ` • ${remainingTime}` : ""}
                        </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-[0.4rem]">
                        <button
                            type="button"
                            onClick={() => onSetPipMode("focus")}
                            className={`rounded-xl px-[0.7rem] py-[0.45rem] text-[0.72rem] font-medium transition ${pipMode === "focus" ? pillActive : pillIdle
                                }`}
                        >
                            Focus
                        </button>

                        <button
                            type="button"
                            onClick={() => onSetPipMode("gallery")}
                            className={`rounded-xl px-[0.7rem] py-[0.45rem] text-[0.72rem] font-medium transition ${pipMode === "gallery" ? pillActive : pillIdle
                                }`}
                        >
                            Gallery
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                {pipMode === "focus" ? (
                    <div className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr),clamp(5.4rem,18vw,8rem)] gap-[clamp(0.35rem,1vw,0.6rem)] overflow-hidden p-[clamp(0.35rem,1vw,0.6rem)]">
                        <div className="min-h-0 min-w-0 overflow-hidden">
                            {pipFeaturedTile ? renderTile(pipFeaturedTile) : null}
                        </div>

                        <div className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pr-[clamp(0.2rem,0.7vw,0.35rem)]">
                            <div className="flex min-h-0 min-w-0 flex-col gap-[clamp(0.35rem,0.9vw,0.55rem)]">
                                {pipStripTiles.map((t) => (
                                    <div
                                        key={`pip-${t.id}`}
                                        className="min-h-0 min-w-0 overflow-hidden"
                                    >
                                        {renderTile(t)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-full min-h-0 min-w-0 overflow-hidden p-[clamp(0.35rem,1vw,0.6rem)]">
                        <div
                            className="grid h-full w-full min-h-0 min-w-0 gap-[clamp(0.35rem,1vw,0.55rem)] overflow-auto"
                            style={{
                                gridTemplateColumns: `repeat(${pipGalleryColumns}, minmax(0, 1fr))`,
                            }}
                        >
                            {pipGalleryTiles.map((t) => (
                                <div
                                    key={`pip-gallery-${t.id}`}
                                    className="min-h-0 min-w-0 overflow-hidden"
                                >
                                    {renderTile(t)}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div
                className={`shrink-0 border-t px-[clamp(0.5rem,1.5vw,0.75rem)] py-[clamp(0.45rem,1.4vw,0.7rem)] ${footerBg}`}
            >
                <div className="flex flex-wrap items-center justify-center gap-[0.55rem]">
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
                            className="h-[1.2rem] w-[1.2rem]"
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
                            className="h-[1.2rem] w-[1.2rem]"
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
                            className="h-[1.2rem] w-[1.2rem]"
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
                                className="h-[1.2rem] w-[1.2rem]"
                            />
                        </button>

                        {showReactionsMenu ? (
                            <div
                                className={`absolute bottom-[calc(100%+0.6rem)] right-0 z-[80] w-[min(18rem,80vw)] rounded-2xl border p-2 ${reactionMenuSurface}`}
                            >
                                <div className="grid grid-cols-4 gap-2">
                                    {reactionTypes.map((reactionType) => (
                                        <button
                                            key={reactionType}
                                            type="button"
                                            onClick={() => {
                                                onSendReaction(reactionType);
                                            }}
                                            className={`flex h-[3rem] items-center justify-center rounded-xl border text-[1.15rem] transition ${isLight
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