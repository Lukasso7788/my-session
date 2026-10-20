import { useEffect, useState } from "react";
import { Flame, Trophy } from "lucide-react";
import { supabase } from "../lib/supabase";

// The signed-in person's own streaks on their profile (get_my_streaks,
// migration 20261021090000). Same rules as the admin dashboard: UTC days,
// weeks from Monday; a streak lives until a whole period is missed. Hidden
// when the data is not available.

type Unit = "day" | "week" | "month" | "year";
type StreakSummary = {
  attended_today: boolean;
  days_this_week: number;
  days_this_month: number;
  streaks: Partial<Record<Unit, { current: number; longest: number }>>;
};

const UNITS: { key: Unit; title: string; one: string; many: string }[] = [
  { key: "day", title: "Days in a row", one: "day", many: "days" },
  { key: "week", title: "Weeks in a row", one: "week", many: "weeks" },
  { key: "month", title: "Months in a row", one: "month", many: "months" },
  { key: "year", title: "Years in a row", one: "year", many: "years" },
];

export function streakNudge(summary: StreakSummary): string {
  const day = summary.streaks.day?.current ?? 0;
  const weekDays = summary.days_this_week;
  if (summary.attended_today) {
    return day >= 2
      ? `You showed up today: ${day} days in a row. ${weekDays} ${weekDays === 1 ? "day" : "days"} this week.`
      : `You showed up today. ${weekDays} ${weekDays === 1 ? "day" : "days"} this week.`;
  }
  if (day >= 1) return `Join a session today to keep your ${day}-day streak going.`;
  return "Join a session today to start a streak.";
}

export function ProfileStreaksView({ summary }: { summary: StreakSummary }) {
  return (
    <section className="mt-10" aria-labelledby="profile-streaks-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="profile-streaks-title" className="text-xl font-bold text-[#2F2F2F]">Your streaks</h2>
          <p className="mt-1 text-[13px] text-gray-500">{streakNudge(summary)}</p>
        </div>
        <span className="text-[12px] text-gray-400">Only you can see this</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {UNITS.map(({ key, title, one, many }) => {
          const current = summary.streaks[key]?.current ?? 0;
          const longest = summary.streaks[key]?.longest ?? 0;
          const live = current >= 2;
          return (
            <div
              key={key}
              className={`rounded-2xl border px-4 py-4 transition ${live ? "border-[#FDBA74] bg-gradient-to-b from-[#FFF7ED] to-white" : "border-gray-200 bg-white"}`}
            >
              <div className="text-[13px] font-semibold text-gray-500">{title}</div>
              <div className="mt-2 flex items-center gap-2">
                <Flame className={`h-6 w-6 shrink-0 ${live ? "text-[#EA580C]" : "text-gray-300"}`} aria-hidden="true" />
                <span className="text-[30px] font-bold leading-none tracking-[-0.03em] text-[#2F2F2F]">{current}</span>
                <span className="self-end pb-0.5 text-[13px] text-gray-500">{current === 1 ? one : many}</span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[12px] text-gray-500">
                <Trophy className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                Best {longest} {longest === 1 ? one : many}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ProfileStreaksPanel() {
  const [summary, setSummary] = useState<StreakSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("get_my_streaks").then(({ data, error }) => {
      if (cancelled || error || !data || typeof data !== "object") return;
      setSummary(data as StreakSummary);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary) return null;
  return <ProfileStreaksView summary={summary} />;
}
