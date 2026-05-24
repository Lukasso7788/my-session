import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes, randomUUID } from "crypto";
import { RoomServiceClient } from "livekit-server-sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";

type LiveKitAdminAction =
  | "mute_track"
  | "unmute_track"
  | "remove_participant"
  | "mute_camera"
  | "unmute_camera"
  | "turn_off_camera"
  | "turn_on_camera"
  | "mute_microphone"
  | "unmute_microphone";

type EmailAdminAction =
  | "daily_schedule_preview"
  | "daily_schedule_send"
  | "daily_schedule_all_users"
  | "daily_schedule_saved_audience_get"
  | "daily_schedule_saved_audience_set"
  | "daily_schedule_send_saved_audience";

type AdminAction = LiveKitAdminAction | EmailAdminAction;

type TrackKind = "camera" | "microphone" | "";

type Body = {
  action?: AdminAction | string;
  roomName?: string;
  sessionId?: string;
  participantIdentity?: string;
  trackSid?: string;
  trackKind?: "camera" | "microphone" | "video" | "audio" | string;

  // Daily schedule email actions
  scheduleDate?: string;
  limit?: number;
  selectedUserIds?: string[];
  audienceName?: string;

  // deprecated / ignored for auth decisions
  isHost?: boolean;
  isModerator?: boolean;
};

type SessionRowLite = {
  id: string;
  host_id: string | null;
  assigned_server_id: string | null;
};

type LivekitServerRow = {
  id: string;
  ws_url: string | null;
};

type ActorRole = {
  userId: string;
  hostId: string;
  isHost: boolean;
  isModerator: boolean;
};

type SessionContext = {
  sessionId: string;
  hostId: string;
  assignedServerId: string;
  livekitHost: string;
  usedLegacyFallback: boolean;
};

