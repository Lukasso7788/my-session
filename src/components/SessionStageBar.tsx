import React, { useEffect, useMemo, useState } from "react";
import { SessionStage } from "../SessionConfig";

type RoomTheme = "dark" | "light";

interface Props {
  stages: SessionStage[];
  startTime: string;
  onHoverStage?: (stage: SessionStage | null) => void;
  cycleSeconds?: number;
  progressStyle?: "fill" | "tick";
  tickEveryMs?: number;
  theme?: RoomTheme;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function parseTimeMs(input: any): number | null {
  if (input == null) return null;

  if (input instanceof Date) {
    const t = input.getTime();
    return Number.isFinite(t) ? t : null;
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    const ms = input < 1e12 ? input * 1000 : input;
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof input === "string") {
    const s = input.trim();
    if (!s) return null;

    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return null;
      const ms = n < 1e12 ? n * 1000 : n;
      return Number.isFinite(ms) ? ms : null;
    }

    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }

  return null;
}

function getStageSeconds(stage: any): number {
  const s =
    Number(stage?.durationSeconds) ||
    Number(stage?.duration_seconds) ||
    Number(stage?.seconds);

  if (Number.isFinite(s) && s > 0) return s;

  const mins = Number(stage?.duration ?? stage?.minutes);
  if (Number.isFinite(mins) && mins > 0) return mins * 60;

  return 0;
}

function getStageLabelMinutes(stage: any): number {
  const sec = getStageSeconds(stage);
  if (sec > 0) return Math.max(1, Math.round(sec / 60));

  const mins = Number(stage?.duration ?? stage?.minutes);
  if (Number.isFinite(mins) && mins > 0) return Math.round(mins);

  return 0;
}

function formatStageDuration(stage: any): string {
  const totalSec = getStageSeconds(stage);

  if (!Number.isFinite(totalSec) || totalSec <= 0) {
    const mins = getStageLabelMinutes(stage);
    return mins > 0 ? `${mins} min` : "";
  }

  if (totalSec < 60) return `${totalSec} sec`;

  const mins = Math.floor(totalSec / 60);
  const sec = totalSec % 60;

  if (sec === 0) return `${mins} min`;
  return `${mins} min ${sec} sec`;
}

export type StageKind =
  | "welcome"
  | "intentions"
  | "focus"
  | "break"
  | "checkin"
  | "recap"
  | "celebrate"
  | "farewell"
  | "custom";

const KIND_META: Record<StageKind, { label: string; color: string }> = {
  welcome: { label: "Welcome", color: "#34D399" },
  intentions: { label: "Intentions", color: "#ADD3FF" },
  focus: { label: "Focus", color: "#3B82F6" },
  break: { label: "Break", color: "#FDA4AF" },
  checkin: { label: "Check-in", color: "#ADD3FF" },
  recap: { label: "Recap", color: "#A78BFA" },
  celebrate: { label: "Celebrate", color: "#F472B6" },
  farewell: { label: "Farewell", color: "#34D399" },
  custom: { label: "Custom", color: "#F63135" },
};

function normalizeKind(raw: any): StageKind {
  const k = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  if (k === "check-in" || k === "checkin" || k === "check_in") return "checkin";
  if (k === "intention" || k === "intentions") return "intentions";
  if (k === "welcome" || k === "intro" || k === "introduction") return "welcome";
  if (k === "focus" || k === "work") return "focus";
  if (k === "break" || k === "rest" || k === "pause") return "break";
  if (k === "recap" || k === "review") return "recap";
  if (k === "celebrate" || k === "celebration") return "celebrate";

  if (
    k === "farewell" ||
    k === "goodbye" ||
    k === "closing" ||
    k === "wrap" ||
    k === "wrap-up" ||
    k === "wrapup"
  ) {
    return "farewell";
  }

  if (k.includes("farewell") && k.includes("celebrate")) return "farewell";
  if (k === "custom") return "custom";

  return "custom";
}

