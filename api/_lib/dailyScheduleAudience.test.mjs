import assert from "node:assert/strict";
import { test } from "node:test";
import { canReceiveDailyDigest, isLocalMorning, isPlausibleEmail } from "./dailyScheduleAudience.ts";

test("skips addresses Plunk will reject as malformed", () => {
  assert.equal(isPlausibleEmail("reader@example.com"), true);
  assert.equal(isPlausibleEmail("reader@example"), false);
  assert.equal(isPlausibleEmail("reader with space@example.com"), false);
  assert.equal(isPlausibleEmail("reader@@example.com"), false);
});

test("hourly cron selects recipients in their own morning", () => {
  const now = new Date("2026-10-08T07:00:00.000Z");
  assert.equal(isLocalMorning(now, "Europe/London"), true);
  assert.equal(isLocalMorning(now, "Europe/Kyiv"), false);
  assert.equal(isLocalMorning(now, "America/New_York"), false);
  assert.equal(isLocalMorning(new Date("2026-10-08T05:00:00.000Z"), "Europe/Kyiv"), true);
});

test("daily digest reaches registered users independently of marketing consent and respects daily opt-out", () => {
  const eligible = { email: "reader@example.com", dailyEnabled: true, alreadyAttemptedToday: false };
  assert.equal(canReceiveDailyDigest(eligible), true);
  assert.equal(canReceiveDailyDigest({ ...eligible, dailyEnabled: false }), false);
  assert.equal(canReceiveDailyDigest({ ...eligible, alreadyAttemptedToday: true }), false);
});
