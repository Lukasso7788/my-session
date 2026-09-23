import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { Navigate, Routes, Route, useParams } from "react-router-dom";

import LandingPage from "./pages/LandingPage";
import AuthCallback from "./pages/AuthCallback";
import BlogIndex from "./pages/BlogIndex";
import BlogPost from "./pages/BlogPost";

import PricingPage from "./pages/PricingPage";
import PricingSuccessPage from "./pages/PricingSuccessPage";
import UpdatesPage from "./pages/UpdatesPage";
import AffiliatePage from "./pages/AffiliatePage";
import ReferralPage from "./pages/ReferralPage";

import PrivacyPage from "./pages/PrivacyPage";
import DataDeletionPage from "./pages/DataDeletionPage";
import Terms from "./pages/Terms";
import RulesPage from "./pages/RulesPage";
import RefundPolicyPage from "./pages/RefundPolicyPage";
import ContactPage from "./pages/ContactPage";

import AppLayout from "./layouts/AppLayout";
import { CreateSessionModalProvider } from "./context/CreateSessionModalContext";
import { storeReferralCodeFromUrl } from "./lib/referrals";
import AppBootstrapGate from "./components/AppBootstrapGate";

import GroupFocusSessionsPage from "./pages/seo/GroupFocusSessionsPage";
import SilentCoworkingPage from "./pages/seo/SilentCoworkingPage";
import AdhdProductivityPage from "./pages/seo/AdhdProductivityPage";
import AIAssistantPage from "./pages/seo/AIAssistantPage";

import HowItWorksPage from "./pages/seo/HowItWorksPage";
import FaqPage from "./pages/seo/FaqPage";
import { seoRouteManifest } from "./data/seoRouteManifest";

import NotFoundPage from "./pages/NotFoundPage";

