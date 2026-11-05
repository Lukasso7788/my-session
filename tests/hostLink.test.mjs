import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [resolve("src/lib/hostLink.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { hostLinkProblem, isReservedHostLink, normalizeHostLink, pickHostLinkSession } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

test("what people type becomes a clean link", () => {
  assert.equal(normalizeHostLink("  Yaroslav "), "yaroslav");
  assert.equal(normalizeHostLink("https://mysession.club/Yaroslav S"), "yaroslav-s");
  assert.equal(normalizeHostLink("/misha_focus!"), "misha_focus");
  assert.equal(normalizeHostLink("x".repeat(60)).length, 32);
});

test("app pages, SEO pages, IDs and too-short links are refused", () => {
  assert.equal(hostLinkProblem("yaroslav"), "");
  assert.match(hostLinkProblem("ya"), /at least 3/);
  assert.match(hostLinkProblem("-yaroslav"), /letter or a number/);
  for (const slug of ["sessions", "hosts", "profile", "pricing", "room-livekit", "admin"]) {
    assert.ok(isReservedHostLink(slug), slug);
  }
  assert.ok(isReservedHostLink("body-doubling"), "SEO page");
  assert.match(hostLinkProblem("9d5bfd47-4b75"), /not an ID/);
});

const at = (iso) => Date.parse(iso);
const NOW = at("2026-11-05T12:00:00Z");

test("the link opens the group session running now, else the next one", () => {
  const sessions = [
    { id: "past", start_time: "2026-11-05T08:00:00Z", duration_minutes: 60 },
    { id: "next", start_time: "2026-11-05T15:00:00Z", duration_minutes: 60 },
    { id: "live", start_time: "2026-11-05T11:30:00Z", duration_minutes: 90 },
  ];
  assert.equal(pickHostLinkSession(sessions, NOW).id, "live");
  assert.equal(pickHostLinkSession(sessions.filter((s) => s.id !== "live"), NOW).id, "next");
  assert.equal(pickHostLinkSession([sessions[0]], NOW), null);
});

test("infinite rooms, private, hidden and one-on-one sessions are never opened", () => {
  const live = { start_time: "2026-11-05T11:30:00Z", duration_minutes: 90 };
  assert.equal(pickHostLinkSession([
    { id: "inf", session_format_type: "infinite", ...live },
    { id: "inf2", schedule: JSON.stringify({ kind: "infinite_room" }), ...live },
    { id: "private", is_private: true, ...live },
    { id: "hidden", is_hidden: true, ...live },
    { id: "1on1", description: "one-on-one:abc", ...live },
  ], NOW), null);
});

test("the profile saves the link through host_slug and the resolver uses the picker", () => {
  const profile = readFileSync("src/pages/ProfilePage.tsx", "utf8");
  assert.match(profile, /host_slug: nextHostLink \|\| null/);
  const resolver = readFileSync("src/pages/PublicSlugRedirectPage.tsx", "utf8");
  assert.match(resolver, /pickHostLinkSession\(/);
  assert.match(resolver, /is_private\.is\.null,is_private\.eq\.false/);
});
