import { useCallback, useEffect, useRef, useState } from "react";
import { loadEntitlementState, type EntitlementState } from "../lib/entitlements";
import { supabase } from "../lib/supabase";

/** Refresh only on account/navigation/focus/data changes; no attendance polling. */
export function useAccountEntitlement(userId: string | undefined, refreshKey = "") {
  const [result, setResult] = useState<{ userId: string; state: EntitlementState | null; loading: boolean; error: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const handledRevisionRef = useRef(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let pending = false;
    let refreshAgain = false;
    let refreshAgainForce = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;

    const load = async (forceRefresh = false) => {
      if (pending) {
        refreshAgain = true;
        refreshAgainForce ||= forceRefresh;
        return;
      }
      pending = true;
      try {
        const state = await loadEntitlementState({ forceRefresh });
        if (active) setResult({ userId, state, loading: false, error: false });
      } catch (error) {
        console.warn("[account] Could not refresh subscription allowance:", error);
        // Hide stale limit claims rather than show a previous account/plan.
        if (active) setResult({ userId, state: null, loading: false, error: true });
      } finally {
        pending = false;
        if (active && refreshAgain) {
          const shouldForce = refreshAgainForce;
          refreshAgain = false;
          refreshAgainForce = false;
          void load(shouldForce);
        }
      }
    };
    let scheduledForce = false;
    const scheduleRefresh = (forceRefresh = false) => {
      // A window focus event must not cancel a pending plan/usage change.
      scheduledForce ||= forceRefresh;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const shouldForce = scheduledForce;
        scheduledForce = false;
        if (active) void load(shouldForce);
      }, 150);
    };
    const onFocus = () => scheduleRefresh(false);
    const onVisible = () => { if (document.visibilityState === "visible") scheduleRefresh(false); };

    setResult((current) => current?.userId === userId && current.state
      ? current
      : { userId, state: null, loading: true, error: false });
    // Navigation and refocusing may reuse the existing 2-minute snapshot.
    // Explicit refresh requests and Realtime entitlement changes bypass it.
    const explicitlyRequested = handledRevisionRef.current !== revision;
    handledRevisionRef.current = revision;
    void load(explicitlyRequested);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const channel = supabase.channel(`account-allowance:${userId}:${refreshKey}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` }, (event) => {
        if (event.new.attended_sessions_count !== event.old.attended_sessions_count) scheduleRefresh(true);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_entitlements", filter: `user_id=eq.${userId}` }, () => scheduleRefresh(true))
      .subscribe();

    return () => {
      active = false;
      clearTimeout(debounce);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [userId, refreshKey, revision]);

  const current = result?.userId === userId ? result : null;
  return { state: current?.state ?? null, loading: Boolean(userId) && (current?.loading ?? true), error: current?.error ?? false, refresh };
}
