import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { countryName, formatCount, formatHours, initials } from "../lib/communityDisplay";

type HostRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  country_code: string | null;
  hosted_sessions: number;
  focus_rate: number | null;
  focus_feedback_count: number;
};

type UserRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  country_code: string | null;
  sessions_count: number;
  focus_hours: number;
  last_seen_at: string | null;
};

type Tab = "members" | "hosts";
type MemberSort = "sessions" | "hours";
type HostSort = "sessions" | "focus";

type Entry = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  country_code: string | null;
  value: number;
  valueText: string;
  unit: string;
  detail: string;
};

const PAGE_SIZE = 50;

// Dark pill chips, the same as the filters on /hosts.
function Chips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="flex gap-2" role="group" aria-label={label}>
      {options.map(([option, text]) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={active}
            className={`h-10 shrink-0 whitespace-nowrap rounded-full border px-4 text-[13px] font-medium transition-colors ${active ? "border-brandBlack bg-brandBlack text-white" : "border-borderGray bg-white text-[#2F2F2F] hover:border-[#A3A3A3]"}`}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

// Compact two-way switch, the same as the sort control on /hosts.
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-full border border-borderGray bg-white p-1" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={`h-9 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors ${value === option ? "bg-brandBlack text-white" : "text-[#606060] hover:text-[#2F2F2F]"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Avatar({ entry, size }: { entry: Entry; size: number }) {
  const style = { width: size, height: size };
  return entry.avatar_url ? (
    <img src={entry.avatar_url} style={style} className="shrink-0 rounded-full object-cover" alt="" loading="lazy" />
  ) : (
    <span
      style={{ ...style, fontSize: Math.round(size * 0.3) }}
      className="flex shrink-0 items-center justify-center rounded-full bg-[#F1F1F1] font-semibold text-[#2F2F2F]"
    >
      {initials(entry.full_name)}
    </span>
  );
}

// Profile-style card for the top three: a band with the place, the avatar
// overlapping it, then name and score. First place gets the solid blue band.
function PodiumCard({ entry, rank, isYou }: { entry: Entry; rank: number; isYou: boolean }) {
  const country = countryName(entry.country_code);
  const first = rank === 1;
  return (
    <Link
      to={"/profile/" + entry.user_id}
      className={`flex min-w-0 flex-col overflow-hidden rounded-[26px] border bg-white text-center transition-colors hover:border-[#5286F6] ${first ? "border-[#5286F6]" : "border-borderGray"} ${isYou ? "ring-2 ring-[#5286F6] ring-offset-2" : ""}`}
    >
      <div className={`flex h-[52px] items-start justify-center pt-2.5 ${first ? "bg-[#5286F6] text-white" : "bg-[#EEF3FE] text-[#3F6FD8]"}`}>
        <span className="text-[12px] font-semibold">{first ? "1st place" : rank === 2 ? "2nd place" : "3rd place"}</span>
      </div>
      <div className="flex flex-1 flex-col items-center px-3 pb-4 sm:px-4 sm:pb-5">
        <span className="-mt-6 rounded-full bg-white p-1">
          <Avatar entry={entry} size={first ? 60 : 52} />
        </span>
        <span className="mt-2 max-w-full truncate text-[14px] font-semibold text-[#2F2F2F] sm:text-[15px]">{entry.full_name}</span>
        <span className="mt-0.5 hidden h-4 max-w-full truncate text-[12px] text-[#8A8A8A] sm:block">{country || ""}</span>
        <span className={`mt-2 text-[22px] font-semibold leading-7 tabular-nums sm:text-[26px] ${first ? "text-[#3F6FD8]" : "text-[#2F2F2F]"}`}>
          {entry.valueText}
        </span>
        <span className="text-[12px] text-[#8A8A8A]">{entry.unit}</span>
      </div>
    </Link>
  );
}

function LeaderRow({ entry, rank, top, isYou }: { entry: Entry; rank: number; top: number; isYou: boolean }) {
  const country = countryName(entry.country_code);
  const share = top > 0 ? Math.max(2, Math.min(100, (entry.value / top) * 100)) : 0;
  return (
    <Link
      to={"/profile/" + entry.user_id}
      className={`grid grid-cols-[32px_1fr_auto] items-center gap-3 rounded-[22px] px-3 py-2.5 transition-colors sm:grid-cols-[40px_1fr_auto] sm:gap-4 sm:px-4 ${isYou ? "bg-[#EEF3FE] ring-1 ring-[#D6E2FC]" : "hover:bg-[#F6F6F6]"}`}
    >
      <span className="text-center text-[15px] tabular-nums text-[#A3A3A3]">{rank}</span>
      <span className="flex min-w-0 items-center gap-3">
        <Avatar entry={entry} size={40} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium text-[#2F2F2F]">{entry.full_name}</span>
            {isYou ? (
              <span className="shrink-0 rounded-full bg-[#5286F6] px-2 py-0.5 text-[10px] font-semibold text-white">You</span>
            ) : null}
          </span>
          <span className="mt-1.5 flex items-center gap-2">
            <span className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-[#EEF3FE]" aria-hidden="true">
              <span className="block h-full rounded-full bg-[#5286F6]" style={{ width: `${share}%` }} />
            </span>
            {country ? <span className="hidden shrink-0 text-[12px] text-[#8A8A8A] sm:inline">{country}</span> : null}
          </span>
        </span>
      </span>
      <span className="text-right">
        <span className="block text-[16px] font-semibold tabular-nums text-[#2F2F2F]">
          {entry.valueText}
          <span className="ml-1 text-[12px] font-normal text-[#8A8A8A]">{entry.unit}</span>
        </span>
        <span className="mt-0.5 block text-[12px] text-[#8A8A8A]">{entry.detail}</span>
      </span>
    </Link>
  );
}

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("members");
  const [memberSort, setMemberSort] = useState<MemberSort>("sessions");
  const [hostSort, setHostSort] = useState<HostSort>("sessions");
  const [members, setMembers] = useState<UserRow[]>([]);
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [membersResult, hostsResult] = await Promise.all([
        supabase.rpc("community_user_leaderboard", { p_limit: 200 }),
        supabase.rpc("community_hosts", { p_limit: 200 }),
      ]);

      if (cancelled) return;

      if (membersResult.error) console.error("[leaderboard] members load failed", membersResult.error);
      if (hostsResult.error) console.error("[leaderboard] hosts load failed", hostsResult.error);

      setFailed(!!membersResult.error && !!hostsResult.error);
      setMembers((membersResult.data as UserRow[]) || []);
      setHosts((hostsResult.data as HostRow[]) || []);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => setShown(PAGE_SIZE), [tab, memberSort, hostSort]);

  const entries = useMemo<Entry[]>(() => {
    if (tab === "members") {
      const sorted = [...members].sort((a, b) =>
        memberSort === "hours"
          ? Number(b.focus_hours || 0) - Number(a.focus_hours || 0) || Number(b.sessions_count || 0) - Number(a.sessions_count || 0)
          : Number(b.sessions_count || 0) - Number(a.sessions_count || 0) || Number(b.focus_hours || 0) - Number(a.focus_hours || 0)
      );
      return sorted.map((row) => {
        const sessions = Number(row.sessions_count || 0);
        const hours = formatHours(row.focus_hours);
        return memberSort === "hours"
          ? {
              ...row,
              value: Number(row.focus_hours || 0),
              valueText: hours,
              unit: "h",
              detail: `${formatCount(sessions)} ${sessions === 1 ? "session" : "sessions"}`,
            }
          : {
              ...row,
              value: sessions,
              valueText: formatCount(sessions),
              unit: sessions === 1 ? "session" : "sessions",
              detail: `${hours} h focused`,
            };
      });
    }

    const sorted = [...hosts]
      .filter((row) => hostSort !== "focus" || row.focus_rate != null)
      .sort((a, b) =>
        hostSort === "focus"
          ? Number(b.focus_rate ?? -1) - Number(a.focus_rate ?? -1) || Number(b.focus_feedback_count || 0) - Number(a.focus_feedback_count || 0)
          : Number(b.hosted_sessions || 0) - Number(a.hosted_sessions || 0) || Number(b.focus_rate ?? -1) - Number(a.focus_rate ?? -1)
      );
    return sorted.map((row) => {
      const hosted = Number(row.hosted_sessions || 0);
      const ratings = Number(row.focus_feedback_count || 0);
      const rate = row.focus_rate == null ? null : Math.round(Number(row.focus_rate));
      return hostSort === "focus"
        ? {
            ...row,
            value: rate ?? 0,
            valueText: `${rate ?? 0}%`,
            unit: "focus",
            detail: `${formatCount(ratings)} ${ratings === 1 ? "rating" : "ratings"}`,
          }
        : {
            ...row,
            value: hosted,
            valueText: formatCount(hosted),
            unit: "hosted",
            detail: rate == null ? "No ratings yet" : `${rate}% focus`,
          };
    });
  }, [tab, members, hosts, memberSort, hostSort]);

  const summary = useMemo(() => {
    if (tab === "members") {
      const sessions = members.reduce((sum, row) => sum + (Number(row.sessions_count) || 0), 0);
      const hours = members.reduce((sum, row) => sum + (Number(row.focus_hours) || 0), 0);
      return [
        [formatCount(members.length), "members"],
        [formatCount(sessions), "sessions joined"],
        [formatCount(Math.round(hours)), "focus hours"],
      ];
    }
    const hosted = hosts.reduce((sum, row) => sum + (Number(row.hosted_sessions) || 0), 0);
    return [
      [formatCount(hosts.length), "hosts"],
      [formatCount(hosted), "sessions hosted"],
    ];
  }, [tab, members, hosts]);

  const top = entries[0]?.value ?? 0;
  // The top three get cards when there are at least three people to show.
  const podium = entries.length >= 3 ? entries.slice(0, 3) : [];
  const yourIndex = user?.id ? entries.findIndex((entry) => entry.user_id === user.id) : -1;
  const yourEntry = yourIndex >= 0 ? entries[yourIndex] : null;

  return (
    <main className="min-h-screen bg-white font-inter text-brandBlack">
      <div className="mx-auto w-full max-w-[820px] px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="text-center">
          <h1 className="text-[24px] font-normal leading-tight md:text-[28px] xl:text-[36px]">Leaderboard</h1>
          <p className="mx-auto mt-2 max-w-[480px] text-[15px] leading-6 text-[#606060]">
            The members who keep showing up, and the hosts who make room for them.
          </p>
          {!loading && !failed ? (
            <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[14px] text-[#606060]">
              {summary.map(([value, label]) => (
                <span key={label}><b className="font-semibold text-[#5286F6]">{value}</b> {label}</span>
              ))}
            </div>
          ) : null}
        </header>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Chips label="Leaderboard" value={tab} onChange={setTab} options={[["members", "Members"], ["hosts", "Hosts"]] as const} />
          {tab === "members" ? (
            <Segmented
              label="Rank members by"
              value={memberSort}
              onChange={setMemberSort}
              options={[["sessions", "Sessions"], ["hours", "Focus hours"]] as const}
            />
          ) : (
            <Segmented
              label="Rank hosts by"
              value={hostSort}
              onChange={setHostSort}
              options={[["sessions", "Sessions hosted"], ["focus", "Focus rate"]] as const}
            />
          )}
        </div>

        {yourEntry ? (
          <p className="mt-3 text-[13px] text-[#606060]">
            You're <span className="font-semibold text-[#3F6FD8]">#{yourIndex + 1}</span> with {yourEntry.valueText} {yourEntry.unit}
          </p>
        ) : null}

        <section className="mt-5">
          {loading ? (
            <div className="space-y-2" aria-label="Loading leaderboard">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="h-[64px] animate-pulse rounded-[22px] bg-[#F6F6F6]" />
              ))}
            </div>
          ) : failed ? (
            <div className="py-12 text-center text-[14px] text-[#606060]">The leaderboard could not be loaded. Please refresh the page.</div>
          ) : entries.length === 0 ? (
            <div className="py-12 text-center text-[14px] text-[#606060]">
              {tab === "hosts" && hostSort === "focus" ? "No host ratings yet." : "No activity yet."}
            </div>
          ) : (
            <div className="space-y-1">
              {podium.length ? (
                <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
                  {podium.map((entry, index) => (
                    <PodiumCard key={entry.user_id} entry={entry} rank={index + 1} isYou={entry.user_id === user?.id} />
                  ))}
                </div>
              ) : null}
              {entries.slice(podium.length, shown).map((entry, index) => (
                <LeaderRow
                  key={entry.user_id}
                  entry={entry}
                  rank={podium.length + index + 1}
                  top={top}
                  isYou={entry.user_id === user?.id}
                />
              ))}
              {yourEntry && yourIndex >= shown ? (
                <div className="border-t border-[#EEEEEE] pt-1">
                  <LeaderRow entry={yourEntry} rank={yourIndex + 1} top={top} isYou />
                </div>
              ) : null}
            </div>
          )}

          {!loading && entries.length > shown ? (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => setShown((value) => value + PAGE_SIZE)}
                className="h-11 rounded-full border border-borderGray px-6 text-[14px] font-medium transition-colors hover:border-[#5286F6] hover:text-[#3F6FD8]"
              >
                Show more
              </button>
            </div>
          ) : null}
        </section>

        {tab === "hosts" ? (
          <p className="mx-auto mt-8 max-w-[560px] text-center text-[12px] leading-5 text-[#8A8A8A]">
            Focus rate is the average focus score participants give themselves after a host's sessions. It describes the sessions, not the host as a person.
          </p>
        ) : null}
      </div>
    </main>
  );
}
