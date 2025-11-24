// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";

import { SessionsPage } from "./pages/SessionsPage";
import RoomPage from "./pages/RoomPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ProfilePage from "./pages/ProfilePage";
import PublicProfilePage from "./pages/PublicProfilePage";
import AuthCallback from "./pages/AuthCallback";

import { CreateSessionModalProvider } from "./hooks/useCreateSessionModal";
import { CreateSessionModal } from "./components/CreateSessionModal";

export default function App() {
  console.log("[ROUTER] App mounted");

  return (
    <CreateSessionModalProvider>
      <Routes>
        {/* Redirect "/" → "/sessions" */}
        <Route path="/" element={<Navigate to="/sessions" replace />} />

        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/room/:id" element={<RoomPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/:id" element={<PublicProfilePage />} />

        {/* 🔥 OAuth callback — ДВА РОУТА */}
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
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>

      <CreateSessionModal />
    </CreateSessionModalProvider>
  );
}
