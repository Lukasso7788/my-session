import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { countryName, formatCount, formatHours } from "../lib/communityDisplay";
import CommunityAvatar from "../components/CommunityAvatar";
import { FoundingMemberBadge, SessionMilestoneBadge } from "../components/CommunityBadges";

type HostRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  country_code: string | null;
  hosted_sessions: number;
  attended_sessions?: number;
  focus_rate: number | null;
  focus_feedback_count: number;
  // Present once the founding-member migration is applied.
  is_founding_member?: boolean | null;
};

type UserRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  country_code: string | null;
  sessions_count: number;
  focus_hours: number;
  last_seen_at: string | null;
  is_founding_member?: boolean | null;
};

type Tab = "members" | "hosts";
type MemberSort = "sessions" | "hours";
type HostSort = "sessions" | "focus";

type Entry = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  country_code: string | null;
  is_founding_member?: boolean | null;
  // Sessions attended, for the milestone badge.
  attended: number;
  value: number;
  valueText: string;
  unit: string;
  detail: string;
};

const PAGE_SIZE = 50;

// Flat rank colors for the top three.
const PODIUM = [
  { label: "1st", fill: "#FFF3D6", ink: "#8A6100" },
  { label: "2nd", fill: "#F1F1F1", ink: "#4B4B4B" },
  { label: "3rd", fill: "#FBEBDD", ink: "#9A5527" },
] as const;

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
  label: string;
  size?: "md" | "lg";
}) {
  const large = size === "lg";
  return (
    <div
      className={large ? "inline-flex rounded-full border border-borderGray bg-white p-1.5" : "inline-flex rounded-full bg-[#F1F1F1] p-1"}
      role="group"
      aria-label={label}
    >
      {options.map(([option, text]) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={active}
            className={
              large
                ? `h-11 min-w-[128px] rounded-full px-6 text-[15px] transition-colors duration-200 ${active ? "bg-brandBlack text-white" : "text-brandBlack hover:bg-[#F6F6F6]"}`
                : `h-9 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors ${active ? "bg-white text-[#2F2F2F] shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-[#606060] hover:text-[#2F2F2F]"}`
            }
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

function Badges({ entry }: { entry: Entry }) {
  return (
    <>
      {entry.is_founding_member ? <FoundingMemberBadge compact /> : null}
      <SessionMilestoneBadge sessions={entry.attended} compact />
    </>
  );
}

function PodiumCard({ entry, rank, isYou }: { entry: Entry; rank: number; isYou: boolean }) {
  const podium = PODIUM[rank - 1];
  const country = countryName(entry.country_code);
  return (
    <Link
      to={"/profile/" + entry.user_id}
      className={`flex min-w-0 flex-col items-center rounded-[26px] border bg-white px-3 pb-4 pt-4 text-center transition-colors hover:border-[#A3A3A3] sm:px-5 sm:pb-5 ${rank === 1 ? "border-[#2F2F2F]" : "border-borderGray"} ${isYou ? "ring-2 ring-[#65D46C] ring-offset-2" : ""}`}
    >
      <span
        className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
        style={{ backgroundColor: podium.fill, color: podium.ink }}
      >
        {podium.label}
      </span>
      <span className="mt-3">
        <CommunityAvatar userId={entry.user_id} name={entry.full_name} url={entry.avatar_url} size={rank === 1 ? 64 : 56} />
      </span>
      <span className="mt-3 flex max-w-full items-center justify-center gap-1">
        <span className="truncate text-[14px] font-semibold text-[#2F2F2F] sm:text-[15px]">{entry.full_name}</span>
        <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
          <Badges entry={entry} />
        </span>
      </span>
      <span className="mt-0.5 hidden h-4 truncate text-[12px] text-[#8A8A8A] sm:block">{country || ""}</span>
      <span className="mt-2 text-[20px] font-semibold leading-6 tabular-nums text-[#2F2F2F] sm:text-[24px] sm:leading-7">
        {entry.valueText}
      </span>
      <span className="text-[12px] text-[#8A8A8A]">{entry.unit}</span>
    </Link>
  );
}

function LeaderRow({ entry, rank, top, isYou }: { entry: Entry; rank: number; top: number; isYou: boolean }) {
  const country = countryName(entry.country_code);
  const share = top > 0 ? Math.max(2, Math.min(100, (entry.value / top) * 100)) : 0;
  return (
    <Link
      to={"/profile/" + entry.user_id}
      className={`grid grid-cols-[32px_1fr_auto] items-center gap-3 rounded-[22px] px-3 py-3 transition-colors sm:grid-cols-[40px_1fr_auto] sm:gap-4 sm:px-4 ${isYou ? "bg-[#F6F6F6] ring-1 ring-borderGray" : "hover:bg-[#F6F6F6]"}`}
    >
      <span className={`text-center text-[15px] tabular-nums ${rank <= 3 ? "font-semibold text-[#2F2F2F]" : "text-[#A3A3A3]"}`}>
        {rank}
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <CommunityAvatar userId={entry.user_id} name={entry.full_name} url={entry.avatar_url} size={40} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-medium text-[#2F2F2F]">{entry.full_name}</span>
            <Badges entry={entry} />
            {isYou ? (
              <span className="shrink-0 rounded-full bg-brandBlack px-2 py-0.5 text-[10px] font-semibold text-white">You</span>
            ) : null}
          </span>
          <span className="mt-1.5 flex items-center gap-2">
            <span className="h-1 w-full max-w-[220px] overflow-hidden rounded-full bg-[#EEEEEE]" aria-hidden="true">
              <span className="block h-full rounded-full bg-brandBlack" style={{ width: `${share}%` }} />
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
              attended: sessions,
              value: Number(row.focus_hours || 0),
              valueText: hours,
              unit: "h",
              detail: `${formatCount(sessions)} ${sessions === 1 ? "session" : "sessions"}`,
            }
          : {
              ...row,
              attended: sessions,
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
      const attended = Number(row.attended_sessions || 0);
      return hostSort === "focus"
        ? {
            ...row,
            attended,
            value: rate ?? 0,
            valueText: `${rate ?? 0}%`,
            unit: "focus",
            detail: `${formatCount(ratings)} ${ratings === 1 ? "rating" : "ratings"}`,
          }
        : {
            ...row,
            attended,
            value: hosted,
            valueText: formatCount(hosted),
            unit: "hosted",
            detail: rate == null ? "No ratings yet" : `${rate}% focus`,
          };
    });
  }, [tab, members, hosts, memberSort, hostSort]);

  const top = entries[0]?.value ?? 0;
  // The top three get cards when there are at least three people to show.
  const podium = entries.length >= 3 ? entries.slice(0, 3) : [];
  const yourIndex = user?.id ? entries.findIndex((entry) => entry.user_id === user.id) : -1;
  const yourEntry = yourIndex >= 0 ? entries[yourIndex] : null;

  return (
    <main className="min-h-screen bg-white font-inter text-brandBlack">
      <div className="mx-auto w-full max-w-[820px] px-4 pb-16 pt-14 md:px-6 md:pt-[72px]">
        <header className="text-center">
          <h1 className="text-[24px] font-normal leading-tight md:text-[28px] xl:text-[36px]">Leaderboard</h1>
          <p className="mx-auto mt-3 max-w-[480px] text-[15px] leading-6 text-[#606060]">
            The members who keep showing up, and the hosts who make room for them.
          </p>
        </header>

        <div className="mt-10 flex justify-center">
          <Segmented
            size="lg"
            label="Leaderboard"
            value={tab}
            onChange={setTab}
            options={[["members", "Members"], ["hosts", "Hosts"]] as const}
          />
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
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

          {yourEntry ? (
            <span className="text-[13px] text-[#606060]">
              You're <span className="font-semibold text-[#2F2F2F]">#{yourIndex + 1}</span> with {yourEntry.valueText} {yourEntry.unit}
            </span>
          ) : tab === "hosts" ? (
            <Link to="/hosts" className="text-[13px] font-medium text-[#2F2F2F] underline-offset-4 hover:underline">
              Browse all hosts
            </Link>
          ) : null}
        </div>

        <section className="mt-4">
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
                <div className="mb-4 grid grid-cols-3 items-end gap-2 sm:gap-3">
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
                className="h-11 rounded-full border border-borderGray px-6 text-[14px] font-medium transition-colors hover:border-[#A3A3A3] hover:bg-[#F6F6F6]"
              >
                Show more
              </button>
            </div>
          ) : null}
        </section>

        {!loading && !failed ? (
          <div className="mx-auto mt-10 max-w-[560px] rounded-[22px] border border-[#EEEEEE] px-5 py-4">
            <div className="text-[13px] font-medium text-[#2F2F2F]">Badges</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <FoundingMemberBadge />
              {[10, 25, 50, 100, 250, 500, 1000].map((threshold) => (
                <SessionMilestoneBadge key={threshold} sessions={threshold} />
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-5 text-[#8A8A8A]">
              Session badges count the sessions a person has joined; each person shows their highest one.
            </p>
          </div>
        ) : null}

        {tab === "hosts" ? (
          <p className="mx-auto mt-6 max-w-[560px] text-center text-[12px] leading-5 text-[#8A8A8A]">
            Focus rate is the average focus score participants give themselves after a host's sessions. It describes the sessions, not the host as a person.
          </p>
        ) : null}
      </div>
    </main>
  );
}
