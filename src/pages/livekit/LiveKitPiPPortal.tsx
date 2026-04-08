import React from "react";
import {
    reactionEmoji as REACTION_EMOJI,
    type ReactionType,
} from "./LiveKitUI";

export default function LiveKitPiPPortal({
    isLight,
    sessionTitle,
    participantsCount,
    remainingTime,
    pipMode,
    pipFeaturedTile,
    pipStripTiles,
    pipGalleryTiles,
    pipGalleryColumns,
    renderTile,
    onSetPipMode,
    onToggleScreenShare,
    onSendReaction,
}: {
    isLight: boolean;
    sessionTitle: string;
    participantsCount: number;
    remainingTime: string;
    pipMode: "focus" | "gallery";
    pipFeaturedTile: any | null;
    pipStripTiles: any[];
    pipGalleryTiles: any[];
    pipGalleryColumns: number;
    renderTile: (tile: any) => React.ReactNode;
    onSetPipMode: (mode: "focus" | "gallery") => void;
    onToggleScreenShare: () => void;
    onSendReaction: (type: ReactionType) => void;
}) {
    return (
        <div
            className={`h-full w-full min-h-0 min-w-0 flex flex-col overflow-hidden ${isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white"
                }`}
        >
            <div
                className={`shrink-0 px-[clamp(0.55rem,1.8vw,0.85rem)] py-[clamp(0.45rem,1.5vw,0.7rem)] flex items-center justify-between gap-[clamp(0.4rem,1vw,0.7rem)] border-b ${isLight ? "border-black/10 bg-white/85" : "border-white/10 bg-[#020617]/80"
                    }`}
            >
                <div className="min-w-0">
                    <div className="text-[clamp(0.7rem,1.4vw,0.82rem)] font-semibold truncate">
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
                        className={`rounded-xl px-[0.7rem] py-[0.45rem] text-[0.72rem] font-medium transition ${pipMode === "focus"
                                ? isLight
                                    ? "bg-black text-white"
                                    : "bg-white text-black"
                                : isLight
                                    ? "bg-black/5 text-black/70 hover:bg-black/10"
                                    : "bg-white/10 text-white/75 hover:bg-white/15"
                            }`}
                    >
                        Focus
                    </button>

                    <button
                        type="button"
                        onClick={() => onSetPipMode("gallery")}
                        className={`rounded-xl px-[0.7rem] py-[0.45rem] text-[0.72rem] font-medium transition ${pipMode === "gallery"
                                ? isLight
                                    ? "bg-black text-white"
                                    : "bg-white text-black"
                                : isLight
                                    ? "bg-black/5 text-black/70 hover:bg-black/10"
                                    : "bg-white/10 text-white/75 hover:bg-white/15"
                            }`}
                    >
                        Gallery
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                {pipMode === "focus" ? (
                    <div className="h-full min-h-0 min-w-0 grid grid-cols-[minmax(0,1fr),clamp(5.2rem,18vw,8rem)] gap-[clamp(0.35rem,1vw,0.6rem)] p-[clamp(0.35rem,1vw,0.6rem)] overflow-hidden">
                        <div className="min-w-0 min-h-0 flex items-center justify-center overflow-hidden">
                            <div className="w-full h-full min-w-0 min-h-0 overflow-hidden">
                                {pipFeaturedTile ? renderTile(pipFeaturedTile) : null}
                            </div>
                        </div>

                        <div className="min-w-0 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-[clamp(0.35rem,0.9vw,0.55rem)] pr-[clamp(0.2rem,0.7vw,0.35rem)]">
                            {pipStripTiles.map((t) => (
                                <div
                                    key={`pip-${t.id}`}
                                    className="min-w-0 min-h-0 overflow-hidden"
                                >
                                    {renderTile(t)}
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="h-full min-h-0 min-w-0 p-[clamp(0.35rem,1vw,0.6rem)] overflow-hidden">
                        <div
                            className="h-full w-full min-h-0 min-w-0 grid gap-[clamp(0.35rem,1vw,0.55rem)] overflow-hidden"
                            style={{
                                gridTemplateColumns: `repeat(${pipGalleryColumns}, minmax(0, 1fr))`,
                            }}
                        >
                            {pipGalleryTiles.map((t) => (
                                <div
                                    key={`pip-gallery-${t.id}`}
                                    className="min-w-0 min-h-0 overflow-hidden"
                                >
                                    {renderTile(t)}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div
                className={`shrink-0 border-t px-[clamp(0.5rem,1.5vw,0.75rem)] py-[clamp(0.45rem,1.4vw,0.7rem)] ${isLight ? "border-black/10 bg-white/88" : "border-white/10 bg-[#020617]/88"
                    }`}
            >
                <div className="flex flex-wrap items-center justify-between gap-[0.45rem]">
                    <div className="flex flex-wrap items-center gap-[0.35rem] min-w-0">
                        <button
                            type="button"
                            onClick={onToggleScreenShare}
                            className={`rounded-xl px-[0.72rem] py-[0.48rem] text-[0.72rem] font-medium transition ${isLight
                                    ? "bg-black/5 text-black/80 hover:bg-black/10"
                                    : "bg-white/10 text-white/85 hover:bg-white/15"
                                }`}
                        >
                            Screen share
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-[0.35rem]">
                        {(Object.keys(REACTION_EMOJI) as ReactionType[]).map((reactionType) => (
                            <button
                                key={reactionType}
                                type="button"
                                onClick={() => onSendReaction(reactionType)}
                                className={`h-[2rem] min-w-[2rem] rounded-xl border px-[0.45rem] text-[0.92rem] leading-none transition ${isLight
                                        ? "border-black/10 bg-white text-black/85 hover:bg-black/5"
                                        : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                                    }`}
                                title={reactionType}
                                aria-label={reactionType}
                            >
                                {REACTION_EMOJI[reactionType]}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}