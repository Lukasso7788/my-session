import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const out = await build({ entryPoints: ["src/lib/hostPrioritySlots.ts"], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
const { prioritySlotsFor } = mod.exports;

// Winter (Kyiv UTC+2) and summer (Kyiv UTC+3) days.
const winter = new Date("2026-01-15T12:00:00Z");
const summer = new Date("2026-07-15T12:00:00Z");

test("priority slots are 06:00-16:00 for someone in Kyiv", () => {
  assert.deepEqual(
    { ...prioritySlotsFor("Europe/Kyiv", winter) },
    { start: "06:00", end: "16:00", timeZone: "Europe/Kyiv", isKyiv: true },
  );
});

test("priority slots are shown in the person's own time", () => {
  assert.equal(prioritySlotsFor("Europe/Berlin", winter).start, "05:00");
  assert.equal(prioritySlotsFor("Europe/Berlin", winter).end, "15:00");
  assert.equal(prioritySlotsFor("Asia/Kolkata", winter).start, "09:30");
  assert.equal(prioritySlotsFor("Asia/Kolkata", summer).start, "08:30");
  assert.equal(prioritySlotsFor("America/New_York", winter).start, "23:00");
  assert.equal(prioritySlotsFor("America/New_York", winter).end, "09:00");
  assert.equal(prioritySlotsFor("UTC", summer).start, "03:00");
  assert.equal(prioritySlotsFor("Europe/Berlin", winter).isKyiv, false);
});

test("an unknown zone falls back instead of throwing", () => {
  assert.doesNotThrow(() => prioritySlotsFor("Not/AZone", winter));
});

test("the sessions page shows notices as a pinned line under the header, not popups", () => {
  const page = readFileSync("src/pages/SessionsPage.tsx", "utf8");
  assert.match(page, /<SessionsNoticeBar/);
  assert.doesNotMatch(page, /<(SupportMySessionModal|HostSessionPromptModal|CommunityPromptModal)\b|components\/(SupportMySessionModal|HostSessionPromptModal|CommunityPromptModal)"/);
  const header = readFileSync("src/components/Header.tsx", "utf8");
  assert.match(header, /id=\{HEADER_NOTICE_SLOT_ID\}/);
});
