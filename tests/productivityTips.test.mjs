import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");

async function load(file, replaceCss = []) {
  let contents = readFileSync(file, "utf8");
  for (const css of replaceCss) contents = contents.replace(`import "${css}";`, "");
  const out = await build({ stdin: { contents, loader: "tsx", resolveDir: new URL("../src/components", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") }, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", write: false, logLevel: "silent", plugins: [{ name: "no-css", setup(b) { b.onResolve({ filter: /\.css$/ }, () => ({ path: "css", namespace: "css" })); b.onLoad({ filter: /.*/, namespace: "css" }, () => ({ contents: "", loader: "js" })); } }] });
  const mod = { exports: {} };
  new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
  return mod.exports;
}

const { PRODUCTIVITY_TIPS, pickProductivityTipIndex } = await load("src/data/productivityTips.ts");
const RoomJoiningTip = (await load("src/components/RoomJoiningTip.tsx")).default;
const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");

// The requested collection, verbatim (text and punctuation).
const EXPECTED = [
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
  'Decide what "done" looks like before you start.',
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
  "Give yourself a mini-deadline: the end of this session.",
  "Give open-ended tasks a clear finish line.",
  'Keep a "not now" list for tempting side quests.',
  "Save interesting links for later instead of opening them now.",
  "Check messages at set times, not every few minutes.",
  "Save your hardest work for your peak energy hours.",
  "Unsure what's needed? Ask before you spend time guessing.",
  "Blocked? Describe the problem in one sentence.",
  "Turn repetitive work into a simple checklist.",
  "Get all your ideas down first, then choose the best.",
  "Notice what keeps pulling you away and remove it.",
  "Low on energy? Shrink the goal, but keep moving.",
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
];

test("exactly the 96 requested tips, verbatim and without duplicates", () => {
  assert.equal(PRODUCTIVITY_TIPS.length, 96);
  assert.deepEqual([...PRODUCTIVITY_TIPS], EXPECTED);
  assert.equal(new Set(PRODUCTIVITY_TIPS.map((tip) => tip.toLowerCase())).size, 96);
  for (const tip of PRODUCTIVITY_TIPS) assert.doesNotMatch(tip, /90\s*\/\s*20/);
});

test("first pick is uniform over all 96 tips", () => {
  const seen = new Set();
  for (let i = 0; i < 96; i++) seen.add(pickProductivityTipIndex(null, () => (i + 0.5) / 96));
  assert.equal(seen.size, 96);
  assert.equal(pickProductivityTipIndex(null, () => 0), 0);
  assert.equal(pickProductivityTipIndex(null, () => 0.999999999), 95);
});

test("a repeat-avoiding pick is uniform over the other 95 and never repeats", () => {
  for (const previous of [0, 17, 47, 95]) {
    const seen = new Set();
    for (let i = 0; i < 95; i++) seen.add(pickProductivityTipIndex(previous, () => (i + 0.5) / 95));
    assert.equal(seen.size, 95, `previous ${previous}`);
    assert.ok(!seen.has(previous));
    assert.ok([...seen].every((index) => index >= 0 && index < 96));
  }
  // Statistical sanity with the real generator.
  const counts = new Array(96).fill(0);
  let previous = null;
  for (let i = 0; i < 96_000; i++) {
    const next = pickProductivityTipIndex(previous);
    assert.notEqual(next, previous);
    counts[next] += 1;
    previous = next;
  }
  for (const count of counts) assert.ok(count > 700 && count < 1300, `count ${count}`);
});

test("joining screen shows one tip (no label) and the connection status, accessibly", () => {
  const html = renderToStaticMarkup(createElement(RoomJoiningTip, { theme: "dark", status: "Connecting to room..." }));
  assert.doesNotMatch(html, /Productivity tip|ms-room-joining-tip-label/i);
  const tip = html.match(/<p class="ms-room-joining-tip-text">([^<]*)<\/p>/)[1].replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
  assert.ok(EXPECTED.includes(tip), tip);
  // The loader stays the announcer for the connection state.
  assert.match(html, /role="status" aria-live="polite"><span class="ms-room-joining-accessible">Connecting to room\.\.\.<\/span>/);
  assert.match(html, /<span class="ms-room-joining-word" aria-hidden="true">Connecting to room\.\.\.<\/span>/);
});

test("one tip per mount: picked in a useState initializer, remembered only in memory", () => {
  const source = readFileSync("src/components/RoomJoiningTip.tsx", "utf8");
  assert.match(source, /const \[tipIndex\] = useState\(\(\) => pickProductivityTipIndex\(lastShownTipIndex\)\);/);
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*lastShownTipIndex = tipIndex;[\s\S]*\}, \[tipIndex\]\);/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|setInterval|setTimeout/);
  // The room mounts it only while joining and does not key it on anything that
  // changes during one attempt.
  assert.doesNotMatch(room, /<RoomJoiningTip[^>]*key=/);
});
