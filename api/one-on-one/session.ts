import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

type RequestBody = {
  partnerUserId?: string;
  durationMinutes?: number;
  matchKey?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_DURATIONS = new Set([25, 45, 60]);

function bearerToken(req: VercelRequest) {
  const value = String(req.headers.authorization || "");
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

function parseBody(req: VercelRequest): RequestBody {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body) as RequestBody; } catch { return {}; }
  }
  return (req.body || {}) as RequestBody;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "supabase_service_env_missing" });

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: "auth_required" });

  const body = parseBody(req);
  const partnerUserId = String(body.partnerUserId || "").trim().toLowerCase();
  const durationMinutes = Math.round(Number(body.durationMinutes || 0));
  const matchKey = String(body.matchKey || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);

  if (!UUID_RE.test(partnerUserId)) return res.status(400).json({ error: "valid_partner_required" });
  if (!ALLOWED_DURATIONS.has(durationMinutes)) return res.status(400).json({ error: "invalid_duration" });
  if (!matchKey) return res.status(400).json({ error: "match_key_required" });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user?.id) return res.status(401).json({ error: "unauthorized" });
  if (user.id === partnerUserId) return res.status(400).json({ error: "partner_must_be_different" });

  const { data: partnerData, error: partnerError } = await admin.auth.admin.getUserById(partnerUserId);
  if (partnerError || !partnerData?.user?.id) return res.status(404).json({ error: "partner_not_found" });

  const marker = `one-on-one:${matchKey}`;
  const { data: existing } = await admin
    .from("sessions")
    .select("id")
    .eq("description", marker)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return res.status(200).json({ sessionId: existing.id, reused: true });

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name,email")
    .eq("id", user.id)
    .maybeSingle();
  const hostName = String(profile?.full_name || profile?.email || user.email || "Focus partner").trim();
  const startTime = new Date().toISOString();

  const { data: session, error: sessionError } = await admin
    .from("sessions")
    .insert({
      title: `${durationMinutes} min 1:1 focus session`,
      description: marker,
      host_id: user.id,
      host_name: hostName,
      duration_minutes: durationMinutes,
      format: "one_on_one",
      session_format_type: "one_on_one",
      start_time: startTime,
      status: "planned",
      is_silent: false,
      is_private: true,
      max_participants: 2,
      schedule: [{ name: "Focus", duration: durationMinutes, type: "focus", color: "#4F8CFF" }],
    })
    .select("id")
    .single();

  if (sessionError || !session?.id) {
    console.error("one-on-one session create failed", sessionError);
    return res.status(500).json({ error: "session_create_failed" });
  }

  const { error: bookingError } = await admin.from("session_bookings").insert([
    { session_id: session.id, user_id: user.id },
    { session_id: session.id, user_id: partnerUserId },
  ]);
  if (bookingError) {
    await admin.from("sessions").delete().eq("id", session.id);
    console.error("one-on-one bookings create failed", bookingError);
    return res.status(500).json({ error: "booking_create_failed" });
  }

  return res.status(200).json({ sessionId: session.id, reused: false });
}
