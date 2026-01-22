// src/App.tsx
import { Routes, Route } from "react-router-dom";

import { SessionsPage } from "./pages/SessionsPage";
import LandingPage from "./pages/LandingPage";
import RoomPage from "./pages/RoomPage";
import RoomPageIFrame from "./pages/RoomPageIFrame";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ProfilePage from "./pages/ProfilePage";
import PublicProfilePage from "./pages/PublicProfilePage";
import AuthCallback from "./pages/AuthCallback";

import PricingPage from "./pages/PricingPage";
import UpdatesPage from "./pages/UpdatesPage";

import PrivacyPage from "./pages/PrivacyPage";
import DataDeletionPage from "./pages/DataDeletionPage";

import AppLayout from "./layouts/AppLayout";
import { CreateSessionModalProvider } from "./context/CreateSessionModalContext";

// ✅ NEW: canonical/SEO pages
import BodyDoublingPage from "./pages/seo/BodyDoublingPage";
import OnlineCoworkingPage from "./pages/seo/OnlineCoworkingPage";
import GroupFocusSessionsPage from "./pages/seo/GroupFocusSessionsPage";
import SilentCoworkingPage from "./pages/seo/SilentCoworkingPage";
import AdhdProductivityPage from "./pages/seo/AdhdProductivityPage";
import AIAssistantPage from "./pages/seo/AIAssistantPage";

// ✅ NEW: 404
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  console.log("[ROUTER] App mounted");

  return (
    <CreateSessionModalProvider>
      <Routes>
        {/* Routes WITH header (и с футером, если он внутри AppLayout) */}
        <Route element={<AppLayout />}>
          {/* Root */}
          <Route path="/" element={<LandingPage />} />

          {/* Core app pages */}
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/updates" element={<UpdatesPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:id" element={<PublicProfilePage />} />

          {/* Legal */}
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/data-deletion" element={<DataDeletionPage />} />

          {/* ✅ NEW: Canonical SEO/AEO pages */}
          <Route path="/body-doubling" element={<BodyDoublingPage />} />
          <Route path="/online-coworking" element={<OnlineCoworkingPage />} />
          <Route path="/group-focus-sessions" element={<GroupFocusSessionsPage />} />
          <Route path="/silent-coworking" element={<SilentCoworkingPage />} />
          <Route path="/adhd-productivity" element={<AdhdProductivityPage />} />
          <Route path="/ai-assistant" element={<AIAssistantPage />} />

          {/* ✅ NEW: 404 (instead of redirect-to-/) */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        {/* Routes WITHOUT header */}
        <Route path="/room/:id" element={<RoomPage />} />
        <Route path="/room-iframe/:id" element={<RoomPageIFrame />} />
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
      </Routes>
    </CreateSessionModalProvider>
  );
}
