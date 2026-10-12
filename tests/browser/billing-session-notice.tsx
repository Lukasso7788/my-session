import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../src/index.css";
import FreeSessionsNotice from "../../src/components/FreeSessionsNotice";
import SubscriptionCard from "../../src/components/SubscriptionCard";
import HeaderPlanBadge from "../../src/components/HeaderPlanBadge";
import { getWeeklyLimitState, type UserEntitlement } from "../../src/lib/billing";
import { getMembershipBadge } from "../../src/lib/membershipPresentation";
import type { EntitlementState } from "../../src/lib/entitlements";
import type { SubscriptionManagementSummary } from "../../src/types/subscriptionManagement";

const modes = ["Free · 11 visits", "Free · 12 visits", "Free · 13 visits", "Free · 14 visits", "Free · 15 visits", "Pro subscription", "Cancellation scheduled", "Lifetime", "FM Pro", "Granted Pro", "Complimentary Pro", "Complimentary Pro ended", "Billing error", "Cancellation unavailable"];
function Preview() {
  const [mode, setMode] = useState("Free · 12 visits");
  const [message, setMessage] = useState("");
  const [planOpen, setPlanOpen] = useState(false);
  const plan = mode === "Lifetime" ? "lifetime" : mode === "FM Pro" ? "founding_free" : /Pro|Cancellation|Billing/.test(mode) ? "pro_monthly" : "free";
  const count = mode.startsWith("Free · ") ? Number(mode.match(/\d+/)?.[0]) : 42;
  const complimentary = mode.startsWith("Complimentary Pro");
  const ended = mode === "Complimentary Pro ended";
  const linked = plan === "pro_monthly" && mode !== "Granted Pro" && !complimentary;
  const entitlement: UserEntitlement = { id: "fixture", user_id: "fixture", plan, status: ended ? "expired" : "active", trial_started_at: null, trial_ends_at: null, current_period_start: "2026-10-12T05:44:22Z", current_period_end: complimentary ? "2027-04-12T05:44:22Z" : "2026-11-01T00:00:00Z", lifetime_granted_at: null, founding_granted_at: null, source: complimentary ? "admin_complimentary_pro" : "local_test_only", notes: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", stripe_customer_id: linked ? "test_only_customer" : null, stripe_subscription_id: linked ? "test_only_subscription" : null };
  const state: EntitlementState = { entitlement, usage: null, lifetimeSessionsCount: count, isLoggedIn: true, isActive: !ended, isTrial: false, isUnlimited: plan !== "free" && !ended, weekly: getWeeklyLimitState({ entitlement, sessionsUsed: 0, minutesUsed: 0 }) };
  const badge = getMembershipBadge({ isLoggedIn: true, isUnlimited: state.isUnlimited, plan })!;
  const summary: SubscriptionManagementSummary | null = linked ? { canManage: true, canCancel: mode === "Pro subscription", status: "active", cancellationScheduled: mode === "Cancellation scheduled", accessEndsAt: "2026-11-01T00:00:00Z", currentPeriodEnd: "2026-11-01T00:00:00Z", cancellationUnavailableReason: mode === "Cancellation scheduled" ? "scheduled" : mode === "Cancellation unavailable" ? "portal_not_configured" : null } : null;
  return <MemoryRouter><main className="min-h-screen bg-[#F7F8FA] px-4 py-8 font-inter text-[#2F2F2F] sm:px-6 sm:py-12"><div className="mx-auto max-w-3xl">
    <p className="text-xs font-semibold uppercase tracking-widest text-[#58708C]">Local UI check · No live billing requests</p><h1 className="mt-3 text-3xl font-bold tracking-tight">Your MySession account</h1><p className="mt-2 text-sm text-[#606A77]">Free-session allowance and a clear way to manage renewal.</p>
    <div className="relative z-10 mt-6 inline-flex items-center justify-center" data-preview-wordmark>
      <span className="text-[28px] font-extrabold leading-normal md:text-4xl">MySession</span>
      <HeaderPlanBadge label={badge} open={planOpen} title={badge === "FM Pro" ? "Founding Member Pro" : `${badge} plan`} description={badge === "FM Pro" ? "Free permanent Pro access as a founding member. No subscription or renewal payments." : "Your plan details, session allowance and billing controls are available in account settings."} onBadgeClick={() => setPlanOpen((value) => !value)} onOpen={() => setPlanOpen(true)} onClose={() => setPlanOpen(false)} onActionClick={() => { setPlanOpen(false); setMessage("Local test: plan action selected; no navigation or live billing request."); }} />
    </div>
    <label className="mt-6 flex flex-wrap items-center gap-3 text-sm font-medium">Preview state<select aria-label="Preview state" value={mode} onChange={(event) => { setMode(event.target.value); setPlanOpen(false); setMessage(""); }} className="min-h-11 max-w-full rounded-xl border border-[#C4D0DE] bg-white px-3">{modes.map((value) => <option key={value}>{value}</option>)}</select></label>
    <div className="mt-6"><FreeSessionsNotice state={state} enabled /></div>
    <SubscriptionCard state={state} loading={false} error={false} summary={summary} summaryLoading={false} message={mode === "Billing error" ? "Could not load subscription settings. Please try again." : message} busyAction={null} onOpenPortal={(action) => setMessage(action === "cancel" ? "Local test: Cancel opens Stripe confirmation; no subscription was changed." : "Local test: Manage opens Stripe billing; no live request was made.")} onRefresh={() => setMessage("Local test: billing details refreshed.")} paywallEnabled />
  </div></main></MemoryRouter>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
