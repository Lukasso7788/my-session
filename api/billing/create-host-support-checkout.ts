import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

type Body = {
  hostUserId?: string;
  sessionId?: string | null;
  amountUsd?: number;
};

function parseBody(req: VercelRequest): Body {
  const raw = req.body as any;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Body;
    } catch {
      return {};
    }
  }
  return raw as Body;
}

function getBearerToken(req: VercelRequest): string {
  const h = String(req.headers.authorization || "");
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
}

function looksLikeUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(v || "").trim()
  );
}

function getSiteUrl(req: VercelRequest) {
  const configured = String(
    process.env.PUBLIC_SITE_URL ||
      process.env.VITE_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      ""
  ).trim();

  if (configured) return configured.replace(/\/+$/, "");

  const proto = String(req.headers["x-forwarded-proto"] || "https");
  const host = String(req.headers.host || "www.mysession.club");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Cache-Control", "no-store, max-age=0");

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
    const supabaseUrl = String(
      process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""
    ).trim();
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!stripeSecretKey) {
      return res.status(500).json({ error: "stripe_secret_key_missing" });
    }

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ error: "supabase_service_env_missing" });
    }

    const body = parseBody(req);
    const hostUserId = String(body.hostUserId || "").trim();
    const sessionId = String(body.sessionId || "").trim() || null;
    const amountUsd = Number(body.amountUsd || 0);

    if (!looksLikeUuid(hostUserId)) {
      return res.status(400).json({ error: "hostUserId_required" });
    }

    if (sessionId && !looksLikeUuid(sessionId)) {
      return res.status(400).json({ error: "invalid_sessionId" });
    }

    const allowedAmounts = [2, 5, 10];
    if (!allowedAmounts.includes(amountUsd)) {
      return res.status(400).json({
        error: "invalid_amount",
        allowedAmounts,
      });
    }

    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return res.status(401).json({ error: "auth_required" });
    }

    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await sb.auth.getUser(accessToken);

    if (userError || !userData?.user?.id) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const supporterUserId = String(userData.user.id || "").trim();

    if (supporterUserId === hostUserId) {
      return res.status(400).json({ error: "cannot_support_yourself" });
    }

    const { data: hostProfile, error: hostProfileError } = await sb
      .from("profiles")
      .select("id, full_name")
      .eq("id", hostUserId)
      .maybeSingle();

    if (hostProfileError || !hostProfile?.id) {
      return res.status(404).json({ error: "host_not_found" });
    }

    const { data: monetization, error: monetizationError } = await sb
      .from("host_monetization_profiles")
      .select("host_user_id, status, support_enabled, monthly_cap_usd")
      .eq("host_user_id", hostUserId)
      .maybeSingle();

    if (monetizationError) {
      console.error("host support monetization lookup failed:", monetizationError);
      return res.status(500).json({ error: "host_monetization_lookup_failed" });
    }

    if (
      !monetization ||
      monetization.status !== "active" ||
      monetization.support_enabled !== true
    ) {
      return res.status(403).json({ error: "host_support_not_enabled" });
    }

    const grossAmountUsd = amountUsd;
    const platformFeeUsd = Number((grossAmountUsd * 0.1).toFixed(2));
    const hostAmountUsd = Number((grossAmountUsd - platformFeeUsd).toFixed(2));

    const supportPaymentId = randomUUID();

    const siteUrl = getSiteUrl(req);
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-06-20",
    });

    const hostName = String((hostProfile as any).full_name || "this host").trim();

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      success_url: `${siteUrl}/profile/${hostUserId}?support=success`,
      cancel_url: `${siteUrl}/profile/${hostUserId}?support=cancelled`,
      client_reference_id: supportPaymentId,
      customer_email: String(userData.user.email || "").trim() || undefined,
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
          kind: "host_support",
          supportPaymentId,
          hostUserId,
          supporterUserId,
          sessionId: sessionId || "",
        },
      },
    });

    const { error: insertError } = await sb.from("host_support_payments").insert({
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
      return res.status(500).json({ error: "support_payment_insert_failed" });
    }

    return res.status(200).json({
      url: checkout.url,
      checkoutSessionId: checkout.id,
      supportPaymentId,
    });
  } catch (e: any) {
    console.error("create host support checkout error:", e);
    return res.status(500).json({
      error: "create_host_support_checkout_failed",
      message: String(e?.message || e || "unknown_error"),
    });
  }
}