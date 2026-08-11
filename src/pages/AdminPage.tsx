import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  formatBanEnd,
  isCurrentUserAdmin,
  isQuietRestriction,
  listActiveBans,
  revokeUserBan,
  searchAdminUsers,
  type ActiveBan,
} from "../lib/bans";
import BanUserModal from "../components/BanUserModal";

type AnyRow = Record<string, any>;

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
  openPayoutRequests: number;
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
  pendingPayoutUsd: number;
  openPayoutRequests: number;
};

type ChartKey = keyof Omit<ChartPoint, "label" | "dateKey">;

type ProfileSummary = {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string;
};

type SessionActivityRow = {
  id: string;
  title: string;
  host: ProfileSummary;
  createdAt: string;
  startsAt: string;
  type: string;
  bookings: number;
  uniqueAttendees: number;
  attendanceRecords: number;
};

type PersonActivityRow = {
  id: string;
  user: ProfileSummary;
  sessionId: string;
  sessionTitle: string;
  occurredAt: string;
  secondaryAt?: string;
};

type AdminActivityData = {
  sessions: SessionActivityRow[];
  bookings: PersonActivityRow[];
  attendance: PersonActivityRow[];
};

type MonthlyAttendancePoint = {
  key: string;
  label: string;
  uniqueAttendees: number;
  attendanceRecords: number;
  attendedSessions: number;
};

const EMPTY_ACTIVITY: AdminActivityData = {
  sessions: [],
  bookings: [],
  attendance: [],
};

function emptyProfile(id = ""): ProfileSummary {
  return {
    id,
    fullName: id ? `User ${id.slice(0, 8)}` : "Unknown user",
    email: "",
    avatarUrl: "",
  };
}

