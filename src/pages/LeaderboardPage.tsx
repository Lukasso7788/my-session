import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock3, Medal, Star, Trophy, Users } from "lucide-react";
import { supabase } from "../lib/supabase";

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

function initials(name: string) {
  return String(name || "M").trim().slice(0, 1).toUpperCase() || "M";
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  return url ? (
    <img src={url} className="h-11 w-11 rounded-full object-cover" alt="" />
  ) : (
    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#E9E4DB] text-[14px] font-bold">
      {initials(name)}
    </div>
  );
}

function RankMark({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FFF3C8] text-[#8B6509]">
        <Medal className="h-4 w-4" />
      </span>
    );
  }
  return <span className="w-8 text-center text-[13px] font-bold text-[#8A847D]">{rank}</span>;
}

export default function LeaderboardPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("members");
  const [memberSort, setMemberSort] = useState<MemberSort>("sessions");
  const [hostSort, setHostSort] = useState<HostSort>("sessions");
  const [members, setMembers] = useState<UserRow[]>([]);
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [loading, setLoading] = useState(true);

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

      setMembers((membersResult.data as UserRow[]) || []);
      setHosts((hostsResult.data as HostRow[]) || []);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) =>
      memberSort === "hours"
        ? Number(b.focus_hours || 0) - Number(a.focus_hours || 0) || Number(b.sessions_count || 0) - Number(a.sessions_count || 0)
        : Number(b.sessions_count || 0) - Number(a.sessions_count || 0) || Number(b.focus_hours || 0) - Number(a.focus_hours || 0)
    );
  }, [members, memberSort]);

  const sortedHosts = useMemo(() => {
    return [...hosts].sort((a, b) =>
      hostSort === "focus"
        ? Number(b.focus_rate ?? -1) - Number(a.focus_rate ?? -1) || Number(b.focus_feedback_count || 0) - Number(a.focus_feedback_count || 0)
        : Number(b.hosted_sessions || 0) - Number(a.hosted_sessions || 0) || Number(b.focus_rate ?? -1) - Number(a.focus_rate ?? -1)
    );
  }, [hosts, hostSort]);

  const rows = tab === "members" ? sortedMembers : sortedHosts;

  return (
    <main className="min-h-screen bg-[#FBFAF7] px-5 py-10 text-[#2F2F2F] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <section className="rounded-[32px] bg-[#2F2F2F] p-7 text-white sm:p-10">
          <div className="flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-white/55">
                <Trophy className="h-4 w-4" /> Community leaderboard
              </div>
              <h1 className="mt-3 text-[42px] font-bold tracking-[-0.05em] sm:text-[58px]">Showing up counts.</h1>
              <p className="mt-3 max-w-xl text-[15px] leading-7 text-white/65">
                A simple view of the people doing the work and the hosts creating the space for it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/hosts")}
              className="rounded-full bg-white px-5 py-3 text-[13px] font-bold text-[#2F2F2F]"
            >
              Meet the hosts
            </button>
          </div>
        </section>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-full bg-[#EEEAE3] p-1">
            <button
              type="button"
              onClick={() => setTab("members")}
              className={(tab === "members" ? "bg-white shadow-sm " : "") + "rounded-full px-5 py-2.5 text-[13px] font-bold transition"}
            >
              Members
            </button>
            <button
              type="button"
              onClick={() => setTab("hosts")}
              className={(tab === "hosts" ? "bg-white shadow-sm " : "") + "rounded-full px-5 py-2.5 text-[13px] font-bold transition"}
            >
              Hosts
            </button>
          </div>

          {tab === "members" ? (
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-[#77716B]">Rank by</span>
              <button onClick={() => setMemberSort("sessions")} className={(memberSort === "sessions" ? "bg-[#2F2F2F] text-white " : "bg-white ") + "rounded-full border border-black/[0.07] px-3 py-2 font-semibold"}>
                Sessions
              </button>
              <button onClick={() => setMemberSort("hours")} className={(memberSort === "hours" ? "bg-[#2F2F2F] text-white " : "bg-white ") + "rounded-full border border-black/[0.07] px-3 py-2 font-semibold"}>
                Hours
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-[#77716B]">Rank by</span>
              <button onClick={() => setHostSort("sessions")} className={(hostSort === "sessions" ? "bg-[#2F2F2F] text-white " : "bg-white ") + "rounded-full border border-black/[0.07] px-3 py-2 font-semibold"}>
                Sessions
              </button>
              <button onClick={() => setHostSort("focus")} className={(hostSort === "focus" ? "bg-[#2F2F2F] text-white " : "bg-white ") + "rounded-full border border-black/[0.07] px-3 py-2 font-semibold"}>
                Focus rate
              </button>
            </div>
          )}
        </div>

        <section className="mt-4 overflow-hidden rounded-[26px] border border-black/[0.07] bg-white">
          <div className="grid grid-cols-[50px_1fr_auto] items-center gap-3 border-b border-black/[0.06] bg-[#F5F2ED] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[#827A72] sm:grid-cols-[60px_1fr_160px_160px]">
            <span>Rank</span>
            <span>{tab === "members" ? "Member" : "Host"}</span>
            <span className="hidden text-right sm:block">{tab === "members" ? "Sessions" : "Hosted"}</span>
            <span className="text-right">{tab === "members" ? "Focus hours" : "Focus rate"}</span>
          </div>

          {loading ? (
            <div className="p-10 text-center text-[14px] text-[#77716B]">Loading leaderboard…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-[14px] text-[#77716B]">No activity yet.</div>
          ) : (
            rows.slice(0, 100).map((row, index) => {
              const isMember = tab === "members";
              const member = row as UserRow;
              const host = row as HostRow;
              const name = row.full_name;
              const avatar = row.avatar_url;
              const country = row.country_code;

              return (
                <button
                  key={row.user_id}
                  type="button"
                  onClick={() => navigate("/profile/" + row.user_id)}
                  className="grid w-full grid-cols-[50px_1fr_auto] items-center gap-3 border-b border-black/[0.055] px-4 py-4 text-left transition last:border-b-0 hover:bg-[#FCFBF8] sm:grid-cols-[60px_1fr_160px_160px]"
                >
                  <RankMark rank={index + 1} />
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={name} url={avatar} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-bold">{name}</span>
                      <span className="mt-0.5 block text-[11px] text-[#8B847D]">{country || "Global member"}</span>
                    </span>
                  </span>

                  <span className="hidden text-right sm:block">
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-bold">
                      <Users className="h-3.5 w-3.5 text-[#8A847D]" />
                      {isMember ? member.sessions_count : host.hosted_sessions}
                    </span>
                  </span>

                  <span className="text-right">
                    {isMember ? (
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-bold">
                        <Clock3 className="h-3.5 w-3.5 text-[#8A847D]" />
                        {Number(member.focus_hours || 0).toFixed(1)}h
                      </span>
                    ) : (
                      <span>
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-bold">
                          <Star className="h-3.5 w-3.5 text-[#6E8A73]" />
                          {host.focus_rate == null ? "—" : Math.round(host.focus_rate) + "%"}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-[#9A938B]">
                          {host.focus_feedback_count || 0} ratings
                        </span>
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </section>

        <p className="mx-auto mt-5 max-w-2xl text-center text-[11px] leading-5 text-[#8A847D]">
          Focus rate is the average self-reported focus score submitted by participants after a host’s sessions. It is not a rating of the host as a person.
        </p>
      </div>
    </main>
  );
}
