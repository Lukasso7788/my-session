import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RoomServiceClient } from "livekit-server-sdk";
import { createClient } from "@supabase/supabase-js";

type AdminAction =
  | "mute_track"
  | "unmute_track"
  | "remove_participant"
  | "mute_camera"
  | "unmute_camera"
  | "turn_off_camera"
  | "turn_on_camera"
  | "mute_microphone"
  | "unmute_microphone";

type TrackKind = "camera" | "microphone" | "";

type Body = {
  action?: AdminAction | string;
  roomName?: string;
  sessionId?: string;
  participantIdentity?: string;
  trackSid?: string;
  trackKind?: "camera" | "microphone" | "video" | "audio" | string;

  // deprecated / ignored for auth decisions
  isHost?: boolean;
  isModerator?: boolean;
};

type ActorRole = {
  userId: string;
  hostId: string;
  isHost: boolean;
  isModerator: boolean;
};

function nowMs() {
  return Date.now();
}

function elapsedMs(start: number) {
  return Math.max(0, Date.now() - start);
}

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
  let host = String(raw || "").trim();
  if (!host) return "";

  if (host.startsWith("wss://")) host = "https://" + host.slice("wss://".length);
  if (host.startsWith("ws://")) host = "http://" + host.slice("ws://".length);

  return host.replace(/\/+$/, "");
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

function looksLikeUuid(v: string): boolean {
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

function normalizeAction(raw: unknown): AdminAction | "" {
  const a = String(raw || "").trim().toLowerCase();

  if (a === "mute_track") return "mute_track";
  if (a === "unmute_track") return "unmute_track";
  if (a === "remove_participant") return "remove_participant";

  if (a === "mute_camera" || a === "turn_off_camera") return "turn_off_camera";
  if (a === "unmute_camera" || a === "turn_on_camera") return "turn_on_camera";

  if (a === "mute_microphone") return "mute_microphone";
  if (a === "unmute_microphone") return "unmute_microphone";

  return "";
}

function normalizeTrackKind(raw: unknown): TrackKind {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "camera" || s === "video") return "camera";
  if (s === "microphone" || s === "audio" || s === "mic") return "microphone";
  return "";
}

function sourceToKind(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();

  if (s === "1" || s.includes("camera")) return "camera";
  if (s === "2" || s.includes("microphone")) return "microphone";
  if (s === "3" || s.includes("screen_share")) return "screen_share";
  if (s === "4" || s.includes("screen_share_audio")) return "screen_share_audio";

  return s;
}

function typeToKind(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.includes("audio")) return "audio";
  if (s.includes("video")) return "video";
  return s;
}

function isTrackMatchKind(track: any, wanted: "camera" | "microphone") {
  const sourceKind = sourceToKind(track?.source);
  const typeKind = typeToKind(track?.type);
  const name = String(track?.name || "").toLowerCase();
  const mimeType = String(track?.mimeType || "").toLowerCase();
  const width = Number(track?.width || 0);
  const height = Number(track?.height || 0);

  if (wanted === "camera") {
    if (sourceKind === "camera") return true;
    if (typeKind === "video" && (width > 0 || height > 0)) return true;
    if (mimeType.startsWith("video/")) return true;
    if (name.includes("camera") || name.includes("cam") || name.includes("video")) return true;
    return false;
  }

  if (wanted === "microphone") {
    if (sourceKind === "microphone") return true;
    if (typeKind === "audio") return true;
    if (mimeType.startsWith("audio/")) return true;
    if (name.includes("microphone") || name.includes("mic")) return true;
    return false;
  }

  return false;
}

async function resolveTrackSidForKind(args: {
  svc: RoomServiceClient;
  roomName: string;
  participantIdentity: string;
  wantedKind: "camera" | "microphone";
}): Promise<string> {
  const participants = await args.svc.listParticipants(args.roomName);
  const participant = (participants || []).find(
    (p: any) => String(p?.identity || "").trim() === args.participantIdentity
  );

  if (!participant) {
    throw new Error("participant_not_found");
  }

  const tracks = Array.isArray((participant as any)?.tracks) ? (participant as any).tracks : [];
  const exact = tracks.find((t: any) => isTrackMatchKind(t, args.wantedKind));

  const sid = String(exact?.sid || "").trim();
  if (!sid) {
    throw new Error(`${args.wantedKind}_track_not_found`);
  }

  return sid;
}

async function getActorRole(params: {
  supabaseUrl: string;
  serviceKey: string;
  accessToken: string;
  sessionId: string;
}): Promise<ActorRole> {
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

  return { userId, hostId, isHost, isModerator };
}

