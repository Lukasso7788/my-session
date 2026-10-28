import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseBillingStore, syncCheckoutSession } from "../_lib/stripeEntitlementSync.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const billingStore = createSupabaseBillingStore(supabaseAdmin);

/**
 * Called by /pricing/success. Returning to the success URL is not proof of
 * payment: this re-reads the Checkout Session and its subscription from Stripe
 * and applies whatever Stripe says, exactly like the webhook. The session must
 * belong to the bearer-authenticated user (server-set metadata); the request
 * body only names the session, never a user, plan or price.
 */
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
    if (!sessionId || typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      return res.status(400).json({ error: "Missing sessionId" });
    }

    const result = await syncCheckoutSession(
      { stripe, store: billingStore },
      sessionId,
      { expectedUserId: user.id },
    );

    res.setHeader("Cache-Control", "no-store");

    if (result.outcome === "user_mismatch") {
      return res.status(403).json({ error: "Session does not belong to current user" });
    }
    if (result.outcome === "not_a_subscription_checkout" || result.outcome === "unlinked") {
      return res.status(400).json({ error: "Not a MySession plan checkout" });
    }

    if (result.hasAccess) {
      try {
        await supabaseAdmin.rpc("enqueue_sender_event", {
          p_user_id: user.id,
          p_email: user.email || "",
          p_event_type: "subscription_started",
          p_properties: {
            user_id: user.id,
            first_name: String(user.user_metadata?.full_name || user.email || "Friend").split(" ")[0],
            timezone: user.user_metadata?.timezone || "UTC",
            plan: result.plan,
            pricing_url: `${process.env.APP_URL || "https://mysession.club"}/pricing`,
          },
          // Same key as the webhook, so the email is sent once.
          p_idempotency_key: `subscription_started:${result.session.id}`,
        });
      } catch (senderError) {
        console.error("Sender subscription event enqueue failed", senderError);
      }
    }

    // 200 in both cases: "pending" is a normal state for delayed payments.
    return res.status(200).json({
      ok: true,
      access: result.hasAccess ? "active" : "pending",
      plan: result.plan,
      accessEndsAt: result.accessEndsAt,
    });
  } catch (error) {
    console.error("confirm-checkout-session error", error);
    return res.status(500).json({ error: "Could not confirm checkout. Please refresh in a moment." });
  }
}
