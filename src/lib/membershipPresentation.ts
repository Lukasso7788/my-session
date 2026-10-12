import type { BillingPlanCode, UserEntitlement } from "./billing";

export function isComplimentaryPro(entitlement: Pick<UserEntitlement, "plan" | "source"> & Partial<Pick<UserEntitlement, "stripe_subscription_id">> | null | undefined): boolean {
  return Boolean(entitlement
    && entitlement.source === "admin_complimentary_pro"
    && (entitlement.plan === "pro_monthly" || entitlement.plan === "pro_yearly")
    && !entitlement.stripe_subscription_id);
}

/** The header follows resolved access, not a historical plan code. */
export function getMembershipBadge(params: {
  isLoggedIn: boolean;
  isUnlimited: boolean;
  plan?: BillingPlanCode | null;
}): "Free" | "Pro" | "FM Pro" | null {
  if (!params.isLoggedIn) return null;
  if (!params.isUnlimited) return "Free";
  return params.plan === "founding_free" ? "FM Pro" : "Pro";
}

export function getMembershipPlanName(plan: BillingPlanCode, complimentary = false): string {
  if (complimentary && (plan === "pro_monthly" || plan === "pro_yearly")) return "Complimentary Pro";
  switch (plan) {
    case "pro_monthly": return "MySession Pro · Monthly";
    case "pro_yearly": return "MySession Pro · Yearly";
    case "lifetime": return "MySession Lifetime";
    case "founding_free": return "Founding Member Pro";
    default: return "MySession Free";
  }
}
