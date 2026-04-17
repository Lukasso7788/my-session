export type BillingPlanCode =
  | "free"
  | "pro_monthly"
  | "pro_yearly"
  | "lifetime"
  | "founding_free";

export type EntitlementStatus =
  | "active"
  | "trialing"
  | "expired"
  | "canceled";

export type UserEntitlement = {
  id: string;
  user_id: string;
  plan: BillingPlanCode;
  status: EntitlementStatus;

  trial_started_at: string | null;
  trial_ends_at: string | null;

  current_period_start: string | null;
  current_period_end: string | null;

  lifetime_granted_at: string | null;
  founding_granted_at: string | null;

  source: string | null;
  notes: string | null;

  created_at: string;
  updated_at: string;
};

export type BillingPlanRow = {
  id: string;
  code: BillingPlanCode;
  name: string;
  price_usd: number;
  billing_interval: "month" | "year" | "lifetime" | "none" | null;
  sessions_per_week_limit: number | null;
  minutes_per_week_limit: number | null;
  trial_days: number | null;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type WeeklyLimitState = {
  sessionsUsed: number;
  sessionsLimit: number | null;
  minutesUsed: number;
  minutesLimit: number | null;
  sessionsRemaining: number | null;
  minutesRemaining: number | null;
  sessionsExceeded: boolean;
  minutesExceeded: boolean;
  limitExceeded: boolean;
};

export const PRICING = {
  monthlyUsd: 10,
  yearlyUsd: 96,
  lifetimeUsd: 300,
  lifetimeSlotsTotal: 5,
  freeSessionsPerWeek: 3,
  freeMinutesPerWeek: 540,
  trialDays: 7,
} as const;

export function isPaidPlan(plan: BillingPlanCode | null | undefined): boolean {
  return plan === "pro_monthly" || plan === "pro_yearly" || plan === "lifetime";
}

export function hasUnlimitedAccess(
  entitlement: Pick<UserEntitlement, "plan" | "status"> | null | undefined
): boolean {
  if (!entitlement) return false;
  if (entitlement.status !== "active" && entitlement.status !== "trialing") return false;

  return (
    entitlement.plan === "pro_monthly" ||
    entitlement.plan === "pro_yearly" ||
    entitlement.plan === "lifetime" ||
    entitlement.plan === "founding_free"
  );
}

export function isTrialActive(
  entitlement: Pick<UserEntitlement, "status" | "trial_ends_at"> | null | undefined,
  now = new Date()
): boolean {
  if (!entitlement) return false;
  if (entitlement.status !== "trialing") return false;
  if (!entitlement.trial_ends_at) return false;

  const endsAt = new Date(entitlement.trial_ends_at);
  if (Number.isNaN(endsAt.getTime())) return false;

  return endsAt.getTime() > now.getTime();
}

export function isEntitlementActive(
  entitlement: Pick<UserEntitlement, "status" | "current_period_end" | "plan"> | null | undefined,
  now = new Date()
): boolean {
  if (!entitlement) return false;

  if (entitlement.status === "trialing") return true;
  if (entitlement.status !== "active") return false;

  if (entitlement.plan === "lifetime" || entitlement.plan === "founding_free") {
    return true;
  }

  if (!entitlement.current_period_end) return true;

  const endsAt = new Date(entitlement.current_period_end);
  if (Number.isNaN(endsAt.getTime())) return false;

  return endsAt.getTime() > now.getTime();
}

export function getWeeklyLimitState(args: {
  entitlement: Pick<UserEntitlement, "plan" | "status" | "trial_ends_at" | "current_period_end"> | null | undefined;
  sessionsUsed: number;
  minutesUsed: number;
}): WeeklyLimitState {
  const { entitlement } = args;
  const sessionsUsed = Math.max(0, Number(args.sessionsUsed || 0));
  const minutesUsed = Math.max(0, Number(args.minutesUsed || 0));

  if (hasUnlimitedAccess(entitlement) || isTrialActive(entitlement)) {
    return {
      sessionsUsed,
      sessionsLimit: null,
      minutesUsed,
      minutesLimit: null,
      sessionsRemaining: null,
      minutesRemaining: null,
      sessionsExceeded: false,
      minutesExceeded: false,
      limitExceeded: false,
    };
  }

  const sessionsLimit = PRICING.freeSessionsPerWeek;
  const minutesLimit = PRICING.freeMinutesPerWeek;

  const sessionsRemaining = Math.max(0, sessionsLimit - sessionsUsed);
  const minutesRemaining = Math.max(0, minutesLimit - minutesUsed);

  const sessionsExceeded = sessionsUsed >= sessionsLimit;
  const minutesExceeded = minutesUsed >= minutesLimit;

  return {
    sessionsUsed,
    sessionsLimit,
    minutesUsed,
    minutesLimit,
    sessionsRemaining,
    minutesRemaining,
    sessionsExceeded,
    minutesExceeded,
    limitExceeded: sessionsExceeded || minutesExceeded,
  };
}

export function formatUsd(price: number): string {
  return `$${Math.round(price)}`;
}