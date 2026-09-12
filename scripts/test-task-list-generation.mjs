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
  const aiInputs = [];
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
    aiInputs.push(JSON.parse(input.input));
    assert.equal(input.store, false);
    assert.equal(input.text.format.strict, true);
    assert.ok(options.signal);
    return { ok: aiOk, json: async () => ({ status: aiStatus, output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
  };
  const handler = new Function("createClient", "createHash", "process", "fetch", js + "\nreturn handler;")(
    createClient, createHash, { env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "server-secret", OPENAI_API_KEY: "test-only" } }, fetch);
  const run = async (body = {}, token = "user-token") => {
    const res = { code: 200, setHeader() {}, status(code) { res.code = code; return res; }, json(data) { res.body = data; return res; } };
    await handler({ method: "POST", headers: { authorization: token ? "Bearer " + token : "" }, body: { action: "task-list-approve", draft: { title: plan.title, tasks }, goal: "Prepare for my biology exam", requestId: id, ...body } }, res);
    return res;
  };
  return { run, calls, clients, aiInputs, aiCalls: () => aiCalls };
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
    assert.equal((await h.run({ action: "task-list-generate", draft: null })).code, 403);
    assert.equal((await h.run({ action: "task-list-generate", adjustment: "More detail" })).code, 403);
    assert.equal(h.aiCalls(), 0);
  }
});
test("invalid input is rejected before OpenAI", async () => {
  const h = harness();
  assert.equal((await h.run({ action: "task-list-generate", draft: null, goal: "short" })).code, 400);
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
  assert.equal(h.aiCalls(), 0, "approval must never ask AI to rewrite manual edits");
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
    assert.equal((await h.run({ action: "task-list-generate", draft: null })).code, 502);
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

test("dialog locks rapid approvals and reuses the exact approved snapshot after failure", async () => {
  const component = readFileSync(new URL("../src/components/GenerateTaskListDialog.tsx", import.meta.url), "utf8");
  const action = component.slice(component.indexOf("  const run ="), component.indexOf("\n  return ("));
  const emitted = ts.transpileModule(action, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const requests = [];
  const created = [];
  const errors = [];
  const env = {
    lock: { current: false }, alive: { current: true }, access: "pro",
    goal: "Prepare for my biology exam", approval: { current: null },
    draft: { title: "My edited title", tasks: ["My edited task"] }, adjustment: "",
    validDraft: (value) => !!value?.title && value.tasks.length > 0,
    userId: "user", setBusy() {}, setApprovalPending() {}, setDraft() {}, setAdjustment() {}, setError: (value) => errors.push(value),
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
  const run = new Function(...Object.keys(env), emitted + "\nreturn run;")(...Object.values(env));
  const first = run("approve");
  await run("approve");
  await Promise.resolve();
  assert.equal(requests.length, 1);
  release();
  await first;
  assert.ok(errors.includes("Please retry"));
  assert.equal(created.length, 0);
  await run("generate");
  assert.equal(requests.length, 1, "no regeneration while an approval is unresolved");
  await run("approve");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.deepEqual(requests[0].draft, { title: "My edited title", tasks: ["My edited task"] });
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(created.length, 1);
});

test("generate and regenerate return editable drafts without reading or writing task tables", async () => {
  const h = harness();
  const first = await h.run({ action: "task-list-generate", draft: null });
  assert.equal(first.code, 200);
  assert.deepEqual(first.body.draft, { title: plan.title, tasks });
  const currentDraft = { title: "Manually edited plan", tasks: ["Keep my custom task", "Split this task"] };
  const revised = await h.run({ action: "task-list-generate", goal: "Refined goal: prepare for chemistry", draft: currentDraft, adjustment: "Keep task 1, split task 2 into five smaller steps." });
  assert.equal(revised.code, 200);
  assert.equal(h.aiCalls(), 2);
  assert.deepEqual(h.aiInputs[1], { goal: "Refined goal: prepare for chemistry", currentDraft, adjustment: "Keep task 1, split task 2 into five smaller steps." });
  assert.ok(h.calls.every((call) => call.table === "user_entitlements"));
});

test("approval validates edited title and tasks before saving", async () => {
  for (const draft of [{ title: "", tasks }, { title: "Plan", tasks: [""] }, { title: "Plan", tasks: [] },
    { title: "Plan", tasks: Array(31).fill("Too many") }, { title: "Plan", tasks: [4] }]) {
    const h = harness();
    assert.equal((await h.run({ draft })).code, 400);
    assert.equal(h.aiCalls(), 0);
    assert.ok(h.calls.every((call) => call.table === "user_entitlements"));
  }
});

test("more detailed plans may have up to 30 tasks", async () => {
  const output = { title: "Detailed plan", tasks: Array.from({ length: 30 }, (_, i) => "Concrete step " + (i + 1)) };
  const h = harness({ output });
  assert.equal((await h.run({ action: "task-list-generate", draft: null })).body.draft.tasks.length, 30);
});

test("dialog previews, sends current edits and goal on regeneration, and preserves draft on failure", async () => {
  const component = readFileSync(new URL("../src/components/GenerateTaskListDialog.tsx", import.meta.url), "utf8");
  const action = component.slice(component.indexOf("  const run ="), component.indexOf("\n  return ("));
  const emitted = ts.transpileModule(action, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const requests = [];
  const created = [];
  const env = {
    lock: { current: false }, alive: { current: true }, approval: { current: null },
    access: "pro", goal: "Prepare for my biology exam", draft: null, adjustment: "",
    validDraft: (value) => !!value?.title && value.tasks.length > 0,
    userId: "user", setBusy() {}, setApprovalPending() {}, setError() {},
    setDraft(value) { env.draft = value; }, setAdjustment(value) { env.adjustment = value; },
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "token", user: { id: "user" } } } }) } },
    onCreated: (value) => created.push(value),
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return requests.length === 1
        ? { ok: true, json: async () => ({ draft: { title: plan.title, tasks } }) }
        : { ok: false, status: 502, json: async () => ({ error: "AI unavailable" }) };
    },
  };
  const run = () => new Function(...Object.keys(env), emitted + "\nreturn run;")(...Object.values(env));
  await run()("generate");
  assert.equal(created.length, 0, "preview must not add a saved list");
  assert.deepEqual(env.draft, { title: plan.title, tasks });
  env.draft = { title: "My custom title", tasks: ["Keep this custom task", "Break this down"] };
  env.goal = "A refined goal with new constraints";
  env.adjustment = "Keep the first task and split the second into five";
  const before = structuredClone(env.draft);
  await run()("generate");
  assert.deepEqual(requests[1].draft, before);
  assert.equal(requests[1].goal, env.goal);
  assert.equal(requests[1].adjustment, env.adjustment);
  assert.deepEqual(env.draft, before, "failed regeneration must preserve manual work");
  assert.ok(env.adjustment, "failure must preserve adjustment instructions");
  assert.equal(created.length, 0);
});
