import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { missingPlunkEnvironment, sendPlunkEmail } from "./plunk.ts";

const names = ["PLUNK_API_URL", "PLUNK_SECRET_KEY", "PLUNK_FROM_EMAIL", "PLUNK_FROM_NAME"];
const originalEnv = new Map(names.map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;

beforeEach(() => {
  process.env.PLUNK_API_URL = "https://mail-api.example.test/";
  process.env.PLUNK_SECRET_KEY = "test-secret-do-not-log";
  process.env.PLUNK_FROM_EMAIL = "hello@example.test";
  process.env.PLUNK_FROM_NAME = "MySession";
  console.error = () => {};
});

afterEach(() => {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

const request = {
  to: "reader@example.test",
  subject: "Existing subject",
  body: "<p>Existing HTML</p>",
  replyTo: "support@example.test",
  headers: { "X-MySession-Email-Type": "daily_schedule" },
  idempotencyKey: "mysession-daily-schedule-user-2026-09-26",
};

test("sends existing content and stable key to Plunk", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({
      success: true,
      data: { emails: [{ email: "plunk-email-id" }] },
    }), { status: 200 });
  };

  assert.deepEqual(await sendPlunkEmail(request), { id: "plunk-email-id" });
  assert.equal(captured.url, "https://mail-api.example.test/v1/send");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Authorization, "Bearer test-secret-do-not-log");
  assert.equal(captured.init.headers["Idempotency-Key"], request.idempotencyKey);
  assert.deepEqual(JSON.parse(captured.init.body), {
    to: request.to,
    from: { name: "MySession", email: "hello@example.test" },
    subject: request.subject,
    body: request.body,
    reply: request.replyTo,
    headers: request.headers,
  });
});

test("rejects HTTP failure even when body claims success", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 503 });
  await assert.rejects(sendPlunkEmail(request), /plunk_send_failed:503/);
});

test("rejects unsuccessful Plunk body on HTTP 200", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: false,
    error: { code: "SES_SANDBOX", requestId: "req-1" },
  }), { status: 200 });
  await assert.rejects(sendPlunkEmail(request), /plunk_send_failed:200:SES_SANDBOX:req-1/);
});

test("does not treat a reused idempotency key as a new successful send", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: false,
    error: { code: "IDEMPOTENCY_KEY_REUSED" },
  }), { status: 409 });
  await assert.rejects(sendPlunkEmail(request), /plunk_send_failed:409:IDEMPOTENCY_KEY_REUSED/);
});

test("fails before sending when required server-only configuration is absent", async () => {
  delete process.env.PLUNK_SECRET_KEY;
  globalThis.fetch = async () => { throw new Error("fetch must not run"); };
  assert.deepEqual(missingPlunkEnvironment(), ["PLUNK_SECRET_KEY"]);
  await assert.rejects(sendPlunkEmail(request), /missing_plunk_env:PLUNK_SECRET_KEY/);
});

test("redacts the API key from transport errors and logs", async () => {
  const logs = [];
  console.error = (...args) => logs.push(args);
  globalThis.fetch = async () => { throw new Error("failed with test-secret-do-not-log"); };
  await assert.rejects(sendPlunkEmail(request), /\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(logs), /test-secret-do-not-log/);
});

test("logs useful Plunk response details without leaking the API key", async () => {
  const logs = [];
  console.error = (...args) => logs.push(args);
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: false,
    error: {
      code: "INVALID_API_KEY",
      message: "bad test-secret-do-not-log",
      requestId: "request-123",
    },
  }), { status: 401 });
  await assert.rejects(sendPlunkEmail(request), /plunk_send_failed:401:INVALID_API_KEY:request-123/);
  assert.match(JSON.stringify(logs), /\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(logs), /test-secret-do-not-log/);
});
