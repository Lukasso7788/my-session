import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

async function importTs(entry, options = {}) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", ...options });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { getFreeSessionUsage } = await importTs("src/lib/freeSessionNotice.ts");
const { getMembershipBadge, getMembershipPlanName, isComplimentaryPro } = await importTs("src/lib/membershipPresentation.ts");
const { subscriptionManagementSummary, createSubscriptionPortal, subscriptionPeriodEnd } = await importTs("api/_lib/stripeSubscriptionPortal.ts");
const allowance = (count, extras = {}) => getFreeSessionUsage({ enabled: true, isLoggedIn: true, entitlement: null, lifetimeSessionsCount: count, ...extras });

test("warning begins at 12; 12/13/14 show three/two/one sessions left", () => {
  assert.equal(allowance(11).showWarning, false);
  for (const [count, remaining, title] of [[12, 3, "Three sessions left"], [13, 2, "Two sessions left"], [14, 1, "One session left"]]) {
    assert.deepEqual(allowance(count), { used: count, limit: 15, remaining, showWarning: true, title });
  }
});
test("15 and legacy counts above the limit never show negative remaining sessions", () => {
  for (const count of [15, 16, 600]) { assert.equal(allowance(count).remaining, 0); assert.equal(allowance(count).title, "Your free sessions are used"); }
});
test("disabled paywall, signed-out and unknown usage do not promise a free-session limit", () => {
  assert.equal(allowance(12, { enabled: false }), null);
  assert.equal(allowance(12, { isLoggedIn: false }), null);
  for (const count of [null, NaN, Infinity]) assert.equal(allowance(count), null);
  assert.equal(allowance(-1).used, 0);
});
test("active Pro, Lifetime and Founding Free are excluded from upgrade warning", () => {
  for (const plan of ["pro_monthly", "pro_yearly", "lifetime", "founding_free"]) {
    for (const status of ["active", "trialing"]) assert.equal(allowance(12, { entitlement: { plan, status } }), null);
  }
  assert.equal(allowance(12, { entitlement: { plan: "free", status: "trialing" } }).remaining, 3);
  assert.equal(allowance(12, { entitlement: { plan: "pro_monthly", status: "canceled" } }).remaining, 3);
});

test("Founding Member Pro has its own badge and is not the purchased Lifetime plan", () => {
  const active = { isLoggedIn: true, isUnlimited: true };
  assert.equal(getMembershipBadge({ ...active, plan: "founding_free" }), "FM Pro");
  assert.equal(getMembershipPlanName("founding_free"), "Founding Member Pro");
  assert.equal(getMembershipBadge({ ...active, plan: "lifetime" }), "Pro");
  assert.equal(getMembershipPlanName("lifetime"), "MySession Lifetime");
  for (const plan of ["free", "pro_monthly", "pro_yearly", "lifetime", "founding_free"]) {
    assert.equal(getMembershipBadge({ isLoggedIn: false, isUnlimited: true, plan }), null);
    assert.equal(getMembershipBadge({ isLoggedIn: true, isUnlimited: false, plan }), "Free");
  }
});

test("complimentary Pro is separate from paid subscriptions and permanent memberships", () => {
  const grant = { plan: "pro_monthly", source: "admin_complimentary_pro", stripe_subscription_id: null };
  assert.equal(isComplimentaryPro(grant), true);
  assert.equal(getMembershipPlanName(grant.plan, isComplimentaryPro(grant)), "Complimentary Pro");
  assert.equal(getMembershipBadge({ isLoggedIn: true, isUnlimited: true, plan: grant.plan }), "Pro");
  assert.equal(isComplimentaryPro({ ...grant, stripe_subscription_id: "sub_paid" }), false);
  assert.equal(isComplimentaryPro({ ...grant, source: "stripe_webhook" }), false);
  assert.equal(isComplimentaryPro({ ...grant, plan: "founding_free" }), false);
  assert.equal(isComplimentaryPro({ ...grant, plan: "lifetime" }), false);
  assert.equal(isComplimentaryPro(null), false);
});

