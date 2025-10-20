// src/SessionConfig.ts

export interface SessionStage {
  name: string;
  type: "focus" | "intentions" | "social";
  duration: number; // in minutes
  color: string;
}

export const defaultSession: SessionStage[] = [
  { name: "Welcome & Greetings", type: "social", duration: 3, color: "#60A5FA" },
  { name: "Intentions (Text)", type: "intentions", duration: 5, color: "#A78BFA" },
  { name: "Intentions (Spoken)", type: "intentions", duration: 5, color: "#C084FC" },
  { name: "Focus Block 1", type: "focus", duration: 25, color: "#34D399" },
  { name: "Break", type: "social", duration: 5, color: "#FBBF24" },
  { name: "Focus Block 2", type: "focus", duration: 25, color: "#34D399" },
  { name: "Celebrate & Farewell", type: "social", duration: 3, color: "#F87171" },
];
