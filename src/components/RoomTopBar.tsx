import React from "react";
import { SessionStageBar } from "./SessionStageBar";
import { Icon, ParticipantsSmartIcon, type RoomTheme } from "./VideoControls";

type HostProfile = {
    id: string;
    full_name: string;
    avatar_url?: string | null;
    bio?: string | null;
};

type Stage = {
    name: string;
    duration: number;
    color: string;
    type: string;
    durationSeconds?: number;
};

type RoomTopBarProps = {
    theme: RoomTheme;

    sessionTitle: string;
    participantsCount: number;
    maxParticipants: number;

    isSilentRoom: boolean;
    stages: Stage[];
    stagebarStartTime: string;
    stagebarCycleSeconds?: number;
    remainingTime: string;

    hostProfile?: HostProfile | null;

    onToggleTheme: () => void;
    onOpenHostProfile?: () => void;

    onHoverStage?: (s: Stage | null) => void;

    canEditTimeline?: boolean;
    onEditTimeline?: () => void;
};

export default function RoomTopBar(props: RoomTopBarProps) {
    const {
        theme,
        sessionTitle,
        participantsCount,
        maxParticipants,
        isSilentRoom,
        stages,
        stagebarStartTime,
        stagebarCycleSeconds,
        remainingTime,
        hostProfile,
        onToggleTheme,
        onOpenHostProfile,
        onHoverStage,
        canEditTimeline = false,
        onEditTimeline,
    } = props;

    const isLight = theme === "light";

    const topBarBg = isLight
        ? "bg-[#F3F3F3]/95 border border-[#CFCFCF]"
        : "bg-[#1B1B1B] border border-[#252525]";

    const chipBg = isLight
        ? "bg-[#E1E3E6] border border-[#CFCFCF]"
        : "bg-[#1B1B1B] border border-[#252525]";

    const strongText = isLight ? "text-black/85" : "text-[#F1F1F1]/90";

    const mutedText = isLight ? "text-black/65" : "text-white/80";

    const switchTrack =
        "w-[84px] max-[480px]:w-[78px] h-[32px] rounded-full border relative transition flex items-center px-[3px]";
    const switchTrackCls = isLight
        ? "bg-[#E1E3E6] border-[#CFCFCF] hover:bg-[#E0E0E0]"
        : "bg-white/5 border-[#2B2B2B] hover:bg-[#F2F3F5]/10";

    const switchThumb =
        "absolute top-[2px] w-[26px] h-[26px] rounded-full shadow-md transition-transform bg-white flex items-center justify-center";

    const thumbTranslate = isLight ? "translateX(0px)" : "translateX(52px)";

    const showTimer = !isSilentRoom && stages.length > 0 && !!stagebarStartTime;
    const showStageBar = !isSilentRoom && stages.length > 0 && !!stagebarStartTime;
    const showEditTimeline =
        showStageBar && !!canEditTimeline && typeof onEditTimeline === "function";

    return (
        <div className={`flex w-full rounded-2xl overflow-visible ${topBarBg}`}>
            <div className="flex-1 px-4 sm:px-6 py-3 sm:py-4 overflow-visible">
                <div className="flex flex-col gap-2 max-[480px]:gap-2 overflow-visible">
                    {/* row 1 */}
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                                <p
                                    className={`min-w-0 font-inter font-semibold text-[16px] sm:text-[18px] truncate ${strongText}`}
                                >
                                    {sessionTitle || "Session"}
                                </p>

                                <span
                                    className={[
                                        "shrink-0 px-2 py-[3px] rounded-lg border text-[12px] font-inter",
                                        chipBg,
                                        mutedText,
                                    ].join(" ")}
                                    title="Participants now / limit"
                                >
                                    {participantsCount}/{maxParticipants}
                                </span>
                            </div>
                        </div>

                        {/* desktop */}
                        <div className="hidden min-[481px]:flex items-center gap-2 shrink-0">
                            {showTimer && (
                                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${chipBg}`}>
                                    <Icon
                                        name="timer"
                                        theme={theme}
                                        className="w-4 h-4 opacity-80"
                                        alt="Timer"
                                    />
                                    <span className={`font-inter text-[13px] ${mutedText}`}>
                                        {remainingTime || "--:--"}
                                    </span>
                                </div>
                            )}

                            <button
                                onClick={onToggleTheme}
                                className={`${switchTrack} ${switchTrackCls}`}
                                title="Toggle theme"
                                aria-label="Toggle theme"
                                type="button"
                            >
                                <div className={switchThumb} style={{ transform: thumbTranslate }}>
                                    <Icon
                                        name={isLight ? "theme-sun" : "theme-moon"}
                                        theme={theme}
                                        className="w-4 h-4 text-black/80"
                                    />
                                </div>
                            </button>

                            {!!hostProfile && (
                                <button
                                    onClick={onOpenHostProfile}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition text-[13px] ${isLight
                                        ? "border-[#CFCFCF] bg-[#E1E3E6] hover:bg-[#E0E0E0] text-black/75"
                                        : "border-[#2B2B2B] bg-[#1B1B1B]/60 hover:bg-[#242424] text-[#F1F1F1]/85"
                                        }`}
                                    title="Host profile"
                                    type="button"
                                >
                                    <ParticipantsSmartIcon theme={theme} className="w-4 h-4 opacity-90" />
                                    <span className="font-inter">
                                        <span className="font-light">Host:</span>{" "}
                                        <span className="font-bold">
                                            {String(hostProfile.full_name || "Host")}
                                        </span>
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* row 2 mobile */}
                    <div className="min-[481px]:hidden flex items-center justify-start gap-2">
                        {showTimer && (
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${chipBg}`}>
                                <Icon
                                    name="timer"
                                    theme={theme}
                                    className="w-4 h-4 opacity-80"
                                    alt="Timer"
                                />
                                <span className={`font-inter text-[13px] ${mutedText}`}>
                                    {remainingTime || "--:--"}
                                </span>
                            </div>
                        )}

                        <button
                            onClick={onToggleTheme}
                            className={`${switchTrack} ${switchTrackCls}`}
                            title="Toggle theme"
                            aria-label="Toggle theme"
                            type="button"
                        >
                            <div className={switchThumb} style={{ transform: thumbTranslate }}>
                                <Icon
                                    name={isLight ? "theme-sun" : "theme-moon"}
                                    theme={theme}
                                    className="w-4 h-4 text-black/80"
                                />
                            </div>
                        </button>

                        {!!hostProfile && (
                            <button
                                onClick={onOpenHostProfile}
                                className={`w-10 h-10 rounded-2xl flex items-center justify-center border transition ${isLight
                                    ? "border-[#CFCFCF] bg-[#E1E3E6] hover:bg-[#E0E0E0] text-black/70"
                                    : "border-[#2B2B2B] bg-[#1B1B1B]/60 hover:bg-[#242424] text-white/85"
                                    }`}
                                title={`Host: ${String(hostProfile.full_name || "Host")}`}
                                aria-label="Host profile"
                                type="button"
                            >
                                <ParticipantsSmartIcon theme={theme} className="w-5 h-5 opacity-90" />
                            </button>
                        )}
                    </div>

                    {/* row 3 stage bar */}
                    {showStageBar && (
                        <div className="mt-1 max-[480px]:mt-1 w-full overflow-visible pt-1">
                            <div className="group relative">
                                {showEditTimeline && (
                                    <button
                                        type="button"
                                        onClick={onEditTimeline}
                                        className={[
                                            "absolute right-0 -top-10 z-20 rounded-xl px-3 py-1.5 text-[12px] font-semibold border shadow-lg transition",
                                            "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
                                            isLight
                                                ? "bg-[#F2F3F5] border-[#CFCFCF] text-black/75 hover:bg-[#E1E3E6]"
                                                : "bg-[#1B1B1B] border-[#2B2B2B] text-white/85 hover:bg-[#1B1B1B]",
                                        ].join(" ")}
                                        title="Edit timeline"
                                    >
                                        Edit timeline
                                    </button>
                                )}

                                <SessionStageBar
                                    stages={stages}
                                    startTime={stagebarStartTime}
                                    cycleSeconds={stagebarCycleSeconds}
                                    onHoverStage={onHoverStage as any}
                                    progressStyle="tick"
                                    tickEveryMs={1000}
                                    theme={theme}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}