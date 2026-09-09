import { supabase } from "./supabase";
import {
  UserEntitlement,
  hasUnlimitedAccess,
  isTrialActive,
  isEntitlementActive,
  getWeeklyLimitState,
} from "./billing";
import {
  getWeeklyUsage,
  getWeekStartDate,
  WeeklyUsageRow,
} from "./usage";
import { PAYWALL_ENABLED } from "./flags";

export type EntitlementState = {
  entitlement: UserEntitlement | null;
  usage: WeeklyUsageRow | null;
  lifetimeSessionsCount: number | null;

  isLoggedIn: boolean;

  isActive: boolean;
  isTrial: boolean;
  isUnlimited: boolean;

  weekly: ReturnType<typeof getWeeklyLimitState>;
};

type EntitlementCacheEntry = {
  expiresAt: number;
  state: EntitlementState;
};

const ENTITLEMENT_STATE_TTL_MS = 2 * 60_000;
const entitlementStateCache = new Map<string, EntitlementCacheEntry>();
const entitlementStateInFlight = new Map<string, Promise<EntitlementState>>();

export function invalidateEntitlementStateCache(userId?: string) {
  const normalizedUserId = String(userId || "").trim();
  if (normalizedUserId) {
    entitlementStateCache.delete(normalizedUserId);
    entitlementStateInFlight.delete(normalizedUserId);
    return;
  }

  entitlementStateCache.clear();
  entitlementStateInFlight.clear();
}

export function isPersonalPaywallForced(
  state: EntitlementState | null | undefined
): boolean {
  return PAYWALL_ENABLED && state?.entitlement?.force_paywall === true;
}

function normalizeWeekStartForQuery(input: unknown): string {
  if (input instanceof Date) {
    return input.toISOString().slice(0, 10);
  }

  const raw = String(input || "").trim();
  if (!raw) {
    return new Date().toISOString().slice(0, 10);
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return raw;
}

export async function getUserEntitlement(
  userId: string
): Promise<UserEntitlement | null> {
  if (!userId) return null;

  const { data, error } = await supabase
    .from("user_entitlements")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("getUserEntitlement error:", error);
    throw error;
  }

  return (data as UserEntitlement | null) ?? null;
}

async function getLifetimeSessionsCount(userId: string): Promise<number | null> {
  const rpcResult = await supabase.rpc("get_lifetime_attendance_count");

  if (!rpcResult.error) {
    return Math.max(0, Number(rpcResult.data || 0));
  }

  const code = String(rpcResult.error?.code || "");
  if (code !== "42883" && code !== "PGRST202") {
    console.error("getLifetimeSessionsCount RPC error:", rpcResult.error);
  }

  const fallbackResult = await supabase
    .from("session_attendance")
    .select("session_id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (fallbackResult.error) {
    console.error("getLifetimeSessionsCount fallback error:", fallbackResult.error);
    return null;
  }

  return Math.max(0, Number(fallbackResult.count || 0));
}

function loggedOutEntitlementState(): EntitlementState {
  return {
    entitlement: null,
    usage: null,
    lifetimeSessionsCount: null,
    isLoggedIn: false,
    isActive: false,
    isTrial: false,
    isUnlimited: false,
    weekly: getWeeklyLimitState({
      entitlement: null,
      sessionsUsed: 0,
      minutesUsed: 0,
    }),
  };
}

async function loadEntitlementStateForUser(userId: string): Promise<EntitlementState> {
  const [entitlement, lifetimeSessionsCount] = await Promise.all([
    getUserEntitlement(userId),
    getLifetimeSessionsCount(userId),
  ]);

  const rawWeekStart = getWeekStartDate();
  const normalizedWeekStart = normalizeWeekStartForQuery(rawWeekStart);

  let usage: WeeklyUsageRow | null = null;

  try {
    // A missing weekly row is a valid zero-usage state. Do not issue the same
    // query two more times just because maybeSingle() returned null.
    usage = await getWeeklyUsage(userId, normalizedWeekStart);
  } catch (err) {
    console.error("getWeeklyUsage failed:", err);
  }

  const sessionsUsed = usage?.sessions_count ?? 0;
  const minutesUsed = usage?.minutes_total ?? 0;

  const isTrial = isTrialActive(entitlement);
  const isActive = isEntitlementActive(entitlement);
  const isUnlimited = hasUnlimitedAccess(entitlement);

  const weekly = getWeeklyLimitState({
    entitlement,
    sessionsUsed,
    minutesUsed,
  });

  console.log("[entitlements] loadEntitlementState result", {
    userId,
    rawWeekStart,
    normalizedWeekStart,
    entitlement,
    usage,
    lifetimeSessionsCount,
    sessionsUsed,
    minutesUsed,
    isTrial,
    isActive,
    isUnlimited,
    weekly,
  });

  return {
    entitlement,
    usage,
    lifetimeSessionsCount,
    isLoggedIn: true,
    isActive,
    isTrial,
    isUnlimited,
    weekly,
  };
}

/**
 * Room/access effects can ask for the same state several times in quick
 * succession. Share one per-user result for two minutes instead of repeating
 * the entitlement + weekly usage + lifetime attendance waterfall.
 */
export async function loadEntitlementState(): Promise<EntitlementState> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    console.error("getSession error:", sessionError);
  }

  const userId = String(session?.user?.id || "").trim();
  if (!userId) return loggedOutEntitlementState();

  const now = Date.now();
  const cached = entitlementStateCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.state;
  }

  const pending = entitlementStateInFlight.get(userId);
  if (pending) return pending;

  const loadPromise = loadEntitlementStateForUser(userId);
  entitlementStateInFlight.set(userId, loadPromise);

  try {
    const state = await loadPromise;
    entitlementStateCache.set(userId, {
      expiresAt: Date.now() + ENTITLEMENT_STATE_TTL_MS,
      state,
    });
    return state;
  } finally {
    if (entitlementStateInFlight.get(userId) === loadPromise) {
      entitlementStateInFlight.delete(userId);
    }
  }
}
