import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APP_URL = process.env.APP_URL || "http://localhost:5173";

type SupportedPlan = "pro_monthly" | "pro_yearly" | "lifetime" | "india_upi_monthly";
type EntitlementPlan = "pro_monthly" | "pro_yearly" | "lifetime";

const SUPPORTED_PLANS: SupportedPlan[] = [
  "pro_monthly",
  "pro_yearly",
  "lifetime",
  "india_upi_monthly",
];

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
  if (plan === "india_upi_monthly") {
    return undefined;
  }

  const coupon = String(process.env.STRIPE_COUPON_100_OFF || "").trim();

  if (!coupon) {
    return undefined;
  }

  return [
    {
      coupon,
    },
  ];
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

    const { plan } = (req.body || {}) as { plan?: SupportedPlan };

    if (!plan || !SUPPORTED_PLANS.includes(plan)) {
      return res.status(400).json({ error: "Invalid plan" });
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
                plan,
                entitlement_plan: entitlementPlan,
                supabase_user_id: user.id,
                payment_region: isIndiaUpi ? "india" : "default",
                payment_method_hint: isIndiaUpi ? "upi" : "card",
              },
            }
          : undefined,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("create-checkout-session error", error);

    const message =
      error instanceof Error ? error.message : "Internal server error";

    return res.status(500).json({
      error: "Internal server error",
      details: message,
    });
  }
}