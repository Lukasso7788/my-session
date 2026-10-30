import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const out = await build({ entryPoints: ["src/lib/sessionBookends.ts"], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
const { bookendIssues, bookendIssueMessage, withBookendPhases } = mod.exports;

let n = 0;
const block = (kind, minutes) => ({ id: `b${n++}`, kind, title: kind, minutes });
const makeId = () => `new${n++}`;

test("a flow with goals and progress phases of 2+ minutes passes", () => {
  const flow = [block("intentions", 2), block("focus", 25), block("break", 5), block("focus", 25), block("recap", 2)];
  assert.deepEqual(bookendIssues(flow), []);
  assert.equal(bookendIssueMessage([]), null);
});

test("welcome counts as the opening and celebrate as the closing", () => {
  assert.deepEqual(bookendIssues([block("welcome", 5), block("focus", 50), block("celebrate", 3)]), []);
});

test("a focus-only flow is missing both phases", () => {
  assert.deepEqual(bookendIssues([block("focus", 50)]), ["goals-missing", "progress-missing"]);
  assert.deepEqual(bookendIssues([]), ["goals-missing", "progress-missing"]);
});

test("phases under 2 minutes are too short", () => {
  assert.deepEqual(bookendIssues([block("intentions", 1), block("focus", 25), block("recap", 1)]), ["goals-short", "progress-short"]);
});

test("a recap before the last focus block does not count as the closing", () => {
  assert.deepEqual(bookendIssues([block("intentions", 5), block("recap", 5), block("focus", 25)]), ["progress-missing"]);
});

test("withBookendPhases adds missing phases and stretches short ones", () => {
  const added = withBookendPhases([block("focus", 25)], makeId);
  assert.deepEqual(added.map((b) => b.kind), ["intentions", "focus", "recap"]);
  assert.deepEqual(bookendIssues(added), []);

  const stretched = withBookendPhases([block("intentions", 1), block("focus", 25), block("recap", 1)], makeId);
  assert.deepEqual(stretched.map((b) => b.minutes), [2, 25, 2]);

  const closingOnly = withBookendPhases([block("focus", 25), block("recap", 1)], makeId);
  assert.deepEqual(closingOnly.map((b) => [b.kind, b.minutes]), [["intentions", 5], ["focus", 25], ["recap", 2]]);
});
