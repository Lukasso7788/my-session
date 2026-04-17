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

type SupportedPlan = "pro_monthly" | "pro_yearly" | "lifetime";

function getPriceIdForPlan(plan: SupportedPlan): string {
  switch (plan) {
    case "pro_monthly":
      return process.env.STRIPE_PRICE_PRO_MONTHLY!;
    case "pro_yearly":
      return process.env.STRIPE_PRICE_PRO_YEARLY!;
    case "lifetime":
      return process.env.STRIPE_PRICE_LIFETIME!;
    default:
      throw new Error(`Unsupported plan: ${plan satisfies never}`);
  }
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

    if (!plan || !["pro_monthly", "pro_yearly", "lifetime"].includes(plan)) {
      return res.status(400).json({ error: "Invalid plan" });
    }

    const priceId = getPriceIdForPlan(plan);
    const mode: "subscription" | "payment" =
      plan === "lifetime" ? "payment" : "subscription";

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      discounts: [
        {
          coupon: process.env.STRIPE_COUPON_100_OFF!,
        },
      ],
      success_url: `${APP_URL}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/pricing?checkout=cancelled`,
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      metadata: {
        plan,
        supabase_user_id: user.id,
      },
      subscription_data:
        mode === "subscription"
          ? {
              metadata: {
                plan,
                supabase_user_id: user.id,
              },
            }
          : undefined,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("create-checkout-session error", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}