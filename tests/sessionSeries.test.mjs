import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const out = await build({ entryPoints: ["src/lib/sessionSeries.ts"], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
const { buildSessionSeries, sessionSeriesKey } = mod.exports;

const card = readFileSync("src/components/SessionCard.tsx", "utf8");
const page = readFileSync("src/pages/SessionsPage.tsx", "utf8");

const DAY = 24 * 60 * 60 * 1000;
const now = new Date(2026, 9, 13, 8, 0).getTime();
const at = (dayOffset, hours, minutes = 0) => {
  const date = new Date(now + dayOffset * DAY);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};
const session = (id, start, extra = {}) => ({
  id,
  title: "Morning Deep Work",
  host_id: "host-1",
  start_time: start,
  duration_minutes: 60,
  session_bookings: [],
  ...extra,
});

test("same host, title, local time and length form one series", () => {
  const sessions = [
    session("a", at(0, 9)),
    session("b", at(1, 9), { title: "  morning   deep work " }),
    session("c", at(2, 9), { session_bookings: [{ user_id: "me" }] }),
    session("other-time", at(1, 14)),
    session("other-host", at(1, 9), { host_id: "host-2" }),
    session("other-length", at(1, 9), { duration_minutes: 90 }),
  ];
  const series = buildSessionSeries(sessions, { userId: "me", now });
  assert.deepEqual(series.get("a").map((o) => o.id), ["a", "b", "c"]);
  assert.equal(series.get("b"), series.get("a"));
  assert.deepEqual(series.get("a").map((o) => o.booked), [false, false, true]);
  assert.equal(series.has("other-time"), false);
  assert.equal(series.has("other-host"), false);
  assert.equal(series.has("other-length"), false);
});

test("only the coming week counts; finished sessions drop out, a running one stays", () => {
  const sessions = [
    session("ended", at(-1, 9)),
    session("running", new Date(now - 30 * 60_000).toISOString(), {
      start_time: new Date(new Date(now).setHours(7, 30, 0, 0)).toISOString(),
      title: "Early",
    }),
    session("running-next", at(1, 7, 30), { title: "Early" }),
    session("d1", at(1, 9)),
    session("d7", at(7, 7)),
    session("d8", at(8, 9)),
  ];
  const series = buildSessionSeries(sessions, { now });
  assert.equal(series.has("ended"), false);
  assert.equal(series.has("d8"), false);
  assert.equal(series.has("d1"), false, "a single remaining occurrence is not a series");
  assert.deepEqual(series.get("running").map((o) => o.id), ["running", "running-next"]);
});

test("sessions without host, title or start time are never grouped", () => {
  assert.equal(sessionSeriesKey(session("x", at(1, 9), { host_id: null })), null);
  assert.equal(sessionSeriesKey(session("x", at(1, 9), { title: "" })), null);
  assert.equal(sessionSeriesKey(session("x", null)), null);
});

test("the sessions page passes the series and books it with one refresh", () => {
  assert.match(page, /buildSessionSeries\(\s*privacyFilteredSessions\.filter\(\(s\) => resolveSessionType\(s\) === "group"\),/);
  assert.match(page, /seriesOccurrences=\{seriesBySession\.get\(String\(s\.id\)\)\}/);
  assert.match(page, /if \(await book\(id, \{\}, \{ refresh: false \}\)\) booked\.push\(id\);/);
  assert.match(page, /if \(refresh\) await fetchSessions\(\);/);
  assert.match(page, /\.in\("session_id", ids\)\s*\.eq\("user_id", user\.id\);/);
});

test("the drawer offers the week, per-day toggles and sticky actions", () => {
  assert.match(card, /<section className="pt-6" aria-label="This week">/);
  assert.match(card, /onClick=\{\(\) => void handleToggleSeriesOccurrence\(occurrence\)\}/);
  assert.match(card, /`Book all \$\{seriesOpenIds\.length\}`/);
  assert.match(card, /`Cancel all \$\{seriesBookedIds\.length\}`/);
  // A host sees their own series but does not book it.
  assert.match(card, /disabled=\{isHost \|\| !!seriesPending\}/);
  assert.match(card, /<footer className="shrink-0 border-t border-\[#EEEEEE\] px-6 py-4">[\s\S]*Join session/);
  assert.doesNotMatch(card, /linear-gradient|radial-gradient/);
});
