import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const out = await build({ entryPoints: ["src/lib/taskAddedAt.ts"], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
const { formatTaskAddedAt } = mod.exports;

const now = new Date(2026, 9, 14, 18, 0);
const at = (daysAgo, h, m) => new Date(2026, 9, 14 - daysAgo, h, m).toISOString();

test("task added-at label is just the time, with the day when it is not today", () => {
  assert.equal(formatTaskAddedAt(at(0, 14, 34), now), "2:34 PM");
  assert.equal(formatTaskAddedAt(at(1, 9, 5), now), "Yesterday, 9:05 AM");
  assert.equal(formatTaskAddedAt(at(2, 9, 10), now), "Oct 12, 9:10 AM");
  assert.equal(formatTaskAddedAt(at(3, 9, 10), now), "Oct 11, 9:10 AM");
  assert.equal(formatTaskAddedAt(at(30, 9, 10), now), "Sep 14, 9:10 AM");
  assert.equal(formatTaskAddedAt(new Date(2025, 0, 2, 8, 0).toISOString(), now), "Jan 2, 2025, 8:00 AM");
  assert.equal(formatTaskAddedAt(null, now), null);
  assert.equal(formatTaskAddedAt("not a date", now), null);
});

test("the room task panel shows the added time only on hover", () => {
  const panel = readFileSync("src/components/TasksPanel.tsx", "utf8");
  const sidebar = readFileSync("src/components/SessionsTasksSidebar.tsx", "utf8");
  assert.match(panel, /const taskAddedAtCls =[\s\S]*max-h-0[\s\S]*opacity-0[\s\S]*group-hover:max-h-4 group-hover:opacity-100/);
  assert.equal((panel.match(/<span className=\{taskAddedAtCls\}>\{formatTaskAddedAt\((i|item)\.created_at\)\}<\/span>/g) || []).length, 2);
  // The Sessions page sidebar keeps its own layout without it.
  assert.doesNotMatch(sidebar, /formatTaskAddedAt/);
});

test("room task rows are dragged by the whole row, with no handle icon", () => {
  const panel = readFileSync("src/components/TasksPanel.tsx", "utf8");
  assert.doesNotMatch(panel, /GripVertical|title="Drag to reorder"/);
  assert.match(panel, /draggable=\{!isEditing && isPersistedTask\}/);
  // The task text is not a <button>, so Safari/Firefox can start a drag on it.
  assert.match(panel, /<div\s+role="button"\s+tabIndex=\{0\}[\s\S]{0,400}openAiTaskSuggestions\(i\)/);
});
