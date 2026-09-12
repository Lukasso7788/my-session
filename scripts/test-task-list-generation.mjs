import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";

const source = readFileSync(new URL("../api/templates.ts", import.meta.url), "utf8")
  .replace(/^import .*;\r?$/gm, "").replace("export default async function handler", "async function handler");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const id = "12345678-1234-4234-8234-123456789012";
const plan = { id, user_id: "user", title: "Exam preparation" };
const tasks = ["Read chapter one", "Practise questions", "Review mistakes"];
const ok = (data) => ({ data, error: null });

function harness({ authenticated = true, entitlement = { plan: "pro_monthly", status: "active" }, results = [], output = { title: plan.title, tasks }, aiStatus = "completed", aiOk = true } = {}) {
  const calls = [];
  let aiCalls = 0;
  const db = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: "user" } : null }, error: null }) },
    from(table) {
      const call = { table, filters: [], operation: "select" };
      calls.push(call);
      const query = {
        select() { return query; },
        eq(...filter) { call.filters.push(filter); return query; },
        order() { return query; },
        insert(rows) { call.operation = "insert"; call.rows = rows; return query; },
        upsert(rows, options) { call.operation = "upsert"; call.rows = rows; call.options = options; return query; },
        delete() { call.operation = "delete"; return query; },
        single() { return query; },
        maybeSingle() { return query; },
        then(resolve, reject) {
          const value = table === "user_entitlements" ? ok(entitlement) : results.shift();
          if (!value) return Promise.reject(new Error("Unexpected database call: " + table)).then(resolve, reject);
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const clients = [];
  const createClient = (...args) => { clients.push(args); return db; };
  const fetch = async (_url, options) => {
    aiCalls++;
    const input = JSON.parse(options.body);
    assert.equal(input.store, false);
    assert.equal(input.text.format.strict, true);
    assert.ok(options.signal);
    return { ok: aiOk, json: async () => ({ status: aiStatus, output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
  };
  const handler = new Function("createClient", "createHash", "process", "fetch", js + "\nreturn handler;")(
    createClient, createHash, { env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "server-secret", OPENAI_API_KEY: "test-only" } }, fetch);
  const run = async (body = {}, token = "user-token") => {
    const res = { code: 200, setHeader() {}, status(code) { res.code = code; return res; }, json(data) { res.body = data; return res; } };
    await handler({ method: "POST", headers: { authorization: token ? "Bearer " + token : "" }, body: { action: "task-list-generate", goal: "Prepare for my biology exam", requestId: id, ...body } }, res);
    return res;
  };
  return { run, calls, clients, aiCalls: () => aiCalls };
}

test("anonymous and invalid sessions are rejected before AI or DB writes", async () => {
  for (const authenticated of [true, false]) {
    const h = harness({ authenticated });
    assert.equal((await h.run({}, authenticated ? "" : "bad")).code, 401);
    assert.equal(h.aiCalls(), 0);
    assert.equal(h.calls.length, 0);
  }
});
test("Free and expired Pro cannot bypass the server gate", async () => {
  for (const entitlement of [null, { plan: "free", status: "active" }, { plan: "pro_monthly", status: "expired" }]) {
    const h = harness({ entitlement });
    assert.equal((await h.run()).code, 403);
    assert.equal(h.aiCalls(), 0);
  }
});
test("invalid input is rejected before OpenAI", async () => {
  const h = harness();
  assert.equal((await h.run({ goal: "short" })).code, 400);
  assert.equal((await h.run({ requestId: "invalid" })).code, 400);
  assert.equal(h.aiCalls(), 0);
});
test("Pro gets a titled, ordered, persisted list using caller JWT and ownership", async () => {
  const h = harness({ results: [ok(null), ok(plan), ok(tasks.map((text) => ({ text })))] });
  const result = await h.run();
  assert.equal(result.code, 200);
  assert.equal(result.body.plan.id, id);
  assert.equal(result.body.items.length, 3);
  const write = h.calls.find((call) => call.operation === "upsert");
  assert.deepEqual(write.rows.map((row) => row.sort_order), [0, 1, 2]);
  assert.ok(write.rows.every((row) => row.user_id === "user" && row.plan_id === id && !row.completed));
  assert.equal(new Set(write.rows.map((row) => row.id)).size, 3);
  assert.equal(h.clients.at(-1)[2].global.headers.Authorization, "Bearer user-token");
});
test("completed request retry returns saved result without another AI call", async () => {
  const h = harness({ results: [ok(plan), ok(tasks.map((text) => ({ text })))] });
  assert.equal((await h.run()).code, 200);
  assert.equal(h.aiCalls(), 0);
  assert.ok(h.calls.every((call) => call.operation === "select"));
});
test("malformed, incomplete, or failed AI output never creates a list", async () => {
  for (const options of [{ output: { title: "", tasks } }, { output: { title: "Plan", tasks: [1, 2, 3] } }, { aiStatus: "incomplete" }, { aiOk: false }]) {
    const h = harness({ ...options, results: [ok(null)] });
    assert.equal((await h.run()).code, 502);
    assert.ok(h.calls.every((call) => call.operation === "select"));
  }
});
test("confirmed task insert failure cleans up the new empty parent", async () => {
  const h = harness({ results: [ok(null), ok(plan), { error: { code: "23514" } }, ok(null)] });
  assert.equal((await h.run()).code, 502);
  assert.equal(h.calls.at(-1).operation, "delete");
  assert.deepEqual(h.calls.at(-1).filters, [["id", id], ["user_id", "user"]]);
});
test("uncertain network failure does not delete a possibly committed list", async () => {
  const h = harness({ results: [ok(null), ok(plan), { error: { code: "", message: "fetch failed" } }] });
  assert.equal((await h.run()).code, 502);
  assert.ok(h.calls.every((call) => call.operation !== "delete"));
});
test("interrupted empty parent can be recovered without inserting another list", async () => {
  const h = harness({ results: [ok(plan), ok([]), ok(tasks.map((text) => ({ text })))] });
  assert.equal((await h.run()).code, 200);
  assert.ok(!h.calls.some((call) => call.table === "focus_plans" && call.operation === "insert"));
  assert.equal(h.calls.at(-1).options.ignoreDuplicates, true);
});

test("dialog locks rapid clicks and reuses request ID after a failed response", async () => {
  const component = readFileSync(new URL("../src/components/GenerateTaskListDialog.tsx", import.meta.url), "utf8");
  const action = component.slice(component.indexOf("  const generate ="), component.indexOf("\n  return ("));
  const emitted = ts.transpileModule(action, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const requests = [];
  const created = [];
  const errors = [];
  const env = {
    lock: { current: false }, alive: { current: true }, access: "pro",
    goal: "Prepare for my biology exam", request: { current: { goal: "", id } },
    userId: "user", setBusy() {}, setError: (value) => errors.push(value),
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "token", user: { id: "user" } } } }) } },
    onCreated: (value) => created.push(value),
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      if (requests.length === 1) {
        await pending;
        return { ok: false, json: async () => ({ error: "Please retry" }) };
      }
      return { ok: true, json: async () => ({ plan, items: tasks }) };
    },
  };
  const generate = new Function(...Object.keys(env), emitted + "\nreturn generate;")(...Object.values(env));
  const first = generate();
  await generate();
  await Promise.resolve();
  assert.equal(requests.length, 1);
  release();
  await first;
  assert.ok(errors.includes("Please retry"));
  assert.equal(created.length, 0);
  await generate();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.equal(created.length, 1);
});
