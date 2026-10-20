import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyYesterdayAudience, previousDateKey, utcDayBounds, yesterdayIntro } from "./yesterdayInvite.ts";

test("yesterday is the previous UTC calendar day, across month and year ends", () => {
  assert.equal(previousDateKey("2026-10-21"), "2026-10-20");
  assert.equal(previousDateKey("2026-11-01"), "2026-10-31");
  assert.equal(previousDateKey("2027-01-01"), "2026-12-31");
  assert.deepEqual(utcDayBounds("2026-10-20"), { startIso: "2026-10-20T00:00:00.000Z", endIso: "2026-10-21T00:00:00.000Z" });
  assert.throws(() => previousDateKey("not-a-date"));
});

test("audience: signed up yesterday or came yesterday; coming wins", () => {
  const kinds = classifyYesterdayAudience({ registeredYesterday: ["a", "b", ""], attendedYesterday: ["b", "c"] });
  assert.deepEqual(Object.fromEntries(kinds), { a: "new", b: "returning", c: "returning" });
  assert.equal(classifyYesterdayAudience({ registeredYesterday: [], attendedYesterday: [] }).size, 0);
});

test("intros: a first-session welcome and a come-back nudge", () => {
  const welcome = yesterdayIntro("new", "Anna", "Wednesday, Oct 21");
  assert.equal(welcome.subject, "Your first MySession is today — Wednesday, Oct 21");
  assert.match(welcome.lead, /you joined MySession yesterday/);
  const back = yesterdayIntro("returning", "Ben", "Wednesday, Oct 21");
  assert.equal(back.subject, "Come back today — Wednesday, Oct 21");
  assert.match(back.lead, /thanks for showing up yesterday/);
  assert.match(yesterdayIntro("new", "", "Today").lead, /Hey there/);
});

test("admin API: admin preview/send, cron with the daily secret, intro never from the request", () => {
  const admin = readFileSync(new URL("../livekit/admin.ts", import.meta.url), "utf8");
  assert.match(admin, /"daily_schedule_yesterday_preview"/);
  assert.match(admin, /cronAction === "daily_schedule_send_yesterday"/);
  const cron = admin.slice(admin.indexOf('isDailyEmailCron && cronAction === "daily_schedule_send_yesterday"'));
  assert.match(cron.slice(0, 600), /DAILY_SCHEDULE_CRON_SECRET/);
  // Admin route checks admin; intro kinds are a server-side parameter, not a body field.
  const handler = admin.slice(admin.indexOf("async function handleYesterdayInviteAction"));
  assert.match(handler.slice(0, 600), /if \(!fromCron\) await assertAppAdmin/);
  const bodyType = admin.slice(admin.indexOf("type Body = {"), admin.indexOf("type SessionRowLite"));
  assert.doesNotMatch(bodyType, /introKinds/);
  // Same one-per-day ledger and idempotency key as the daily schedule email.
  assert.match(admin, /idempotencyKey: `mysession-daily-schedule-\$\{recipient\.userId\}-\$\{recipientDate\}`/);
});
