import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AccessToken } from "livekit-server-sdk";
import { createClient } from "@supabase/supabase-js";

type Body = { roomName?: string; identity?: string; name?: string; sessionId?: string; isHost?: boolean; isModerator?: boolean; baseUserId?: string; tabId?: string; inviteToken?: string; };
type ResolvedRole = { userId: string; isHost: boolean; isModerator: boolean; };
type SessionServerResolution = { assignedServerId: string | null; livekitWsUrl: string; };
type AdmissionResult = { allowed: boolean; error?: string; message?: string; bookedCount?: number; maxParticipants?: number; opensAt?: string | null; isBooked?: boolean; };

function parseBody(req: VercelRequest): Body {
  const raw = req.body as any;
  if (!raw) return {};
  if (typeof raw === "string") { try { return JSON.parse(raw) as Body; } catch { return {}; } }
  return raw as Body;
}
function getBearerToken(req: VercelRequest): string {
  const h = String(req.headers.authorization || "");
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}
function looksLikeUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(v || "").trim().toLowerCase());
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
  const first = String(identity || "").trim().toLowerCase().split("--")[0] || "";
  return looksLikeUuid(first) ? first : "";
}
function adminClient(supabaseUrl: string, serviceKey: string) {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function resolveRole(params: { supabaseUrl: string; serviceKey: string; accessToken: string; sessionId: string; }): Promise<ResolvedRole> {
  const sb = adminClient(params.supabaseUrl, params.serviceKey);
  const { data: uData, error: uErr } = await sb.auth.getUser(params.accessToken);
  if (uErr || !uData?.user) throw new Error("unauthorized");

  const userId = String(uData.user.id || "").toLowerCase();
  if (!looksLikeUuid(userId)) throw new Error("unauthorized");

  const { data: sData, error: sErr } = await sb.from("sessions").select("id, host_id").eq("id", params.sessionId).single();
  if (sErr || !sData?.id) throw new Error("session_not_found");

  const isHost = String((sData as any).host_id || "").toLowerCase() === userId;
  let isModerator = false;

  if (!isHost) {
    const { data: rData, error: rErr } = await sb
      .from("session_role_assignments")
      .select("id")
      .eq("session_id", params.sessionId)
      .eq("user_id", userId)
      .eq("role", "moderator")
      .limit(1);

    isModerator = !rErr && Array.isArray(rData) && rData.length > 0;
  }

  if (!isHost && !isModerator) {
    const nowIso = new Date().toISOString();
    const ownerActiveSinceIso = new Date(Date.now() - 120_000).toISOString();
    const hostId = String((sData as any).host_id || "").toLowerCase();

    const { data: lease, error: leaseErr } = await sb
      .from("infinite_room_host_leases")
      .select("user_id,expires_at")
      .eq("session_id", params.sessionId)
      .eq("user_id", userId)
      .gt("expires_at", nowIso)
      .maybeSingle();

    if (!leaseErr && lease?.user_id) {
      const { data: ownerAttendance, error: ownerAttendanceErr } = hostId
        ? await sb
            .from("session_attendance")
            .select("user_id")
            .eq("session_id", params.sessionId)
            .eq("user_id", hostId)
            .is("left_at", null)
            .gte("last_seen_at", ownerActiveSinceIso)
            .limit(1)
        : { data: [], error: null };

      const ownerIsPresent =
        !ownerAttendanceErr &&
        Array.isArray(ownerAttendance) &&
        ownerAttendance.length > 0;
      if (!ownerIsPresent) isModerator = true;
    }
  }

  return { userId, isHost, isModerator };
}

async function resolveAdmission(params: {
  supabaseUrl: string; serviceKey: string; sessionId: string; userId: string; isHost: boolean; isModerator: boolean; inviteToken?: string;
}): Promise<AdmissionResult> {
  if (params.isHost || params.isModerator) return { allowed: true };

  const sb = adminClient(params.supabaseUrl, params.serviceKey);

  const { data: s, error: sErr } = await sb
    .from("sessions")
    .select("id, host_id, start_time, max_participants, max_slots, status, format, session_format_type, description")
    .eq("id", params.sessionId)
    .maybeSingle();

  if (sErr) {
    console.error("token: admission session lookup failed", sErr);
    throw new Error("admission_check_failed");
  }
  if (!s?.id) throw new Error("session_not_found");

  const maxRaw = Number((s as any).max_participants || 0);
  const maxParticipants = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.max(2, Math.min(50, Math.round(maxRaw))) : 16;

  const { data: bookings, error: bErr } = await sb
    .from("session_bookings")
    .select("id,user_id,invite_uid")
    .eq("session_id", params.sessionId);

  if (bErr) {
    console.error("token: admission bookings lookup failed", bErr);
    throw new Error("admission_check_failed");
  }

  const bookedUserIds = Array.isArray(bookings)
    ? bookings.map((b: any) => String(b?.user_id || "").toLowerCase()).filter(Boolean)
    : [];

  const userId = String(params.userId || "").toLowerCase();
  const isBooked = bookedUserIds.includes(userId);
  const bookedCount = bookedUserIds.length;

  const sessionMode = String((s as any).session_format_type || (s as any).format || "").trim().toLowerCase();
  const isOneOnOneSession =
    sessionMode === "one_on_one" ||
    String((s as any).description || "").startsWith("one-on-one:");
  const admissionLimit = isOneOnOneSession ? 2 : maxParticipants;
  if (isBooked) return { allowed: true, bookedCount, maxParticipants: admissionLimit, isBooked: true };
  if (isOneOnOneSession) {
    const inviteToken = String(params.inviteToken || "").trim();
    if (inviteToken && bookedCount < admissionLimit) {
      const { data: claimed, error: claimError } = await sb
        .from("session_bookings")
        .update({ user_id: userId, invite_uid: null })
        .eq("session_id", params.sessionId)
        .eq("invite_uid", inviteToken)
        .is("user_id", null)
        .select("id")
        .maybeSingle();
      if (claimError) {
        console.error("token: one-on-one invite claim failed", claimError);
        throw new Error("admission_check_failed");
      }
      if (claimed?.id) {
        return { allowed: true, bookedCount: bookedCount + 1, maxParticipants: admissionLimit, isBooked: true };
      }
    }
    return {
      allowed: false,
      error: "ONE_ON_ONE_ROOM_FULL",
      message: "This 1:1 room is reserved for its matched pair.",
      bookedCount,
      maxParticipants: admissionLimit,
      isBooked: false,
    };
  }
  if (bookedCount < maxParticipants) return { allowed: true, bookedCount, maxParticipants, isBooked: false };

  const startMs = new Date(String((s as any).start_time || "")).getTime();
  if (!Number.isFinite(startMs)) return { allowed: true, bookedCount, maxParticipants, isBooked: false };

  const opensAtMs = startMs + 3 * 60 * 1000;

  if (Date.now() < opensAtMs) {
    return {
      allowed: false,
      error: "BOOKED_GRACE_WINDOW_ACTIVE",
      message: "This session is currently reserved for booked participants. Unclaimed seats open 3 minutes after the session starts.",
      bookedCount,
      maxParticipants,
      opensAt: new Date(opensAtMs).toISOString(),
      isBooked: false,
    };
  }

  return { allowed: true, bookedCount, maxParticipants, isBooked: false };
}

async function resolveAssignedServer(params: { supabaseUrl: string; serviceKey: string; sessionId: string; }): Promise<SessionServerResolution> {
  const sb = adminClient(params.supabaseUrl, params.serviceKey);
  const fallbackLivekitUrl = String(process.env.LIVEKIT_URL || "").trim();

  const { data: sessionRow, error: sessionError } = await sb
    .from("sessions")
    .select("id, assigned_server_id")
    .eq("id", params.sessionId)
    .maybeSingle();

  if (sessionError) {
    console.error("token: failed to load session for assigned server", sessionError);
    throw new Error("assigned_server_lookup_failed");
  }

  const assignedServerId = String((sessionRow as any)?.assigned_server_id || "").trim();

  if (!assignedServerId) {
    if (!fallbackLivekitUrl) throw new Error("livekit_url_missing");
    return { assignedServerId: null, livekitWsUrl: fallbackLivekitUrl };
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

  if (enabled && wsUrl) return { assignedServerId, livekitWsUrl: wsUrl };
  if (!fallbackLivekitUrl) throw new Error("livekit_url_missing");
  return { assignedServerId, livekitWsUrl: fallbackLivekitUrl };
}

async function getActiveBan(params: { supabaseUrl: string; serviceKey: string; userId: string; }) {
  const sb = adminClient(params.supabaseUrl, params.serviceKey);
  const now = new Date().toISOString();

  const { data, error } = await sb
    .from("user_bans")
    .select("id, banned_user_id, reason, internal_notes, starts_at, expires_at, revoked_at, created_at")
    .eq("banned_user_id", params.userId)
    .is("revoked_at", null)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("token: failed to check active ban", error);
    throw new Error("ban_check_failed");
  }

  const activeBans = Array.isArray(data) ? data : [];
  return (
    activeBans.find((ban) =>
      String(ban?.internal_notes || "")
        .split(/\r?\n/)
        .includes("[mysession:shadow-ban]"),
    ) || activeBans[0] || null
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Cache-Control", "no-store, max-age=0");

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const { roomName, identity, name, sessionId: bodySessionId, inviteToken } = parseBody(req);

    if (!roomName || !identity) return res.status(400).json({ error: "roomName_and_identity_required" });

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      console.error("livekit token error: missing env", { hasKey: !!apiKey, hasSecret: !!apiSecret });
      return res.status(500).json({ error: "livekit_keys_missing" });
    }

    const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ error: "supabase_service_env_missing", hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY" });
    }

    const accessToken = getBearerToken(req);
    const sessionId = String(bodySessionId || deriveSessionId(roomName)).toLowerCase();
    const identityBaseUserId = extractBaseUserIdFromIdentity(String(identity));

    let role: ResolvedRole = { isHost: false, isModerator: false, userId: "" };

    if (identityBaseUserId) {
      if (!accessToken) {
        return res.status(401).json({
          error: "auth_required",
          hint: "Authenticated LiveKit identity requires Authorization: Bearer <supabase_access_token>",
        });
      }

      if (!looksLikeUuid(sessionId)) {
        return res.status(400).json({ error: "sessionId_required", hint: "Pass sessionId or use roomName=session-<uuid>" });
      }

      const resolved = await resolveRole({ supabaseUrl, serviceKey, accessToken, sessionId });

      if (identityBaseUserId !== resolved.userId) {
        return res.status(403).json({ error: "identity_mismatch", hint: "identity base user id must equal authenticated user id" });
      }

      role = resolved;

      const activeBan = await getActiveBan({ supabaseUrl, serviceKey, userId: resolved.userId });
      if (activeBan) {
        const activeBanRecord = activeBan as {
          internal_notes?: string | null;
          reason?: string | null;
          expires_at?: string | null;
          starts_at?: string | null;
        };
        const shadowBanned = String(activeBanRecord.internal_notes || "")
          .split(/\r?\n/)
          .includes("[mysession:shadow-ban]");

        if (shadowBanned) {
          return res.status(503).json({ error: "SERVICE_UNAVAILABLE" });
        }

        return res.status(403).json({
          error: "USER_BANNED",
          reason: String(activeBanRecord.reason || "You are banned from MySession."),
          expires_at: activeBanRecord.expires_at || null,
          starts_at: activeBanRecord.starts_at || null,
          server_now: new Date().toISOString(),
        });
      }

      const admission = await resolveAdmission({
        supabaseUrl,
        serviceKey,
        sessionId,
        userId: resolved.userId,
        isHost: resolved.isHost,
        isModerator: resolved.isModerator,
        inviteToken,
      });

      if (!admission.allowed) {
        return res.status(403).json({
          error: admission.error || "ROOM_RESERVED_FOR_BOOKED_USERS",
          message: admission.message || "This room is currently reserved for booked participants.",
          bookedCount: admission.bookedCount ?? null,
          maxParticipants: admission.maxParticipants ?? null,
          opensAt: admission.opensAt ?? null,
          isBooked: admission.isBooked ?? false,
          server_now: new Date().toISOString(),
        });
      }
    }

    let assignedServerId: string | null = null;
    let livekitWsUrl = String(process.env.LIVEKIT_URL || "").trim();

    if (looksLikeUuid(sessionId)) {
      const resolvedServer = await resolveAssignedServer({ supabaseUrl, serviceKey, sessionId });
      assignedServerId = resolvedServer.assignedServerId;
      livekitWsUrl = resolvedServer.livekitWsUrl;
    }

    if (!livekitWsUrl) return res.status(500).json({ error: "livekit_url_missing", hint: "Set LIVEKIT_URL or assign a server with ws_url" });

    const at = new AccessToken(apiKey, apiSecret, { identity: String(identity), name: name ? String(name) : undefined });

    const grant: any = {
      room: String(roomName),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    };

    if (role.isHost || role.isModerator) grant.roomAdmin = true;

    at.addGrant(grant);
    const token = await at.toJwt();

    console.log("LK TOKEN GENERATED", {
      marker: "lk-token-secure-v4-admission-aware",
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

    return res.status(200).json({ token, url: livekitWsUrl, assignedServerId, isHost: role.isHost, isModerator: role.isModerator });
  } catch (e: any) {
    const msg = String(e?.message || e || "unknown_error");
    console.error("livekit token error:", e);

    if (msg === "unauthorized") return res.status(401).json({ error: "unauthorized" });
    if (msg === "session_not_found") return res.status(404).json({ error: "session_not_found" });
    if (msg === "ban_check_failed") return res.status(500).json({ error: "ban_check_failed" });
    if (msg === "admission_check_failed") return res.status(500).json({ error: "admission_check_failed" });

    return res.status(500).json({ error: "token_generation_failed", message: msg });
  }
}
