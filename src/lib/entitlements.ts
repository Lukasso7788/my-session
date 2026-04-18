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

export type EntitlementState = {
  entitlement: UserEntitlement | null;
  usage: WeeklyUsageRow | null;

  isLoggedIn: boolean;

  isActive: boolean;
  isTrial: boolean;
  isUnlimited: boolean;

  weekly: ReturnType<typeof getWeeklyLimitState>;
};

function normalizeWeekStartForQuery(input: unknown): string {
  if (input instanceof Date) {
    return input.toISOString().slice(0, 10);
  }

  const raw = String(input || "").trim();
  if (!raw) {
    return new Date().toISOString().slice(0, 10);
  }

  // "2026-04-13 00:00:00+00" -> "2026-04-13"
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return raw;
}

/**
 * 🔹 Получить entitlement пользователя
 */
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

/**
 * 🔹 Fallback: получить usage напрямую, если helper не сработал
 */
async function getWeeklyUsageDirect(
  userId: string,
  weekStart: string
): Promise<WeeklyUsageRow | null> {
  if (!userId || !weekStart) return null;

  const { data, error } = await supabase
    .from("user_weekly_usage")
    .select("*")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();

  if (error) {
    console.error("getWeeklyUsageDirect error:", error);
    throw error;
  }

  return (data as WeeklyUsageRow | null) ?? null;
}

/**
 * 🔹 Основная функция: собрать ВСЁ состояние пользователя
 */
export async function loadEntitlementState(): Promise<EntitlementState> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error("getUser error:", userError);
  }

  if (!user) {
    return {
      entitlement: null,
      usage: null,
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

  const entitlement = await getUserEntitlement(user.id);

  const rawWeekStart = getWeekStartDate();
  const normalizedWeekStart = normalizeWeekStartForQuery(rawWeekStart);

  let usage: WeeklyUsageRow | null = null;

  try {
    usage = await getWeeklyUsage(user.id, rawWeekStart);
  } catch (err) {
    console.error("getWeeklyUsage failed:", err);
  }

  // fallback №1: если helper вернул null, пробуем прямой запрос с нормализованной датой
  if (!usage) {
    try {
      usage = await getWeeklyUsageDirect(user.id, normalizedWeekStart);
    } catch (err) {
      console.error("getWeeklyUsageDirect failed:", err);
    }
  }

  // fallback №2: если helper ожидал строку YYYY-MM-DD, пробуем helper ещё раз уже с такой строкой
  if (!usage) {
    try {
      usage = await getWeeklyUsage(user.id, normalizedWeekStart as any);
    } catch (err) {
      console.error("getWeeklyUsage helper retry failed:", err);
    }
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
    userId: user.id,
    rawWeekStart,
    normalizedWeekStart,
    entitlement,
    usage,
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
    isLoggedIn: true,
    isActive,
    isTrial,
    isUnlimited,
    weekly,
  };
}