function setCors(res: VercelResponse, req: VercelRequest) {
  const origin = String(req.headers.origin || "*");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function writeTimingHeaders(
  res: VercelResponse,
  timings: {
    totalMs?: number;
    authMs?: number;
    livekitMs?: number;
    resolvedTrackMs?: number;
  }
) {
  if (typeof timings.totalMs === "number") {
    res.setHeader("X-Admin-Total-Ms", String(timings.totalMs));
  }
  if (typeof timings.authMs === "number") {
    res.setHeader("X-Admin-Auth-Ms", String(timings.authMs));
  }
  if (typeof timings.livekitMs === "number") {
    res.setHeader("X-Admin-LiveKit-Ms", String(timings.livekitMs));
  }
  if (typeof timings.resolvedTrackMs === "number") {
    res.setHeader("X-Admin-Resolve-Track-Ms", String(timings.resolvedTrackMs));
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const totalStartedAt = nowMs();
  let authMs = 0;
  let livekitMs = 0;
  let resolvedTrackMs = 0;

  try {
    setCors(res, req);

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const body = parseBody(req);
    const action = normalizeAction(body.action);
    const roomName = String(body.roomName || "").trim();
    const participantIdentity = String(body.participantIdentity || "").trim();
    let trackSid = String(body.trackSid || "").trim();

    if (!action || !roomName) {
      return res.status(400).json({ error: "action_and_roomName_required" });
    }

    const sessionId = String(body.sessionId || deriveSessionId(roomName))
      .trim()
      .toLowerCase();

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

    const authStartedAt = nowMs();
    const actor = await getActorRole({
      supabaseUrl,
      serviceKey,
      accessToken,
      sessionId,
    });
    authMs = elapsedMs(authStartedAt);

    if (!actor.isHost && !actor.isModerator) {
      writeTimingHeaders(res, {
        totalMs: elapsedMs(totalStartedAt),
        authMs,
      });
      return res.status(403).json({
        error: "forbidden",
        reason: "host_or_moderator_required",
      });
    }

    const targetId = participantIdentity.toLowerCase();
    if (!actor.isHost && looksLikeUuid(targetId) && actor.hostId && targetId === actor.hostId) {
      writeTimingHeaders(res, {
        totalMs: elapsedMs(totalStartedAt),
        authMs,
      });
      return res.status(403).json({
        error: "forbidden",
        reason: "moderator_cannot_target_host",
      });
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

      const livekitStartedAt = nowMs();
      await svc.removeParticipant(roomName, participantIdentity);
      livekitMs = elapsedMs(livekitStartedAt);

      const totalMs = elapsedMs(totalStartedAt);
      writeTimingHeaders(res, { totalMs, authMs, livekitMs });

      return res.status(200).json({
        ok: true,
        action,
        roomName,
        participantIdentity,
        actor: {
          userId: actor.userId,
          isHost: actor.isHost,
          isModerator: actor.isModerator,
        },
        timings: {
          authMs,
          livekitMs,
          totalMs,
        },
      });
    }

    const explicitTrackKind = normalizeTrackKind(body.trackKind);

    let wantedKind: TrackKind = explicitTrackKind;
    let muted: boolean | null = null;

    if (action === "mute_track") muted = true;
    if (action === "unmute_track") muted = false;

    if (action === "turn_off_camera" || action === "mute_camera") {
      wantedKind = "camera";
      muted = true;
    }

    if (action === "turn_on_camera" || action === "unmute_camera") {
      wantedKind = "camera";
      muted = false;
    }

    if (action === "mute_microphone") {
      wantedKind = "microphone";
      muted = true;
    }

    if (action === "unmute_microphone") {
      wantedKind = "microphone";
      muted = false;
    }

    if (!participantIdentity) {
      return res.status(400).json({ error: "participantIdentity_required" });
    }

    if (muted === null) {
      return res.status(400).json({ error: "unsupported_action" });
    }

    let trackWasResolvedServerSide = false;

    if (!trackSid && wantedKind) {
      const resolveStartedAt = nowMs();
      trackSid = await resolveTrackSidForKind({
        svc,
        roomName,
        participantIdentity,
        wantedKind,
      });
      resolvedTrackMs = elapsedMs(resolveStartedAt);
      trackWasResolvedServerSide = true;
    }

    if (!trackSid) {
      return res.status(400).json({
        error: "trackSid_required",
        hint: "Pass trackSid, or use a camera/microphone action so the server can resolve it",
      });
    }

    const livekitStartedAt = nowMs();
    await svc.mutePublishedTrack(roomName, participantIdentity, trackSid, muted);
    livekitMs = elapsedMs(livekitStartedAt);

    const totalMs = elapsedMs(totalStartedAt);
    writeTimingHeaders(res, {
      totalMs,
      authMs,
      livekitMs,
      resolvedTrackMs: trackWasResolvedServerSide ? resolvedTrackMs : 0,
    });

    return res.status(200).json({
      ok: true,
      action,
      roomName,
      participantIdentity,
      trackSid,
      trackKind: wantedKind || null,
      muted,
      actor: {
        userId: actor.userId,
        isHost: actor.isHost,
        isModerator: actor.isModerator,
      },
      meta: {
        trackWasResolvedServerSide,
      },
      timings: {
        authMs,
        resolvedTrackMs: trackWasResolvedServerSide ? resolvedTrackMs : 0,
        livekitMs,
        totalMs,
      },
    });
  } catch (e: any) {
    const totalMs = elapsedMs(totalStartedAt);
    writeTimingHeaders(res, { totalMs, authMs, livekitMs, resolvedTrackMs });

    const message = String(e?.message || e || "admin_request_failed");
    console.error("[livekit-admin] request failed", {
      message,
      authMs,
      resolvedTrackMs,
      livekitMs,
      totalMs,
    });

    if (message === "unauthorized") {
      return res.status(401).json({
        error: "unauthorized",
        timings: { authMs, resolvedTrackMs, livekitMs, totalMs },
      });
    }

    if (message === "session_not_found") {
      return res.status(404).json({
        error: "session_not_found",
        timings: { authMs, resolvedTrackMs, livekitMs, totalMs },
      });
    }

    if (
      message === "participant_not_found" ||
      message === "camera_track_not_found" ||
      message === "microphone_track_not_found"
    ) {
      return res.status(404).json({
        error: message,
        timings: { authMs, resolvedTrackMs, livekitMs, totalMs },
      });
    }

    return res.status(500).json({
      error: "admin_request_failed",
      details: message,
      timings: { authMs, resolvedTrackMs, livekitMs, totalMs },
    });
  }
}