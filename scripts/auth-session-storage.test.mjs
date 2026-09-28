import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GoTrueClient } from "@supabase/auth-js";
import ts from "typescript";

const source = readFileSync("src/lib/authSessionStorage.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const exports = {};
new Function("exports", js)(exports);
const { createClockSafeAuthStorage } = exports;

function harness(localSeconds = 1_800_000_000) {
  const records = new Map();
  let currentSeconds = localSeconds;
  const raw = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  };
  return {
    raw,
    storage: createClockSafeAuthStorage(raw, "mysession-auth", () => currentSeconds * 1000),
    advance: (seconds) => { currentSeconds += seconds; },
    now: () => currentSeconds,
  };
}

function writeSession(h, token, expiresAt, expiresIn = 3600) {
  h.storage.setItem("mysession-auth", JSON.stringify({
    access_token: token,
    refresh_token: `refresh-${token}`,
    expires_at: expiresAt,
    expires_in: expiresIn,
    user: { id: "dory" },
  }));
  return JSON.parse(h.storage.getItem("mysession-auth"));
}

test("correct clocks preserve the SDK session and unrelated PKCE storage", () => {
  const h = harness();
  const session = writeSession(h, "token-1", h.now() + 3600);
  assert.equal(session.expires_at, h.now() + 3600);
  h.storage.setItem("mysession-auth-code-verifier", "pkce-secret");
  assert.equal(h.storage.getItem("mysession-auth-code-verifier"), "pkce-secret");
  h.storage.removeItem("mysession-auth-code-verifier");
  assert.equal(h.storage.getItem("mysession-auth-code-verifier"), null);
});

test("a device one hour ahead cannot make every new JWT look immediately expired", () => {
  const h = harness();
  const serverExpiry = h.now();
  const first = writeSession(h, "token-1", serverExpiry);
  assert.equal(first.expires_at, h.now() + 3600 - 60);
  assert.equal(first.access_token, "token-1");
  assert.equal(first.refresh_token, "refresh-token-1");

  h.advance(1200);
  const resaved = writeSession(h, "token-1", serverExpiry);
  assert.equal(resaved.expires_at, first.expires_at, "same token cannot gain another hour");

  const refreshed = writeSession(h, "token-2", h.now());
  assert.equal(refreshed.expires_at, h.now() + 3600 - 60);
});

test("a device one hour behind refreshes on relative token lifetime too", () => {
  const h = harness();
  const session = writeSession(h, "token-1", h.now() + 7200);
  assert.equal(session.expires_at, h.now() + 3600 - 60);
});

test("moderate server-ahead skew does not outlast the real JWT", () => {
  const h = harness();
  const session = writeSession(h, "token-1", h.now() + 3660);
  assert.equal(session.expires_at, h.now() + 3600 - 60);
});

test("damaged old storage cannot block a fresh session and invalid new data is untouched", () => {
  const h = harness();
  h.raw.setItem("mysession-auth", "not JSON");
  const recovered = writeSession(h, "token-1", h.now());
  assert.equal(recovered.expires_at, h.now() + 3600 - 60);
  h.storage.setItem("mysession-auth", "not JSON either");
  assert.equal(h.storage.getItem("mysession-auth"), "not JSON either");
});

test("the installed GoTrueClient refreshes a skewed session once, not on every getSession", async () => {
  const now = Math.floor(Date.now() / 1000);
  const h = harness(now);
  h.raw.setItem("mysession-auth", JSON.stringify({
    access_token: "expired-on-device",
    refresh_token: "initial-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now - 1,
    user: { id: "test-user" },
  }));

  let refreshes = 0;
  const auth = new GoTrueClient({
    url: "https://auth.example.test/auth/v1",
    storageKey: "mysession-auth",
    storage: h.storage,
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    fetch: async (url) => {
      assert.match(String(url), /\/token\?grant_type=refresh_token$/);
      refreshes += 1;
      return new Response(JSON.stringify({
        access_token: `fresh-${refreshes}`,
        refresh_token: `next-refresh-${refreshes}`,
        token_type: "bearer",
        expires_in: 3600,
        // The response has a server absolute expiry that is already in the
        // past on this device; this reproduces the repeated-refresh failure.
        expires_at: now,
        user: { id: "test-user" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await auth.initialize();
  for (let i = 0; i < 10; i++) {
    const { data, error } = await auth.getSession();
    assert.equal(error, null);
    assert.equal(data.session?.user.id, "test-user");
  }
  assert.equal(refreshes, 1);
  assert.ok(JSON.parse(h.storage.getItem("mysession-auth")).expires_at > now + 3500);
});
