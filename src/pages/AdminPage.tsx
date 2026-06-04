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

  sessionsCreatedToday: number;
  sessionsCreatedWeek: number;
  sessionsCreatedMonth: number;

  sessionsHostedToday: number;
  sessionsHostedWeek: number;
  sessionsHostedMonth: number;

  attendanceRecordsToday: number;
  attendanceRecordsWeek: number;
  attendanceRecordsMonth: number;

  uniqueAttendeesToday: number;
  uniqueAttendeesWeek: number;
  uniqueAttendeesMonth: number;

  attendedSessionsToday: number;
  attendedSessionsWeek: number;
  attendedSessionsMonth: number;

  uniqueBookedUsersToday: number;
  uniqueBookedUsersWeek: number;
  uniqueBookedUsersMonth: number;

  activeHostsWeek: number;
  avgAttendeesPerHostedSessionWeek: number;
  bookedToAttendedConversionWeek: number;

  availableHostBalanceUsd: number;
  pendingPayoutUsd: number;
};

type ChartPoint = {
  label: string;
  dateKey: string;
  registrations: number;
  sessionsCreated: number;
  sessionsHosted: number;
  activeHosts: number;
  bookedUsers: number;
  attendanceRecords: number;
  uniqueAttendees: number;
  attendedSessions: number;
  avgAttendeesPerSession: number;
  supportUsd: number;
};

type ChartKey =
  | "registrations"
  | "sessionsCreated"
  | "sessionsHosted"
  | "activeHosts"
  | "bookedUsers"
  | "attendanceRecords"
  | "uniqueAttendees"
  | "attendedSessions"
  | "avgAttendeesPerSession"
  | "supportUsd";

type AnyRow = Record<string, any>;

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

function formatNumber(value: number, digits = 0) {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(safe);
}

