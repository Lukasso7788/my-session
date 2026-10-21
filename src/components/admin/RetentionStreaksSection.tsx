import { useEffect, useMemo, useState } from "react";
import { Flame, RefreshCw, Repeat2, Trophy } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { buildRetentionReport, monthStartKey } from "../../lib/retentionReport";

// Admin dashboard: who keeps coming back. Data: admin_retention_streaks
// (migration 20261018130000), from the durable per-day attendance cache.
// UTC calendar; weeks start on Monday.

type Unit = "day" | "week" | "month" | "year";

type Person = { user_id: string; full_name: string | null; avatar_url: string | null };
type PeriodPoint = { start: string; active: number; returning: number; returning3: number };
type StreakPerson = Person & { current: number; longest: number };
type UnitStreaks = {
  buckets: { min: number; users: number }[];
  on_streak: number;
  top: StreakPerson[];
  record: StreakPerson | null;
};
export type RetentionReport = {
  as_of: string;
  week_start: string;
  month_start: string;
  returning: {
    weeks: PeriodPoint[];
    months: PeriodPoint[];
    top: Partial<Record<"week" | "month" | "prev_month", (Person & { days: number })[]>>;
  };
  streaks: Record<Unit, UnitStreaks>;
};

const UNIT_LABEL: Record<Unit, { tab: string; one: string; many: string }> = {
  day: { tab: "Days", one: "day", many: "days" },
  week: { tab: "Weeks", one: "week", many: "weeks" },
  month: { tab: "Months", one: "month", many: "months" },
  year: { tab: "Years", one: "year", many: "years" },
};

const plural = (n: number, unit: Unit) => `${n} ${n === 1 ? UNIT_LABEL[unit].one : UNIT_LABEL[unit].many}`;
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function periodLabel(iso: string, scope: "weeks" | "months") {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return scope === "weeks"
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
    : date.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
}

