import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// South Asia visitors (by Vercel's IP country header) see and pay the regional
// prices; everyone else, and any request without the header, pays the regular
// ones. The page reads amounts from Stripe through the same server rules.
const PRICES = {
  price_monthly: { unit_amount: 1000, currency: "usd" },
  price_yearly: { unit_amount: 9600, currency: "usd" },
  price_lifetime: { unit_amount: 30000, currency: "usd" },
  price_upi: { unit_amount: 44900, currency: "inr" },
  price_sa_monthly: { unit_amount: 500, currency: "usd" },
  price_sa_yearly: { unit_amount: 4800, currency: "usd" },
  price_sa_lifetime: { unit_amount: 15000, currency: "usd" },
};
Object.assign(process.env, {
  STRIPE_PRICE_PRO_MONTHLY: "price_monthly",
  STRIPE_PRICE_PRO_YEARLY: "price_yearly",
  STRIPE_PRICE_LIFETIME: "price_lifetime",
  STRIPE_PRICE_INDIA_UPI_MONTHLY: "price_upi",
  STRIPE_PRICE_SOUTH_ASIA_MONTHLY: "price_sa_monthly",
  STRIPE_PRICE_SOUTH_ASIA_YEARLY: "price_sa_yearly",
  STRIPE_PRICE_SOUTH_ASIA_LIFETIME: "price_sa_lifetime",
});

const checkouts = [];
const customerUpdates = [];
let identity = { plan: "free", stripe_customer_id: "cus_owner", stripe_subscription_id: null };
globalThis.__billingAdapter = {
  stripe: {
    prices: { retrieve: async (id) => PRICES[id] },
    customers: {
      update: async (id, params) => { customerUpdates.push([id, params]); return { id }; },
      create: async (params) => { customerUpdates.push(["new", params]); return { id: "cus_new" }; },
    },
    checkout: { sessions: { create: async (params) => { checkouts.push(params); return { id: "cs_test", url: "https://checkout.stripe.com/test" }; } } },
  },
  db: {
    auth: { getUser: async () => ({ data: { user: { id: "owner", email: "owner@example.invalid" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: identity, error: null }) }) }) }),
    rpc: async () => ({ error: null }),
  },
};
const mockPlugin = {
  name: "billing-mock",
  setup(builder) {
    builder.onResolve({ filter: /^(stripe|@supabase\/supabase-js)$/ }, (args) => ({ path: args.path, namespace: "billing-mock" }));
    builder.onLoad({ filter: /.*/, namespace: "billing-mock" }, (args) => ({ contents: args.path === "stripe"
      ? "export default class Stripe { constructor() { return globalThis.__billingAdapter.stripe; } }"
      : "export function createClient() { return globalThis.__billingAdapter.db; }", loader: "js" }));
  },
};
const result = await build({ entryPoints: ["api/billing/create-checkout-session.ts"], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin] });
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

function recorder() {
  return { statusCode: null, body: null, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
}
async function pricing(country) {
  const response = recorder();
  await handler({ method: "GET", headers: country ? { "x-vercel-ip-country": country } : {}, body: {} }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  return response.body;
}
async function checkout(plan, country) {
  const response = recorder();
  const headers = { authorization: "Bearer token", ...(country ? { "x-vercel-ip-country": country } : {}) };
  await handler({ method: "POST", headers, body: { plan } }, response);
  assert.equal(response.statusCode, 200);
  return checkouts.at(-1);
}

test("South Asia countries see the regional prices, others the regular ones", async () => {
  for (const country of ["IN", "PK", "BD", "NP", "LK", "BT", "MV", "in"]) {
    const body = await pricing(country);
    assert.equal(body.region, "south_asia", country);
    assert.deepEqual(body.prices.pro_monthly, { amount: 5, currency: "usd" });
    assert.deepEqual(body.prices.pro_yearly, { amount: 48, currency: "usd" });
    assert.deepEqual(body.prices.lifetime, { amount: 150, currency: "usd" });
    assert.deepEqual(body.prices.india_upi_monthly, { amount: 449, currency: "inr" });
  }
  for (const country of ["US", "DE", "AE", ""]) {
    const body = await pricing(country);
    assert.equal(body.region, "default", country || "no header");
    assert.deepEqual(body.prices.pro_monthly, { amount: 10, currency: "usd" });
    assert.deepEqual(body.prices.lifetime, { amount: 300, currency: "usd" });
  }
});

test("checkout charges by the request's country, not by anything the browser sends", async () => {
  const regional = await checkout("pro_monthly", "IN");
  assert.equal(regional.line_items[0].price, "price_sa_monthly");
  assert.equal(regional.customer, "cus_owner");
  assert.equal(regional.customer_email, undefined);
  assert.equal(regional.metadata.payment_region, "south_asia");
  assert.equal(regional.subscription_data.metadata.entitlement_plan, "pro_monthly");
  assert.deepEqual(customerUpdates.at(-1), ["cus_owner", { metadata: { supabase_user_id: "owner", pricing_region: "south_asia", pricing_country: "IN" } }]);

  const updatesBefore = customerUpdates.length;
  const regular = await checkout("pro_monthly", "US");
  assert.equal(regular.line_items[0].price, "price_monthly");
  assert.equal(regular.customer, undefined);
  assert.equal(regular.customer_email, "owner@example.invalid");
  assert.equal(regular.metadata.payment_region, "default");
  assert.equal(customerUpdates.length, updatesBefore, "regular checkouts leave the customer alone");
});

test("regional lifetime is a one-time payment tagged for Radar; UPI keeps its own price", async () => {
  const lifetime = await checkout("lifetime", "PK");
  assert.equal(lifetime.mode, "payment");
  assert.equal(lifetime.line_items[0].price, "price_sa_lifetime");
  assert.equal(lifetime.payment_intent_data.metadata.pricing_region, "south_asia");

  const upi = await checkout("india_upi_monthly", "IN");
  assert.equal(upi.line_items[0].price, "price_upi");
  assert.deepEqual(upi.payment_method_types, ["upi"]);
  assert.equal(upi.metadata.payment_region, "india");
});

test("a new South Asia customer is created already tagged", async () => {
  identity = null;
  const regional = await checkout("pro_yearly", "BD");
  assert.equal(regional.customer, "cus_new");
  assert.equal(customerUpdates.at(-1)[1].metadata.pricing_region, "south_asia");
  identity = { plan: "free", stripe_customer_id: "cus_owner", stripe_subscription_id: null };
});

test("without the regional price IDs everyone pays the regular price", async () => {
  const saved = process.env.STRIPE_PRICE_SOUTH_ASIA_MONTHLY;
  delete process.env.STRIPE_PRICE_SOUTH_ASIA_MONTHLY;
  try {
    const plain = await checkout("pro_monthly", "IN");
    assert.equal(plain.line_items[0].price, "price_monthly");
    assert.equal(plain.metadata.payment_region, "default");
    assert.equal(plain.customer_email, "owner@example.invalid");
  } finally {
    process.env.STRIPE_PRICE_SOUTH_ASIA_MONTHLY = saved;
  }
});
