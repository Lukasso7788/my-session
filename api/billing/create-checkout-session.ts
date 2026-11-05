import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { createSubscriptionPortal, subscriptionManagementSummary, type BillingIdentity } from "../_lib/stripeSubscriptionPortal.js";
import { createSupabaseBillingStore, syncSubscription } from "../_lib/stripeEntitlementSync.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APP_URL = process.env.APP_URL || "http://localhost:5173";

type CheckoutKind = "subscription" | "host_support" | "customer_portal" | "subscription_status" | "sync_entitlement";

type SupportedPlan = "pro_monthly" | "pro_yearly" | "lifetime" | "india_upi_monthly";
type EntitlementPlan = "pro_monthly" | "pro_yearly" | "lifetime";

const SUPPORTED_PLANS: SupportedPlan[] = [
  "pro_monthly",
  "pro_yearly",
  "lifetime",
  "india_upi_monthly",
];
async function getBillingIdentity(userId: string): Promise<BillingIdentity | null> {
  const { data: entitlement, error } = await supabaseAdmin
    .from("user_entitlements")
    .select("plan,stripe_customer_id,stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Customer portal entitlement lookup failed:", error);
    throw new Error("billing_profile_lookup_failed");
  }

  return entitlement;
}

function looksLikeUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(v || "").trim()
  );
}

function normalizeUsdAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// Regional pricing: visitors whose IP is in South Asia pay the regional prices.
// The country comes from Vercel's edge header, checked again at checkout so a
// browser cannot ask for the regional price from elsewhere.
type PricingRegion = "south_asia" | "default";

const SOUTH_ASIA_COUNTRIES = new Set(["IN", "PK", "BD", "NP", "LK", "BT", "MV"]);

const SOUTH_ASIA_PRICE_ENV: Partial<Record<SupportedPlan, string>> = {
  pro_monthly: "STRIPE_PRICE_SOUTH_ASIA_MONTHLY",
  pro_yearly: "STRIPE_PRICE_SOUTH_ASIA_YEARLY",
  lifetime: "STRIPE_PRICE_SOUTH_ASIA_LIFETIME",
};

function getRequestCountry(req: VercelRequest): string {
  const raw = req.headers["x-vercel-ip-country"];
  return String(Array.isArray(raw) ? raw[0] : raw || "").trim().toUpperCase();
}

function getPricingRegion(country: string): PricingRegion {
  return SOUTH_ASIA_COUNTRIES.has(country) ? "south_asia" : "default";
}

function getRegionalPriceId(plan: SupportedPlan, region: PricingRegion): string {
  if (region !== "south_asia") return "";
  const envName = SOUTH_ASIA_PRICE_ENV[plan];
  return envName ? String(process.env[envName] || "").trim() : "";
}

function getPriceIdForPlan(plan: SupportedPlan, region: PricingRegion = "default"): string {
  const regionalPriceId = getRegionalPriceId(plan, region);
  if (regionalPriceId) return regionalPriceId;

  let priceId = "";

  switch (plan) {
    case "pro_monthly":
      priceId = process.env.STRIPE_PRICE_PRO_MONTHLY || "";
      break;
    case "pro_yearly":
      priceId = process.env.STRIPE_PRICE_PRO_YEARLY || "";
      break;
    case "lifetime":
      priceId = process.env.STRIPE_PRICE_LIFETIME || "";
      break;
    case "india_upi_monthly":
      priceId = process.env.STRIPE_PRICE_INDIA_UPI_MONTHLY || "";
      break;
    default:
      throw new Error(`Unsupported plan: ${plan}`);
  }

  if (!priceId) {
    throw new Error(`Missing Stripe price env for plan: ${plan}`);
  }

  return priceId;
}

type DisplayPrice = { amount: number; currency: string };

// Prices shown on /pricing come from Stripe itself, so the page always shows
// what checkout will charge. Cached per function instance.
const PRICE_CACHE_MS = 10 * 60 * 1000;
const priceCache = new Map<string, { at: number; price: DisplayPrice | null }>();

