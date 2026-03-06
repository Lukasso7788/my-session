// src/components/SessionStageBar.tsx
import React, { useEffect, useMemo, useState } from "react";
import { SessionStage } from "../SessionConfig";

type RoomTheme = "dark" | "light";

interface Props {
  stages: SessionStage[];
  startTime: string; // ISO or unix (sec/ms) as string
  onHoverStage?: (stage: SessionStage | null) => void;
  cycleSeconds?: number;

  /**
   * - "fill" = классическая заливка по времени
   * - "tick" = заливка + движущийся marker tick
   */
  progressStyle?: "fill" | "tick";

  /**
   * Таймер обновления (мс). По умолчанию 1000.
   * Для infinite можно ставить 15000, чтобы не жрало ресурсы.
   */
  tickEveryMs?: number;

  /**
   * Цвет движущегося индикатора:
   * - dark -> белый
   * - light -> dark gray
   */
  theme?: RoomTheme;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/**
 * Parse ISO / unix seconds / unix ms (number-like strings).
 * Returns ms timestamp or null.
 */
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

/**
 * Robust duration resolver:
 * Supports:
 * - stage.durationSeconds / stage.seconds / stage.duration_seconds
 * - stage.duration as minutes (legacy)
 * - stage.minutes as minutes (legacy)
 */
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

// ===============================
// Kind -> color + label mapping
// ===============================
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
  intentions: { label: "Intentions", color: "#38BDF8" },
  focus: { label: "Focus", color: "#3B82F6" },
  break: { label: "Break", color: "#FDA4AF" },
  checkin: { label: "Check-in", color: "#38BDF8" },
  recap: { label: "Recap", color: "#A78BFA" },
  celebrate: { label: "Celebrate", color: "#F472B6" },
  farewell: { label: "Farewell", color: "#34D399" },
  custom: { label: "Custom", color: "#6366F1" },
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

/**
 * Title-based inference.
 * "Celebrate and Farewell" => farewell
 */
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
    stage?.title ??
    stage?.label ??
    stage?.displayName ??
    stage?.name ??
    ""
  ).trim();

  return name || KIND_META[kind].label;
}

function resolveStageColor(stage: any, kind: StageKind) {
  const raw = stage?.color;

  if (!raw) return KIND_META[kind].color;

  const s = String(raw).trim().toLowerCase();

  if (
    (s === "#4ca0ff" ||
      s === "rgb(76,160,255)" ||
      s === "rgba(76,160,255,1)") &&
    kind !== "focus"
  ) {
    return KIND_META[kind].color;
  }

  return raw;
}

/**
 * Exported helper — чтобы SessionCard/Info показывали
 * ровно те же kind/colors, что и SessionStageBar.
 */
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

  const markerColor = theme === "light" ? "#1F2937" : "#FFFFFF";

  const markerOutline =
    theme === "light"
      ? "0 0 0 1px rgba(255,255,255,0.75), 0 1px 6px rgba(17,24,39,0.28)"
      : "0 0 0 1px rgba(0,0,0,0.45), 0 1px 6px rgba(0,0,0,0.35)";

  const trackBgClass =
    theme === "light"
      ? "bg-black/10 shadow-[inset_0_1px_2px_rgba(17,24,39,0.08)]"
      : "bg-white/10 shadow-inner";

  // Делаем маркер не упираться в самые края, чтобы его не визуально не срезало.
  const markerLeftPercent = clamp(cycleProgress * 100, 0.75, 99.25);

  return (
    <div className="relative w-full h-4 overflow-visible">
      {/* Track */}
      <div
        className={`absolute inset-x-0 top-0 h-4 flex rounded-2xl overflow-hidden ${trackBgClass}`}
      >
        {(stages || []).map((stage, index) => {
          const durSec = stageSecondsList[index] || 0;
          const width = durSec > 0 ? (durSec / totalStagesSeconds) * 100 : 0;

          if (width <= 0) return null;

          const { kind, name: displayName, color: bg, minutes: labelMins } =
            resolveStageVisual(stage as any);

          const hoverStage = {
            ...(stage as any),
            name: displayName,
            color: bg,
            kind,
          } as SessionStage;

          const isActive = index === currentStageIndex;

          const progressWidth = isActive
            ? `${clamp(progress, 0, 1) * 100}%`
            : index < currentStageIndex
              ? "100%"
              : "0%";

          return (
            <div
              key={(stage as any)?.id || `${index}-${displayName}`}
              className="relative h-full group cursor-pointer transition-all duration-300"
              style={{
                width: `${width}%`,
                ...(typeof bg === "string" && bg.toLowerCase().includes("gradient")
                  ? { background: bg }
                  : { backgroundColor: bg }),
                opacity: isActive ? 1 : 0.82,
              }}
              onMouseEnter={() => onHoverStage?.(hoverStage)}
              onMouseLeave={() => onHoverStage?.(null)}
              title={`${displayName}${labelMins ? ` • ${labelMins} min` : ""}`}
            >
              <div
                className="absolute left-0 top-0 bottom-0 bg-black/15 transition-all"
                style={{ width: progressWidth }}
              />

              <div className="absolute bottom-full left-1/2 z-50 mb-2 hidden -translate-x-1/2 group-hover:flex flex-col items-center">
                <div className="bg-slate-900 text-white text-[11px] px-2 py-1 rounded-md shadow-lg whitespace-nowrap">
                  {displayName}
                  {labelMins ? ` • ${labelMins} min` : ""}
                </div>
                <div className="w-2 h-2 bg-slate-900 rotate-45 mt-[-3px]" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Moving marker tick */}
      {progressStyle === "tick" && (
        <div
          className="absolute pointer-events-none z-[40]"
          style={{
            left: `${markerLeftPercent}%`,
            top: -3,
            transform: "translateX(-50%)",
          }}
        >
          {/* Верхняя шапка маркера */}
          <div
            className="rounded-full"
            style={{
              width: 10,
              height: 6,
              marginLeft: -3,
              backgroundColor: markerColor,
              boxShadow: markerOutline,
            }}
          />

          {/* Основная вертикальная линия */}
          <div
            className="rounded-full"
            style={{
              width: 4,
              height: 18,
              marginTop: 1,
              backgroundColor: markerColor,
              boxShadow: markerOutline,
            }}
          />

          {/* Внутренний сегмент внутри бара, чтобы было видно даже если верх где-то режется */}
          <div
            className="rounded-full"
            style={{
              width: 4,
              height: 10,
              marginTop: -12,
              backgroundColor: markerColor,
              boxShadow: markerOutline,
              opacity: 0.98,
            }}
          />
        </div>
      )}
    </div>
  );
}

export default SessionStageBar;