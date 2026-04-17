import { PAYWALL_ENABLED } from "./flags";
import {
  getWeeklyLimitState,
  hasUnlimitedAccess,
  type UserEntitlement,
  type WeeklyUsageRow,
} from "./billing";

export type PaywallDecision = {
  enabled: boolean;
  blocked: boolean;
  reason: "disabled" | "unlimited" | "within_limits" | "weekly_limit_reached";
  isUnlimited: boolean;
  weekly: ReturnType<typeof getWeeklyLimitState>;
};

export function getPaywallDecision(params: {
  entitlement: UserEntitlement | null;
  usage: WeeklyUsageRow | null;
}): PaywallDecision {
  const weekly = getWeeklyLimitState({
    entitlement: params.entitlement,
    sessionsUsed: params.usage?.sessions_count ?? 0,
    minutesUsed: params.usage?.minutes_total ?? 0,
  });

  const isUnlimited = hasUnlimitedAccess(params.entitlement);

  if (!PAYWALL_ENABLED) {
    return {
      enabled: false,
      blocked: false,
      reason: "disabled",
      isUnlimited,
      weekly,
    };
  }

  if (isUnlimited) {
    return {
      enabled: true,
      blocked: false,
      reason: "unlimited",
      isUnlimited,
      weekly,
    };
  }

  if (!weekly.limitExceeded) {
    return {
      enabled: true,
      blocked: false,
      reason: "within_limits",
      isUnlimited,
      weekly,
    };
  }

  return {
    enabled: true,
    blocked: true,
    reason: "weekly_limit_reached",
    isUnlimited,
    weekly,
  };
}