const identity = { plan: "pro_monthly", stripe_customer_id: "cus_owner", stripe_subscription_id: "sub_owner" };
function fixture(overrides = {}, configurationOverrides = {}) {
  const subscription = { id: "sub_owner", customer: "cus_owner", status: "active", cancel_at_period_end: false, cancel_at: null, ended_at: null, schedule: null, items: { data: [{ current_period_end: 1800000000 }] }, ...overrides };
  const configuration = { id: "bpc_default", active: true, features: { subscription_cancel: { enabled: true, mode: "at_period_end" } }, ...configurationOverrides };
  const sessions = [];
  let subscriptionReads = 0;
  const stripe = {
    subscriptions: { retrieve: async (id) => { assert.equal(id, "sub_owner"); subscriptionReads++; return subscription; } },
    billingPortal: {
      configurations: { list: async (args) => { assert.equal(args.is_default, true); return { data: [configuration] }; }, retrieve: async () => configuration },
      sessions: { create: async (params) => { sessions.push(params); return { url: "https://billing.stripe.com/p/session/test" }; } },
    },
  };
  return { stripe, sessions, subscription, get subscriptionReads() { return subscriptionReads; } };
}
test("current billing-period date supports modern Stripe item fields and legacy payloads", () => {
  const f = fixture();
  assert.equal(subscriptionPeriodEnd(f.subscription), "2027-01-15T08:00:00.000Z");
  assert.equal(subscriptionPeriodEnd({ ...f.subscription, current_period_end: 1700000000 }), "2023-11-14T22:13:20.000Z");
  assert.equal(subscriptionPeriodEnd({ ...f.subscription, items: { data: [] } }), null);
});
test("subscription summary is read-only and contains no customer/subscription IDs", async () => {
  const f = fixture();
  const summary = await subscriptionManagementSummary(f.stripe, identity);
  assert.equal(summary.canCancel, true);
  assert.equal(summary.currentPeriodEnd, "2027-01-15T08:00:00.000Z");
  assert.equal(f.sessions.length, 0);
  assert.equal(JSON.stringify(summary).includes("cus_owner"), false);
  assert.equal(JSON.stringify(summary).includes("sub_owner"), false);
});
test("cancel action opens Stripe confirmation, with trusted IDs and account return URL", async () => {
  const f = fixture();
  await createSubscriptionPortal(f.stripe, identity, "cancel", "https://mysession.club/");
  assert.deepEqual(f.sessions[0].flow_data, { type: "subscription_cancel", subscription_cancel: { subscription: "sub_owner" }, after_completion: { type: "redirect", redirect: { return_url: "https://mysession.club/settings?billing=returned#subscription" } } });
  assert.equal(f.sessions[0].customer, "cus_owner");
  assert.equal(f.sessions[0].return_url, "https://mysession.club/settings?billing=returned#subscription");
});
test("mismatched customer cannot view or cancel another account's subscription", async () => {
  const f = fixture({ customer: "cus_someone_else" });
  await assert.rejects(subscriptionManagementSummary(f.stripe, identity), /billing_subscription_mismatch/);
  await assert.rejects(createSubscriptionPortal(f.stripe, identity, "cancel", "https://mysession.club"), /billing_subscription_mismatch/);
  assert.equal(f.sessions.length, 0);
});
test("expanded Stripe customer passes the same ownership verification", async () => {
  const f = fixture({ customer: { id: "cus_owner" } });
  assert.equal((await subscriptionManagementSummary(f.stripe, identity)).canCancel, true);
});
test("free/lifetime/granted Pro cannot trigger cancellation of a nonrecurring grant", async () => {
  const f = fixture();
  for (const value of [null, { ...identity, plan: "lifetime" }, { ...identity, plan: "founding_free" }, { ...identity, stripe_subscription_id: null }]) {
    assert.equal((await subscriptionManagementSummary(f.stripe, value)).canCancel, false);
    await assert.rejects(createSubscriptionPortal(f.stripe, value, "cancel", "https://mysession.club"));
  }
  assert.equal(f.subscriptionReads, 0);
  assert.equal(f.sessions.length, 0);
});
test("disabled or immediate-cancel portal configuration cannot silently remove paid access", async () => {
  for (const settings of [{ enabled: false, mode: "at_period_end" }, { enabled: true, mode: "immediately" }]) {
    const f = fixture({}, { features: { subscription_cancel: settings } });
    const summary = await subscriptionManagementSummary(f.stripe, identity);
    assert.equal(summary.canCancel, false);
    assert.equal(summary.cancellationUnavailableReason, "portal_not_configured");
    await assert.rejects(createSubscriptionPortal(f.stripe, identity, "cancel", "https://mysession.club"), /billing_cancellation_not_configured/);
    assert.equal(f.sessions.length, 0);
  }
});
test("already scheduled or canceled subscriptions show the real status without repeat cancellation", async () => {
  for (const change of [{ cancel_at_period_end: true }, { cancel_at: 1800000100 }, { status: "canceled", ended_at: 1790000000 }]) {
    const f = fixture(change);
    const summary = await subscriptionManagementSummary(f.stripe, identity);
    assert.equal(summary.canCancel, false);
    assert.equal(summary.cancellationScheduled, change.status !== "canceled");
    await assert.rejects(createSubscriptionPortal(f.stripe, identity, "cancel", "https://mysession.club"), /billing_subscription_not_cancelable/);
    assert.equal(f.sessions.length, 0);
  }
});
test("manage billing keeps existing portal behavior and does not cancel anything", async () => {
  const f = fixture();
  await createSubscriptionPortal(f.stripe, identity, "manage", "https://mysession.club", "bpc_explicit");
  assert.equal(f.sessions[0].flow_data, undefined);
  assert.equal(f.sessions[0].configuration, "bpc_explicit");
  assert.equal(f.subscriptionReads, 0);
});

