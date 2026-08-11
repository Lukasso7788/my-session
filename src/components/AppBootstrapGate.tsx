import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

type BootstrapState = "checking" | "ready" | "waiting";

// The access-control endpoint performs both an auth lookup and a database
// lookup. Auth changes and explicit admin actions already trigger an immediate
// refresh, so a short global poll only creates duplicate Supabase egress.
const ACCESS_CONTROL_REFRESH_MS = 5 * 60_000;

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
  const { pathname } = useLocation();
  const [state, setState] = useState<BootstrapState>("checking");
  const generationRef = useRef(0);
  const stateRef = useRef<BootstrapState>("checking");
  const isRoomRoute = /^\/room-(?:livekit(?:-clean)?|iframe)\//.test(pathname);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(async (showChecking = false) => {
    // Replacing the gate unmounts LiveKit. Once a room is active, background
    // account checks must never turn a harmless tab switch into a full rejoin.
    if (isRoomRoute && stateRef.current === "ready") return;

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
  }, [isRoomRoute]);

  useEffect(() => {
    void refresh(true);

    let authTimer: number | null = null;
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN") return;
      if (isRoomRoute && stateRef.current === "ready") return;
      if (authTimer) window.clearTimeout(authTimer);
      authTimer = window.setTimeout(() => void refresh(false), 0);
    });

    const refreshQuietly = () => {
      if (document.visibilityState !== "visible") return;
      void refresh(false);
    };
    const interval = window.setInterval(
      refreshQuietly,
      ACCESS_CONTROL_REFRESH_MS,
    );

    window.addEventListener("mysession-ban-refresh", refreshQuietly);

    return () => {
      if (authTimer) window.clearTimeout(authTimer);
      window.clearInterval(interval);
      window.removeEventListener("mysession-ban-refresh", refreshQuietly);
      authListener.subscription.unsubscribe();
    };
  }, [isRoomRoute, refresh]);

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