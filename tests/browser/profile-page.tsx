import "./profile-page-auth";
import { createRoot } from "react-dom/client";

// Streaks panel fixture (?streak=none shows someone who has not started one).
(globalThis as any).__harnessRpc = {
  ...((globalThis as any).__harnessRpc || {}),
  get_my_streaks:
    new URLSearchParams(location.search).get("streak") === "none"
      ? { attended_today: false, days_this_week: 0, days_this_month: 0, streaks: { day: { current: 0, longest: 3 }, week: { current: 0, longest: 4 }, month: { current: 1, longest: 2 }, year: { current: 1, longest: 1 } } }
      : { attended_today: false, days_this_week: 3, days_this_month: 9, streaks: { day: { current: 5, longest: 12 }, week: { current: 7, longest: 9 }, month: { current: 4, longest: 4 }, year: { current: 1, longest: 1 } } },
};
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
