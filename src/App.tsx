// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";

import { SessionsPage } from "./pages/SessionsPage";
import LandingPage from "./pages/LandingPage"; // ✅ NEW
import RoomPage from "./pages/RoomPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ProfilePage from "./pages/ProfilePage";
import PublicProfilePage from "./pages/PublicProfilePage";
import AuthCallback from "./pages/AuthCallback";

import PricingPage from "./pages/PricingPage";
import UpdatesPage from "./pages/UpdatesPage";

import AppLayout from "./layouts/AppLayout";
import { CreateSessionModalProvider } from "./context/CreateSessionModalContext";

export default function App() {
  console.log("[ROUTER] App mounted");

  return (
    <CreateSessionModalProvider>
      <Routes>
        {/* Routes WITH header (и с футером, если он внутри AppLayout) */}
        <Route element={<AppLayout />}>
          {/* ✅ CHANGED: root is Landing */}
          <Route path="/" element={<LandingPage />} />

          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/updates" element={<UpdatesPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:id" element={<PublicProfilePage />} />
        </Route>

        {/* Routes WITHOUT header (обычно так лучше) */}
        <Route path="/room/:id" element={<RoomPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* OAuth */}
        <Route
          path="/auth/callback"
          element={
            <>
              {console.log("[ROUTER] Matched /auth/callback")}
              <AuthCallback />
            </>
          }
        />
        <Route
          path="/auth/callback/"
          element={
            <>
              {console.log("[ROUTER] Matched /auth/callback/")}
              <AuthCallback />
            </>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </CreateSessionModalProvider>
  );
}
