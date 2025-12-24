// src/components/SessionStageBar.tsx
import React, { useEffect, useMemo, useState } from "react";
import { differenceInSeconds } from "date-fns";
import { SessionStage } from "../SessionConfig";

interface Props {
  stages: SessionStage[];
  startTime: string; // ISO string
  onHoverStage?: (stage: SessionStage | null) => void;

  /**
   * If provided (>0), the bar becomes "infinite" and loops every cycleSeconds.
   */
  cycleSeconds?: number;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
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

  // 🔁 Update elapsed every second
  useEffect(() => {
    if (!startTime) return;

    const timer = window.setInterval(() => {
      const diff = differenceInSeconds(new Date(), new Date(startTime));
      setElapsed(diff);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [startTime]);

  // 🧮 Current stage + progress (supports infinite loop)
  useEffect(() => {
    if (!stages?.length) {
      setCurrentStageIndex(0);
      setProgress(0);
      return;
    }

    // normalize elapsed into [0..loopSeconds)
    const raw = elapsed;
    const normalized =
      loopSeconds > 0 ? ((raw % loopSeconds) + loopSeconds) % loopSeconds : raw;

    let total = 0;
    let stageIndex = 0;
    let stageProgress = 0;

    // If some stages have 0 seconds, we still want stable behavior.
    // We'll skip zero durations for progress calc, but widths will handle it too.
    for (let i = 0; i < stages.length; i++) {
      const durSec = stageSecondsList[i] || 0;
      const nextTotal = total + durSec;

      if (durSec <= 0) {
        // zero-length stage -> just skip it in time accounting
        // (still can be rendered with 0 width)
        continue;
      }

      if (normalized < nextTotal) {
        stageIndex = i;
        const stageElapsed = normalized - total;
        stageProgress = durSec > 0 ? clamp(stageElapsed / durSec, 0, 1) : 0;
        break;
      }

      total = nextTotal;
      stageIndex = i; // fallback: last non-zero stage
    }

    setCurrentStageIndex(stageIndex);
    setProgress(stageProgress);
  }, [elapsed, stages, loopSeconds, stageSecondsList]);

  return (
    <div className="w-full flex h-4 rounded-2xl overflow-hidden bg-white/10 shadow-inner">
      {stages.map((stage, index) => {
        const durSec = stageSecondsList[index] || 0;

        // ✅ widths are always based on stages sum (not cycleSeconds)
        const width = durSec > 0 ? (durSec / totalStagesSeconds) * 100 : 0;

        const isActive = index === currentStageIndex;
        const progressWidth = isActive
          ? `${progress * 100}%`
          : index < currentStageIndex
            ? "100%"
            : "0%";

        const bg = (stage as any).color || "#4CA0FF";

        // If stage has 0 duration -> don't render it (prevents "thin white separators")
        if (width <= 0) return null;

        const labelMins = getStageLabelMinutes(stage);

        return (
          <div
            key={index}
            className="relative h-full group cursor-pointer transition-all duration-300"
            style={{
              width: `${width}%`,
              backgroundColor: bg,
              opacity: isActive ? 1 : 0.8,
            }}
            onMouseEnter={() => onHoverStage?.(stage)}
            onMouseLeave={() => onHoverStage?.(null)}
          >
            {/* progress shade */}
            <div
              className="absolute left-0 top-0 bottom-0 bg-black/15 transition-all"
              style={{ width: progressWidth }}
            />

            {/* tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center z-50">
              <div className="bg-slate-900 text-white text-[11px] px-2 py-1 rounded-md shadow-lg whitespace-nowrap">
                {stage.name}
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