function inferKindFromText(textAny: any): StageKind | null {
  const s = String(textAny || "").trim().toLowerCase();
  if (!s) return null;

  const hasCelebrate = s.includes("celebrate") || s.includes("celebration");
  const hasFarewell =
    s.includes("farewell") ||
    s.includes("goodbye") ||
    s.includes("closing") ||
    s.includes("wrap up") ||
    s.includes("wrap-up") ||
    s.includes("wrapup") ||
    s.includes("fare well");

  if (hasCelebrate && hasFarewell) return "farewell";
  if (hasFarewell) return "farewell";

  if (
    s.includes("welcome") ||
    s.includes("intro") ||
    s.includes("start") ||
    s.includes("opening")
  ) {
    return "welcome";
  }

  if (
    s.includes("intention") ||
    s.includes("intentions") ||
    s.includes("goals") ||
    s.includes("goal") ||
    s.includes("plan") ||
    s.includes("commit")
  ) {
    return "intentions";
  }

  if (
    s.includes("check-in") ||
    s.includes("check in") ||
    s.includes("checkin") ||
    s.includes("check-in:")
  ) {
    return "checkin";
  }

  if (s.includes("break") || s.includes("rest") || s.includes("pause")) return "break";
  if (s.includes("focus") || s.includes("deep work") || s.includes("work block")) return "focus";
  if (s.includes("recap") || s.includes("review") || s.includes("reflection")) return "recap";
  if (hasCelebrate) return "celebrate";

  return null;
}

function getStageKind(stage: any): StageKind {
  const rawKind =
    stage?.kind ??
    stage?.type ??
    stage?.stageKind ??
    stage?.stage_kind ??
    stage?.blockKind;

  const normalized = normalizeKind(rawKind);
  if (normalized !== "custom") return normalized;

  const txt =
    stage?.title ??
    stage?.label ??
    stage?.displayName ??
    stage?.name ??
    "";

  const inferred = inferKindFromText(txt);
  return inferred ?? normalized;
}

function getDisplayName(stage: any, kind: StageKind) {
  const name = String(
    stage?.title ?? stage?.label ?? stage?.displayName ?? stage?.name ?? ""
  ).trim();

  return name || KIND_META[kind].label;
}

