import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type PaidPlan = "pro_monthly" | "pro_yearly" | "lifetime";

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function normalizePaidPlan(plan: string | undefined | null): PaidPlan | null {
  if (plan === "india_upi_monthly") return "pro_monthly";
  if (plan === "pro_monthly") return "pro_monthly";
  if (plan === "pro_yearly") return "pro_yearly";
  if (plan === "lifetime") return "lifetime";
  return null;
}

async function upsertEntitlement(params: {
  userId: string;
  plan: PaidPlan;
  source: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}) {
  const { userId, plan, source, stripeCustomerId, stripeSubscriptionId } = params;
  const nowIso = new Date().toISOString();

  const payload: Record<string, unknown> = {
    user_id: userId,
    plan,
    status: "active",
    source,
    force_paywall: false,
    updated_at: nowIso,
    notes: `Activated via Stripe webhook at ${nowIso}`,
  };

  if (stripeCustomerId) payload.stripe_customer_id = stripeCustomerId;
  if (stripeSubscriptionId) payload.stripe_subscription_id = stripeSubscriptionId;

  if (plan === "pro_monthly") {
    payload.current_period_start = nowIso;
    payload.current_period_end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    payload.trial_started_at = null;
    payload.trial_ends_at = null;
    payload.lifetime_granted_at = null;
    payload.founding_granted_at = null;
  }

  if (plan === "pro_yearly") {
    payload.current_period_start = nowIso;
    payload.current_period_end = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    payload.trial_started_at = null;
    payload.trial_ends_at = null;
    payload.lifetime_granted_at = null;
    payload.founding_granted_at = null;
  }

  if (plan === "lifetime") {
    payload.lifetime_granted_at = nowIso;
    payload.current_period_start = null;
    payload.current_period_end = null;
    payload.trial_started_at = null;
    payload.trial_ends_at = null;
    payload.founding_granted_at = null;
  }

  const { error } = await supabaseAdmin
    .from("user_entitlements")
    .upsert(payload, { onConflict: "user_id" });

  if (error) throw error;

  return payload;
}

async function rewardReferrerForFirstPayment(params: {
  referredUserId: string;
  stripeCheckoutSessionId: string;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
}) {
  const { referredUserId, stripeCheckoutSessionId, stripeSubscriptionId, stripeCustomerId } = params;

  const { error } = await supabaseAdmin.rpc("reward_referrer_for_first_payment", {
    p_referred_user_id: referredUserId,
    p_payment_id: null,
  });

  if (error) {
    console.error("Stripe webhook: affiliate reward RPC failed", {
      referredUserId,
      stripeCheckoutSessionId,
      stripeSubscriptionId,
      stripeCustomerId,
      error,
    });

    throw error;
  }

  console.log("Stripe webhook affiliate reward processed", {
    referredUserId,
    stripeCheckoutSessionId,
    stripeSubscriptionId,
    stripeCustomerId,
  });
}

async function markHostSupportPaymentAvailable(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {};
  const supportPaymentId = String(metadata.supportPaymentId || "").trim();

  if (!supportPaymentId) {
    console.error("Stripe webhook: missing supportPaymentId for host support", {
      sessionId: session.id,
      metadata,
    });
    throw new Error("missing_support_payment_id");
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || "";

  const nowIso = new Date().toISOString();

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("host_support_payments")
    .select("id, status")
    .eq("id", supportPaymentId)
    .maybeSingle();

  if (existingError) throw existingError;

  if (!existing?.id) {
    console.error("Stripe webhook: host support payment row not found", {
      sessionId: session.id,
      supportPaymentId,
      metadata,
    });
    throw new Error("host_support_payment_not_found");
  }

  if (existing.status === "available" || existing.status === "paid_out") {
    console.log("Stripe webhook: host support already processed", {
      sessionId: session.id,
      supportPaymentId,
      status: existing.status,
    });
    return;
  }

  const { error: updateError } = await supabaseAdmin
    .from("host_support_payments")
    .update({
      status: "available",
      stripe_payment_intent_id: paymentIntentId || null,
      available_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", supportPaymentId);

  if (updateError) throw updateError;

  console.log("Stripe webhook host support marked available", {
    sessionId: session.id,
    supportPaymentId,
    paymentIntentId,
    hostUserId: metadata.hostUserId,
    supporterUserId: metadata.supporterUserId,
    grossAmountUsd: metadata.grossAmountUsd,
    hostAmountUsd: metadata.hostAmountUsd,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const signature = req.headers["stripe-signature"];

  if (!signature || typeof signature !== "string") {
    return res.status(400).send("Missing stripe-signature header");
  }

  try {
    const rawBody = await readRawBody(req);

    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const checkoutKind = String(session.metadata?.checkout_kind || session.metadata?.kind || "").trim();

      if (checkoutKind === "host_support") {
        await markHostSupportPaymentAvailable(session);
        return res.status(200).json({ received: true, kind: "host_support" });
      }

      const rawMetadataPlan = session.metadata?.entitlement_plan || session.metadata?.plan;
      const metadataPlan = normalizePaidPlan(rawMetadataPlan);
      const metadataUserId = session.metadata?.supabase_user_id || session.client_reference_id || "";

      if (!metadataPlan) {
        console.error("Stripe webhook: missing or invalid metadata plan", {
          sessionId: session.id,
          rawMetadataPlan,
          metadata: session.metadata,
        });
        return res.status(400).send("Missing or invalid metadata plan");
      }

      if (!metadataUserId) {
        console.error("Stripe webhook: missing user id metadata", {
          sessionId: session.id,
          clientReferenceId: session.client_reference_id,
          metadata: session.metadata,
        });
        return res.status(400).send("Missing user id metadata");
      }

      const stripeCustomerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id || "";

      const stripeSubscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id || "";

      const payload = await upsertEntitlement({
        userId: metadataUserId,
        plan: metadataPlan,
        source: "stripe_webhook",
        stripeCustomerId,
        stripeSubscriptionId,
      });

      await rewardReferrerForFirstPayment({
        referredUserId: metadataUserId,
        stripeCheckoutSessionId: session.id,
        stripeSubscriptionId,
        stripeCustomerId,
      });

      console.log("Stripe webhook entitlement updated", {
        sessionId: session.id,
        userId: metadataUserId,
        plan: metadataPlan,
        rawMetadataPlan,
        stripeCustomerId,
        stripeSubscriptionId,
        force_paywall: payload.force_paywall,
      });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error", error);
    return res.status(400).send(`Webhook Error: ${(error as Error).message}`);
  }
}