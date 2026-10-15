import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { profileHoverAttrs } from "../components/ProfileHoverLayer";
import { CalendarDays, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import { countryName, formatCount, initials } from "../lib/communityDisplay";

type HostRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  country_code: string | null;
  hosted_sessions: number;
  attended_sessions: number;
  focus_rate: number | null;
  focus_feedback_count: number;
  last_hosted_at: string | null;
  next_session_id: string | null;
  next_session_title: string | null;
  next_session_start: string | null;
};

type Sort = "active" | "soon";
type Filter = "all" | "today" | "week" | "focus";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TOP_FOCUS = 85;

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

// A session that started less than an hour ago still counts as upcoming.
function upcomingTime(host: HostRow, now: number): number | null {
  const time = parseTime(host.next_session_start);
  return time != null && time > now - HOUR_MS ? time : null;
}

function clock(time: number) {
  return new Date(time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function dayLabel(time: number, now: number) {
  const date = new Date(time);
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function relative(time: number, now: number) {
  const minutes = Math.round((time - now) / 60_000);
  if (minutes <= 0) return "Started";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

function lastHosted(value: string | null, now: number) {
  const time = parseTime(value);
  if (time == null) return null;
  const days = Math.floor((now - time) / DAY_MS);
  if (days <= 0) return "Hosted today";
  if (days === 1) return "Hosted yesterday";
  if (days < 30) return `Last hosted ${days} days ago`;
  return `Last hosted ${new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function Avatar({ host, size }: { host: HostRow; size: number }) {
  const style = { width: size, height: size };
  return host.avatar_url ? (
    <img src={host.avatar_url} style={style} className="shrink-0 rounded-full object-cover" alt="" loading="lazy" {...profileHoverAttrs(host.user_id, host.full_name)} />
  ) : (
    <span
      style={{ ...style, fontSize: Math.round(size * 0.3) }}
      className="flex shrink-0 items-center justify-center rounded-full bg-[#F1F1F1] font-semibold text-[#2F2F2F]"
      {...profileHoverAttrs(host.user_id, host.full_name)}
    >
      {initials(host.full_name)}
    </span>
  );
}

function Stat({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <div className={`text-[17px] font-semibold leading-6 tabular-nums ${accent ? "text-[#3F6FD8]" : "text-[#2F2F2F]"}`}>{value}</div>
      <div className="truncate text-[12px] text-[#8A8A8A]">{label}</div>
    </div>
  );
}

// Profile-style card: a status band on top (blue when the host is on within a
// day, light blue later, gray when nothing is scheduled), the avatar
// overlapping it, then name, next session, bio and three numbers.
function HostCard({ host, now }: { host: HostRow; now: number }) {
  const country = countryName(host.country_code);
  const next = upcomingTime(host, now);
  const soon = next != null && next - now < DAY_MS;
  const hosted = Number(host.hosted_sessions) || 0;
  const focus = host.focus_rate == null ? null : Math.round(Number(host.focus_rate));

  const band = soon
    ? { className: "bg-[#5286F6] text-white", label: "Next session", time: `${dayLabel(next as number, now)}, ${clock(next as number)}`, pill: "bg-white/20 text-white" }
    : next != null
      ? { className: "bg-[#EEF3FE] text-[#3F6FD8]", label: "Next session", time: `${new Date(next).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${clock(next)}`, pill: "bg-white text-[#3F6FD8]" }
      : { className: "bg-[#F6F6F6] text-[#8A8A8A]", label: "No upcoming sessions", time: lastHosted(host.last_hosted_at, now) || "Check back soon", pill: "" };

  return (
    <Link
      to={"/profile/" + host.user_id}
      className="group flex h-full flex-col overflow-hidden rounded-[28px] border border-borderGray bg-white transition-colors duration-200 hover:border-[#5286F6]"
    >
      <div className={`flex h-[58px] items-center justify-end gap-3 pl-[104px] pr-5 ${band.className}`}>
        <div className="min-w-0 text-right leading-tight">
          <div className="text-[11px] font-medium opacity-80">{band.label}</div>
          <div className="truncate text-[13px] font-semibold">{band.time}</div>
        </div>
        {next != null ? (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${band.pill}`}>{relative(next, now)}</span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col px-5 pb-5">
        <div className="-mt-7 flex items-start gap-3">
          <span className="rounded-full bg-white p-1">
            <Avatar host={host} size={64} />
          </span>
          <div className="min-w-0 flex-1 pt-8">
            <div className="truncate text-[17px] font-semibold leading-6 text-[#2F2F2F]">{host.full_name}</div>
            <div className="truncate text-[13px] text-[#8A8A8A]">{country || "MySession host"}</div>
          </div>
        </div>

        {next != null ? (
          <div className="mt-3 flex items-center gap-2 text-[13px] font-medium text-[#2F2F2F]">
            <CalendarDays className="h-4 w-4 shrink-0 text-[#5286F6]" aria-hidden="true" />
            <span className="truncate">{host.next_session_title || "Upcoming session"}</span>
          </div>
        ) : null}

        {host.bio ? (
          <p className="mt-2 line-clamp-2 text-[14px] leading-[1.5] text-[#606060]">{host.bio}</p>
        ) : null}

        <div className="mt-auto pt-4">
          <div className="grid grid-cols-3 divide-x divide-[#EEEEEE] border-t border-[#EEEEEE] pt-3.5">
            <Stat value={formatCount(hosted)} label="hosted" />
            <Stat value={formatCount(host.attended_sessions)} label="joined" />
            <Stat value={focus == null ? "—" : `${focus}%`} label="focus" accent={focus != null} />
          </div>
        </div>
      </div>
    </Link>
  );
}

const FILTERS: ReadonlyArray<readonly [Filter, string]> = [
  ["all", "All hosts"],
  ["today", "Hosting today"],
  ["week", "This week"],
  ["focus", `Top focus ${TOP_FOCUS}%+`],
];

function matchesFilter(host: HostRow, filter: Filter, now: number) {
  if (filter === "all") return true;
  if (filter === "focus") return host.focus_rate != null && Number(host.focus_rate) >= TOP_FOCUS;
  const time = upcomingTime(host, now);
  if (time == null) return false;
  return time - now < (filter === "today" ? DAY_MS : 7 * DAY_MS);
}

export default function HostsPage() {
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("active");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("community_hosts", { p_limit: 180 });
      if (cancelled) return;
      if (error) {
        console.error("[hosts] load failed", error);
        setFailed(true);
        setHosts([]);
      } else {
        setFailed(false);
        setHosts((data as HostRow[]) || []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = hosts.filter(
      (host) =>
        matchesFilter(host, filter, now) &&
        (!needle ||
          [host.full_name, host.bio, countryName(host.country_code), host.next_session_title]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle)))
    );
    if (sort === "active") return matches;
    // Hosts with an upcoming session first, soonest at the top; the rest keep
    // the server's most-active order.
    return [...matches].sort(
      (a, b) => (upcomingTime(a, now) ?? Number.POSITIVE_INFINITY) - (upcomingTime(b, now) ?? Number.POSITIVE_INFINITY)
    );
  }, [hosts, query, sort, filter, now]);

  const totals = useMemo(
    () => ({
      hosts: hosts.length,
      sessions: hosts.reduce((sum, host) => sum + (Number(host.hosted_sessions) || 0), 0),
      thisWeek: hosts.filter((host) => matchesFilter(host, "week", now)).length,
    }),
    [hosts, now]
  );

  const filtering = filter !== "all" || !!query.trim();

  return (
    <main className="min-h-screen bg-white font-inter text-brandBlack">
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="text-center">
          <h1 className="text-[24px] font-normal leading-tight md:text-[28px] xl:text-[36px]">
            The people who host MySession
          </h1>
          <p className="mx-auto mt-2 max-w-[520px] text-[15px] leading-6 text-[#606060]">
            Find a host whose sessions fit your day and open their profile to book.
          </p>
          {!loading && !failed && totals.hosts > 0 ? (
            <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[14px] text-[#606060]">
              <span><b className="font-semibold text-[#5286F6]">{formatCount(totals.hosts)}</b> hosts</span>
              <span><b className="font-semibold text-[#5286F6]">{formatCount(totals.sessions)}</b> sessions hosted</span>
              <span><b className="font-semibold text-[#5286F6]">{formatCount(totals.thisWeek)}</b> hosting this week</span>
            </div>
          ) : null}
        </header>

        <div className="mt-7 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filter hosts">
            {FILTERS.map(([value, label]) => {
              const active = filter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={active}
                  className={`h-10 shrink-0 whitespace-nowrap rounded-full border px-4 text-[13px] font-medium transition-colors ${active ? "border-brandBlack bg-brandBlack text-white" : "border-borderGray bg-white text-[#2F2F2F] hover:border-[#A3A3A3]"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex h-11 w-full items-center gap-2 rounded-full border border-borderGray bg-white px-4 transition-colors focus-within:border-[#5286F6] sm:w-[280px]">
              <Search className="h-4 w-4 shrink-0 text-[#8A8A8A]" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search hosts or sessions"
                aria-label="Search hosts"
                className="w-full bg-transparent text-[14px] outline-none placeholder:text-[#A3A3A3]"
              />
            </label>
            <div className="inline-flex shrink-0 self-start rounded-full border border-borderGray bg-white p-1 sm:self-auto" role="group" aria-label="Sort hosts">
              {([
                ["active", "Most active"],
                ["soon", "Hosting soon"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSort(value)}
                  aria-pressed={sort === value}
                  className={`h-9 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors ${sort === value ? "bg-brandBlack text-white" : "text-[#606060] hover:text-[#2F2F2F]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!loading && !failed && filtering ? (
          <p className="mt-4 text-[13px] text-[#8A8A8A]" aria-live="polite">
            {visible.length} of {hosts.length} hosts
          </p>
        ) : null}

        {loading ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading hosts">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-[236px] animate-pulse rounded-[28px] bg-[#F6F6F6]" />
            ))}
          </div>
        ) : failed ? (
          <div className="mt-10 text-center text-[14px] text-[#606060]">
            Hosts could not be loaded. Please refresh the page.
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-10 text-center text-[14px] text-[#606060]">
            {query.trim() ? `No hosts match "${query.trim()}".` : "No hosts match this filter yet."}
          </div>
        ) : (
          <section className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((host) => (
              <HostCard key={host.user_id} host={host} now={now} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
