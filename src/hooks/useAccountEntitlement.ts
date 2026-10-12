import { useCallback, useEffect, useState } from "react";
import { loadEntitlementState, type EntitlementState } from "../lib/entitlements";
import { supabase } from "../lib/supabase";

/** Refresh only on account/navigation/focus/data changes; no attendance polling. */
export function useAccountEntitlement(userId: string | undefined, refreshKey = "") {
  const [result, setResult] = useState<{ userId: string; state: EntitlementState | null; loading: boolean; error: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let pending = false;
    let refreshAgain = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      if (pending) { refreshAgain = true; return; }
      pending = true;
      try {
        const state = await loadEntitlementState({ forceRefresh: true });
        if (active) setResult({ userId, state, loading: false, error: false });
      } catch (error) {
        console.warn("[account] Could not refresh subscription allowance:", error);
        // Hide stale limit claims rather than show a previous account/plan.
        if (active) setResult({ userId, state: null, loading: false, error: true });
      } finally {
        pending = false;
        if (active && refreshAgain) { refreshAgain = false; void load(); }
      }
    };
    const scheduleRefresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { if (active) void load(); }, 150);
    };
    const onVisible = () => { if (document.visibilityState === "visible") scheduleRefresh(); };

    setResult((current) => current?.userId === userId && current.state
      ? current
      : { userId, state: null, loading: true, error: false });
    void load();
    window.addEventListener("focus", scheduleRefresh);
    document.addEventListener("visibilitychange", onVisible);
    const channel = supabase.channel(`account-allowance:${userId}:${refreshKey}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` }, (event) => {
        if (event.new.attended_sessions_count !== event.old.attended_sessions_count) scheduleRefresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_entitlements", filter: `user_id=eq.${userId}` }, scheduleRefresh)
      .subscribe();

    return () => {
      active = false;
      clearTimeout(debounce);
      window.removeEventListener("focus", scheduleRefresh);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [userId, refreshKey, revision]);

  const current = result?.userId === userId ? result : null;
  return { state: current?.state ?? null, loading: Boolean(userId) && (current?.loading ?? true), error: current?.error ?? false, refresh };
}
