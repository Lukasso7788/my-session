import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RoomServiceClient } from "livekit-server-sdk";
import { createClient } from "@supabase/supabase-js";

type AdminAction = "mute_track" | "unmute_track" | "remove_participant";

type Body = {
  action?: AdminAction;
  roomName?: string;
  sessionId?: string;
  participantIdentity?: string;
  trackSid?: string;

  // DEPRECATED (не используем для авторизации)
  isHost?: boolean;
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

function normalizeLiveKitHost(raw: string): string {
  let host = (raw || "").trim();
  if (!host) return "";

  if (host.startsWith("wss://")) host = "https://" + host.slice("wss://".length);
  if (host.startsWith("ws://")) host = "http://" + host.slice("ws://".length);

  host = host.replace(/\/+$/, "");
  return host;
}

function getLiveKitHttpHost(): string {
  const candidates = [
    process.env.LIVEKIT_HTTP_URL,
    process.env.LIVEKIT_URL,
    process.env.VITE_LIVEKIT_URL,
  ];

  for (const c of candidates) {
    const norm = normalizeLiveKitHost(String(c || ""));
    if (norm) return norm;
  }
  return "";
}

function getBearerToken(req: VercelRequest): string {
  const h = String(req.headers.authorization || "");
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
}

function looksLikeUuid(v: string) {
  const s = String(v || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
}

function deriveSessionId(roomName?: string): string {
  const rn = String(roomName || "").trim().toLowerCase();
  if (rn.startsWith("session-")) {
    const rest = rn.slice("session-".length);
    if (looksLikeUuid(rest)) return rest;
  }
  return "";
}

async function getActorRole(params: {
  supabaseUrl: string;
  serviceKey: string;
  accessToken: string;
  sessionId: string;
}): Promise<{ userId: string; hostId: string; isHost: boolean; isModerator: boolean }> {
  const { supabaseUrl, serviceKey, accessToken, sessionId } = params;

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: uData, error: uErr } = await sb.auth.getUser(accessToken);
  if (uErr || !uData?.user) throw new Error("unauthorized");

  const userId = String(uData.user.id || "").toLowerCase();
  if (!looksLikeUuid(userId)) throw new Error("unauthorized");

  const { data: sData, error: sErr } = await sb
    .from("sessions")
    .select("id, host_id")
    .eq("id", sessionId)
    .single();

  if (sErr || !sData?.id) throw new Error("session_not_found");

  const hostId = String((sData as any).host_id || "").toLowerCase();
  const isHost = !!hostId && hostId === userId;

  let isModerator = false;
  if (!isHost) {
    const { data: rData, error: rErr } = await sb
      .from("session_role_assignments")
      .select("id")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .eq("role", "moderator")
      .limit(1);

    if (!rErr && Array.isArray(rData) && rData.length > 0) isModerator = true;
  }

  return { userId, hostId, isHost, isModerator };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Cache-Control", "no-store, max-age=0");

    const origin = String(req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const body = parseBody(req);
    const action = String(body.action || "") as AdminAction;
    const roomName = String(body.roomName || "").trim();
    const participantIdentity = String(body.participantIdentity || "").trim();
    const trackSid = String(body.trackSid || "").trim();

    if (!action || !roomName) {
      return res.status(400).json({ error: "action_and_roomName_required" });
    }

    const sessionId = String(body.sessionId || deriveSessionId(roomName)).toLowerCase();
    if (!looksLikeUuid(sessionId)) {
      return res.status(400).json({
        error: "sessionId_required",
        hint: "Pass sessionId or use roomName=session-<uuid>",
      });
    }

    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return res.status(401).json({
        error: "auth_required",
        hint: "Send Authorization: Bearer <supabase_access_token>",
      });
    }

    const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({
        error: "supabase_service_env_missing",
        hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const actor = await getActorRole({ supabaseUrl, serviceKey, accessToken, sessionId });
    if (!actor.isHost && !actor.isModerator) {
      return res.status(403).json({ error: "forbidden", reason: "host_or_moderator_required" });
    }

    const targetId = participantIdentity.toLowerCase();
    if (!actor.isHost && looksLikeUuid(targetId) && actor.hostId && targetId === actor.hostId) {
      return res.status(403).json({ error: "forbidden", reason: "moderator_cannot_target_host" });
    }

    const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
    const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
    const livekitHost = getLiveKitHttpHost();

    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: "livekit_keys_missing" });
    }

    if (!livekitHost) {
      return res.status(500).json({
        error: "livekit_http_host_missing",
        hint: "Set LIVEKIT_HTTP_URL (or LIVEKIT_URL / VITE_LIVEKIT_URL) in Vercel env",
      });
    }

    const svc = new RoomServiceClient(livekitHost, apiKey, apiSecret);

    if (action === "remove_participant") {
      if (!participantIdentity) {
        return res.status(400).json({ error: "participantIdentity_required" });
      }

      await svc.removeParticipant(roomName, participantIdentity);

      return res.status(200).json({
        ok: true,
        action,
        roomName,
        participantIdentity,
        actor: { userId: actor.userId, isHost: actor.isHost, isModerator: actor.isModerator },
      });
    }

    if (action === "mute_track" || action === "unmute_track") {
      if (!participantIdentity || !trackSid) {
        return res.status(400).json({ error: "participantIdentity_and_trackSid_required" });
      }

      const muted = action === "mute_track";

      await svc.mutePublishedTrack(roomName, participantIdentity, trackSid, muted);

      return res.status(200).json({
        ok: true,
        action,
        roomName,
        participantIdentity,
        trackSid,
        muted,
        actor: { userId: actor.userId, isHost: actor.isHost, isModerator: actor.isModerator },
      });
    }

    return res.status(400).json({ error: "unsupported_action" });
  } catch (e: any) {
    const msg = String(e?.message || e || "unknown_error");
    console.error("livekit admin error:", e);

    if (msg === "unauthorized") return res.status(401).json({ error: "unauthorized" });
    if (msg === "session_not_found") return res.status(404).json({ error: "session_not_found" });

    return res.status(500).json({ error: "livekit_admin_failed", message: msg });
  }
}