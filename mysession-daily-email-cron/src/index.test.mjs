import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["mysession-daily-email-cron/src/index.ts"],
  bundle: true, platform: "neutral", format: "esm", write: false });
const { default: worker } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const env = {
  MYSESSION_DAILY_EMAIL_CRON_URL: "https://www.mysession.club/api/livekit/admin",
  DAILY_SCHEDULE_CRON_SECRET: "test-secret",
  DAILY_SCHEDULE_CRON_LIMIT: "2",
};

test("manual trigger batches all daily-enabled recipients without exposing address lists", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const body = calls.length === 1
      ? { ok: true, selectedCount: 2, candidatesCount: 3, sentCount: 2, failedCount: 0 }
      : { ok: true, selectedCount: 1, candidatesCount: 1, sentCount: 1, failedCount: 0 };
    return Response.json(body);
  };
  const response = await worker.fetch(new Request("https://cron.example.test/run", {
    headers: { "x-cron-secret": env.DAILY_SCHEDULE_CRON_SECRET },
  }), env);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.batchCount, 2);
  assert.equal(result.sentCount, 3);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /cronAction=daily_schedule_send_all_active/);
  assert.equal(calls[0].init.headers["x-cron-secret"], env.DAILY_SCHEDULE_CRON_SECRET);
  assert.doesNotMatch(JSON.stringify(result), /example@/);
});

test("manual trigger requires the cron secret", async () => {
  globalThis.fetch = () => { throw new Error("unexpected fetch"); };
  const response = await worker.fetch(new Request("https://cron.example.test/run"), env);
  assert.equal(response.status, 401);
});

test("provider or API failure stops batching without logging recipients", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ error: "daily_preferences_unavailable", recipients: ["private@example.test"] }, { status: 503 });
  };
  const response = await worker.fetch(new Request("https://cron.example.test/run", {
    headers: { "x-cron-secret": env.DAILY_SCHEDULE_CRON_SECRET },
  }), env);
  const result = await response.json();
  assert.equal(response.status, 502);
  assert.equal(result.error, "daily_preferences_unavailable");
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /private@example/);
});

test("reports partial Plunk failures as an unsuccessful cron run", async () => {
  globalThis.fetch = async () => Response.json({ ok: true, selectedCount: 1,
    candidatesCount: 1, sentCount: 0, failedCount: 1 });
  const response = await worker.fetch(new Request("https://cron.example.test/run", {
    headers: { "x-cron-secret": env.DAILY_SCHEDULE_CRON_SECRET },
  }), env);
  const result = await response.json();
  assert.equal(response.status, 502);
  assert.equal(result.ok, false);
  assert.equal(result.failedCount, 1);
});
