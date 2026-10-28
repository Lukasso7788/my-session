// Productivity tips shown while a person joins a coworking room
// (see src/components/RoomJoiningTip.tsx). Exactly 96, grouped as:
// 1–24 general productivity, 25–36 MySession features and body doubling,
// 37–48 practical focus techniques, 49–72 momentum and mindset,
// 73–84 more MySession habits, 85–96 breaks and energy. Session formats mentioned here must exist
// in the product (25/5 and 50/10 do; 90/20 is no longer offered).
export const PRODUCTIVITY_TIPS = [
  // General productivity
  "Pick one task and give this session to it.",
  "Split a big task into steps you can finish in one session.",
  "Stuck? Commit to just five minutes.",
  "Put your phone out of reach, ideally in another room.",
  "Close every tab this task doesn't need.",
  "Set one goal you can actually finish this session.",
  "Focus on progress, not perfection.",
  "Jot down stray thoughts so your mind can let them go.",
  "Start with the task that matters most.",
  "Turn on Do Not Disturb until your break.",
  "Decide what \"done\" looks like before you start.",
  "Clear your desk of everything this task doesn't need.",
  "Short breaks recharge your attention, so take them.",
  "Stand up and stretch between sessions.",
  "One task at a time beats five at once.",
  "If a task feels overwhelming, shrink it until it doesn't.",
  "Share your tasks with the room to stay accountable.",
  "Rest on your breaks instead of scrolling.",
  "Keep water within reach and sip often.",
  "Lost focus? Just return to your next step.",
  "Write a rough draft first; polish it later.",
  "Batch similar tasks to cut down on switching.",
  "After each session, note what you got done.",
  "Before you finish, write down your next step.",
  // MySession features & body doubling
  "Share your screen for an extra layer of accountability.",
  "Keep your camera on; being seen helps you stay on task.",
  "Pin the Tasks panel to keep your priorities visible.",
  "Use Picture-in-Picture to keep the room with you in other apps.",
  "Add your tasks before the focus block begins.",
  "Check off tasks as you finish them to see your progress.",
  "Need a boost? Visit the Accountability Wall.",
  "Struggling with a task? Tell your room.",
  "Send a reaction to cheer on someone's progress.",
  "Hard to get started? Try a short 25/5 session.",
  "Choose 50/10 for longer stretches of deep work.",
  "Say your goal out loud at check-in; it makes it real.",
  // Practical focus techniques
  "Give yourself a mini-deadline: the end of this session.",
  "Give open-ended tasks a clear finish line.",
  "Keep a \"not now\" list for tempting side quests.",
  "Save interesting links for later instead of opening them now.",
  "Check messages at set times, not every few minutes.",
  "Save your hardest work for your peak energy hours.",
  "Unsure what's needed? Ask before you spend time guessing.",
  "Blocked? Describe the problem in one sentence.",
  "Turn repetitive work into a simple checklist.",
  "Get all your ideas down first, then choose the best.",
  "Notice what keeps pulling you away and remove it.",
  "Low on energy? Shrink the goal, but keep moving.",
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
