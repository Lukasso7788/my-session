import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays, Search, Star, Users } from "lucide-react";
import { supabase } from "../lib/supabase";

type HostRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  country_code: string | null;
  hosted_sessions: number;
  focus_rate: number | null;
  focus_feedback_count: number;
  last_hosted_at: string | null;
  next_session_id: string | null;
  next_session_title: string | null;
  next_session_start: string | null;
};

function initials(name: string) {
  return String(name || "M").trim().slice(0, 1).toUpperCase() || "M";
}

function formatNext(value: string | null) {
  if (!value) return "Nothing scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Nothing scheduled";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function HostsPage() {
  const navigate = useNavigate();
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("community_hosts", { p_limit: 180 });
      if (cancelled) return;
      if (error) {
        console.error("[hosts] load failed", error);
        setHosts([]);
      } else {
        setHosts((data as HostRow[]) || []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return hosts;
    return hosts.filter((host) =>
      [host.full_name, host.bio, host.country_code]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [hosts, query]);

  const featured = filtered.slice(0, 3);

  return (
    <main className="min-h-screen bg-[#FBFAF7] px-5 py-10 text-[#2F2F2F] sm:px-8">
      <div className="mx-auto max-w-6xl">
        <section className="overflow-hidden rounded-[32px] border border-black/[0.07] bg-white">
          <div className="grid gap-8 p-7 md:grid-cols-[1.35fr_0.65fr] md:p-10">
            <div>
              <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#8B6A4F]">Community hosts</div>
              <h1 className="mt-3 max-w-2xl text-[40px] font-bold leading-[0.98] tracking-[-0.05em] sm:text-[58px]">
                Meet the people who keep MySession moving.
              </h1>
              <p className="mt-5 max-w-2xl text-[16px] leading-7 text-[#6D6964]">
                Browse hosts by activity, focus feedback and what they have coming up next.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/sessions")}
                  className="rounded-full bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white"
                >
                  Join a session
                </button>
                <Link
                  to="/leaderboard"
                  className="rounded-full border border-black/10 bg-[#F5F2EC] px-5 py-3 text-[14px] font-semibold"
                >
                  View leaderboard
                </Link>
              </div>
            </div>

            <div className="rounded-[26px] bg-[#F3EEE6] p-5">
              <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#817668]">Host pulse</div>
              <div className="mt-4 grid gap-2">
                {featured.map((host, index) => (
                  <button
                    key={host.user_id}
                    onClick={() => navigate("/profile/" + host.user_id)}
                    className="flex items-center gap-3 rounded-2xl bg-white p-3 text-left"
                  >
                    <span className="text-[11px] font-bold text-[#A08C79]">#{index + 1}</span>
                    {host.avatar_url ? (
                      <img src={host.avatar_url} className="h-9 w-9 rounded-full object-cover" alt="" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#D8C1A8] font-bold">{initials(host.full_name)}</span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold">{host.full_name}</span>
                      <span className="block text-[11px] text-[#766F69]">{host.hosted_sessions} sessions</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[25px] font-bold tracking-[-0.03em]">All hosts</h2>
            <p className="mt-1 text-[13px] text-[#77716B]">{loading ? "Loading…" : filtered.length + " active hosts"}</p>
          </div>
          <label className="flex w-full items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-3 sm:w-[330px]">
            <Search className="h-4 w-4 text-[#8A827A]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search hosts…"
              className="w-full bg-transparent text-[13px] outline-none"
            />
          </label>
        </div>

        <section className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((host) => (
            <article key={host.user_id} className="group rounded-[24px] border border-black/[0.07] bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-[0_12px_35px_rgba(48,42,36,0.08)]">
              <button onClick={() => navigate("/profile/" + host.user_id)} className="w-full text-left">
                <div className="flex items-start gap-4">
                  {host.avatar_url ? (
                    <img src={host.avatar_url} className="h-14 w-14 rounded-2xl object-cover" alt="" />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EFE7DC] text-[18px] font-bold">{initials(host.full_name)}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-bold">{host.full_name}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[#726A63]">
                      {host.country_code ? <span>{host.country_code}</span> : null}
                      <span>{host.hosted_sessions} hosted</span>
                    </div>
                  </div>
                </div>

                <p className="mt-4 min-h-[44px] line-clamp-2 text-[13px] leading-[1.65] text-[#6F6963]">
                  {host.bio || "Shows up, hosts sessions, and helps keep the room moving."}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-[#F6F3EF] p-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#8C8177]">
                      <Users className="h-3.5 w-3.5" /> Sessions
                    </div>
                    <div className="mt-1 text-[19px] font-bold">{host.hosted_sessions}</div>
                  </div>
                  <div className="rounded-2xl bg-[#F0F7F1] p-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#68806C]">
                      <Star className="h-3.5 w-3.5" /> Focus rate
                    </div>
                    <div className="mt-1 text-[19px] font-bold">
                      {host.focus_rate == null ? "—" : Math.round(host.focus_rate) + "%"}
                    </div>
                  </div>
                </div>
              </button>

              <div className="mt-4 border-t border-black/[0.06] pt-4">
                <div className="flex items-start gap-2 text-[12px] text-[#77706A]">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-semibold text-[#4A4642]">{formatNext(host.next_session_start)}</div>
                    {host.next_session_title ? <div className="mt-0.5 line-clamp-1">{host.next_session_title}</div> : null}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
