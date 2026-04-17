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

type PaidPlan = "pro_monthly" | "pro_yearly" | "lifetime";

async function upsertEntitlement(params: {
  userId: string;
  plan: PaidPlan;
  source: string;
}) {
  const { userId, plan, source } = params;

  const nowIso = new Date().toISOString();

  const payload: Record<string, unknown> = {
    user_id: userId,
    plan,
    status: "active",
    source,
    notes: `Activated via checkout confirmation at ${nowIso}`,
  };

  if (plan === "pro_monthly") {
    payload.current_period_start = nowIso;
    payload.current_period_end = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    payload.trial_started_at = null;
    payload.trial_ends_at = null;
    payload.lifetime_granted_at = null;
    payload.founding_granted_at = null;
  } else if (plan === "pro_yearly") {
    payload.current_period_start = nowIso;
    payload.current_period_end = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000
    ).toISOString();
    payload.trial_started_at = null;
    payload.trial_ends_at = null;
    payload.lifetime_granted_at = null;
    payload.founding_granted_at = null;
  } else if (plan === "lifetime") {
    payload.lifetime_granted_at = nowIso;
    payload.current_period_start = null;
    payload.current_period_end = null;
    payload.trial_started_at = null;
    payload.trial_ends_at = null;
  }

  const { data, error } = await supabaseAdmin
    .from("user_entitlements")
    .upsert(payload, { onConflict: "user_id" })
    .select();

  if (error) {
    throw error;
  }

  return data;
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

    const { sessionId } = (req.body || {}) as { sessionId?: string };

    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const metadataPlan = session.metadata?.plan;
    const metadataUserId =
      session.metadata?.supabase_user_id || session.client_reference_id || "";

    if (!metadataPlan) {
      return res.status(400).json({ error: "Missing metadata.plan on Stripe session" });
    }

    if (!metadataUserId) {
      return res.status(400).json({ error: "Missing supabase user id on Stripe session" });
    }

    if (metadataUserId !== user.id) {
      return res.status(403).json({ error: "Session does not belong to current user" });
    }

    if (
      metadataPlan !== "pro_monthly" &&
      metadataPlan !== "pro_yearly" &&
      metadataPlan !== "lifetime"
    ) {
      return res.status(400).json({ error: "Invalid metadata.plan on Stripe session" });
    }

    const result = await upsertEntitlement({
      userId: metadataUserId,
      plan: metadataPlan,
      source: "checkout_confirm",
    });

    return res.status(200).json({
      ok: true,
      plan: metadataPlan,
      userId: metadataUserId,
      result,
    });
  } catch (error) {
    console.error("confirm-checkout-session error", error);

    return res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}