import { supabase } from "./supabase";

export type TaskSessionOption = {
  id: string;
  title: string;
  start_time: string | null;
  duration_minutes: number | null;
  session_format_type: string | null;
  custom_slug: string | null;
  host_id: string | null;
};

type PublicSessionBookingLite = {
  session_id: string;
  user_id: string;
};

export function isInfiniteTaskSession(session: TaskSessionOption) {
  return String(session.session_format_type || "").toLowerCase() === "infinite";
}

export function isTaskSessionStillActive(
  session: TaskSessionOption,
  nowMs = Date.now(),
) {
  if (isInfiniteTaskSession(session)) return true;

  const startMs = Date.parse(String(session.start_time || ""));
  if (!Number.isFinite(startMs)) return false;

  const durationMs = Math.max(1, Number(session.duration_minutes || 0)) * 60_000;
  return startMs + durationMs > nowMs;
}

export function filterEligibleTaskSessions(args: {
  sessions: TaskSessionOption[];
  userId: string;
  bookedSessionIds: Iterable<string>;
  nowMs?: number;
}) {
  const userId = String(args.userId || "").trim().toLowerCase();
  const booked = new Set(
    Array.from(args.bookedSessionIds || []).map((id) =>
      String(id || "").trim().toLowerCase(),
    ),
  );
  const nowMs = args.nowMs ?? Date.now();

  return args.sessions
    .filter((session) => {
      if (isInfiniteTaskSession(session)) return true;
      if (!isTaskSessionStillActive(session, nowMs)) return false;

      const sessionId = String(session.id || "").trim().toLowerCase();
      const hostId = String(session.host_id || "").trim().toLowerCase();
      return hostId === userId || booked.has(sessionId);
    })
    .sort((a, b) => {
      const aInfinite = isInfiniteTaskSession(a);
      const bInfinite = isInfiniteTaskSession(b);
      if (aInfinite !== bInfinite) return aInfinite ? -1 : 1;
      return Date.parse(String(a.start_time || "")) - Date.parse(String(b.start_time || ""));
    });
}

export async function loadEligibleTaskSessions(userId: string) {
  const uid = String(userId || "").trim();
  if (!uid) return [] as TaskSessionOption[];

  const activeWindowStart = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const sessionsResult = await supabase
    .from("sessions")
    .select(
      "id,title,start_time,duration_minutes,session_format_type,custom_slug,host_id",
    )
    .or("is_hidden.is.null,is_hidden.eq.false")
    .or(`session_format_type.eq.infinite,start_time.gte.${activeWindowStart}`)
    .order("start_time", { ascending: true })
    .limit(500);

  if (sessionsResult.error) throw sessionsResult.error;

  const sessions = (Array.isArray(sessionsResult.data)
    ? sessionsResult.data
    : []) as TaskSessionOption[];
  const sessionIds = sessions.map((session) => session.id).filter(Boolean);

  let bookings: PublicSessionBookingLite[] = [];
  if (sessionIds.length > 0) {
    const bookingsResult = await supabase.rpc(
      "get_public_session_bookings_with_times",
      { p_session_ids: sessionIds },
    );
    if (bookingsResult.error) throw bookingsResult.error;
    bookings = (Array.isArray(bookingsResult.data)
      ? bookingsResult.data
      : []) as PublicSessionBookingLite[];
  }

  return filterEligibleTaskSessions({
    sessions,
    userId: uid,
    bookedSessionIds: bookings
      .filter((row) => String(row.user_id || "").toLowerCase() === uid.toLowerCase())
      .map((row) => row.session_id),
  });
}
