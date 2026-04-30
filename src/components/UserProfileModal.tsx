import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "../lib/supabase";

type UserProfileModalProps = {
  user: {
    id: string;
    full_name?: string | null;
    bio?: string | null;
    avatar_url?: string | null;
    created_at?: string | null;
    attended_sessions_count?: number | null;
  } | null;
  onClose: () => void;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string | null;
  attended_sessions_count: number | null;
};

type SessionRow = {
  id: string;
  title: string | null;
  start_time: string | null;
  created_at: string | null;
  schedule: any;
};

function formatShortDate(raw?: string | null) {
  if (!raw) return "—";

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function formatSince(raw?: string | null) {
  if (!raw) return "—";
  return formatShortDate(raw);
}

function getSessionDurationMinutes(session: SessionRow) {
  const schedule = session.schedule;

  try {
    const parsed =
      typeof schedule === "string" ? JSON.parse(schedule) : schedule;

    if (Array.isArray(parsed)) {
      return parsed.reduce((sum: number, block: any) => {
        return sum + (Number(block?.minutes || block?.duration_minutes || 0) || 0);
      }, 0);
    }

    if (Array.isArray(parsed?.blocks)) {
      return parsed.blocks.reduce((sum: number, block: any) => {
        return sum + (Number(block?.minutes || block?.duration_minutes || 0) || 0);
      }, 0);
    }

    if (Array.isArray(parsed?.schedule)) {
      return parsed.schedule.reduce((sum: number, block: any) => {
        return sum + (Number(block?.minutes || block?.duration_minutes || 0) || 0);
      }, 0);
    }
  } catch {
    // ignore bad legacy schedule
  }

  return 0;
}

function getSessionStatus(session: SessionRow) {
  if (!session.start_time) return "Upcoming";

  const now = Date.now();
  const start = new Date(session.start_time).getTime();

  if (!Number.isFinite(start)) return "Upcoming";

  const durationMinutes = getSessionDurationMinutes(session);
  const end = start + Math.max(1, durationMinutes) * 60 * 1000;

  if (now < start) return "Upcoming";
  if (now >= start && now <= end) return "Live";
  return "Finished";
}

function getBadgeClass(status: string) {
  switch (status) {
    case "Upcoming":
      return "bg-[#DBEAFE] text-[#1D4ED8]";
    case "Live":
      return "bg-[#DCFCE7] text-[#15803D]";
    case "Finished":
      return "bg-[#E5E7EB] text-[#374151]";
    default:
      return "bg-[#E5E7EB] text-[#374151]";
  }
}

function getDisplaySessions(sessions: SessionRow[]) {
  const now = Date.now();

  const currentAndUpcoming = sessions
    .filter((s) => {
      if (!s.start_time) return true;

      const start = new Date(s.start_time).getTime();
      if (!Number.isFinite(start)) return true;

      const durationMinutes = getSessionDurationMinutes(s);
      const end = start + Math.max(1, durationMinutes) * 60 * 1000;

      return end >= now;
    })
    .sort((a, b) => {
      const aStart = a.start_time ? new Date(a.start_time).getTime() : 0;
      const bStart = b.start_time ? new Date(b.start_time).getTime() : 0;
      return aStart - bStart;
    });

  return currentAndUpcoming.slice(0, 1);
}

function getAvatarFallback(name: string) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "User")}`;
}

export function UserProfileModal({ user, onClose }: UserProfileModalProps) {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [followersCount, setFollowersCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const userId = String(user?.id || "").trim();

  const displayName = useMemo(() => {
    return String(profile?.full_name || user?.full_name || "").trim() || "User";
  }, [profile?.full_name, user?.full_name]);

  const bio = useMemo(() => {
    return String(profile?.bio || user?.bio || "").trim();
  }, [profile?.bio, user?.bio]);

  const avatarUrl = useMemo(() => {
    return (
      String(profile?.avatar_url || user?.avatar_url || "").trim() ||
      getAvatarFallback(displayName)
    );
  }, [profile?.avatar_url, user?.avatar_url, displayName]);

  const createdAt = useMemo(() => {
    return profile?.created_at || user?.created_at || null;
  }, [profile?.created_at, user?.created_at]);

  const attendedCount = useMemo(() => {
    const raw =
      typeof profile?.attended_sessions_count === "number"
        ? profile.attended_sessions_count
        : typeof user?.attended_sessions_count === "number"
          ? user.attended_sessions_count
          : 0;

    return Math.max(0, Number(raw || 0));
  }, [profile?.attended_sessions_count, user?.attended_sessions_count]);

  const displaySessions = useMemo(() => getDisplaySessions(sessions), [sessions]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);

      try {
        const now = new Date();

        // Берём чуть с запасом назад, чтобы live-сессия, которая уже началась,
        // тоже могла попасть в Current & upcoming.
        const currentWindowStart = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();

        const [profileRes, sessionsRes, followersRes] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, bio, avatar_url, created_at, attended_sessions_count")
            .eq("id", userId)
            .single(),

          supabase
            .from("sessions")
            .select("id, title, start_time, created_at, schedule")
            .eq("host_id", userId)
            .gte("start_time", currentWindowStart)
            .order("start_time", { ascending: true })
            .limit(3),

          supabase
            .from("host_followers")
            .select("id", { count: "exact", head: true })
            .eq("host_user_id", userId),
        ]);

        if (cancelled) return;

        if (!profileRes.error && profileRes.data) {
          setProfile(profileRes.data as ProfileRow);
        } else {
          setProfile(null);
        }

        if (!sessionsRes.error && sessionsRes.data) {
          setSessions((sessionsRes.data || []) as SessionRow[]);
        } else {
          setSessions([]);
        }

        if (!followersRes.error) {
          setFollowersCount(followersRes.count || 0);
        } else {
          setFollowersCount(0);
        }
      } catch (e) {
        console.warn("[UserProfileModal] load failed:", e);

        if (!cancelled) {
          setProfile(null);
          setSessions([]);
          setFollowersCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!user || !userId) return null;

  const openFullProfile = () => {
    window.open(`/profile/${userId}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-black/50 px-4 py-6"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="
          relative w-[400px] max-w-[calc(100vw-32px)]
          rounded-[22px] bg-white px-6 pb-6 pt-6
          text-[#2F2F2F] shadow-[0_24px_80px_rgba(0,0,0,0.28)]
        "
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="
            absolute right-6 top-6
            flex h-8 w-8 items-center justify-center
            rounded-full text-[#6B7280]
            transition hover:bg-black/5 hover:text-[#2F2F2F]
          "
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          <X size={22} strokeWidth={2.1} />
        </button>

        <div className="flex flex-col items-center">
          <img
            src={avatarUrl}
            alt={displayName}
            className="
              h-[86px] w-[86px]
              rounded-full border border-black/10
              object-cover shadow-sm
            "
            referrerPolicy="no-referrer"
            draggable={false}
          />

          <h2 className="mt-3 max-w-[280px] truncate text-center text-[22px] font-bold leading-tight text-[#2F2F2F]">
            {displayName}
          </h2>

          <div className="mt-2 flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-[#3F3F3F]">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <img
                src="/icons/session_count.svg"
                alt=""
                className="h-[15px] w-[15px] opacity-70"
                draggable={false}
              />
              <span>{attendedCount} sessions</span>
            </span>

            <span className="h-4 w-px bg-[#CAC3C3]" />

            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <img
                src="/icons/followers_profile.svg"
                alt=""
                className="h-[15px] w-[15px] opacity-70"
                draggable={false}
              />
              <span>{followersCount} Followers</span>
            </span>

            <span className="h-4 w-px bg-[#CAC3C3]" />

            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <img
                src="/icons/date_profile.svg"
                alt=""
                className="h-[15px] w-[15px] opacity-70"
                draggable={false}
              />
              <span>Since {formatSince(createdAt)}</span>
            </span>
          </div>

          {bio ? (
            <p className="mt-4 max-h-[72px] w-full overflow-y-auto text-center text-[13px] leading-5 text-[#555]">
              {bio}
            </p>
          ) : null}
        </div>

        <div className="mt-9">
          <h3 className="text-[15px] font-bold text-[#2F2F2F]">
            Current & upcoming sessions:
          </h3>

          <div className="mt-2">
            {loading ? (
              <div className="flex h-[42px] items-center justify-center rounded-[7px] bg-[#F7F7F7] px-4 text-[13px] text-[#8A8A8A]">
                Loading sessions...
              </div>
            ) : displaySessions.length > 0 ? (
              displaySessions.map((s) => {
                const status = getSessionStatus(s);

                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      window.open(`/room-livekit/${s.id}`, "_blank", "noopener,noreferrer");
                    }}
                    className="
                      grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3
                      rounded-[7px] bg-[#F7F7F7] px-4 py-2
                      text-left transition hover:bg-[#EFEFEF]
                    "
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/70">
                        <span
                          className={
                            "h-2 w-2 rounded-full " +
                            (status === "Live"
                              ? "bg-[#65D46C]"
                              : status === "Upcoming"
                                ? "bg-[#5286F6]"
                                : "bg-[#CAC3C3]")
                          }
                        />
                      </span>

                      <span className="min-w-0 text-[14px] leading-[18px] text-[#2F2F2F]">
                        <span className="line-clamp-2">
                          {s.title || "Untitled session"}
                        </span>
                      </span>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[13px] leading-none text-[#3F3F3F]">
                        {formatShortDate(s.start_time || s.created_at)}
                      </span>

                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-[10px] leading-none " +
                          getBadgeClass(status)
                        }
                      >
                        {status}
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-[7px] bg-[#F7F7F7] px-4 py-3 text-center text-[13px] text-[#8A8A8A]">
                No upcoming sessions yet.
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={openFullProfile}
          className="
            mt-5 flex h-[49px] w-full items-center justify-center
            rounded-full bg-[#2F2F2F]
            text-[15px] font-semibold text-white
            transition hover:bg-black
          "
        >
          See full profile
        </button>
      </div>
    </div>
  );
}