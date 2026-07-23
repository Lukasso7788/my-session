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
    currentStage?: Stage | null;

    hostProfile?: HostProfile | null;
    isInfiniteRoom?: boolean;
    activeRoomHostProfile?: HostProfile | null;
    isCurrentUserActiveRoomHost?: boolean;
    canStepInAsHost?: boolean;
    activeRoomHostBusy?: boolean;
    activeRoomHostError?: string;
    onStepInAsHost?: () => void;
    onStepDownAsHost?: () => void;

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
        currentStage,
        hostProfile,
        isInfiniteRoom = false,
        activeRoomHostProfile,
        isCurrentUserActiveRoomHost = false,
        canStepInAsHost = false,
        activeRoomHostBusy = false,
        activeRoomHostError = "",
        onStepInAsHost,
        onStepDownAsHost,
        onToggleTheme,
        onOpenHostProfile,
        onHoverStage,
        canEditTimeline = false,
        onEditTimeline,
    } = props;

    const isLight = theme === "light";

    const topBarBg = isLight
        ? "bg-[#F3F1F1]/95 border border-[#CFCFCF]"
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
    const showStageBar =
        !isSilentRoom && stages.length > 0 && !!stagebarStartTime;

    const showEditTimeline =
        showStageBar && !!canEditTimeline && typeof onEditTimeline === "function";

    const fullStageLabel = String(currentStage?.name || currentStage?.type || "Stage")
        .trim()
        .slice(0, 25);
    const shortStageLabel =
        fullStageLabel.length <= 8
            ? fullStageLabel
            : `${fullStageLabel.slice(0, 7)}…`;
    const stageColor = String(currentStage?.color || "#5B8DEF");

    const stageTextColor = (() => {
        const hex = stageColor.trim().replace(/^#/, "");
        const normalized = hex.length === 3
            ? hex.split("").map((x) => `${x}${x}`).join("")
            : hex;
        if (!/^[0-9a-f]{6}$/i.test(normalized)) return "#FFFFFF";
        const channels = [0, 2, 4].map((offset) => {
            const value = parseInt(normalized.slice(offset, offset + 2), 16) / 255;
            return value <= 0.03928
                ? value / 12.92
                : Math.pow((value + 0.055) / 1.055, 2.4);
        });
        const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        return luminance > 0.43 ? "#171717" : "#FFFFFF";
    })();

    const renderTimer = () => showTimer ? (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${chipBg}`}>
            <Icon name="timer" theme={theme} className="w-4 h-4 opacity-80" alt="Timer" />
            <span className={`font-inter text-[13px] ${mutedText}`}>
                {remainingTime || "--:--"}
            </span>
            {!!currentStage && (
                <span
                    className="max-w-[76px] truncate rounded-lg px-2 py-0.5 font-inter text-[10px] font-semibold leading-4"
                    style={{ backgroundColor: stageColor, color: stageTextColor }}
                    title={fullStageLabel}
                    aria-label={`Current stage: ${fullStageLabel}`}
                >
                    {shortStageLabel}
                </span>
            )}
        </div>
    ) : null;

    const activeHostControl = activeRoomHostProfile ? (
        isCurrentUserActiveRoomHost && typeof onStepDownAsHost === "function" ? (
            <button
                type="button"
                onClick={onStepDownAsHost}
                disabled={activeRoomHostBusy}
                className={`rounded-xl border px-3 py-1.5 text-[12px] font-inter font-medium transition disabled:opacity-50 ${isLight ? "border-[#CFCFCF] bg-white text-black/70 hover:bg-[#F2F3F5]" : "border-[#343434] bg-[#242424] text-white/85 hover:bg-[#2D2D2D]"}`}
                title={activeRoomHostError || "Release the temporary host role"}
            >
                {activeRoomHostBusy ? "Updating…" : "Hosting · Step down"}
            </button>
        ) : (
            <span
                className={`rounded-xl border px-3 py-1.5 text-[12px] font-inter ${isLight ? "border-[#CFCFCF] bg-white text-black/70" : "border-[#343434] bg-[#242424] text-white/85"}`}
                title={`Active host: ${String(activeRoomHostProfile.full_name || "Participant")}`}
            >
                Active host: <strong>{String(activeRoomHostProfile.full_name || "Participant")}</strong>
            </span>
        )
    ) : canStepInAsHost && typeof onStepInAsHost === "function" ? (
        <button
            type="button"
            onClick={onStepInAsHost}
            disabled={activeRoomHostBusy}
            className={`rounded-xl border px-3 py-1.5 text-[12px] font-inter font-semibold transition disabled:opacity-50 ${isLight ? "border-[#5BCB73] bg-[#EAF9ED] text-[#207A35] hover:bg-[#DDF5E2]" : "border-[#4B9B5D] bg-[#17361F] text-[#8CE39D] hover:bg-[#1D4427]"}`}
            title={activeRoomHostError || "Temporarily run room controls while the owner is away"}
        >
            {activeRoomHostBusy ? "Claiming…" : "Step in as host"}
        </button>
    ) : null;

    return (
        <div
            className={`relative isolate flex w-full rounded-2xl overflow-visible ${topBarBg}`}
        >
            <div className="flex-1 px-4 sm:px-6 py-3 sm:py-4 overflow-visible">
                <div className="flex flex-col gap-2 max-[480px]:gap-2 overflow-visible">
                    <div className="relative z-10 flex items-center justify-between gap-3">
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

                        <div className="relative z-10 hidden min-[481px]:flex items-center gap-2 shrink-0">
                            {renderTimer()}

                            <button
                                onClick={onToggleTheme}
                                className={`${switchTrack} ${switchTrackCls}`}
                                title="Toggle theme"
                                aria-label="Toggle theme"
                                type="button"
                            >
                                <div
                                    className={switchThumb}
                                    style={{ transform: thumbTranslate }}
                                >
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
                                    <ParticipantsSmartIcon
                                        theme={theme}
                                        className="w-4 h-4 opacity-90"
                                    />
                                    <span className="font-inter">
                                        <span className="font-light">{isInfiniteRoom ? "Owner:" : "Host:"}</span>{" "}
                                        <span className="font-bold">
                                            {String(hostProfile.full_name || "Host")}
                                        </span>
                                    </span>
                                </button>
                            )}
                            {isInfiniteRoom && activeHostControl}
                        </div>
                    </div>

                    <div className="relative z-10 min-[481px]:hidden flex items-center justify-start gap-2">
                        {renderTimer()}

                        <button
                            onClick={onToggleTheme}
                            className={`${switchTrack} ${switchTrackCls}`}
                            title="Toggle theme"
                            aria-label="Toggle theme"
                            type="button"
                        >
                            <div
                                className={switchThumb}
                                style={{ transform: thumbTranslate }}
                            >
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
                                title={`${isInfiniteRoom ? "Owner" : "Host"}: ${String(hostProfile.full_name || "Host")}`}
                                aria-label="Host profile"
                                type="button"
                            >
                                <ParticipantsSmartIcon
                                    theme={theme}
                                    className="w-5 h-5 opacity-90"
                                />
                            </button>
                        )}
                        {isInfiniteRoom && activeHostControl}
                    </div>

                    {showStageBar && (
                        <div className="relative z-30 mt-1 max-[480px]:mt-1 w-full overflow-visible pt-1">
                            <div className="group relative z-30 overflow-visible">
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
                                    stages={stages as any}
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
