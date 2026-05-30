import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  ensurePushSubscription,
  pushSupported,
  showPushEnabledTestNotification,
} from "../lib/pushNotifications";

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
  duration_minutes?: number | null;
  created_at: string;
};

function getScheduleDurationMinutes(schedule: any): number {
  if (!schedule) return 0;

  try {
    const parsed =
      typeof schedule === "string" ? JSON.parse(schedule) : schedule;

    if (Array.isArray(parsed)) {
      return parsed.reduce((sum: number, block: any) => {
        const minutes =
          Number(block?.minutes) ||
          Number(block?.duration_minutes) ||
          Number(block?.durationMinutes) ||
          (Number(block?.seconds) ? Number(block.seconds) / 60 : 0) ||
          (Number(block?.duration_seconds) ? Number(block.duration_seconds) / 60 : 0) ||
          (Number(block?.durationSeconds) ? Number(block.durationSeconds) / 60 : 0);

        return sum + (Number.isFinite(minutes) ? minutes : 0);
      }, 0);
    }

    const phases =
      parsed?.timer?.phases ||
      parsed?.timer?.timeline ||
      parsed?.timer?.stages ||
      parsed?.timer?.segments ||
      parsed?.phases ||
      parsed?.timeline ||
      parsed?.stages ||
      parsed?.segments ||
      parsed?.blocks ||
      [];

    if (Array.isArray(phases)) {
      return phases.reduce((sum: number, phase: any) => {
        const minutes =
          Number(phase?.minutes) ||
          Number(phase?.duration_minutes) ||
          Number(phase?.durationMinutes) ||
          (Number(phase?.seconds) ? Number(phase.seconds) / 60 : 0) ||
          (Number(phase?.duration_seconds) ? Number(phase.duration_seconds) / 60 : 0) ||
          (Number(phase?.durationSeconds) ? Number(phase.durationSeconds) / 60 : 0);

        return sum + (Number.isFinite(minutes) ? minutes : 0);
      }, 0);
    }
  } catch {
    return 0;
  }

  return 0;
}

function getSessionStartMs(session: any): number | null {
  if (!session?.start_time) return null;

  const start = new Date(session.start_time).getTime();
  return Number.isFinite(start) ? start : null;
}

function getSessionEndMs(session: any): number | null {
  const start = getSessionStartMs(session);
  if (start == null) return null;

  const durationMinutes =
    Number(session?.duration_minutes) ||
    getScheduleDurationMinutes(session?.schedule) ||
    0;

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return start;

  return start + durationMinutes * 60 * 1000;
}

function formatSessionDateTime(isoOrMs?: string | number | null) {
  if (isoOrMs == null || isoOrMs === "") return "Time TBD";

  const date = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(date.getTime())) return "Time TBD";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function sortUpcomingSessions(a: any, b: any) {
  const aStart = getSessionStartMs(a) ?? Number.POSITIVE_INFINITY;
  const bStart = getSessionStartMs(b) ?? Number.POSITIVE_INFINITY;
  return aStart - bStart;
}

