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
  'Define what "done" looks like before starting.',
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
  "Set a mini-deadline for the end of this session.",
  "Give open-ended tasks a clear stopping point.",
  'Keep a "not now" list for tempting side quests.',
  "Save useful links instead of chasing them immediately.",
  "Check messages at planned times, not constantly.",
  "Do demanding work when your energy is highest.",
  "Ask for clarification before wasting time guessing.",
  "If you're stuck, describe the problem in one sentence.",
  "Turn repetitive work into a simple checklist.",
  "Write down your ideas first, then decide which ones to use.",
  "Notice what distracts you and remove its trigger.",
  "Adjust your goal when energy is low, but keep moving.",
];

test("exactly the 48 requested tips, verbatim and without duplicates", () => {
  assert.equal(PRODUCTIVITY_TIPS.length, 48);
  assert.deepEqual([...PRODUCTIVITY_TIPS], EXPECTED);
  assert.equal(new Set(PRODUCTIVITY_TIPS.map((tip) => tip.toLowerCase())).size, 48);
  for (const tip of PRODUCTIVITY_TIPS) assert.doesNotMatch(tip, /90\s*\/\s*20/);
});

test("first pick is uniform over all 48 tips", () => {
  const seen = new Set();
  for (let i = 0; i < 48; i++) seen.add(pickProductivityTipIndex(null, () => (i + 0.5) / 48));
  assert.equal(seen.size, 48);
  assert.equal(pickProductivityTipIndex(null, () => 0), 0);
  assert.equal(pickProductivityTipIndex(null, () => 0.999999999), 47);
});

test("a repeat-avoiding pick is uniform over the other 47 and never repeats", () => {
  for (const previous of [0, 17, 47]) {
    const seen = new Set();
    for (let i = 0; i < 47; i++) seen.add(pickProductivityTipIndex(previous, () => (i + 0.5) / 47));
    assert.equal(seen.size, 47, `previous ${previous}`);
    assert.ok(!seen.has(previous));
    assert.ok([...seen].every((index) => index >= 0 && index < 48));
  }
  // Statistical sanity with the real generator.
  const counts = new Array(48).fill(0);
  let previous = null;
  for (let i = 0; i < 48_000; i++) {
    const next = pickProductivityTipIndex(previous);
    assert.notEqual(next, previous);
    counts[next] += 1;
    previous = next;
  }
  for (const count of counts) assert.ok(count > 700 && count < 1300, `count ${count}`);
});

test("joining screen shows label, one tip and the connection status, accessibly", () => {
  const html = renderToStaticMarkup(createElement(RoomJoiningTip, { theme: "dark", status: "Connecting to room..." }));
  assert.match(html, /<p class="ms-room-joining-tip-label">Productivity tip<\/p>/);
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