const DataDrivenSeoPage = lazy(() => import("./pages/seo/DataDrivenSeoPage"));
// Keep media SDKs, chat and task panels out of the initial landing/Sessions bundle.
const SessionsPage = lazy(() => import("./pages/SessionsPage"));
const RoomPageIFrame = lazy(() => import("./pages/RoomPageIFrame"));
const RoomPageLiveKit = lazy(() => import("./pages/RoomPageLiveKit"));
const RoomPageLiveKitClean = lazy(() => import("./pages/RoomPageLiveKitClean"));
const PublicSlugRedirectPage = lazy(() => import("./pages/PublicSlugRedirectPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const UpdatePasswordPage = lazy(() => import("./pages/UpdatePasswordPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const ProfileSettingsPage = lazy(() => import("./pages/ProfileSettingsPage"));
const FocusPlanPage = lazy(() => import("./pages/FocusPlanPage"));
const FocusShieldPage = lazy(() => import("./pages/FocusShieldPage"));
const PublicProfilePage = lazy(() => import("./pages/PublicProfilePage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const DailyScheduleEmailAdminPage = lazy(() => import("./pages/DailyScheduleEmailAdminPage"));
const DailyScheduleUnsubscribePage = lazy(() => import("./pages/DailyScheduleUnsubscribePage"));
const EmailPreferencesPage = lazy(() => import("./pages/EmailPreferencesPage"));
const SenderEmailAdminPage = lazy(() => import("./pages/SenderEmailAdminPage"));
const BlogAdminPage = lazy(() => import("./pages/BlogAdminPage"));
const SessionCardsPlayground = lazy(() => import("./SessionCardsPlayground"));
const IconVectorizerPage = lazy(() => import("./pages/IconVectorizerPage"));
const OneOnOnePage = lazy(() => import("./pages/OneOnOnePage"));
const MOBILE_ROOM_LEASE_PREFIX = "mysession_mobile_room_lease:";

function clearRoomEntryRecoveryLease(sessionId: string) {
  if (typeof window === "undefined" || !sessionId) return;

  const prefix = `${MOBILE_ROOM_LEASE_PREFIX}${sessionId}:`;

  try {
    const matchingKeys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) matchingKeys.push(key);
    }
    matchingKeys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage can be unavailable in strict privacy modes. The room's own
    // prejoin default still applies when no persisted recovery lease is readable.
  }
}

function RoomPageLiveKitEntry() {
  const { id = "" } = useParams<{ id: string }>();
  const sessionId = String(id || "").trim();
  const [preparedSessionId, setPreparedSessionId] = useState("");

  useLayoutEffect(() => {
    clearRoomEntryRecoveryLease(sessionId);
    setPreparedSessionId(sessionId);
  }, [sessionId]);

  // Gate the production room for one layout pass so a stale recovery lease can
  // never auto-skip prejoin on a fresh room entry or a full page refresh.
  if (!sessionId || preparedSessionId !== sessionId) return null;

  return <RoomPageLiveKit />;
}

export default function App() {
  console.log("[ROUTER] App mounted");
  const isOneOnOneHost =
    typeof window !== "undefined" &&
    window.location.hostname.toLowerCase() === "1-on-1.mysession.club";

  useEffect(() => {
    storeReferralCodeFromUrl();
  }, []);

  return (
    <CreateSessionModalProvider>
      <AppBootstrapGate>
        <Suspense fallback={<div className="min-h-screen bg-[#fafafa]" aria-label="Loading page" />}>
        <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={isOneOnOneHost ? <OneOnOnePage /> : <LandingPage />} />
          <Route path="/one-on-one" element={<Navigate to="/sessions?tab=one-on-one" replace />} />

          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/pricing/success" element={<PricingSuccessPage />} />
          <Route path="/updates" element={<UpdatesPage />} />
          <Route path="/referrals" element={<ReferralPage />} />
          <Route path="/affiliate" element={<AffiliatePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<ProfileSettingsPage />} />
          <Route path="/settings/email" element={<EmailPreferencesPage />} />
          <Route path="/profile/:id" element={<PublicProfilePage />} />

          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/dashboard" element={<AdminPage />} />
          <Route path="/admin/moderation" element={<AdminPage />} />

          <Route
            path="/admin/daily-schedule-email"
            element={<DailyScheduleEmailAdminPage />}
          />
          <Route path="/admin/sender-email" element={<SenderEmailAdminPage />} />
          <Route path="/admin/blog" element={<BlogAdminPage />} />

          <Route
            path="/email/unsubscribe"
            element={<DailyScheduleUnsubscribePage />}
          />

          <Route path="/focus-plan" element={<FocusPlanPage />} />
          <Route path="/tasks" element={<FocusPlanPage />} />
          <Route path="/focus-shield" element={<FocusShieldPage />} />

          <Route path="/ui-playground" element={<SessionCardsPlayground />} />

          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refund-policy" element={<RefundPolicyPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/data-deletion" element={<DataDeletionPage />} />
          <Route path="/rules" element={<RulesPage />} />

          <Route path="/blog" element={<BlogIndex />} />

          <Route path="/blog/:slug" element={<BlogPost />} />

          {/* SEO pages */}
          {seoRouteManifest.map((page) => (
            <Route
              key={page.slug}
              path={page.route}
              element={(
                <Suspense fallback={<main className="min-h-screen bg-[#fafafa]" aria-label="Loading guide" />}>
                  <DataDrivenSeoPage slug={page.slug} />
                </Suspense>
              )}
            />
          ))}

          <Route path="/adhd-body-doubling" element={<Navigate to="/body-doubling-for-adhd" replace />} />

          <Route
            path="/adhd-productivity"
            element={<AdhdProductivityPage />}
          />

          <Route path="/online-coworking" element={<Navigate to="/virtual-coworking" replace />} />

          <Route
            path="/group-focus-sessions"
            element={<GroupFocusSessionsPage />}
          />

          <Route
            path="/focus-sessions"
            element={<Navigate to="/group-focus-sessions" replace />}
          />

          <Route
            path="/silent-coworking"
            element={<SilentCoworkingPage />}
          />

          <Route path="/study-together" element={<Navigate to="/body-doubling-for-studying" replace />} />
          <Route path="/procrastination" element={<Navigate to="/body-doubling-for-procrastination" replace />} />

          <Route path="/how-it-works" element={<HowItWorksPage />} />

          <Route path="/faq" element={<FaqPage />} />

          <Route
            path="/focusmate-alternatives"
            element={<Navigate to="/blog/best-focusmate-alternatives" replace />}
          />

          <Route path="/ai-assistant" element={<AIAssistantPage />} />

          <Route path="*" element={<NotFoundPage />} />
        </Route>

        <Route path="/:slug" element={<PublicSlugRedirectPage />} />

        <Route path="/vectorizer" element={<IconVectorizerPage />} />

        <Route path="/room-iframe/:id" element={<RoomPageIFrame />} />
        <Route path="/room-livekit/:id" element={<RoomPageLiveKitEntry />} />
        <Route
          path="/room-livekit-clean/:id"
          element={<RoomPageLiveKitClean />}
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/update-password" element={<UpdatePasswordPage />} />

        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/auth/callback/" element={<AuthCallback />} />
        </Routes>
        </Suspense>

      </AppBootstrapGate>
    </CreateSessionModalProvider>
  );
}
