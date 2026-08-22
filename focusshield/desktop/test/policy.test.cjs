const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isExpired,
  isSafeForBulkBlocking,
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

test("sanitizes Hyper Focus policy fields", () => {
  const policy = sanitizePolicy({
    active: true,
    locked: true,
    mode: "hyperfocus",
    task: `  Publish Instagram posts  `,
    endAt: Date.now() + 60_000,
    web: { allow: ["Instagram.com", "instagram.com", "mysession.club"] },
    desktop: {
      applications: ["Telegram.exe"],
      blockOtherApplications: true,
    },
  });

  assert.equal(policy.mode, "hyperfocus");
  assert.equal(policy.locked, true);
  assert.equal(policy.task, "Publish Instagram posts");
  assert.deepEqual(policy.web.allow, ["instagram.com", "mysession.club"]);
  assert.equal(policy.desktop.blockOtherApplications, true);
});

test("keeps FocusShield and Hyper Focus active as independent layers", () => {
  const now = Date.now();
  const policy = sanitizePolicy({
    layers: {
      blocklist: {
        active: true,
        endAt: now + 30_000,
        web: { domains: ["youtube.com"] },
        desktop: { applications: ["telegram.exe"] },
      },
      hyperfocus: {
        active: true,
        task: "Instagram outreach",
        endAt: now + 60_000,
        web: { allow: ["instagram.com", "mysession.club"] },
        desktop: { applications: ["discord.exe"] },
      },
    },
  });

  assert.equal(policy.active, true);
  assert.equal(policy.layers.blocklist.active, true);
  assert.equal(policy.layers.hyperfocus.active, true);
  assert.equal(policy.mode, "hyperfocus");
  assert.deepEqual(policy.web.domains, ["youtube.com"]);
  assert.deepEqual(policy.web.allow, ["instagram.com", "mysession.club"]);
  assert.deepEqual(policy.desktop.applications, ["telegram.exe", "discord.exe"]);
  assert.equal(policy.endAt, now + 60_000);
});

test("expires one focus layer without stopping the other", () => {
  const now = Date.now();
  const policy = sanitizePolicy({
    layers: {
      blocklist: { active: true, endAt: now - 1, web: { domains: ["youtube.com"] } },
      hyperfocus: { active: true, endAt: now + 60_000, web: { allow: ["instagram.com"] } },
    },
  });

  assert.equal(policy.layers.blocklist.active, false);
  assert.equal(policy.layers.hyperfocus.active, true);
  assert.equal(policy.active, true);
  assert.deepEqual(policy.web.domains, []);
  assert.deepEqual(policy.web.allow, ["instagram.com"]);
});
test("Hyper Focus desktop-app blocking is opt-in in the UI", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.resolve(__dirname, "../renderer/index.html"), "utf8");
  assert.match(html, /id="hyperBlockApps" type="checkbox"\s*\/>/);
  assert.doesNotMatch(html, /id="hyperBlockApps"[^>]*\bchecked\b/);
  assert.match(html, /id="hyperChooseApps"/);
  assert.match(html, /id="hyperScanProcesses"/);
  assert.match(html, /id="hyperCustomAppsInput"/);
});
test("bulk Hyper Focus blocking skips system helpers and voice tools", () => {
  assert.equal(isSafeForBulkBlocking({ name: "Windows Security", executable: "securityhealth.exe" }), false);
  assert.equal(isSafeForBulkBlocking({ name: "Microsoft Edge WebView2 Runtime", executable: "msedgewebview2.exe" }), false);
  assert.equal(isSafeForBulkBlocking({ name: "Wispr Flow", executable: "wisprflow.exe" }), false);
  assert.equal(isSafeForBulkBlocking({ name: "Whisper Flow", executable: "whisperflow.exe" }), false);
});

test("bulk Hyper Focus blocking keeps ordinary distraction apps eligible", () => {
  assert.equal(isSafeForBulkBlocking({ name: "Telegram Desktop", executable: "telegram.exe" }), true);
  assert.equal(isSafeForBulkBlocking({ name: "Discord", executable: "discord.exe" }), true);
  assert.equal(isSafeForBulkBlocking({ name: "Example Game", executable: "example-game.exe" }), true);
});
test("voice tools remain available for explicit custom blocking", () => {
  assert.equal(normalizeExecutable("WisprFlow.exe"), "wisprflow.exe");
  assert.equal(normalizeExecutable("WhisperFlow.exe"), "whisperflow.exe");
});

test("detects expired active policies", () => {
  assert.equal(isExpired({ active: true, endAt: Date.now() - 1 }), true);
  assert.equal(isExpired({ active: false, endAt: Date.now() - 1 }), false);
});


test("aggregates multiple blocking sessions with independent timers", () => {
  const now = Date.now();
  const policy = sanitizePolicy({
    sessions: [
      {
        id: "social-two-hours",
        name: "Social media",
        mode: "blocklist",
        active: true,
        startedAt: now,
        endAt: now + 2 * 60 * 60_000,
        web: { domains: ["instagram.com"] },
        desktop: { applications: ["telegram.exe"] },
      },
      {
        id: "video-five-hours",
        name: "Video",
        mode: "blocklist",
        active: true,
        startedAt: now,
        endAt: now + 5 * 60 * 60_000,
        web: { domains: ["youtube.com"] },
        desktop: { applications: ["vlc.exe"] },
      },
    ],
  });

  assert.equal(policy.sessions.length, 2);
  assert.deepEqual(policy.web.domains, ["instagram.com", "youtube.com"]);
  assert.deepEqual(policy.desktop.applications, ["telegram.exe", "vlc.exe"]);
  assert.equal(policy.endAt, now + 5 * 60 * 60_000);
});

test("expires only the elapsed blocking session", () => {
  const now = Date.now();
  const policy = sanitizePolicy({
    sessions: [
      {
        id: "expired",
        mode: "blocklist",
        active: true,
        endAt: now - 1,
        web: { domains: ["instagram.com"] },
      },
      {
        id: "still-running",
        mode: "blocklist",
        active: true,
        endAt: now + 60_000,
        web: { domains: ["youtube.com"] },
      },
    ],
  });

  assert.deepEqual(policy.sessions.map((session) => session.id), ["still-running"]);
  assert.deepEqual(policy.web.domains, ["youtube.com"]);
  assert.equal(policy.active, true);
});

test("keeps Hyper Focus and multiple block lists active together", () => {
  const now = Date.now();
  const policy = sanitizePolicy({
    sessions: [
      {
        id: "messages",
        mode: "blocklist",
        active: true,
        endAt: now + 30_000,
        desktop: { applications: ["discord.exe"] },
      },
      {
        id: "social",
        mode: "blocklist",
        active: true,
        endAt: now + 60_000,
        web: { domains: ["reddit.com"] },
      },
      {
        id: "task",
        name: "Instagram outreach",
        mode: "hyperfocus",
        active: true,
        task: "Instagram outreach",
        endAt: now + 90_000,
        web: { allow: ["instagram.com", "mysession.club"] },
      },
    ],
  });

  assert.equal(policy.sessions.length, 3);
  assert.equal(policy.layers.blocklist.active, true);
  assert.equal(policy.layers.hyperfocus.active, true);
  assert.deepEqual(policy.web.domains, ["reddit.com"]);
  assert.deepEqual(policy.web.allow, ["instagram.com", "mysession.club"]);
});
