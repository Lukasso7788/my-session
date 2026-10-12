import { hasUnlimitedAccess, PRICING, type UserEntitlement } from "./billing";

export type FreeSessionUsage = {
  used: number;
  limit: number;
  remaining: number;
  showWarning: boolean;
  title: string;
};

/** Presentation only: this must not enable the paywall or alter admission. */
export function getFreeSessionUsage(params: {
  enabled: boolean;
  isLoggedIn: boolean;
  entitlement: UserEntitlement | null;
  lifetimeSessionsCount: number | null;
}): FreeSessionUsage | null {
  if (!params.enabled || !params.isLoggedIn || hasUnlimitedAccess(params.entitlement)) return null;
  if (params.lifetimeSessionsCount === null || !Number.isFinite(params.lifetimeSessionsCount)) return null;

  const used = Math.max(0, Math.floor(params.lifetimeSessionsCount));
  const limit = PRICING.freeLifetimeSessions;
  const remaining = Math.max(0, limit - used);
  const title = remaining === 3
    ? "Three sessions left"
    : remaining === 2
      ? "Two sessions left"
      : remaining === 1
        ? "One session left"
        : remaining === 0
          ? "Your free sessions are used"
          : `${remaining} free sessions left`;

  return { used, limit, remaining, showWarning: remaining <= 3, title };
}
