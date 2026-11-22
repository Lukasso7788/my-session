import { FOCUS_SHIELD_CACHE_KEY } from "./focusShieldTypes";
import { deactivatePolicy } from "./policy";
import type { FocusShieldPolicy } from "./focusShieldTypes";

export function clearFocusShieldPolicy(policy: FocusShieldPolicy | null, now = Date.now()) {
  return deactivatePolicy(policy, "session", now);
}

export function clearCachedFocusShieldPolicy() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(FOCUS_SHIELD_CACHE_KEY);
  } catch {
    // ignore
  }
}
