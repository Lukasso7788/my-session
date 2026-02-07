// src/components/SessionStageBar.tsx
import React, { useEffect, useMemo, useState } from "react";
import { SessionStage } from "../SessionConfig";

interface Props {
  stages: SessionStage[];
  startTime: string; // ISO or unix (sec/ms) as string
  onHoverStage?: (stage: SessionStage | null) => void;
  cycleSeconds?: number;

  /**
   * ✅ NEW:
   * - "fill" = старое поведение (заливка по пройденному времени)
   * - "tick" = вертикальная чёрточка, которая едет по таймлайну
   */
  progressStyle?: "fill" | "tick";

  /**
   * ✅ NEW:
   * Таймер обновления (мс). По умолчанию 1000.
   * Для infinite можно ставить 15000, чтобы не жрало ресурсы.
   */
  tickEveryMs?: number;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/**
 * ✅ Parse ISO / unix seconds / unix ms (number-like strings).
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
 * ✅ Robust duration resolver:
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
// ✅ Kind -> color + label mapping
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
  welcome: { label: "Welcome", color: "#34D399" }, // emerald-400
  intentions: { label: "Intentions", color: "#38BDF8" }, // sky-400
  focus: { label: "Focus", color: "#3B82F6" }, // blue-500
  break: { label: "Break", color: "#FDA4AF" }, // rose-300
  checkin: { label: "Check-in", color: "#38BDF8" }, // sky-400
  recap: { label: "Recap", color: "#A78BFA" }, // violet-400
  celebrate: { label: "Celebrate", color: "#F472B6" }, // pink-400

  // ✅ NEW: Farewell = зелёный (как ты хотел для "Celebrate and Farewell")
  farewell: { label: "Farewell", color: "#34D399" }, // emerald-400

  // ✅ NEW: custom = индиго, как "Custom session" label в SessionCard
  custom: { label: "Custom", color: "#6366F1" }, // indigo-500
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

  // ✅ NEW: farewell
  if (
    k === "farewell" ||
    k === "goodbye" ||
    k === "closing" ||
    k === "wrap" ||
    k === "wrap-up" ||
    k === "wrapup"
  )
    return "farewell";

  // ✅ NEW: если кто-то пишет kind прям "celebrate-and-farewell"
  if (k.includes("farewell") && k.includes("celebrate")) return "farewell";

  if (k === "custom") return "custom";

  return "custom";
}

/**
 * ✅ Title-based inference — чтобы цвета совпадали даже если kind пустой.
 * И чтобы "Celebrate and Farewell" => зелёный (farewell).
 */
function inferKindFromText(textAny: any): StageKind | null {
  const s = String(textAny || "").trim().toLowerCase();
  if (!s) return null;

  // priority: farewell > celebrate (чтобы "celebrate and farewell" был зелёным)
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
  )
    return "welcome";

  if (
    s.includes("intention") ||
    s.includes("intentions") ||
    s.includes("goals") ||
    s.includes("goal") ||
    s.includes("plan") ||
    s.includes("commit")
  )
    return "intentions";

  if (
    s.includes("check-in") ||
    s.includes("check in") ||
    s.includes("checkin") ||
    s.includes("check-in:")
  )
    return "checkin";

  if (s.includes("break") || s.includes("rest") || s.includes("pause"))
    return "break";

  if (s.includes("focus") || s.includes("deep work") || s.includes("work block"))
    return "focus";

  if (s.includes("recap") || s.includes("review") || s.includes("reflection"))
    return "recap";

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

  // Если kind распознан — ок
  if (normalized !== "custom") return normalized;

  // Иначе пытаемся по title/name/label
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

  // если stage называется "Celebrate and Farewell" — оставляем имя как есть
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
 * ✅ Exported helper — чтобы SessionCard/Info показывали
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
}: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  // ✅ NEW: overall progress in cycle (0..1) — for tick
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

  // 🔁 Update elapsed (interval configurable)
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

  // 🧮 Current stage + progress (supports infinite loop)
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

    // overall progress for tick
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

  return (
    <div className="relative w-full flex h-4 rounded-2xl overflow-hidden bg-white/10 shadow-inner">
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

        // old fill mode
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
              opacity: isActive ? 1 : 0.8,
            }}
            onMouseEnter={() => onHoverStage?.(hoverStage)}
            onMouseLeave={() => onHoverStage?.(null)}
            title={`${displayName}${labelMins ? ` • ${labelMins} min` : ""}`}
          >
            {progressStyle === "fill" && (
              <div
                className="absolute left-0 top-0 bottom-0 bg-black/15 transition-all"
                style={{ width: progressWidth }}
              />
            )}

            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center z-50">
              <div className="bg-slate-900 text-white text-[11px] px-2 py-1 rounded-md shadow-lg whitespace-nowrap">
                {displayName}
                {labelMins ? ` • ${labelMins} min` : ""}
              </div>
              <div className="w-2 h-2 bg-slate-900 rotate-45 mt-[-3px]" />
            </div>
          </div>
        );
      })}

      {/* ✅ NEW: moving tick */}
      {progressStyle === "tick" && (
        <div
          className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-black/70 pointer-events-none"
          style={{
            left: `${clamp(cycleProgress, 0, 1) * 100}%`,
            transform: "translateX(-1px)",
          }}
        />
      )}
    </div>
  );
}