function sortHostedSessions(a: any, b: any) {
  const aEnd = getSessionEndMs(a) ?? getSessionStartMs(a) ?? 0;
  const bEnd = getSessionEndMs(b) ?? getSessionStartMs(b) ?? 0;
  return bEnd - aEnd;
}

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
  const [followersCount, setFollowersCount] = useState<number>(0);

  const [pushPermission, setPushPermission] = useState<string>("default");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");

  const [supportEnabled, setSupportEnabled] = useState(false);
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [supportAmountUsd, setSupportAmountUsd] = useState<number>(5);
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportError, setSupportError] = useState("");

  const displayName = useMemo(() => fullName || "User", [fullName]);

  const avatarFallback = useMemo(() => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`;
  }, [displayName]);

  const isOwnProfile = !!currentUserId && !!id && currentUserId === id;
  const hasHostedSessions = sessions.length > 0;

  const upcomingSessions = useMemo(() => {
    const now = Date.now();

    return [...sessions]
      .filter((session) => {
        const start = getSessionStartMs(session);
        return start != null && start > now;
      })
      .sort(sortUpcomingSessions);
  }, [sessions]);

  const hostedSessions = useMemo(() => {
    const now = Date.now();

    return [...sessions]
      .filter((session) => {
        const start = getSessionStartMs(session);
        return start == null || start <= now;
      })
      .sort(sortHostedSessions);
  }, [sessions]);

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

    const durationMinutes =
      Number(session.duration_minutes) || getScheduleDurationMinutes(session.schedule);
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

  const refreshPushPermission = () => {
    if (!pushSupported()) {
      setPushPermission("unsupported");
      return;
    }

    setPushPermission(Notification.permission);
  };

  useEffect(() => {
    refreshPushPermission();
  }, []);

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
      setSupportEnabled(false);

      try {
        const [
          { data: p, error: pErr },
          { data: s, error: sErr },
          { count: followerCount, error: followerCountErr },
          { data: monetization, error: monetizationErr },
        ] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, bio, avatar_url, created_at, attended_sessions_count")
            .eq("id", id)
            .single(),
          supabase
            .from("sessions")
            .select("id, title, start_time, schedule, duration_minutes, created_at")
            .eq("host_id", id)
            .order("created_at", { ascending: false }),
          supabase
            .from("host_followers")
            .select("id", { count: "exact", head: true })
            .eq("host_user_id", id),
          supabase
            .from("host_monetization_profiles")
            .select("status, support_enabled")
            .eq("host_user_id", id)
            .maybeSingle(),
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

        if (followerCountErr) {
          console.warn("Failed to load followers count:", followerCountErr);
          setFollowersCount(0);
        } else {
          setFollowersCount(followerCount || 0);
        }

        if (monetizationErr) {
          console.warn("Failed to load host monetization:", monetizationErr);
          setSupportEnabled(false);
        } else {
          setSupportEnabled(
            (monetization as any)?.status === "active" &&
            (monetization as any)?.support_enabled === true
          );
        }
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
        setFollowersCount((prev) => Math.max(0, prev - 1));
      } else {
        const { error } = await supabase.from("host_followers").insert({
          host_user_id: id,
          follower_user_id: currentUserId,
        });

        if (error) throw error;

        setIsFollowing(true);
        setFollowersCount((prev) => prev + 1);
      }
    } catch (e) {
      console.error("Follow toggle failed:", e);
      alert("Follow system is not fully wired yet. We’ll finish the backend next.");
    } finally {
      setFollowLoading(false);
    }
  };

  const handleEnablePushNotifications = async () => {
    if (!currentUserId) {
      navigate("/login", { replace: false });
      return;
    }

    setPushBusy(true);
    setPushError("");

    try {
      await ensurePushSubscription();
      refreshPushPermission();
      await showPushEnabledTestNotification();
    } catch (e: any) {
      console.error("Push notification setup failed:", e);
      setPushError(String(e?.message || e || "Failed to enable push notifications."));
      refreshPushPermission();
    } finally {
      setPushBusy(false);
    }
  };

  const handleSupportHost = () => {
    if (!hasHostedSessions || isOwnProfile || !supportEnabled) return;

    if (!currentUserId) {
      navigate("/login", { replace: false });
      return;
    }

    setSupportError("");
    setSupportAmountUsd(5);
    setSupportModalOpen(true);
  };

  const handleCreateSupportCheckout = async () => {
    if (!id) return;

    setSupportBusy(true);
    setSupportError("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        navigate("/login", { replace: false });
        return;
      }

      const res = await fetch("/api/billing/create-host-support-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          hostUserId: id,
          sessionId: nextSession?.id || null,
          amountUsd: supportAmountUsd,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.error || "Failed to create support checkout.");
      }

      if (!json?.url) {
        throw new Error("Checkout URL missing.");
      }

      window.location.assign(json.url);
    } catch (e: any) {
      console.error("Support checkout failed:", e);
      setSupportError(String(e?.message || e || "Failed to start checkout."));
    } finally {
      setSupportBusy(false);
    }
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

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-2 text-sm">
          <span className="flex items-center gap-2">
            <img src="/icons/date_profile.svg" alt="Account creation date" className="w-[24px] h-[24px]" />
            <span className="text-[14px] font-light text-[#2F2F2F]">Since: {createdAt}</span>
          </span>

          <span className="flex items-center gap-2">
            <img src="/icons/session_count.svg" alt="Total sessions attended" className="w-[24px] h-[24px]" />
            <span className="text-[14px] font-medium text-[#2F2F2F]">{attendedCount} sessions</span>
          </span>

          <span className="flex items-center gap-2">
            <img
              src="/icons/followers_profile.svg"
              alt="Followers"
              className="w-[24px] h-[24px]"
            />
            <span className="text-[14px] font-medium text-[#2F2F2F]">
              {followersCount} followers
            </span>
          </span>
        </div>
      </div>

      {hasHostedSessions && (
        <section className="mt-10">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-bold text-[#2F2F2F]">Host profile</h2>
                <p className="mt-1 text-sm text-gray-600">
                  {isOwnProfile
                    ? `This is your public host surface. You currently have ${followersCount} follower${followersCount === 1 ? "" : "s"}.`
                    : `Follow this host, check their upcoming sessions, or support them directly. ${displayName} currently has ${followersCount} follower${followersCount === 1 ? "" : "s"}.`}
                </p>

                {!isOwnProfile && !supportEnabled && (
                  <p className="mt-2 text-xs text-gray-500">
                    Host support is not enabled for this host yet.
                  </p>
                )}

                {isFollowing && pushError && (
                  <p className="mt-2 text-xs text-red-600">
                    {pushError}
                  </p>
                )}

                {isFollowing && pushPermission === "denied" && (
                  <p className="mt-2 text-xs text-gray-500">
                    Notifications are blocked in your browser settings. Enable them for MySession and reload this page.
                  </p>
                )}

                {isFollowing && pushPermission === "unsupported" && (
                  <p className="mt-2 text-xs text-gray-500">
                    Push notifications are not supported in this browser.
                  </p>
                )}
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
                        ? `Following · ${followersCount}`
                        : `Follow host · ${followersCount}`}
                  </button>

                  {isFollowing && pushPermission !== "granted" && pushPermission !== "unsupported" && (
                    <button
                      type="button"
                      onClick={handleEnablePushNotifications}
                      disabled={pushBusy || pushPermission === "denied"}
                      className="
                        inline-flex items-center justify-center rounded-full
                        border border-[#5286F6] px-5 py-2.5
                        text-[14px] text-[#2F2F2F]
                        hover:bg-[#5286F6] hover:text-white transition
                        disabled:opacity-60 disabled:cursor-not-allowed
                      "
                      title={pushPermission === "denied" ? "Notifications are blocked in browser settings" : "Enable push notifications"}
                    >
                      {pushPermission === "denied"
                        ? "Notifications blocked"
                        : pushBusy
                          ? "Enabling..."
                          : "Enable notifications"}
                    </button>
                  )}

                  {isFollowing && pushPermission === "granted" && (
                    <button
                      type="button"
                      onClick={handleEnablePushNotifications}
                      disabled={pushBusy}
                      className="
                        inline-flex items-center justify-center rounded-full
                        border border-[#65D46C] bg-[#65D46C]/10 px-5 py-2.5
                        text-[14px] text-[#2F2F2F]
                        disabled:opacity-60 disabled:cursor-not-allowed
                      "
                      title="Click to refresh this device's push subscription"
                    >
                      {pushBusy ? "Saving..." : "Notifications enabled"}
                    </button>
                  )}

                  {supportEnabled && (
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
                  )}

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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-[#2F2F2F]">
                Upcoming Sessions
              </h2>
              <span className="rounded-full bg-[#EFF6FF] px-3 py-1 text-[12px] font-semibold text-[#1D4ED8]">
                {upcomingSessions.length}
              </span>
            </div>

            {upcomingSessions.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-5 text-sm text-slate-500">
                No upcoming sessions yet.
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingSessions.map((s) => {
                  const status = getSessionStatus(s);

                  return (
                    <div
                      key={s.id}
                      onClick={() => navigate(`/room-livekit/${s.id}`)}
                      className="
                        bg-gray-50 rounded-xl px-5 py-3
                        flex items-center justify-between gap-4
                        hover:bg-gray-100 transition cursor-pointer
                      "
                    >
                      <span className="min-w-0 truncate text-[14px] text-gray-800">
                        {s.title}
                      </span>

                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-right text-[12px] leading-snug text-gray-500">
                          <span className="block text-[10px] uppercase tracking-[0.08em] text-gray-400">
                            Starts
                          </span>
                          {formatSessionDateTime(s.start_time)}
                        </span>

                        {status && <span className={getBadgeClass(status)}>{status}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-[#2F2F2F]">
                Hosted Sessions
              </h2>
              <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-[12px] font-semibold text-[#374151]">
                {hostedSessions.length}
              </span>
            </div>

            {hostedSessions.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-5 text-sm text-slate-500">
                No hosted sessions yet.
              </div>
            ) : (
              <div className="space-y-3">
                {hostedSessions.map((s) => {
                  const status = getSessionStatus(s);
                  const endMs = getSessionEndMs(s);
                  const isLive = status === "Live";

                  return (
                    <div
                      key={s.id}
                      onClick={() => navigate(`/room-livekit/${s.id}`)}
                      className="
                        bg-gray-50 rounded-xl px-5 py-3
                        flex items-center justify-between gap-4
                        hover:bg-gray-100 transition cursor-pointer
                      "
                    >
                      <span className="min-w-0 truncate text-[14px] text-gray-800">
                        {s.title}
                      </span>

                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-right text-[12px] leading-snug text-gray-500">
                          <span className="block text-[10px] uppercase tracking-[0.08em] text-gray-400">
                            {isLive ? "Started" : "Ended"}
                          </span>
                          {formatSessionDateTime(isLive ? s.start_time : endMs || s.start_time)}
                        </span>

                        {status && <span className={getBadgeClass(status)}>{status}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {supportModalOpen && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={() => {
              if (!supportBusy) setSupportModalOpen(false);
            }}
          />

          <div className="relative w-full max-w-[460px] rounded-[28px] bg-white p-6 text-[#2F2F2F] shadow-2xl">
            <button
              type="button"
              onClick={() => {
                if (!supportBusy) setSupportModalOpen(false);
              }}
              disabled={supportBusy}
              className="absolute right-5 top-5 text-gray-400 transition hover:text-gray-700 disabled:opacity-50"
              aria-label="Close"
            >
              ✕
            </button>

            <div className="pr-8">
              <div className="inline-flex rounded-full border border-[#DBD8D8] bg-[#F8F8F8] px-3 py-1 text-[12px] font-semibold text-[#606060]">
                Support host
              </div>

              <h2 className="mt-4 text-[24px] font-bold leading-tight text-[#2F2F2F]">
                Support {displayName}
              </h2>

              <p className="mt-3 text-[15px] leading-6 text-[#606060]">
                Your support helps reward hosts who create focused, structured sessions on MySession.
              </p>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {[2, 5, 10].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setSupportAmountUsd(amount)}
                  disabled={supportBusy}
                  className={`
                    rounded-2xl border px-4 py-3 text-[15px] font-semibold transition
                    ${supportAmountUsd === amount
                      ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                      : "border-[#DBD8D8] bg-white text-[#2F2F2F] hover:bg-[#F8F8F8]"
                    }
                    disabled:opacity-60
                  `}
                >
                  ${amount}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-2xl bg-[#F8F8F8] p-4 text-[13px] leading-5 text-[#606060]">
              90% goes to the host. 10% helps MySession cover payment and platform costs.
            </div>

            {supportError && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                {supportError}
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setSupportModalOpen(false)}
                disabled={supportBusy}
                className="rounded-full border border-[#CAC3C3] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#2F2F2F] transition hover:bg-[#F8F8F8] disabled:opacity-60"
              >
                Maybe later
              </button>

              <button
                type="button"
                onClick={handleCreateSupportCheckout}
                disabled={supportBusy}
                className="flex-1 rounded-full bg-[#2F2F2F] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {supportBusy ? "Opening checkout..." : `Support $${supportAmountUsd}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}