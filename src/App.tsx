import { Routes, Route, Link } from "react-router-dom";

import { SessionsPage } from "./pages/SessionsPage";
import LandingPage from "./pages/LandingPage";
import RoomPage from "./pages/RoomPage";
import RoomPageIFrame from "./pages/RoomPageIFrame";
import RoomPageLiveKit from "./pages/RoomPageLiveKit";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import UpdatePasswordPage from "./pages/UpdatePasswordPage";
import ProfilePage from "./pages/ProfilePage";
import FocusPlanPage from "./pages/FocusPlanPage";
import FocusShieldPage from "./pages/FocusShieldPage";
import PublicProfilePage from "./pages/PublicProfilePage";
import AuthCallback from "./pages/AuthCallback";
import AdminPage from "./pages/AdminPage";
import DailyScheduleEmailAdminPage from "./pages/DailyScheduleEmailAdminPage";

import PricingPage from "./pages/PricingPage";
import PricingSuccessPage from "./pages/PricingSuccessPage";
import UpdatesPage from "./pages/UpdatesPage";

import PrivacyPage from "./pages/PrivacyPage";
import DataDeletionPage from "./pages/DataDeletionPage";
import Terms from "./pages/Terms";
import RulesPage from "./pages/RulesPage";
import RefundPolicyPage from "./pages/RefundPolicyPage";
import ContactPage from "./pages/ContactPage";

import AppLayout from "./layouts/AppLayout";
import { CreateSessionModalProvider } from "./context/CreateSessionModalContext";

// ✅ Canonical/SEO pages
import BodyDoublingPage from "./pages/seo/BodyDoublingPage";
import OnlineCoworkingPage from "./pages/seo/OnlineCoworkingPage";
import GroupFocusSessionsPage from "./pages/seo/GroupFocusSessionsPage";
import SilentCoworkingPage from "./pages/seo/SilentCoworkingPage";
import AdhdProductivityPage from "./pages/seo/AdhdProductivityPage";

// ✅ 404
import NotFoundPage from "./pages/NotFoundPage";

// ✅ UI playground (local testing page)
import SessionCardsPlayground from "./SessionCardsPlayground";

/**
 * TEMP blog pages to keep deploy green.
 * Later you can replace these with:
 * import BlogIndex from "./pages/BlogIndex";
 * import BlogPost from "./pages/BlogPost";
 */
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
            Explore practical guides on body doubling, online coworking, deep work,
            structured focus sessions, accountability, and ADHD-friendly productivity —
            designed to help you work with more consistency and less friction.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
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
            This route works. Replace this placeholder with your real blog post page
            when you are ready.
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

  return (
    <CreateSessionModalProvider>
      <Routes>
        {/* Routes WITH header/footer */}
        <Route element={<AppLayout />}>
          {/* Root */}
          <Route path="/" element={<LandingPage />} />

          {/* Core app pages */}
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/pricing/success" element={<PricingSuccessPage />} />
          <Route path="/updates" element={<UpdatesPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:id" element={<PublicProfilePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route
            path="/admin/daily-schedule-email"
            element={<DailyScheduleEmailAdminPage />}
          />
          <Route path="/focus-plan" element={<FocusPlanPage />} />
          <Route path="/focus-shield" element={<FocusShieldPage />} />

          {/* UI Playground */}
          <Route path="/ui-playground" element={<SessionCardsPlayground />} />

          {/* Legal */}
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refund-policy" element={<RefundPolicyPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/data-deletion" element={<DataDeletionPage />} />
          <Route path="/rules" element={<RulesPage />} />

          {/* Blog placeholders */}
          <Route path="/blog" element={<BlogIndexPlaceholder />} />
          <Route path="/blog/:slug" element={<BlogPostPlaceholder />} />

          {/* Canonical SEO pages */}
          <Route path="/body-doubling" element={<BodyDoublingPage />} />
          <Route path="/online-coworking" element={<OnlineCoworkingPage />} />
          <Route
            path="/group-focus-sessions"
            element={<GroupFocusSessionsPage />}
          />
          <Route path="/silent-coworking" element={<SilentCoworkingPage />} />
          <Route path="/adhd-productivity" element={<AdhdProductivityPage />} />

          {/* Temporary AI assistant route */}
          <Route path="/ai-assistant" element={<SessionsPage />} />

          {/* 404 for layout routes */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        {/* Routes WITHOUT header/footer */}
        <Route path="/room/:id" element={<RoomPage />} />
        <Route path="/room-iframe/:id" element={<RoomPageIFrame />} />
        <Route path="/room-livekit/:id" element={<RoomPageLiveKit />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/update-password" element={<UpdatePasswordPage />} />

        {/* OAuth callback routes */}
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/auth/callback/" element={<AuthCallback />} />
      </Routes>
    </CreateSessionModalProvider>
  );
}
