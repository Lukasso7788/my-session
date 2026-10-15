import "./profile-page-auth";
import { createRoot } from "react-dom/client";
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
