import type { Stripe } from "stripe";
import type { SubscriptionManagementSummary } from "../../src/types/subscriptionManagement";

type StripeSubscription = Awaited<ReturnType<Stripe["subscriptions"]["retrieve"]>>;
type PortalSessionParams = NonNullable<Parameters<Stripe["billingPortal"]["sessions"]["create"]>[0]>;

export type BillingIdentity = { plan: string | null; stripe_customer_id: string | null; stripe_subscription_id: string | null };

export function isRecurringBillingPlan(plan: string | null | undefined): boolean {
  return plan === "pro_monthly" || plan === "pro_yearly";
}

export function subscriptionPeriodEnd(subscription: StripeSubscription): string | null {
  // Modern Stripe versions put billing periods on subscription items.
  const legacyEnd = (subscription as StripeSubscription & { current_period_end?: number }).current_period_end;
  const end = legacyEnd || subscription.items.data[0]?.current_period_end;
  return typeof end === "number" && Number.isFinite(end) && end > 0 ? new Date(end * 1000).toISOString() : null;
}

async function portalConfiguration(stripe: Stripe, configurationId?: string) {
  if (configurationId) return stripe.billingPortal.configurations.retrieve(configurationId);
  const configurations = await stripe.billingPortal.configurations.list({ active: true, is_default: true, limit: 1 });
  return configurations.data[0] ?? null;
}

async function verifiedSubscription(stripe: Stripe, identity: BillingIdentity) {
  if (!identity.stripe_customer_id || !identity.stripe_subscription_id) return null;
  const subscription = await stripe.subscriptions.retrieve(identity.stripe_subscription_id);
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  if (customerId !== identity.stripe_customer_id) throw new Error("billing_subscription_mismatch");
  return subscription;
}

export async function subscriptionManagementSummary(stripe: Stripe, identity: BillingIdentity | null, configurationId?: string): Promise<SubscriptionManagementSummary> {
  const base: SubscriptionManagementSummary = {
    canManage: Boolean(identity?.stripe_customer_id), canCancel: false, status: null,
    cancellationScheduled: false, accessEndsAt: null, currentPeriodEnd: null,
    cancellationUnavailableReason: "not_recurring",
  };
  if (!identity?.stripe_customer_id || !identity.stripe_subscription_id || !isRecurringBillingPlan(identity.plan)) return base;
  const subscription = await verifiedSubscription(stripe, identity);
  if (!subscription) return base;
  const currentPeriodEnd = subscriptionPeriodEnd(subscription);
  const canceled = ["canceled", "incomplete_expired"].includes(subscription.status);
  const cancellationScheduled = !canceled && (subscription.cancel_at_period_end || Boolean(subscription.cancel_at));
  const accessEndsAt = subscription.cancel_at
    ? new Date(subscription.cancel_at * 1000).toISOString()
    : canceled && subscription.ended_at
      ? new Date(subscription.ended_at * 1000).toISOString()
      : currentPeriodEnd;
  if (canceled || cancellationScheduled) return {
    ...base, status: subscription.status, currentPeriodEnd, accessEndsAt, cancellationScheduled,
    cancellationUnavailableReason: canceled ? "already_canceled" : "scheduled",
  };
  const configuration = await portalConfiguration(stripe, configurationId);
  const canCancel = Boolean(configuration?.active && configuration.features.subscription_cancel.enabled && configuration.features.subscription_cancel.mode === "at_period_end" && !subscription.schedule);
  return { ...base, status: subscription.status, currentPeriodEnd, accessEndsAt, canCancel, cancellationUnavailableReason: canCancel ? null : "portal_not_configured" };
}

export async function createSubscriptionPortal(stripe: Stripe, identity: BillingIdentity | null, action: "manage" | "cancel", appUrl: string, configurationId?: string) {
  if (!identity?.stripe_customer_id) throw new Error("billing_profile_not_found");
  const returnUrl = `${appUrl.replace(/\/$/, "")}/settings?billing=returned#subscription`;
  const params: PortalSessionParams = {
    customer: identity.stripe_customer_id, return_url: returnUrl,
    ...(configurationId ? { configuration: configurationId } : {}),
  };
  if (action === "cancel") {
    if (!identity.stripe_subscription_id || !isRecurringBillingPlan(identity.plan)) throw new Error("billing_subscription_not_found");
    const summary = await subscriptionManagementSummary(stripe, identity, configurationId);
    if (summary.cancellationUnavailableReason === "portal_not_configured") throw new Error("billing_cancellation_not_configured");
    if (!summary.canCancel) throw new Error("billing_subscription_not_cancelable");
    params.flow_data = {
      type: "subscription_cancel",
      subscription_cancel: { subscription: identity.stripe_subscription_id },
      after_completion: { type: "redirect", redirect: { return_url: returnUrl } },
    };
  }
  // Opening this confirmation flow does NOT cancel or update the subscription.
  const session = await stripe.billingPortal.sessions.create(params);
  return { url: session.url };
}
