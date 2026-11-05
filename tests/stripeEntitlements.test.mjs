import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Stripe -> user_entitlements sync, access policy, webhook ledger and
// reconciliation. Everything runs against an in-memory Stripe and database;
// no network, no real IDs.
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");

const mockPlugin = {
  name: "billing-test-mocks",
  setup(builder) {
    builder.onResolve({ filter: /^(stripe|@supabase\/supabase-js)$/ }, (args) => ({ path: args.path, namespace: "billing-mock" }));
    builder.onLoad({ filter: /.*/, namespace: "billing-mock" }, (args) => ({
      contents: args.path === "stripe"
        ? "export default class Stripe { constructor() { return globalThis.__billingTest.stripe; } }"
        : "export function createClient() { return globalThis.__billingTest.db; }",
      loader: "js",
    }));
  },
};

async function importTs(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin] });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

// ---------------------------------------------------------------------------
// In-memory Supabase (only what the billing code uses)

const UNIQUE = { user_entitlements: "user_id", stripe_webhook_events: "id" };

function createDb() {
  const tables = new Map();
  const failures = [];
  const rpcCalls = [];
  const rows = (name) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name); };

  function query(table) {
    const filters = [];
    let op = "select";
    let payload = null;
    let returning = false;
    let single = false;
    let limit = Infinity;
    const matches = (row) => filters.every((filter) => filter(row));
    const builder = {
      select() { if (op !== "select") returning = true; return builder; },
      eq(column, value) { filters.push((row) => row[column] === value); return builder; },
      in(column, values) { filters.push((row) => values.includes(row[column])); return builder; },
      not(column, _op, value) { filters.push((row) => row[column] !== value && row[column] !== undefined); return builder; },
      or(expression) {
        // Top-level commas only: "status.in.(active,trialing)" is one part.
        const parts = expression.split(/,(?![^(]*\))/).map((part) => {
          const [column, operator, ...rest] = part.split(".");
          const value = rest.join(".");
          return (row) => operator === "is" ? row[column] == null
            : operator === "in" ? value.replace(/^\(|\)$/g, "").split(",").includes(row[column])
            : operator === "lt" ? row[column] != null && Date.parse(row[column]) < Date.parse(value)
            : operator === "gt" ? row[column] != null && Date.parse(row[column]) > Date.parse(value) : false;
        });
        filters.push((row) => parts.some((part) => part(row)));
        return builder;
      },
      order() { return builder; },
      limit(count) { limit = count; return builder; },
      range(from, to) { limit = to - from + 1; return builder; },
      maybeSingle() { single = true; return builder; },
      insert(value) { op = "insert"; payload = value; return builder; },
      update(value) { op = "update"; payload = value; return builder; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    function run() {
      const failure = failures.findIndex((entry) => entry.table === table && entry.op === op);
      if (failure >= 0) {
        const [entry] = failures.splice(failure, 1);
        return { data: null, error: { code: entry.code || "XX000", message: entry.message || "injected failure" } };
      }
      const list = rows(table);
      if (op === "insert") {
        const key = UNIQUE[table];
        if (key && list.some((row) => row[key] === payload[key])) return { data: null, error: { code: "23505", message: "duplicate key" } };
        list.push({ ...payload });
        return { data: null, error: null };
      }
      if (op === "update") {
        const hit = list.filter(matches);
        hit.forEach((row) => Object.assign(row, payload));
        return { data: returning ? hit.map((row) => ({ ...row })) : null, error: null };
      }
      const found = list.filter(matches).slice(0, limit).map((row) => ({ ...row }));
      return { data: single ? found[0] ?? null : found, error: null };
    }
    return builder;
  }

  return {
    tables,
    rows,
    rpcCalls,
    failNext(table, op, extra = {}) { failures.push({ table, op, ...extra }); },
    from: (table) => query(table),
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: null, error: null }; },
    auth: {
      admin: { getUserById: async () => ({ data: { user: null } }) },
      getUser: async (token) => {
        const userId = String(token).replace(/^token-/, "");
        return token.startsWith("token-") ? { data: { user: { id: userId, email: null, user_metadata: {} } }, error: null } : { data: { user: null }, error: new Error("bad token") };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory Stripe

const DAY = 86_400;
const nowSec = () => Math.floor(Date.now() / 1000);

function createStripe() {
  const subscriptions = new Map();
  const sessions = new Map();
  const events = [];
  return {
    subscriptions: {
      retrieve: async (id) => {
        if (!subscriptions.has(id)) throw Object.assign(new Error(`No such subscription: ${id}`), { code: "resource_missing" });
        return structuredClone(subscriptions.get(id));
      },
    },
    checkout: { sessions: { retrieve: async (id) => structuredClone(sessions.get(id)) } },
    events: {
      list: async ({ created }) => ({ data: events.filter((event) => event.created >= created.gte).slice().reverse(), has_more: false }),
    },
    webhooks: {
      constructEvent: (raw, signature) => {
        if (signature !== "valid-signature") throw new Error("No signatures found matching the expected signature");
        return JSON.parse(raw.toString("utf8"));
      },
    },
    _subscriptions: subscriptions,
    _sessions: sessions,
    _events: events,
  };
}

function subscription({ id = "sub_1", user = "user-a", customer = "cus_1", status = "active", start = nowSec() - 5 * DAY, end = nowSec() + 25 * DAY, cancelAtPeriodEnd = false, endedAt = null, created = nowSec() - 5 * DAY, plan = "pro_monthly", trialStart = null, trialEnd = null } = {}) {
  return {
    id, object: "subscription", customer, status, created,
    cancel_at_period_end: cancelAtPeriodEnd, cancel_at: null, canceled_at: endedAt, ended_at: endedAt, schedule: null,
    trial_start: trialStart, trial_end: trialEnd,
    metadata: user ? { checkout_kind: "subscription", plan, entitlement_plan: plan, supabase_user_id: user } : {},
    items: { data: [{ current_period_start: start, current_period_end: end, price: { recurring: { interval: plan === "pro_yearly" ? "year" : "month" } } }] },
  };
}

function checkoutSession({ id = "cs_test_1", user = "user-a", mode = "subscription", plan = "pro_monthly", sub = "sub_1", status = "complete", paymentStatus = "paid", customer = "cus_1", amountTotal = 1000 } = {}) {
  return {
    id, object: "checkout.session", mode, status, payment_status: paymentStatus, customer, subscription: mode === "subscription" ? sub : null,
    amount_total: amountTotal, currency: "usd", payment_intent: mode === "payment" ? "pi_1" : null,
    metadata: { checkout_kind: "subscription", plan, entitlement_plan: plan, supabase_user_id: user },
  };
}

let eventCounter = 0;
function event(type, object, extra = {}) {
  eventCounter += 1;
  return { id: `evt_${eventCounter}`, object: "event", type, created: nowSec() - 100 + eventCounter, livemode: false, data: { object, ...extra } };
}

// One shared world for the imported handlers (they bind their clients on import).
globalThis.__billingTest = { stripe: createStripe(), db: createDb() };
function resetWorld() {
  const stripe = createStripe();
  const db = createDb();
  Object.assign(globalThis.__billingTest.stripe, stripe);
  // Keep the same db object identity the handlers captured.
  const shared = globalThis.__billingTest.db;
  shared.tables.clear();
  shared.rpcCalls.length = 0;
  return { stripe: globalThis.__billingTest.stripe, db: shared, freshDb: db };
}

process.env.BILLING_RECONCILE_SECRET = "reconcile-test-secret";
const billing = await importTs("src/lib/billing.ts");
const sync = await importTs("api/_lib/stripeEntitlementSync.ts");
const audit = await importTs("api/_lib/entitlementAudit.ts");
const { reconcileStripeEntitlements } = await importTs("api/_lib/stripeReconcile.ts");
const webhook = await importTs("api/stripe/webhook.ts");
const { default: confirmHandler } = await importTs("api/billing/confirm-checkout-session.ts");
const { default: checkoutHandler } = await importTs("api/billing/create-checkout-session.ts");

const deps = () => ({ stripe: globalThis.__billingTest.stripe, store: sync.createSupabaseBillingStore(globalThis.__billingTest.db) });
const entitlement = (userId = "user-a") => globalThis.__billingTest.db.rows("user_entitlements").find((row) => row.user_id === userId) ?? null;
const hasPro = (userId = "user-a", now = new Date()) => billing.hasUnlimitedAccess(entitlement(userId), now);

function response() {
  return {
    statusCode: 200, body: undefined, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

async function deliver(evt, signature = "valid-signature") {
  const raw = Buffer.from(JSON.stringify(evt));
  const res = response();
  await webhook.default({ method: "POST", headers: { "stripe-signature": signature }, async *[Symbol.asyncIterator]() { yield raw; } }, res);
  return res;
}

async function confirm(sessionId, userId = "user-a") {
  const res = response();
  await confirmHandler({ method: "POST", headers: { authorization: `Bearer token-${userId}` }, body: { sessionId } }, res);
  return res;
}

const quiet = async (fn) => {
  const previous = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = previous; }
};

// ---------------------------------------------------------------------------
// Access policy (frontend and server share src/lib/billing.ts)

test("monthly/yearly Pro needs a current paid period; active alone is not enough", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const row = (extra) => ({ plan: "pro_monthly", status: "active", ...extra });
  assert.equal(billing.hasUnlimitedAccess(row({ current_period_end: "2026-11-01T00:00:00Z" }), now), true);
  // The confirmed production case: active, period ended 2026-06-21.
  assert.equal(billing.hasUnlimitedAccess(row({ current_period_end: "2026-06-21T00:00:00Z" }), now), false);
  assert.equal(billing.hasUnlimitedAccess(row({ current_period_end: null }), now), false);
  assert.equal(billing.hasUnlimitedAccess(row({}), now), false);
  assert.equal(billing.hasUnlimitedAccess(row({ current_period_end: "not a date" }), now), false);
  assert.equal(billing.hasUnlimitedAccess(row({ current_period_end: now.toISOString() }), now), false, "ends exactly now");
  assert.equal(billing.hasUnlimitedAccess({ plan: "pro_yearly", status: "canceled", current_period_end: "2027-01-01T00:00:00Z" }, now), false);
  assert.equal(billing.isEntitlementActive(row({ current_period_end: null }), now), false);
});

test("FM Pro and Lifetime keep access without dates; trials follow their own end", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  for (const plan of ["founding_free", "lifetime"]) {
    assert.equal(billing.hasUnlimitedAccess({ plan, status: "active", current_period_end: null }, now), true);
    assert.equal(billing.hasUnlimitedAccess({ plan, status: "active", current_period_end: "2020-01-01T00:00:00Z" }, now), true);
    assert.equal(billing.hasUnlimitedAccess({ plan, status: "canceled" }, now), false);
  }
  const trial = { plan: "pro_monthly", status: "trialing", current_period_end: "2030-01-01T00:00:00Z" };
  assert.equal(billing.hasUnlimitedAccess({ ...trial, trial_ends_at: "2026-11-01T00:00:00Z" }, now), true);
  assert.equal(billing.hasUnlimitedAccess({ ...trial, trial_ends_at: "2026-10-01T00:00:00Z" }, now), false, "a trial never borrows the paid period");
  assert.equal(billing.hasUnlimitedAccess({ ...trial, trial_ends_at: null }, now), false);
});

// ---------------------------------------------------------------------------
// Subscription lifecycle through the real webhook handler

test("first payment: Pro starts only once Stripe reports the subscription active", async () => {
  const { stripe } = resetWorld();
  const end = nowSec() + 30 * DAY;
  stripe._subscriptions.set("sub_1", subscription({ end }));
  stripe._sessions.set("cs_test_1", checkoutSession());
  const res = await deliver(event("checkout.session.completed", checkoutSession()));
  assert.equal(res.statusCode, 200);
  const row = entitlement();
  assert.equal(row.plan, "pro_monthly");
  assert.equal(row.status, "active");
  assert.equal(Date.parse(row.current_period_end), end * 1000, "period end comes from Stripe, not now+30 days");
  assert.equal(row.stripe_subscription_id, "sub_1");
  assert.equal(row.stripe_customer_id, "cus_1");
  assert.equal(hasPro(), true);
});

test("renewal: invoice.paid extends the paid period to Stripe's new period end", async () => {
  const { stripe } = resetWorld();
  stripe._subscriptions.set("sub_1", subscription({ start: nowSec() - 40 * DAY, end: nowSec() - 10 * DAY + 3600 }));
  await sync.syncSubscription(deps(), "sub_1");
  const renewedEnd = nowSec() + 20 * DAY;
  stripe._subscriptions.set("sub_1", subscription({ start: nowSec() - 10 * DAY, end: renewedEnd }));
  const invoice = { id: "in_renew", object: "invoice", amount_paid: 1000, currency: "usd", payment_intent: "pi_renew", metadata: { plan: "pro_monthly" }, parent: { subscription_details: { subscription: "sub_1" } } };
  assert.equal((await deliver(event("invoice.paid", invoice))).statusCode, 200);
  assert.equal(Date.parse(entitlement().current_period_end), renewedEnd * 1000);
  assert.equal(hasPro(), true);
});

test("failed renewal does not extend Pro: past_due ends access at the last paid period", async () => {
  const { stripe } = resetWorld();
  const renewalAt = nowSec() - 2 * 3600;
  stripe._subscriptions.set("sub_1", subscription({ start: renewalAt - 30 * DAY, end: renewalAt }));
  await sync.syncSubscription(deps(), "sub_1", { now: new Date((renewalAt - 3600) * 1000) });
  // Stripe advanced the period and the renewal charge failed.
  stripe._subscriptions.set("sub_1", subscription({ status: "past_due", start: renewalAt, end: renewalAt + 30 * DAY }));
  const invoice = { id: "in_fail", object: "invoice", amount_paid: 0, parent: { subscription_details: { subscription: "sub_1" } } };
  assert.equal((await deliver(event("invoice.payment_failed", invoice))).statusCode, 200);
  const row = entitlement();
  assert.equal(row.status, "expired");
  assert.equal(Date.parse(row.current_period_end), renewalAt * 1000);
  assert.equal(hasPro(), false);
  // Paying later restores it.
  stripe._subscriptions.set("sub_1", subscription({ start: renewalAt, end: renewalAt + 30 * DAY }));
  await deliver(event("invoice.paid", { ...invoice, id: "in_fail_paid", amount_paid: 0 }));
  assert.equal(hasPro(), true);
});

test("end of the paid period ends Pro even before any event updates the row", async () => {
  const { stripe } = resetWorld();
  const end = nowSec() + DAY;
  stripe._subscriptions.set("sub_1", subscription({ end }));
  await sync.syncSubscription(deps(), "sub_1");
  assert.equal(hasPro("user-a", new Date((end - 60) * 1000)), true);
  assert.equal(hasPro("user-a", new Date((end + 1) * 1000)), false);
});

test("cancel at period end keeps the paid period, then deletion ends it", async () => {
  const { stripe } = resetWorld();
  const end = nowSec() + 10 * DAY;
  stripe._subscriptions.set("sub_1", subscription({ end }));
  await sync.syncSubscription(deps(), "sub_1");
  stripe._subscriptions.set("sub_1", subscription({ end, cancelAtPeriodEnd: true }));
  const updated = event("customer.subscription.updated", subscription({ end, cancelAtPeriodEnd: true }), { previous_attributes: { cancel_at_period_end: false } });
  assert.equal((await deliver(updated)).statusCode, 200);
  assert.equal(entitlement().status, "active");
  assert.equal(Date.parse(entitlement().current_period_end), end * 1000);
  assert.equal(hasPro(), true, "turning off renewal does not cut the paid period");

  stripe._subscriptions.set("sub_1", subscription({ status: "canceled", end, endedAt: end, cancelAtPeriodEnd: true }));
  await deliver(event("customer.subscription.deleted", subscription({ status: "canceled", end, endedAt: end })));
  assert.equal(entitlement().status, "canceled");
  assert.equal(hasPro(), false);
});

test("replayed and out-of-order events cannot restore ended access", async () => {
  const { stripe, db } = resetWorld();
  const end = nowSec() + 10 * DAY;
  const oldActive = event("customer.subscription.updated", subscription({ end }));
  stripe._subscriptions.set("sub_1", subscription({ status: "canceled", end, endedAt: nowSec() - 60 }));
  const deleted = event("customer.subscription.deleted", subscription({ status: "canceled", end, endedAt: nowSec() - 60 }));
  // Seed an active row, then deliver the deletion before the older "active" update.
  db.rows("user_entitlements").push({ user_id: "user-a", plan: "pro_monthly", status: "active", current_period_end: new Date(end * 1000).toISOString(), stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", updated_at: "2026-01-01T00:00:00.000Z" });
  await deliver(deleted);
  assert.equal(entitlement().status, "canceled");
  await deliver(oldActive);
  assert.equal(entitlement().status, "canceled", "the late 'active' snapshot is ignored; Stripe's current state wins");
  // Exact duplicate delivery is acknowledged without processing again.
  const writesBefore = JSON.stringify(entitlement());
  const duplicate = await deliver(deleted);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(JSON.stringify(entitlement()), writesBefore);
  assert.equal(hasPro(), false);
});

test("an event is marked processed only after its result is saved; failures are retried", async () => {
  const { stripe, db } = resetWorld();
  stripe._subscriptions.set("sub_1", subscription());
  const evt = event("customer.subscription.updated", subscription());
  db.failNext("user_entitlements", "insert");
  const failed = await quiet(() => deliver(evt));
  assert.equal(failed.statusCode, 500, "Stripe must retry");
  const ledgerRow = db.rows("stripe_webhook_events").find((row) => row.id === evt.id);
  assert.equal(ledgerRow.status, "failed");
  assert.equal(entitlement(), null);

  const retried = await deliver(evt);
  assert.equal(retried.statusCode, 200);
  assert.equal(db.rows("stripe_webhook_events").find((row) => row.id === evt.id).status, "processed");
  assert.equal(db.rows("stripe_webhook_events").find((row) => row.id === evt.id).attempts, 2);
  assert.equal(hasPro(), true);
});

test("a concurrent delivery of the same event waits instead of double-processing", async () => {
  const { db } = resetWorld();
  const evt = event("customer.subscription.updated", subscription());
  db.rows("stripe_webhook_events").push({ id: evt.id, status: "processing", attempts: 1, processing_started_at: new Date().toISOString() });
  const res = await deliver(evt);
  assert.equal(res.statusCode, 409);
});

test("invalid signatures are rejected before any processing", async () => {
  const { stripe } = resetWorld();
  stripe._subscriptions.set("sub_1", subscription());
  const res = await quiet(() => deliver(event("customer.subscription.updated", subscription()), "forged"));
  assert.equal(res.statusCode, 400);
  assert.equal(entitlement(), null);
});

test("webhook still works before the ledger migration is applied", async () => {
  const { stripe, db } = resetWorld();
  stripe._subscriptions.set("sub_1", subscription());
  db.failNext("stripe_webhook_events", "insert", { code: "PGRST205", message: "Could not find the table 'public.stripe_webhook_events' in the schema cache" });
  const res = await deliver(event("customer.subscription.updated", subscription()));
  assert.equal(res.statusCode, 200);
  assert.equal(hasPro(), true);
});

// ---------------------------------------------------------------------------
// Checkout: async payments and the success page

test("async payment: completed-but-unpaid checkout grants nothing until Stripe confirms", async () => {
  const { stripe } = resetWorld();
  stripe._subscriptions.set("sub_1", subscription({ status: "incomplete" }));
  stripe._sessions.set("cs_test_1", checkoutSession({ paymentStatus: "unpaid" }));
  await deliver(event("checkout.session.completed", checkoutSession({ paymentStatus: "unpaid" })));
  assert.equal(entitlement(), null);
  assert.equal((await confirm("cs_test_1")).body.access, "pending", "the success URL is not proof of payment");
  assert.equal(entitlement(), null);

  stripe._subscriptions.set("sub_1", subscription());
  stripe._sessions.set("cs_test_1", checkoutSession());
  await deliver(event("checkout.session.async_payment_succeeded", checkoutSession()));
  assert.equal(hasPro(), true);
});

test("async payment failure leaves no Pro", async () => {
  const { stripe } = resetWorld();
  stripe._subscriptions.set("sub_1", subscription({ status: "incomplete_expired" }));
  stripe._sessions.set("cs_test_1", checkoutSession({ paymentStatus: "unpaid" }));
  assert.equal((await deliver(event("checkout.session.async_payment_failed", checkoutSession({ paymentStatus: "unpaid" })))).statusCode, 200);
  assert.equal(hasPro(), false);
});

test("Lifetime is granted only for a paid payment-mode checkout", async () => {
  const { stripe } = resetWorld();
  const lifetime = { id: "cs_test_life", mode: "payment", plan: "lifetime" };
  stripe._sessions.set("cs_test_life", checkoutSession({ ...lifetime, paymentStatus: "unpaid" }));
  await deliver(event("checkout.session.completed", checkoutSession({ ...lifetime, paymentStatus: "unpaid" })));
  assert.equal(entitlement(), null);
  stripe._sessions.set("cs_test_life", checkoutSession(lifetime));
  await deliver(event("checkout.session.async_payment_succeeded", checkoutSession(lifetime)));
  assert.equal(entitlement().plan, "lifetime");
  assert.equal(hasPro(), true);
});

test("success page verifies ownership on the server and never trusts the client", async () => {
  const { stripe } = resetWorld();
  stripe._subscriptions.set("sub_1", subscription());
  stripe._sessions.set("cs_test_1", checkoutSession());
  const stolen = await confirm("cs_test_1", "user-b");
  assert.equal(stolen.statusCode, 403);
  assert.equal(entitlement("user-b"), null);
  const own = await confirm("cs_test_1", "user-a");
  assert.equal(own.statusCode, 200);
  assert.equal(own.body.access, "active");
  assert.equal(hasPro(), true);
  // A subscription whose metadata names someone else is not attached to the caller.
  stripe._subscriptions.set("sub_2", subscription({ id: "sub_2", user: "user-b" }));
  stripe._sessions.set("cs_test_2", checkoutSession({ id: "cs_test_2", sub: "sub_2" }));
  const mixed = await confirm("cs_test_2", "user-a");
  assert.equal(mixed.statusCode, 403);
});

// ---------------------------------------------------------------------------
// Protected rows and edge cases

test("FM Pro and Lifetime rows are never changed by subscription events", async () => {
  const { stripe, db } = resetWorld();
  for (const [user, plan] of [["user-fm", "founding_free"], ["user-life", "lifetime"]]) {
    db.rows("user_entitlements").push({ user_id: user, plan, status: "active", current_period_end: null, stripe_subscription_id: null, stripe_customer_id: `cus_${user}`, updated_at: "2026-01-01T00:00:00.000Z" });
    stripe._subscriptions.set(`sub_${user}`, subscription({ id: `sub_${user}`, user, customer: `cus_${user}`, status: "canceled", endedAt: nowSec() - 60 }));
    await deliver(event("customer.subscription.deleted", subscription({ id: `sub_${user}`, user, status: "canceled" })));
    assert.equal(entitlement(user).plan, plan);
    assert.equal(entitlement(user).status, "active");
    assert.equal(hasPro(user), true);
  }
});

test("an old subscription cannot displace a newer active one", async () => {
  const { stripe } = resetWorld();
  stripe._subscriptions.set("sub_new", subscription({ id: "sub_new", created: nowSec() - DAY }));
  await sync.syncSubscription(deps(), "sub_new");
  stripe._subscriptions.set("sub_old", subscription({ id: "sub_old", status: "canceled", created: nowSec() - 90 * DAY, endedAt: nowSec() - 30 * DAY }));
  const result = await sync.syncSubscription(deps(), "sub_old");
  assert.equal(result.outcome, "skipped_other_subscription");
  assert.equal(entitlement().stripe_subscription_id, "sub_new");
  assert.equal(hasPro(), true);
});

test("an unpaid checkout does not revoke a complimentary manual grant", async () => {
  const { stripe, db } = resetWorld();
  db.rows("user_entitlements").push({ user_id: "user-a", plan: "pro_monthly", status: "active", source: "admin_complimentary_pro", current_period_end: new Date(Date.now() + 60 * DAY * 1000).toISOString(), stripe_subscription_id: null, updated_at: "2026-01-01T00:00:00.000Z" });
  stripe._subscriptions.set("sub_1", subscription({ status: "incomplete" }));
  const result = await sync.syncSubscription(deps(), "sub_1");
  assert.equal(result.outcome, "skipped_manual_grant");
  assert.equal(entitlement().source, "admin_complimentary_pro");
});

test("Stripe trials stay separate from the paid period", async () => {
  const { stripe } = resetWorld();
  const trialEnd = nowSec() + 7 * DAY;
  stripe._subscriptions.set("sub_1", subscription({ status: "trialing", trialStart: nowSec() - DAY, trialEnd, end: trialEnd }));
  await sync.syncSubscription(deps(), "sub_1");
  const row = entitlement();
  assert.equal(row.status, "trialing");
  assert.equal(row.current_period_end, null);
  assert.equal(Date.parse(row.trial_ends_at), trialEnd * 1000);
  assert.equal(hasPro(), true);
  assert.equal(hasPro("user-a", new Date((trialEnd + 1) * 1000)), false);
});

test("concurrent writers: a stale write is retried against fresh Stripe state", async () => {
  const { stripe } = resetWorld();
  stripe._subscriptions.set("sub_1", subscription());
  const store = deps().store;
  let interfered = false;
  const racingStore = {
    ...store,
    async writeEntitlement(userId, expected, fields) {
      if (!interfered) {
        interfered = true;
        // Another delivery wins the race with the canceled state.
        stripe._subscriptions.set("sub_1", subscription({ status: "canceled", endedAt: nowSec() - 60 }));
        await store.writeEntitlement(userId, expected, { ...fields, status: "canceled", updated_at: "2026-10-28T00:00:00.001Z" });
      }
      return store.writeEntitlement(userId, expected, fields);
    },
  };
  const result = await sync.syncSubscription({ stripe, store: racingStore }, "sub_1");
  assert.equal(entitlement().status, "canceled");
  assert.equal(result.hasAccess, false);
});

test("unlinked subscriptions are acknowledged without guessing a user", async () => {
  const { stripe } = resetWorld();
  stripe._subscriptions.set("sub_x", subscription({ id: "sub_x", user: null, customer: "cus_unknown" }));
  const res = await quiet(() => deliver(event("customer.subscription.updated", subscription({ id: "sub_x", user: null }))));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.outcome, "unlinked");
  assert.equal(globalThis.__billingTest.db.rows("user_entitlements").length, 0);
});

// ---------------------------------------------------------------------------
// Reconciliation and dry-run audit

test("reconciliation replays missed events oldest first and re-syncs ending periods", async () => {
  const { stripe, db } = resetWorld();
  const end = nowSec() + 30 * DAY;
  stripe._subscriptions.set("sub_1", subscription({ end }));
  stripe._sessions.set("cs_test_1", checkoutSession());
  stripe._events.push(event("checkout.session.completed", checkoutSession()));
  // A second user whose renewal webhook was missed: the row still shows an ended period.
  db.rows("user_entitlements").push({ user_id: "user-b", plan: "pro_monthly", status: "active", current_period_end: new Date((nowSec() - 3600) * 1000).toISOString(), stripe_subscription_id: "sub_b", stripe_customer_id: "cus_b", updated_at: "2026-01-01T00:00:00.000Z" });
  stripe._subscriptions.set("sub_b", subscription({ id: "sub_b", user: "user-b", customer: "cus_b", end: nowSec() + 29 * DAY }));

  const dry = await webhookReconcile(true);
  assert.equal(dry.statusCode, 200);
  assert.equal(dry.body.dryRun, true);
  assert.equal(dry.body.rows.outcomes.would_set_active, 1);
  assert.equal(entitlement(), null, "dry run writes nothing");
  assert.equal(hasPro("user-b"), false);

  const real = await webhookReconcile(false);
  assert.equal(real.statusCode, 200);
  assert.equal(real.body.events.processed, 1);
  assert.equal(hasPro("user-a"), true);
  assert.equal(hasPro("user-b"), true);
  const again = await webhookReconcile(false);
  assert.equal(again.body.events.duplicates, 1, "already-processed events are skipped");
});

test("reconciliation re-checks still-active rows whose period ended long ago", async () => {
  const { stripe, db } = resetWorld();
  const longAgo = new Date((nowSec() - 100 * DAY) * 1000).toISOString();
  // A paying subscriber whose renewals the old webhook never recorded.
  db.rows("user_entitlements").push({ user_id: "user-a", plan: "pro_monthly", status: "active", current_period_end: longAgo, stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", updated_at: "2026-01-01T00:00:00.000Z" });
  stripe._subscriptions.set("sub_1", subscription({ end: nowSec() + 20 * DAY }));
  // An expired row from long ago is left alone (it would be re-checked forever otherwise).
  db.rows("user_entitlements").push({ user_id: "user-old", plan: "pro_monthly", status: "expired", current_period_end: longAgo, stripe_subscription_id: "sub_old", stripe_customer_id: "cus_old", updated_at: "2026-01-01T00:00:00.000Z" });
  const real = await webhookReconcile(false);
  assert.equal(real.statusCode, 200);
  assert.equal(real.body.rows.checked, 1);
  assert.equal(hasPro("user-a"), true);
});

async function checkoutRequest(userId, body) {
  const res = response();
  await checkoutHandler({ method: "POST", headers: { authorization: `Bearer token-${userId}` }, body }, res);
  return res;
}

test("a signed-in subscriber can have their own subscription re-read from Stripe", async () => {
  const { stripe, db } = resetWorld();
  const stale = new Date((nowSec() - 100 * DAY) * 1000).toISOString();
  db.rows("user_entitlements").push({ user_id: "user-a", plan: "pro_monthly", status: "active", current_period_end: stale, stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", updated_at: "2026-01-01T00:00:00.000Z" });
  stripe._subscriptions.set("sub_1", subscription({ end: nowSec() + 20 * DAY }));
  assert.equal(billing.needsStripeResync(entitlement()), true);
  assert.equal(hasPro(), false, "the stale row alone no longer grants Pro");

  // Someone else asking changes nothing for user-a: only the caller's own row is used.
  const other = await checkoutRequest("user-b", { checkoutKind: "sync_entitlement", subscriptionId: "sub_1", userId: "user-a" });
  assert.equal(other.statusCode, 200);
  assert.equal(other.body.synced, false);
  assert.equal(hasPro(), false);

  const own = await checkoutRequest("user-a", { checkoutKind: "sync_entitlement" });
  assert.equal(own.statusCode, 200);
  assert.deepEqual(own.body, { synced: true, hasAccess: true });
  assert.equal(hasPro(), true);
  assert.equal(billing.needsStripeResync(entitlement()), false);
});

test("a re-read cannot keep Pro for a subscription Stripe has ended", async () => {
  const { stripe, db } = resetWorld();
  db.rows("user_entitlements").push({ user_id: "user-a", plan: "pro_monthly", status: "active", current_period_end: new Date((nowSec() - 5 * DAY) * 1000).toISOString(), stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", updated_at: "2026-01-01T00:00:00.000Z" });
  stripe._subscriptions.set("sub_1", subscription({ status: "canceled", end: nowSec() - 5 * DAY, endedAt: nowSec() - 5 * DAY }));
  const res = await checkoutRequest("user-a", { checkoutKind: "sync_entitlement" });
  assert.deepEqual(res.body, { synced: true, hasAccess: false });
  assert.equal(entitlement().status, "canceled");
  assert.equal(billing.needsStripeResync(entitlement()), false, "no more re-reads once Stripe's answer is stored");
});

test("only stale Stripe-linked monthly/yearly rows ask Stripe again", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const row = (extra) => ({ plan: "pro_monthly", status: "active", current_period_end: "2026-07-01T00:00:00Z", stripe_subscription_id: "sub_1", ...extra });
  assert.equal(billing.needsStripeResync(row(), now), true);
  assert.equal(billing.needsStripeResync(row({ current_period_end: "2026-12-01T00:00:00Z" }), now), false);
  assert.equal(billing.needsStripeResync(row({ stripe_subscription_id: null }), now), false, "manual grants never call Stripe");
  assert.equal(billing.needsStripeResync(row({ status: "expired" }), now), false);
  assert.equal(billing.needsStripeResync(row({ plan: "lifetime" }), now), false);
  assert.equal(billing.needsStripeResync(null, now), false);
});

async function webhookReconcile(dryRun, secret = "reconcile-test-secret") {
  const res = response();
  await webhook.default({ method: "POST", url: `/api/stripe/webhook${dryRun ? "?dryRun=1" : ""}`, headers: { "x-billing-reconcile-secret": secret }, async *[Symbol.asyncIterator]() {} }, res);
  return res;
}

test("reconciliation requires the shared secret", async () => {
  resetWorld();
  assert.equal((await webhookReconcile(false, "wrong")).statusCode, 401);
});

test("reconcile helper reports failures instead of hiding them", async () => {
  const { db } = resetWorld();
  db.failNext("user_entitlements", "select");
  const summary = await reconcileStripeEntitlements({ stripe: { ...globalThis.__billingTest.stripe }, store: deps().store, db, handleEvent: async () => ({ status: 200, body: {} }), eventTypes: [], dryRun: true });
  assert.ok(summary.errors.some((message) => message.startsWith("row_query_failed")));
});

test("dry-run audit flags the confirmed case and keeps manual grants as review/info", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const confirmedCase = { user_id: "u1", plan: "pro_monthly", status: "active", current_period_end: "2026-06-21T00:00:00Z", source: "checkout_confirm", stripe_customer_id: null, stripe_subscription_id: null };
  const codes = audit.auditEntitlement({ row: confirmedCase, now, profilePlanFields: { plan: "free" }, legacyPaymentRows: 0 }).map((finding) => finding.code);
  for (const code of ["active_but_period_ended", "paid_source_missing_stripe_ids", "no_payment_record"]) assert.ok(codes.includes(code), code);
  assert.ok(codes.includes("loses_access_with_new_rule"), "the old rule granted it; the new one does not");
  assert.ok(!codes.includes("profile_mismatch"), "profiles already says Free, which matches the new rule");

  const manual = audit.auditEntitlement({ row: { user_id: "u2", plan: "pro_monthly", status: "active", source: "admin_complimentary_pro", current_period_end: "2027-01-01T00:00:00Z" }, now });
  assert.deepEqual(manual.map((finding) => [finding.code, finding.severity]), [["manual_grant", "info"]]);

  const noEnd = audit.auditEntitlement({ row: { user_id: "u3", plan: "pro_yearly", status: "active", source: "admin", current_period_end: null }, now });
  assert.ok(noEnd.some((finding) => finding.code === "loses_access_with_new_rule" && finding.severity === "release_blocker"));
  assert.ok(noEnd.some((finding) => finding.code === "manual_or_unknown_grant" && finding.severity === "info"));

  for (const plan of ["founding_free", "lifetime"]) {
    assert.ok(!audit.auditEntitlement({ row: { user_id: "u4", plan, status: "active", stripe_customer_id: "cus" }, now }).some((finding) => finding.severity !== "info"));
  }
});
