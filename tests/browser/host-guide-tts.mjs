// Generates the spoken lines of the host guide walkthrough with OpenAI TTS.
// Local, one-off: run `node tests/browser/host-guide-tts.mjs` after putting
// OPENAI_API_KEY in .env.tts.local (git-ignored) or the environment.
// Writes mp3 files and a manifest to tests/browser/host-guide-audio/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../../", import.meta.url);
const outDir = new URL("tests/browser/host-guide-audio/", root);

function readKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  const file = new URL(".env.tts.local", root);
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => /^\s*OPENAI_API_KEY\s*=/.test(l));
  return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : "";
}

// Each speaker gets their own voice and a short direction for a natural,
// relaxed "video call" delivery (gpt-4o-mini-tts follows these instructions).
const SPEAKERS = {
  Anna: { voice: "coral", style: "A warm, friendly host opening a casual online focus session. Relaxed and natural, smiling, a normal conversational pace. Not an announcer." },
  Maya: { voice: "shimmer", style: "A friendly coworker answering briefly on a video call. Casual, natural, a little upbeat." },
  Alex: { voice: "ash", style: "A calm, friendly guy giving a quick honest update on a video call. Natural and relaxed, slightly tired but positive." },
  Jo: { voice: "echo", style: "A friendly guy on a video call, brief and relaxed." },
};

// Keep in sync with the `says` lines in host-guide.tsx.
const LINES = [
  ["Anna", "Hi Maya, hi Jo, hi Alex! Welcome, everyone. Goals first, then 50 minutes of focus with mics off, a break, another 50, and a recap."],
  ["Anna", "I'll go first: finishing the onboarding email. Maya, how about you?"],
  ["Maya", "Drafting the Q4 roadmap intro."],
  ["Anna", "Nice. Alex, how about you?"],
  ["Alex", "Outlining the body doubling guide."],
  ["Anna", "I'm putting on some music. If it bothers you or you don't need it, use the Mute button next to Music in the bottom right corner. You can turn it back on there too."],
  ["Anna", "Quick check-in before the break. Alex, how did that block go?"],
  ["Alex", "Halfway there, stuck on the second section."],
  ["Anna", "Maya, how about you?"],
  ["Maya", "Pretty good, the intro is almost done."],
  ["Anna", "Let's wrap up. Maya, how did it go? What did you get done?"],
  ["Maya", "I finished the intro draft! Next step is getting feedback."],
  ["Anna", "Love it. Thanks, everyone, great session. See you tomorrow!"],
];

export function audioFileFor(speaker, text) {
  return `${speaker.toLowerCase()}-${createHash("sha1").update(`${speaker}|${text}`).digest("hex").slice(0, 10)}.mp3`;
}

const key = readKey();
if (!key) {
  console.error("Missing OPENAI_API_KEY. Put it in .env.tts.local (OPENAI_API_KEY=...) or the environment.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const manifest = {};
for (const [speaker, text] of LINES) {
  const file = audioFileFor(speaker, text);
  manifest[`${speaker}|${text}`] = file;
  const target = new URL(file, outDir);
  if (existsSync(target)) {
    console.log(`skip  ${file}`);
    continue;
  }
  const { voice, style } = SPEAKERS[speaker];
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, instructions: style, response_format: "mp3" }),
  });
  if (!response.ok) {
    console.error(`fail  ${file}: ${response.status} ${(await response.text()).slice(0, 300)}`);
    process.exit(1);
  }
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  console.log(`made  ${file}  (${speaker}, ${voice})`);
}
writeFileSync(new URL("manifest.json", outDir), JSON.stringify(manifest, null, 2));
console.log(`Done: ${Object.keys(manifest).length} lines in tests/browser/host-guide-audio/`);