function formatPercent(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${formatNumber(safe, 1)}%`;
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

function toMs(value?: string | null) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function toDateKey(value?: string | null) {
  const ms = toMs(value);
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function makeLastDays(days: number) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const key = d.toISOString().slice(0, 10);

    return {
      key,
      label: key.slice(5),
    };
  });
}

function getRowTimestamp(row: AnyRow): string {
  return String(
    row.created_at ||
    row.joined_at ||
    row.started_at ||
    row.entered_at ||
    row.first_seen_at ||
    row.last_seen_at ||
    row.updated_at ||
    row.left_at ||
    ""
  );
}

function getAttendanceUserId(row: AnyRow): string {
  return String(
    row.user_id ||
    row.participant_user_id ||
    row.attendee_user_id ||
    row.profile_id ||
    row.member_user_id ||
    ""
  ).trim();
}

function getAttendanceSessionId(row: AnyRow): string {
  return String(row.session_id || row.room_session_id || row.session || "").trim();
}

function getBookingUserId(row: AnyRow): string {
  return String(row.user_id || row.booked_user_id || row.profile_id || "").trim();
}

function getPaymentBadgeClass(status: string | null) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "paid") return "bg-[#DCFCE7] text-[#15803D]";
  if (normalized === "processing") return "bg-[#DBEAFE] text-[#1D4ED8]";
  if (normalized === "requested") return "bg-[#FEF3C7] text-[#92400E]";
  if (normalized === "rejected") return "bg-red-100 text-red-700";

  return "bg-[#E5E7EB] text-[#374151]";
}

function countRowsSince(rows: AnyRow[], fromIso: string) {
  const fromMs = toMs(fromIso);
  return rows.filter((row) => toMs(getRowTimestamp(row)) >= fromMs).length;
}

function uniqueCountSince(rows: AnyRow[], fromIso: string, getId: (row: AnyRow) => string) {
  const fromMs = toMs(fromIso);
  const set = new Set<string>();

  rows.forEach((row) => {
    if (toMs(getRowTimestamp(row)) < fromMs) return;
    const id = getId(row);
    if (id) set.add(id);
  });

  return set.size;
}

function countDistinctAttendanceSessionsSince(rows: AnyRow[], fromIso: string) {
  return uniqueCountSince(rows, fromIso, getAttendanceSessionId);
}

async function safeCount(
  table: string,
  column: string,
  fromIso: string,
  extra?: { lteNow?: boolean }
) {
  let q = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .gte(column, fromIso);

  if (extra?.lteNow) {
    q = q.lte(column, new Date().toISOString());
  }

  const { count, error } = await q;

  if (error) {
    console.warn(`[admin] count failed: ${table}.${column}`, error);
    return 0;
  }

  return count || 0;
}

async function loadRecentRows(table: string, fromIso: string, preferredColumn: string) {
  const attempts = [preferredColumn, "created_at", "joined_at", "started_at", "entered_at", "updated_at"];

  for (const column of Array.from(new Set(attempts))) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .gte(column, fromIso)
        .limit(10000);

      if (!error) return (data as AnyRow[]) || [];
    } catch {
      // try next
    }
  }

  const { data, error } = await supabase.from(table).select("*").limit(10000);

  if (error) {
    console.warn(`[admin] fallback row load failed: ${table}`, error);
    return [];
  }

  const fromMs = toMs(fromIso);
  return ((data as AnyRow[]) || []).filter((row) => toMs(getRowTimestamp(row)) >= fromMs);
}

function InteractiveLineChart({
  title,
  description,
  data,
  dataKey,
  color,
  money = false,
  percent = false,
  decimals = 0,
}: {
  title: string;
  description: string;
  data: ChartPoint[];
  dataKey: ChartKey;
  color: string;
  money?: boolean;
  percent?: boolean;
  decimals?: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const values = data.map((d) => Number(d[dataKey] || 0));
  const max = Math.max(...values, 1);
  const total = values.reduce((sum, value) => sum + value, 0);

  const chartWidth = 100;
  const topPad = 5;
  const bottomPad = 36;
  const usableHeight = bottomPad - topPad;

  const getX = (index: number) =>
    values.length <= 1 ? 0 : (index / (values.length - 1)) * chartWidth;

  const getY = (value: number) => bottomPad - (value / max) * usableHeight;

  const points = values.map((value, index) => `${getX(index)},${getY(value)}`).join(" ");

  const activeIndex = hoverIndex ?? Math.max(0, values.length - 1);
  const activePoint = data[activeIndex];
  const activeValue = values[activeIndex] || 0;
  const activeX = getX(activeIndex);
  const activeY = getY(activeValue);

  const displayValue = money
    ? formatMoney(activeValue)
    : percent
      ? formatPercent(activeValue)
      : formatNumber(activeValue, decimals);

  const totalValue = money
    ? formatMoney(total)
    : percent
      ? formatPercent(total / Math.max(data.length, 1))
      : formatNumber(total, decimals);

  return (
    <div className="rounded-[22px] border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-bold text-[#2F2F2F]">{title}</h3>
          <p className="mt-1 text-[12px] text-[#777]">{description}</p>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#999]">
            {percent ? "14d avg" : "14d total"}
          </div>
          <div className="text-[18px] font-bold text-[#2F2F2F]">{totalValue}</div>
        </div>
      </div>

      <div className="mt-3 rounded-2xl bg-gray-50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#777]">
              Hovered day
            </div>
            <div className="mt-1 text-[14px] font-bold text-[#2F2F2F]">
              {activePoint?.dateKey || "—"}
            </div>
          </div>

          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#777]">
              Value
            </div>
            <div className="mt-1 text-[18px] font-bold" style={{ color }}>
              {displayValue}
            </div>
          </div>
        </div>
      </div>

      <div className="relative mt-4">
        <svg viewBox="0 0 100 46" className="h-28 w-full overflow-visible">
          <line x1="0" y1="36" x2="100" y2="36" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
          <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(0,0,0,0.06)" strokeWidth="1" />
          <line x1="0" y1="14" x2="100" y2="14" stroke="rgba(0,0,0,0.06)" strokeWidth="1" />
          <line x1="0" y1="5" x2="100" y2="5" stroke="rgba(0,0,0,0.06)" strokeWidth="1" />

          {hoverIndex !== null && (
            <line
              x1={activeX}
              y1="4"
              x2={activeX}
              y2="38"
              stroke={color}
              strokeWidth="0.8"
              strokeDasharray="2 2"
              opacity="0.75"
            />
          )}

          <polyline
            fill="none"
            stroke={color}
            strokeWidth="9"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
            opacity="0.12"
          />

          <polyline
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />

          {values.map((value, index) => {
            const x = getX(index);
            const y = getY(value);
            const active = index === activeIndex;

            return (
              <g key={`${title}-${index}`}>
                <circle
                  cx={x}
                  cy={y}
                  r={active ? "3.7" : "2.3"}
                  fill="white"
                  stroke={color}
                  strokeWidth={active ? "2.4" : "1.8"}
                />

                <rect
                  x={x - 4}
                  y="0"
                  width="8"
                  height="44"
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex(null)}
                  className="cursor-crosshair"
                />
              </g>
            );
          })}

          {hoverIndex !== null && (
            <g>
              <rect
                x={Math.min(Math.max(activeX - 16, 0), 68)}
                y={Math.max(activeY - 15, 1)}
                width="32"
                height="10"
                rx="3"
                fill="white"
                stroke={color}
                strokeWidth="0.8"
              />
              <text
                x={Math.min(Math.max(activeX, 16), 84)}
                y={Math.max(activeY - 8, 8)}
                textAnchor="middle"
                fontSize="3.5"
                fontWeight="700"
                fill={color}
              >
                {displayValue}
              </text>
            </g>
          )}
        </svg>

        <div className="mt-1 flex justify-between text-[10px] text-[#999]">
          <span>{data[0]?.label || "—"}</span>
          <span>{data[data.length - 1]?.label || "—"}</span>
        </div>
      </div>
    </div>
  );
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
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [error, setError] = useState("");

  const [stats, setStats] = useState<AdminStats>({
    registrationsToday: 0,
    registrationsWeek: 0,
    registrationsMonth: 0,

    sessionsCreatedToday: 0,
    sessionsCreatedWeek: 0,
    sessionsCreatedMonth: 0,

    sessionsHostedToday: 0,
    sessionsHostedWeek: 0,
    sessionsHostedMonth: 0,

    attendanceRecordsToday: 0,
    attendanceRecordsWeek: 0,
    attendanceRecordsMonth: 0,

    uniqueAttendeesToday: 0,
    uniqueAttendeesWeek: 0,
    uniqueAttendeesMonth: 0,

    attendedSessionsToday: 0,
    attendedSessionsWeek: 0,
    attendedSessionsMonth: 0,

    uniqueBookedUsersToday: 0,
    uniqueBookedUsersWeek: 0,
    uniqueBookedUsersMonth: 0,

    activeHostsWeek: 0,
    avgAttendeesPerHostedSessionWeek: 0,
    bookedToAttendedConversionWeek: 0,

    availableHostBalanceUsd: 0,
    pendingPayoutUsd: 0,
  });

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

  const loadDashboard = async () => {
    try {
      setDashboardLoading(true);
      setError("");

      const todayIso = startOfDayIso();
      const weekIso = daysAgoIso(7);
      const monthIso = daysAgoIso(30);
      const chartIso = daysAgoIso(14);
      const nowIso = new Date().toISOString();

      const [
        registrationsToday,
        registrationsWeek,
        registrationsMonth,

        sessionsCreatedToday,
        sessionsCreatedWeek,
        sessionsCreatedMonth,

        sessionsHostedToday,
        sessionsHostedWeek,
        sessionsHostedMonth,

        notificationsResult,
        payoutsResult,
        paymentsResult,
        attendanceRows,
        bookingRows,
        weeklySessionsResult,
        registrationsChartResult,
        sessionsCreatedChartResult,
        sessionsHostedChartResult,
        paymentsChartResult,
      ] = await Promise.all([
        safeCount("profiles", "created_at", todayIso),
        safeCount("profiles", "created_at", weekIso),
        safeCount("profiles", "created_at", monthIso),

        safeCount("sessions", "created_at", todayIso),
        safeCount("sessions", "created_at", weekIso),
        safeCount("sessions", "created_at", monthIso),

        safeCount("sessions", "start_time", todayIso, { lteNow: true }),
        safeCount("sessions", "start_time", weekIso, { lteNow: true }),
        safeCount("sessions", "start_time", monthIso, { lteNow: true }),

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

        supabase.from("host_support_payments").select("host_amount_usd, status"),

        loadRecentRows("session_attendance", monthIso, "created_at"),
        loadRecentRows("session_bookings", monthIso, "created_at"),

        supabase.from("sessions").select("host_id").gte("created_at", weekIso),

        supabase.from("profiles").select("id, created_at").gte("created_at", chartIso),
        supabase.from("sessions").select("id, host_id, created_at").gte("created_at", chartIso),

        supabase
          .from("sessions")
          .select("id, host_id, start_time")
          .gte("start_time", chartIso)
          .lte("start_time", nowIso),

        supabase
          .from("host_support_payments")
          .select("host_amount_usd, status, created_at")
          .gte("created_at", chartIso),
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

      const payments = (paymentsResult.data as AnyRow[]) || [];
      const availableHostBalanceUsd = payments.reduce((sum, p) => {
        if (String(p.status || "").toLowerCase() !== "available") return sum;
        return sum + Number(p.host_amount_usd || 0);
      }, 0);

      const payoutRows = ((payoutsResult.data as AnyRow[]) || []) as PayoutRequestRow[];
      const pendingPayoutUsd = payoutRows.reduce((sum, p) => {
        const status = String(p.status || "").toLowerCase();
        if (status !== "requested" && status !== "processing") return sum;
        return sum + Number(p.amount_usd || 0);
      }, 0);

      const weeklyHosts = new Set(
        ((weeklySessionsResult.data as AnyRow[]) || []).map((s) => s.host_id).filter(Boolean)
      );

      const attendanceRecordsToday = countRowsSince(attendanceRows, todayIso);
      const attendanceRecordsWeek = countRowsSince(attendanceRows, weekIso);
      const attendanceRecordsMonth = countRowsSince(attendanceRows, monthIso);

      const uniqueAttendeesToday = uniqueCountSince(attendanceRows, todayIso, getAttendanceUserId);
      const uniqueAttendeesWeek = uniqueCountSince(attendanceRows, weekIso, getAttendanceUserId);
      const uniqueAttendeesMonth = uniqueCountSince(attendanceRows, monthIso, getAttendanceUserId);

      const attendedSessionsToday = countDistinctAttendanceSessionsSince(attendanceRows, todayIso);
      const attendedSessionsWeek = countDistinctAttendanceSessionsSince(attendanceRows, weekIso);
      const attendedSessionsMonth = countDistinctAttendanceSessionsSince(attendanceRows, monthIso);

      const uniqueBookedUsersToday = uniqueCountSince(bookingRows, todayIso, getBookingUserId);
      const uniqueBookedUsersWeek = uniqueCountSince(bookingRows, weekIso, getBookingUserId);
      const uniqueBookedUsersMonth = uniqueCountSince(bookingRows, monthIso, getBookingUserId);

      const avgAttendeesPerHostedSessionWeek =
        sessionsHostedWeek > 0 ? uniqueAttendeesWeek / sessionsHostedWeek : 0;

      const bookedToAttendedConversionWeek =
        uniqueBookedUsersWeek > 0 ? (uniqueAttendeesWeek / uniqueBookedUsersWeek) * 100 : 0;

      const days = makeLastDays(14);

      const registrationsByDay = new Map<string, number>();
      const sessionsCreatedByDay = new Map<string, number>();
      const sessionsHostedByDay = new Map<string, number>();
      const activeHostsByDay = new Map<string, Set<string>>();
      const bookedUsersByDay = new Map<string, Set<string>>();
      const attendanceRecordsByDay = new Map<string, number>();
      const uniqueAttendeesByDay = new Map<string, Set<string>>();
      const attendedSessionsByDay = new Map<string, Set<string>>();
      const supportByDay = new Map<string, number>();

      for (const day of days) {
        registrationsByDay.set(day.key, 0);
        sessionsCreatedByDay.set(day.key, 0);
        sessionsHostedByDay.set(day.key, 0);
        activeHostsByDay.set(day.key, new Set());
        bookedUsersByDay.set(day.key, new Set());
        attendanceRecordsByDay.set(day.key, 0);
        uniqueAttendeesByDay.set(day.key, new Set());
        attendedSessionsByDay.set(day.key, new Set());
        supportByDay.set(day.key, 0);
      }

      for (const row of ((registrationsChartResult.data as AnyRow[]) || [])) {
        const key = toDateKey(row.created_at);
        if (!key || !registrationsByDay.has(key)) continue;
        registrationsByDay.set(key, (registrationsByDay.get(key) || 0) + 1);
      }

      for (const row of ((sessionsCreatedChartResult.data as AnyRow[]) || [])) {
        const key = toDateKey(row.created_at);
        if (!key || !sessionsCreatedByDay.has(key)) continue;
        sessionsCreatedByDay.set(key, (sessionsCreatedByDay.get(key) || 0) + 1);
        if (row.host_id) activeHostsByDay.get(key)?.add(row.host_id);
      }

      for (const row of ((sessionsHostedChartResult.data as AnyRow[]) || [])) {
        const key = toDateKey(row.start_time);
        if (!key || !sessionsHostedByDay.has(key)) continue;
        sessionsHostedByDay.set(key, (sessionsHostedByDay.get(key) || 0) + 1);
        if (row.host_id) activeHostsByDay.get(key)?.add(row.host_id);
      }

      for (const row of bookingRows) {
        const key = toDateKey(getRowTimestamp(row));
        const userId = getBookingUserId(row);
        if (!key || !userId || !bookedUsersByDay.has(key)) continue;
        bookedUsersByDay.get(key)?.add(userId);
      }

      for (const row of attendanceRows) {
        const key = toDateKey(getRowTimestamp(row));
        if (!key || !attendanceRecordsByDay.has(key)) continue;

        attendanceRecordsByDay.set(key, (attendanceRecordsByDay.get(key) || 0) + 1);

        const userId = getAttendanceUserId(row);
        const sessionId = getAttendanceSessionId(row);

        if (userId) uniqueAttendeesByDay.get(key)?.add(userId);
        if (sessionId) attendedSessionsByDay.get(key)?.add(sessionId);
      }

      for (const row of ((paymentsChartResult.data as AnyRow[]) || [])) {
        const key = toDateKey(row.created_at);
        if (!key || !supportByDay.has(key)) continue;

        const status = String(row.status || "").toLowerCase();
        if (status !== "available" && status !== "paid_out") continue;

        supportByDay.set(
          key,
          (supportByDay.get(key) || 0) + Number(row.host_amount_usd || 0)
        );
      }

      setChartData(
        days.map((day) => {
          const uniqueAttendees = uniqueAttendeesByDay.get(day.key)?.size || 0;
          const attendedSessions = attendedSessionsByDay.get(day.key)?.size || 0;

          return {
            label: day.label,
            dateKey: day.key,
            registrations: registrationsByDay.get(day.key) || 0,
            sessionsCreated: sessionsCreatedByDay.get(day.key) || 0,
            sessionsHosted: sessionsHostedByDay.get(day.key) || 0,
            activeHosts: activeHostsByDay.get(day.key)?.size || 0,
            bookedUsers: bookedUsersByDay.get(day.key)?.size || 0,
            attendanceRecords: attendanceRecordsByDay.get(day.key) || 0,
            uniqueAttendees,
            attendedSessions,
            avgAttendeesPerSession:
              attendedSessions > 0 ? Number((uniqueAttendees / attendedSessions).toFixed(2)) : 0,
            supportUsd: Number((supportByDay.get(day.key) || 0).toFixed(2)),
          };
        })
      );

      setStats({
        registrationsToday,
        registrationsWeek,
        registrationsMonth,

        sessionsCreatedToday,
        sessionsCreatedWeek,
        sessionsCreatedMonth,

        sessionsHostedToday,
        sessionsHostedWeek,
        sessionsHostedMonth,

        attendanceRecordsToday,
        attendanceRecordsWeek,
        attendanceRecordsMonth,

        uniqueAttendeesToday,
        uniqueAttendeesWeek,
        uniqueAttendeesMonth,

        attendedSessionsToday,
        attendedSessionsWeek,
        attendedSessionsMonth,

        uniqueBookedUsersToday,
        uniqueBookedUsersWeek,
        uniqueBookedUsersMonth,

        activeHostsWeek: weeklyHosts.size,
        avgAttendeesPerHostedSessionWeek,
        bookedToAttendedConversionWeek,

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

      if (nextStatus === "paid") payload.admin_note = "Marked as paid from admin dashboard.";
      if (nextStatus === "rejected") payload.admin_note = "Rejected from admin dashboard.";

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

              <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-black/10 bg-white px-3 text-[13px] font-bold">
                🔔 {unreadNotifications}
              </span>
            </div>

            <h1 className="mt-2 text-[34px] font-bold">
              {tab === "dashboard" ? "Admin dashboard" : "Moderation"}
            </h1>

            <p className="mt-2 max-w-3xl text-[14px] leading-6 text-[#666]">
              Attendance now uses <b>session_attendance</b>. Attendance records = all rows. Unique attendees = distinct users. Attended sessions = distinct sessions with attendance.
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

                ["Sessions created today", stats.sessionsCreatedToday],
                ["Sessions created 7d", stats.sessionsCreatedWeek],
                ["Sessions created 30d", stats.sessionsCreatedMonth],

                ["Sessions hosted today", stats.sessionsHostedToday],
                ["Sessions hosted 7d", stats.sessionsHostedWeek],
                ["Sessions hosted 30d", stats.sessionsHostedMonth],

                ["Attendance records today", stats.attendanceRecordsToday],
                ["Attendance records 7d", stats.attendanceRecordsWeek],
                ["Attendance records 30d", stats.attendanceRecordsMonth],

                ["Unique attendees today", stats.uniqueAttendeesToday],
                ["Unique attendees 7d", stats.uniqueAttendeesWeek],
                ["Unique attendees 30d", stats.uniqueAttendeesMonth],

                ["Attended sessions today", stats.attendedSessionsToday],
                ["Attended sessions 7d", stats.attendedSessionsWeek],
                ["Attended sessions 30d", stats.attendedSessionsMonth],

                ["Booked users today", stats.uniqueBookedUsersToday],
                ["Booked users 7d", stats.uniqueBookedUsersWeek],
                ["Booked users 30d", stats.uniqueBookedUsersMonth],

                ["Active hosts 7d", stats.activeHostsWeek],
                ["Avg attendees/session 7d", formatNumber(stats.avgAttendeesPerHostedSessionWeek, 2)],
                ["Booked → attended 7d", formatPercent(stats.bookedToAttendedConversionWeek)],

                ["Available host balance", formatMoney(stats.availableHostBalanceUsd)],
                ["Pending payouts", formatMoney(stats.pendingPayoutUsd)],
                ["Open payout requests", requestedPayouts.length],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[22px] border border-black/10 bg-gray-50 p-5">
                  <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                    {label}
                  </div>
                  <div className="mt-2 text-[28px] font-bold text-[#2F2F2F]">{value}</div>
                </div>
              ))}
            </section>

            <section className="mt-8">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-[20px] font-bold">Growth charts</h2>
                  <p className="mt-1 text-[13px] text-[#666]">
                    Hover points to inspect exact daily values.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void loadDashboard()}
                  className="rounded-full border border-black/10 px-4 py-2 text-[13px] font-semibold hover:bg-black/[0.04]"
                >
                  {dashboardLoading ? "Refreshing..." : "Refresh charts"}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <InteractiveLineChart title="New registrations" description="New profile rows created per day." data={chartData} dataKey="registrations" color="#2563EB" />
                <InteractiveLineChart title="Sessions created" description="New sessions created per day." data={chartData} dataKey="sessionsCreated" color="#7C3AED" />
                <InteractiveLineChart title="Sessions hosted" description="Sessions whose start_time has already happened." data={chartData} dataKey="sessionsHosted" color="#059669" />
                <InteractiveLineChart title="Active hosts" description="Unique hosts creating or hosting sessions per day." data={chartData} dataKey="activeHosts" color="#EA580C" />
                <InteractiveLineChart title="Unique booked users" description="Unique users booking sessions per day." data={chartData} dataKey="bookedUsers" color="#0891B2" />
                <InteractiveLineChart title="Attendance records" description="All rows from session_attendance per day." data={chartData} dataKey="attendanceRecords" color="#DC2626" />
                <InteractiveLineChart title="Unique attendees" description="Distinct users from session_attendance per day." data={chartData} dataKey="uniqueAttendees" color="#BE123C" />
                <InteractiveLineChart title="Attended sessions" description="Distinct session_id values from session_attendance per day." data={chartData} dataKey="attendedSessions" color="#4338CA" />
                <InteractiveLineChart title="Avg attendees/session" description="Unique attendees divided by attended sessions." data={chartData} dataKey="avgAttendeesPerSession" color="#C2410C" decimals={2} />
                <InteractiveLineChart title="Host support received" description="Available or paid-out host support per day." data={chartData} dataKey="supportUsd" color="#16A34A" money />
              </div>
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
                              <div className="text-[15px] font-bold">
                                {formatMoney(Number(payout.amount_usd || 0))}
                              </div>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${getPaymentBadgeClass(status)}`}>
                                {status}
                              </span>
                            </div>

                            <div className="mt-1 text-[13px] text-[#666]">
                              Host: <span className="font-semibold">{hostName}</span>
                            </div>

                            <div className="mt-1 text-[12px] text-[#777]">
                              Requested: {formatDateTime(payout.requested_at || payout.created_at)}
                            </div>

                            {payout.note ? <div className="mt-2 text-[13px] text-[#666]">{payout.note}</div> : null}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={processingPayoutId === payout.id || status === "processing"} onClick={() => void updatePayoutStatus(payout, "processing")} className="rounded-full border border-blue-600 px-4 py-2 text-[13px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                              Processing
                            </button>

                            <button type="button" disabled={processingPayoutId === payout.id || status === "paid"} onClick={() => void updatePayoutStatus(payout, "paid")} className="rounded-full bg-green-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                              Mark paid
                            </button>

                            <button type="button" disabled={processingPayoutId === payout.id || status === "rejected"} onClick={() => void updatePayoutStatus(payout, "rejected")} className="rounded-full border border-red-600 px-4 py-2 text-[13px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
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
                      className={`rounded-2xl border px-4 py-4 ${notification.read_at ? "border-black/10 bg-gray-50" : "border-blue-200 bg-blue-50"
                        }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="text-[14px] font-bold">{notification.title}</div>
                          {notification.body ? <div className="mt-1 text-[13px] text-[#666]">{notification.body}</div> : null}
                          <div className="mt-2 text-[12px] text-[#777]">
                            {notification.type} · {formatDateTime(notification.created_at)}
                          </div>
                        </div>

                        {!notification.read_at && (
                          <button type="button" onClick={() => void markNotificationRead(notification)} className="rounded-full border border-blue-600 px-4 py-2 text-[13px] font-semibold text-blue-700 hover:bg-blue-100">
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
                      <div key={u.id} className="flex flex-col gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
                          <div className="mt-1 text-[13px] leading-5 text-[#666]">{ban.reason}</div>
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