async function getDisplayPrice(priceId: string): Promise<DisplayPrice | null> {
  const cached = priceCache.get(priceId);
  if (cached && Date.now() - cached.at < PRICE_CACHE_MS) return cached.price;
  let price: DisplayPrice | null = null;
  try {
    const stripePrice = await stripe.prices.retrieve(priceId);
    if (typeof stripePrice.unit_amount === "number") {
      price = { amount: stripePrice.unit_amount / 100, currency: stripePrice.currency };
    }
  } catch (error) {
    console.error("Stripe price lookup failed", priceId, error);
  }
  priceCache.set(priceId, { at: Date.now(), price });
  return price;
}

async function getPricingForRequest(req: VercelRequest) {
  const country = getRequestCountry(req);
  const region = getPricingRegion(country);
  const entries = await Promise.all(
    SUPPORTED_PLANS.map(async (plan) => {
      try {
        return [plan, await getDisplayPrice(getPriceIdForPlan(plan, region))] as const;
      } catch {
        return [plan, null] as const;
      }
    })
  );
  return { region, country: country || null, prices: Object.fromEntries(entries) };
}

// Radar can only see metadata on the customer for subscription charges. The
// rule "block South Asia prices paid with a card from elsewhere" reads
// ::customer:pricing_region::. South Asia checkouts run on a tagged customer;
// default checkouts keep Checkout's own customer (customer_email) as before.
async function getSouthAsiaCheckoutCustomer(user: any, country: string): Promise<string> {
  const identity = await getBillingIdentity(user.id).catch(() => null);
  const metadata = {
    supabase_user_id: String(user.id),
    pricing_region: "south_asia",
    pricing_country: country,
  };
  if (identity?.stripe_customer_id) {
    await stripe.customers.update(identity.stripe_customer_id, { metadata });
    return identity.stripe_customer_id;
  }
  const customer = await stripe.customers.create({
    email: String(user.email || "").trim() || undefined,
    metadata,
  });
  return customer.id;
}

function getEntitlementPlan(plan: SupportedPlan): EntitlementPlan {
  if (plan === "india_upi_monthly") return "pro_monthly";
  return plan;
}

function getCheckoutDiscounts(plan: SupportedPlan) {
  if (plan === "india_upi_monthly") return undefined;

  const coupon = String(process.env.STRIPE_COUPON_100_OFF || "").trim();
  if (!coupon) return undefined;

  return [{ coupon }];
}

async function createHostSupportCheckout(params: {
  user: any;
  hostUserId: string;
  sessionId: string | null;
  amountUsd: number;
}) {
  const { user, hostUserId, sessionId } = params;
  const amountUsd = normalizeUsdAmount(params.amountUsd);

  if (!looksLikeUuid(hostUserId)) {
    throw new Error("hostUserId_required");
  }

  if (sessionId && !looksLikeUuid(sessionId)) {
    throw new Error("invalid_sessionId");
  }

  if (!Number.isFinite(amountUsd) || amountUsd < 2) {
    throw new Error("invalid_amount_min_2");
  }

  const supporterUserId = String(user.id || "").trim();

  if (supporterUserId === hostUserId) {
    throw new Error("cannot_support_yourself");
  }

  const { data: hostProfile, error: hostProfileError } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name")
    .eq("id", hostUserId)
    .maybeSingle();

  if (hostProfileError || !hostProfile?.id) {
    throw new Error("host_not_found");
  }

  const { data: monetization, error: monetizationError } = await supabaseAdmin
    .from("host_monetization_profiles")
    .select("host_user_id, status, support_enabled, monthly_cap_usd")
    .eq("host_user_id", hostUserId)
    .maybeSingle();

  if (monetizationError) {
    console.error("host support monetization lookup failed:", monetizationError);
    throw new Error("host_monetization_lookup_failed");
  }

  if (
    !monetization ||
    monetization.status !== "active" ||
    monetization.support_enabled !== true
  ) {
    throw new Error("host_support_not_enabled");
  }

  const grossAmountUsd = amountUsd;
  const platformFeeUsd = Number((grossAmountUsd * 0.1).toFixed(2));
  const hostAmountUsd = Number((grossAmountUsd - platformFeeUsd).toFixed(2));
  const supportPaymentId = randomUUID();

  const hostName = String((hostProfile as any).full_name || "this host").trim();

  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],

    success_url: `${APP_URL}/profile/${hostUserId}?support=success`,
    cancel_url: `${APP_URL}/profile/${hostUserId}?support=cancelled`,

    client_reference_id: supportPaymentId,
    customer_email: String(user.email || "").trim() || undefined,

    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(grossAmountUsd * 100),
          product_data: {
            name: `Support ${hostName} on MySession`,
            description: "Optional support for a MySession host.",
          },
        },
      },
    ],

    metadata: {
      checkout_kind: "host_support",
      kind: "host_support",
      supportPaymentId,
      hostUserId,
      supporterUserId,
      sessionId: sessionId || "",
      grossAmountUsd: String(grossAmountUsd),
      platformFeeUsd: String(platformFeeUsd),
      hostAmountUsd: String(hostAmountUsd),
    },

    payment_intent_data: {
      metadata: {
        checkout_kind: "host_support",
        kind: "host_support",
        supportPaymentId,
        hostUserId,
        supporterUserId,
        sessionId: sessionId || "",
        grossAmountUsd: String(grossAmountUsd),
        platformFeeUsd: String(platformFeeUsd),
        hostAmountUsd: String(hostAmountUsd),
      },
    },
  });

  const { error: insertError } = await supabaseAdmin
    .from("host_support_payments")
    .insert({
      id: supportPaymentId,
      host_user_id: hostUserId,
      supporter_user_id: supporterUserId,
      session_id: sessionId,
      stripe_checkout_session_id: checkout.id,
      stripe_payment_intent_id: null,
      gross_amount_usd: grossAmountUsd,
      platform_fee_usd: platformFeeUsd,
      host_amount_usd: hostAmountUsd,
      currency: "usd",
      status: "pending",
      available_at: null,
    });

  if (insertError) {
    console.error("host support payment insert failed:", insertError);
    throw new Error("support_payment_insert_failed");
  }

  return {
    url: checkout.url,
    checkoutSessionId: checkout.id,
    supportPaymentId,
  };
}

