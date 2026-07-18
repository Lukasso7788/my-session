import {
  PRICING,
  getWeeklyLimitState,
  hasUnlimitedAccess,
  type UserEntitlement,
  type WeeklyUsageRow,
} from "./billing";

export type PaywallDecision = {
  enabled: boolean;
  blocked: boolean;
  reason: "unlimited" | "within_limits" | "lifetime_limit_reached";
  isUnlimited: boolean;
  lifetimeSessionsCount: number | null;
  lifetimeSessionsLimit: number;
  weekly: ReturnType<typeof getWeeklyLimitState>;
};

export function getPaywallDecision(params: {
  entitlement: UserEntitlement | null;
  usage: WeeklyUsageRow | null;
  lifetimeSessionsCount: number | null;
}): PaywallDecision {
  const weekly = getWeeklyLimitState({
    entitlement: params.entitlement,
    sessionsUsed: params.usage?.sessions_count ?? 0,
    minutesUsed: params.usage?.minutes_total ?? 0,
  });

  const isUnlimited = hasUnlimitedAccess(params.entitlement);
  const lifetimeSessionsCount =
    typeof params.lifetimeSessionsCount === "number" &&
    Number.isFinite(params.lifetimeSessionsCount)
    ? Math.max(0, Number(params.lifetimeSessionsCount))
    : null;
  const lifetimeSessionsLimit = PRICING.freeLifetimeSessions;

  if (isUnlimited) {
    return {
      enabled: true,
      blocked: false,
      reason: "unlimited",
      isUnlimited,
      lifetimeSessionsCount,
      lifetimeSessionsLimit,
      weekly,
    };
  }

  // Fail open when attendance usage cannot be loaded. A temporary read failure
  // must never lock a legitimate user out of a room.
  if (lifetimeSessionsCount === null || lifetimeSessionsCount < lifetimeSessionsLimit) {
    return {
      enabled: true,
      blocked: false,
      reason: "within_limits",
      isUnlimited,
      lifetimeSessionsCount,
      lifetimeSessionsLimit,
      weekly,
    };
  }

  return {
    enabled: true,
    blocked: true,
    reason: "lifetime_limit_reached",
    isUnlimited,
    lifetimeSessionsCount,
    lifetimeSessionsLimit,
    weekly,
  };
}
