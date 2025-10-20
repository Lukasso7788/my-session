import React from "react";
import { SessionStage } from "@/SessionConfig";

interface Props {
  stages: SessionStage[];
  currentStageIndex: number;
  currentStageProgress?: number; // от 0 до 1 — для плавного заполнения активного блока
}

export const SessionStageBar: React.FC<Props> = ({
  stages,
  currentStageIndex,
  currentStageProgress = 0,
}) => {
  const totalDuration = stages.reduce((sum, s) => sum + s.duration, 0);

  const colorByType = (type: string) => {
    switch (type) {
      case "focus":
        return "bg-cyan-500";
      case "intentions-text":
        return "bg-purple-500";
      case "intentions-spoken":
        return "bg-indigo-400";
      case "social":
        return "bg-yellow-400";
      case "break":
        return "bg-gray-500";
      default:
        return "bg-gray-700";
    }
  };

  return (
    <div className="w-full flex h-3 bg-gray-900 rounded-full overflow-hidden mt-4">
      {stages.map((stage, index) => {
        const width = (stage.duration / totalDuration) * 100;
        const isActive = index === currentStageIndex;
        const activeProgress = isActive ? currentStageProgress * 100 : 0;

        return (
          <div
            key={stage.id}
            className={`relative transition-all`}
            style={{ width: `${width}%` }}
          >
            <div
              className={`absolute inset-0 ${colorByType(stage.type)} opacity-40`}
            />
            {isActive && (
              <div
                className={`absolute inset-y-0 left-0 ${colorByType(stage.type)}`}
                style={{ width: `${activeProgress}%` }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