// Exercise the actual HTTP handler with isolated adapters: no production calls.
const apiMockPlugin = {
  name: "isolated-billing-adapters",
  setup(builder) {
    builder.onResolve({ filter: /^(stripe|@supabase\/supabase-js)$/ }, (args) => ({ path: args.path, namespace: "billing-mock" }));
    builder.onLoad({ filter: /.*/, namespace: "billing-mock" }, (args) => ({ contents: args.path === "stripe"
      ? 'export default class Stripe { constructor() { return globalThis.__billingAdapter.stripe; } }'
      : 'export function createClient() { return globalThis.__billingAdapter.db; }', loader: "js" }));
  },
};
const httpFixture = fixture();
const filters = [];
const adapter = { stripe: httpFixture.stripe, db: {
  auth: { getUser: async (token) => token === "valid-test-token" ? { data: { user: { id: "authenticated-owner", email: "test@example.invalid" } }, error: null } : { data: { user: null }, error: { message: "invalid" } } },
  from: (table) => { assert.equal(table, "user_entitlements"); return { select: () => ({ eq: (column, value) => { filters.push([column, value]); return { maybeSingle: async () => ({ data: identity, error: null }) }; } }) }; },
} };
globalThis.__billingAdapter = adapter;
const { default: billingHandler } = await importTs("api/billing/create-checkout-session.ts", { plugins: [apiMockPlugin] });
function responseRecorder() {
  return { statusCode: null, body: null, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
}
test("billing API denies missing or invalid authentication before any database reads", async () => {
  const before = filters.length;
  for (const authorization of ["", "Bearer invalid-test-token"]) {
    const response = responseRecorder();
    await billingHandler({ method: "POST", headers: { authorization }, body: { checkoutKind: "subscription_status" } }, response);
    assert.equal(response.statusCode, 401);
  }
  assert.equal(filters.length, before);
});
test("billing API rejects unsupported methods and portal actions", async () => {
  const get = responseRecorder();
  await billingHandler({ method: "GET", headers: {}, body: {} }, get);
  assert.equal(get.statusCode, 405);
  const invalid = responseRecorder();
  await billingHandler({ method: "POST", headers: { authorization: "Bearer valid-test-token" }, body: { checkoutKind: "customer_portal", portalAction: "delete_everything" } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error, "invalid_portal_action");
});
test("API ignores client-supplied user/customer/subscription IDs and prevents response caching", async () => {
  const response = responseRecorder();
  await billingHandler({ method: "POST", headers: { authorization: "Bearer valid-test-token" }, body: { checkoutKind: "subscription_status", userId: "another-user", customerId: "cus_someone_else", subscriptionId: "sub_someone_else" } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(filters.at(-1), ["user_id", "authenticated-owner"]);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.body.subscription.canCancel, true);
});
test("cancel API returns a confirmation URL but performs no subscription update", async () => {
  const response = responseRecorder();
  await billingHandler({ method: "POST", headers: { authorization: "Bearer valid-test-token" }, body: { checkoutKind: "customer_portal", portalAction: "cancel" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.url, "https://billing.stripe.com/p/session/test");
  assert.equal(httpFixture.sessions.at(-1).flow_data.subscription_cancel.subscription, "sub_owner");
  assert.equal(response.headers["Cache-Control"], "no-store");
});

const transportMock = {
  name: "isolated-client-auth",
  setup(builder) {
    builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: "supabase", namespace: "client-auth-mock" }));
    builder.onLoad({ filter: /.*/, namespace: "client-auth-mock" }, () => ({ contents: 'export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"client-fixture-token"}},error:null})}}', loader: "js" }));
  },
};
const { getSubscriptionManagementSummary, openSubscriptionPortal } = await importTs("src/lib/subscriptionManagement.ts", { plugins: [transportMock] });
test("client sends authenticated billing intent and navigates only to secure Stripe portal", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const requests = [];
  const navigation = [];
  globalThis.window = { location: { assign: (url) => navigation.push(url) } };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => JSON.parse(options.body).checkoutKind === "subscription_status" ? { subscription: { canManage: true, canCancel: true } } : { url: "https://billing.stripe.com/p/session/test" } };
  };
  try {
    await getSubscriptionManagementSummary();
    await openSubscriptionPortal("cancel");
    assert.equal(requests[0].url, "/api/billing/create-checkout-session");
    assert.equal(requests[0].options.method, "POST");
    assert.equal(requests[0].options.headers.Authorization, "Bearer client-fixture-token");
    assert.deepEqual(JSON.parse(requests[1].options.body), { checkoutKind: "customer_portal", portalAction: "cancel" });
    assert.deepEqual(navigation, ["https://billing.stripe.com/p/session/test"]);
  } finally { globalThis.fetch = previousFetch; globalThis.window = previousWindow; }
});
test("client rejects malformed/external portal URLs and maps configuration errors clearly", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.window = { location: { assign: () => assert.fail("unsafe redirect") } };
  try {
    for (const url of ["", "http://billing.stripe.com/test", "https://billing.stripe.com.evil.invalid/test", "javascript:alert(1)"]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ url }) });
      await assert.rejects(openSubscriptionPortal("cancel"), /Could not open secure billing settings/);
    }
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: "billing_cancellation_not_configured" }) });
    await assert.rejects(openSubscriptionPortal("cancel"), /Cancellation is not available.*contact support/);
  } finally { globalThis.fetch = previousFetch; globalThis.window = previousWindow; }
});

