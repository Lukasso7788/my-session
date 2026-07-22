import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";

type HostSupportPaymentRow = {
  id: string;
  host_amount_usd: number | null;
  gross_amount_usd: number | null;
  platform_fee_usd: number | null;
  status: string | null;
  created_at: string | null;
};

type HostPayoutRequestRow = {
  id: string;
  amount_usd: number | null;
  status: string | null;
  note: string | null;
  requested_at: string | null;
  created_at: string | null;
};

function getScheduleDurationMinutes(schedule: any): number {
  if (!schedule) return 0;

  try {
    const parsed = typeof schedule === "string" ? JSON.parse(schedule) : schedule;

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

function formatMoney(value: number) {
  const safe = Number.isFinite(value) ? value : 0;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
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

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, profile, loading, reloadProfile } = useAuth();

  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string>("—");

  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editButtonHover, setEditButtonHover] = useState(false);

  const [sessions, setSessions] = useState<any[]>([]);
  const [attendedCount, setAttendedCount] = useState<number>(0);
  const [followersCount, setFollowersCount] = useState<number>(0);

  const [hostSupportApproved, setHostSupportApproved] = useState(false);
  const [hostSupportLoading, setHostSupportLoading] = useState(false);
  const [hostSupportPayments, setHostSupportPayments] = useState<HostSupportPaymentRow[]>([]);

  const [payoutRequests, setPayoutRequests] = useState<HostPayoutRequestRow[]>([]);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutMessage, setPayoutMessage] = useState("");
  const [payoutError, setPayoutError] = useState("");

  const displayName = useMemo(() => fullName || "User", [fullName]);

  const avatarFallback = useMemo(() => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`;
  }, [displayName]);

  const hasHostedSessions = sessions.length > 0;

  const hostBalance = useMemo(() => {
    return hostSupportPayments.reduce(
      (acc, payment) => {
        const hostAmount = Number(payment.host_amount_usd || 0);
        const grossAmount = Number(payment.gross_amount_usd || 0);
        const status = String(payment.status || "").toLowerCase();

        if (status === "available") {
          acc.availableUsd += hostAmount;
          acc.totalReceivedUsd += hostAmount;
          acc.totalGrossUsd += grossAmount;
        } else if (status === "pending") {
          acc.pendingUsd += hostAmount;
        } else if (status === "paid_out") {
          acc.paidOutUsd += hostAmount;
          acc.totalReceivedUsd += hostAmount;
          acc.totalGrossUsd += grossAmount;
        }

        return acc;
      },
      {
        availableUsd: 0,
        pendingUsd: 0,
        paidOutUsd: 0,
        totalReceivedUsd: 0,
        totalGrossUsd: 0,
      }
    );
  }, [hostSupportPayments]);

  const hasOpenPayoutRequest = useMemo(() => {
    return payoutRequests.some((r) => {
      const status = String(r.status || "").toLowerCase();
      return status === "requested" || status === "processing";
    });
  }, [payoutRequests]);

  const recentSupportPayments = useMemo(() => hostSupportPayments.slice(0, 5), [hostSupportPayments]);
  const recentPayoutRequests = useMemo(() => payoutRequests.slice(0, 5), [payoutRequests]);

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

  const getSessionStatus = (session: any) => {
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

  const getPaymentBadgeClass = (status: string | null) => {
    const normalized = String(status || "").toLowerCase();

    if (normalized === "available") return "bg-[#DCFCE7] text-[#15803D]";
    if (normalized === "pending") return "bg-[#FEF3C7] text-[#92400E]";
    if (normalized === "paid_out") return "bg-[#DBEAFE] text-[#1D4ED8]";

    return "bg-[#E5E7EB] text-[#374151]";
  };

  const getPayoutBadgeClass = (status: string | null) => {
    const normalized = String(status || "").toLowerCase();

    if (normalized === "requested") return "bg-[#FEF3C7] text-[#92400E]";
    if (normalized === "processing") return "bg-[#DBEAFE] text-[#1D4ED8]";
    if (normalized === "paid" || normalized === "completed") return "bg-[#DCFCE7] text-[#15803D]";
    if (normalized === "rejected") return "bg-red-100 text-red-700";

    return "bg-[#E5E7EB] text-[#374151]";
  };

  const formatSince = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
    }).format(d);
  };

  const loadHostSupportBalance = async (hostUserId: string) => {
    setHostSupportLoading(true);

    try {
      const { data: monetization, error: monetizationError } = await supabase
        .from("host_monetization_profiles")
        .select("status, support_enabled")
        .eq("host_user_id", hostUserId)
        .maybeSingle();

      if (monetizationError) {
        console.warn("Failed to load host monetization profile:", monetizationError);
        setHostSupportApproved(false);
        setHostSupportPayments([]);
        setPayoutRequests([]);
        return;
      }

      const approved =
        (monetization as any)?.status === "active" &&
        (monetization as any)?.support_enabled === true;

      setHostSupportApproved(approved);

      if (!approved) {
        setHostSupportPayments([]);
        setPayoutRequests([]);
        return;
      }

      const [{ data: payments, error: paymentsError }, { data: requests, error: requestsError }] =
        await Promise.all([
          supabase
            .from("host_support_payments")
            .select("id, host_amount_usd, gross_amount_usd, platform_fee_usd, status, created_at")
            .eq("host_user_id", hostUserId)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("host_payout_requests")
            .select("id, amount_usd, status, note, requested_at, created_at")
            .eq("host_user_id", hostUserId)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);

      if (paymentsError) {
        console.warn("Failed to load host support payments:", paymentsError);
        setHostSupportPayments([]);
      } else {
        setHostSupportPayments((payments as HostSupportPaymentRow[]) || []);
      }

      if (requestsError) {
        console.warn("Failed to load payout requests:", requestsError);
        setPayoutRequests([]);
      } else {
        setPayoutRequests((requests as HostPayoutRequestRow[]) || []);
      }
    } finally {
      setHostSupportLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!profile) return;

    setFullName(profile.full_name || "");
    setAvatarUrl(profile.avatar_url || null);

    const p: any = profile as any;

    if (typeof p.attended_sessions_count === "number") setAttendedCount(p.attended_sessions_count);
    if (typeof p.created_at === "string" && p.created_at) setCreatedAt(formatSince(p.created_at));
  }, [profile]);

  useEffect(() => {
    if (!user) return;

    const loadProfile = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, bio, avatar_url, created_at, attended_sessions_count")
        .eq("id", user.id)
        .single();

      if (error) {
        console.warn("Failed to load profile:", error);
        return;
      }

      if (!data) return;

      setFullName(data.full_name || "");
      setBio(data.bio || "");
      setAvatarUrl(data.avatar_url || null);
      setAttendedCount(typeof (data as any).attended_sessions_count === "number" ? (data as any).attended_sessions_count : 0);
      setCreatedAt(data.created_at ? formatSince(data.created_at) : "—");
    };

    void loadProfile();
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;

    const loadSessions = async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, title, start_time, schedule, duration_minutes, created_at")
        .eq("host_id", user.id)
        .or("is_private.is.null,is_private.eq.false")
        .order("created_at", { ascending: false });

      if (!error && data) setSessions(data);
    };

    void loadSessions();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    const loadFollowersCount = async () => {
      const { count, error } = await supabase
        .from("host_followers")
        .select("id", { count: "exact", head: true })
        .eq("host_user_id", user.id);

      if (error) {
        console.warn("Failed to load followers count:", error);
        if (!cancelled) setFollowersCount(0);
        return;
      }

      if (!cancelled) setFollowersCount(count || 0);
    };

    void loadFollowersCount();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void loadHostSupportBalance(user.id);
  }, [user?.id]);

  const handleAskPayout = async () => {
    if (!user?.id || payoutBusy) return;

    const amount = Number(hostBalance.availableUsd || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      setPayoutError("You do not have available balance for payout yet.");
      return;
    }

    if (hasOpenPayoutRequest) {
      setPayoutError("You already have an open payout request.");
      return;
    }

    setPayoutBusy(true);
    setPayoutError("");
    setPayoutMessage("");

    try {
      const nowIso = new Date().toISOString();

      const { data: payout, error: payoutError } = await supabase
        .from("host_payout_requests")
        .insert({
          host_user_id: user.id,
          amount_usd: Number(amount.toFixed(2)),
          status: "requested",
          note: "Host requested payout from profile balance.",
          requested_at: nowIso,
        })
        .select("id")
        .single();

      if (payoutError) throw payoutError;

      await supabase.from("admin_notifications").insert({
        type: "host_payout_requested",
        title: "New host payout request",
        body: `${displayName} requested payout: ${formatMoney(amount)}.`,
        actor_user_id: user.id,
        target_user_id: user.id,
        payout_request_id: payout?.id || null,
      });

      setPayoutMessage("Payout request sent. Admin will process it manually.");
      await loadHostSupportBalance(user.id);
    } catch (e: any) {
      console.error("Ask payout failed:", e);
      setPayoutError(String(e?.message || e || "Failed to request payout."));
    } finally {
      setPayoutBusy(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (!file || !user) return;

      setUploading(true);

      const ext = file.name.split(".").pop();
      const filePath = `${user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const publicUrl = data.publicUrl;

      await Promise.all([
        supabase.auth.updateUser({ data: { avatar_url: publicUrl } }),
        supabase
          .from("profiles")
          .update({
            avatar_url: publicUrl,
            updated_at: new Date().toISOString(),
          })
          .eq("id", user.id),
      ]);

      setAvatarUrl(publicUrl);
      await reloadProfile();
    } catch (error: any) {
      console.error("Avatar upload error:", error);
      alert("Upload failed. Check console.");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    try {
      await supabase
        .from("profiles")
        .update({
          full_name: fullName,
          bio,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      await supabase.auth.updateUser({
        data: { full_name: fullName, avatar_url: avatarUrl },
      });

      setEditMode(false);
      await reloadProfile();
    } catch (error) {
      console.error("Save profile error:", error);
      alert("Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center pt-20">
        <div className="animate-spin h-8 w-8 rounded-full border-b-2 border-black" />
      </div>
    );
  }

  if (!user) return null;

  const actionIconSrc = !editMode
    ? editButtonHover
      ? "/icons/edit_profile_hover.svg"
      : "/icons/edit_profile.svg"
    : editButtonHover
      ? "/icons/save_changes_hover.svg"
      : "/icons/save_changes.svg";

  const actionLabel = editMode ? (saving ? "Saving..." : "Save changes") : "Edit profile";

  return (
    <main className="w-full px-8 pt-10 pb-24 font-inter text-gray-900">
      <div className="flex items-center justify-between mb-10">
        <button
          onClick={() => navigate(-1)}
          className="text-[16px] text-[#2F2F2F] hover:text-black flex items-center gap-2"
        >
          ← Back
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#2F2F2F] text-[#2F2F2F] transition hover:bg-[#2F2F2F] hover:text-white"
            aria-label="Profile settings"
            title="Settings"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z" stroke="currentColor" strokeWidth="1.8" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.91 2.91-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.35 1.03V21h-4.1v-.08A1.65 1.65 0 0 0 8.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.91-2.91.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.6-1H3V9.9h.08A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.91-2.91.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6A1.65 1.65 0 0 0 10.35 3H14v.08A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.91 2.91-.06.06A1.65 1.65 0 0 0 19.4 9c.14.5.52.9 1 1.08.2.08.4.11.6.11V14h-.08A1.65 1.65 0 0 0 19.4 15Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => navigate(`/profile/${user.id}`)}
            className="h-10 w-10 rounded-full border border-[#2F2F2F] flex items-center justify-center text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition"
            aria-label="Profile preview"
            title="Profile preview"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>

          <button
            onClick={editMode ? handleSave : () => setEditMode(true)}
            onMouseEnter={() => setEditButtonHover(true)}
            onMouseLeave={() => setEditButtonHover(false)}
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2 rounded-full border border-[#2F2F2F] text-[16px] font-normal text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white hover:border-[#2F2F2F] transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <img src={actionIconSrc} alt={editMode ? "Save changes" : "Edit profile"} className="w-6 h-6" />
            <span>{actionLabel}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center">
        <div className="relative">
          <img
            src={avatarUrl || avatarFallback}
            className="w-28 h-28 rounded-full object-cover border border-gray-200 shadow-sm"
            alt="avatar"
          />

          {editMode && (
            <label className="absolute -bottom-2 right-0 bg-white px-3 py-1 border rounded-full text-xs cursor-pointer shadow-sm hover:bg-gray-50">
              Change
              <input type="file" className="hidden" onChange={handleAvatarUpload} accept="image/*" disabled={uploading} />
            </label>
          )}
        </div>

        <h1 className="font-inter font-bold text-[32px] text-[#2F2F2F] mt-4">
          {displayName}
        </h1>

        {editMode && (
          <div className="mt-3 w-full max-w-[520px]">
            <label className="block text-sm font-medium text-[#2F2F2F] mb-2">Name</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full border border-gray-300 px-4 py-3 rounded-xl focus:ring-2 focus:ring-black outline-none transition"
              placeholder="Your name"
              disabled={saving}
              autoComplete="name"
            />
            <p className="text-xs text-gray-500 mt-2">
              This name will be saved when you click “Save changes”.
            </p>
          </div>
        )}

        <div className="flex items-center gap-6 mt-2 text-sm">
          <span className="flex items-center gap-2">
            <img src="/icons/date_profile.svg" alt="Account creation date" className="w-[24px] h-[24px]" />
            <span className="text-[14px] font-light text-[#2F2F2F]">Since: {createdAt}</span>
          </span>

          <span className="flex items-center gap-2">
            <img src="/icons/session_count.svg" alt="Total sessions attended" className="w-[24px] h-[24px]" />
            <span className="text-[14px] font-medium text-[#2F2F2F]">{attendedCount} sessions</span>
          </span>

          <span className="flex items-center gap-2">
            <img src="/icons/followers_profile.svg" alt="Followers" className="w-[24px] h-[24px]" />
            <span className="text-[14px] font-medium text-[#2F2F2F]">{followersCount} followers</span>
          </span>
        </div>
      </div>

      <div className="mt-10 border-t border-gray-200" />

      <section className="mt-8">
        <h2 className="font-semibold mb-2">Bio:</h2>

        {editMode ? (
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="w-full border border-gray-300 p-4 rounded-xl focus:ring-2 focus:ring-black outline-none transition"
            rows={4}
            placeholder="Tell us about yourself..."
          />
        ) : (
          <p className="text-gray-800 text-lg">
            {bio || <span className="text-gray-400 italic">No bio added yet.</span>}
          </p>
        )}
      </section>

      <div className="mt-16 border-t border-gray-200" />

      <section className="mt-10">
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold text-[#2F2F2F]">Host profile</h2>
              <p className="mt-1 text-sm text-gray-600">
                {hasHostedSessions
                  ? `You already have a public host profile with ${followersCount} follower${followersCount === 1 ? "" : "s"}. Visitors can follow you, view your sessions, and support you there.`
                  : "Once you host sessions, your public profile becomes your host surface for follows, support, and upcoming sessions."}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate(`/profile/${user.id}`)}
                className="inline-flex items-center justify-center rounded-full border border-[#2F2F2F] px-5 py-2.5 text-[14px] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition"
              >
                Open public profile · {followersCount} follower{followersCount === 1 ? "" : "s"}
              </button>

              <button
                type="button"
                onClick={() => navigate("/sessions")}
                className="inline-flex items-center justify-center rounded-full bg-[#2F2F2F] px-5 py-2.5 text-[14px] text-white hover:opacity-90 transition"
              >
                Back to sessions
              </button>
            </div>
          </div>
        </div>
      </section>

      {hostSupportApproved && (
        <section className="mt-8">
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50 px-6 py-5 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-bold text-[#2F2F2F]">Host balance</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Support received through your public host profile.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {hostSupportLoading && <span className="text-sm text-gray-500">Loading balance…</span>}

                <button
                  type="button"
                  onClick={handleAskPayout}
                  disabled={payoutBusy || hostBalance.availableUsd <= 0 || hasOpenPayoutRequest}
                  className="rounded-full bg-[#2F2F2F] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  title={hasOpenPayoutRequest ? "You already have an open payout request" : "Ask admin to process payout"}
                >
                  {payoutBusy ? "Requesting..." : "Ask payout"}
                </button>
              </div>
            </div>

            {(payoutMessage || payoutError) && (
              <div className="px-6 pt-5">
                <div
                  className={`rounded-2xl border px-4 py-3 text-[13px] ${payoutError
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-green-200 bg-green-50 text-green-700"
                    }`}
                >
                  {payoutError || payoutMessage}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 px-6 py-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-gray-500">Available</div>
                <div className="mt-2 text-2xl font-bold text-[#15803D]">{formatMoney(hostBalance.availableUsd)}</div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-gray-500">Pending</div>
                <div className="mt-2 text-2xl font-bold text-[#92400E]">{formatMoney(hostBalance.pendingUsd)}</div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-gray-500">Paid out</div>
                <div className="mt-2 text-2xl font-bold text-[#1D4ED8]">{formatMoney(hostBalance.paidOutUsd)}</div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-gray-500">Total received</div>
                <div className="mt-2 text-2xl font-bold text-[#2F2F2F]">{formatMoney(hostBalance.totalReceivedUsd)}</div>
              </div>
            </div>

            <div className="border-t border-gray-200 px-6 py-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-bold text-[#2F2F2F]">Payout requests</h3>
                <span className="text-[12px] text-gray-500">Showing latest {recentPayoutRequests.length}</span>
              </div>

              {recentPayoutRequests.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-5 text-sm text-slate-500">
                  No payout requests yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {recentPayoutRequests.map((request) => {
                    const status = String(request.status || "requested");
                    return (
                      <div
                        key={request.id}
                        className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"
                      >
                        <div>
                          <div className="text-[14px] font-semibold text-[#2F2F2F]">
                            {formatMoney(Number(request.amount_usd || 0))}
                          </div>
                          <div className="mt-0.5 text-[12px] text-gray-500">
                            Requested {formatSessionDateTime(request.requested_at || request.created_at)}
                          </div>
                        </div>

                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${getPayoutBadgeClass(status)}`}>
                          {status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-gray-200 px-6 py-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-bold text-[#2F2F2F]">Recent support</h3>
                <span className="text-[12px] text-gray-500">Showing latest {recentSupportPayments.length}</span>
              </div>

              {recentSupportPayments.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-5 text-sm text-slate-500">
                  No support payments yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {recentSupportPayments.map((payment) => {
                    const status = String(payment.status || "unknown");
                    return (
                      <div
                        key={payment.id}
                        className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"
                      >
                        <div>
                          <div className="text-[14px] font-semibold text-[#2F2F2F]">
                            {formatMoney(Number(payment.host_amount_usd || 0))}
                          </div>
                          <div className="mt-0.5 text-[12px] text-gray-500">
                            Gross {formatMoney(Number(payment.gross_amount_usd || 0))} · Fee{" "}
                            {formatMoney(Number(payment.platform_fee_usd || 0))}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-3">
                          <span className="text-right text-[12px] text-gray-500">
                            {formatSessionDateTime(payment.created_at)}
                          </span>

                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${getPaymentBadgeClass(status)}`}>
                            {status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="mt-4 text-[12px] leading-5 text-gray-500">
                Payouts are currently handled manually. Available balance means the payment succeeded and is recorded for host payout.
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="mt-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-[#2F2F2F]">Upcoming Sessions</h2>
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
                      className="bg-gray-50 rounded-xl px-5 py-3 flex items-center justify-between gap-4 hover:bg-gray-100 transition cursor-pointer"
                    >
                      <span className="min-w-0 truncate text-[14px] text-gray-800">{s.title}</span>

                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-right text-[12px] leading-snug text-gray-500">
                          <span className="block text-[10px] uppercase tracking-[0.08em] text-gray-400">Starts</span>
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
              <h2 className="text-xl font-bold text-[#2F2F2F]">Hosted Sessions</h2>
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
                      className="bg-gray-50 rounded-xl px-5 py-3 flex items-center justify-between gap-4 hover:bg-gray-100 transition cursor-pointer"
                    >
                      <span className="min-w-0 truncate text-[14px] text-gray-800">{s.title}</span>

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
    </main>
  );
}
