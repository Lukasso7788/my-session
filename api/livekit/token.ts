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
  baseUserId?: string;
  tabId?: string;
};

type ResolvedRole = {
  userId: string;
  isHost: boolean;
  isModerator: boolean;
};

type SessionServerResolution = {
  assignedServerId: string | null;
  livekitWsUrl: string;
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

function extractBaseUserIdFromIdentity(identity?: string): string {
  const raw = String(identity || "").trim().toLowerCase();
  const first = raw.split("--")[0] || raw;
  return looksLikeUuid(first) ? first : "";
}

async function resolveRole(params: {
  supabaseUrl: string;
  serviceKey: string;
  accessToken: string;
  sessionId: string;
}): Promise<ResolvedRole> {
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

    if (!rErr && Array.isArray(rData) && rData.length > 0) {
      isModerator = true;
    }
  }

  return { userId, isHost, isModerator };
}

async function resolveAssignedServer(params: {
  supabaseUrl: string;
  serviceKey: string;
  sessionId: string;
}): Promise<SessionServerResolution> {
  const { supabaseUrl, serviceKey, sessionId } = params;

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const fallbackLivekitUrl = String(process.env.LIVEKIT_URL || "").trim();

  const { data: sessionRow, error: sessionError } = await sb
    .from("sessions")
    .select("id, assigned_server_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    console.error("token: failed to load session for assigned server", sessionError);
    throw new Error("assigned_server_lookup_failed");
  }

  const assignedServerId = String((sessionRow as any)?.assigned_server_id || "").trim();

  if (!assignedServerId) {
    if (!fallbackLivekitUrl) {
      throw new Error("livekit_url_missing");
    }

    return {
      assignedServerId: null,
      livekitWsUrl: fallbackLivekitUrl,
    };
  }

  const { data: serverRow, error: serverError } = await sb
    .from("livekit_servers")
    .select("id, ws_url, enabled")
    .eq("id", assignedServerId)
    .maybeSingle();

  if (serverError) {
    console.error("token: failed to load assigned server", serverError);
    throw new Error("assigned_server_lookup_failed");
  }

  const enabled = Boolean((serverRow as any)?.enabled);
  const wsUrl = String((serverRow as any)?.ws_url || "").trim();

  if (enabled && wsUrl) {
    return {
      assignedServerId,
      livekitWsUrl: wsUrl,
    };
  }

  if (!fallbackLivekitUrl) {
    throw new Error("livekit_url_missing");
  }

  return {
    assignedServerId,
    livekitWsUrl: fallbackLivekitUrl,
  };
}

async function getActiveBan(params: {
  supabaseUrl: string;
  serviceKey: string;
  userId: string;
}) {
  const { supabaseUrl, serviceKey, userId } = params;

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date().toISOString();

  const { data, error } = await sb
    .from("user_bans")
    .select("id, banned_user_id, reason, starts_at, expires_at, revoked_at, created_at")
    .eq("banned_user_id", userId)
    .is("revoked_at", null)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("token: failed to check active ban", error);
    throw new Error("ban_check_failed");
  }

  return data || null;
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

    const supabaseUrl = String(
      process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""
    ).trim();
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({
        error: "supabase_service_env_missing",
        hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const accessToken = getBearerToken(req);
    const sessionId = String(bodySessionId || deriveSessionId(roomName)).toLowerCase();

    let role: ResolvedRole = { isHost: false, isModerator: false, userId: "" };

    // LiveKit identities in the app are usually "<supabase-user-id>--<tab-id>".
    // The old check only handled a raw UUID identity, so banned users with tab identities
    // could still receive tokens. Always validate the base user id when present.
    const identityBaseUserId = extractBaseUserIdFromIdentity(String(identity));

    if (identityBaseUserId) {
      if (!accessToken) {
        return res.status(401).json({
          error: "auth_required",
          hint: "Authenticated LiveKit identity requires Authorization: Bearer <supabase_access_token>",
        });
      }

      if (!looksLikeUuid(sessionId)) {
        return res.status(400).json({
          error: "sessionId_required",
          hint: "Pass sessionId or use roomName=session-<uuid>",
        });
      }

      const resolved = await resolveRole({
        supabaseUrl,
        serviceKey,
        accessToken,
        sessionId,
      });

      if (identityBaseUserId !== resolved.userId) {
        return res.status(403).json({
          error: "identity_mismatch",
          hint: "identity base user id must equal authenticated user id",
        });
      }

      role = resolved;

      const activeBan = await getActiveBan({
        supabaseUrl,
        serviceKey,
        userId: resolved.userId,
      });

      if (activeBan) {
        return res.status(403).json({
          error: "USER_BANNED",
          reason: String((activeBan as any).reason || "You are banned from MySession."),
          expires_at: (activeBan as any).expires_at || null,
          starts_at: (activeBan as any).starts_at || null,
          server_now: new Date().toISOString(),
        });
      }
    }

    let assignedServerId: string | null = null;
    let livekitWsUrl = String(process.env.LIVEKIT_URL || "").trim();

    if (looksLikeUuid(sessionId)) {
      const resolvedServer = await resolveAssignedServer({
        supabaseUrl,
        serviceKey,
        sessionId,
      });

      assignedServerId = resolvedServer.assignedServerId;
      livekitWsUrl = resolvedServer.livekitWsUrl;
    }

    if (!livekitWsUrl) {
      return res.status(500).json({
        error: "livekit_url_missing",
        hint: "Set LIVEKIT_URL or assign a server with ws_url",
      });
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

    if (role.isHost || role.isModerator) {
      grant.roomAdmin = true;
    }

    at.addGrant(grant);

    const token = await at.toJwt();

    console.log("LK TOKEN GENERATED", {
      marker: "lk-token-secure-v3-server-aware",
      roomName: String(roomName),
      identity: String(identity),
      sessionId,
      assignedServerId,
      livekitWsUrl,
      isHost: role.isHost,
      isModerator: role.isModerator,
      apiKeyPrefix: String(apiKey).slice(0, 6),
      tokenPreview: `${token.slice(0, 18)}...${token.slice(-10)}`,
    });

    return res.status(200).json({
      token,
      url: livekitWsUrl,
      assignedServerId,
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
    if (msg === "ban_check_failed") {
      return res.status(500).json({ error: "ban_check_failed" });
    }

    return res.status(500).json({ error: "token_generation_failed", message: msg });
  }
}