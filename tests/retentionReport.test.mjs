import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

async function importTs(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { buildRetentionReport, weekStartKey, monthStartKey } = await importTs("src/lib/retentionReport.ts");

// Same fixture as supabase/tests/admin_retention_streaks.sql.
const visits = {
  anna: ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14",
    "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08", "2026-05-09", "2026-05-10"],
  ben: ["2026-09-14", "2026-09-22", "2026-09-30", "2026-10-06", "2026-10-13"],
  cleo: ["2026-10-12", "2026-10-13", "2026-10-20"],
  dan: ["2026-03-02", "2026-04-06", "2026-05-04"],
};
const byDate = new Map();
for (const [id, dates] of Object.entries(visits)) for (const d of dates) byDate.set(d, [...(byDate.get(d) || []), id]);
const days = [...byDate].map(([date, userIds]) => ({ date, userIds }));
const r = buildRetentionReport(days, "2026-10-14");

test("calendar helpers", () => {
  assert.equal(weekStartKey("2026-10-14"), "2026-10-12");
  assert.equal(weekStartKey("2026-10-12"), "2026-10-12");
  assert.equal(monthStartKey("2026-10-14"), "2026-10-01");
  assert.equal(monthStartKey("2026-01-14", 1), "2025-12-01");
});

test("returning people match the database report", () => {
  assert.equal(r.week_start, "2026-10-12");
  const week = r.returning.weeks.at(-1);
  assert.deepEqual([week.active, week.returning, week.returning3], [3, 2, 1]);
  assert.equal(r.returning.weeks.length, 12);
  assert.equal(r.returning.months.length, 12);
  assert.equal(r.returning.months.at(-1).returning, 3);
  assert.equal(r.returning.top.month[0].user_id, "anna");
});

test("streaks match the database report", () => {
  assert.equal(r.streaks.day.on_streak, 2);
  assert.equal(r.streaks.day.top[0].user_id, "anna");
  assert.equal(r.streaks.week.top[0].user_id, "ben");
  assert.equal(r.streaks.day.record.longest, 10);
  assert.equal(r.streaks.day.buckets.find((b) => b.min === 7).users, 1);
  assert.ok("year" in r.streaks);
});
