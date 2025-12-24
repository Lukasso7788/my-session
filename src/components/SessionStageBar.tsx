import React, { useEffect, useMemo, useState } from "react";
import { differenceInSeconds } from "date-fns";

export type SessionStage = {
  name: string;
  duration: number; // minutes
  color: string;
  type?: string;
};

interface Props {
  stages: SessionStage[];
  startTime: string; // ISO string (anchor)
  onHoverStage?: (stage: SessionStage | null) => void;

  /**
   * ✅ NEW:
   * cycle=true  -> infinite rooms (progress loops forever)
   * cycle=false -> normal scheduled session (linear)
   */
  cycle?: boolean;
}

export function SessionStageBar({ stages, startTime, onHoverStage, cycle = false }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  const totalDurationSec = useMemo(() => {
    const totalMin = stages.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
    return Math.max(1, totalMin * 60);
  }, [stages]);

  // 🔁 Обновляем прошедшее время каждую секунду
  useEffect(() => {
    if (!startTime) return;

    const timer = setInterval(() => {
      const diff = differenceInSeconds(new Date(), new Date(startTime));
      // если startTime в будущем — не уходим в минус
      setElapsed(Math.max(0, diff));
    }, 1000);

    return () => clearInterval(timer);
  }, [startTime]);

  const effectiveElapsed = useMemo(() => {
    if (!cycle) return elapsed;
    // модуль по totalDurationSec, чтобы бар крутился по кругу
    const mod = elapsed % totalDurationSec;
    return (mod + totalDurationSec) % totalDurationSec;
  }, [elapsed, cycle, totalDurationSec]);

  // 🧮 Вычисляем текущую стадию и прогресс
  useEffect(() => {
    if (!stages?.length) {
      setCurrentStageIndex(0);
      setProgress(0);
      return;
    }

    let total = 0;
    let stageIndex = stages.length - 1;
    let stageProgress = 0;

    for (let i = 0; i < stages.length; i++) {
      const durSec = (Number(stages[i].duration) || 0) * 60;
      const nextTotal = total + durSec;

      if (effectiveElapsed < nextTotal) {
        stageIndex = i;
        const stageElapsed = effectiveElapsed - total;
        stageProgress = durSec > 0 ? Math.max(0, Math.min(stageElapsed / durSec, 1)) : 0;
        break;
      }

      total = nextTotal;
    }

    setCurrentStageIndex(stageIndex);
    setProgress(stageProgress);
  }, [effectiveElapsed, stages]);

  // guard
  if (!stages?.length) {
    return <div className="flex w-full h-5 rounded-2xl overflow-hidden bg-slate-200 shadow-inner" />;
  }

  return (
    <div className="flex w-full h-5 rounded-2xl overflow-hidden bg-slate-200 shadow-inner">
      {stages.map((stage, index) => {
        const stageSec = (Number(stage.duration) || 0) * 60;
        const width = (stageSec / totalDurationSec) * 100;
        const isActive = index === currentStageIndex;

        const progressWidth = isActive ? `${progress * 100}%` : index < currentStageIndex ? "100%" : "0%";

        return (
          <div
            key={index}
            className="relative h-full group cursor-pointer transition-all duration-300"
            style={{
              width: `${width}%`,
              backgroundColor: stage.color,
              opacity: isActive ? 1 : 0.8,
            }}
            onMouseEnter={() => onHoverStage?.(stage)}
            onMouseLeave={() => onHoverStage?.(null)}
          >
            {/* Прогресс активной стадии */}
            <div
              className="absolute left-0 top-0 bottom-0 bg-black/15 transition-all"
              style={{ width: progressWidth }}
            />

            {/* Tooltip */}
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
