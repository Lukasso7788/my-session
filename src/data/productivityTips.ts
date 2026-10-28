// Productivity tips shown while a person joins a coworking room
// (see src/components/RoomJoiningTip.tsx). Exactly 96, grouped as:
// 1–24 general productivity, 25–36 MySession features and body doubling,
// 37–48 practical focus techniques, 49–72 momentum and mindset,
// 73–84 more MySession habits, 85–96 breaks and energy. Session formats mentioned here must exist
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
  // Momentum & mindset
  "Name the very first action, then do only that.",
  "Set a timer and try to beat it.",
  "Finish one small thing to build momentum.",
  "Pick up where you left off by rereading your last line.",
  "Leave a note for future you before you stop.",
  "Estimate how long a task takes, then check yourself.",
  "Say no to one thing that isn't a priority today.",
  "Answer quick messages together in one short block.",
  "Do the hardest part first while your mind is fresh.",
  "Make the next step so small it feels easy.",
  "Write your goal where you can see it.",
  "Celebrate small wins; they add up.",
  "Decide what you'll ignore during this session.",
  "Rewrite vague tasks as concrete actions.",
  "Clarity comes from doing, not from more planning.",
  "Track your time to see where it really goes.",
  "Block time in your calendar for deep work.",
  "Make the first sentence easy to write.",
  "Keep only the files you need open.",
  "Use full screen to hide everything else.",
  "Ask yourself what would make today a win.",
  "Write a three-item list, not a thirty-item one.",
  "Take one slow breath before you dive in.",
  "Momentum beats motivation, so just begin.",
  // More MySession habits
  "Turn on a soundscape to block out background noise.",
  "Try Gentle rain or Brown Noise for calm focus.",
  "Keep your streak going with one session a day.",
  "Pick your next session time before you leave the room.",
  "Say hello in chat; a quick greeting builds connection.",
  "Post your goal in chat so the room knows your plan.",
  "Cheer others on; encouragement comes back around.",
  "Come back at the same time each day to build a habit.",
  "Mute your mic during focus, unmute for check-ins.",
  "Invite a friend to cowork with you next time.",
  "Before you leave, share what you got done.",
  "Glance at others working when your focus starts to drift.",
  // Breaks & energy
  "Every 20 minutes, look 20 feet away for 20 seconds.",
  "Roll your shoulders and relax your jaw.",
  "Step away from the screen during breaks.",
  "Get some fresh air on your break.",
  "Have a healthy snack before a long session.",
  "Check your posture: feet flat, screen at eye level.",
  "Adjust your lighting to reduce eye strain.",
  "Walk around for a minute to reset your mind.",
  "Don't skip breaks; they keep your focus sharp.",
  "Have caffeine earlier in the day to protect your sleep.",
  "A good night's sleep is the best productivity tool.",
  "End your day by writing down any unfinished loops.",
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
