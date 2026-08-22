const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadWorker(initialPolicy) {
  let storedPolicy = initialPolicy;
  const listeners = [];
  const chrome = {
    declarativeNetRequest: {
      getDynamicRules: async () => [],
      updateDynamicRules: async () => {},
    },
    tabs: {
      query: async () => [],
      update: async () => {},
      get: async () => null,
      onUpdated: { addListener: (listener) => listeners.push(listener) },
    },
    storage: {
      local: {
        get: async () => ({ policy: storedPolicy }),
        set: async ({ policy }) => { storedPolicy = policy; },
      },
    },
    runtime: {
      getURL: (value) => `chrome-extension://focusshield/${value}`,
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
    },
    alarms: {
      create: () => {},
      onAlarm: { addListener: () => {} },
    },
  };
  const context = vm.createContext({ chrome, console, URL, AbortSignal, fetch, setTimeout, clearTimeout });
  const workerPath = path.resolve(__dirname, "../../extension/service_worker.js");
  const source = fs.readFileSync(workerPath, "utf8");
  vm.runInContext(`${source}\nthis.__focusShieldTest = { addQuickBlockedDomain, isBlocked, stopShield };`, context);
  return { api: context.__focusShieldTest, getPolicy: () => storedPolicy };
}

test("Hyper Focus allows selected domains and blocks every other website", () => {
  const { api } = loadWorker({
    active: true,
    mode: "hyperfocus",
    web: { allow: ["instagram.com", "mysession.club"], domains: [], urls: [] },
  });

  assert.equal(api.isBlocked("https://instagram.com/direct/inbox", { active: true, mode: "hyperfocus", web: { allow: ["instagram.com"] } }), false);
  assert.equal(api.isBlocked("https://subdomain.mysession.club/sessions", { active: true, mode: "hyperfocus", web: { allow: ["mysession.club"] } }), false);
  assert.equal(api.isBlocked("https://google.com/search?q=instagram", { active: true, mode: "hyperfocus", web: { allow: ["instagram.com"] } }), true);
  assert.equal(api.isBlocked("https://youtube.com/watch?v=1", { active: true, mode: "hyperfocus", web: { allow: ["instagram.com"] } }), true);
});

test("FocusShield block rules still win inside a Hyper Focus allowlist", () => {
  const { api } = loadWorker({});
  const combined = {
    active: true,
    mode: "hyperfocus",
    web: {
      allow: ["instagram.com", "mysession.club"],
      domains: ["instagram.com"],
      urls: [],
    },
  };

  assert.equal(api.isBlocked("https://instagram.com/direct/inbox", combined), true);
  assert.equal(api.isBlocked("https://mysession.club/sessions", combined), false);
  assert.equal(api.isBlocked("https://example.com", combined), true);
});

test("quick block preserves the list and immediately activates the current domain", () => {
  const { api } = loadWorker({
    active: false,
    mode: "blocklist",
    endAt: null,
    web: { allow: [], domains: ["youtube.com"], urls: [] },
    desktop: { applications: [] },
  });
  const before = Date.now();

  const next = api.addQuickBlockedDomain(
    {
      active: false,
      mode: "blocklist",
      endAt: null,
      web: { allow: [], domains: ["youtube.com"], urls: [] },
      desktop: { applications: [] },
    },
    "instagram.com",
  );

  assert.equal(next.active, true);
  assert.deepEqual(Array.from(next.web.domains), ["youtube.com", "instagram.com"]);
  assert.ok(next.endAt >= before + 25 * 60_000);
});

test("quick block updates the effective web policy for layered desktop state", () => {
  const { api } = loadWorker({});
  const next = api.addQuickBlockedDomain({
    web: { domains: [], urls: [], allow: [] },
    layers: {
      blocklist: { active: false, web: { domains: ["youtube.com"], urls: [] } },
      hyperfocus: { active: true, web: { domains: [], urls: [], allow: ["instagram.com"] } },
    },
  }, "reddit.com");

  assert.deepEqual(Array.from(next.layers.blocklist.web.domains), ["youtube.com", "reddit.com"]);
  assert.deepEqual(Array.from(next.web.domains), ["reddit.com"]);
});

test("locked Hyper Focus cannot be cancelled before its timer ends", async () => {
  const { api, getPolicy } = loadWorker({
    active: true,
    locked: true,
    mode: "hyperfocus",
    endAt: Date.now() + 60_000,
    web: { allow: ["instagram.com"], domains: [], urls: [] },
    desktop: { applications: [] },
  });

  const result = await api.stopShield();
  assert.equal(result.ok, false);
  assert.equal(result.error, "locked");
  assert.equal(getPolicy().active, true);
  assert.equal(getPolicy().locked, true);
});


test("quick block adds its own session without replacing desktop sessions", () => {
  const { api } = loadWorker({});
  const next = api.addQuickBlockedDomain({
    active: true,
    mode: "blocklist",
    endAt: Date.now() + 60_000,
    web: { domains: ["youtube.com"], urls: [], allow: [] },
    sessions: [{
      id: "desktop-social",
      name: "Social",
      mode: "blocklist",
      active: true,
      endAt: Date.now() + 60_000,
      web: { domains: ["youtube.com"], urls: [], allow: [] },
      desktop: { applications: ["telegram.exe"] },
    }],
  }, "reddit.com");

  assert.equal(next.sessions.length, 2);
  assert.equal(next.sessions[0].id, "desktop-social");
  assert.equal(next.sessions[1].id, "extension-quick-block");
  assert.deepEqual(Array.from(next.sessions[1].web.domains), ["reddit.com"]);
  assert.deepEqual(Array.from(next.web.domains), ["youtube.com", "reddit.com"]);
});
