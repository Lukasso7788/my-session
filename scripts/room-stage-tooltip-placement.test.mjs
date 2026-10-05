import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stageBar = readFileSync(join(root, "src/components/SessionStageBar.tsx"), "utf8");
const roomTopBar = readFileSync(join(root, "src/components/RoomTopBar.tsx"), "utf8");
const sessionCard = readFileSync(join(root, "src/components/SessionCard.tsx"), "utf8");
const joinGate = readFileSync(join(root, "src/components/JoinGateModal.tsx"), "utf8");

test("room tooltips appear below while session cards retain the top default", () => {
  assert.match(stageBar, /tooltipPlacement = "top"/);
  assert.equal([...roomTopBar.matchAll(/tooltipPlacement="bottom"/g)].length, 2);
  assert.doesNotMatch(sessionCard, /tooltipPlacement="bottom"/);
});

test("join gate has no leftover green text accents", () => {
  assert.doesNotMatch(joinGate, /text-\[#(?:4B9A51|36733B|A9EDAD)\]/i);
  assert.match(joinGate, /const accentText = isLight/);
});
