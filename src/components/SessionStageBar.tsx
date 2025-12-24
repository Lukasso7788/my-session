// src/components/SessionStageBar.tsx
import React, { useEffect, useMemo, useState } from "react";
import { differenceInSeconds } from "date-fns";
import { SessionStage } from "../SessionConfig";

interface Props {
  stages: SessionStage[];
  startTime: string; // ISO string
  onHoverStage?: (stage: SessionStage | null) => void;

  /**
   * ✅ NEW:
   * If provided (>0), the bar becomes "infinite" and loops every cycleSeconds.
   * Example: 50/5/5 => 3600 seconds.
   */
  cycleSeconds?: number;
}

export function SessionStageBar({ stages, startTime, onHoverStage, cycleSeconds }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  const totalStagesSeconds = useMemo(() => {
    const sum = stages.reduce((acc, s) => acc + (Number(s.duration) || 0) * 60, 0);
    return Math.max(1, sum);
  }, [stages]);

  const loopSeconds = useMemo(() => {
    const cs = Number(cycleSeconds) || 0;
    // Looping uses cycleSeconds when present, otherwise uses the sum of stages.
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
    let stageIndex = stages.length - 1;
    let stageProgress = 0;

    for (let i = 0; i < stages.length; i++) {
      const durSec = (Number(stages[i].duration) || 0) * 60;
      const nextTotal = total + durSec;

      if (normalized < nextTotal) {
        stageIndex = i;
        const stageElapsed = normalized - total;
        stageProgress = durSec > 0 ? Math.max(0, Math.min(stageElapsed / durSec, 1)) : 0;
        break;
      }

      total = nextTotal;
    }

    setCurrentStageIndex(stageIndex);
    setProgress(stageProgress);
  }, [elapsed, stages, loopSeconds]);

  return (
    <div className="flex w-full h-5 rounded-2xl overflow-hidden bg-slate-200 shadow-inner">
      {stages.map((stage, index) => {
        const durSec = (Number(stage.duration) || 0) * 60;

        // ✅ widths are always based on stages sum -> no "white gap" when cycleSeconds differs
        const width = (durSec / totalStagesSeconds) * 100;

        const isActive = index === currentStageIndex;
        const progressWidth = isActive
          ? `${progress * 100}%`
          : index < currentStageIndex
            ? "100%"
            : "0%";

        return (
          <div
            key={index}
            className="relative h-full group cursor-pointer transition-all duration-300"
            style={{
              width: `${width}%`,
              backgroundColor: (stage as any).color,
              opacity: isActive ? 1 : 0.8,
            }}
            onMouseEnter={() => onHoverStage?.(stage)}
            onMouseLeave={() => onHoverStage?.(null)}
          >
            <div
              className="absolute left-0 top-0 bottom-0 bg-black/15 transition-all"
              style={{ width: progressWidth }}
            />

            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center">
              <div className="bg-slate-900 text-white text-[11px] px-2 py-1 rounded-md shadow-lg whitespace-nowrap">
                {stage.name} • {stage.duration} min
              </div>
              <div className="w-2 h-2 bg-slate-900 rotate-45 mt-[-3px]" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
