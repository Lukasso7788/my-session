// Group sessions that repeat (same host, title, local start time and length)
// so the session drawer can offer "book every day this week" without any
// database changes: each occurrence is already its own session row.

export const SERIES_WINDOW_DAYS = 7;

export type SeriesSourceSession = {
  id: string | number;
  title?: string | null;
  host_id?: string | null;
  start_time?: string | null;
  duration_minutes?: number | null;
  is_private?: boolean | null;
  session_bookings?: Array<{ user_id?: string | null }> | null;
  is_booked?: boolean | null;
};

export type SeriesOccurrence = {
  id: string;
  startTime: string;
  booked: boolean;
};

function normalizeTitle(title: unknown): string {
  return String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function sessionSeriesKey(session: SeriesSourceSession): string | null {
  const host = String(session.host_id || "").trim();
  const title = normalizeTitle(session.title);
  const start = Date.parse(String(session.start_time || ""));
  if (!host || !title || !Number.isFinite(start)) return null;
  const local = new Date(start);
  const timeOfDay = `${local.getHours()}:${String(local.getMinutes()).padStart(2, "0")}`;
  const duration = Math.round(Number(session.duration_minutes) || 0);
  return `${host}|${title}|${timeOfDay}|${duration}`;
}

function isBookedBy(session: SeriesSourceSession, userId: string | null | undefined): boolean {
  if (!userId) return false;
  if (session.session_bookings?.some((booking) => booking?.user_id === userId)) return true;
  return session.is_booked === true;
}

// Returns, for every session that belongs to a series of at least two
// occurrences, the upcoming occurrences of that series (including itself)
// that start within the window. Sessions that already ended are skipped;
// one that is running now stays so its chip still shows.
export function buildSessionSeries(
  sessions: SeriesSourceSession[],
  options: { userId?: string | null; now?: number; windowDays?: number } = {}
): Map<string, SeriesOccurrence[]> {
  const now = options.now ?? Date.now();
  const windowEnd = now + (options.windowDays ?? SERIES_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  const groups = new Map<string, SeriesSourceSession[]>();

  for (const session of sessions) {
    const key = sessionSeriesKey(session);
    if (!key) continue;
    const start = Date.parse(String(session.start_time));
    const end = start + Math.max(0, Number(session.duration_minutes) || 0) * 60_000;
    if (end <= now || start > windowEnd) continue;
    const list = groups.get(key);
    if (list) list.push(session);
    else groups.set(key, [session]);
  }

  const result = new Map<string, SeriesOccurrence[]>();
  for (const list of groups.values()) {
    const seen = new Set<string>();
    const occurrences = list
      .map((session) => ({
        id: String(session.id),
        startTime: String(session.start_time),
        booked: isBookedBy(session, options.userId),
      }))
      .filter((occurrence) => (seen.has(occurrence.id) ? false : (seen.add(occurrence.id), true)))
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
    if (occurrences.length < 2) continue;
    for (const occurrence of occurrences) result.set(occurrence.id, occurrences);
  }
  return result;
}
