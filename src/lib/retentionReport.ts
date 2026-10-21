// The admin "Returning & streaks" report computed from per-day attendee lists
// (admin_daily_attendance_history), for when admin_retention_streaks
// (migration 20261018130000) is not applied yet. Same rules as the database:
// UTC days, weeks from Monday, returning = attendance on 2+ different days.

import { computeStreaks, periodNumber, type StreakUnit } from "./streaks";

type PersonRef = { user_id: string; full_name: string | null; avatar_url: string | null };
export type ReportPeriod = { start: string; active: number; returning: number; returning3: number };
export type ReportStreakPerson = PersonRef & { current: number; longest: number };
export type ComputedRetentionReport = {
  as_of: string;
  week_start: string;
  month_start: string;
  returning: {
    weeks: ReportPeriod[];
    months: ReportPeriod[];
    top: Record<"week" | "month" | "prev_month", (PersonRef & { days: number })[]>;
  };
  streaks: Record<StreakUnit, {
    buckets: { min: number; users: number }[];
    on_streak: number;
    top: ReportStreakPerson[];
    record: ReportStreakPerson | null;
  }>;
};

const THRESHOLDS: Record<StreakUnit, number[]> = {
  day: [2, 3, 5, 7, 14, 30],
  week: [2, 3, 4, 8, 12, 26, 52],
  month: [2, 3, 6, 12],
  year: [2, 3, 5],
};

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ref = (id: string): PersonRef => ({ user_id: id, full_name: null, avatar_url: null });

export function weekStartKey(dateKey: string): string {
  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  return iso(ms - dow * 86_400_000);
}

export function monthStartKey(dateKey: string, monthsBack = 0): string {
  const [y, m] = dateKey.split("-").map(Number);
  return iso(Date.UTC(y, m - 1 - monthsBack, 1));
}

export function buildRetentionReport(days: { date: string; userIds: string[] }[], todayKey: string): ComputedRetentionReport {
  const byUser = new Map<string, Set<string>>();
  for (const day of days) {
    if (!day.date || day.date > todayKey) continue;
    for (const id of day.userIds) {
      if (!id) continue;
      if (!byUser.has(id)) byUser.set(id, new Set());
      byUser.get(id)!.add(day.date);
    }
  }

  const weekStart = weekStartKey(todayKey);
  const monthStart = monthStartKey(todayKey);
  const weekStarts = Array.from({ length: 12 }, (_, i) => iso(Date.parse(`${weekStart}T00:00:00Z`) - (11 - i) * 7 * 86_400_000));
  const monthStarts = Array.from({ length: 12 }, (_, i) => monthStartKey(todayKey, 11 - i));

  const perPeriod = (unit: "week" | "month", start: string) => {
    const n = periodNumber(unit, start);
    const counts: { id: string; days: number }[] = [];
    for (const [id, set] of byUser) {
      let count = 0;
      for (const d of set) if (periodNumber(unit, d) === n) count += 1;
      if (count) counts.push({ id, days: count });
    }
    return counts;
  };
  const summarize = (start: string, counts: { days: number }[]): ReportPeriod => ({
    start,
    active: counts.length,
    returning: counts.filter((c) => c.days >= 2).length,
    returning3: counts.filter((c) => c.days >= 3).length,
  });
  const top = (counts: { id: string; days: number }[]) =>
    counts.filter((c) => c.days >= 2).sort((a, b) => b.days - a.days || a.id.localeCompare(b.id)).slice(0, 20)
      .map((c) => ({ ...ref(c.id), days: c.days }));

  const thisWeek = perPeriod("week", weekStart);
  const thisMonth = perPeriod("month", monthStart);
  const prevMonth = perPeriod("month", monthStartKey(todayKey, 1));

  const perUserStreaks = [...byUser].map(([id, set]) => ({ id, s: computeStreaks(set, todayKey).streaks }));
  const streaks = {} as ComputedRetentionReport["streaks"];
  for (const unit of ["day", "week", "month", "year"] as StreakUnit[]) {
    const rows = perUserStreaks.map(({ id, s }) => ({ ...ref(id), current: s[unit].current, longest: s[unit].longest }));
    const byCurrent = [...rows].sort((a, b) => b.current - a.current || b.longest - a.longest || a.user_id.localeCompare(b.user_id));
    const byLongest = [...rows].sort((a, b) => b.longest - a.longest || b.current - a.current || a.user_id.localeCompare(b.user_id));
    streaks[unit] = {
      buckets: THRESHOLDS[unit].map((min) => ({ min, users: rows.filter((r) => r.current >= min).length })),
      on_streak: rows.filter((r) => r.current >= 2).length,
      top: byCurrent.filter((r) => r.current >= 2).slice(0, 10),
      record: byLongest[0] || null,
    };
  }

  return {
    as_of: todayKey,
    week_start: weekStart,
    month_start: monthStart,
    returning: {
      weeks: weekStarts.map((start) => summarize(start, perPeriod("week", start))),
      months: monthStarts.map((start) => summarize(start, perPeriod("month", start))),
      top: { week: top(thisWeek), month: top(thisMonth), prev_month: top(prevMonth) },
    },
    streaks,
  };
}