function Avatar({ person, size = 32 }: { person: Person; size?: number }) {
  const name = person.full_name || "Member";
  return person.avatar_url ? (
    <img src={person.avatar_url} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-[#ECEFEB] text-[12px] font-bold text-[#4B524D]"
      style={{ width: size, height: size }}
    >
      {name.trim().charAt(0).toUpperCase() || "M"}
    </span>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div className="inline-flex rounded-full bg-[#EEF0ED] p-1">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${value === key ? "bg-white text-[#1F2328] shadow-[0_1px_3px_rgba(0,0,0,0.08)]" : "text-[#6B726D] hover:text-[#1F2328]"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function RetentionStreaksView({ report }: { report: RetentionReport }) {
  const [scope, setScope] = useState<"weeks" | "months">("weeks");
  const [who, setWho] = useState<"week" | "month" | "prev_month">("month");
  const [unit, setUnit] = useState<Unit>("week");

  const series = report.returning[scope] || [];
  const current = series.at(-1) || { active: 0, returning: 0, returning3: 0, start: "" };
  const previous = series.at(-2);
  const maxActive = Math.max(1, ...series.map((p) => p.active));
  const people = report.returning.top[who] || [];
  const streaks = report.streaks[unit];
  const maxBucket = Math.max(1, ...(streaks?.buckets || []).map((b) => b.users));
  const trend = useMemo(() => {
    if (!previous || previous.returning === 0) return null;
    return Math.round(((current.returning - previous.returning) / previous.returning) * 100);
  }, [current.returning, previous]);

  return (
    <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
      {/* Returning people */}
      <div className="rounded-[24px] border border-black/[0.06] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#5E665F]">
              <Repeat2 className="h-4 w-4 text-[#16803B]" aria-hidden="true" />
              Came back on 2+ days
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <b className="text-[36px] leading-none tracking-[-0.04em] text-[#1F2328]">{current.returning}</b>
              <span className="text-[14px] text-[#6B726D]">
                of {current.active} active {scope === "weeks" ? "this week" : "this month"} · {percent(current.returning, current.active)}%
              </span>
            </div>
            <div className="mt-1 text-[12px] text-[#7C827E]">
              {current.returning3} came on 3+ days
              {trend !== null ? (
                <span className={`ml-2 rounded-full px-2 py-0.5 font-semibold ${trend >= 0 ? "bg-[#EAF8ED] text-[#16803B]" : "bg-[#FDECEC] text-[#B23A3A]"}`}>
                  {trend >= 0 ? "+" : ""}{trend}% vs last {scope === "weeks" ? "week" : "month"}
                </span>
              ) : null}
            </div>
          </div>
          <Segmented value={scope} onChange={setScope} options={[["weeks", "12 weeks"], ["months", "12 months"]]} />
        </div>

        <div className="mt-6 flex h-44 items-end gap-1.5 sm:gap-2">
          {series.map((point) => (
            <div key={point.start} className="group flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-lg bg-[#F3F4F2]" title={`${periodLabel(point.start, scope)}: ${point.active} active · ${point.returning} on 2+ days · ${point.returning3} on 3+ days`}>
                <div className="absolute inset-x-0 bottom-0 rounded-lg bg-[#D9EEDC]" style={{ height: `${(point.active / maxActive) * 100}%` }} />
                <div className="absolute inset-x-0 bottom-0 rounded-lg bg-[#5CC16B]" style={{ height: `${(point.returning / maxActive) * 100}%` }} />
                <div className="absolute inset-x-0 bottom-0 rounded-lg bg-[#16803B]" style={{ height: `${(point.returning3 / maxActive) * 100}%` }} />
              </div>
              <div className="mt-2 truncate text-center text-[10px] font-medium text-[#8A908B]">{periodLabel(point.start, scope)}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-[#6B726D]">
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[#D9EEDC]" />Active</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[#5CC16B]" />2+ days</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[#16803B]" />3+ days</span>
        </div>
      </div>

      {/* Who comes back */}
      <div className="rounded-[24px] border border-black/[0.06] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] font-semibold text-[#5E665F]">Who comes back most</div>
          <Segmented value={who} onChange={setWho} options={[["week", "This week"], ["month", "This month"], ["prev_month", "Last month"]]} />
        </div>
        <div className="mt-4 space-y-1">
          {people.length ? (
            people.slice(0, 8).map((person, index) => (
              <div key={person.user_id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-[#F5F6F4]">
                <span className="w-5 text-right text-[12px] font-semibold tabular-nums text-[#9AA09B]">{index + 1}</span>
                <Avatar person={person} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#1F2328]">{person.full_name || "Member"}</span>
                <span className="rounded-full bg-[#EAF8ED] px-2.5 py-1 text-[12px] font-semibold tabular-nums text-[#16803B]">{person.days} days</span>
              </div>
            ))
          ) : (
            <div className="grid min-h-40 place-items-center text-center text-[13px] text-[#7C827E]">Nobody has come back twice yet in this period.</div>
          )}
        </div>
      </div>

      {/* Streaks */}
      <div className="rounded-[24px] border border-black/[0.06] bg-white p-5 xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#5E665F]">
              <Flame className="h-4 w-4 text-[#EA580C]" aria-hidden="true" />
              Streaks
            </div>
            <p className="mt-1 text-[12px] text-[#7C827E]">
              {UNIT_LABEL[unit].many[0].toUpperCase() + UNIT_LABEL[unit].many.slice(1)} in a row with at least one session. A streak stays alive until a whole {UNIT_LABEL[unit].one} is missed.
            </p>
          </div>
          <Segmented value={unit} onChange={setUnit} options={(Object.keys(UNIT_LABEL) as Unit[]).map((key) => [key, UNIT_LABEL[key].tab])} />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-[#FFF4EC] p-4">
                <div className="text-[12px] font-semibold text-[#9A4A12]">On a streak now</div>
                <b className="mt-1 block text-[30px] leading-none tracking-[-0.04em] text-[#1F2328]">{streaks?.on_streak ?? 0}</b>
                <div className="mt-1 text-[11px] text-[#9A6B4A]">2+ {UNIT_LABEL[unit].many} in a row</div>
              </div>
              <div className="rounded-2xl bg-[#F4F1FF] p-4">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#5B3FC4]">
                  <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
                  Record
                </div>
                <b className="mt-1 block text-[30px] leading-none tracking-[-0.04em] text-[#1F2328]">{streaks?.record?.longest ?? 0}</b>
                <div className="mt-1 truncate text-[11px] text-[#6E5BB0]">{streaks?.record ? `${streaks.record.full_name || "Member"} · ${UNIT_LABEL[unit].many}` : "No streaks yet"}</div>
              </div>
            </div>

            <div className="space-y-2">
              {(streaks?.buckets || []).map((bucket) => (
                <div key={bucket.min} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-[12px] font-semibold text-[#5E665F]">{bucket.min}+ {UNIT_LABEL[unit].many}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-lg bg-[#F3F4F2]">
                    <div
                      className="flex h-full items-center rounded-lg bg-gradient-to-r from-[#FDBA74] to-[#EA580C] px-2 text-[11px] font-bold text-white transition-[width] duration-500"
                      style={{ width: `${Math.max(bucket.users ? 8 : 0, (bucket.users / maxBucket) * 100)}%` }}
                    >
                      {bucket.users || ""}
                    </div>
                  </div>
                  {!bucket.users ? <span className="w-4 text-[11px] text-[#9AA09B]">0</span> : <span className="w-4" />}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-[#FAFAF9] p-2">
            {streaks?.top?.length ? (
              streaks.top.map((person, index) => (
                <div key={person.user_id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white">
                  <span className="w-5 text-right text-[12px] font-semibold tabular-nums text-[#9AA09B]">{index + 1}</span>
                  <Avatar person={person} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] text-[#1F2328]">{person.full_name || "Member"}</b>
                    <small className="block text-[11px] text-[#8A908B]">Best {plural(person.longest, unit)}</small>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF1E6] px-2.5 py-1 text-[12px] font-bold tabular-nums text-[#C2410C]">
                    <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                    {person.current}
                  </span>
                </div>
              ))
            ) : (
              <div className="grid min-h-48 place-items-center text-center text-[13px] text-[#7C827E]">
                Nobody is on a {UNIT_LABEL[unit].one} streak right now.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

async function buildReportInBrowser(): Promise<RetentionReport> {
  const todayKey = new Date().toISOString().slice(0, 10);
  const start = monthStartKey(todayKey, 35);
  const end = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("admin_daily_attendance_history", { p_start_date: start, p_end_date: end });
  if (error) throw error;
  const days = ((data || []) as { attendance_date: string; attendee_ids: string[] | null }[]).map((row) => ({
    date: String(row.attendance_date || "").slice(0, 10),
    userIds: Array.isArray(row.attendee_ids) ? row.attendee_ids.map(String) : [],
  }));
  const report = buildRetentionReport(days, todayKey);

  // Names and avatars for the people shown.
  const ids = new Set<string>();
  Object.values(report.returning.top).forEach((list) => list.forEach((p) => ids.add(p.user_id)));
  Object.values(report.streaks).forEach((unit) => {
    unit.top.forEach((p) => ids.add(p.user_id));
    if (unit.record) ids.add(unit.record.user_id);
  });
  if (ids.size) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name, avatar_url").in("id", [...ids]);
    const byId = new Map(((profiles || []) as { id: string; full_name: string | null; avatar_url: string | null }[]).map((p) => [p.id, p]));
    const fill = <T extends { user_id: string; full_name: string | null; avatar_url: string | null }>(p: T): T => ({
      ...p,
      full_name: byId.get(p.user_id)?.full_name ?? null,
      avatar_url: byId.get(p.user_id)?.avatar_url ?? null,
    });
    (Object.keys(report.returning.top) as (keyof typeof report.returning.top)[]).forEach((key) => {
      report.returning.top[key] = report.returning.top[key].map(fill);
    });
    (Object.keys(report.streaks) as Unit[]).forEach((unit) => {
      report.streaks[unit].top = report.streaks[unit].top.map(fill);
      report.streaks[unit].record = report.streaks[unit].record ? fill(report.streaks[unit].record!) : null;
    });
  }
  return report as RetentionReport;
}

export default function RetentionStreaksSection() {
  const [report, setReport] = useState<RetentionReport | null>(null);
  const [source, setSource] = useState<"database" | "browser">("database");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("admin_retention_streaks");
    if (!rpcError && data) {
      setReport(data as RetentionReport);
      setSource("database");
    } else {
      // Not applied yet (or failed): count it here from the per-day attendee
      // lists the dashboard already uses.
      try {
        setReport(await buildReportInBrowser());
        setSource("browser");
      } catch {
        setError("Could not load returning people and streaks.");
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold tracking-[-0.03em] text-[#1F2328]">Returning &amp; streaks</h2>
          <p className="mt-1 text-[13px] text-[#6B726D]">
            Who keeps coming back. A return is attendance on another day; UTC calendar, weeks start Monday.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-[12px] font-semibold text-[#3F4541] hover:bg-[#F5F6F4]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </button>
      </div>
      {error ? (
        <div className="rounded-[24px] border border-black/[0.06] bg-white p-5 text-[13px] text-[#6B726D]">{error}</div>
      ) : report ? (
        <>
          <RetentionStreaksView report={report} />
          {source === "browser" ? (
            <p className="mt-2 text-[11px] text-[#8A908B]">
              Counted in the browser from daily attendance. Apply migration 20261018130000_admin_retention_streaks.sql to compute it in the database.
            </p>
          ) : null}
        </>
      ) : (
        <div className="grid min-h-40 place-items-center rounded-[24px] border border-black/[0.06] bg-white text-[13px] text-[#7C827E]">Loading…</div>
      )}
    </section>
  );
}
