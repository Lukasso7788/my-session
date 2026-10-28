import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const out = await build({ entryPoints: ["src/lib/hostTimePicker.ts"], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
const picker = mod.exports;

const card = readFileSync("src/components/SessionCard.tsx", "utf8");
const component = readFileSync("src/components/HostTimePicker.tsx", "utf8");

test("two weeks of days, labelled Today and Tomorrow, months where they start", () => {
  const days = picker.buildHostDayOptions(new Date(2026, 9, 28, 19, 20));
  assert.equal(days.length, 14);
  assert.deepEqual(days.slice(0, 3).map((day) => day.label), ["Today", "Tomorrow", "Fri"]);
  assert.equal(days[0].ymd, "2026-10-28");
  assert.equal(days[0].month, "Oct");
  assert.equal(days[4].ymd, "2026-11-01");
  assert.equal(days[4].month, "Nov");
  assert.equal(days[5].month, null);
  // Just before midnight the first bookable day is tomorrow.
  const late = picker.buildHostDayOptions(new Date(2026, 9, 28, 23, 50));
  assert.equal(late[0].ymd, "2026-10-29");
  assert.equal(late[0].label, "Tomorrow");
});

test("today offers Now and only the half hours ahead; other days all 48", () => {
  const now = new Date(2026, 9, 28, 19, 20);
  const today = picker.buildHostStartTimes("2026-10-28", now);
  assert.deepEqual(today.slice(0, 3).map((option) => [option.hhmm, option.isNow]), [["19:30", true], ["20:00", false], ["20:30", false]]);
  assert.equal(today.at(-1).hhmm, "23:30");
  assert.equal(new Set(today.map((option) => option.hhmm)).size, today.length);
  const odd = picker.buildHostStartTimes("2026-10-28", new Date(2026, 9, 28, 19, 40));
  assert.deepEqual(odd.slice(0, 2).map((option) => option.hhmm), ["19:45", "20:00"]);
  const tomorrow = picker.buildHostStartTimes("2026-10-29", now);
  assert.equal(tomorrow.length, 48);
  assert.ok(tomorrow.every((option) => !option.isNow));
  assert.deepEqual(
    picker.HOST_PERIODS.map((period) => tomorrow.filter((option) => option.period === period.id).length),
    [12, 12, 12, 12],
  );
});

test("a window is the start plus the duration and may run past midnight", () => {
  const window = picker.hostWindowFromDraft("2026-10-28", "23:00", 120);
  assert.equal(window.endMs - window.startMs, 2 * 60 * 60_000);
  assert.equal(new Date(window.endMs).getDate(), 29);
  assert.equal(picker.hostWindowFromDraft("2026-10-28", "", 60), null);
  assert.equal(picker.hostWindowFromDraft("2026-10-28", "25:00", 60), null);
  assert.equal(picker.hostWindowFromDraft("2026-10-28", "10:00", 0), null);
});

test("durations, clock labels and overlaps read the way the picker shows them", () => {
  assert.deepEqual(picker.HOST_DURATION_OPTIONS.map(picker.formatHostDuration), ["30 min", "1 h", "1.5 h", "2 h", "3 h", "4 h", "6 h", "8 h"]);
  assert.equal(picker.HOST_DEFAULT_DURATION_MINUTES, 120);
  assert.equal(picker.formatHostClock("09:00"), "9:00 AM");
  assert.equal(picker.formatHostClock("00:30"), "12:30 AM");
  const busy = [{ startMs: 100, endMs: 200, name: "Maya" }, { startMs: 200, endMs: 300, name: "Leo" }];
  assert.deepEqual(picker.findHostOverlaps(150, 200, busy).map((entry) => entry.name), ["Maya"]);
  assert.deepEqual(picker.findHostOverlaps(0, 100, busy), []);
});

test("the card books the picked window and guards against double clicks", () => {
  assert.match(card, /<HostTimePicker\s/);
  assert.match(card, /hostWindowFromDraft\(bookingDateDraft, bookingStartTimeDraft, bookingDurationDraft\)/);
  assert.match(card, /if \(isSavingHostBooking\) return;/);
  assert.match(card, /disabled=\{isSavingHostBooking\}/);
  assert.match(card, /That time has already passed/);
  assert.doesNotMatch(card, /bookingEndDateDraft|bookingEndTimeDraft/);
  // Times other hosts already cover are marked, and the summary names them.
  assert.match(component, /Someone is already hosting/);
  assert.match(component, /Also hosting then:/);
});
