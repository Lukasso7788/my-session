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
  force_paywall?: boolean | null;

  trial_started_at: string | null;
  trial_ends_at: string | null;

  current_period_start: string | null;
  current_period_end: string | null;

  lifetime_granted_at: string | null;
  founding_granted_at: string | null;

  source: string | null;
  notes: string | null;

  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;

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

export type WeeklyUsageRow = {
  id?: string;
  user_id: string;
  week_start: string;
  sessions_count: number;
  minutes_total: number;
  created_at?: string;
  updated_at?: string;
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
  freeLifetimeSessions: 15,
  supportPromptAfterSessions: 5,
  trialDays: 7,
} as const;

export function isPaidPlan(plan: BillingPlanCode | null | undefined): boolean {
  return plan === "pro_monthly" || plan === "pro_yearly" || plan === "lifetime";
}

type AccessFields = Pick<UserEntitlement, "plan" | "status"> &
  Partial<Pick<UserEntitlement, "current_period_end" | "trial_ends_at">>;

/** Parsed timestamp in ms, or null for a missing or unparseable value. */
export function parseEntitlementDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

/** Permanent memberships: purchased Lifetime and Founding Member Pro. */
export function isPermanentPlan(plan: BillingPlanCode | string | null | undefined): boolean {
  return plan === "lifetime" || plan === "founding_free";
}

export function isRecurringProPlan(plan: BillingPlanCode | string | null | undefined): boolean {
  return plan === "pro_monthly" || plan === "pro_yearly";
}

/**
 * Monthly/yearly Pro needs a paid period that has not ended yet: `active`
 * alone is not enough, and a missing or invalid end date never grants access.
 */
export function hasPaidProPeriod(
  entitlement: AccessFields | null | undefined,
  now = new Date()
): boolean {
  if (!entitlement || !isRecurringProPlan(entitlement.plan)) return false;
  if (entitlement.status !== "active") return false;
  const endsAt = parseEntitlementDate(entitlement.current_period_end);
  return endsAt !== null && endsAt > now.getTime();
}

/**
 * The single access rule for Pro features, used by the app and the server.
 * - Lifetime / Founding Member Pro: active (or legacy trialing) rows, no dates.
 * - Monthly/yearly Pro: a current paid period (see hasPaidProPeriod).
 * - Trials: their own end date (see isTrialActive), never the paid period.
 */
export function hasUnlimitedAccess(
  entitlement: AccessFields | null | undefined,
  now = new Date()
): boolean {
  if (!entitlement) return false;

  if (isPermanentPlan(entitlement.plan)) {
    return entitlement.status === "active" || entitlement.status === "trialing";
  }

  if (!isRecurringProPlan(entitlement.plan)) return false;
  if (entitlement.status === "trialing") return isTrialActive(entitlement, now);
  return hasPaidProPeriod(entitlement, now);
}

/**
 * A Stripe-linked monthly/yearly row that still says active but whose paid
 * period is over: possibly a renewal the database never recorded (older
 * webhooks did not extend the period). Worth one check with Stripe.
 */
export function needsStripeResync(
  entitlement: (AccessFields & Partial<Pick<UserEntitlement, "stripe_subscription_id">>) | null | undefined,
  now = new Date()
): boolean {
  if (!entitlement?.stripe_subscription_id || !isRecurringProPlan(entitlement.plan)) return false;
  if (entitlement.status !== "active" && entitlement.status !== "trialing") return false;
  return !hasPaidProPeriod(entitlement, now) && !isTrialActive(entitlement, now);
}

export function isTrialActive(
  entitlement: Pick<UserEntitlement, "status"> & Partial<Pick<UserEntitlement, "trial_ends_at">> | null | undefined,
  now = new Date()
): boolean {
  if (!entitlement) return false;
  if (entitlement.status !== "trialing") return false;

  const endsAt = parseEntitlementDate(entitlement.trial_ends_at);
  return endsAt !== null && endsAt > now.getTime();
}

export function isEntitlementActive(
  entitlement: AccessFields | null | undefined,
  now = new Date()
): boolean {
  if (!entitlement) return false;
  if (entitlement.status === "trialing") return isTrialActive(entitlement, now);
  if (entitlement.status !== "active") return false;
  if (isPermanentPlan(entitlement.plan)) return true;
  return hasPaidProPeriod(entitlement, now);
}

export function getWeeklyLimitState(args: {
  entitlement:
    | Pick<UserEntitlement, "plan" | "status" | "trial_ends_at" | "current_period_end">
    | null
    | undefined;
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
