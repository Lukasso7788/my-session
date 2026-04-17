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
 * 🔹 Основная функция: собрать ВСЁ состояние пользователя
 */
export async function loadEntitlementState(): Promise<EntitlementState> {
  // 1. получаем пользователя
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

  // 2. получаем entitlement
  const entitlement = await getUserEntitlement(user.id);

  // 3. получаем usage
  const weekStart = getWeekStartDate();

  let usage: WeeklyUsageRow | null = null;

  try {
    usage = await getWeeklyUsage(user.id, weekStart);
  } catch (err) {
    console.error("getWeeklyUsage failed:", err);
  }

  const sessionsUsed = usage?.sessions_count ?? 0;
  const minutesUsed = usage?.minutes_total ?? 0;

  // 4. вычисляем состояние
  const isTrial = isTrialActive(entitlement);
  const isActive = isEntitlementActive(entitlement);
  const isUnlimited = hasUnlimitedAccess(entitlement);

  const weekly = getWeeklyLimitState({
    entitlement,
    sessionsUsed,
    minutesUsed,
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