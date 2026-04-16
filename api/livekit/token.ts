import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AccessToken } from "livekit-server-sdk";
import { createClient } from "@supabase/supabase-js";

type Body = {
  roomName?: string;
  identity?: string;
  name?: string;
  sessionId?: string;

  // DEPRECATED (не используем для авторизации)
  isHost?: boolean;
  isModerator?: boolean;
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

async function resolveRole(params: {
  supabaseUrl: string;
  serviceKey: string;
  accessToken: string;
  sessionId: string;
}): Promise<{ userId: string; isHost: boolean; isModerator: boolean }> {
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

  return { userId, isHost, isModerator };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Cache-Control", "no-store, max-age=0");

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const { roomName, identity, name, sessionId: bodySessionId } = parseBody(req);

    if (!roomName || !identity) {
      return res.status(400).json({ error: "roomName_and_identity_required" });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      console.error("livekit token error: missing env", {
        hasKey: !!apiKey,
        hasSecret: !!apiSecret,
      });
      return res.status(500).json({ error: "livekit_keys_missing" });
    }

    const accessToken = getBearerToken(req);
    const sessionId = String(bodySessionId || deriveSessionId(roomName)).toLowerCase();

    let role = { isHost: false, isModerator: false, userId: "" };

    // Если identity выглядит как UUID — требуем Supabase auth, иначе можно подделать host_id
    if (looksLikeUuid(String(identity))) {
      if (!accessToken) {
        return res.status(401).json({
          error: "auth_required",
          hint: "UUID identity requires Authorization: Bearer <supabase_access_token>",
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

      if (!looksLikeUuid(sessionId)) {
        return res.status(400).json({
          error: "sessionId_required",
          hint: "Pass sessionId or use roomName=session-<uuid>",
        });
      }

      const resolved = await resolveRole({ supabaseUrl, serviceKey, accessToken, sessionId });

      // жёстко: identity должен совпадать с auth user id
      const idn = String(identity).toLowerCase();
      if (idn !== resolved.userId) {
        return res.status(403).json({
          error: "identity_mismatch",
          hint: "identity must equal authenticated user id",
        });
      }

      role = resolved;
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: String(identity),
      name: name ? String(name) : undefined,
    });

    const grant: any = {
      room: String(roomName),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    };

    // Даем roomAdmin хосту И модератору
    if (role.isHost || role.isModerator) {
      grant.roomAdmin = true;
    }

    at.addGrant(grant);

    const token = await at.toJwt();

    console.log("LK TOKEN GENERATED", {
      marker: "lk-token-secure-v2",
      roomName: String(roomName),
      identity: String(identity),
      isHost: role.isHost,
      isModerator: role.isModerator,
      canUpdateOwnMetadata: true,
      apiKeyPrefix: String(apiKey).slice(0, 6),
      tokenPreview: `${token.slice(0, 18)}...${token.slice(-10)}`,
    });

    return res.status(200).json({
      token,
      isHost: role.isHost,
      isModerator: role.isModerator,
    });
  } catch (e: any) {
    const msg = String(e?.message || e || "unknown_error");
    console.error("livekit token error:", e);

    if (msg === "unauthorized") {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (msg === "session_not_found") {
      return res.status(404).json({ error: "session_not_found" });
    }

    return res.status(500).json({ error: "token_generation_failed", message: msg });
  }
}