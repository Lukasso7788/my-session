import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";

type BootstrapState = "checking" | "ready" | "waiting";

async function loadBootstrapState(accessToken: string) {
  const response = await fetch("/api/livekit/admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action: "session_bootstrap" }),
  });

  if (!response.ok) return "ready" as const;
  const payload = (await response.json().catch(() => ({}))) as { state?: string };
  return payload.state === "syncing" ? "waiting" as const : "ready" as const;
}

export default function AppBootstrapGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BootstrapState>("checking");
  const generationRef = useRef(0);

  const refresh = useCallback(async (showChecking = false) => {
    const generation = ++generationRef.current;
    if (showChecking) setState("checking");

    try {
      const { data } = await supabase.auth.getSession();
      if (generation !== generationRef.current) return;

      const accessToken = String(data.session?.access_token || "").trim();
      if (!accessToken) {
        setState("ready");
        return;
      }

      const nextState = await loadBootstrapState(accessToken);
      if (generation === generationRef.current) setState(nextState);
    } catch {
      if (generation === generationRef.current) setState("ready");
    }
  }, []);

  useEffect(() => {
    void refresh(true);

    let authTimer: number | null = null;
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      if (authTimer) window.clearTimeout(authTimer);
      authTimer = window.setTimeout(() => void refresh(true), 0);
    });

    const refreshQuietly = () => void refresh(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshQuietly();
    };
    const interval = window.setInterval(refreshQuietly, 30_000);

    window.addEventListener("focus", refreshQuietly);
    window.addEventListener("mysession-ban-refresh", refreshQuietly);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (authTimer) window.clearTimeout(authTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshQuietly);
      window.removeEventListener("mysession-ban-refresh", refreshQuietly);
      document.removeEventListener("visibilitychange", onVisible);
      authListener.subscription.unsubscribe();
    };
  }, [refresh]);

  if (state !== "ready") {
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