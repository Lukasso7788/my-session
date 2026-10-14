import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const out = await build({ entryPoints: ["src/lib/communityDisplay.ts"], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
const { countryName, initials, formatHours, formatCount } = mod.exports;

const badgesOut = await build({ entryPoints: ["src/components/CommunityBadges.tsx"], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent", external: ["react", "react/jsx-runtime"], jsx: "automatic" });
const badgesMod = { exports: {} };
new Function("require", "module", "exports", badgesOut.outputFiles[0].text)(require, badgesMod, badgesMod.exports);
const { sessionMilestone } = badgesMod.exports;

const migration = readFileSync("supabase/migrations/20261014120000_community_founding_member_flag.sql", "utf8");
const header = readFileSync("src/components/Header.tsx", "utf8");
const hosts = readFileSync("src/pages/HostsPage.tsx", "utf8");
const leaderboard = readFileSync("src/pages/LeaderboardPage.tsx", "utf8");

test("display helpers", () => {
  assert.equal(countryName("ua"), "Ukraine");
  assert.equal(countryName("XX1"), null);
  assert.equal(countryName(null), null);
  assert.equal(initials("Anna Fischer"), "AF");
  assert.equal(initials("  "), "M");
  assert.equal(formatHours(12), "12");
  assert.equal(formatHours(3.25), "3.3");
  assert.equal(formatHours(250.4), "250");
  assert.equal(formatCount(1234), "1,234");
});

test("hosts and leaderboard are linked from the header on desktop and mobile", () => {
  // Left nav (narrower desktops) and mobile menu; the right-side pair is a mapped list.
  assert.equal((header.match(/navigate\("\/hosts"\)/g) || []).length, 2);
  assert.equal((header.match(/navigate\("\/leaderboard"\)/g) || []).length, 2);
  assert.match(header, /\["\/hosts", "Hosts"\],\s*\["\/leaderboard", "Leaderboard"\],/);
  // Signed-in headers need more room before the links move right.
  assert.match(header, /\$\{user \? "2xl:flex" : "xl:flex"\}/);
  assert.match(header, /\$\{user \? "2xl:hidden" : "xl:hidden"\}/);
});

test("session milestone badges pick the highest reached tier", () => {
  assert.equal(sessionMilestone(9), null);
  assert.equal(sessionMilestone(10).threshold, 10);
  assert.equal(sessionMilestone(99).threshold, 50);
  assert.equal(sessionMilestone("250").threshold, 250);
  assert.equal(sessionMilestone(5000).threshold, 1000);
});

test("founding-member migration only adds a flag to both community functions", () => {
  assert.equal((migration.match(/as is_founding_member/g) || []).length, 2);
  assert.equal((migration.match(/is_founding_member boolean/g) || []).length, 2);
  assert.match(migration, /e\.plan = 'founding_free'\s*and e\.status in \('active', 'trialing'\)/);
  assert.equal((migration.match(/grant execute on function public\.community_\w+\(integer\) to anon, authenticated, service_role;/g) || []).length, 2);
});

test("community pages keep the data sources and the app's flat style", () => {
  assert.match(hosts, /supabase\.rpc\("community_hosts", \{ p_limit: 180 \}\)/);
  assert.match(leaderboard, /supabase\.rpc\("community_user_leaderboard", \{ p_limit: 200 \}\)/);
  assert.match(leaderboard, /supabase\.rpc\("community_hosts", \{ p_limit: 200 \}\)/);
  for (const source of [hosts, leaderboard]) {
    assert.doesNotMatch(source, /gradient|#FBFAF7|#F3EEE6|uppercase tracking/);
    assert.match(source, /bg-white font-inter text-brandBlack/);
  }
  // Your own row stays visible even when it is below the shown rows.
  assert.match(leaderboard, /yourEntry && yourIndex >= shown \?/);
});
