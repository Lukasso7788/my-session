import React, { useEffect, useState } from "react";
import { differenceInSeconds } from "date-fns";
import { SessionStage } from "../SessionConfig";

interface Props {
  stages: SessionStage[];
  startTime: string; // ISO string
  onHoverStage?: (stage: SessionStage | null) => void;
}

export function SessionStageBar({ stages, startTime, onHoverStage }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  const totalDuration = stages.reduce((sum, s) => sum + s.duration, 0) * 60; // в секундах

  // 🔁 Обновляем прошедшее время каждую секунду
  useEffect(() => {
    if (!startTime) return;

    const timer = setInterval(() => {
      const diff = differenceInSeconds(new Date(), new Date(startTime));
      setElapsed(diff);
    }, 1000);

    return () => clearInterval(timer);
  }, [startTime]);

  // 🧮 Вычисляем текущую стадию и прогресс
  useEffect(() => {
    let total = 0;
    let stageIndex = stages.length - 1;

    for (let i = 0; i < stages.length; i++) {
      const nextTotal = total + stages[i].duration * 60;
      if (elapsed < nextTotal) {
        stageIndex = i;
        const stageElapsed = elapsed - total;
        const stageProgress = Math.max(
          0,
          Math.min(stageElapsed / (stages[i].duration * 60), 1)
        );
        setProgress(stageProgress);
        break;
      }
      total = nextTotal;
    }

    setCurrentStageIndex(stageIndex);
  }, [elapsed, stages]);

  return (
    <div className="flex w-full h-5 rounded-2xl overflow-hidden bg-slate-200 border border-slate-300 shadow-inner">
      {stages.map((stage, index) => {
        const width = (stage.duration / (totalDuration / 60)) * 100;
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
            ></div>

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
