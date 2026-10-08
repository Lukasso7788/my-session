import assert from "node:assert/strict";
import { test } from "node:test";
import { dateKeyInTimeZone, formatHostingRange, hostSlotOverlapsLocalDate, renderInfiniteHostingSlots, sampleInfiniteHostingSlot } from "./dailyScheduleHosting.ts";

test("host slot includes its full interval and regional time zones", () => {
  const slot = sampleInfiniteHostingSlot("2026-10-08");
  const result = renderInfiniteHostingSlots([slot], "Europe/Kyiv", "https://www.mysession.club");
  assert.match(result.text, /12:00 PM.*2:00 PM/);
  assert.match(result.text, /US East:/);
  assert.match(result.html, /12:00 PM.*2:00 PM/);
  assert.match(result.html, /test fixture/);
  assert.doesNotMatch(result.html, /room-livekit\/00000000-0000-4000-8000-000000000000/);
  const realSlot = { ...slot, sessionId: "11111111-1111-4111-8111-111111111111" };
  assert.match(renderInfiniteHostingSlots([realSlot], "Europe/Kyiv", "https://www.mysession.club").html,
    /room-livekit\/11111111-1111-4111-8111-111111111111/);
});

test("host slot ranges preserve day rollover", () => {
  const slot = {
    ...sampleInfiniteHostingSlot("2026-10-08"),
    bookedStartTime: "2026-10-08T22:00:00.000Z",
    bookedEndTime: "2026-10-09T01:00:00.000Z",
  };
  assert.match(formatHostingRange(slot, "UTC"), /Thu.*Fri/);
  assert.equal(hostSlotOverlapsLocalDate(slot, "2026-10-08", "UTC"), true);
  assert.equal(hostSlotOverlapsLocalDate(slot, "2026-10-09", "UTC"), true);
  assert.equal(hostSlotOverlapsLocalDate(slot, "2026-10-10", "UTC"), false);
});

test("date keys use the recipient's time zone", () => {
  assert.equal(dateKeyInTimeZone("2026-10-08T01:00:00.000Z", "America/Los_Angeles"), "2026-10-07");
  assert.equal(dateKeyInTimeZone("2026-10-08T23:00:00.000Z", "Asia/Kolkata"), "2026-10-09");
});

test("host and room names are escaped in HTML", () => {
  const slot = { ...sampleInfiniteHostingSlot("2026-10-08"), hostName: '<img src=x onerror="alert(1)">', sessionTitle: "<script>x</script>" };
  const result = renderInfiniteHostingSlots([slot], "UTC", "https://www.mysession.club");
  assert.doesNotMatch(result.html, /<script>|<img/);
  assert.match(result.html, /&lt;script&gt;/);
});

test("empty Infinite host schedule is explicit", () => {
  const result = renderInfiniteHostingSlots([], "UTC", "https://www.mysession.club");
  assert.match(result.text, /No hosts are scheduled/);
  assert.match(result.html, /No hosts are scheduled/);
});
