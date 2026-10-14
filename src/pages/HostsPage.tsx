import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import { countryName, formatCount, relativeTime } from "../lib/communityDisplay";
import CommunityAvatar from "../components/CommunityAvatar";
import { FoundingMemberBadge, SessionMilestoneBadge } from "../components/CommunityBadges";

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
  // Present once the founding-member migration is applied.
  is_founding_member?: boolean | null;
};

type Sort = "active" | "soon";

const DAY_MS = 24 * 60 * 60 * 1000;

function nextSessionTime(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function formatNext(time: number): string {
  const date = new Date(time);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const clock = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay(date, now)) return `Today, ${clock}`;
  if (sameDay(date, tomorrow)) return `Tomorrow, ${clock}`;
  return `${date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${clock}`;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[18px] font-semibold leading-6 tabular-nums text-[#2F2F2F]">{value}</div>
      <div className="truncate text-[12px] text-[#8A8A8A]">{label}</div>
    </div>
  );
}

function HostCard({ host }: { host: HostRow }) {
  const now = Date.now();
  const country = countryName(host.country_code);
  const nextTime = nextSessionTime(host.next_session_start);
  const upcoming = nextTime != null && nextTime > now - 60 * 60 * 1000 ? nextTime : null;
  const soon = upcoming != null && upcoming - now < DAY_MS;
  const lastHosted = nextSessionTime(host.last_hosted_at);
  const hosted = Number(host.hosted_sessions) || 0;

  return (
    <Link
      to={"/profile/" + host.user_id}
      className="group flex h-full flex-col rounded-[30px] border border-borderGray bg-white p-5 transition-colors duration-200 hover:border-[#A3A3A3] sm:p-6"
    >
      <div className="flex items-start gap-4">
        <CommunityAvatar userId={host.user_id} name={host.full_name} url={host.avatar_url} size={56} />
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[17px] font-semibold text-[#2F2F2F]">{host.full_name}</span>
            {host.is_founding_member ? <FoundingMemberBadge compact /> : null}
            <SessionMilestoneBadge sessions={host.attended_sessions} compact />
          </div>
          <div className="mt-0.5 truncate text-[13px] text-[#8A8A8A]">{country || "MySession host"}</div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 border-y border-[#EEEEEE] py-3.5">
        <Stat value={formatCount(hosted)} label="hosted" />
        <Stat value={formatCount(host.attended_sessions)} label="joined" />
        <Stat
          value={host.focus_rate == null ? "—" : `${Math.round(Number(host.focus_rate))}%`}
          label="focus rate"
        />
      </div>

      {host.bio ? (
        <p className="mt-4 line-clamp-3 text-[14px] leading-[1.55] text-[#4B4B4B]">{host.bio}</p>
      ) : null}

      <div className="mt-auto pt-4">
        {upcoming != null ? (
          <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[#F6F6F6] px-4 py-3 transition-colors group-hover:bg-[#EFEFEF]">
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[13px] font-medium text-[#2F2F2F]">
                <span className={`h-2 w-2 shrink-0 rounded-full ${soon ? "bg-[#65D46C]" : "bg-[#A3A3A3]"}`} aria-hidden="true" />
                {formatNext(upcoming)}
              </span>
              {host.next_session_title ? (
                <span className="mt-0.5 block truncate pl-4 text-[13px] text-[#606060]">{host.next_session_title}</span>
              ) : null}
            </span>
            <span className={`shrink-0 text-[12px] font-medium ${soon ? "text-[#2F8F35]" : "text-[#8A8A8A]"}`}>
              {relativeTime(upcoming, now)}
            </span>
          </div>
        ) : (
          <div className="rounded-[18px] border border-dashed border-[#E0E0E0] px-4 py-3 text-[13px] text-[#8A8A8A]">
            {lastHosted != null ? `Last hosted ${relativeTime(lastHosted, now)}` : "No sessions scheduled"}
          </div>
        )}
      </div>
    </Link>
  );
}

export default function HostsPage() {
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("active");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

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
    const matches = needle
      ? hosts.filter((host) =>
          [host.full_name, host.bio, countryName(host.country_code), host.next_session_title]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle))
        )
      : hosts;
    if (sort === "active") return matches;
    // Hosts with an upcoming session first, soonest at the top; the rest keep
    // the server's most-active order.
    const now = Date.now();
    return [...matches].sort((a, b) => {
      const at = nextSessionTime(a.next_session_start);
      const bt = nextSessionTime(b.next_session_start);
      const av = at != null && at >= now - 60 * 60 * 1000 ? at : Number.POSITIVE_INFINITY;
      const bv = bt != null && bt >= now - 60 * 60 * 1000 ? bt : Number.POSITIVE_INFINITY;
      return av - bv;
    });
  }, [hosts, query, sort]);

  const hostingToday = useMemo(() => {
    const now = Date.now();
    return hosts.filter((host) => {
      const time = nextSessionTime(host.next_session_start);
      return time != null && time > now - 60 * 60 * 1000 && time - now < DAY_MS;
    }).length;
  }, [hosts]);

  return (
    <main className="min-h-screen bg-white font-inter text-brandBlack">
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-14 md:px-6 md:pt-[72px]">
        <header className="text-center">
          <h1 className="text-[24px] font-normal leading-tight md:text-[28px] xl:text-[36px]">
            The people who host MySession
          </h1>
          <p className="mx-auto mt-3 max-w-[520px] text-[15px] leading-6 text-[#606060]">
            Find a host whose sessions fit your day, see when they're on next, and open their profile to book.
          </p>
        </header>

        <div className="mt-10 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label className="flex h-12 w-full items-center gap-2 rounded-full border border-borderGray bg-white px-5 transition-colors focus-within:border-[#A3A3A3] md:w-[340px]">
            <Search className="h-4 w-4 shrink-0 text-[#8A8A8A]" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, country or session"
              aria-label="Search hosts"
              className="w-full bg-transparent text-[14px] outline-none placeholder:text-[#A3A3A3]"
            />
          </label>

          <div className="flex items-center justify-between gap-3 md:justify-end">
            <div className="inline-flex rounded-full bg-[#F1F1F1] p-1" role="group" aria-label="Sort hosts">
              {([
                ["active", "Most active"],
                ["soon", "Hosting soon"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSort(value)}
                  aria-pressed={sort === value}
                  className={`h-10 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors ${sort === value ? "bg-white text-[#2F2F2F] shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-[#606060] hover:text-[#2F2F2F]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Link
              to="/leaderboard"
              className="hidden h-12 items-center rounded-full border border-brandBlack px-5 text-[14px] font-medium transition-colors hover:bg-brandBlack hover:text-white sm:inline-flex"
            >
              Leaderboard
            </Link>
          </div>
        </div>

        {!loading && !failed ? (
          <p className="mt-6 text-[13px] text-[#8A8A8A]" aria-live="polite">
            {query.trim()
              ? `${visible.length} of ${hosts.length} hosts`
              : `${hosts.length} ${hosts.length === 1 ? "host" : "hosts"}`}
            {hostingToday > 0 ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="inline-flex items-center gap-1.5 text-[#2F8F35]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#65D46C]" aria-hidden="true" />
                  {hostingToday} hosting in the next 24 hours
                </span>
              </>
            ) : null}
          </p>
        ) : null}

        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading hosts">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-[268px] animate-pulse rounded-[30px] bg-[#F6F6F6]" />
            ))}
          </div>
        ) : failed ? (
          <div className="mt-10 text-center text-[14px] text-[#606060]">
            Hosts could not be loaded. Please refresh the page.
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-10 text-center text-[14px] text-[#606060]">
            {query.trim() ? `No hosts match "${query.trim()}".` : "No hosts yet."}
          </div>
        ) : (
          <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((host) => (
              <HostCard key={host.user_id} host={host} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
