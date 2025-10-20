import React from "react";
import { SessionStage } from "../SessionConfig";

interface Props {
  stages: SessionStage[];
  currentStageIndex: number;
  currentStageProgress: number;
}

export function SessionStageBar({
  stages,
  currentStageIndex,
  currentStageProgress,
}: Props) {
  const totalDuration = stages.reduce((sum, s) => sum + s.duration, 0);

  return (
    <div className="flex w-full h-6 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shadow-inner">
      {stages.map((stage, index) => {
        const width = (stage.duration / totalDuration) * 100;
        const isActive = index === currentStageIndex;

        const progressWidth = isActive ? `${currentStageProgress * 100}%` : index < currentStageIndex ? "100%" : "0%";

        return (
          <div
            key={index}
            className="relative h-full transition-all duration-500 ease-in-out"
            style={{ width: `${width}%`, backgroundColor: stage.color }}
          >
            {/* Progress overlay */}
            <div
              className="absolute left-0 top-0 bottom-0 bg-slate-700/20 transition-all"
              style={{ width: progressWidth }}
            ></div>

            {/* Label */}
            <div className="absolute inset-0 flex items-center justify-center text-[10px] sm:text-xs text-slate-700 font-medium whitespace-nowrap">
              {stage.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
