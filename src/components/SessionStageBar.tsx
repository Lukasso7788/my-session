import React, { useEffect, useMemo, useState } from "react";
import { differenceInSeconds } from "date-fns";
import { SessionStage } from "../SessionConfig";

interface Props {
  stages: SessionStage[];
  startTime: string; // ISO string
  onHoverStage?: (stage: SessionStage | null) => void;
  cycle?: boolean; // ✅ NEW: for infinite rooms
}

export function SessionStageBar({ stages, startTime, onHoverStage, cycle = false }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  const totalDurationSec = useMemo(() => {
    if (!stages?.length) return 0;
    const sumMinutes = stages.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
    return Math.max(0, sumMinutes * 60);
  }, [stages]);

  useEffect(() => {
    if (!startTime) return;

    const timer = setInterval(() => {
      const diff = differenceInSeconds(new Date(), new Date(startTime));
      setElapsed(diff);
    }, 1000);

    return () => clearInterval(timer);
  }, [startTime]);

  const effectiveElapsed = useMemo(() => {
    if (!totalDurationSec) return 0;
    if (!cycle) return Math.max(0, elapsed);
    const mod = ((elapsed % totalDurationSec) + totalDurationSec) % totalDurationSec;
    return mod;
  }, [elapsed, totalDurationSec, cycle]);

  useEffect(() => {
    if (!stages?.length || !totalDurationSec) {
      setCurrentStageIndex(0);
      setProgress(0);
      return;
    }

    let total = 0;
    let stageIndex = stages.length - 1;
    let nextProgress = 0;

    for (let i = 0; i < stages.length; i++) {
      const durSec = (Number(stages[i].duration) || 0) * 60;
      const nextTotal = total + durSec;

      if (effectiveElapsed < nextTotal) {
        stageIndex = i;

        const stageElapsed = effectiveElapsed - total;
        nextProgress = durSec > 0 ? Math.max(0, Math.min(stageElapsed / durSec, 1)) : 0;

        break;
      }
      total = nextTotal;
    }

    setCurrentStageIndex(stageIndex);
    setProgress(nextProgress);
  }, [effectiveElapsed, stages, totalDurationSec]);

  if (!stages?.length || !totalDurationSec) return null;

  return (
    <div className="flex w-full h-5 rounded-2xl overflow-hidden bg-slate-200 shadow-inner">
      {stages.map((stage, index) => {
        const durMin = Number(stage.duration) || 0;
        const width = totalDurationSec > 0 ? ((durMin * 60) / totalDurationSec) * 100 : 0;
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
              backgroundColor: (stage as any).color || "#CBD5E1",
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
                {(stage as any).name} • {durMin} min
              </div>
              <div className="w-2 h-2 bg-slate-900 rotate-45 mt-[-3px]" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
