// Runs before profile-page-auth: an admin account and plausible fixture data
// for the admin dashboard (no real users or numbers).
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const now = Date.now();
const names = ["Maya Chen", "Jonas Weber", "Priya Nair", "Lena Kovač", "Tom Ellis", "Sara Haddad", "Ivan Petrov", "Ana Souza", "Kenji Mori", "Elif Kaya", "Noah Becker", "Zoe Martin"];
const people = names.map((full_name, i) => ({ user_id: `a${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`, full_name, avatar_url: null }));
const wave = (i: number, base: number, amp: number) => Math.round(base + amp * Math.sin(i / 2.3) + i * 0.6);

const months = Array.from({ length: 36 }, (_, i) => {
  const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 35 + i, 1));
  const unique = Math.max(4, wave(i, 40, 12) + i * 4);
  return { month_start: iso(d.getTime()), unique_attendees: unique, attendance_records: unique * 5, attended_sessions: Math.round(unique * 1.4), attendee_ids: [] };
});
const dailyHistory = Array.from({ length: 90 }, (_, i) => ({
  attendance_date: iso(now - (89 - i) * day),
  unique_attendees: Math.max(3, wave(i, 22, 7)),
  attendance_records: Math.max(5, wave(i, 60, 18)),
  attended_sessions: Math.max(2, wave(i, 14, 4)),
  attendee_ids: [],
}));
const usage = {
  summary: {
    unique_attendees_today: 27, unique_attendees_7d: 118, unique_attendees_30d: 341,
    visits_today: 64, visits_7d: 402, visits_30d: 1530,
    attended_sessions_today: 15, attended_sessions_7d: 96, attended_sessions_30d: 370,
    member_hours_7d: 612.5, host_presence_hours_7d: 141.2, scheduled_hours_7d: 168,
    tracked_from: iso(now - 200 * day), total_profiles: 1480, profiles_with_country: 1102,
  },
  daily: Array.from({ length: 30 }, (_, i) => ({
    date: iso(now - (29 - i) * day), uniqueAttendees: Math.max(3, wave(i, 24, 7)), visits: Math.max(5, wave(i, 55, 15)),
    attendedSessions: Math.max(2, wave(i, 13, 4)), memberHours: Math.max(4, wave(i, 85, 20)), attendeeIds: [],
  })),
  hourly: Array.from({ length: 24 }, (_, hour) => ({
    hour, avgPeople: Math.max(0.4, 6 + 5 * Math.sin((hour - 9) / 3.8)), peakPeople: 14, activeWindows: 30, emptyWindows: 2, avgActiveSessions: 2,
  })),
  countries: [{ countryCode: "US", users: 312 }, { countryCode: "IN", users: 221 }, { countryCode: "DE", users: 140 }, { countryCode: "GB", users: 118 }, { countryCode: "UA", users: 76 }],
  timezoneRegions: [{ region: "Europe", users: 520 }, { region: "Americas", users: 410 }, { region: "Asia", users: 330 }],
};

const weekStart = (() => { const d = new Date(); const dow = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * day; })();
const retention = {
  as_of: iso(now), calendar: "UTC", week_start: iso(weekStart), month_start: iso(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)),
  returning: {
    weeks: Array.from({ length: 12 }, (_, i) => {
      const active = wave(i, 95, 14) + i * 2;
      return { start: iso(weekStart - (11 - i) * 7 * day), active, returning: Math.round(active * (0.34 + i * 0.012)), returning3: Math.round(active * (0.16 + i * 0.008)) };
    }),
    months: Array.from({ length: 12 }, (_, i) => {
      const active = 200 + i * 14 + wave(i, 0, 20);
      const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11 + i, 1));
      return { start: iso(d.getTime()), active, returning: Math.round(active * (0.48 + i * 0.01)), returning3: Math.round(active * (0.29 + i * 0.008)) };
    }),
    top: {
      week: people.slice(0, 6).map((p, i) => ({ ...p, days: 6 - Math.floor(i / 2) })),
      month: people.slice(0, 10).map((p, i) => ({ ...p, days: 19 - i * 2 })),
      prev_month: people.slice(2, 12).map((p, i) => ({ ...p, days: 17 - i })),
    },
  },
  streaks: {
    day: { on_streak: 23, buckets: [[2, 23], [3, 15], [5, 9], [7, 5], [14, 2], [30, 1]].map(([min, users]) => ({ min, users })), top: people.slice(0, 8).map((p, i) => ({ ...p, current: [34, 16, 12, 9, 7, 6, 4, 3][i], longest: [41, 22, 12, 15, 9, 6, 11, 5][i] })), record: { ...people[0], current: 34, longest: 41 } },
    week: { on_streak: 61, buckets: [[2, 61], [3, 44], [4, 33], [8, 18], [12, 9], [26, 3], [52, 0]].map(([min, users]) => ({ min, users })), top: people.slice(0, 10).map((p, i) => ({ ...p, current: [31, 27, 22, 18, 14, 12, 10, 9, 8, 6][i], longest: [31, 30, 22, 20, 14, 16, 10, 12, 8, 9][i] })), record: { ...people[1], current: 27, longest: 38 } },
    month: { on_streak: 88, buckets: [[2, 88], [3, 57], [6, 21], [12, 4]].map(([min, users]) => ({ min, users })), top: people.slice(0, 8).map((p, i) => ({ ...p, current: [14, 12, 9, 8, 7, 6, 5, 4][i], longest: [14, 12, 10, 8, 9, 6, 5, 7][i] })), record: { ...people[0], current: 14, longest: 14 } },
    year: { on_streak: 6, buckets: [[2, 6], [3, 0], [5, 0]].map(([min, users]) => ({ min, users })), top: people.slice(0, 3).map((p) => ({ ...p, current: 2, longest: 2 })), record: { ...people[0], current: 2, longest: 2 } },
  },
};

// Two weeks of rows for the card sparklines.
const at = (daysAgo: number, hour = 12) => new Date(now - daysAgo * day + (hour - 12) * 3_600_000).toISOString();
const profileRows = Array.from({ length: 60 }, (_, i) => ({
  id: `b${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`,
  full_name: names[i % names.length],
  avatar_url: null,
  created_at: at(i % 14, 8 + (i % 10)),
}));
const sessionRows = Array.from({ length: 70 }, (_, i) => ({
  id: `c${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`,
  title: ["Deep Work", "Morning Focus", "Study Sprint", "Writing Hour"][i % 4],
  host_id: profileRows[i % 9].id,
  created_at: at(i % 14, 9),
  start_time: at(i % 14, 14),
}));
const attendanceRows = Array.from({ length: 420 }, (_, i) => ({
  session_id: sessionRows[i % sessionRows.length].id,
  user_id: profileRows[(i * 7) % profileRows.length].id,
  created_at: at(Math.floor(i / 30), 10 + (i % 8)),
  joined_at: at(Math.floor(i / 30), 10 + (i % 8)),
}));
(globalThis as any).__harnessTables = {
  profiles: profileRows,
  sessions: sessionRows,
  session_attendance: attendanceRows,
  session_bookings: attendanceRows.slice(0, 300),
  user_entitlements: [],
};

(globalThis as any).__harnessRpc = {
  is_app_admin: true,
  admin_monthly_attendance: months,
  admin_daily_attendance_history: dailyHistory,
  admin_usage_analytics: usage,
  admin_retention_streaks: retention,
};

// Admin API (host applications etc.): answer locally.
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/livekit/admin")) {
    return new Response(JSON.stringify({ ok: true, applications: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};
export {};
