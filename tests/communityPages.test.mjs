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
  assert.equal((header.match(/navigate\("\/hosts"\)/g) || []).length, 2);
  assert.equal((header.match(/navigate\("\/leaderboard"\)/g) || []).length, 2);
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
