export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DISCORD_WEBHOOK_URL: string;
  APP_URL?: string;
  DISCORD_WORKER_SECRET?: string;
}

type SessionRow = {
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

type ActiveInfiniteRoom = {
  session_id: string;
  title?: string | null;
  participant_count?: number | string | null;
  is_private?: boolean | null;
};

const KYIV_TIME_ZONE = "Europe/Kyiv";
const DUE_GRACE_MINUTES = 8;
const PRESENCE_MIN_PARTICIPANTS = 2;
const PRESENCE_ACTIVE_WINDOW_SECONDS = 90;
const PRESENCE_COOLDOWN_MINUTES = 30;

function appUrl(env: Env) {
  return String(env.APP_URL || "https://www.mysession.club").replace(/\/+$/, "");
}

function iso(date: Date) {
  return date.toISOString();
}

function ymdInKyiv(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value || "1970";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const d = parts.find((p) => p.type === "day")?.value || "01";
  return `${y}-${m}-${d}`;
}

function hmInKyiv(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: KYIV_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const h = parts.find((p) => p.type === "hour")?.value || "00";
  const m = parts.find((p) => p.type === "minute")?.value || "00";
  return `${h}:${m}`;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function addHours(date: Date, hours: number) {
  return addMinutes(date, hours * 60);
}

function isDue(now: Date, dueAt: Date) {
  const diffMs = now.getTime() - dueAt.getTime();
  return diffMs >= 0 && diffMs <= DUE_GRACE_MINUTES * 60_000;
}

function formatDiscordTime(raw?: string | null) {
  if (!raw) return "Time TBD";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "Time TBD";

  const kyiv = new Intl.DateTimeFormat("en-GB", {
    timeZone: KYIV_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);

  const unix = Math.floor(d.getTime() / 1000);
  return `${kyiv} Kyiv · <t:${unix}:t> local`;
}

function getHostName(session: SessionRow) {
  return (
    String(session.host_profile?.full_name || "").trim() ||
    String(session.host_name || "").trim() ||
    "Host"
  );
}

function sessionUrl(env: Env, session: SessionRow) {
  return `${appUrl(env)}/room-livekit/${encodeURIComponent(String(session.id))}`;
}

function sessionsUrl(env: Env) {
  return `${appUrl(env)}/sessions`;
}

function truncate(s: string, max = 1900) {
  const str = String(s || "");
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1)}…`;
}

async function supabaseFetch(env: Env, path: string, init?: RequestInit) {
  const url = `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/${path.replace(/^\/+/, "")}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init?.headers || {}),
    },
  });

  const text = await res.text();
  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }

  return json;
}

async function hasLog(env: Env, key: string) {
  const q = `discord_notification_sends?notification_key=eq.${encodeURIComponent(key)}&select=id&limit=1`;
  const rows = await supabaseFetch(env, q, { method: "GET" });
  return Array.isArray(rows) && rows.length > 0;
}

async function insertLog(env: Env, row: {
  notification_key: string;
  session_id?: string | null;
  notification_type: "daily_schedule" | "session_24h" | "session_30m" | "session_started";
  target_date?: string | null;
  discord_message_id?: string | null;
  error?: string | null;
}) {
  await supabaseFetch(env, "discord_notification_sends", {
    method: "POST",
    body: JSON.stringify({
      notification_key: row.notification_key,
      session_id: row.session_id || null,
      notification_type: row.notification_type,
      target_date: row.target_date || null,
      discord_message_id: row.discord_message_id || null,
      error: row.error || null,
    }),
  });
}