type DailyScheduleSessionRow = {
  id: string;
  title?: string | null;
  start_time?: string | null;
  duration_minutes?: number | null;
  host_id?: string | null;
  host_name?: string | null;
  format?: string | null;
  session_format_type?: string | null;
  is_silent?: boolean | null;
  host_profile?: {
    id?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
};

type RecipientCandidate = {
  userId: string;
  email: string;
  name: string;
  score: number;
  reasons: string[];
  lastSentAt: string | null;
  enabled: boolean;
  unsubscribeToken: string;
};

type AdminEmailUser = {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string | null;
  emailConfirmed: boolean;
  enabled: boolean;
  lastSentAt: string | null;
  priorityOverride: number;
  unsubscribeToken: string;
};

const ACTOR_ROLE_CACHE_TTL_MS = 15_000;
const SESSION_CONTEXT_CACHE_TTL_MS = 15_000;

const DAILY_EMAIL_DEFAULT_LIMIT = 100;
const DAILY_EMAIL_MAX_FREE_LIMIT = 100;

const actorRoleCache = new Map<
  string,
  {
    expiresAt: number;
    value: ActorRole;
  }
>();

const sessionContextCache = new Map<
  string,
  {
    expiresAt: number;
    value: SessionContext;
  }
>();

const roomServiceClientCache = new Map<string, RoomServiceClient>();

function makeActorRoleCacheKey(accessToken: string, sessionId: string) {
  return `${String(sessionId || "").trim().toLowerCase()}::${String(accessToken || "").trim()}`;
}

function readActorRoleCache(accessToken: string, sessionId: string): ActorRole | null {
  const key = makeActorRoleCacheKey(accessToken, sessionId);
  const hit = actorRoleCache.get(key);
  if (!hit) return null;

  if (Date.now() >= hit.expiresAt) {
    actorRoleCache.delete(key);
    return null;
  }

  return hit.value;
}

function writeActorRoleCache(accessToken: string, sessionId: string, value: ActorRole) {
  const key = makeActorRoleCacheKey(accessToken, sessionId);
  actorRoleCache.set(key, {
    expiresAt: Date.now() + ACTOR_ROLE_CACHE_TTL_MS,
    value,
  });
}

function readSessionContextCache(sessionId: string): SessionContext | null {
  const key = String(sessionId || "").trim().toLowerCase();
  const hit = sessionContextCache.get(key);
  if (!hit) return null;

  if (Date.now() >= hit.expiresAt) {
    sessionContextCache.delete(key);
    return null;
  }

  return hit.value;
}

function writeSessionContextCache(sessionId: string, value: SessionContext) {
  const key = String(sessionId || "").trim().toLowerCase();
  sessionContextCache.set(key, {
    expiresAt: Date.now() + SESSION_CONTEXT_CACHE_TTL_MS,
    value,
  });
}

function nowMs() {
  return Date.now();
}

function elapsedMs(start: number) {
  return Math.max(0, Date.now() - start);
}

function env(name: string) {
  return String(process.env[name] || "").trim();
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

function getQueryParam(req: VercelRequest, name: string) {
  const raw = (req.query as any)?.[name];
  if (Array.isArray(raw)) return String(raw[0] || "").trim();
  return String(raw || "").trim();
}

function normalizeLiveKitHost(raw: string): string {
  let host = String(raw || "").trim();
  if (!host) return "";

  if (host.startsWith("wss://")) host = "https://" + host.slice("wss://".length);
  if (host.startsWith("ws://")) host = "http://" + host.slice("ws://".length);

  return host.replace(/\/+$/, "");
}

function getLegacyLiveKitHttpHost(): string {
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

function normalizeLiveKitAction(raw: unknown): LiveKitAdminAction | "" {
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

function normalizeEmailAction(raw: unknown): EmailAdminAction | "" {
  const a = String(raw || "").trim().toLowerCase();

  if (a === "daily_schedule_preview") return "daily_schedule_preview";
  if (a === "daily_schedule_send") return "daily_schedule_send";
  if (a === "daily_schedule_all_users") return "daily_schedule_all_users";
  if (a === "daily_schedule_saved_audience_get") return "daily_schedule_saved_audience_get";
  if (a === "daily_schedule_saved_audience_set") return "daily_schedule_saved_audience_set";
  if (a === "daily_schedule_send_saved_audience") return "daily_schedule_send_saved_audience";

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

function getSupabaseAdminClient(supabaseUrl: string, serviceKey: string) {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function assertAppAdmin(params: {
  sb: SupabaseClient;
  accessToken: string;
}) {
  const { sb, accessToken } = params;

  const { data: uData, error: uErr } = await sb.auth.getUser(accessToken);
  if (uErr || !uData?.user?.id) throw new Error("unauthorized");

  const userId = String(uData.user.id || "").trim().toLowerCase();
  if (!looksLikeUuid(userId)) throw new Error("unauthorized");

  const { data: adminRow, error: adminErr } = await sb
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (adminErr) {
    console.error("[admin] app admin check failed:", adminErr);
    throw new Error("admin_check_failed");
  }

  if (!adminRow?.user_id) throw new Error("admin_required");

  return { userId };
}

async function resolveSessionContext(params: {
  sb: SupabaseClient;
  sessionId: string;
}): Promise<SessionContext> {
  const { sb, sessionId } = params;

  const cached = readSessionContextCache(sessionId);
  if (cached) return cached;

  const { data: sessionRow, error: sessionErr } = await sb
    .from("sessions")
    .select("id, host_id, assigned_server_id")
    .eq("id", sessionId)
    .single<SessionRowLite>();

  if (sessionErr || !sessionRow?.id) {
    throw new Error("session_not_found");
  }

  const hostId = String(sessionRow.host_id || "").trim().toLowerCase();
  const assignedServerId = String(sessionRow.assigned_server_id || "").trim();

  if (!looksLikeUuid(assignedServerId)) {
    const legacyHost = getLegacyLiveKitHttpHost();
    if (!legacyHost) {
      throw new Error("legacy_livekit_host_missing");
    }

    const result: SessionContext = {
      sessionId: String(sessionRow.id || "").trim().toLowerCase(),
      hostId,
      assignedServerId: "",
      livekitHost: legacyHost,
      usedLegacyFallback: true,
    };

    writeSessionContextCache(sessionId, result);
    return result;
  }

  const { data: serverRow, error: serverErr } = await sb
    .from("livekit_servers")
    .select("id, ws_url")
    .eq("id", assignedServerId)
    .eq("enabled", true)
    .single<LivekitServerRow>();

  if (serverErr || !serverRow?.id) {
    const legacyHost = getLegacyLiveKitHttpHost();
    if (!legacyHost) {
      throw new Error("livekit_server_not_found");
    }

    const result: SessionContext = {
      sessionId: String(sessionRow.id || "").trim().toLowerCase(),
      hostId,
      assignedServerId,
      livekitHost: legacyHost,
      usedLegacyFallback: true,
    };

    writeSessionContextCache(sessionId, result);
    return result;
  }

  const livekitHost = normalizeLiveKitHost(String(serverRow.ws_url || ""));
  if (!livekitHost) {
    throw new Error("livekit_server_url_missing");
  }

  const result: SessionContext = {
    sessionId: String(sessionRow.id || "").trim().toLowerCase(),
    hostId,
    assignedServerId: String(serverRow.id || "").trim(),
    livekitHost,
    usedLegacyFallback: false,
  };

  writeSessionContextCache(sessionId, result);
  return result;
}

async function getActorRole(params: {
  sb: SupabaseClient;
  accessToken: string;
  sessionContext: SessionContext;
}): Promise<ActorRole> {
  const { sb, accessToken, sessionContext } = params;
  const { sessionId, hostId } = sessionContext;

  const cached = readActorRoleCache(accessToken, sessionId);
  if (cached) {
    return cached;
  }

  const { data: uData, error: uErr } = await sb.auth.getUser(accessToken);
  if (uErr || !uData?.user) throw new Error("unauthorized");

  const userId = String(uData.user.id || "").toLowerCase();
  if (!looksLikeUuid(userId)) throw new Error("unauthorized");

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

  const result: ActorRole = {
    userId,
    hostId,
    isHost,
    isModerator,
  };

  writeActorRoleCache(accessToken, sessionId, result);
  return result;
}

function getRoomServiceClient(livekitHost: string, apiKey: string, apiSecret: string) {
  const cacheKey = `${livekitHost}::${apiKey}`;
  const cached = roomServiceClientCache.get(cacheKey);
  if (cached) return cached;

  const svc = new RoomServiceClient(livekitHost, apiKey, apiSecret);
  roomServiceClientCache.set(cacheKey, svc);
  return svc;
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

function clampDailyEmailLimit(raw: any) {
  const n = Math.max(1, Math.min(DAILY_EMAIL_MAX_FREE_LIMIT, Math.round(Number(raw || DAILY_EMAIL_DEFAULT_LIMIT))));
  return Number.isFinite(n) ? n : DAILY_EMAIL_DEFAULT_LIMIT;
}

function getAppUrl() {
  return env("APP_URL") || env("VITE_APP_URL") || "https://www.mysession.club";
}

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseScheduleDate(raw: any) {
  const s = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return ymd(new Date());
}

function dayBounds(scheduleDate: string) {
  const start = new Date(`${scheduleDate}T00:00:00`);
  const end = new Date(`${scheduleDate}T00:00:00`);
  end.setDate(end.getDate() + 1);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function formatEmailTime(raw?: string | null) {
  if (!raw) return "Time TBD";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "Time TBD";

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

function formatDateForSubject(scheduleDate: string) {
  const d = new Date(`${scheduleDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return scheduleDate;

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

function escapeHtml(input: any) {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeUnsubscribeToken() {
  try {
    return randomUUID().replaceAll("-", "");
  } catch {
    return randomBytes(24).toString("hex");
  }
}

async function ensureUnsubscribeToken(params: {
  sb: SupabaseClient;
  userId: string;
  email: string;
  pref: any | null;
}) {
  const { sb, userId, email, pref } = params;

  const existing = String(pref?.unsubscribe_token || "").trim();
  if (existing) return existing;

  const unsubscribeToken = makeUnsubscribeToken();

  const { error } = await sb
    .from("daily_schedule_email_preferences")
    .upsert(
      {
        user_id: userId,
        email,
        enabled: pref?.enabled !== false,
        priority_override: Number(pref?.priority_override || 0),
        unsubscribe_token: unsubscribeToken,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("[daily-email] failed to upsert unsubscribe token", {
      userId,
      email,
      error,
    });
    throw new Error("unsubscribe_token_upsert_failed");
  }

  return unsubscribeToken;
}

function getEmailSessionHostName(session: DailyScheduleSessionRow) {
  return (
    String(session.host_profile?.full_name || "").trim() ||
    String(session.host_name || "").trim() ||
    "Host"
  );
}

function groupEmailSessionsByHost(sessions: DailyScheduleSessionRow[]) {
  const map = new Map<string, DailyScheduleSessionRow[]>();

  for (const session of sessions) {
    const host = getEmailSessionHostName(session);
    const prev = map.get(host) || [];
    prev.push(session);
    map.set(host, prev);
  }

  return Array.from(map.entries()).map(([hostName, items]) => ({
    hostName,
    sessions: items.sort((a, b) => {
      const at = a.start_time ? new Date(a.start_time).getTime() : 0;
      const bt = b.start_time ? new Date(b.start_time).getTime() : 0;
      return at - bt;
    }),
  }));
}

function buildDailyScheduleEmail(params: {
  scheduleDate: string;
  sessions: DailyScheduleSessionRow[];
  recipientName: string;
  unsubscribeToken: string;
}) {
  const appUrl = getAppUrl();
  const unsubscribeUrl = `${appUrl}/email/unsubscribe?token=${encodeURIComponent(params.unsubscribeToken)}`;
  const dateLabel = formatDateForSubject(params.scheduleDate);
  const groups = groupEmailSessionsByHost(params.sessions);

  const subject = `Today on MySession — ${dateLabel}`;

  const sessionListText =
    groups.length === 0
      ? "No scheduled sessions today yet. Check the sessions page for updates."
      : groups
        .map((group) => {
          const lines = group.sessions.map((s) => {
            const title = String(s.title || "Focus session").trim();
            return `- ${formatEmailTime(s.start_time)} — ${title}`;
          });

          return `${group.hostName} is hosting:\n${lines.join("\n")}`;
        })
        .join("\n\n");

  const text = `Hey ${params.recipientName || "there"},

Here is today's MySession schedule:

${sessionListText}

Join or book here:
${appUrl}/sessions

Tip: click "Book Session" — it helps increase attendance and attract more people to the session.

Unsubscribe from daily schedule emails:
${unsubscribeUrl}

— MySession`;

  const htmlGroups =
    groups.length === 0
      ? `<p style="margin:0;color:#555;">No scheduled sessions today yet. Check the sessions page for updates.</p>`
      : groups
        .map((group) => {
          const items = group.sessions
            .map((s) => {
              const title = escapeHtml(s.title || "Focus session");
              const time = escapeHtml(formatEmailTime(s.start_time));
              const link = `${appUrl}/room-livekit/${encodeURIComponent(String(s.id))}`;

              return `
                  <li style="margin:8px 0;">
                    <strong>${time}</strong>
                    <span style="color:#555;"> — </span>
                    <a href="${link}" style="color:#111827;text-decoration:underline;">${title}</a>
                  </li>
                `;
            })
            .join("");

          return `
              <div style="margin:22px 0;padding:18px;border:1px solid #e5e7eb;border-radius:18px;background:#fafafa;">
                <div style="font-weight:700;font-size:16px;margin-bottom:8px;">${escapeHtml(group.hostName)} is hosting:</div>
                <ul style="padding-left:20px;margin:0;">${items}</ul>
              </div>
            `;
        })
        .join("");

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.55;color:#111827;max-width:640px;margin:0 auto;padding:24px;">
      <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.12em;color:#6b7280;font-weight:700;">MySession</div>
      <h1 style="font-size:28px;line-height:1.15;margin:10px 0 8px;">Today’s focus sessions</h1>
      <p style="margin:0 0 22px;color:#555;">Hey ${escapeHtml(params.recipientName || "there")}, here’s today’s schedule for ${escapeHtml(dateLabel)}.</p>

      ${htmlGroups}

      <div style="margin-top:26px;">
        <a href="${appUrl}/sessions" style="display:inline-block;background:#111827;color:white;text-decoration:none;border-radius:999px;padding:13px 20px;font-weight:700;">Join or book a session</a>
      </div>

      <p style="margin-top:22px;color:#555;font-size:14px;">
        Tip: click <strong>Book Session</strong> — it helps increase attendance and attract more people to the session.
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:26px 0;" />
      <p style="font-size:12px;color:#777;margin:0;">
        You’re receiving this because you joined MySession.
        <br />
        <a href="${unsubscribeUrl}" style="color:#777;text-decoration:underline;">Unsubscribe from daily schedule emails</a>
      </p>
    </div>
  `;

  return { subject, text, html };
}

async function listAllAuthUsers(sb: SupabaseClient) {
  const all: any[] = [];
  let page = 1;
  const perPage = 1000;

  while (page < 20) {
    const { data, error } = await (sb.auth.admin as any).listUsers({
      page,
      perPage,
    });

    if (error) throw error;

    const users = data?.users || [];
    all.push(...users);

    if (users.length < perPage) break;
    page += 1;
  }

  return all;
}

function scoreDailyEmailCandidate(params: {
  user: any;
  pref: any | null;
  profile: any | null;
  bookedToday: boolean;
  sentToday: boolean;
}) {
  let score = 0;
  const reasons: string[] = [];

  if (params.pref?.enabled === false) {
    return { score: -999999, reasons: ["disabled"] };
  }

  if (params.sentToday) {
    return { score: -99999, reasons: ["already_sent_today"] };
  }

  const override = Number(params.pref?.priority_override || 0);
  if (override) {
    score += override;
    reasons.push(`priority_override:${override}`);
  }

  if (params.bookedToday) {
    score += 1000;
    reasons.push("booked_today");
  }

  if (params.user?.email_confirmed_at || params.user?.confirmed_at) {
    score += 80;
    reasons.push("confirmed_email");
  }

  if (params.profile?.full_name) {
    score += 20;
    reasons.push("has_profile_name");
  }

  const lastSentAt = params.pref?.last_sent_at ? new Date(params.pref.last_sent_at).getTime() : 0;
  if (!lastSentAt) {
    score += 120;
    reasons.push("never_sent");
  } else {
    const daysSince = Math.max(0, Math.floor((Date.now() - lastSentAt) / 86400000));
    score += Math.min(90, daysSince * 10);
    reasons.push(`days_since_sent:${daysSince}`);
  }

  const createdAt = params.user?.created_at ? new Date(params.user.created_at).getTime() : 0;
  if (createdAt && Date.now() - createdAt < 30 * 86400000) {
    score += 30;
    reasons.push("newer_user");
  }

  return { score, reasons };
}



function normalizeAudienceName(raw: any) {
  const s = String(raw || "").trim();
  return s || "default";
}

async function handleDailyScheduleSavedAudienceAction(params: {
  res: VercelResponse;
  sb: SupabaseClient;
  accessToken: string;
  body: Body;
  action: EmailAdminAction;
}) {
  const { res, sb, accessToken, body, action } = params;

  const admin = await assertAppAdmin({ sb, accessToken });
  const audienceName = normalizeAudienceName(body.audienceName);

  if (action === "daily_schedule_saved_audience_get") {
    const { data, error } = await sb
      .from("daily_schedule_email_audience_members")
      .select("audience_name,user_id,email,enabled,created_by,created_at,updated_at")
      .eq("audience_name", audienceName)
      .eq("enabled", true)
      .order("created_at", { ascending: true });

    if (error) {
      return res.status(500).json({
        error: "saved_audience_load_failed",
        details: error,
      });
    }

    const rows = Array.isArray(data) ? data : [];
    const userIds = rows.map((r: any) => String(r.user_id || "")).filter(Boolean);

    const { data: profilesData } = userIds.length
      ? await sb
          .from("profiles")
          .select("id,full_name,avatar_url")
          .in("id", userIds)
      : { data: [] as any[] };

    const profilesByUser = new Map<string, any>();
    for (const p of profilesData || []) {
      profilesByUser.set(String(p.id), p);
    }

    const members = rows.map((row: any) => {
      const userId = String(row.user_id || "");
      const profile = profilesByUser.get(userId) || null;

      return {
        userId,
        email: String(row.email || ""),
        name: String(profile?.full_name || row.email || "User"),
        avatarUrl: String(profile?.avatar_url || "").trim() || null,
        enabled: row.enabled !== false,
        createdAt: row.created_at || null,
      };
    });

    return res.status(200).json({
      ok: true,
      audienceName,
      members,
      selectedUserIds: members.map((m: any) => m.userId).filter(Boolean),
      count: members.length,
    });
  }

  if (action === "daily_schedule_saved_audience_set") {
    const selectedUserIds = Array.isArray(body.selectedUserIds)
      ? Array.from(
          new Set(
            body.selectedUserIds
              .map((x) => String(x || "").trim())
              .filter(Boolean)
          )
        )
      : [];

    if (selectedUserIds.length > DAILY_EMAIL_MAX_FREE_LIMIT) {
      return res.status(400).json({
        error: "saved_audience_too_large",
        limit: DAILY_EMAIL_MAX_FREE_LIMIT,
        count: selectedUserIds.length,
      });
    }

    const { data: usersData, error: usersErr } = selectedUserIds.length
      ? await (sb.auth.admin as any).listUsers({
          page: 1,
          perPage: 1000,
        })
      : { data: { users: [] }, error: null };

    if (usersErr) {
      return res.status(500).json({
        error: "auth_users_load_failed",
        details: usersErr,
      });
    }

    const authUsers = new Map<string, any>();
    for (const u of usersData?.users || []) {
      authUsers.set(String(u.id), u);
    }

    const rows = selectedUserIds
      .map((userId) => {
        const u = authUsers.get(userId);
        const email = String(u?.email || "").trim().toLowerCase();
        if (!email) return null;

        return {
          audience_name: audienceName,
          user_id: userId,
          email,
          enabled: true,
          created_by: admin.userId,
          updated_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);

    const { error: disableErr } = await sb
      .from("daily_schedule_email_audience_members")
      .update({
        enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq("audience_name", audienceName);

    if (disableErr) {
      return res.status(500).json({
        error: "saved_audience_clear_failed",
        details: disableErr,
      });
    }

    if (rows.length > 0) {
      const { error: upsertErr } = await sb
        .from("daily_schedule_email_audience_members")
        .upsert(rows as any[], {
          onConflict: "audience_name,user_id",
        });

      if (upsertErr) {
        return res.status(500).json({
          error: "saved_audience_save_failed",
          details: upsertErr,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      audienceName,
      savedCount: rows.length,
      selectedUserIds,
    });
  }

  return res.status(400).json({ error: "unsupported_saved_audience_action" });
}

async function handleDailyScheduleAllUsersAction(params: {
  res: VercelResponse;
  sb: SupabaseClient;
  accessToken: string;
}) {
  const { res, sb, accessToken } = params;

  await assertAppAdmin({ sb, accessToken });

  const users = await listAllAuthUsers(sb);
  const userIds = users.map((u) => String(u.id)).filter(Boolean);

  const { data: profilesData } = userIds.length
    ? await sb
      .from("profiles")
      .select("id, full_name, avatar_url, email, created_at")
      .in("id", userIds)
    : { data: [] as any[] };

  const profilesByUser = new Map<string, any>();
  for (const p of profilesData || []) profilesByUser.set(String(p.id), p);

  const { data: prefsData } = await sb
    .from("daily_schedule_email_preferences")
    .select("*");

  const prefsByUser = new Map<string, any>();
  for (const p of prefsData || []) prefsByUser.set(String(p.user_id), p);

  const rows: AdminEmailUser[] = [];

  for (const user of users) {
    const userId = String(user.id || "").trim();
    const email = String(user.email || "").trim().toLowerCase();
    if (!userId || !email) continue;

    const profile = profilesByUser.get(userId) || null;
    const pref = prefsByUser.get(userId) || null;

    const unsubscribeToken = await ensureUnsubscribeToken({
      sb,
      userId,
      email,
      pref,
    });

    rows.push({
      userId,
      email,
      name: String(profile?.full_name || user.user_metadata?.full_name || email.split("@")[0] || "User"),
      avatarUrl: String(profile?.avatar_url || user.user_metadata?.avatar_url || "").trim() || null,
      createdAt: String(user.created_at || profile?.created_at || "").trim() || null,
      emailConfirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
      enabled: pref?.enabled !== false,
      lastSentAt: pref?.last_sent_at || null,
      priorityOverride: Number(pref?.priority_override || 0),
      unsubscribeToken,
    });
  }

  rows.sort((a, b) => {
    const an = String(a.name || a.email).toLowerCase();
    const bn = String(b.name || b.email).toLowerCase();
    return an.localeCompare(bn);
  });

  return res.status(200).json({
    ok: true,
    users: rows,
    count: rows.length,
  });
}

async function handleDailyScheduleEmailAction(params: {
  req: VercelRequest;
  res: VercelResponse;
  sb: SupabaseClient;
  accessToken: string;
  body: Body;
  action: EmailAdminAction;
  skipAdminCheck?: boolean;
}) {
  const { res, sb, accessToken, body, action, skipAdminCheck } = params;

  if (!skipAdminCheck) {
    await assertAppAdmin({ sb, accessToken });
  }

  const dryRun = action === "daily_schedule_preview";
  const scheduleDate = parseScheduleDate(body.scheduleDate);
  const limit = clampDailyEmailLimit(body.limit);
  const selectedUserIds = Array.isArray(body.selectedUserIds)
    ? body.selectedUserIds.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  const { startIso, endIso } = dayBounds(scheduleDate);

  const { data: sessionsData, error: sessionsError } = await sb
    .from("sessions")
    .select(`
      id,
      title,
      start_time,
      duration_minutes,
      host_id,
      host_name,
      format,
      session_format_type,
      is_silent,
      host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url)
    `)
    .gte("start_time", startIso)
    .lt("start_time", endIso)
    .order("start_time", { ascending: true });

  if (sessionsError) {
    return res.status(500).json({ error: "sessions_load_failed", details: sessionsError });
  }

  const sessions = (sessionsData || []) as DailyScheduleSessionRow[];
  const sessionIds = sessions.map((s) => String(s.id)).filter(Boolean);

  const { data: bookingsData } = sessionIds.length
    ? await sb
      .from("session_bookings")
      .select("session_id, user_id")
      .in("session_id", sessionIds)
    : { data: [] as any[] };

  const bookedTodaySet = new Set<string>((bookingsData || []).map((b: any) => String(b.user_id)));

  const { data: prefsData } = await sb
    .from("daily_schedule_email_preferences")
    .select("*");

  const prefsByUser = new Map<string, any>();
  for (const p of prefsData || []) prefsByUser.set(String(p.user_id), p);

  const { data: sendsToday } = await sb
    .from("daily_schedule_email_sends")
    .select("user_id,email,status")
    .eq("schedule_date", scheduleDate)
    .eq("status", "sent");

  const sentTodayUserIds = new Set<string>((sendsToday || []).map((s: any) => String(s.user_id || "")));
  const sentTodayEmails = new Set<string>((sendsToday || []).map((s: any) => String(s.email || "").toLowerCase()));

  const users = await listAllAuthUsers(sb);
  const userIds = users.map((u) => String(u.id)).filter(Boolean);

  const { data: profilesData } = userIds.length
    ? await sb
      .from("profiles")
      .select("id, full_name, avatar_url, email, created_at")
      .in("id", userIds)
    : { data: [] as any[] };

  const profilesByUser = new Map<string, any>();
  for (const p of profilesData || []) profilesByUser.set(String(p.id), p);

  const candidates: RecipientCandidate[] = [];

  for (const user of users) {
    const userId = String(user.id || "").trim();
    const email = String(user.email || "").trim().toLowerCase();
    if (!userId || !email) continue;

    if (selectedUserIds.length && !selectedUserIds.includes(userId)) continue;

    const profile = profilesByUser.get(userId) || null;
    const pref = prefsByUser.get(userId) || null;
    const sentToday = sentTodayUserIds.has(userId) || sentTodayEmails.has(email);

    const scored = scoreDailyEmailCandidate({
      user,
      pref,
      profile,
      bookedToday: bookedTodaySet.has(userId),
      sentToday,
    });

    if (scored.score < -1000) continue;

    const unsubscribeToken = await ensureUnsubscribeToken({
      sb,
      userId,
      email,
      pref,
    });

    candidates.push({
      userId,
      email,
      name: String(profile?.full_name || user.user_metadata?.full_name || email.split("@")[0] || "there"),
      score: scored.score,
      reasons: scored.reasons,
      lastSentAt: pref?.last_sent_at || null,
      enabled: pref?.enabled !== false,
      unsubscribeToken,
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.email.localeCompare(b.email);
  });

  const selected = candidates.slice(0, limit);

  if (dryRun) {
    return res.status(200).json({
      ok: true,
      dryRun: true,
      scheduleDate,
      limit,
      sessions,
      candidatesCount: candidates.length,
      selectedCount: selected.length,
      selected,
    });
  }

  const resendKey = env("RESEND_API_KEY");
  const fromEmail = env("RESEND_DAILY_SCHEDULE_FROM") || env("RESEND_FROM_EMAIL");
  const replyTo = env("RESEND_REPLY_TO") || "support@mysession.club";

  if (!resendKey || !fromEmail) {
    return res.status(500).json({
      error: "missing_resend_env",
      required: ["RESEND_API_KEY", "RESEND_DAILY_SCHEDULE_FROM or RESEND_FROM_EMAIL"],
    });
  }

  const resend = new Resend(resendKey);
  const results: any[] = [];

  for (let i = 0; i < selected.length; i += 1) {
    const recipient = selected[i];
    const email = buildDailyScheduleEmail({
      scheduleDate,
      sessions,
      recipientName: recipient.name,
      unsubscribeToken: recipient.unsubscribeToken,
    });

    try {
      const { data, error } = await resend.emails.send({
        from: fromEmail,
        to: [recipient.email],
        replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: [
          { name: "type", value: "daily_schedule" },
          { name: "schedule_date", value: scheduleDate.replaceAll("-", "_") },
        ],
      });

      if (error) throw error;

      await sb.from("daily_schedule_email_sends").insert({
        user_id: recipient.userId,
        email: recipient.email,
        schedule_date: scheduleDate,
        status: "sent",
        selected_rank: i + 1,
        resend_id: (data as any)?.id || null,
      });

      await sb
        .from("daily_schedule_email_preferences")
        .upsert({
          user_id: recipient.userId,
          email: recipient.email,
          enabled: true,
          unsubscribe_token: recipient.unsubscribeToken,
          last_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      results.push({
        userId: recipient.userId,
        email: recipient.email,
        status: "sent",
        resendId: (data as any)?.id || null,
      });
    } catch (e: any) {
      const message = String(e?.message || JSON.stringify(e) || e || "send_failed");

      await sb.from("daily_schedule_email_sends").insert({
        user_id: recipient.userId,
        email: recipient.email,
        schedule_date: scheduleDate,
        status: "failed",
        selected_rank: i + 1,
        error: message,
      });

      results.push({
        userId: recipient.userId,
        email: recipient.email,
        status: "failed",
        error: message,
      });
    }
  }

  return res.status(200).json({
    ok: true,
    dryRun: false,
    scheduleDate,
    requestedLimit: limit,
    selectedCount: selected.length,
    sentCount: results.filter((r) => r.status === "sent").length,
    failedCount: results.filter((r) => r.status === "failed").length,
    results,
  });
}

async function handleDailyScheduleSavedAudienceCronAction(params: {
  req: VercelRequest;
  res: VercelResponse;
  sb: SupabaseClient;
}) {
  const { req, res, sb } = params;

  const expectedSecret = env("DAILY_SCHEDULE_CRON_SECRET");
  const suppliedSecret = String(
    req.headers["x-cron-secret"] ||
    req.headers["x-mysession-cron-secret"] ||
    getQueryParam(req, "secret") ||
    ""
  ).trim();

  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return res.status(401).json({ error: "cron_unauthorized" });
  }

  const audienceName = normalizeAudienceName(getQueryParam(req, "audienceName") || "default");
  const scheduleDate = parseScheduleDate(getQueryParam(req, "scheduleDate"));
  const limit = clampDailyEmailLimit(getQueryParam(req, "limit") || DAILY_EMAIL_DEFAULT_LIMIT);

  const { data: members, error: membersError } = await sb
    .from("daily_schedule_email_audience_members")
    .select("user_id,email,enabled,created_at")
    .eq("audience_name", audienceName)
    .eq("enabled", true)
    .order("created_at", { ascending: true });

  if (membersError) {
    return res.status(500).json({
      error: "saved_audience_cron_load_failed",
      details: membersError,
    });
  }

  const selectedUserIds = (members || [])
    .map((m: any) => String(m.user_id || "").trim())
    .filter(Boolean)
    .slice(0, limit);

  if (!selectedUserIds.length) {
    return res.status(200).json({
      ok: true,
      dryRun: false,
      scheduleDate,
      audienceName,
      requestedLimit: limit,
      selectedCount: 0,
      sentCount: 0,
      failedCount: 0,
      message: "No enabled saved audience members found.",
    });
  }

  return await handleDailyScheduleEmailAction({
    req,
    res,
    sb,
    accessToken: "",
    body: {
      action: "daily_schedule_send",
      scheduleDate,
      limit,
      selectedUserIds,
    },
    action: "daily_schedule_send",
    skipAdminCheck: true,
  });
}

function setCors(res: VercelResponse, req: VercelRequest) {
  const origin = String(req.headers.origin || "*");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Cron-Secret, X-MySession-Cron-Secret"
  );
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

    const body = req.method === "POST" ? parseBody(req) : {};
    const cronAction =
      req.method === "GET"
        ? normalizeEmailAction(getQueryParam(req, "cronAction"))
        : "";

    const isDailyEmailCron =
      req.method === "GET" && cronAction === "daily_schedule_send_saved_audience";

    if (req.method !== "POST" && !isDailyEmailCron) {
      res.setHeader("Allow", "GET, POST, OPTIONS");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const rawEmailAction = cronAction || normalizeEmailAction(body.action);

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

    const sb = getSupabaseAdminClient(supabaseUrl, serviceKey);

    if (isDailyEmailCron) {
      return await handleDailyScheduleSavedAudienceCronAction({
        req,
        res,
        sb,
      });
    }

    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return res.status(401).json({
        error: "auth_required",
        hint: "Send Authorization: Bearer <supabase_access_token>",
      });
    }

    if (
      rawEmailAction === "daily_schedule_saved_audience_get" ||
      rawEmailAction === "daily_schedule_saved_audience_set"
    ) {
      return await handleDailyScheduleSavedAudienceAction({
        res,
        sb,
        accessToken,
        body,
        action: rawEmailAction,
      });
    }

    if (rawEmailAction === "daily_schedule_all_users") {
      return await handleDailyScheduleAllUsersAction({
        res,
        sb,
        accessToken,
      });
    }

    if (rawEmailAction) {
      return await handleDailyScheduleEmailAction({
        req,
        res,
        sb,
        accessToken,
        body,
        action: rawEmailAction,
      });
    }

    const action = normalizeLiveKitAction(body.action);
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

    const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
    const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();

    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: "livekit_keys_missing" });
    }

    const authStartedAt = nowMs();
    const sessionContext = await resolveSessionContext({
      sb,
      sessionId,
    });

    const actor = await getActorRole({
      sb,
      accessToken,
      sessionContext,
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

    const livekitHost = sessionContext.livekitHost;
    const svc = getRoomServiceClient(livekitHost, apiKey, apiSecret);

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
        routing: {
          sessionId,
          assignedServerId: sessionContext.assignedServerId,
          livekitHost,
          usedLegacyFallback: sessionContext.usedLegacyFallback,
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
      routing: {
        sessionId,
        assignedServerId: sessionContext.assignedServerId,
        livekitHost,
        usedLegacyFallback: sessionContext.usedLegacyFallback,
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
    console.error("[admin] request failed", {
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

    if (message === "admin_required") {
      return res.status(403).json({
        error: "admin_required",
        timings: { authMs, resolvedTrackMs, livekitMs, totalMs },
      });
    }

    if (message === "admin_check_failed") {
      return res.status(500).json({
        error: "admin_check_failed",
        timings: { authMs, resolvedTrackMs, livekitMs, totalMs },
      });
    }

    if (message === "unsubscribe_token_upsert_failed") {
      return res.status(500).json({
        error: "unsubscribe_token_upsert_failed",
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

    if (
      message === "livekit_server_not_found" ||
      message === "livekit_server_url_missing" ||
      message === "legacy_livekit_host_missing"
    ) {
      return res.status(500).json({
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
