import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APP_URL = process.env.APP_URL || "http://localhost:5173";

type CheckoutKind = "subscription" | "host_support";

type SupportedPlan = "pro_monthly" | "pro_yearly" | "lifetime" | "india_upi_monthly";
type EntitlementPlan = "pro_monthly" | "pro_yearly" | "lifetime";

const SUPPORTED_PLANS: SupportedPlan[] = [
  "pro_monthly",
  "pro_yearly",
  "lifetime",
  "india_upi_monthly",
];

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

function getPriceIdForPlan(plan: SupportedPlan): string {
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
}) {
  const { user, plan } = params;

  if (!plan || !SUPPORTED_PLANS.includes(plan)) {
    throw new Error("Invalid plan");
  }

  const priceId = getPriceIdForPlan(plan);
  const entitlementPlan = getEntitlementPlan(plan);
  const isIndiaUpi = plan === "india_upi_monthly";

  const mode: "subscription" | "payment" =
    plan === "lifetime" ? "payment" : "subscription";

  const discounts = getCheckoutDiscounts(plan);

  console.log("create-checkout-session", {
    userId: user.id,
    email: user.email,
    plan,
    entitlementPlan,
    mode,
    priceId,
    appUrl: APP_URL,
    isIndiaUpi,
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
    customer_email: user.email || undefined,

    metadata: {
      checkout_kind: "subscription",
      plan,
      entitlement_plan: entitlementPlan,
      supabase_user_id: user.id,
      payment_region: isIndiaUpi ? "india" : "default",
      payment_method_hint: isIndiaUpi ? "upi" : "card",
    },

    subscription_data:
      mode === "subscription"
        ? {
            metadata: {
              checkout_kind: "subscription",
              plan,
              entitlement_plan: entitlementPlan,
              supabase_user_id: user.id,
              payment_region: isIndiaUpi ? "india" : "default",
              payment_method_hint: isIndiaUpi ? "upi" : "card",
            },
          }
        : undefined,
  });

  return { url: session.url };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    const result = await createSubscriptionCheckout({
      user,
      plan: body.plan as SupportedPlan,
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
      message === "Invalid plan"
        ? 400
        : message === "host_not_found"
          ? 404
          : message === "host_support_not_enabled"
            ? 403
            : 500;

    return res.status(status).json({
      error: message,
      details: message,
    });
  }
}