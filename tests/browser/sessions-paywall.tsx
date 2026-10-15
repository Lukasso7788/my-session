import "./sessions-paywall-setup";
import "./profile-page-auth";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../../src/context/AuthContext";
import { CreateSessionModalProvider } from "../../src/context/CreateSessionModalContext";
import Header from "../../src/components/Header";
import SessionsPage from "../../src/pages/SessionsPage";
import "../../src/index.css";

// Dev-only preview of the Sessions page for a Free account that has used its
// 15 free sessions (needs VITE_PAYWALL_ENABLED=true in the dev env).
createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/sessions"]}>
    <AuthProvider>
      <CreateSessionModalProvider>
      <Header />
      <Routes>
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="*" element={<div style={{ padding: 24 }}>Navigated away</div>} />
      </Routes>
      </CreateSessionModalProvider>
    </AuthProvider>
  </MemoryRouter>
);