function isValidCssColor(raw: unknown): boolean {
  const s = String(raw || "").trim();
  if (!s) return false;

  if (/^#[0-9a-f]{3}$/i.test(s)) return true;
  if (/^#[0-9a-f]{6}$/i.test(s)) return true;
  if (/^#[0-9a-f]{8}$/i.test(s)) return true;

  if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(s)) return true;
  if (/^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)$/i.test(s)) return true;

  if (/^hsl\(/i.test(s)) return true;
  if (/^hsla\(/i.test(s)) return true;
  if (/^var\(--[a-z0-9-_]+\)$/i.test(s)) return true;

  if (s.toLowerCase().includes("gradient(")) return true;

  return false;
}

function getRawStageColor(stage: any): string {
  return String(
    stage?.color ??
    stage?.colour ??
    stage?.bgColor ??
    stage?.backgroundColor ??
    stage?.background ??
    stage?.stageColor ??
    stage?.stage_color ??
    ""
  ).trim();
}

function resolveStageColor(stage: any, kind: StageKind) {
  // Product rule:
  // Check-in must visually match Intentions.
  //
  // Some older sessions can already have a different color saved inside
  // sessions.schedule. If we read that raw stage.color first, old check-ins
  // can keep showing a strange color forever.
  //
  // So check-in intentionally ignores saved stage.color and always uses the
  // same fallback color as Intentions.
  if (kind === "checkin") {
    return KIND_META.intentions.color;
  }

  const raw = getRawStageColor(stage);

  if (!raw) return KIND_META[kind].color;
  if (!isValidCssColor(raw)) return KIND_META[kind].color;

  const s = raw.replace(/\s+/g, "").toLowerCase();

  const legacyBlue =
    s === "#4ca0ff" ||
    s === "rgb(76,160,255)" ||
    s === "rgba(76,160,255,1)" ||
    s === "rgba(76,160,255,1.0)";

  if (legacyBlue && kind !== "focus") {
    return KIND_META[kind].color;
  }

  return raw;
}

function stageColorStyle(color: string): React.CSSProperties {
  const c = String(color || "").trim();

  if (c.toLowerCase().includes("gradient(")) {
    return { background: c };
  }

  return { backgroundColor: c };
}

export function resolveStageVisual(stage: any): {
  kind: StageKind;
  name: string;
  color: string;
  minutes: number;
  seconds: number;
} {
  const kind = getStageKind(stage);
  const name = getDisplayName(stage, kind);
  const color = resolveStageColor(stage, kind);
  const seconds = Math.max(0, getStageSeconds(stage));
  const minutes = getStageLabelMinutes(stage);
  return { kind, name, color, minutes, seconds };
}

export function SessionStageBar({
  stages,
  startTime,
  onHoverStage,
  cycleSeconds,
  progressStyle = "fill",
  tickEveryMs = 1000,
  theme = "dark",
}: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [cycleProgress, setCycleProgress] = useState(0);
  const [hoveredStageIndex, setHoveredStageIndex] = useState<number | null>(null);

  const stageSecondsList = useMemo(() => {
    return (stages || []).map((s) => Math.max(0, getStageSeconds(s)));
  }, [stages]);

  const totalStagesSeconds = useMemo(() => {
    const sum = stageSecondsList.reduce((acc, v) => acc + v, 0);
    return Math.max(1, sum);
  }, [stageSecondsList]);

  const loopSeconds = useMemo(() => {
    const cs = Number(cycleSeconds) || 0;
    return cs > 0 ? cs : totalStagesSeconds;
  }, [cycleSeconds, totalStagesSeconds]);

  useEffect(() => {
    const startMs = parseTimeMs(startTime);
    if (!startMs) {
      setElapsed(0);
      return;
    }

    const tick = () => {
      const nowMs = Date.now();
      const diff = Math.floor((nowMs - startMs) / 1000);
      setElapsed(Number.isFinite(diff) ? diff : 0);
    };

    tick();
    const timer = window.setInterval(tick, Math.max(250, Number(tickEveryMs) || 1000));
    return () => window.clearInterval(timer);
  }, [startTime, tickEveryMs]);

  useEffect(() => {
    if (!stages?.length) {
      setCurrentStageIndex(0);
      setProgress(0);
      setCycleProgress(0);
      return;
    }

    const raw = Number.isFinite(elapsed) ? elapsed : 0;
    const normalized =
      loopSeconds > 0 ? ((raw % loopSeconds) + loopSeconds) % loopSeconds : raw;

    const cp = loopSeconds > 0 ? clamp(normalized / loopSeconds, 0, 1) : 0;
    setCycleProgress(Number.isFinite(cp) ? cp : 0);

    let total = 0;
    let stageIndex = 0;
    let stageProgress = 0;

    const firstNonZero = stageSecondsList.findIndex((x) => x > 0);
    if (firstNonZero >= 0) stageIndex = firstNonZero;

    for (let i = 0; i < stages.length; i++) {
      const durSec = stageSecondsList[i] || 0;
      const nextTotal = total + durSec;

      if (durSec <= 0) continue;

      if (normalized < nextTotal) {
        stageIndex = i;
        const stageElapsed = normalized - total;
        stageProgress = clamp(stageElapsed / durSec, 0, 1);
        break;
      }

      total = nextTotal;
      stageIndex = i;
    }

    setCurrentStageIndex(stageIndex);
    setProgress(Number.isFinite(stageProgress) ? stageProgress : 0);
  }, [elapsed, stages, loopSeconds, stageSecondsList]);

  const markerColor = theme === "light" ? "#374151" : "#FFFFFF";
  const trackBgClass =
    theme === "light"
      ? "bg-black/10 shadow-[inset_0_1px_2px_rgba(17,24,39,0.08)]"
      : "bg-white/10 shadow-inner";

  const tooltipCardClass =
    theme === "light"
      ? "border border-slate-200 bg-white/95 text-slate-900 shadow-[0_12px_28px_rgba(15,23,42,0.18)] backdrop-blur-md"
      : "border border-white/10 bg-slate-900/95 text-white shadow-[0_12px_28px_rgba(0,0,0,0.4)] backdrop-blur-md";

  const markerLeftPercent = clamp(cycleProgress * 100, 0.5, 99.5);

  return (
    <div className="relative w-full h-2 overflow-visible">
      <div
        className={`absolute inset-x-0 top-0 h-2 flex rounded-full overflow-visible ${trackBgClass}`}
      >
        {(stages || []).map((stage, index) => {
          const durSec = stageSecondsList[index] || 0;
          const width = durSec > 0 ? (durSec / totalStagesSeconds) * 100 : 0;

          if (width <= 0) return null;

          const { kind, name: displayName, color: bg } = resolveStageVisual(stage as any);
          const durationLabel = formatStageDuration(stage);

          const hoverStage = {
            ...(stage as any),
            name: displayName,
            color: bg,
            kind,
          } as SessionStage;

          const isActive = index === currentStageIndex;
          const isHovered = hoveredStageIndex === index;
          const isFirst = index === 0;
          const isLast = index === (stages?.length || 0) - 1;
          const isSingle = (stages?.length || 0) === 1;

          const borderRadiusStyle: React.CSSProperties = isSingle
            ? { borderRadius: "9999px" }
            : {
              borderTopLeftRadius: isFirst ? "9999px" : 0,
              borderBottomLeftRadius: isFirst ? "9999px" : 0,
              borderTopRightRadius: isLast ? "9999px" : 0,
              borderBottomRightRadius: isLast ? "9999px" : 0,
            };

          const progressWidth = isActive
            ? `${clamp(progress, 0, 1) * 100}%`
            : index < currentStageIndex
              ? "100%"
              : "0%";

          return (
            <div
              key={(stage as any)?.id || `${index}-${displayName}`}
              className="relative h-full cursor-pointer transition-all duration-300"
              style={{
                width: `${width}%`,
                ...stageColorStyle(bg),
                opacity: isActive ? 1 : 0.84,
                ...borderRadiusStyle,
              }}
              onMouseEnter={() => {
                setHoveredStageIndex(index);
                onHoverStage?.(hoverStage);
              }}
              onMouseLeave={() => {
                setHoveredStageIndex((prev) => (prev === index ? null : prev));
                onHoverStage?.(null);
              }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 bg-black/18 transition-all"
                style={{
                  width: progressWidth,
                  ...borderRadiusStyle,
                }}
              />

              {isHovered && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-3 flex -translate-x-1/2">
                  <div className={`relative min-w-[150px] rounded-xl px-3 py-2 ${tooltipCardClass}`}>
                    <div className="flex items-start gap-2">
                      <div
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={stageColorStyle(bg)}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold leading-4">
                          {displayName}
                        </div>
                        {durationLabel ? (
                          <div className="mt-1 text-[11px] leading-4 opacity-75">
                            {durationLabel}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div
                      className={`absolute left-1/2 top-full h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 ${theme === "light"
                        ? "border-r border-b border-slate-200 bg-white/95"
                        : "border-r border-b border-white/10 bg-slate-900/95"
                        }`}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {progressStyle === "tick" && (
        <div
          className="absolute pointer-events-none z-[40]"
          style={{
            left: `${markerLeftPercent}%`,
            top: -3,
            width: 2,
            height: 12,
            transform: "translateX(-50%)",
            backgroundColor: markerColor,
            borderRadius: 9999,
            boxShadow:
              theme === "light"
                ? "0 0 0 1px rgba(255,255,255,0.65)"
                : "0 0 0 1px rgba(15,23,42,0.45)",
          }}
        />
      )}
    </div>
  );
}

export default SessionStageBar;