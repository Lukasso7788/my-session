import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tasksPanel = readFileSync(join(root, "src/components/TasksPanel.tsx"), "utf8");
const roomPage = readFileSync(join(root, "src/pages/RoomPageLiveKit.tsx"), "utf8");

test("Tasks video PiP keeps the Short Sprints green in both panel themes", () => {
  const start = tasksPanel.indexOf("{pictureInPictureSupported && onOpenPictureInPicture ? (");
  const end = tasksPanel.indexOf(") : null}", start);
  assert.ok(start >= 0 && end > start, "Tasks video PiP button exists");
  const pipButton = tasksPanel.slice(start, end);
  assert.match(pipButton, /border-\[#81DB86\].*bg-\[#81DB86\]/);
  assert.match(pipButton, /tint="#81DB86"/);
});

test("every Tasks header icon path resolves to a visible SVG", () => {
  const sources = [...roomPage.matchAll(/"(\/icons\/tasks(?:-light|-dark)?\.svg)"/g)].map((match) => match[1]);
  assert.ok(sources.length >= 2, "light and dark Tasks icons are referenced");
  for (const source of sources) {
    const path = join(root, "public", source.slice(1));
    assert.ok(existsSync(path), `${source} must exist`);
    assert.match(readFileSync(path, "utf8"), /fill="(?:white|#(?:fff|ffffff|2f2f2f))"/i);
  }
});
