// src/SessionConfig.ts

export interface SessionStage {
  name: string;
  type: "focus" | "intentions" | "social";
  duration: number; // minutes
  color: string;
}

export interface SessionFormat {
  id: string;
  title: string;
  totalDuration: number;
  stages: SessionStage[];
}

const COLORS = {
  social: "#2563EB", // blue
  intentions: "#9333EA", // purple
  focus: "#10B981", // green
  break: "#F59E0B", // amber
  celebrate: "#EF4444", // red
};

export const sessionFormats: SessionFormat[] = [
  {
    id: "1h-focus",
    title: "1 Hour - Uninterrupted Focus",
    totalDuration: 60,
    stages: [
      { name: "Welcome", type: "social", duration: 2, color: COLORS.social },
      { name: "Intentions", type: "intentions", duration: 3, color: COLORS.intentions },
      { name: "Focus", type: "focus", duration: 53, color: COLORS.focus },
      { name: "Farewell", type: "social", duration: 2, color: COLORS.celebrate },
    ],
  },
  {
    id: "2h-2x50",
    title: "2 Hours - 2x50min Focus Blocks",
    totalDuration: 120,
    stages: [
      { name: "Welcome", type: "social", duration: 3, color: COLORS.social },
      { name: "Intentions", type: "intentions", duration: 5, color: COLORS.intentions },
      { name: "Focus Block 1", type: "focus", duration: 50, color: COLORS.focus },
      { name: "Break", type: "social", duration: 10, color: COLORS.break },
      { name: "Focus Block 2", type: "focus", duration: 50, color: COLORS.focus },
      { name: "Celebrate", type: "social", duration: 2, color: COLORS.celebrate },
    ],
  },
  {
    id: "1h-pomodoro",
    title: "1 Hour - Pomodoro 25/5",
    totalDuration: 60,
    stages: [
      { name: "Welcome", type: "social", duration: 2, color: COLORS.social },
      { name: "Focus 1", type: "focus", duration: 25, color: COLORS.focus },
      { name: "Break 1", type: "social", duration: 5, color: COLORS.break },
      { name: "Focus 2", type: "focus", duration: 25, color: COLORS.focus },
      { name: "Farewell", type: "social", duration: 3, color: COLORS.celebrate },
    ],
  },
  {
    id: "2h-pomodoro",
    title: "2 Hours - Pomodoro 25/5",
    totalDuration: 120,
    stages: [
      { name: "Welcome", type: "social", duration: 3, color: COLORS.social },
      { name: "Focus 1", type: "focus", duration: 25, color: COLORS.focus },
      { name: "Break 1", type: "social", duration: 5, color: COLORS.break },
      { name: "Focus 2", type: "focus", duration: 25, color: COLORS.focus },
      { name: "Break 2", type: "social", duration: 5, color: COLORS.break },
      { name: "Focus 3", type: "focus", duration: 25, color: COLORS.focus },
      { name: "Break 3", type: "social", duration: 5, color: COLORS.break },
      { name: "Focus 4", type: "focus", duration: 25, color: COLORS.focus },
      { name: "Farewell", type: "social", duration: 2, color: COLORS.celebrate },
    ],
  },
  {
    id: "1h-pomodoro-15",
    title: "1 Hour - Pomodoro 15/3",
    totalDuration: 60,
    stages: [
      { name: "Welcome", type: "social", duration: 2, color: COLORS.social },
      { name: "Focus 1", type: "focus", duration: 15, color: COLORS.focus },
      { name: "Break 1", type: "social", duration: 3, color: COLORS.break },
      { name: "Focus 2", type: "focus", duration: 15, color: COLORS.focus },
      { name: "Break 2", type: "social", duration: 3, color: COLORS.break },
      { name: "Focus 3", type: "focus", duration: 15, color: COLORS.focus },
      { name: "Farewell", type: "social", duration: 2, color: COLORS.celebrate },
    ],
  },
];

export const getSessionFormatById = (id: string): SessionFormat | null => {
  return sessionFormats.find((f) => f.id === id) || null;
};
