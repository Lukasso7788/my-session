import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function getBearerToken(req: VercelRequest) {
  const raw = String(req.headers.authorization || "");
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || "";
}

function getBody(req: VercelRequest) {
  const raw = req.body;

  if (!raw) return {};

  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  return raw;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({ error: "missing_bearer_token" });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

    if (userErr || !userData?.user?.id) {
      return res.status(401).json({
        error: "invalid_user_token",
        details: userErr?.message || null,
      });
    }

    const userId = userData.user.id;
    const body = getBody(req);

    const subscription = body.subscription || {};
    const endpoint = String(subscription.endpoint || "").trim();
    const p256dh = String(subscription.keys?.p256dh || "").trim();
    const auth = String(subscription.keys?.auth || "").trim();

    const userAgent = String(
      body.userAgent || req.headers["user-agent"] || ""
    ).slice(0, 500);

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({
        error: "invalid_push_subscription",
        debug: {
          hasEndpoint: !!endpoint,
          hasP256dh: !!p256dh,
          hasAuth: !!auth,
          bodyKeys: Object.keys(body || {}),
          subscriptionKeys: Object.keys(subscription || {}),
          nestedKeys: Object.keys(subscription.keys || {}),
          userAgent,
        },
      });
    }

    const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,endpoint",
      }
    );

    if (error) {
      return res.status(500).json({
        error: "push_subscription_save_failed",
        details: error.message,
      });
    }

    return res.status(200).json({
      ok: true,
      endpointHost: (() => {
        try {
          return new URL(endpoint).host;
        } catch {
          return "";
        }
      })(),
    });
  } catch (e: any) {
    return res.status(500).json({
      error: "push_subscribe_failed",
      details: String(e?.message || e || "unknown_error"),
    });
  }
}