async function createSubscriptionCheckout(params: {
  user: any;
  plan: SupportedPlan;
  country: string;
}) {
  const { user, plan, country } = params;

  if (!plan || !SUPPORTED_PLANS.includes(plan)) {
    throw new Error("Invalid plan");
  }

  const isIndiaUpi = plan === "india_upi_monthly";
  const regionalPriceId = getRegionalPriceId(plan, getPricingRegion(country));
  const region: PricingRegion = regionalPriceId ? "south_asia" : "default";
  const priceId = getPriceIdForPlan(plan, region);
  const entitlementPlan = getEntitlementPlan(plan);
  const paymentRegion = isIndiaUpi ? "india" : region;

  const mode: "subscription" | "payment" =
    plan === "lifetime" ? "payment" : "subscription";

  const discounts = getCheckoutDiscounts(plan);

  let customerId: string | null = null;
  if (region === "south_asia") {
    try {
      customerId = await getSouthAsiaCheckoutCustomer(user, country);
    } catch (error) {
      console.error("South Asia checkout customer setup failed", error);
    }
  }

  console.log("create-checkout-session", {
    userId: user.id,
    email: user.email,
    plan,
    entitlementPlan,
    mode,
    priceId,
    appUrl: APP_URL,
    isIndiaUpi,
    region,
    country,
    hasDiscount: !!discounts?.length,
  });

  const session = await stripe.checkout.sessions.create({
    mode,

    payment_method_types: isIndiaUpi ? ["upi"] : ["card"],

    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],

    discounts,

    success_url: `${APP_URL}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/pricing?checkout=cancelled`,

    client_reference_id: user.id,
    ...(customerId ? { customer: customerId } : { customer_email: user.email || undefined }),

    metadata: {
      checkout_kind: "subscription",
      plan,
      entitlement_plan: entitlementPlan,
      supabase_user_id: user.id,
      payment_region: paymentRegion,
      pricing_country: country,
      payment_method_hint: isIndiaUpi ? "upi" : "card",
      affiliate_reward_enabled: "true",
    },

    payment_intent_data:
      mode === "payment"
        ? { metadata: { checkout_kind: "subscription", plan, pricing_region: region, pricing_country: country } }
        : undefined,

    subscription_data:
      mode === "subscription"
        ? {
            metadata: {
              checkout_kind: "subscription",
              plan,
              entitlement_plan: entitlementPlan,
              supabase_user_id: user.id,
              payment_region: paymentRegion,
              pricing_country: country,
              payment_method_hint: isIndiaUpi ? "upi" : "card",
              affiliate_reward_enabled: "true",
            },
          }
        : undefined,
  });

  try {
    await supabaseAdmin.rpc("enqueue_sender_event", {
      p_user_id: user.id,
      p_email: user.email || "",
      p_event_type: "checkout_started",
      p_properties: {
        user_id: user.id,
        first_name: String(user.user_metadata?.full_name || user.email || "Friend").split(" ")[0],
        timezone: user.user_metadata?.timezone || "UTC",
        target_plan: entitlementPlan,
        checkout_url: session.url,
        upgrade_url: `${APP_URL}/pricing`,
      },
      p_idempotency_key: `checkout_started:${session.id}`,
    });
  } catch (error) {
    console.error("Sender checkout event enqueue failed", error);
  }

  return { url: session.url };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET: the prices this visitor would pay (no sign-in needed for /pricing).
  if (req.method === "GET") {
    try {
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json(await getPricingForRequest(req));
    } catch (error) {
      console.error("pricing lookup failed", error);
      return res.status(500).json({ error: "pricing_lookup_failed" });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : "";

    if (!token) {
      return res.status(401).json({ error: "Missing Authorization bearer token" });
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = (req.body || {}) as {
      checkoutKind?: CheckoutKind;
      portalAction?: "manage" | "cancel";
      plan?: SupportedPlan;
      hostUserId?: string;
      sessionId?: string | null;
      amountUsd?: number;
    };

    const checkoutKind: CheckoutKind = body.checkoutKind || "subscription";

    if (checkoutKind === "host_support") {
      const result = await createHostSupportCheckout({
        user,
        hostUserId: String(body.hostUserId || "").trim(),
        sessionId: body.sessionId ? String(body.sessionId).trim() : null,
        amountUsd: Number(body.amountUsd || 0),
      });

      return res.status(200).json(result);
    }

    if (checkoutKind === "customer_portal") {
      const action = body.portalAction || "manage";
      if (action !== "manage" && action !== "cancel") return res.status(400).json({ error: "invalid_portal_action" });
      const identity = await getBillingIdentity(user.id);
      const result = await createSubscriptionPortal(stripe, identity, action, APP_URL, process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(result);
    }

    if (checkoutKind === "sync_entitlement") {
      // Self-healing for the signed-in user only: re-read the subscription
      // already linked to their own row from Stripe and apply it. Nothing in
      // the request body is used; the subscription ID comes from the database.
      const identity = await getBillingIdentity(user.id);
      res.setHeader("Cache-Control", "no-store");
      if (!identity?.stripe_subscription_id || !["pro_monthly", "pro_yearly"].includes(String(identity.plan))) {
        return res.status(200).json({ synced: false });
      }
      const result = await syncSubscription(
        { stripe, store: createSupabaseBillingStore(supabaseAdmin) },
        identity.stripe_subscription_id,
        { expectedUserId: user.id },
      );
      return res.status(200).json({ synced: true, hasAccess: result.hasAccess });
    }

    if (checkoutKind === "subscription_status") {
      const identity = await getBillingIdentity(user.id);
      const subscription = await subscriptionManagementSummary(stripe, identity, process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ subscription });
    }

    const result = await createSubscriptionCheckout({
      user,
      plan: body.plan as SupportedPlan,
      country: getRequestCountry(req),
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("create-checkout-session error", error);

    const message =
      error instanceof Error ? error.message : "Internal server error";

    const status =
      message === "hostUserId_required" ||
      message === "invalid_sessionId" ||
      message === "invalid_amount_min_2" ||
      message === "cannot_support_yourself" ||
      message === "billing_profile_not_found" ||
      message === "billing_subscription_not_found" ||
      message === "billing_subscription_not_cancelable" ||
      message === "billing_cancellation_not_configured" ||
      message === "Invalid plan"
        ? 400
        : message === "host_not_found"
          ? 404
          : message === "host_support_not_enabled" || message === "billing_subscription_mismatch"
            ? 403
            : 500;

    return res.status(status).json({
      error: message,
      details: message,
    });
  }
}
