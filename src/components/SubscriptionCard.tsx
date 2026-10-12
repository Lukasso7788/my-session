import { CreditCard } from "lucide-react";
import { Link } from "react-router-dom";
import { getFreeSessionUsage } from "../lib/freeSessionNotice";
import { PAYWALL_ENABLED } from "../lib/flags";
import type { EntitlementState } from "../lib/entitlements";
import type { SubscriptionManagementSummary } from "../types/subscriptionManagement";
import { getMembershipPlanName, isComplimentaryPro } from "../lib/membershipPresentation";

export type PortalAction = "manage" | "cancel";
type SubscriptionCardProps = {
  state: EntitlementState | null;
  loading: boolean;
  error: boolean;
  summary: SubscriptionManagementSummary | null;
  summaryLoading: boolean;
  message: string;
  busyAction: PortalAction | null;
  onOpenPortal: (action: PortalAction) => void;
  onRefresh: () => void;
  paywallEnabled?: boolean;
};

function displayDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Kept separate from transport so every plan/return/error state can be tested. */
export default function SubscriptionCard({ state, loading, error, summary, summaryLoading, message, busyAction, onOpenPortal, onRefresh, paywallEnabled = PAYWALL_ENABLED }: SubscriptionCardProps) {
  const entitlement = state?.entitlement;
  const plan = entitlement?.plan || "free";
  const complimentary = isComplimentaryPro(entitlement);
  const planLabel = getMembershipPlanName(plan, complimentary);
  const usage = state ? getFreeSessionUsage({ ...state, enabled: paywallEnabled }) : null;
  const recurring = plan === "pro_monthly" || plan === "pro_yearly";
  const linked = Boolean(entitlement?.stripe_customer_id && entitlement.stripe_subscription_id);
  const ended = summary?.status === "canceled" || summary?.status === "incomplete_expired" || entitlement?.status === "canceled" || entitlement?.status === "expired";
  const statusLabel = summary?.cancellationScheduled ? "Cancellation scheduled" : ended ? "Ended" : entitlement?.status === "trialing" ? "Trial" : plan === "free" ? "Free" : "Active";
  const periodEnd = displayDate(summary?.currentPeriodEnd ?? null);
  const accessEnds = displayDate(summary?.accessEndsAt ?? null);
  const complimentaryEnds = displayDate(entitlement?.current_period_end ?? null);
  let description = "No recurring payments. Upgrade whenever you are ready.";
  if (plan === "founding_free") description = "Free permanent Pro access as a founding member. Separate from the purchased Lifetime plan, with no renewal payments.";
  else if (plan === "lifetime") description = "Purchased Lifetime access. No renewals or recurring payments to cancel.";
  else if (complimentary) description = ended
    ? `Your complimentary Pro access has ended${complimentaryEnds ? ` on ${complimentaryEnds}` : ""}. No recurring payments were set up.`
    : `Free Pro access${complimentaryEnds ? ` until ${complimentaryEnds}` : ""}. No recurring payments or automatic renewal.`;
  else if (recurring && !linked) description = "This Pro access has no linked auto-renewing subscription. There is nothing to cancel here.";
  else if (summary?.cancellationScheduled) description = accessEnds ? `Your subscription will not renew. Pro access ends on ${accessEnds}.` : "Your subscription will not renew. Stripe shows the exact end date in billing settings.";
  else if (ended) description = "Your subscription has ended. You can still view your billing history.";
  else if (recurring && linked) description = periodEnd
    ? summary?.canCancel
      ? `Renews on ${periodEnd}. You can turn off renewal without losing the rest of your current paid period.`
      : `Renews on ${periodEnd}. Manage your billing details securely in Stripe.`
    : "Manage your billing details securely in Stripe.";

  return (
    <section id="subscription" aria-labelledby="subscription-heading" className="mt-5 scroll-mt-6 overflow-hidden rounded-[28px] border border-black/10 bg-white shadow-sm">
      <div className="flex items-start gap-4 border-b border-black/10 px-5 py-5 sm:px-7">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#EDF5FF] text-[#245FBD]"><CreditCard className="h-5 w-5" aria-hidden="true" /></div>
        <div><h2 id="subscription-heading" className="text-xl font-bold">Subscription</h2><p className="mt-1 text-sm leading-6 text-[#606A77]">Your plan, free sessions and billing controls.</p></div>
      </div>
      <div className="space-y-4 px-5 py-5 sm:px-7 sm:py-6" aria-busy={loading || summaryLoading}>
        {error ? (
          <div role="status" className="text-sm text-[#465467]">Could not load your plan. <button type="button" onClick={onRefresh} className="font-semibold text-[#245FBD] underline underline-offset-2">Try again</button></div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold">{loading ? "Loading your plan…" : planLabel}</h3>{!loading ? <span className="rounded-full bg-[#EEF3F9] px-2.5 py-1 text-xs font-semibold text-[#35465C]">{statusLabel}</span> : null}</div>
            {!loading ? <p className="text-[13px] leading-5 text-[#606A77]">{description}</p> : null}
            {usage ? (
              <div className="rounded-2xl border border-[#D0DFF1] bg-[#F6FAFF] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-[#16365C]">{usage.title}</p><span className="text-xs text-[#405D7F]">{Math.min(usage.used, usage.limit)} / {usage.limit} free sessions used</span></div>
                <div role="progressbar" aria-label="Free sessions used" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={Math.min(usage.used, usage.limit)} className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#DCE7F6]"><div className="h-full rounded-full bg-[#4385DA]" style={{ width: `${Math.min(100, usage.used / usage.limit * 100)}%` }} /></div>
                <Link to="/pricing" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-[#245FBD] px-4 text-sm font-semibold text-white hover:bg-[#194C9B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245FBD]">Upgrade to Pro</Link>
              </div>
            ) : !loading && plan === "free" && state?.lifetimeSessionsCount !== null && state?.lifetimeSessionsCount !== undefined ? <p className="text-xs text-[#606A77]">{state.lifetimeSessionsCount} sessions attended.</p> : null}
            {!loading && linked ? (
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => onOpenPortal("manage")} disabled={Boolean(busyAction) || summaryLoading} className="min-h-11 rounded-full border border-[#BDCADA] px-4 text-sm font-semibold text-[#28476A] hover:bg-[#EDF5FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245FBD] disabled:cursor-not-allowed disabled:opacity-50">{busyAction === "manage" ? "Opening…" : "Manage billing"}</button>
                {summary?.canCancel ? <button type="button" onClick={() => onOpenPortal("cancel")} disabled={Boolean(busyAction)} className="min-h-11 rounded-full border border-[#BDCADA] px-4 text-sm font-medium text-[#465467] hover:bg-[#F1F4F8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245FBD] disabled:cursor-not-allowed disabled:opacity-50">{busyAction === "cancel" ? "Opening confirmation…" : "Cancel subscription"}</button> : null}
                <button type="button" onClick={onRefresh} disabled={Boolean(busyAction) || summaryLoading} className="min-h-11 px-1 text-sm font-medium text-[#245FBD] underline underline-offset-4 disabled:opacity-50">Refresh billing details</button>
              </div>
            ) : null}
            {summary?.canCancel ? <p className="text-xs leading-5 text-[#606A77]">You’ll confirm cancellation in Stripe. Opening that page does not cancel your subscription.</p> : null}
            {summary?.cancellationUnavailableReason === "portal_not_configured" ? <p role="status" className="text-xs leading-5 text-[#606A77]">Cancellation is not available in this billing portal yet. <Link to="/contact" className="font-semibold text-[#245FBD] underline">Contact support</Link> to turn off renewal.</p> : null}
          </>
        )}
        {message ? <p role="status" className="text-sm leading-5 text-[#465467]">{message}</p> : null}
      </div>
    </section>
  );
}