async function postDiscord(env: Env, payload: any) {
  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      ...payload,
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Discord ${res.status}: ${text}`);

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function fetchActiveInfiniteRooms(env: Env) {
  const rows = await supabaseFetch(env, "rpc/get_active_infinite_rooms_for_discord", {
    method: "POST",
    body: JSON.stringify({
      min_participants: PRESENCE_MIN_PARTICIPANTS,
      active_window_seconds: PRESENCE_ACTIVE_WINDOW_SECONDS,
    }),
  });

  return Array.isArray(rows) ? (rows as ActiveInfiniteRoom[]) : [];
}

async function getRecentPresenceBroadcast(env: Env, sessionId: string, now: Date) {
  const since = addMinutes(now, -PRESENCE_COOLDOWN_MINUTES);
  const path =
    `discord_presence_broadcasts?room_session_id=eq.${encodeURIComponent(sessionId)}` +
    `&sent_at=gte.${encodeURIComponent(iso(since))}` +
    `&select=id,sent_at&order=sent_at.desc&limit=1`;
  const rows = await supabaseFetch(env, path, { method: "GET" });
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

function buildPresenceMessage(env: Env, room: ActiveInfiniteRoom) {
  const count = Number(room.participant_count || 0);
  const title = String(room.title || "Focus room").trim() || "Focus room";
  const link = `${appUrl(env)}/room-livekit/${encodeURIComponent(room.session_id)}`;
  const intro =
    count >= 5
      ? `🔥 **${count} people are focusing right now** in **${title}**.`
      : `🟢 **${count} people are focusing right now** in **${title}**.`;

  return {
    content: truncate(`${intro}\n\nJoin them:\n${link}`),
  };
}

async function maybeSendInfiniteRoomPresence(env: Env, now: Date, dryRun = false) {
  const rooms = await fetchActiveInfiniteRooms(env);
  const results: any[] = [];

  for (const room of rooms) {
    const sessionId = String(room.session_id || "").trim();
    const participantCount = Number(room.participant_count || 0);

    if (!sessionId || room.is_private === true || participantCount < PRESENCE_MIN_PARTICIPANTS) {
      results.push({
        skipped: true,
        sessionId: sessionId || null,
        participantCount,
        reason: !sessionId ? "missing_session_id" : room.is_private === true ? "private_room" : "below_threshold",
      });
      continue;
    }

    const recent = await getRecentPresenceBroadcast(env, sessionId, now);
    if (recent) {
      results.push({
        skipped: true,
        sessionId,
        participantCount,
        reason: "cooldown",
        lastBroadcastAt: recent.sent_at || null,
      });
      continue;
    }

    const payload = buildPresenceMessage(env, room);
    if (dryRun) {
      results.push({ dryRun: true, sessionId, participantCount, payload });
      continue;
    }

    const discord = await postDiscord(env, payload);
    await supabaseFetch(env, "discord_presence_broadcasts", {
      method: "POST",
      body: JSON.stringify({
        room_session_id: sessionId,
        participant_count: participantCount,
        message: payload.content,
      }),
    });
    results.push({
      sent: true,
      sessionId,
      participantCount,
      discordMessageId: discord?.id || null,
    });
  }

  return {
    roomsScanned: rooms.length,
    minParticipants: PRESENCE_MIN_PARTICIPANTS,
    activeWindowSeconds: PRESENCE_ACTIVE_WINDOW_SECONDS,
    cooldownMinutes: PRESENCE_COOLDOWN_MINUTES,
    results,
  };
}

async function fetchSessionsBetween(env: Env, start: Date, end: Date) {
  const select = [
    "id",
    "title",
    "start_time",
    "duration_minutes",
    "host_id",
    "host_name",
    "format",
    "session_format_type",
    "is_silent",
    "host_profile:profiles!sessions_host_id_fkey(id,full_name,avatar_url)",
  ].join(",");

  const path =
    `sessions?select=${encodeURIComponent(select)}` +
    `&start_time=gte.${encodeURIComponent(iso(start))}` +
    `&start_time=lt.${encodeURIComponent(iso(end))}` +
    `&order=start_time.asc`;

  const rows = await supabaseFetch(env, path, { method: "GET" });
  return Array.isArray(rows) ? (rows as SessionRow[]) : [];
}

function buildSessionReminderMessage(env: Env, session: SessionRow, type: "session_24h" | "session_30m" | "session_started") {
  const title = String(session.title || "Focus session").trim();
  const host = getHostName(session);
  const url = sessionUrl(env, session);

  if (type === "session_24h") {
    return {
      content: truncate(`📅 **Session tomorrow on MySession**

**${title}**
Hosted by **${host}**
Starts: **${formatDiscordTime(session.start_time)}**

Join / book here:
${url}

Click **Book Session** — it helps increase attendance and attract more people to the session.`),
    };
  }

  if (type === "session_30m") {
    return {
      content: truncate(`⏰ **Starts in ~30 minutes**

**${title}**
Hosted by **${host}**
Time: **${formatDiscordTime(session.start_time)}**

Join here:
${url}`),
    };
  }

  return {
    content: truncate(`🟢 **Session is starting now**

**${title}**
Hosted by **${host}**

Join here:
${url}`),
  };
}

function buildDailyScheduleMessage(env: Env, sessions: SessionRow[], targetDate: string) {
  if (sessions.length === 0) {
    return {
      content: `📅 **Today on MySession — ${targetDate}**

No scheduled sessions yet.

Check the sessions page:
${sessionsUrl(env)}`,
    };
  }

  const grouped = new Map<string, SessionRow[]>();

  for (const session of sessions) {
    const host = getHostName(session);
    const prev = grouped.get(host) || [];
    prev.push(session);
    grouped.set(host, prev);
  }

  const lines: string[] = [];
  lines.push(`📅 **Today on MySession — ${targetDate}**`);
  lines.push("");

  for (const [host, items] of grouped.entries()) {
    lines.push(`**${host} is hosting:**`);
    for (const s of items) {
      const title = String(s.title || "Focus session").trim();
      lines.push(`• ${formatDiscordTime(s.start_time)} — **${title}**`);
      lines.push(`  ${sessionUrl(env, s)}`);
    }
    lines.push("");
  }

  lines.push(`All sessions: ${sessionsUrl(env)}`);
  lines.push("");
  lines.push(`Click **Book Session** — it helps increase attendance and attract more people to the session.`);

  return { content: truncate(lines.join("\n"), 1900) };
}

async function maybeSendDailySchedule(env: Env, now: Date, dryRun = false) {
  const kyivHm = hmInKyiv(now);

  // Sends only in the 07:00-07:09 Kyiv window.
  if (!kyivHm.startsWith("07:0")) {
    return { skipped: true, reason: `not_daily_window_${kyivHm}` };
  }

  const targetDate = ymdInKyiv(now);
  const key = `daily_schedule:${targetDate}`;

  if (await hasLog(env, key)) {
    return { skipped: true, reason: "already_sent_daily_schedule", key };
  }

  const start = addHours(now, -12);
  const end = addHours(now, 24);
  const sessions = await fetchSessionsBetween(env, start, end);
  const payload = buildDailyScheduleMessage(env, sessions, targetDate);

  if (dryRun) return { dryRun: true, key, payload, sessionsCount: sessions.length };

  try {
    const discord = await postDiscord(env, payload);
    await insertLog(env, {
      notification_key: key,
      notification_type: "daily_schedule",
      target_date: targetDate,
      discord_message_id: discord?.id || null,
    });
    return { sent: true, key, sessionsCount: sessions.length };
  } catch (e: any) {
    await insertLog(env, {
      notification_key: key,
      notification_type: "daily_schedule",
      target_date: targetDate,
      error: String(e?.message || e || "discord_send_failed"),
    });
    throw e;
  }
}

async function maybeSendSessionReminders(env: Env, now: Date, dryRun = false) {
  const start = addMinutes(now, -10);
  const end = addHours(now, 25.5);
  const sessions = await fetchSessionsBetween(env, start, end);
  const results: any[] = [];

  for (const session of sessions) {
    if (!session.id || !session.start_time) continue;

    const startAt = new Date(session.start_time);
    if (Number.isNaN(startAt.getTime())) continue;

    const checks: Array<{ type: "session_24h" | "session_30m" | "session_started"; dueAt: Date }> = [
      { type: "session_24h", dueAt: addHours(startAt, -24) },
      { type: "session_30m", dueAt: addMinutes(startAt, -30) },
      { type: "session_started", dueAt: startAt },
    ];

    for (const check of checks) {
      if (!isDue(now, check.dueAt)) continue;

      const key = `${check.type}:${session.id}:${ymdInKyiv(startAt)}`;

      if (await hasLog(env, key)) {
        results.push({ skipped: true, key, reason: "already_sent" });
        continue;
      }

      const payload = buildSessionReminderMessage(env, session, check.type);

      if (dryRun) {
        results.push({ dryRun: true, key, payload });
        continue;
      }

      try {
        const discord = await postDiscord(env, payload);
        await insertLog(env, {
          notification_key: key,
          notification_type: check.type,
          session_id: session.id,
          target_date: ymdInKyiv(startAt),
          discord_message_id: discord?.id || null,
        });
        results.push({ sent: true, key, type: check.type, sessionId: session.id });
      } catch (e: any) {
        await insertLog(env, {
          notification_key: key,
          notification_type: check.type,
          session_id: session.id,
          target_date: ymdInKyiv(startAt),
          error: String(e?.message || e || "discord_send_failed"),
        });
        throw e;
      }
    }
  }

  return { sessionsScanned: sessions.length, results };
}

async function runAll(env: Env, dryRun = false) {
  const now = new Date();
  const daily = await maybeSendDailySchedule(env, now, dryRun);
  const reminders = await maybeSendSessionReminders(env, now, dryRun);
  const infiniteRoomPresence = await maybeSendInfiniteRoomPresence(env, now, dryRun);

  return {
    ok: true,
    now: now.toISOString(),
    kyivTime: hmInKyiv(now),
    dryRun,
    daily,
    reminders,
    infiniteRoomPresence,
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") return Response.json({ ok: true });

    if (url.pathname !== "/run") {
      return new Response("Not found", { status: 404 });
    }

    const secret = url.searchParams.get("secret") || "";
    if (env.DISCORD_WORKER_SECRET && secret !== env.DISCORD_WORKER_SECRET) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const dryRun = url.searchParams.get("dryRun") === "1";
    const result = await runAll(env, dryRun);
    return Response.json(result);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAll(env, false));
  },
};