const webhookUpdates = [];
const webhookFixture = { plan: "pro_monthly", updateError: null, event: null };
globalThis.__webhookAdapter = {
  stripe: { webhooks: { constructEvent: () => webhookFixture.event } },
  db: {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: null } } }) } },
    from: (table) => {
      assert.equal(table, "user_entitlements");
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { ...identity, user_id: "owner", plan: webhookFixture.plan }, error: null }), update: (value) => ({ eq: async (column, user) => { webhookUpdates.push({ value, column, user }); return { error: webhookFixture.updateError }; } }) };
      return query;
    },
  },
};
const webhookMockPlugin = {
  name: "isolated-webhook-adapters",
  setup(builder) {
    builder.onResolve({ filter: /^(stripe|@supabase\/supabase-js)$/ }, (args) => ({ path: args.path, namespace: "webhook-mock" }));
    builder.onLoad({ filter: /.*/, namespace: "webhook-mock" }, (args) => ({ contents: args.path === "stripe" ? 'export default class Stripe {constructor(){return globalThis.__webhookAdapter.stripe}}' : 'export function createClient(){return globalThis.__webhookAdapter.db}', loader: "js" }));
  },
};
const { default: webhookHandler } = await importTs("api/stripe/webhook.ts", { plugins: [webhookMockPlugin] });
async function deletedSubscriptionResponse(plan, updateError = null) {
  webhookFixture.plan = plan;
  webhookFixture.updateError = updateError;
  webhookFixture.event = { type: "customer.subscription.deleted", id: "event_test", created: 1800000000, data: { object: { ...fixture().subscription, object: "subscription", status: "canceled" } } };
  const response = responseRecorder();
  response.send = function (value) { this.body = value; return this; };
  await webhookHandler({ method: "POST", headers: { "stripe-signature": "isolated-test-signature" }, async *[Symbol.asyncIterator]() { yield Buffer.from("isolated test"); } }, response);
  return response;
}
test("terminal Stripe webhook writes the database-supported canceled status", async () => {
  webhookUpdates.length = 0;
  const response = await deletedSubscriptionResponse("pro_monthly");
  assert.equal(response.statusCode, 200);
  assert.equal(webhookUpdates[0].value.status, "canceled");
  assert.equal(webhookUpdates[0].column, "user_id");
  assert.equal(webhookUpdates[0].user, "owner");
});
test("failed terminal entitlement update is not acknowledged as webhook success", async () => {
  const previousError = console.error;
  console.error = () => {};
  try {
    const response = await deletedSubscriptionResponse("pro_yearly", new Error("fixture database failure"));
    assert.equal(response.statusCode, 400);
  } finally { console.error = previousError; }
});
test("an old recurring subscription deletion cannot revoke a later lifetime/founding grant", async () => {
  webhookUpdates.length = 0;
  for (const plan of ["lifetime", "founding_free"]) assert.equal((await deletedSubscriptionResponse(plan)).statusCode, 200);
  assert.equal(webhookUpdates.length, 0);
});
