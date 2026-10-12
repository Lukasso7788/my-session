import { supabase } from "./supabase";
import type { SubscriptionManagementSummary } from "../types/subscriptionManagement";

async function billingRequest(body: Record<string, string>, signal?: AbortSignal) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again to manage your subscription.");
  const response = await fetch("/api/billing/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages: Record<string, string> = {
      billing_profile_not_found: "This account has no Stripe billing profile to manage.",
      billing_subscription_not_found: "This plan does not have a recurring subscription to cancel.",
      billing_subscription_not_cancelable: "This subscription is already canceled or scheduled to end. Refresh your billing details.",
      billing_cancellation_not_configured: "Cancellation is not available in billing settings yet. Please contact support.",
      billing_subscription_mismatch: "We could not verify this subscription belongs to your account. Please contact support.",
    };
    throw new Error(messages[payload.error] || "Could not load subscription settings. Please try again.");
  }
  return payload;
}

export async function getSubscriptionManagementSummary(signal?: AbortSignal): Promise<SubscriptionManagementSummary> {
  const payload = await billingRequest({ checkoutKind: "subscription_status" }, signal);
  if (!payload.subscription || typeof payload.subscription.canManage !== "boolean") throw new Error("Could not load subscription details.");
  return payload.subscription;
}

export async function openSubscriptionPortal(action: "manage" | "cancel") {
  const payload = await billingRequest({ checkoutKind: "customer_portal", portalAction: action });
  let url: URL;
  try { url = new URL(String(payload.url || "")); }
  catch { throw new Error("Could not open secure billing settings."); }
  if (url.protocol !== "https:" || url.hostname !== "billing.stripe.com") throw new Error("Could not open secure billing settings.");
  window.location.assign(url.href);
}
