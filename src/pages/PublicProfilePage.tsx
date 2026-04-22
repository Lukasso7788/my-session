import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type PublicProfileRow = {
  id: string;
  full_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string | null;
  attended_sessions_count: number | null;
};

type HostedSessionRow = {
  id: string;
  title: string;
  start_time: string | null;
  schedule: any | null;
  created_at: string;
};

export default function PublicProfilePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string>("—");
  const [attendedCount, setAttendedCount] = useState<number>(0);

  const [sessions, setSessions] = useState<HostedSessionRow[]>([]);
  const [notFound, setNotFound] = useState(false);

  const [followLoading, setFollowLoading] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);

  const displayName = useMemo(() => fullName || "User", [fullName]);

  const avatarFallback = useMemo(() => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`;
  }, [displayName]);

  const isOwnProfile = !!currentUserId && !!id && currentUserId === id;
  const hasHostedSessions = sessions.length > 0;

  const nextSession = useMemo(() => {
    const now = Date.now();

    const sorted = [...sessions]
      .filter((s) => {
        const start = s.start_time ? new Date(s.start_time).getTime() : 0;
        return Number.isFinite(start) && start > now;
      })
      .sort((a, b) => {
        const aStart = a.start_time ? new Date(a.start_time).getTime() : 0;
        const bStart = b.start_time ? new Date(b.start_time).getTime() : 0;
        return aStart - bStart;
      });

    return sorted[0] || null;
  }, [sessions]);

  const formatSince = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
    }).format(d);
  };

  const getSessionStatus = (session: HostedSessionRow) => {
    if (!session.start_time) return null;

    const now = Date.now();
    const start = new Date(session.start_time).getTime();

    let durationMinutes = 0;

    if (session.schedule) {
      try {
        const parsed =
          typeof session.schedule === "string"
            ? JSON.parse(session.schedule)
            : session.schedule;

        durationMinutes = (parsed || []).reduce(
          (sum: number, block: any) => sum + (block?.minutes || 0),
          0
        );
      } catch { }
    }

    const end = start + durationMinutes * 60 * 1000;

    if (now < start) return "Upcoming";
    if (now >= start && now <= end) return "Live";
    return "Finished";
  };

  const getBadgeClass = (status: string) => {
    switch (status) {
      case "Upcoming":
        return "px-2 py-0.5 text-[11px] rounded-full bg-[#DBEAFE] text-[#1D4ED8]";
      case "Live":
        return "px-2 py-0.5 text-[11px] rounded-full bg-[#DCFCE7] text-[#15803D]";
      case "Finished":
        return "px-2 py-0.5 text-[11px] rounded-full bg-[#E5E7EB] text-[#374151]";
      default:
        return "";
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadAuth = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!cancelled) {
          setCurrentUserId(String(data?.user?.id || ""));
          setAuthReady(true);
        }
      } catch {
        if (!cancelled) {
          setCurrentUserId("");
          setAuthReady(true);
        }
      }
    };

    loadAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!id) return;

      setLoading(true);
      setNotFound(false);

      try {
        const [{ data: p, error: pErr }, { data: s, error: sErr }] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, bio, avatar_url, created_at, attended_sessions_count")
            .eq("id", id)
            .single(),
          supabase
            .from("sessions")
            .select("id, title, start_time, schedule, created_at")
            .eq("host_id", id)
            .order("created_at", { ascending: false }),
        ]);

        if (pErr || !p) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        const profile = p as PublicProfileRow;

        setFullName(profile.full_name || "");
        setBio(profile.bio || "");
        setAvatarUrl(profile.avatar_url || null);

        if (typeof profile.attended_sessions_count === "number") {
          setAttendedCount(profile.attended_sessions_count);
        } else {
          setAttendedCount(0);
        }

        if (profile.created_at) setCreatedAt(formatSince(profile.created_at));
        else setCreatedAt("—");

        if (sErr) setSessions([]);
        else setSessions((s as any) || []);
      } catch (e) {
        console.error("Public profile fetch error:", e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    const loadFollowState = async () => {
      if (!authReady || !currentUserId || !id || currentUserId === id) {
        setIsFollowing(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("host_followers")
          .select("id")
          .eq("host_user_id", id)
          .eq("follower_user_id", currentUserId)
          .limit(1);

        if (error) {
          console.warn("Failed to load follow state:", error);
          if (!cancelled) setIsFollowing(false);
          return;
        }

        if (!cancelled) {
          setIsFollowing(Array.isArray(data) && data.length > 0);
        }
      } catch (e) {
        console.warn("Failed to load follow state:", e);
        if (!cancelled) setIsFollowing(false);
      }
    };

    loadFollowState();

    return () => {
      cancelled = true;
    };
  }, [authReady, currentUserId, id]);

  const handleToggleFollow = async () => {
    if (!id) return;

    if (!currentUserId) {
      navigate("/login", { replace: false });
      return;
    }

    if (currentUserId === id) return;

    setFollowLoading(true);

    try {
      if (isFollowing) {
        const { error } = await supabase
          .from("host_followers")
          .delete()
          .eq("host_user_id", id)
          .eq("follower_user_id", currentUserId);

        if (error) throw error;

        setIsFollowing(false);
      } else {
        const { error } = await supabase.from("host_followers").insert({
          host_user_id: id,
          follower_user_id: currentUserId,
        });

        if (error) throw error;

        setIsFollowing(true);
      }
    } catch (e) {
      console.error("Follow toggle failed:", e);
      alert("Follow system is not fully wired yet. We’ll finish the backend next.");
    } finally {
      setFollowLoading(false);
    }
  };

  const handleSupportHost = () => {
    if (!hasHostedSessions || isOwnProfile) return;
    alert("Tip host checkout comes next.");
  };

  if (loading) {
    return (
      <div className="flex justify-center pt-20 bg-white min-h-screen">
        <div className="animate-spin h-8 w-8 rounded-full border-b-2 border-black" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6 font-inter text-[#2F2F2F]">
        <div className="text-center">
          <p className="text-lg font-medium mb-3">User not found.</p>
          <button
            onClick={() => navigate("/sessions")}
            className="text-[#2F2F2F] underline underline-offset-4 text-sm hover:opacity-80"
          >
            Back to sessions
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="w-full px-8 pt-10 pb-24 font-inter text-gray-900 bg-white min-h-screen">
      <div className="flex items-center justify-between mb-10">
        <button
          onClick={() => navigate(-1)}
          className="text-[16px] text-[#2F2F2F] hover:text-black flex items-center gap-2"
        >
          ← Back
        </button>

        <div className="text-[14px] text-[#2F2F2F] opacity-70">Public profile</div>
      </div>

      <div className="flex flex-col items-center">
        <div className="relative">
          <img
            src={avatarUrl || avatarFallback}
            className="w-28 h-28 rounded-full object-cover border border-gray-200 shadow-sm"
            alt="avatar"
          />
        </div>

        <h1 className="font-inter font-bold text-[32px] text-[#2F2F2F] mt-4">
          {displayName}
        </h1>

        <div className="flex items-center gap-6 mt-2 text-sm">
          <span className="flex items-center gap-2">
            <img src="/icons/date_profile.svg" alt="Account creation date" className="w-[24px] h-[24px]" />
            <span className="text-[14px] font-light text-[#2F2F2F]">Since: {createdAt}</span>
          </span>

          <span className="flex items-center gap-2">
            <img src="/icons/session_count.svg" alt="Total sessions attended" className="w-[24px] h-[24px]" />
            <span className="text-[14px] font-medium text-[#2F2F2F]">{attendedCount} sessions</span>
          </span>
        </div>
      </div>

      {/* Host actions */}
      {hasHostedSessions && (
        <section className="mt-10">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-bold text-[#2F2F2F]">Host profile</h2>
                <p className="mt-1 text-sm text-gray-600">
                  {isOwnProfile
                    ? "This is your public host surface. Visitors will be able to follow you, see your sessions, and support you here."
                    : "Follow this host, check their upcoming sessions, or support them directly."}
                </p>
              </div>

              {!isOwnProfile && (
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleToggleFollow}
                    disabled={followLoading}
                    className={`
                      inline-flex items-center justify-center rounded-full
                      border px-5 py-2.5 text-[14px] transition
                      ${isFollowing
                        ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                        : "border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white"}
                      disabled:opacity-60 disabled:cursor-not-allowed
                    `}
                  >
                    {followLoading
                      ? "Saving..."
                      : isFollowing
                        ? "Following"
                        : "Follow host"}
                  </button>

                  <button
                    type="button"
                    onClick={handleSupportHost}
                    className="
                      inline-flex items-center justify-center rounded-full
                      bg-[#2F2F2F] px-5 py-2.5
                      text-[14px] text-white
                      hover:opacity-90 transition
                    "
                  >
                    Support host
                  </button>

                  {nextSession && (
                    <button
                      type="button"
                      onClick={() => navigate(`/room-livekit/${nextSession.id}`)}
                      className="
                        inline-flex items-center justify-center rounded-full
                        border border-[#2F2F2F] px-5 py-2.5
                        text-[14px] text-[#2F2F2F]
                        hover:bg-[#2F2F2F] hover:text-white transition
                      "
                    >
                      Join next session
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="mt-10 border-t border-gray-200" />

      <section className="mt-8">
        <h2 className="font-semibold mb-2">Bio:</h2>
        <p className="text-gray-800 text-lg whitespace-pre-wrap">
          {bio || <span className="text-gray-400 italic">No bio added yet.</span>}
        </p>
      </section>

      <div className="mt-16 border-t border-gray-200" />

      <section className="mt-10">
        <h2 className="text-xl font-bold mb-6 text-[#2F2F2F]">Hosted Sessions</h2>

        {sessions.length === 0 ? (
          <p className="text-slate-500 text-sm text-center">No sessions hosted yet.</p>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => {
              const status = getSessionStatus(s);

              return (
                <div
                  key={s.id}
                  onClick={() => navigate(`/room-livekit/${s.id}`)}
                  className="
                    bg-gray-50 rounded-xl px-5 py-3
                    flex items-center justify-between
                    hover:bg-gray-100 transition cursor-pointer
                  "
                >
                  <span className="text-[14px] text-gray-800">{s.title}</span>

                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-gray-500">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                    {status && <span className={getBadgeClass(status)}>{status}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}