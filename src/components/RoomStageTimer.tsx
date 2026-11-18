import { resolveStageVisual } from "./SessionStageBar";
import { Icon, type RoomTheme } from "./VideoControls";

type TimerStage = { name: string; kind?: string; type: string; color: string };

export function RoomStageTimer({ theme, remainingTime, currentStage, compact = false }: {
    theme: RoomTheme;
    remainingTime: string;
    currentStage?: TimerStage | null;
    compact?: boolean;
}) {
    const isLight = theme === "light";
    const surface = isLight ? "bg-[#E1E3E6] border-[#CFCFCF]" : "bg-[#1B1B1B] border-[#252525]";
    const text = isLight ? "text-black/65" : "text-white/80";
    const fullStageLabel = String(currentStage?.name || currentStage?.type || "Stage")
        .trim()
        .slice(0, 25);
    const shortStageLabel =
        fullStageLabel.length <= 8
            ? fullStageLabel
            : `${fullStageLabel.slice(0, 7)}…`;
    // Use the same canonical color as the timeline (including legacy check-ins).
    const stageColor = currentStage
        ? resolveStageVisual(currentStage).color
        : "#5B8DEF";

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

    return (
        <div className={`flex shrink-0 items-center rounded-xl border ${surface} ${compact
            ? "gap-1 whitespace-nowrap px-1.5 py-1 max-[359px]:flex-col max-[359px]:gap-0 min-[420px]:gap-2 min-[420px]:px-3 min-[420px]:py-1.5"
            : "gap-2 px-3 py-1.5"}`}>
            <Icon name="timer" theme={theme} className={`h-4 w-4 shrink-0 opacity-80 ${compact ? "hidden min-[360px]:block" : ""}`} alt="" />
            <span role="timer" aria-label="Time left in current block" className={`font-inter text-[13px] font-normal tabular-nums ${text}`}>
                {remainingTime || "--:--"}
            </span>
            {currentStage && (
                <span
                    className={`max-w-[76px] truncate rounded-lg font-inter text-[10px] font-semibold leading-4 ${compact ? "px-1.5 min-[420px]:px-2" : "px-2 py-0.5"}`}
                    style={{ backgroundColor: stageColor, color: stageTextColor }}
                    title={fullStageLabel}
                    aria-label={`Current stage: ${fullStageLabel}`}
                >
                    {shortStageLabel}
                </span>
            )}
        </div>
    );
}
