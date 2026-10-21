import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { supabase } from "../lib/supabase";
import { computeStreaks, utcDateKey, type StreakSummary, type StreakUnit } from "../lib/streaks";

// The signed-in person's own streaks, shown quietly: small flame badges in the
// profile stats row ("5d", "7w"), details on hover/focus. Prefers the database
// (get_my_streaks, migration 20261021090000); until that is applied it counts
// them from the person's own attendance rows with the same rules (UTC days,
// weeks from Monday; a streak lives until a whole period is missed).

const UNITS: { key: StreakUnit; short: string; one: string; many: string }[] = [
  { key: "day", short: "d", one: "day", many: "days" },
  { key: "week", short: "w", one: "week", many: "weeks" },
  { key: "month", short: "m", one: "month", many: "months" },
  { key: "year", short: "y", one: "year", many: "years" },
];

export function streakNudge(summary: StreakSummary): string {
  const day = summary.streaks.day?.current ?? 0;
  if (summary.attended_today) return day >= 2 ? `You showed up today — ${day} days in a row.` : "You showed up today.";
  if (day >= 1) return `Join a session today to keep your ${day}-day streak.`;
  return "Join a session today to start a streak.";
}

async function loadFromAttendance(userId: string): Promise<StreakSummary | null> {
  const [visits, infinite] = await Promise.all([
    supabase.from("session_attendance").select("joined_at,last_seen_at").eq("user_id", userId).limit(5000),
    supabase.from("infinite_room_daily_attendance").select("created_at,attendance_date").eq("user_id", userId).limit(5000),
  ]);
  if (visits.error && infinite.error) return null;
  const days = new Set<string>();
  for (const row of (visits.data || []) as { joined_at?: string; last_seen_at?: string }[]) {
    const joined = utcDateKey(row.joined_at);
    if (joined) days.add(joined);
    const seen = utcDateKey(row.last_seen_at);
    if (seen) days.add(seen);
  }
  for (const row of (infinite.data || []) as { created_at?: string; attendance_date?: string }[]) {
    const day = utcDateKey(row.created_at) || utcDateKey(row.attendance_date);
    if (day) days.add(day);
  }
  return computeStreaks(days, new Date().toISOString().slice(0, 10));
}

function normalize(raw: any): StreakSummary | null {
  if (!raw || typeof raw !== "object" || !raw.streaks) return null;
  const pick = (unit: StreakUnit) => ({
    current: Number(raw.streaks?.[unit]?.current || 0),
    longest: Number(raw.streaks?.[unit]?.longest || 0),
  });
  return {
    attended_today: raw.attended_today === true,
    days_this_week: Number(raw.days_this_week || 0),
    days_this_month: Number(raw.days_this_month || 0),
    streaks: { day: pick("day"), week: pick("week"), month: pick("month"), year: pick("year") },
  };
}

/** Badges for the profile stats row. Only units with a streak; one quiet flame otherwise. */
export function ProfileStreakBadges({ summary }: { summary: StreakSummary }) {
  const active = UNITS.filter(({ key }) => (summary.streaks[key]?.current ?? 0) >= 1);
  const label = active.length
    ? active.map(({ key, one, many }) => {
        const n = summary.streaks[key].current;
        return `${n} ${n === 1 ? one : many} in a row`;
      }).join(", ")
    : "No streak yet";

  return (
    <span
      className="group/streaks relative inline-flex items-center gap-1 outline-none"
      tabIndex={0}
      aria-label={`Streaks: ${label}. ${streakNudge(summary)}`}
    >
      {active.length ? (
        active.map(({ key, short }) => {
          const n = summary.streaks[key].current;
          const live = n >= 2;
          return (
            <span
              key={key}
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] font-semibold tabular-nums ${live ? "bg-[#FFF1E6] text-[#C2410C]" : "bg-gray-100 text-gray-500"}`}
            >
              <Flame className="h-3.5 w-3.5" aria-hidden="true" />
              {n}
              {short}
            </span>
          );
        })
      ) : (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-400">
          <Flame className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}

      {/* Details on hover / keyboard focus. */}
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-1/2 top-[calc(100%+8px)] z-30 w-60 -translate-x-1/2 translate-y-1 rounded-2xl border border-black/10 bg-white p-3 text-left opacity-0 shadow-[0_12px_32px_rgba(0,0,0,0.12)] transition duration-150 group-hover/streaks:visible group-hover/streaks:translate-y-0 group-hover/streaks:opacity-100 group-focus-visible/streaks:visible group-focus-visible/streaks:translate-y-0 group-focus-visible/streaks:opacity-100"
      >
        <span className="block text-[13px] font-semibold text-[#2F2F2F]">Your streaks</span>
        <span className="mt-0.5 block text-[12px] leading-4 text-gray-500">{streakNudge(summary)}</span>
        <span className="mt-2 block space-y-1">
          {UNITS.map(({ key, one, many }) => {
            const current = summary.streaks[key]?.current ?? 0;
            const longest = summary.streaks[key]?.longest ?? 0;
            return (
              <span key={key} className="flex items-center justify-between gap-3 text-[12px]">
                <span className="inline-flex items-center gap-1.5 text-[#2F2F2F]">
                  <Flame className={`h-3.5 w-3.5 ${current >= 2 ? "text-[#EA580C]" : "text-gray-300"}`} aria-hidden="true" />
                  {current} {current === 1 ? one : many} in a row
                </span>
                <span className="text-gray-400">best {longest}</span>
              </span>
            );
          })}
        </span>
        <span className="mt-2 block text-[11px] text-gray-400">Only you can see this.</span>
      </span>
    </span>
  );
}

export default function ProfileStreaksPanel({ userId }: { userId: string }) {
  const [summary, setSummary] = useState<StreakSummary | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const run = async () => {
      const { data, error } = await supabase.rpc("get_my_streaks");
      const fromDb = error ? null : normalize(data);
      const result = fromDb || (await loadFromAttendance(userId).catch(() => null));
      if (!cancelled) setSummary(result || computeStreaks([], new Date().toISOString().slice(0, 10)));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!summary) return null;
  return <ProfileStreakBadges summary={summary} />;
}