function getInitial(name: string) {
  return (String(name || "").trim()[0] || "U").toUpperCase();
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number) {
  return `${formatNumber(value, 1)}%`;
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

function startOfLocalDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfDayIso() {
  return startOfLocalDay().toISOString();
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function toMs(value?: string | null) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function toLocalDateKey(value?: string | null) {
  const ms = toMs(value);
  if (!ms) return "";

  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function makeLastDays(days: number) {
  return Array.from({ length: days }, (_, i) => {
    const d = startOfLocalDay();
    d.setDate(d.getDate() - (days - 1 - i));

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${day}`;

    return {
      key,
      label: `${m}-${day}`,
    };
  });
}

function makeLastMonths(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    date.setMonth(date.getMonth() - (count - 1 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return {
      key,
      label: new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(date),
    };
  });
}

function toLocalMonthKey(value?: string | null) {
  const ms = toMs(value);
  if (!ms) return "";
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthlyAttendance(rows: AnyRow[], count = 6): MonthlyAttendancePoint[] {
  const months = makeLastMonths(count);
  const people = new Map<string, Set<string>>();
  const sessions = new Map<string, Set<string>>();
  const records = new Map<string, number>();

  months.forEach(({ key }) => {
    people.set(key, new Set());
    sessions.set(key, new Set());
    records.set(key, 0);
  });

  rows.forEach((row) => {
    const key = toLocalMonthKey(getRowTimestamp(row));
    if (!people.has(key)) return;
    const userId = getAttendanceUserId(row);
    const sessionId = getAttendanceSessionId(row);
    if (userId) people.get(key)?.add(userId);
    if (sessionId) sessions.get(key)?.add(sessionId);
    records.set(key, (records.get(key) || 0) + 1);
  });

  return months.map(({ key, label }) => ({
    key,
    label,
    uniqueAttendees: people.get(key)?.size || 0,
    attendanceRecords: records.get(key) || 0,
    attendedSessions: sessions.get(key)?.size || 0,
  }));
}

function getRowTimestamp(row: AnyRow): string {
  return String(
    row.created_at ||
    row.joined_at ||
    row.join_time ||
    row.started_at ||
    row.entered_at ||
    row.first_seen_at ||
    row.last_seen_at ||
    row.updated_at ||
    row.left_at ||
    row.checked_in_at ||
    row.attended_at ||
    ""
  );
}

function getAttendanceUserId(row: AnyRow): string {
  return String(
    row.user_id ||
    row.attendee_user_id ||
    row.participant_user_id ||
    row.profile_id ||
    row.member_user_id ||
    row.userId ||
    row.attendeeId ||
    row.participantId ||
    row.identity ||
    row.participant_identity ||
    ""
  ).trim();
}

function getAttendanceSessionId(row: AnyRow): string {
  return String(
    row.session_id ||
    row.room_session_id ||
    row.sessionId ||
    row.session ||
    row.room_id ||
    ""
  ).trim();
}

function getBookingUserId(row: AnyRow): string {
  return String(
    row.user_id ||
    row.booked_user_id ||
    row.profile_id ||
    row.userId ||
    ""
  ).trim();
}


function getBookingSessionId(row: AnyRow): string {
  return String(row.session_id || row.room_session_id || row.sessionId || row.session || "").trim();
}

function getSessionTitle(row: AnyRow): string {
  return String(row.title || row.name || row.session_name || row.template_name || "Untitled session").trim();
}

function getSessionType(row: AnyRow): string {
  if (row.is_infinite) return "Infinite";
  if (row.is_one_on_one || row.session_kind === "one_on_one") return "1:1";
  return String(row.session_type || row.focus_type || row.type || "Session").replaceAll("_", " ");
}

function getAttendanceTimestamp(row: AnyRow): string {
  return String(row.joined_at || row.join_time || row.first_seen_at || row.created_at || row.entered_at || "");
}

function getBookingTimestamp(row: AnyRow): string {
  return String(row.created_at || row.booked_at || row.updated_at || "");
}

async function loadProfilesByIds(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const profiles = new Map<string, ProfileSummary>();

  for (let index = 0; index < uniqueIds.length; index += 200) {
    const chunk = uniqueIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", chunk);

    if (error) {
      console.warn("[admin] profile activity lookup failed", error);
      continue;
    }

    ((data as AnyRow[]) || []).forEach((row) => {
      const id = String(row.id || "");
      profiles.set(id, {
        id,
        fullName: String(row.full_name || row.email || `User ${id.slice(0, 8)}`),
        email: String(row.email || ""),
        avatarUrl: String(row.avatar_url || ""),
      });
    });
  }

  return profiles;
}

async function loadSessionsForActivity(fromIso: string, linkedSessionIds: string[]) {
  const byId = new Map<string, AnyRow>();
  const recent = await supabase
    .from("sessions")
    .select("*")
    .gte("created_at", fromIso)
    .order("created_at", { ascending: false })
    .limit(500);

  if (recent.error) console.warn("[admin] recent sessions lookup failed", recent.error);
  ((recent.data as AnyRow[]) || []).forEach((row) => byId.set(String(row.id), row));

  const missing = [...new Set(linkedSessionIds.filter(Boolean))].filter((id) => !byId.has(id));
  for (let index = 0; index < missing.length; index += 200) {
    const chunk = missing.slice(index, index + 200);
    const result = await supabase.from("sessions").select("*").in("id", chunk);
    if (result.error) {
      console.warn("[admin] linked sessions lookup failed", result.error);
      continue;
    }
    ((result.data as AnyRow[]) || []).forEach((row) => byId.set(String(row.id), row));
  }

  return byId;
}

async function buildAdminActivity(
  attendanceRows: AnyRow[],
  bookingRows: AnyRow[],
  fromIso: string,
): Promise<AdminActivityData> {
  const linkedSessionIds = [
    ...attendanceRows.map(getAttendanceSessionId),
    ...bookingRows.map(getBookingSessionId),
  ];
  const sessionsById = await loadSessionsForActivity(fromIso, linkedSessionIds);
  const profileIds = [
    ...[...sessionsById.values()].map((row) => String(row.host_id || row.created_by || "")),
    ...attendanceRows.map(getAttendanceUserId),
    ...bookingRows.map(getBookingUserId),
  ];
  const profiles = await loadProfilesByIds(profileIds);
  const attendanceBySession = new Map<string, AnyRow[]>();
  const bookingsBySession = new Map<string, AnyRow[]>();

  attendanceRows.forEach((row) => {
    const id = getAttendanceSessionId(row);
    if (id) attendanceBySession.set(id, [...(attendanceBySession.get(id) || []), row]);
  });
  bookingRows.forEach((row) => {
    const id = getBookingSessionId(row);
    if (id) bookingsBySession.set(id, [...(bookingsBySession.get(id) || []), row]);
  });

  const sessions = [...sessionsById.values()]
    .map((row) => {
      const id = String(row.id || "");
      const attendance = attendanceBySession.get(id) || [];
      const uniqueAttendees = new Set(attendance.map(getAttendanceUserId).filter(Boolean));
      const hostId = String(row.host_id || row.created_by || "");
      return {
        id,
        title: getSessionTitle(row),
        host: profiles.get(hostId) || emptyProfile(hostId),
        createdAt: String(row.created_at || ""),
        startsAt: String(row.start_time || row.starts_at || ""),
        type: getSessionType(row),
        bookings: (bookingsBySession.get(id) || []).length,
        uniqueAttendees: uniqueAttendees.size,
        attendanceRecords: attendance.length,
      };
    })
    .sort((a, b) => Math.max(toMs(b.startsAt), toMs(b.createdAt)) - Math.max(toMs(a.startsAt), toMs(a.createdAt)));

  const bookings = bookingRows
    .map((row, index) => {
      const userId = getBookingUserId(row);
      const sessionId = getBookingSessionId(row);
      return {
        id: String(row.id || `booking-${sessionId}-${userId}-${index}`),
        user: profiles.get(userId) || emptyProfile(userId),
        sessionId,
        sessionTitle: getSessionTitle(sessionsById.get(sessionId) || { title: sessionId || "Unknown session" }),
        occurredAt: getBookingTimestamp(row),
        secondaryAt: String(row.booked_start_time || ""),
      };
    })
    .sort((a, b) => toMs(b.occurredAt) - toMs(a.occurredAt));

  const attendance = attendanceRows
    .map((row, index) => {
      const userId = getAttendanceUserId(row);
      const sessionId = getAttendanceSessionId(row);
      return {
        id: String(row.id || `attendance-${sessionId}-${userId}-${index}`),
        user: profiles.get(userId) || emptyProfile(userId),
        sessionId,
        sessionTitle: getSessionTitle(sessionsById.get(sessionId) || { title: sessionId || "Unknown session" }),
        occurredAt: getAttendanceTimestamp(row),
        secondaryAt: String(row.last_seen_at || row.left_at || row.updated_at || ""),
      };
    })
    .sort((a, b) => toMs(b.occurredAt) - toMs(a.occurredAt));

  return { sessions, bookings, attendance };
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

  if (extra?.lteNow) q = q.lte(column, new Date().toISOString());

  const { count, error } = await q;

  if (error) {
    console.warn(`[admin] count failed: ${table}.${column}`, error);
    return 0;
  }

  return count || 0;
}

async function loadRecentRows(table: string, fromIso: string, preferredColumn: string) {
  const attempts = [
    preferredColumn,
    "created_at",
    "joined_at",
    "join_time",
    "started_at",
    "entered_at",
    "checked_in_at",
    "attended_at",
    "updated_at",
  ];
  const pageSize = 1000;
  const maxPages = 50;

  for (const column of Array.from(new Set(attempts))) {
    const rows: AnyRow[] = [];
    let failed = false;

    for (let page = 0; page < maxPages; page += 1) {
      const from = page * pageSize;
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .gte(column, fromIso)
        .order(column, { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        failed = true;
        break;
      }

      const pageRows = (data as AnyRow[]) || [];
      rows.push(...pageRows);
      if (pageRows.length < pageSize) break;
    }

    if (!failed) return rows;
  }

  const fallbackRows: AnyRow[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);

    if (error) {
      console.warn(`[admin] fallback row load failed: ${table}`, error);
      return [];
    }

    const pageRows = (data as AnyRow[]) || [];
    fallbackRows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }

  const fromMs = toMs(fromIso);
  return fallbackRows.filter((row) => toMs(getRowTimestamp(row)) >= fromMs);
}

function MiniMetricChart({
  data,
  dataKey,
  color,
  money = false,
  percent = false,
  decimals = 0,
}: {
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
  const activeIndex = hoverIndex ?? Math.max(0, data.length - 1);

  const getX = (index: number) =>
    values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;

  const getY = (value: number) => 34 - (value / max) * 28;

  const points = values.map((value, index) => `${getX(index)},${getY(value)}`).join(" ");

  const activeValue = values[activeIndex] || 0;
  const activePoint = data[activeIndex];
  const activeX = getX(activeIndex);
  const activeY = getY(activeValue);

  const displayValue = money
    ? formatMoney(activeValue)
    : percent
      ? formatPercent(activeValue)
      : formatNumber(activeValue, decimals);

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between rounded-xl bg-white/70 px-3 py-2 text-[11px]">
        <span className="font-semibold text-[#777]">
          {activePoint?.dateKey || "—"}
        </span>
        <span className="font-bold" style={{ color }}>
          {displayValue}
        </span>
      </div>

      <svg viewBox="0 0 100 40" className="h-20 w-full overflow-visible">
        <line x1="0" y1="34" x2="100" y2="34" stroke="rgba(0,0,0,0.12)" />
        <line x1="0" y1="20" x2="100" y2="20" stroke="rgba(0,0,0,0.06)" />
        <line x1="0" y1="6" x2="100" y2="6" stroke="rgba(0,0,0,0.06)" />

        <polyline
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
          opacity="0.12"
        />

        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />

        {hoverIndex !== null && (
          <line
            x1={activeX}
            y1="4"
            x2={activeX}
            y2="36"
            stroke={color}
            strokeWidth="0.8"
            strokeDasharray="2 2"
          />
        )}

        {values.map((value, index) => {
          const x = getX(index);
          const y = getY(value);
          const active = index === activeIndex;

          return (
            <g key={`${String(dataKey)}-${index}`}>
              <circle
                cx={x}
                cy={y}
                r={active ? 3.4 : 2.2}
                fill="white"
                stroke={color}
                strokeWidth={active ? 2.4 : 1.7}
              />

              <rect
                x={x - 4}
                y="0"
                width="8"
                height="40"
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            </g>
          );
        })}

        {hoverIndex !== null && (
          <g>
            <rect
              x={Math.min(Math.max(activeX - 15, 0), 70)}
              y={Math.max(activeY - 14, 1)}
              width="30"
              height="9"
              rx="3"
              fill="white"
              stroke={color}
              strokeWidth="0.8"
            />
            <text
              x={Math.min(Math.max(activeX, 15), 85)}
              y={Math.max(activeY - 8, 8)}
              textAnchor="middle"
              fontSize="3.2"
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
  );
}

function MetricCard({
  label,
  value,
  hint,
  data,
  dataKey,
  color,
  money,
  percent,
  decimals,
}: {
  label: string;
  value: string | number;
  hint: string;
  data: ChartPoint[];
  dataKey: ChartKey;
  color: string;
  money?: boolean;
  percent?: boolean;
  decimals?: number;
}) {
  return (
    <div className="rounded-[24px] border border-black/10 bg-gray-50 p-5 shadow-sm">
      <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
        {label}
      </div>

      <div className="mt-2 text-[30px] font-bold text-[#2F2F2F]">
        {value}
      </div>

      <p className="mt-1 text-[12px] leading-5 text-[#777]">{hint}</p>

      <MiniMetricChart
        data={data}
        dataKey={dataKey}
        color={color}
        money={money}
        percent={percent}
        decimals={decimals}
      />
    </div>
  );
}

function ProfileChip({ profile }: { profile: ProfileSummary }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {profile.avatarUrl ? (
        <img src={profile.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#EEF2F6] text-[12px] font-bold">
          {getInitial(profile.fullName)}
        </span>
      )}
      <span className="min-w-0">
        <b className="block truncate text-[13px]">{profile.fullName}</b>
        <small className="block truncate text-[11px] text-[#777]">
          {profile.email || profile.id.slice(0, 12)}
        </small>
      </span>
    </div>
  );
}

function MonthlyAttendanceChart({ data }: { data: MonthlyAttendancePoint[] }) {
  const max = Math.max(...data.map((item) => item.uniqueAttendees), 1);

  return (
    <section className="mt-8 overflow-hidden rounded-[28px] bg-[#1F2328] p-6 text-white">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">
            Retention pulse
          </div>
          <h2 className="mt-1 text-[22px] font-bold">Unique attendance by month</h2>
          <p className="mt-1 text-[13px] text-white/55">
            Distinct people who produced at least one attendance record in each calendar month.
          </p>
        </div>
        <div className="rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white/75">
          Last {data.length} months
        </div>
      </div>

      <div className="mt-7 grid h-56 grid-cols-6 items-end gap-2 sm:gap-4">
        {data.map((item) => {
          const height = Math.max(8, (item.uniqueAttendees / max) * 100);
          return (
            <div key={item.key} className="group flex h-full min-w-0 flex-col justify-end">
              <div className="mb-2 text-center text-[13px] font-bold opacity-0 transition-opacity group-hover:opacity-100">
                {item.uniqueAttendees}
              </div>
              <div className="relative flex h-[150px] items-end overflow-hidden rounded-xl bg-white/[0.06]">
                <div
                  className="w-full rounded-xl bg-[#75D67F] transition-[height,filter] duration-500 group-hover:brightness-110"
                  style={{ height: `${height}%` }}
                  title={`${item.uniqueAttendees} unique attendees · ${item.attendanceRecords} visits · ${item.attendedSessions} sessions`}
                />
              </div>
              <div className="mt-3 truncate text-center text-[10px] font-semibold text-white/55 sm:text-[11px]">
                {item.label}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap gap-4 border-t border-white/10 pt-4 text-[11px] text-white/55">
        <span><b className="text-white">{data.at(-1)?.uniqueAttendees || 0}</b> unique this month</span>
        <span><b className="text-white">{data.at(-1)?.attendanceRecords || 0}</b> attendance records</span>
        <span><b className="text-white">{data.at(-1)?.attendedSessions || 0}</b> sessions attended</span>
      </div>
    </section>
  );
}

function ActivityExplorer({ activity }: { activity: AdminActivityData }) {
  const [view, setView] = useState<"sessions" | "bookings" | "attendance">("sessions");
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();

  const sessions = activity.sessions.filter((row) =>
    !needle || [row.title, row.type, row.host.fullName, row.host.email].some((value) =>
      value.toLowerCase().includes(needle)
    )
  );
  const people = (view === "bookings" ? activity.bookings : activity.attendance).filter((row) =>
    !needle || [row.sessionTitle, row.user.fullName, row.user.email].some((value) =>
      value.toLowerCase().includes(needle)
    )
  );

  return (
    <section className="mt-8 overflow-hidden rounded-[28px] border border-black/10 bg-white">
      <div className="flex flex-col gap-4 border-b border-black/[0.07] p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[20px] font-bold">Session activity explorer</h2>
          <p className="mt-1 text-[13px] text-[#666]">
            Inspect who created, booked and attended sessions during the last 30 days.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex rounded-full bg-[#F1F3F5] p-1">
            {([
              ["sessions", "Sessions", activity.sessions.length],
              ["bookings", "Bookings", activity.bookings.length],
              ["attendance", "Attendance", activity.attendance.length],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`rounded-full px-3 py-2 text-[12px] font-semibold transition-colors ${
                  view === key ? "bg-[#2F2F2F] text-white" : "text-[#666] hover:text-[#2F2F2F]"
                }`}
              >
                {label} <span className="ml-1 opacity-60">{count}</span>
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search user or session"
            className="min-w-[230px] rounded-full border border-black/10 px-4 py-2 text-[13px] outline-none focus:border-[#2F2F2F]"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        {view === "sessions" ? (
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead className="bg-[#FAFAFA] text-[10px] font-bold uppercase tracking-[0.12em] text-[#777]">
              <tr>
                <th className="px-5 py-3">Session</th>
                <th className="px-4 py-3">Created by</th>
                <th className="px-4 py-3">Created / starts</th>
                <th className="px-4 py-3 text-center">Bookings</th>
                <th className="px-4 py-3 text-center">Unique attendance</th>
                <th className="px-5 py-3 text-center">Visits</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 150).map((row) => (
                <tr key={row.id} className="border-t border-black/[0.06] align-middle hover:bg-[#FAFBFA]">
                  <td className="px-5 py-3">
                    <b className="block max-w-[260px] truncate text-[13px]">{row.title}</b>
                    <span className="mt-1 inline-flex rounded-full bg-[#EEF2F6] px-2 py-0.5 text-[10px] font-semibold capitalize text-[#58616C]">
                      {row.type}
                    </span>
                  </td>
                  <td className="px-4 py-3"><ProfileChip profile={row.host} /></td>
                  <td className="px-4 py-3 text-[11px] leading-5 text-[#666]">
                    <span className="block">Created {formatDateTime(row.createdAt)}</span>
                    <span className="block">Starts {formatDateTime(row.startsAt)}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-[15px] font-bold">{row.bookings}</td>
                  <td className="px-4 py-3 text-center text-[15px] font-bold text-[#16803B]">{row.uniqueAttendees}</td>
                  <td className="px-5 py-3 text-center text-[15px] font-bold">{row.attendanceRecords}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="bg-[#FAFAFA] text-[10px] font-bold uppercase tracking-[0.12em] text-[#777]">
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">{view === "bookings" ? "Booked at" : "Joined at"}</th>
                <th className="px-5 py-3">{view === "bookings" ? "Planned start" : "Last seen / left"}</th>
              </tr>
            </thead>
            <tbody>
              {people.slice(0, 250).map((row) => (
                <tr key={row.id} className="border-t border-black/[0.06] align-middle hover:bg-[#FAFBFA]">
                  <td className="px-5 py-3"><ProfileChip profile={row.user} /></td>
                  <td className="max-w-[340px] truncate px-4 py-3 text-[13px] font-semibold">{row.sessionTitle}</td>
                  <td className="px-4 py-3 text-[12px] text-[#666]">{formatDateTime(row.occurredAt)}</td>
                  <td className="px-5 py-3 text-[12px] text-[#666]">{formatDateTime(row.secondaryAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {(view === "sessions" ? sessions.length : people.length) === 0 ? (
          <div className="px-5 py-14 text-center text-[13px] text-[#777]">
            No matching activity in this period.
          </div>
        ) : null}
      </div>
    </section>
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
  const [monthlyAttendance, setMonthlyAttendance] = useState<MonthlyAttendancePoint[]>([]);
  const [activity, setActivity] = useState<AdminActivityData>(EMPTY_ACTIVITY);
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
    openPayoutRequests: 0,
  });

  const cleanQuery = useMemo(() => query.trim(), [query]);

  const unreadNotifications = useMemo(() => {
    return notifications.filter((n) => !n.read_at).length;
  }, [notifications]);

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
      const oldestMonth = makeLastMonths(6)[0]?.key;
      const attendanceHistoryIso = oldestMonth
        ? new Date(`${oldestMonth}-01T00:00:00`).toISOString() : daysAgoIso(190);
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
        attendanceHistoryRows,
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
        loadRecentRows("session_attendance", attendanceHistoryIso, "created_at"),

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

      const activityData = await buildAdminActivity(attendanceRows, bookingRows, monthIso);
      setActivity(activityData);
      setMonthlyAttendance(buildMonthlyAttendance(attendanceHistoryRows));

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

      const openPayoutRequests = payoutRows.filter((p) => {
        const status = String(p.status || "").toLowerCase();
        return status === "requested" || status === "processing";
      }).length;

      const attendanceRecordsToday = countRowsSince(attendanceRows, todayIso);
      const attendanceRecordsWeek = countRowsSince(attendanceRows, weekIso);
      const attendanceRecordsMonth = countRowsSince(attendanceRows, monthIso);

      const uniqueAttendeesToday = uniqueCountSince(attendanceRows, todayIso, getAttendanceUserId);
      const uniqueAttendeesWeek = uniqueCountSince(attendanceRows, weekIso, getAttendanceUserId);
      const uniqueAttendeesMonth = uniqueCountSince(attendanceRows, monthIso, getAttendanceUserId);

      const attendedSessionsToday = uniqueCountSince(attendanceRows, todayIso, getAttendanceSessionId);
      const attendedSessionsWeek = uniqueCountSince(attendanceRows, weekIso, getAttendanceSessionId);
      const attendedSessionsMonth = uniqueCountSince(attendanceRows, monthIso, getAttendanceSessionId);

      const uniqueBookedUsersToday = uniqueCountSince(bookingRows, todayIso, getBookingUserId);
      const uniqueBookedUsersWeek = uniqueCountSince(bookingRows, weekIso, getBookingUserId);
      const uniqueBookedUsersMonth = uniqueCountSince(bookingRows, monthIso, getBookingUserId);

      const weeklyHosts = new Set(
        ((weeklySessionsResult.data as AnyRow[]) || []).map((s) => s.host_id).filter(Boolean)
      );

      const avgAttendeesPerHostedSessionWeek =
        attendedSessionsWeek > 0 ? uniqueAttendeesWeek / attendedSessionsWeek : 0;

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

      days.forEach((day) => {
        registrationsByDay.set(day.key, 0);
        sessionsCreatedByDay.set(day.key, 0);
        sessionsHostedByDay.set(day.key, 0);
        activeHostsByDay.set(day.key, new Set());
        bookedUsersByDay.set(day.key, new Set());
        attendanceRecordsByDay.set(day.key, 0);
        uniqueAttendeesByDay.set(day.key, new Set());
        attendedSessionsByDay.set(day.key, new Set());
        supportByDay.set(day.key, 0);
      });

      ((registrationsChartResult.data as AnyRow[]) || []).forEach((row) => {
        const key = toLocalDateKey(row.created_at);
        if (!key || !registrationsByDay.has(key)) return;
        registrationsByDay.set(key, (registrationsByDay.get(key) || 0) + 1);
      });

      ((sessionsCreatedChartResult.data as AnyRow[]) || []).forEach((row) => {
        const key = toLocalDateKey(row.created_at);
        if (!key || !sessionsCreatedByDay.has(key)) return;
        sessionsCreatedByDay.set(key, (sessionsCreatedByDay.get(key) || 0) + 1);
        if (row.host_id) activeHostsByDay.get(key)?.add(row.host_id);
      });

      ((sessionsHostedChartResult.data as AnyRow[]) || []).forEach((row) => {
        const key = toLocalDateKey(row.start_time);
        if (!key || !sessionsHostedByDay.has(key)) return;
        sessionsHostedByDay.set(key, (sessionsHostedByDay.get(key) || 0) + 1);
        if (row.host_id) activeHostsByDay.get(key)?.add(row.host_id);
      });

      bookingRows.forEach((row) => {
        const key = toLocalDateKey(getRowTimestamp(row));
        const userId = getBookingUserId(row);
        if (!key || !userId || !bookedUsersByDay.has(key)) return;
        bookedUsersByDay.get(key)?.add(userId);
      });

      attendanceRows.forEach((row) => {
        const key = toLocalDateKey(getRowTimestamp(row));
        if (!key || !attendanceRecordsByDay.has(key)) return;

        attendanceRecordsByDay.set(key, (attendanceRecordsByDay.get(key) || 0) + 1);

        const userId = getAttendanceUserId(row);
        const sessionId = getAttendanceSessionId(row);

        if (userId) uniqueAttendeesByDay.get(key)?.add(userId);
        if (sessionId) attendedSessionsByDay.get(key)?.add(sessionId);
      });

      ((paymentsChartResult.data as AnyRow[]) || []).forEach((row) => {
        const key = toLocalDateKey(row.created_at);
        if (!key || !supportByDay.has(key)) return;

        const status = String(row.status || "").toLowerCase();
        if (status !== "available" && status !== "paid_out") return;

        supportByDay.set(
          key,
          (supportByDay.get(key) || 0) + Number(row.host_amount_usd || 0)
        );
      });

      const openPayoutRequestsByDay = new Map<string, number>();
      const pendingPayoutUsdByDay = new Map<string, number>();

      days.forEach((day) => {
        openPayoutRequestsByDay.set(day.key, 0);
        pendingPayoutUsdByDay.set(day.key, 0);
      });

      payoutRows.forEach((row) => {
        const key = toLocalDateKey(row.created_at || row.requested_at);
        if (!key || !openPayoutRequestsByDay.has(key)) return;

        const status = String(row.status || "").toLowerCase();
        if (status !== "requested" && status !== "processing") return;

        openPayoutRequestsByDay.set(key, (openPayoutRequestsByDay.get(key) || 0) + 1);
        pendingPayoutUsdByDay.set(
          key,
          (pendingPayoutUsdByDay.get(key) || 0) + Number(row.amount_usd || 0)
        );
      });

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
            pendingPayoutUsd: Number((pendingPayoutUsdByDay.get(day.key) || 0).toFixed(2)),
            openPayoutRequests: openPayoutRequestsByDay.get(day.key) || 0,
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
        openPayoutRequests,
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
          if (ok) await Promise.all([loadDashboard(), loadBans()]);
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

      if (nextStatus === "paid" || nextStatus === "rejected") payload.resolved_at = nowIso;
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
          .update({ status: "paid_out", updated_at: nowIso })
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
              Attendance uses <b>session_attendance</b>. Unique attendees are distinct user-like IDs from attendance rows.
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

            <Link
              to="/admin/daily-schedule-email"
              className="rounded-full border border-[#5286F6] px-5 py-2.5 text-[14px] font-semibold text-[#2F2F2F] hover:bg-[#5286F6] hover:text-white"
            >
              Scheduled emails
            </Link>

            <Link
              to="/admin/sender-email"
              className="rounded-full border border-[#57C964] px-5 py-2.5 text-[14px] font-semibold text-[#2F2F2F] hover:bg-[#57C964] hover:text-white"
            >
              Sender lifecycle
            </Link>

            <Link
              to="/admin/blog"
              className="rounded-full border border-[#2F2F2F] px-5 py-2.5 text-[14px] font-semibold text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white"
            >
              Blog editor
            </Link>

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
            <div className="mt-8 flex justify-end">
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="rounded-full border border-black/10 px-4 py-2 text-[13px] font-semibold hover:bg-black/[0.04]"
              >
                {dashboardLoading ? "Refreshing..." : "Refresh dashboard"}
              </button>
            </div>

            <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <MetricCard label="Registrations today" value={stats.registrationsToday} hint="New profiles created today." data={chartData} dataKey="registrations" color="#2563EB" />
              <MetricCard label="Registrations 7d" value={stats.registrationsWeek} hint="New profiles in the last 7 days." data={chartData} dataKey="registrations" color="#2563EB" />
              <MetricCard label="Registrations 30d" value={stats.registrationsMonth} hint="New profiles in the last 30 days." data={chartData} dataKey="registrations" color="#2563EB" />

              <MetricCard label="Sessions created today" value={stats.sessionsCreatedToday} hint="Rows created in sessions table today." data={chartData} dataKey="sessionsCreated" color="#7C3AED" />
              <MetricCard label="Sessions hosted today" value={stats.sessionsHostedToday} hint="Sessions whose start_time already happened today." data={chartData} dataKey="sessionsHosted" color="#059669" />
              <MetricCard label="Active hosts 7d" value={stats.activeHostsWeek} hint="Unique hosts who created sessions in 7 days." data={chartData} dataKey="activeHosts" color="#EA580C" />

              <MetricCard label="Unique attendees today" value={stats.uniqueAttendeesToday} hint="Distinct user IDs from session_attendance today." data={chartData} dataKey="uniqueAttendees" color="#BE123C" />
              <MetricCard label="Attendance records today" value={stats.attendanceRecordsToday} hint="All session_attendance rows today." data={chartData} dataKey="attendanceRecords" color="#DC2626" />
              <MetricCard label="Attended sessions today" value={stats.attendedSessionsToday} hint="Distinct session IDs from session_attendance today." data={chartData} dataKey="attendedSessions" color="#4338CA" />

              <MetricCard label="Unique attendees 7d" value={stats.uniqueAttendeesWeek} hint="Distinct users from session_attendance in 7 days." data={chartData} dataKey="uniqueAttendees" color="#BE123C" />
              <MetricCard label="Unique attendance 30d" value={stats.uniqueAttendeesMonth} hint="Distinct people with attendance during the last 30 days." data={chartData} dataKey="uniqueAttendees" color="#16803B" />
              <MetricCard label="Booked users 7d" value={stats.uniqueBookedUsersWeek} hint="Distinct users from session_bookings in 7 days." data={chartData} dataKey="bookedUsers" color="#0891B2" />
              <MetricCard label="Booked → attended 7d" value={formatPercent(stats.bookedToAttendedConversionWeek)} hint="Unique attendees divided by booked users." data={chartData} dataKey="avgAttendeesPerSession" color="#C2410C" percent />

              <MetricCard label="Avg attendees/session 7d" value={formatNumber(stats.avgAttendeesPerHostedSessionWeek, 2)} hint="Unique attendees divided by attended sessions." data={chartData} dataKey="avgAttendeesPerSession" color="#C2410C" decimals={2} />
              <MetricCard label="Available host balance" value={formatMoney(stats.availableHostBalanceUsd)} hint="Available host support balance." data={chartData} dataKey="supportUsd" color="#16A34A" money />
              <MetricCard label="Pending payouts" value={formatMoney(stats.pendingPayoutUsd)} hint="Requested or processing payouts." data={chartData} dataKey="pendingPayoutUsd" color="#CA8A04" money />

              <MetricCard label="Open payout requests" value={stats.openPayoutRequests} hint="Requested or processing payout requests." data={chartData} dataKey="openPayoutRequests" color="#0F766E" />
              <MetricCard label="Sessions created 30d" value={stats.sessionsCreatedMonth} hint="Rows created in sessions table in 30 days." data={chartData} dataKey="sessionsCreated" color="#7C3AED" />
              <MetricCard label="Sessions hosted 30d" value={stats.sessionsHostedMonth} hint="Sessions started in the last 30 days." data={chartData} dataKey="sessionsHosted" color="#059669" />
            </section>
            <MonthlyAttendanceChart data={monthlyAttendance} />
            <ActivityExplorer activity={activity} />


            <section className="mt-8 rounded-[28px] border border-black/10 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[20px] font-bold">Payout requests</h2>
                  <p className="mt-1 text-[13px] text-[#666]">
                    Manual payout queue for approved hosts.
                  </p>
                </div>
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
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-[13px] font-bold text-[#2F2F2F]">
                              User: {ban.banned_user_id}
                            </div>
                            <span
                              className={
                                isQuietRestriction(ban)
                                  ? "rounded-full bg-violet-100 px-2 py-1 text-[11px] font-bold text-violet-700"
                                  : "rounded-full bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700"
                              }
                            >
                              {isQuietRestriction(ban) ? "Shadow ban" : "Regular ban"}
                            </span>
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
