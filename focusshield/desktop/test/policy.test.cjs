const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isExpired,
  normalizeExecutable,
  sanitizePolicy,
} = require("../electron/policy.cjs");

test("normalizes executable names and rejects protected Windows processes", () => {
  assert.equal(normalizeExecutable("C:\\Apps\\Telegram.exe"), "telegram.exe");
  assert.equal(normalizeExecutable("Discord"), "discord.exe");
  assert.equal(normalizeExecutable("explorer.exe"), "");
  assert.equal(normalizeExecutable("svchost"), "");
});

test("sanitizes and deduplicates a synchronized policy", () => {
  const policy = sanitizePolicy({
    active: true,
    locked: true,
    endAt: Date.now() + 60_000,
    updatedAt: 123,
    web: { domains: ["YouTube.com", "youtube.com"], urls: [], allow: [] },
    desktop: { applications: ["Telegram.exe", "telegram", "explorer.exe"] },
  });

  assert.equal(policy.active, true);
  assert.equal(policy.locked, true);
  assert.deepEqual(policy.web.domains, ["youtube.com"]);
  assert.deepEqual(policy.desktop.applications, ["telegram.exe"]);
  assert.equal(policy.updatedAt, 123);
});

test("sanitizes reusable block lists for desktop and extension sync", () => {
  const policy = sanitizePolicy({
    savedLists: [{
      id: "deep-work",
      name: "Deep work",
      web: {
        domains: ["YouTube.com", "youtube.com"],
        urls: ["https://youtube.com/shorts"],
      },
      desktop: {
        applications: ["Telegram.exe", "telegram", "explorer.exe"],
      },
    }],
  });

  assert.equal(policy.savedLists.length, 1);
  assert.equal(policy.savedLists[0].name, "Deep work");
  assert.deepEqual(policy.savedLists[0].web.domains, ["youtube.com"]);
  assert.deepEqual(policy.savedLists[0].desktop.applications, ["telegram.exe"]);
});
test("detects expired active policies", () => {
  assert.equal(isExpired({ active: true, endAt: Date.now() - 1 }), true);
  assert.equal(isExpired({ active: false, endAt: Date.now() - 1 }), false);
});
