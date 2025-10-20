// src/SessionConfig.ts

export interface SessionStage {
  name: string;
  type: "focus" | "intentions" | "social";
  duration: number; // minutes
  color: string;
}

export const defaultSession: SessionStage[] = [
  { name: "Welcome & Greetings", type: "social", duration: 3, color: "#E0E7FF" }, // soft indigo
  { name: "Intentions (Text)", type: "intentions", duration: 5, color: "#F3E8FF" }, // light purple
  { name: "Intentions (Spoken)", type: "intentions", duration: 5, color: "#F5F3FF" }, // lilac
  { name: "Focus Block 1", type: "focus", duration: 25, color: "#DCFCE7" }, // soft green
  { name: "Break", type: "social", duration: 5, color: "#FEF9C3" }, // soft yellow
  { name: "Focus Block 2", type: "focus", duration: 25, color: "#BBF7D0" }, // pastel green
  { name: "Celebrate & Farewell", type: "social", duration: 3, color: "#FEE2E2" }, // soft red
];
