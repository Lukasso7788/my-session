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
