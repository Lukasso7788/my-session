import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [resolve("src/lib/taskBlocks.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { focusBlocksFromStages, taskBlocksStorageKey } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

const resolveKind = (stage) => ({ kind: stage.kind, name: stage.name });

test("focus blocks are numbered in flow order, keeping custom names", () => {
  const blocks = focusBlocksFromStages(
    [
      { kind: "intentions", name: "Intentions" },
      { kind: "focus", name: "Focus" },
      { kind: "break", name: "Break" },
      { kind: "focus", name: "Deep writing" },
      { kind: "break", name: "Break" },
      { kind: "focus", name: "Focus block 3" },
    ],
    resolveKind,
  );
  assert.deepEqual(blocks, [
    { stageIndex: 1, label: "Focus 1" },
    { stageIndex: 3, label: "Deep writing" },
    { stageIndex: 5, label: "Focus 3" },
  ]);
});

test("plans are kept per session and per person", () => {
  assert.notEqual(taskBlocksStorageKey("s1", "u1"), taskBlocksStorageKey("s2", "u1"));
  assert.notEqual(taskBlocksStorageKey("s1", "u1"), taskBlocksStorageKey("s1", "u2"));
});

test("the room passes focus blocks only outside infinite rooms, and unplanned rows keep their height", () => {
  const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");
  assert.match(room, /isInfiniteRoom \? \[\] : focusBlocksFromStages\(/);
  assert.match(room, /focusBlocks=\{taskFocusBlocks\}/);
  const panel = readFileSync("src/components/TasksPanel.tsx", "utf8");
  assert.match(panel, /taskBlocks\[i\.id\] != null \|\| blockPickerTaskId === i\.id/);
  assert.match(panel, /Plan for a focus block/);
});
