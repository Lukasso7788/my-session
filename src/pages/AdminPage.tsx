import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  formatBanEnd,
  isCurrentUserAdmin,
  listActiveBans,
  revokeUserBan,
  searchAdminUsers,
  type ActiveBan,
} from "../lib/bans";
import BanUserModal from "../components/BanUserModal";

type AdminUserRow = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  created_at?: string | null;
};

type AdminNotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  actor_user_id: string | null;
  target_user_id: string | null;
  payout_request_id: string | null;
  read_at: string | null;
  created_at: string;
};

type PayoutRequestRow = {
  id: string;
  host_user_id: string;
  amount_usd: number | null;
  status: string | null;
  note: string | null;
  admin_note: string | null;
  requested_at: string | null;
  resolved_at: string | null;
  created_at: string;
  profiles?: {
    full_name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
  } | null;
};

type AdminStats = {
  registrationsToday: number;
  registrationsWeek: number;
  registrationsMonth: number;
  sessionsToday: number;
  sessionsWeek: number;
  sessionsMonth: number;
  activeHostsWeek: number;
  uniqueBookedUsersWeek: number;
  uniqueAttendeesWeek: number;
  availableHostBalanceUsd: number;
  pendingPayoutUsd: number;
};

function getInitial(name: string) {
  return (String(name || "").trim()[0] || "U").toUpperCase();
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

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function startOfDayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export default function AdminPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<"dashboard" | "moderation">("dashboard");

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);
  const [banModalOpen, setBanModalOpen] = useState(false);

  const [activeBans, setActiveBans] = useState<ActiveBan[]>([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [revokingBanId, setRevokingBanId] = useState<string>("");

  const [notifications, setNotifications] = useState<AdminNotificationRow[]>([]);
  const [payoutRequests, setPayoutRequests] = useState<PayoutRequestRow[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [processingPayoutId, setProcessingPayoutId] = useState("");
  const [stats, setStats] = useState<AdminStats>({
    registrationsToday: 0,
    registrationsWeek: 0,
    registrationsMonth: 0,
    sessionsToday: 0,
    sessionsWeek: 0,
    sessionsMonth: 0,
    activeHostsWeek: 0,
    uniqueBookedUsersWeek: 0,
    uniqueAttendeesWeek: 0,
    availableHostBalanceUsd: 0,
    pendingPayoutUsd: 0,
  });

  const [error, setError] = useState("");

  const cleanQuery = useMemo(() => query.trim(), [query]);

  const unreadNotifications = useMemo(() => {
    return notifications.filter((n) => !n.read_at).length;
  }, [notifications]);

  const requestedPayouts = useMemo(() => {
    return payoutRequests.filter((p) => {
      const status = String(p.status || "").toLowerCase();
      return status === "requested" || status === "processing";
    });
  }, [payoutRequests]);

  const loadBans = async () => {
    try {
      setBansLoading(true);
      const bans = await listActiveBans();
      setActiveBans(bans);
    } catch (e: any) {
      console.error("[admin] load bans failed:", e);
      setError(String(e?.message || e || "Failed to load bans."));
    } finally {
      setBansLoading(false);
    }
  };

  const safeCount = async (table: string, column: string, fromIso: string) => {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .gte(column, fromIso);

    if (error) {
      console.warn(`[admin] count failed: ${table}`, error);
      return 0;
    }

    return count || 0;
  };

  const loadDashboard = async () => {
    try {
      setDashboardLoading(true);
      setError("");

      const todayIso = startOfDayIso();
      const weekIso = daysAgoIso(7);
      const monthIso = daysAgoIso(30);

      const [
        registrationsToday,
        registrationsWeek,
        registrationsMonth,
        sessionsToday,
        sessionsWeek,
        sessionsMonth,
        notificationsResult,
        payoutsResult,
        paymentsResult,
        bookingsResult,
        attendanceResult,
        weeklySessionsResult,
      ] = await Promise.all([
        safeCount("profiles", "created_at", todayIso),
        safeCount("profiles", "created_at", weekIso),
        safeCount("profiles", "created_at", monthIso),
        safeCount("sessions", "created_at", todayIso),
        safeCount("sessions", "created_at", weekIso),
        safeCount("sessions", "created_at", monthIso),

        supabase
          .from("admin_notifications")
          .select("id, type, title, body, actor_user_id, target_user_id, payout_request_id, read_at, created_at")
          .order("created_at", { ascending: false })
          .limit(30),

        supabase
          .from("host_payout_requests")
          .select("id, host_user_id, amount_usd, status, note, admin_note, requested_at, resolved_at, created_at, profiles:host_user_id(full_name, email, avatar_url)")
          .order("created_at", { ascending: false })
          .limit(50),

        supabase
          .from("host_support_payments")
          .select("host_amount_usd, status"),

        supabase
          .from("session_bookings")
          .select("user_id")
          .gte("created_at", weekIso),

        supabase
          .from("session_attendance")
          .select("user_id")
          .gte("created_at", weekIso),

        supabase
          .from("sessions")
          .select("host_id")
          .gte("created_at", weekIso),
      ]);

      if (notificationsResult.error) {
        console.warn("[admin] notifications load failed:", notificationsResult.error);
        setNotifications([]);
      } else {
        setNotifications((notificationsResult.data as AdminNotificationRow[]) || []);
      }

      if (payoutsResult.error) {
        console.warn("[admin] payouts load failed:", payoutsResult.error);
        setPayoutRequests([]);
      } else {
        setPayoutRequests((payoutsResult.data as PayoutRequestRow[]) || []);
      }

      const payments = (paymentsResult.data as any[]) || [];
      const availableHostBalanceUsd = payments.reduce((sum, p) => {
        if (String(p.status || "").toLowerCase() !== "available") return sum;
        return sum + Number(p.host_amount_usd || 0);
      }, 0);

      const payoutRows = ((payoutsResult.data as any[]) || []) as PayoutRequestRow[];
      const pendingPayoutUsd = payoutRows.reduce((sum, p) => {
        const status = String(p.status || "").toLowerCase();
        if (status !== "requested" && status !== "processing") return sum;
        return sum + Number(p.amount_usd || 0);
      }, 0);

      const weeklyHosts = new Set(((weeklySessionsResult.data as any[]) || []).map((s) => s.host_id).filter(Boolean));
      const weeklyBookedUsers = new Set(((bookingsResult.data as any[]) || []).map((b) => b.user_id).filter(Boolean));
      const weeklyAttendees = new Set(((attendanceResult.data as any[]) || []).map((a) => a.user_id).filter(Boolean));

      setStats({
        registrationsToday,
        registrationsWeek,
        registrationsMonth,
        sessionsToday,
        sessionsWeek,
        sessionsMonth,
        activeHostsWeek: weeklyHosts.size,
        uniqueBookedUsersWeek: weeklyBookedUsers.size,
        uniqueAttendeesWeek: weeklyAttendees.size,
        availableHostBalanceUsd,
        pendingPayoutUsd,
      });
    } catch (e: any) {
      console.error("[admin] dashboard load failed:", e);
      setError(String(e?.message || e || "Failed to load dashboard."));
    } finally {
      setDashboardLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError("");

        const { data } = await supabase.auth.getSession();
        if (!data.session?.user) {
          navigate("/login", { replace: true });
          return;
        }

        const ok = await isCurrentUserAdmin();

        if (!cancelled) {
          setIsAdmin(ok);

          if (ok) {
            await Promise.all([loadDashboard(), loadBans()]);
          }
        }
      } catch (e: any) {
        console.error("[admin] init failed:", e);
        if (!cancelled) setError(String(e?.message || e || "Admin load failed."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const runSearch = async () => {
    if (!cleanQuery) {
      setUsers([]);
      return;
    }

    try {
      setSearching(true);
      setError("");
      const rows = await searchAdminUsers(cleanQuery);
      setUsers(rows as AdminUserRow[]);
    } catch (e: any) {
      console.error("[admin] search failed:", e);
      setError(String(e?.message || e || "Search failed."));
    } finally {
      setSearching(false);
    }
  };

  const revoke = async (ban: ActiveBan) => {
    try {
      setRevokingBanId(ban.id);
      setError("");

      await revokeUserBan({ banId: ban.id, reason: "Revoked from admin page." });

      setActiveBans((prev) => prev.filter((b) => b.id !== ban.id));
      await loadBans();
    } catch (e: any) {
      console.error("[admin] revoke failed:", e);
      setError(String(e?.message || e || "Failed to revoke ban."));
    } finally {
      setRevokingBanId("");
    }
  };

  const markNotificationRead = async (notification: AdminNotificationRow) => {
    try {
      const nowIso = new Date().toISOString();

      const { error } = await supabase
        .from("admin_notifications")
        .update({ read_at: nowIso })
        .eq("id", notification.id);

      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read_at: nowIso } : n))
      );
    } catch (e) {
      console.warn("[admin] mark notification read failed:", e);
    }
  };

  const updatePayoutStatus = async (
    payout: PayoutRequestRow,
    nextStatus: "processing" | "paid" | "rejected"
  ) => {
    try {
      setProcessingPayoutId(payout.id);
      setError("");

      const nowIso = new Date().toISOString();

      const payload: Record<string, unknown> = {
        status: nextStatus,
        updated_at: nowIso,
      };

      if (nextStatus === "paid" || nextStatus === "rejected") {
        payload.resolved_at = nowIso;
      }

      if (nextStatus === "paid") {
        payload.admin_note = "Marked as paid from admin dashboard.";
      }

      if (nextStatus === "rejected") {
        payload.admin_note = "Rejected from admin dashboard.";
      }

      const { error: payoutError } = await supabase
        .from("host_payout_requests")
        .update(payload)
        .eq("id", payout.id);

      if (payoutError) throw payoutError;

      if (nextStatus === "paid") {
        const { error: paymentsError } = await supabase
          .from("host_support_payments")
          .update({
            status: "paid_out",
            updated_at: nowIso,
          })
          .eq("host_user_id", payout.host_user_id)
          .eq("status", "available");

        if (paymentsError) throw paymentsError;
      }

      await supabase.from("admin_notifications").insert({
        type: `host_payout_${nextStatus}`,
        title: `Payout ${nextStatus}`,
        body: `Payout ${formatMoney(Number(payout.amount_usd || 0))} was marked as ${nextStatus}.`,
        actor_user_id: payout.host_user_id,
        target_user_id: payout.host_user_id,
        payout_request_id: payout.id,
        read_at: nowIso,
      });

      await loadDashboard();
    } catch (e: any) {
      console.error("[admin] payout update failed:", e);
      setError(String(e?.message || e || "Failed to update payout."));
    } finally {
      setProcessingPayoutId("");
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-white px-6 py-16 font-inter text-[#2F2F2F]">
        <div className="mx-auto max-w-5xl text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-black" />
        </div>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-white px-6 py-16 font-inter text-[#2F2F2F]">
        <div className="mx-auto max-w-2xl rounded-[28px] border border-black/10 bg-white p-8 text-center shadow-sm">
          <div className="text-[26px] font-bold">Admin access required</div>
          <p className="mt-3 text-[14px] leading-6 text-[#666]">
            Your account is not listed as admin.
          </p>
          <button
            type="button"
            onClick={() => navigate("/sessions")}
            className="mt-6 rounded-full bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white"
          >
            Back to sessions
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10 font-inter text-[#2F2F2F]">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#666]">
                MySession Admin
              </div>

              <div className="relative">
                <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-black/10 bg-white px-3 text-[13px] font-bold">
                  🔔 {unreadNotifications}
                </span>
              </div>
            </div>

            <h1 className="mt-2 text-[34px] font-bold">
              {tab === "dashboard" ? "Admin dashboard" : "Moderation"}
            </h1>

            <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#666]">
              Payout requests, notifications, growth stats, user search, bans, and platform operations.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setTab("dashboard")}
              className={`rounded-full border px-5 py-2.5 text-[14px] font-semibold ${tab === "dashboard"
                  ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                  : "border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white"
                }`}
            >
              Dashboard
            </button>

            <button
              type="button"
              onClick={() => setTab("moderation")}
              className={`rounded-full border px-5 py-2.5 text-[14px] font-semibold ${tab === "moderation"
                  ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                  : "border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white"
                }`}
            >
              Moderation
            </button>

            <button
              type="button"
              onClick={() => navigate("/sessions")}
              className="rounded-full border border-[#2F2F2F] px-5 py-2.5 text-[14px] font-semibold hover:bg-[#2F2F2F] hover:text-white"
            >
              Back to sessions
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        ) : null}

        {tab === "dashboard" && (
          <>
            <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Registrations today", stats.registrationsToday],
                ["Registrations 7d", stats.registrationsWeek],
                ["Registrations 30d", stats.registrationsMonth],
                ["Sessions today", stats.sessionsToday],
                ["Sessions 7d", stats.sessionsWeek],
                ["Sessions 30d", stats.sessionsMonth],
                ["Active hosts 7d", stats.activeHostsWeek],
                ["Booked users 7d", stats.uniqueBookedUsersWeek],
                ["Attendees 7d", stats.uniqueAttendeesWeek],
                ["Available host balance", formatMoney(stats.availableHostBalanceUsd)],
                ["Pending payouts", formatMoney(stats.pendingPayoutUsd)],
                ["Open payout requests", requestedPayouts.length],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[22px] border border-black/10 bg-gray-50 p-5">
                  <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                    {label}
                  </div>
                  <div className="mt-2 text-[28px] font-bold text-[#2F2F2F]">
                    {value}
                  </div>
                </div>
              ))}
            </section>

            <section className="mt-8 rounded-[28px] border border-black/10 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[20px] font-bold">Payout requests</h2>
                  <p className="mt-1 text-[13px] text-[#666]">
                    Manual payout queue for approved hosts.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void loadDashboard()}
                  className="rounded-full border border-black/10 px-4 py-2 text-[13px] font-semibold hover:bg-black/[0.04]"
                >
                  {dashboardLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {payoutRequests.length === 0 ? (
                  <div className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-4 text-[14px] text-[#666]">
                    No payout requests yet.
                  </div>
                ) : (
                  payoutRequests.map((payout) => {
                    const hostName =
                      payout.profiles?.full_name ||
                      payout.profiles?.email ||
                      payout.host_user_id;

                    const status = String(payout.status || "requested").toLowerCase();

                    return (
                      <div key={payout.id} className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-[15px] font-bold">{formatMoney(Number(payout.amount_usd || 0))}</div>
                              <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-bold text-[#92400E]">
                                {status}
                              </span>
                            </div>

                            <div className="mt-1 text-[13px] text-[#666]">
                              Host: <span className="font-semibold">{hostName}</span>
                            </div>

                            <div className="mt-1 text-[12px] text-[#777]">
                              Requested: {formatDateTime(payout.requested_at || payout.created_at)}
                            </div>

                            {payout.note ? (
                              <div className="mt-2 text-[13px] text-[#666]">{payout.note}</div>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={processingPayoutId === payout.id || status === "processing"}
                              onClick={() => void updatePayoutStatus(payout, "processing")}
                              className="rounded-full border border-blue-600 px-4 py-2 text-[13px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                            >
                              Processing
                            </button>

                            <button
                              type="button"
                              disabled={processingPayoutId === payout.id || status === "paid"}
                              onClick={() => void updatePayoutStatus(payout, "paid")}
                              className="rounded-full bg-green-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              Mark paid
                            </button>

                            <button
                              type="button"
                              disabled={processingPayoutId === payout.id || status === "rejected"}
                              onClick={() => void updatePayoutStatus(payout, "rejected")}
                              className="rounded-full border border-red-600 px-4 py-2 text-[13px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section className="mt-8 rounded-[28px] border border-black/10 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[20px] font-bold">Admin notifications</h2>
                <span className="rounded-full bg-black/[0.04] px-3 py-1 text-[12px] font-bold">
                  {unreadNotifications} unread
                </span>
              </div>

              <div className="mt-5 space-y-3">
                {notifications.length === 0 ? (
                  <div className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-4 text-[14px] text-[#666]">
                    No notifications yet.
                  </div>
                ) : (
                  notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`rounded-2xl border px-4 py-4 ${notification.read_at
                          ? "border-black/10 bg-gray-50"
                          : "border-blue-200 bg-blue-50"
                        }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="text-[14px] font-bold">{notification.title}</div>
                          {notification.body ? (
                            <div className="mt-1 text-[13px] text-[#666]">{notification.body}</div>
                          ) : null}
                          <div className="mt-2 text-[12px] text-[#777]">
                            {notification.type} · {formatDateTime(notification.created_at)}
                          </div>
                        </div>

                        {!notification.read_at && (
                          <button
                            type="button"
                            onClick={() => void markNotificationRead(notification)}
                            className="rounded-full border border-blue-600 px-4 py-2 text-[13px] font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}

        {tab === "moderation" && (
          <>
            <section className="mt-8 rounded-[28px] border border-black/10 bg-gray-50 p-5">
              <h2 className="text-[20px] font-bold">Ban a participant</h2>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runSearch();
                  }}
                  placeholder="Search by name, email, or user id"
                  className="min-w-0 flex-1 rounded-2xl border border-black/10 bg-white px-4 py-3 text-[14px] outline-none focus:ring-2 focus:ring-black/15"
                />
                <button
                  type="button"
                  disabled={searching || !cleanQuery}
                  onClick={() => void runSearch()}
                  className="rounded-2xl bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-60"
                >
                  {searching ? "Searching..." : "Search"}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {users.length === 0 ? (
                  <div className="rounded-2xl border border-black/10 bg-white px-4 py-4 text-[14px] text-[#666]">
                    No users selected yet. Search by full name, email, or UUID.
                  </div>
                ) : (
                  users.map((u) => {
                    const display = String(u.full_name || u.email || u.id || "User");

                    return (
                      <div
                        key={u.id}
                        className="flex flex-col gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="h-11 w-11 overflow-hidden rounded-full bg-gray-200">
                            {u.avatar_url ? (
                              <img src={u.avatar_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center font-bold">
                                {getInitial(display)}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[14px] font-semibold">{display}</div>
                            <div className="truncate text-[12px] text-[#666]">{u.id}</div>
                            {u.email ? <div className="truncate text-[12px] text-[#666]">{u.email}</div> : null}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedUser(u);
                            setBanModalOpen(true);
                          }}
                          className="rounded-full bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700"
                        >
                          Ban user
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section className="mt-8 rounded-[28px] border border-black/10 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[20px] font-bold">Active bans</h2>
                <button
                  type="button"
                  onClick={() => void loadBans()}
                  className="rounded-full border border-black/10 px-4 py-2 text-[13px] font-semibold hover:bg-black/[0.04]"
                >
                  {bansLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {activeBans.length === 0 ? (
                  <div className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-4 text-[14px] text-[#666]">
                    No active bans.
                  </div>
                ) : (
                  activeBans.map((ban) => (
                    <div key={ban.id} className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-[#2F2F2F]">
                            User: {ban.banned_user_id}
                          </div>
                          <div className="mt-1 text-[13px] leading-5 text-[#666]">
                            {ban.reason}
                          </div>
                          <div className="mt-2 text-[12px] text-[#777]">
                            Ends: <span className="font-semibold">{formatBanEnd(ban.expires_at || null)}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={revokingBanId === ban.id}
                          onClick={() => void revoke(ban)}
                          className="rounded-full border border-red-600 px-4 py-2 text-[13px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {revokingBanId === ban.id ? "Revoking..." : "Revoke ban"}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>

      <BanUserModal
        open={banModalOpen}
        user={selectedUser}
        onClose={() => setBanModalOpen(false)}
        onBanned={() => {
          void loadBans();
        }}
      />
    </main>
  );
}