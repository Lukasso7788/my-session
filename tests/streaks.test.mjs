import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

async function importTs(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { computeStreaks, utcDateKey } = await importTs("src/lib/streaks.ts");
const today = "2026-10-14"; // Wednesday, same fixture as the SQL tests

test("daily: current run through today, longest from an older run", () => {
  const days = ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14",
    "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08", "2026-05-09", "2026-05-10"];
  const s = computeStreaks(days, today);
  assert.deepEqual(s.streaks.day, { current: 7, longest: 10 });
  assert.equal(s.attended_today, true);
  assert.equal(s.days_this_week, 3);
  assert.equal(s.days_this_month, 7);
});

test("a streak through yesterday is current; a missed day ends it", () => {
  const days = ["2026-10-12", "2026-10-13"];
  assert.equal(computeStreaks(days, "2026-10-14").streaks.day.current, 2);
  assert.equal(computeStreaks(days, "2026-10-15").streaks.day.current, 0);
  assert.equal(computeStreaks(days, "2026-10-15").streaks.day.longest, 2);
});

test("weekly, monthly and yearly runs (Monday weeks)", () => {
  const weekly = computeStreaks(["2026-09-14", "2026-09-22", "2026-09-30", "2026-10-06", "2026-10-13"], today);
  assert.equal(weekly.streaks.week.current, 5);
  assert.equal(weekly.streaks.day.current, 1);
  const old = computeStreaks(["2026-03-02", "2026-04-06", "2026-05-04"], today);
  assert.deepEqual(old.streaks.month, { current: 0, longest: 3 });
  assert.deepEqual(computeStreaks(["2025-12-31", "2026-01-01"], today).streaks.year, { current: 2, longest: 2 });
  // Sunday and the next Monday are different weeks.
  assert.equal(computeStreaks(["2026-10-11", "2026-10-12"], today).streaks.week.current, 2);
});

test("future days are ignored; nothing attended means zeros", () => {
  assert.equal(computeStreaks(["2026-10-13", "2026-10-20"], today).streaks.day.current, 1);
  const none = computeStreaks([], today);
  assert.deepEqual(none.streaks.day, { current: 0, longest: 0 });
  assert.equal(none.attended_today, false);
});

test("timestamps become UTC days", () => {
  assert.equal(utcDateKey("2026-10-13T23:30:00-02:00"), "2026-10-14");
  assert.equal(utcDateKey("2026-10-14"), "2026-10-14");
  assert.equal(utcDateKey(null), null);
  assert.equal(utcDateKey("nope"), null);
});
