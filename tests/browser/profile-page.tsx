import "./profile-page-auth";
import { createRoot } from "react-dom/client";

// Streaks panel fixtures: default = from the database function;
// ?streak=none = nothing started yet; ?streak=fallback = migration not
// applied, counted from the person's own attendance rows.
const streakMode = new URLSearchParams(location.search).get("streak");
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
(globalThis as any).__harnessRpc = {
  ...((globalThis as any).__harnessRpc || {}),
  get_my_streaks:
    streakMode === "fallback"
      ? null
      : streakMode === "none"
        ? { attended_today: false, days_this_week: 0, days_this_month: 0, streaks: { day: { current: 0, longest: 3 }, week: { current: 0, longest: 4 }, month: { current: 1, longest: 2 }, year: { current: 1, longest: 1 } } }
        : { attended_today: false, days_this_week: 3, days_this_month: 9, streaks: { day: { current: 5, longest: 12 }, week: { current: 7, longest: 9 }, month: { current: 4, longest: 4 }, year: { current: 1, longest: 1 } } },
};
if (streakMode === "fallback") {
  (globalThis as any).__harnessTables = {
    ...((globalThis as any).__harnessTables || {}),
    session_attendance: [0, 1, 2, 3, 9, 16, 23, 30, 37, 44].map((n) => ({ joined_at: daysAgo(n), last_seen_at: daysAgo(n) })),
    infinite_room_daily_attendance: [],
  };
}
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../../src/context/AuthContext";
import ProfilePage from "../../src/pages/ProfilePage";
import "../../src/index.css";

// Dev-only preview of your own profile page. Supabase points at a dead local
// port; a fake signed-in session and the REST answers below stand in for it.
createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/profile"]}>
    <AuthProvider>
      <Routes>
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<div style={{ padding: 24 }}>Navigated away</div>} />
      </Routes>
    </AuthProvider>
  </MemoryRouter>
);
