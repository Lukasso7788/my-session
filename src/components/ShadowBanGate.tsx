import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentUserActiveShadowBan } from "../lib/bans";
import { supabase } from "../lib/supabase";

type GateState = "checking" | "allowed" | "blocked";

export default function ShadowBanGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const checkGenerationRef = useRef(0);

  const checkAccess = useCallback(async (showChecking = false) => {
    const generation = ++checkGenerationRef.current;
    if (showChecking) setState("checking");

    try {
      const { data } = await supabase.auth.getSession();
      if (generation !== checkGenerationRef.current) return;
      if (!data.session?.user?.id) {
        setState("allowed");
        return;
      }

      const shadowBan = await getCurrentUserActiveShadowBan();
      if (generation !== checkGenerationRef.current) return;
      setState(shadowBan ? "blocked" : "allowed");
    } catch (error) {
      console.warn("[shadow-ban] access check failed open:", error);
      if (generation === checkGenerationRef.current) setState("allowed");
    }
  }, []);

  useEffect(() => {
    void checkAccess(true);

    let authTimer: number | null = null;
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      if (authTimer) window.clearTimeout(authTimer);
      authTimer = window.setTimeout(() => void checkAccess(true), 0);
    });

    const refresh = () => void checkAccess(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkAccess(false);
    };
    const interval = window.setInterval(refresh, 30_000);

    window.addEventListener("focus", refresh);
    window.addEventListener("mysession-ban-refresh", refresh);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (authTimer) window.clearTimeout(authTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("mysession-ban-refresh", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      authListener.subscription.unsubscribe();
    };
  }, [checkAccess]);

  if (state !== "allowed") {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-white"
        aria-label="Loading MySession"
        aria-busy="true"
      >
        <div className="flex flex-col items-center gap-5">
          <div className="text-[28px] font-extrabold tracking-[-0.04em] text-[#2F2F2F]">
            MySession
          </div>
          <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-black/10 border-t-[#2F2F2F]" />
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
