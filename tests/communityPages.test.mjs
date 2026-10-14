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
  // Left nav (narrower desktops) and mobile menu; the right-side pair is a mapped list.
  assert.equal((header.match(/navigate\("\/hosts"\)/g) || []).length, 2);
  assert.equal((header.match(/navigate\("\/leaderboard"\)/g) || []).length, 2);
  assert.match(header, /\["\/hosts", "Hosts"\],\s*\["\/leaderboard", "Leaderboard"\],/);
  // Signed-in headers need more room before the links move right.
  assert.match(header, /\$\{user \? "2xl:flex" : "xl:flex"\}/);
  assert.match(header, /\$\{user \? "2xl:hidden" : "xl:hidden"\}/);
});

test("community pages keep the data sources and the app's flat style", () => {
  assert.match(hosts, /supabase\.rpc\("community_hosts", \{ p_limit: 180 \}\)/);
  assert.match(leaderboard, /supabase\.rpc\("community_user_leaderboard", \{ p_limit: 200 \}\)/);
  assert.match(leaderboard, /supabase\.rpc\("community_hosts", \{ p_limit: 200 \}\)/);
  for (const source of [hosts, leaderboard]) {
    assert.doesNotMatch(source, /gradient|#FBFAF7|#F3EEE6|uppercase tracking-\[0\.1\d*em\]|Badge|avatarTone/);
    assert.match(source, /bg-white font-inter text-brandBlack/);
  }
  // Your own row stays visible even when it is below the shown rows.
  assert.match(leaderboard, /yourEntry && yourIndex >= shown \?/);
});

test("leaderboard highlights the top three as cards, first place in the accent blue", () => {
  assert.match(leaderboard, /const podium = entries\.length >= 3 \? entries\.slice\(0, 3\) : \[\];/);
  assert.match(leaderboard, /first \? "bg-\[#5286F6\] text-white" : "bg-\[#EEF3FE\] text-\[#3F6FD8\]"/);
});

test("hosts page has filters instead of a separate hosting-soon strip", () => {
  assert.doesNotMatch(hosts, /Hosting in the next 24 hours/);
  assert.match(hosts, /\["today", "Hosting today"\]/);
});