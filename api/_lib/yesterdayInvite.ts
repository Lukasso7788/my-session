// "Come back today" invite: the daily schedule email, sent the next morning to
// people who signed up yesterday or attended a session yesterday, with an
// intro written for them. Delivery, unsubscribe and the one-email-per-day
// ledger are the daily schedule email's own (api/livekit/admin.ts).
//
// Days are UTC calendar days, like the attendance day cache.

export type YesterdayKind = "new" | "returning";

export type YesterdayIntro = { subject: string; heading: string; lead: string };

/** The calendar day before a YYYY-MM-DD date. */
export function previousDateKey(dateKey: string): string {
  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error("invalid_schedule_date");
  return new Date(ms - 86_400_000).toISOString().slice(0, 10);
}

/** [start, end) of a UTC calendar day as ISO strings. */
export function utcDayBounds(dateKey: string): { startIso: string; endIso: string } {
  const start = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(start)) throw new Error("invalid_schedule_date");
  return { startIso: new Date(start).toISOString(), endIso: new Date(start + 86_400_000).toISOString() };
}

/**
 * Who gets the invite and which intro. Attending yesterday wins over signing
 * up yesterday: someone who signed up and already came gets "good to see you".
 */
export function classifyYesterdayAudience(params: {
  registeredYesterday: Iterable<string>;
  attendedYesterday: Iterable<string>;
}): Map<string, YesterdayKind> {
  const kinds = new Map<string, YesterdayKind>();
  for (const id of params.registeredYesterday) if (id) kinds.set(id, "new");
  for (const id of params.attendedYesterday) if (id) kinds.set(id, "returning");
  return kinds;
}

export function yesterdayIntro(kind: YesterdayKind, recipientName: string, dateLabel: string): YesterdayIntro {
  const name = recipientName || "there";
  if (kind === "new") {
    return {
      subject: `Your first MySession is today — ${dateLabel}`,
      heading: "Your first session is one click away",
      lead: `Hey ${name}, you joined MySession yesterday — welcome! Pick a session from today's schedule below and just show up: say what you're working on, then get it done alongside others. Camera on or off, whatever helps you focus.`,
    };
  }
  return {
    subject: `Come back today — ${dateLabel}`,
    heading: "Good to see you yesterday",
    lead: `Hey ${name}, thanks for showing up yesterday. Keep the momentum going: here's today's schedule. One session today makes it two days in a row.`,
  };
}
