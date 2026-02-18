// src/components/RoomTopBar.tsx
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
    duration: number; // minutes (display/legacy)
    color: string;
    type: string;
    durationSeconds?: number;
};

export default function RoomTopBar(props: {
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
}) {
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
    } = props;

    const isLight = theme === "light";

    const topBarBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#111827]/40 border border-white/5";
    const chipBg = isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/5";
    const strongText = isLight ? "text-black/85" : "text-[#F3F4F6]/90";

    const switchTrack =
        "w-[84px] max-[480px]:w-[78px] h-[32px] rounded-full border relative transition flex items-center px-[3px]";
    const switchTrackCls = isLight
        ? "bg-black/5 border-black/10 hover:bg-black/10"
        : "bg-white/5 border-white/10 hover:bg-white/10";
    const switchThumb =
        "absolute top-[2px] w-[26px] h-[26px] rounded-full shadow-md transition-transform bg-white flex items-center justify-center";
    const thumbTranslate = isLight ? "translateX(0px)" : "translateX(52px)";

    const showTimer = !isSilentRoom && stages.length > 0 && !!stagebarStartTime;

    return (
        <div className={`flex w-full rounded-2xl overflow-hidden ${topBarBg}`}>
            <div className="flex-1 px-4 sm:px-6 py-3 sm:py-4">
                <div className="flex flex-col gap-2 max-[480px]:gap-2">
                    {/* ROW 1: title + count (always 1 line) */}
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                                <p className={`min-w-0 font-inter font-semibold text-[16px] sm:text-[18px] truncate ${strongText}`}>
                                    {sessionTitle || "Session"}
                                </p>

                                <span
                                    className={[
                                        "shrink-0 px-2 py-[3px] rounded-lg border text-[12px] font-inter",
                                        chipBg,
                                        isLight ? "text-black/65" : "text-white/80",
                                    ].join(" ")}
                                    title="Participants now / limit"
                                >
                                    {participantsCount}/{maxParticipants}
                                </span>
                            </div>
                        </div>

                        {/* desktop+ : controls stay here */}
                        <div className="hidden min-[481px]:flex items-center gap-2 shrink-0">
                            {showTimer && (
                                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${chipBg}`}>
                                    <Icon name="timer" theme={theme} className="w-4 h-4 opacity-80" alt="Timer" />
                                    <span className={`font-inter text-[13px] ${isLight ? "text-black/75" : "text-white/90"}`}>
                                        {remainingTime || "--:--"}
                                    </span>
                                </div>
                            )}

                            <button
                                onClick={onToggleTheme}
                                className={`${switchTrack} ${switchTrackCls}`}
                                title="Toggle theme"
                                aria-label="Toggle theme"
                            >
                                <div className={switchThumb} style={{ transform: thumbTranslate }}>
                                    <Icon name={isLight ? "theme-sun" : "theme-moon"} theme={theme} className="w-4 h-4" />
                                </div>
                            </button>

                            {!!hostProfile && (
                                <button
                                    onClick={onOpenHostProfile}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition text-[13px] ${isLight
                                            ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/75"
                                            : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-[#F3F4F6]/85"
                                        }`}
                                    title="Host profile"
                                >
                                    <ParticipantsSmartIcon theme={theme} className="w-4 h-4 opacity-90" />
                                    <span className="font-inter">
                                        <span className="font-light">Host:</span>{" "}
                                        <span className="font-bold">{String(hostProfile.full_name || "Host")}</span>
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* ROW 2: controls (mobile <=480) */}
                    <div className="min-[481px]:hidden flex items-center justify-start gap-2">
                        {showTimer && (
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${chipBg}`}>
                                <Icon name="timer" theme={theme} className="w-4 h-4 opacity-80" alt="Timer" />
                                <span className={`font-inter text-[13px] ${isLight ? "text-black/75" : "text-white/90"}`}>
                                    {remainingTime || "--:--"}
                                </span>
                            </div>
                        )}

                        <button
                            onClick={onToggleTheme}
                            className={`${switchTrack} ${switchTrackCls}`}
                            title="Toggle theme"
                            aria-label="Toggle theme"
                        >
                            <div className={switchThumb} style={{ transform: thumbTranslate }}>
                                <Icon name={isLight ? "theme-sun" : "theme-moon"} theme={theme} className="w-4 h-4" />
                            </div>
                        </button>

                        {!!hostProfile && (
                            <button
                                onClick={onOpenHostProfile}
                                className={`w-10 h-10 rounded-2xl flex items-center justify-center border transition ${isLight
                                        ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/70"
                                        : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-white/85"
                                    }`}
                                title={`Host: ${String(hostProfile.full_name || "Host")}`}
                                aria-label="Host profile"
                            >
                                <ParticipantsSmartIcon theme={theme} className="w-5 h-5 opacity-90" />
                            </button>
                        )}
                    </div>

                    {/* ROW 3: stage bar (full width) */}
                    {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
                        <div className="mt-1 max-[480px]:mt-1 w-full overflow-hidden">
                            <SessionStageBar
                                stages={stages}
                                startTime={stagebarStartTime}
                                cycleSeconds={stagebarCycleSeconds}
                                onHoverStage={onHoverStage as any}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
