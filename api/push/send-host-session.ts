import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:support@mysession.club",
  process.env.VAPID_PUBLIC_KEY || "",
  process.env.VAPID_PRIVATE_KEY || ""
);

function getBearerToken(req: VercelRequest) {
  const raw = String(req.headers.authorization || "");
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || "";
}

function getHeader(req: VercelRequest, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

async function sendPushBatch(subscriptions: any[], payload: string) {
  let sent = 0;
  let failed = 0;
  let deleted = 0;

  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload
      );
      sent += 1;
    } catch (e: any) {
      failed += 1;
      const statusCode = Number(e?.statusCode || 0);

      if (statusCode === 404 || statusCode === 410) {
        await supabaseAdmin.from("push_subscriptions").delete().eq("id", row.id);
        deleted += 1;
      } else {
        console.error("[push] send failed", {
          subscriptionId: row.id,
          statusCode,
          message: e?.message,
        });
      }
    }
  }

  return { sent, failed, deleted };
}

async function sendRoomPresencePush(req: VercelRequest, res: VercelResponse) {
  const expectedSecret = String(process.env.PUSH_DISPATCH_SECRET || "").trim();
  const suppliedSecret = getHeader(req, "x-push-dispatch-secret").trim();

  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return res.status(401).json({ error: "invalid_push_dispatch_secret" });
  }

  const sessionId = String(req.body?.sessionId || "").trim();
  const participantCount = Number(req.body?.participantCount || 0);

  if (!sessionId || !Number.isFinite(participantCount) || participantCount < 1) {
    return res.status(400).json({ error: "invalid_presence_payload" });
  }

  const { data: session, error: sessionErr } = await supabaseAdmin
    .from("sessions")
    .select("id, title, is_private")
    .eq("id", sessionId)
    .single();

  if (sessionErr || !session) {
    return res.status(404).json({ error: "session_not_found" });
  }

  if ((session as any).is_private === true) {
    return res.status(200).json({ ok: true, sent: 0, reason: "private_session" });
  }

  const [{ data: subscriptions, error: subsErr }, { data: activeRows }] = await Promise.all([
    supabaseAdmin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth"),
    supabaseAdmin
      .from("session_attendance")
      .select("user_id")
      .eq("session_id", sessionId)
      .is("left_at", null)
      .gte("last_seen_at", new Date(Date.now() - 90_000).toISOString()),
  ]);

  if (subsErr) {
    return res.status(500).json({ error: "subscriptions_query_failed", details: subsErr.message });
  }

  const { data: disabledRows, error: preferencesErr } = await supabaseAdmin
    .from("notification_preferences")
    .select("user_id")
    .eq("focus_presence_push_enabled", false);

  // A missing preference means enabled. This also keeps existing subscribers
  // working while the database migration is being rolled out.
  if (preferencesErr) {
    console.warn("[push] presence preferences unavailable; using default-on", preferencesErr.message);
  }

  const disabledUserIds = new Set((disabledRows || []).map((row: any) => String(row.user_id || "")));
  const activeUserIds = new Set((activeRows || []).map((row: any) => String(row.user_id || "")));
  const eligibleSubscriptions = (subscriptions || []).filter((row: any) => {
    const userId = String(row.user_id || "");
    return userId && !disabledUserIds.has(userId) && !activeUserIds.has(userId);
  });

  if (!eligibleSubscriptions.length) {
    return res.status(200).json({
      ok: true,
      sent: 0,
      reason: "no_eligible_subscriptions",
      excludedActiveUsers: activeUserIds.size,
    });
  }

  const sessionTitle = String((session as any).title || "Focus room").trim() || "Focus room";
  const payload = JSON.stringify({
    title: `${participantCount} ${participantCount === 1 ? "person is" : "people are"} focusing right now`,
    body: `Join them in ${sessionTitle}.`,
    icon: "/icons/followers_profile.svg",
    badge: "/icons/followers_profile.svg",
    tag: `focus-presence-${sessionId}`,
    renotify: false,
    data: {
      url: `/room-livekit/${sessionId}`,
      sessionId,
      type: "focus_room_presence",
    },
  });

  const result = await sendPushBatch(eligibleSubscriptions, payload);
  return res.status(200).json({
    ok: true,
    subscriptions: eligibleSubscriptions.length,
    excludedActiveUsers: activeUserIds.size,
    ...result,
  });
}

function formatSessionTime(startTime: string | null) {
  if (!startTime) return "";

  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(d);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return res.status(500).json({ error: "missing_vapid_keys" });
    }

    if (req.body?.action === "room_presence") {
      return await sendRoomPresencePush(req, res);
    }

    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({ error: "missing_bearer_token" });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

    if (userErr || !userData?.user?.id) {
      return res.status(401).json({ error: "invalid_user_token" });
    }

    const actorUserId = userData.user.id;
    const sessionId = String(req.body?.sessionId || "").trim();

    if (!sessionId) {
      return res.status(400).json({ error: "missing_session_id" });
    }

    const { data: session, error: sessionErr } = await supabaseAdmin
      .from("sessions")
      .select("id, title, start_time, host_id")
      .eq("id", sessionId)
      .single();

    if (sessionErr || !session) {
      return res.status(404).json({ error: "session_not_found" });
    }

    const hostId = String((session as any).host_id || "");

    if (!hostId || hostId !== actorUserId) {
      return res.status(403).json({ error: "only_host_can_send_notification" });
    }

    const { data: hostProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", hostId)
      .single();

    const hostName = String((hostProfile as any)?.full_name || "A host").trim();
    const sessionTitle = String((session as any).title || "a new session").trim();
    const timeText = formatSessionTime((session as any).start_time || null);

    const { data: followers, error: followersErr } = await supabaseAdmin
      .from("host_followers")
      .select("follower_user_id")
      .eq("host_user_id", hostId);

    if (followersErr) {
      return res.status(500).json({
        error: "followers_query_failed",
        details: followersErr.message,
      });
    }

    const followerIds = Array.from(
      new Set((followers || []).map((x: any) => String(x.follower_user_id || "")).filter(Boolean))
    );

    if (!followerIds.length) {
      return res.status(200).json({ ok: true, sent: 0, reason: "no_followers" });
    }

    const { data: subscriptions, error: subsErr } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", followerIds);

    if (subsErr) {
      return res.status(500).json({
        error: "subscriptions_query_failed",
        details: subsErr.message,
      });
    }

    if (!subscriptions?.length) {
      return res.status(200).json({ ok: true, sent: 0, reason: "no_push_subscriptions" });
    }

    const payload = JSON.stringify({
      title: `${hostName} scheduled a session`,
      body: timeText ? `${sessionTitle} · ${timeText}` : sessionTitle,
      icon: "/icons/followers_profile.svg",
      badge: "/icons/followers_profile.svg",
      data: {
        url: `/room-livekit/${sessionId}`,
        sessionId,
        hostId,
      },
    });

    const { sent, failed, deleted } = await sendPushBatch(subscriptions as any[], payload);

    return res.status(200).json({
      ok: true,
      followers: followerIds.length,
      subscriptions: subscriptions.length,
      sent,
      failed,
      deleted,
    });
  } catch (e: any) {
    return res.status(500).json({
      error: "send_host_session_push_failed",
      details: String(e?.message || e || "unknown_error"),
    });
  }
}
