const test = require("node:test");
const assert = require("node:assert/strict");
const { CloudSync } = require("../electron/cloud-sync.cjs");

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("downloads a newer policy from another desktop device", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  let applied = null;
  global.fetch = async (_url, options = {}) => {
    if (!options.method) return response([{ policy: { active: true, updatedAt: 200 }, device_id: "laptop" }]);
    throw new Error("unexpected upload");
  };
  const sync = new CloudSync({
    deviceId: "desktop",
    getPolicy: () => ({ active: false, updatedAt: 100 }),
    applyRemotePolicy: (policy) => { applied = policy; return { ok: true }; },
  });
  sync.session = {
    supabaseUrl: "https://example.supabase.co",
    anonKey: "anon",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-id" },
  };
  const result = await sync.syncNow();
  assert.equal(result.direction, "downloaded");
  assert.deepEqual(applied, { active: true, updatedAt: 200 });
});

test("uploads a newer local policy", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  let uploaded = null;
  global.fetch = async (_url, options = {}) => {
    if (!options.method) return response([{ policy: { active: false, updatedAt: 100 } }]);
    uploaded = JSON.parse(options.body);
    return response(null, 201);
  };
  const local = { active: true, updatedAt: 300, desktop: { applications: ["telegram.exe"] } };
  const sync = new CloudSync({
    deviceId: "desktop",
    getPolicy: () => local,
    applyRemotePolicy: () => ({ ok: true }),
  });
  sync.session = {
    supabaseUrl: "https://example.supabase.co",
    anonKey: "anon",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-id" },
  };
  const result = await sync.syncNow();
  assert.equal(result.direction, "uploaded");
  assert.deepEqual(uploaded.policy, local);
  assert.equal(uploaded.device_id, "desktop");
});

test("downloads newer saved lists without replacing the active policy", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  let applied = null;
  global.fetch = async (url, options = {}) => {
    assert.equal(options.method, undefined);
    assert.match(String(url), /focus_shield_saved_lists/);
    return response([{
      id: "outreach",
      name: "Outreach",
      configuration: {
        web: { domains: ["youtube.com"] },
        desktop: { applications: ["telegram.exe"] },
      },
      created_at: "2026-08-10T10:00:00.000Z",
      updated_at: "2026-08-11T10:00:00.000Z",
      deleted_at: null,
    }]);
  };
  const sync = new CloudSync({
    deviceId: "desktop",
    getPolicy: () => ({ active: true, updatedAt: 100 }),
    applyRemotePolicy: () => ({ ok: true }),
    getSavedLists: () => [],
    applyRemoteSavedLists: (lists) => { applied = lists; return { ok: true }; },
  });
  sync.session = {
    supabaseUrl: "https://example.supabase.co",
    anonKey: "anon",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-id" },
  };

  const result = await sync.syncSavedLists();
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(applied[0].id, "outreach");
  assert.deepEqual(applied[0].web.domains, ["youtube.com"]);
});

test("policy uploads do not embed reusable saved lists", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  let uploaded = null;
  global.fetch = async (_url, options = {}) => {
    uploaded = JSON.parse(options.body);
    return response(null, 201);
  };
  const sync = new CloudSync({ deviceId: "desktop", getPolicy: () => ({ active: false }) });
  sync.session = { supabaseUrl: "https://example.supabase.co", anonKey: "anon", accessToken: "token", expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { id: "user-id" } };
  await sync.pushPolicy({ active: false, savedLists: [{ id: "local" }] });
  assert.equal("savedLists" in uploaded.policy, false);
});


test("uploads a locally newer saved list during reconciliation", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  let uploaded = null;
  global.fetch = async (_url, options = {}) => {
    if (!options.method) {
      return response([{
        id: "outreach",
        name: "Old outreach",
        configuration: {},
        created_at: "2026-08-10T10:00:00.000Z",
        updated_at: "2026-08-10T10:00:00.000Z",
        deleted_at: null,
      }]);
    }
    uploaded = JSON.parse(options.body);
    return response(null, 201);
  };
  const local = [{
    id: "outreach",
    name: "Current outreach",
    createdAt: Date.parse("2026-08-10T10:00:00.000Z"),
    updatedAt: Date.parse("2026-08-12T10:00:00.000Z"),
    web: { domains: ["instagram.com"] },
    desktop: { applications: [] },
  }];
  const sync = new CloudSync({
    deviceId: "desktop",
    getSavedLists: () => local,
    applyRemoteSavedLists: () => ({ ok: true }),
  });
  sync.session = { supabaseUrl: "https://example.supabase.co", anonKey: "anon", accessToken: "token", expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { id: "user-id" } };

  const result = await sync.syncSavedLists();
  assert.equal(result.ok, true);
  assert.equal(uploaded.name, "Current outreach");
  assert.deepEqual(uploaded.configuration.web.domains, ["instagram.com"]);
});

test("a remote saved-list tombstone removes the list locally", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  let applied = null;
  global.fetch = async (_url, options = {}) => {
    assert.equal(options.method, undefined);
    return response([{
      id: "deleted-list",
      name: "Deleted list",
      configuration: {},
      created_at: "2026-08-10T10:00:00.000Z",
      updated_at: "2026-08-12T10:00:00.000Z",
      deleted_at: "2026-08-12T10:00:00.000Z",
    }]);
  };
  const sync = new CloudSync({
    deviceId: "desktop",
    getSavedLists: () => [{ id: "deleted-list", name: "Local copy", updatedAt: 1 }],
    applyRemoteSavedLists: (lists) => { applied = lists; return { ok: true }; },
  });
  sync.session = { supabaseUrl: "https://example.supabase.co", anonKey: "anon", accessToken: "token", expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { id: "user-id" } };

  const result = await sync.syncSavedLists();
  assert.equal(result.ok, true);
  assert.deepEqual(applied, []);
});

test("a newer local edit wins over an older remote tombstone", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  let uploaded = null;
  global.fetch = async (_url, options = {}) => {
    if (!options.method) {
      return response([{
        id: "revived-list",
        name: "Deleted list",
        configuration: {},
        created_at: "2026-08-10T10:00:00.000Z",
        updated_at: "2026-08-11T10:00:00.000Z",
        deleted_at: "2026-08-11T10:00:00.000Z",
      }]);
    }
    uploaded = JSON.parse(options.body);
    return response(null, 201);
  };
  const local = [{
    id: "revived-list",
    name: "Revived list",
    createdAt: Date.parse("2026-08-10T10:00:00.000Z"),
    updatedAt: Date.parse("2026-08-12T10:00:00.000Z"),
    web: { domains: ["reddit.com"] },
    desktop: { applications: [] },
  }];
  let applied = null;
  const sync = new CloudSync({
    deviceId: "desktop",
    getSavedLists: () => local,
    applyRemoteSavedLists: (lists) => { applied = lists; return { ok: true }; },
  });
  sync.session = { supabaseUrl: "https://example.supabase.co", anonKey: "anon", accessToken: "token", expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { id: "user-id" } };

  const result = await sync.syncSavedLists();
  assert.equal(result.ok, true);
  assert.equal(uploaded.name, "Revived list");
  assert.equal(applied[0].id, "revived-list");
});