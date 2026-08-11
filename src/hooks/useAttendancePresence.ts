// src/hooks/useAttendancePresence.ts
import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

export function useAttendancePresence(
    sessionId: string | null,
    opts?: { heartbeatMs?: number }
) {
    // Presence RPCs are only used as a TTL lease. A 30-second heartbeat stays
    // comfortably inside the 90-120 second live-presence window while cutting
    // write traffic by two thirds.
    const heartbeatMs = opts?.heartbeatMs ?? 30_000;
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!sessionId) return;

        let cancelled = false;

        const heartbeat = async () => {
            try {
                const { data } = await supabase.auth.getUser();
                const u = data.user;
                if (!u?.id) return;

                await supabase.rpc("attendance_heartbeat", { p_session_id: sessionId });
            } catch (e) {
                // intentionally silent
            }
        };

        const leave = async () => {
            try {
                const { data } = await supabase.auth.getUser();
                const u = data.user;
                if (!u?.id) return;

                await supabase.rpc("attendance_leave", { p_session_id: sessionId });
            } catch (e) {
                // intentionally silent
            }
        };

        // immediate heartbeat
        heartbeat();

        // interval heartbeat
        timerRef.current = window.setInterval(() => {
            if (!cancelled) heartbeat();
        }, heartbeatMs);

        // best-effort leave on tab close
        const onBeforeUnload = () => {
            // async can be cut off, but TTL will fix it anyway
            leave();
        };

        // when user returns to tab -> refresh heartbeat
        const onVisibility = () => {
            if (document.visibilityState === "visible") heartbeat();
        };

        window.addEventListener("beforeunload", onBeforeUnload);
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            cancelled = true;
            if (timerRef.current) window.clearInterval(timerRef.current);
            timerRef.current = null;

            window.removeEventListener("beforeunload", onBeforeUnload);
            document.removeEventListener("visibilitychange", onVisibility);

            // remove presence on unmount
            leave();
        };
    }, [sessionId, heartbeatMs]);
}
