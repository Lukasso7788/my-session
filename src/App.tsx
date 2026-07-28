import { useEffect } from "react";
import { Routes, Route, Link } from "react-router-dom";
import type { User } from "@supabase/supabase-js";

import { SessionsPage } from "./pages/SessionsPage";
import LandingPage from "./pages/LandingPage";
import RoomPageIFrame from "./pages/RoomPageIFrame";
import RoomPageLiveKit from "./pages/RoomPageLiveKit";
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

import BodyDoublingPage from "./pages/seo/BodyDoublingPage";
import OnlineCoworkingPage from "./pages/seo/OnlineCoworkingPage";
import GroupFocusSessionsPage from "./pages/seo/GroupFocusSessionsPage";
import SilentCoworkingPage from "./pages/seo/SilentCoworkingPage";
import AdhdProductivityPage from "./pages/seo/AdhdProductivityPage";
import AIAssistantPage from "./pages/seo/AIAssistantPage";
import FocusmateAlternativesPage from "./pages/seo/FocusmateAlternativesPage";

import AdhdBodyDoublingPage from "./pages/seo/AdhdBodyDoublingPage";
import StudyTogetherPage from "./pages/seo/StudyTogetherPage";
import ProcrastinationPage from "./pages/seo/ProcrastinationPage";
import HowItWorksPage from "./pages/seo/HowItWorksPage";
import FaqPage from "./pages/seo/FaqPage";

import NotFoundPage from "./pages/NotFoundPage";
import SessionCardsPlayground from "./SessionCardsPlayground";
import IconVectorizerPage from "./pages/IconVectorizerPage";

function BlogIndexPlaceholder() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-[28px] border border-black/10 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
        <div className="px-6 py-7 sm:px-8 sm:py-8">
          <div className="inline-flex items-center rounded-full border border-black/10 bg-black/[0.03] px-3 py-1 text-[12px] font-medium text-[#606060]">
            Blog
          </div>

          <h1 className="mt-4 text-[30px] font-semibold tracking-tight text-[#2F2F2F] sm:text-[38px]">
            MySession Blog
          </h1>

          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[#606060]">
            Explore practical guides on body doubling, online coworking, deep
            work, structured focus sessions, accountability, and ADHD-friendly
            productivity — designed to help you work with more consistency and
            less friction.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/blog/best-focusmate-alternatives"
              className="rounded-xl border border-black/10 bg-[#81DB86]/25 px-4 py-2 text-[14px] font-medium text-[#245C29] transition hover:bg-[#81DB86]/35"
            >
              Best Focusmate alternatives
            </Link>

            <Link
              to="/updates"
              className="rounded-xl border border-black/10 bg-black/[0.03] px-4 py-2 text-[14px] text-[#2F2F2F] transition hover:bg-black/[0.06]"
            >
              See updates
            </Link>

            <Link
              to="/"
              className="rounded-xl border border-black/10 bg-white px-4 py-2 text-[14px] text-[#2F2F2F] transition hover:bg-black/[0.03]"
            >
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

function BlogPostPlaceholder() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-[28px] border border-black/10 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
        <div className="px-6 py-7 sm:px-8 sm:py-8">
          <div className="inline-flex items-center rounded-full border border-black/10 bg-black/[0.03] px-3 py-1 text-[12px] font-medium text-[#606060]">
            Blog post
          </div>

          <h1 className="mt-4 text-[30px] font-semibold tracking-tight text-[#2F2F2F] sm:text-[38px]">
            Blog post placeholder
          </h1>

          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[#606060]">
            This route works. Replace this placeholder with your real blog post
            page when you are ready.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/blog"
              className="rounded-xl border border-black/10 bg-black/[0.03] px-4 py-2 text-[14px] text-[#2F2F2F] transition hover:bg-black/[0.06]"
            >
              Back to blog
            </Link>

            <Link
              to="/"
              className="rounded-xl border border-black/10 bg-white px-4 py-2 text-[14px] text-[#2F2F2F] transition hover:bg-black/[0.03]"
            >
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function App() {
  console.log("[ROUTER] App mounted");

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
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<LandingPage />} />

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

          <Route path="/blog" element={<BlogIndexPlaceholder />} />

          <Route
            path="/blog/best-focusmate-alternatives"
            element={<FocusmateAlternativesPage />}
          />

          <Route path="/blog/:slug" element={<BlogPostPlaceholder />} />

          {/* SEO pages */}
          <Route path="/body-doubling" element={<BodyDoublingPage />} />

          <Route
            path="/adhd-body-doubling"
            element={<AdhdBodyDoublingPage />}
          />

          <Route
            path="/adhd-productivity"
            element={<AdhdProductivityPage />}
          />

          <Route
            path="/online-coworking"
            element={<OnlineCoworkingPage />}
          />

          <Route
            path="/virtual-coworking"
            element={<OnlineCoworkingPage />}
          />

          <Route
            path="/group-focus-sessions"
            element={<GroupFocusSessionsPage />}
          />

          <Route
            path="/focus-sessions"
            element={<GroupFocusSessionsPage />}
          />

          <Route
            path="/silent-coworking"
            element={<SilentCoworkingPage />}
          />

          <Route path="/study-together" element={<StudyTogetherPage />} />

          <Route
            path="/procrastination"
            element={<ProcrastinationPage />}
          />

          <Route path="/how-it-works" element={<HowItWorksPage />} />

          <Route path="/faq" element={<FaqPage />} />

          <Route
            path="/focusmate-alternatives"
            element={<FocusmateAlternativesPage />}
          />

          <Route path="/ai-assistant" element={<AIAssistantPage />} />

          <Route path="*" element={<NotFoundPage />} />
        </Route>

        <Route path="/:slug" element={<PublicSlugRedirectPage />} />

        <Route path="/vectorizer" element={<IconVectorizerPage />} />

        <Route path="/room-iframe/:id" element={<RoomPageIFrame />} />
        <Route path="/room-livekit/:id" element={<RoomPageLiveKit />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/update-password" element={<UpdatePasswordPage />} />

        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/auth/callback/" element={<AuthCallback />} />
      </Routes>
    </CreateSessionModalProvider>
  );
}
