import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const out = await build({ entryPoints: ["src/lib/hostingEligibility.ts"], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
const rule = mod.exports;
const modal = readFileSync("src/components/CreateSessionModal.tsx", "utf8");

test("public sessions need 10 attended sessions; admins are exempt", () => {
  assert.equal(rule.PUBLIC_HOSTING_MIN_ATTENDED, 10);
  assert.equal(rule.canCreatePublicSession({ attended: 9, isAdmin: false }), false);
  assert.equal(rule.canCreatePublicSession({ attended: 10, isAdmin: false }), true);
  assert.equal(rule.canCreatePublicSession({ attended: 0, isAdmin: true }), true);
  // An unknown count does not lock the form; the database check decides.
  assert.equal(rule.canCreatePublicSession({ attended: null, isAdmin: false }), true);
  // People the owner exempted host public sessions with any attendance.
  assert.equal(rule.canCreatePublicSession({ attended: 0, isAdmin: false, userId: "532889eb-2819-430f-b156-86cfba865b16" }), true);
  assert.equal(rule.canCreatePublicSession({ attended: 0, isAdmin: false, userId: "532889EB-2819-430F-B156-86CFBA865B16" }), true);
  assert.equal(rule.canCreatePublicSession({ attended: 0, isAdmin: false, userId: "00000000-0000-0000-0000-000000000000" }), false);
  assert.equal(rule.sessionsUntilPublicHosting(3), 7);
  assert.equal(rule.sessionsUntilPublicHosting(12), 0);
  assert.equal(rule.sessionsUntilPublicHosting(null), 0);
});

test("below the limit the form only creates private sessions and says why", () => {
  assert.match(modal, /supabase\.rpc\("get_lifetime_attendance_count"\)/);
  assert.match(modal, /canCreatePublicSession\(\{ attended: attendedCount, isAdmin: isAppAdmin, userId: user\?\.id \}\)/);
  assert.match(modal, /const effectiveAccessMode: AccessMode = publicHostingOpen \? accessMode : "private";/);
  assert.match(modal, /is_private: effectiveAccessMode === "private"/);
  assert.doesNotMatch(modal, /is_private: accessMode === "private"/);
  assert.match(modal, /const locked = mode === "public" && !publicHostingOpen;/);
  assert.match(modal, /disabled=\{locked\}/);
  assert.match(modal, /Public sessions open after you attend \{PUBLIC_HOSTING_MIN_ATTENDED\} sessions/);
});
