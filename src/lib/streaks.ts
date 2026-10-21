// Attendance streaks from a list of attended days, with the same rules as the
// database (mysession_private.attendance_streaks, migration 20261018130000):
// UTC calendar days, ISO weeks starting Monday; a streak is current while the
// last period with attendance is this period or the one before.

export type StreakUnit = "day" | "week" | "month" | "year";
export type StreakSummary = {
  attended_today: boolean;
  days_this_week: number;
  days_this_month: number;
  streaks: Record<StreakUnit, { current: number; longest: number }>;
};

const UNITS: StreakUnit[] = ["day", "week", "month", "year"];
const MONDAY_2000 = Date.UTC(2000, 0, 3);
const DAY_MS = 86_400_000;

function dayNumber(dateKey: string): number {
  return Math.round((Date.parse(`${dateKey}T00:00:00Z`) - MONDAY_2000) / DAY_MS);
}

export function periodNumber(unit: StreakUnit, dateKey: string): number {
  const [y, m] = dateKey.split("-").map(Number);
  if (unit === "day") return dayNumber(dateKey);
  if (unit === "week") return Math.floor(dayNumber(dateKey) / 7);
  if (unit === "month") return y * 12 + m;
  return y;
}

/** YYYY-MM-DD (UTC) of a timestamp or date string; null when invalid. */
export function utcDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

export function computeStreaks(dayKeys: Iterable<string>, todayKey: string): StreakSummary {
  const days = [...new Set([...dayKeys].filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key) && key <= todayKey))];
  const streaks = {} as StreakSummary["streaks"];

  for (const unit of UNITS) {
    const periods = [...new Set(days.map((key) => periodNumber(unit, key)))].sort((a, b) => a - b);
    const now = periodNumber(unit, todayKey);
    let longest = 0;
    let current = 0;
    let run = 0;
    for (let i = 0; i < periods.length; i++) {
      run = i > 0 && periods[i] === periods[i - 1] + 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    if (periods.length && periods[periods.length - 1] >= now - 1) current = run;
    streaks[unit] = { current, longest };
  }

  const weekStart = periodNumber("week", todayKey);
  const monthNow = periodNumber("month", todayKey);
  return {
    attended_today: days.includes(todayKey),
    days_this_week: days.filter((key) => periodNumber("week", key) === weekStart).length,
    days_this_month: days.filter((key) => periodNumber("month", key) === monthNow).length,
    streaks,
  };
}
