// src/components/SessionStageBar.tsx
import React, { useEffect, useMemo, useState } from "react";
import { SessionStage } from "../SessionConfig";

interface Props {
  stages: SessionStage[];
  startTime: string; // ISO or unix (sec/ms) as string
  onHoverStage?: (stage: SessionStage | null) => void;
  cycleSeconds?: number;
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

  // if already Date
  if (input instanceof Date) {
    const t = input.getTime();
    return Number.isFinite(t) ? t : null;
  }

  // if numeric
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    // heuristic: < 1e12 -> seconds, else ms
    const ms = input < 1e12 ? input * 1000 : input;
    return Number.isFinite(ms) ? ms : null;
  }

  // if string
  if (typeof input === "string") {
    const s = input.trim();
    if (!s) return null;

    // numeric string?
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return null;
      const ms = n < 1e12 ? n * 1000 : n;
      return Number.isFinite(ms) ? ms : null;
    }

    // try Date.parse
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

  // fallback: minutes
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
type StageKind =
  | "welcome"
  | "intentions"
  | "focus"
  | "break"
  | "checkin"
  | "recap"
  | "celebrate"
  | "custom";

const KIND_META: Record<StageKind, { label: string; color: string }> = {
  welcome: { label: "Welcome", color: "#34D399" }, // emerald-400
  intentions: { label: "Intentions", color: "#38BDF8" }, // sky-400
  focus: { label: "Focus", color: "#3B82F6" }, // blue-500
  break: { label: "Break", color: "#FDA4AF" }, // rose-300

  // check-in можно оставить как intentions (как у тебя сейчас)
  checkin: { label: "Check-in", color: "#38BDF8" }, // sky-400

  recap: { label: "Recap", color: "#A78BFA" }, // violet-400
  celebrate: { label: "Celebrate", color: "#F472B6" }, // pink-400
  custom: { label: "Custom", color: "#9CA3AF" }, // gray-400 (можно оставить тут, gradient задаём обычно из RoomPage)
};

function normalizeKind(raw: any): StageKind {
  const k = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  if (k === "check-in" || k === "checkin" || k === "check_in") return "checkin";
  if (k === "intention" || k === "intentions") return "intentions";
  if (k === "welcome") return "welcome";
  if (k === "focus") return "focus";
  if (k === "break") return "break";
  if (k === "recap") return "recap";
  if (k === "celebrate" || k === "celebration") return "celebrate";
  if (k === "custom") return "custom";

  // ✅ unknown -> custom (не "focus")
  return "custom";
}

function getStageKind(stage: any): StageKind {
  // try common fields
  return normalizeKind(
    stage?.kind ??
    stage?.type ??
    stage?.stageKind ??
    stage?.stage_kind ??
    stage?.blockKind
  );
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

  // if no color at all -> use kind color
  if (!raw) return KIND_META[kind].color;

  const s = String(raw).trim().toLowerCase();

  // если раньше дефолт был "#4CA0FF", а теперь это recap/custom/etc — перекрываем
  if (
    (s === "#4ca0ff" || s === "rgb(76,160,255)" || s === "rgba(76,160,255,1)") &&
    kind !== "focus"
  ) {
    return KIND_META[kind].color;
  }

  return raw;
}

export function SessionStageBar({
  stages,
  startTime,
  onHoverStage,
  cycleSeconds,
}: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

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

  // 🔁 Update elapsed every second (robust time parsing)
  useEffect(() => {
    const startMs = parseTimeMs(startTime);
    if (!startMs) {
      // protect from NaN: just freeze at 0 if time is invalid
      setElapsed(0);
      return;
    }

    const tick = () => {
      const nowMs = Date.now();
      const diff = Math.floor((nowMs - startMs) / 1000);
      setElapsed(Number.isFinite(diff) ? diff : 0);
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startTime]);

  // 🧮 Current stage + progress (supports infinite loop)
  useEffect(() => {
    if (!stages?.length) {
      setCurrentStageIndex(0);
      setProgress(0);
      return;
    }

    const raw = Number.isFinite(elapsed) ? elapsed : 0;
    const normalized =
      loopSeconds > 0 ? ((raw % loopSeconds) + loopSeconds) % loopSeconds : raw;

    let total = 0;
    let stageIndex = 0;
    let stageProgress = 0;

    // choose first non-zero stage by default (prevents "stuck at 0" if stage 0 is 0s)
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
    <div className="w-full flex h-4 rounded-2xl overflow-hidden bg-white/10 shadow-inner">
      {(stages || []).map((stage, index) => {
        const durSec = stageSecondsList[index] || 0;
        const width = durSec > 0 ? (durSec / totalStagesSeconds) * 100 : 0;

        if (width <= 0) return null;

        const kind = getStageKind(stage as any);
        const displayName = getDisplayName(stage as any, kind);
        const bg = resolveStageColor(stage as any, kind);
        const labelMins = getStageLabelMinutes(stage);

        // ✅ normalized stage for hover label outside (RoomPage etc.)
        const hoverStage = {
          ...(stage as any),
          // important: override name + color so external UI shows correct title/colors
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
              opacity: isActive ? 1 : 0.8,
            }}
            onMouseEnter={() => onHoverStage?.(hoverStage)}
            onMouseLeave={() => onHoverStage?.(null)}
            title={`${displayName}${labelMins ? ` • ${labelMins} min` : ""}`}
          >
            <div
              className="absolute left-0 top-0 bottom-0 bg-black/15 transition-all"
              style={{ width: progressWidth }}
            />

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
    </div>
  );
}
