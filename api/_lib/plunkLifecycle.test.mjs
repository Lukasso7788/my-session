import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["api/_lib/plunkLifecycle.ts"],
  bundle: true, platform: "node", format: "esm", write: false });
const { plunkLifecycleStatus, processPlunkOutbox, emitPlunkTestSuite } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`,
);

const keys = ["PLUNK_API_URL", "PLUNK_SECRET_KEY", "PLUNK_PUBLIC_KEY",
  "PLUNK_LIFECYCLE_ENABLED", "PLUNK_LIFECYCLE_CUTOVER_AT", "SENDER_INTEGRATION_ENABLED"];
const original = new Map(keys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const originalError = console.error;

beforeEach(() => {
  process.env.PLUNK_API_URL = "https://mail-api.example.test";
  process.env.PLUNK_SECRET_KEY = "sk-test-secret";
  process.env.PLUNK_PUBLIC_KEY = "pk-test-public";
  process.env.PLUNK_LIFECYCLE_ENABLED = "true";
  process.env.PLUNK_LIFECYCLE_CUTOVER_AT = "2026-10-03T00:00:00Z";
  process.env.SENDER_INTEGRATION_ENABLED = "false";
  console.error = () => {};
});

afterEach(() => {
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
  console.error = originalError;
});

function row(overrides = {}) {
  return {
    id: "81263a7e-8dad-4d8d-b7d3-d79e635d417c",
    user_id: "user-1",
    email: "reader@example.test",
    event_type: "session_booked",
    properties: { session_title: "Focus", marketing_email_enabled: false },
    idempotency_key: "session_booked:booking-1",
    attempts: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function supabaseMock(rows, preference = null) {
  const calls = { rpc: [], updates: [] };
  const client = {
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      return { data: rows, error: null };
    },
    from: (table) => {
      if (table === "email_automation_preferences") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: preference, error: null }) }) }) };
      }
      assert.equal(table, "email_event_outbox");
      return { update: (value) => ({ eq: () => ({ eq: async () => {
        calls.updates.push(value);
        return { error: null };
      } }) }) };
    },
  };
  return { client, calls };
}

test("requires deliberate activation, all keys and a UTC cutover", () => {
  assert.equal(plunkLifecycleStatus().enabled, true);
  process.env.PLUNK_LIFECYCLE_ENABLED = "false";
  assert.equal(plunkLifecycleStatus().reason, "plunk_lifecycle_disabled");
  process.env.PLUNK_LIFECYCLE_ENABLED = "true";
  process.env.SENDER_INTEGRATION_ENABLED = "true";
  assert.equal(plunkLifecycleStatus().reason, "dual_provider_enabled");
  process.env.SENDER_INTEGRATION_ENABLED = "false";
  delete process.env.PLUNK_PUBLIC_KEY;
  assert.match(plunkLifecycleStatus().reason, /PLUNK_PUBLIC_KEY/);
  process.env.PLUNK_PUBLIC_KEY = "pk-test-public";
  process.env.PLUNK_LIFECYCLE_CUTOVER_AT = "2026-10-03";
  assert.equal(plunkLifecycleStatus().reason, "invalid_plunk_cutover");
});

test("creates missing contact unsubscribed before tracking a lifecycle event", async () => {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("/contacts?")) return Response.json({ data: [], hasMore: false });
    if (String(url).endsWith("/contacts")) return Response.json({ id: "cnt_1", email: "reader@example.test", subscribed: false }, { status: 201 });
    if (String(url).endsWith("/v1/track")) return Response.json({ success: true, data: { event: "evt_1" } });
    throw new Error("unexpected request");
  };
  const { client, calls } = supabaseMock([row()]);
  const result = await processPlunkOutbox(client);
  assert.equal(result.sent, 1);
  assert.equal(calls.rpc[0].name, "claim_plunk_email_event_outbox");
  assert.equal(calls.rpc[0].args.p_cutover_at, "2026-10-03T00:00:00.000Z");
  assert.equal(requests.length, 3);
  assert.equal(JSON.parse(requests[1].init.body).subscribed, false);
  const tracked = JSON.parse(requests[2].init.body);
  assert.equal(tracked.event, "session_booked");
  assert.equal(tracked.subscribed, undefined);
  assert.equal(tracked.data.marketing_email_enabled, undefined);
  assert.deepEqual(tracked.data.session_title, { value: "Focus", persistent: false });
  assert.equal(requests[2].init.headers.Authorization, "Bearer pk-test-public");
  assert.equal(requests[2].init.headers["Idempotency-Key"], "session_booked:booking-1");
  assert.equal(calls.updates.at(-1).status, "sent");
});

test("existing unsubscribed contact is not resubscribed by a lifecycle event", async () => {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("/contacts?")) return Response.json({
      data: [{ id: "cnt_1", email: "reader@example.test", subscribed: false }], hasMore: false,
    });
    if (String(url).endsWith("/v1/track")) return Response.json({ success: true });
    throw new Error("unexpected contact mutation");
  };
  const { client } = supabaseMock([row()]);
  assert.equal((await processPlunkOutbox(client)).sent, 1);
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[1].init.body).subscribed, undefined);
});

test("unrelated preference edit cannot resubscribe a Plunk opt-out", async () => {
  let patchBody;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/contacts?")) return Response.json({
      data: [{ id: "cnt_1", email: "reader@example.test", subscribed: false }], hasMore: false,
    });
    if (String(url).endsWith("/contacts/cnt_1")) {
      patchBody = JSON.parse(init.body);
      return Response.json({ id: "cnt_1", email: "reader@example.test", subscribed: false });
    }
    throw new Error("unexpected request");
  };
  const { client } = supabaseMock([row({ event_type: "subscriber_preferences_updated",
    properties: { marketing_email_enabled: true, marketing_consent_changed: false } })],
    { marketing_email_enabled: true, timezone: "Europe/Kyiv" });
  assert.equal((await processPlunkOutbox(client)).sent, 1);
  assert.equal(patchBody.subscribed, undefined);
  assert.equal(patchBody.data.marketing_email_enabled, true);
  assert.equal(patchBody.data.first_name, "Friend");
});

test("explicit new consent changes Plunk subscription", async () => {
  let patchBody;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/contacts?")) return Response.json({
      data: [{ id: "cnt_1", email: "reader@example.test", subscribed: false }], hasMore: false,
    });
    if (String(url).endsWith("/contacts/cnt_1")) {
      patchBody = JSON.parse(init.body);
      return Response.json({ id: "cnt_1", email: "reader@example.test", subscribed: true });
    }
    throw new Error("unexpected request");
  };
  const { client } = supabaseMock([row({ event_type: "subscriber_preferences_updated",
    properties: { marketing_email_enabled: true, marketing_consent_changed: true } })],
    { marketing_email_enabled: true, timezone: "Europe/Kyiv" });
  assert.equal((await processPlunkOutbox(client)).sent, 1);
  assert.equal(patchBody.subscribed, true);
});

test("old but post-cutover event is cancelled rather than delivered", async () => {
  process.env.PLUNK_LIFECYCLE_CUTOVER_AT = "2026-09-01T00:00:00Z";
  globalThis.fetch = async () => { throw new Error("should not call Plunk"); };
  const { client, calls } = supabaseMock([row({ created_at: "2026-09-02T00:01:00Z" })]);
  const result = await processPlunkOutbox(client);
  assert.equal(result.cancelled, 1);
  assert.equal(calls.updates[0].last_error, "plunk_event_expired");
});

test("accepted idempotency retry is marked delivered without a second workflow event", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes("/contacts?")) return Response.json({
      data: [{ id: "cnt_1", email: "reader@example.test" }], hasMore: false,
    });
    return Response.json({ success: false, error: { code: "IDEMPOTENCY_KEY_REUSED",
      details: { originalRequest: "POST /v1/track", originalStatusCode: 200 } } }, { status: 409 });
  };
  const { client, calls } = supabaseMock([row()]);
  assert.equal((await processPlunkOutbox(client)).sent, 1);
  assert.equal(calls.updates.at(-1).status, "sent");
});

test("approved-inbox suite includes template variables without asserting marketing consent", async () => {
  const tracked = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/contacts?")) return Response.json({
      data: [{ id: "cnt_test", email: "owner@example.test", subscribed: false }], hasMore: false,
    });
    if (String(url).endsWith("/v1/track")) {
      tracked.push(JSON.parse(init.body));
      return Response.json({ success: true });
    }
    throw new Error("unexpected request");
  };
  const result = await emitPlunkTestSuite("owner@example.test");
  assert.equal(result.failed, 0);
  assert.equal(result.sent, tracked.length);
  assert.deepEqual(tracked[0].data.first_name, { value: "MySession Test", persistent: false });
  assert.deepEqual(tracked[0].data.session_url, { value: "https://mysession.club/sessions", persistent: false });
  assert.equal(tracked[0].data.marketing_email_enabled, undefined);
});
