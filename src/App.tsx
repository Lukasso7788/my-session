import { lazy, Suspense, useEffect } from "react";
import { Navigate, Routes, Route } from "react-router-dom";
import type { User } from "@supabase/supabase-js";

import { SessionsPage } from "./pages/SessionsPage";
import LandingPage from "./pages/LandingPage";
import RoomPageIFrame from "./pages/RoomPageIFrame";
import RoomPageLiveKit from "./pages/RoomPageLiveKit";
import RoomPageLiveKitClean from "./pages/RoomPageLiveKitClean";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import UpdatePasswordPage from "./pages/UpdatePasswordPage";
import ProfilePage from "./pages/ProfilePage";
import ProfileSettingsPage from "./pages/ProfileSettingsPage";
import FocusPlanPage from "./pages/FocusPlanPage";
import FocusShieldPage from "./pages/FocusShieldPage";
import PublicProfilePage from "./pages/PublicProfilePage";
import PublicSlugRedirectPage from "./pages/PublicSlugRedirectPage";
import AuthCallback from "./pages/AuthCallback";
import AdminPage from "./pages/AdminPage";
import DailyScheduleEmailAdminPage from "./pages/DailyScheduleEmailAdminPage";
import DailyScheduleUnsubscribePage from "./pages/DailyScheduleUnsubscribePage";
import EmailPreferencesPage from "./pages/EmailPreferencesPage";
import SenderEmailAdminPage from "./pages/SenderEmailAdminPage";
import BlogAdminPage from "./pages/BlogAdminPage";
import BlogIndex from "./pages/BlogIndex";
import BlogPost from "./pages/BlogPost";
import OneOnOnePage from "./pages/OneOnOnePage";

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
import { supabase } from "./lib/supabase";
import AppBootstrapGate from "./components/AppBootstrapGate";

import GroupFocusSessionsPage from "./pages/seo/GroupFocusSessionsPage";
import SilentCoworkingPage from "./pages/seo/SilentCoworkingPage";
import AdhdProductivityPage from "./pages/seo/AdhdProductivityPage";
import AIAssistantPage from "./pages/seo/AIAssistantPage";

import HowItWorksPage from "./pages/seo/HowItWorksPage";
import FaqPage from "./pages/seo/FaqPage";
import { seoRouteManifest } from "./data/seoRouteManifest";

import NotFoundPage from "./pages/NotFoundPage";
import SessionCardsPlayground from "./SessionCardsPlayground";
import IconVectorizerPage from "./pages/IconVectorizerPage";

const DataDrivenSeoPage = lazy(() => import("./pages/seo/DataDrivenSeoPage"));

export default function App() {
  console.log("[ROUTER] App mounted");
  const isOneOnOneHost =
    typeof window !== "undefined" &&
    window.location.hostname.toLowerCase() === "1-on-1.mysession.club";

  useEffect(() => {
    storeReferralCodeFromUrl();
  }, []);

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) return;
    const isAuthCallback =
      window.location.pathname.replace(/\/$/, "") === "/auth/callback";
    let syncTimer: number | null = null;

    const syncUserTimeZone = async (user: User | null | undefined) => {
      if (!user?.id) return;

      const metadataTimeZone = String(
        user.user_metadata?.timezone ||
        user.user_metadata?.time_zone ||
        user.user_metadata?.timeZone ||
        user.user_metadata?.tz ||
        ""
      ).trim();
      if (metadataTimeZone === timeZone) return;

      const cacheKey = `mysession-timezone:${user.id}`;
      if (localStorage.getItem(cacheKey) === timeZone) return;

      const { error } = await supabase.auth.updateUser({
        data: { timezone: timeZone },
      });

      if (!error) localStorage.setItem(cacheKey, timeZone);
    };

    if (!isAuthCallback) {
      void supabase.auth.getUser().then(({ data }) => syncUserTimeZone(data.user));
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN") {
        // Never call another Supabase auth method from inside the auth callback.
        // It can contend with the OAuth code exchange lock, especially on Discord.
        if (syncTimer) window.clearTimeout(syncTimer);
        syncTimer = window.setTimeout(() => {
          void syncUserTimeZone(session?.user);
        }, 3_000);
      }
    });

    return () => {
      if (syncTimer) window.clearTimeout(syncTimer);
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <CreateSessionModalProvider>
      <AppBootstrapGate>
        <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={isOneOnOneHost ? <OneOnOnePage /> : <LandingPage />} />
          <Route path="/one-on-one" element={<OneOnOnePage />} />

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
        <Route path="/room-livekit/:id" element={<RoomPageLiveKit />} />
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

      </AppBootstrapGate>
    </CreateSessionModalProvider>
  );
}
