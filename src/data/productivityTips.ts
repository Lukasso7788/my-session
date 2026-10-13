// Productivity tips shown while a person joins a coworking room
// (see src/components/RoomJoiningTip.tsx). Exactly 48, grouped as:
// 1–24 general productivity, 25–36 MySession features and body doubling,
// 37–48 practical focus techniques. Session formats mentioned here must exist
// in the product (25/5 and 50/10 do; 90/20 is no longer offered).
export const PRODUCTIVITY_TIPS = [
  // General productivity
  "Choose one task to focus on this session.",
  "Break big tasks into smaller, manageable steps.",
  "Start with just five minutes if you're stuck.",
  "Put your phone out of reach while working.",
  "Close unnecessary tabs to reduce distractions.",
  "Set a clear, achievable goal for this session.",
  "Focus on progress, not perfection.",
  "Write down distracting thoughts for later.",
  "Tackle your most important task first.",
  "Silence notifications during your focus time.",
  "Define what \"done\" looks like before starting.",
  "Keep your workspace clean and distraction-free.",
  "Take short breaks to recharge your attention.",
  "Stand up and stretch between focus sessions.",
  "Work on one task at a time, not five.",
  "Turn overwhelming tasks into tiny actions.",
  "Share your tasks to stay accountable.",
  "Use your breaks to rest, not just scroll.",
  "Keep a glass of water within reach.",
  "When you lose focus, return to your next step.",
  "Start with a rough draft; improve it later.",
  "Batch similar tasks to avoid constant switching.",
  "Review what you accomplished after each session.",
  "Plan your next step before ending your session.",
  // MySession features & body doubling
  "Share your screen for greater accountability.",
  "Keep your camera on for better focus.",
  "Pin the Tasks panel to keep your priorities visible.",
  "Use Picture-in-Picture to stay motivated by others' presence.",
  "Add your tasks before starting your focus block.",
  "Check off completed tasks to make progress visible.",
  "Visit the Accountability Wall for a little motivation.",
  "Tell your room when you're struggling with a task.",
  "Give someone a reaction to encourage their progress.",
  "Try a 25/5 session when getting started feels difficult.",
  "Choose 50/10 for a steady deep-work rhythm.",
  "Use verbal check-ins to stay accountable and motivated.",
  // Practical focus techniques
  "Set a mini-deadline for the end of this session.",
  "Give open-ended tasks a clear stopping point.",
  "Keep a \"not now\" list for tempting side quests.",
  "Save useful links instead of chasing them immediately.",
  "Check messages at planned times, not constantly.",
  "Do demanding work when your energy is highest.",
  "Ask for clarification before wasting time guessing.",
  "If you're stuck, describe the problem in one sentence.",
  "Turn repetitive work into a simple checklist.",
  "Write down your ideas first, then decide which ones to use.",
  "Notice what distracts you and remove its trigger.",
  "Adjust your goal when energy is low, but keep moving.",
] as const;

/**
 * Index of a random tip. Without `previousIndex` every tip is equally likely;
 * with it, the choice is uniform among the other tips so the same tip never
 * shows twice in a row. `random` must return a number in [0, 1).
 */
export function pickProductivityTipIndex(
  previousIndex: number | null = null,
  random: () => number = Math.random,
  count: number = PRODUCTIVITY_TIPS.length,
): number {
  const hasPrevious =
    previousIndex !== null && Number.isInteger(previousIndex) && previousIndex >= 0 && previousIndex < count && count > 1;
  const choices = hasPrevious ? count - 1 : count;
  const slot = Math.min(choices - 1, Math.floor(random() * choices));
  // Skip over the previous index so the remaining tips keep equal odds.
  return hasPrevious && slot >= previousIndex ? slot + 1 : slot;
}
