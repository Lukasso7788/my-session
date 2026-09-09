// src/hooks/useAttendancePresence.ts
import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

const MIN_HEARTBEAT_GAP_MS = 20_000;
const heartbeatLastSentAt = new Map<string, number>();
const heartbeatInFlight = new Map<string, Promise<void>>();

async function sendAttendanceHeartbeat(sessionId: string, userId: string) {
    const key = `${userId}:${sessionId}`;
    const now = Date.now();
    const lastSentAt = heartbeatLastSentAt.get(key) || 0;

    if (now - lastSentAt < MIN_HEARTBEAT_GAP_MS) return;

    const pending = heartbeatInFlight.get(key);
    if (pending) return pending;

    // Mark before the RPC starts so duplicate effects/visibility events that
    // fire together cannot enqueue another database write.
    heartbeatLastSentAt.set(key, now);

    const heartbeatPromise = (async () => {
        try {
            const { error } = await supabase.rpc("attendance_heartbeat", {
                p_session_id: sessionId,
            });

            if (error && heartbeatLastSentAt.get(key) === now) {
                heartbeatLastSentAt.delete(key);
            }
        } catch {
            if (heartbeatLastSentAt.get(key) === now) {
                heartbeatLastSentAt.delete(key);
            }
        }
    })();

    heartbeatInFlight.set(key, heartbeatPromise);

    try {
        await heartbeatPromise;
    } finally {
        if (heartbeatInFlight.get(key) === heartbeatPromise) {
            heartbeatInFlight.delete(key);
        }
    }
}

export function useAttendancePresence(
    sessionId: string | null,
    opts?: { heartbeatMs?: number }
) {
    const heartbeatMs = opts?.heartbeatMs ?? 30_000;
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!sessionId) return;

        let cancelled = false;
        let userId = "";

        const start = async () => {
            try {
                // getSession uses the local persisted auth session; unlike
                // getUser(), this avoids an /auth/v1/user request per heartbeat.
                const {
                    data: { session },
                } = await supabase.auth.getSession();

                userId = String(session?.user?.id || "").trim();
                if (!userId || cancelled) return;

                await sendAttendanceHeartbeat(sessionId, userId);

                if (cancelled) return;
                timerRef.current = window.setInterval(() => {
                    if (!cancelled && userId) {
                        void sendAttendanceHeartbeat(sessionId, userId);
                    }
                }, heartbeatMs);
            } catch {
                // intentionally silent
            }
        };

        const leave = async () => {
            if (!userId) return;
            try {
                await supabase.rpc("attendance_leave", { p_session_id: sessionId });
            } catch {
                // intentionally silent
            }
        };

        void start();

        const onBeforeUnload = () => {
            void leave();
        };

        // Returning to the tab may happen just after the interval heartbeat.
        // The shared 20s guard prevents that from becoming a duplicate write.
        const onVisibility = () => {
            if (document.visibilityState === "visible" && userId) {
                void sendAttendanceHeartbeat(sessionId, userId);
            }
        };

        window.addEventListener("beforeunload", onBeforeUnload);
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            cancelled = true;
            if (timerRef.current) window.clearInterval(timerRef.current);
            timerRef.current = null;

            window.removeEventListener("beforeunload", onBeforeUnload);
            document.removeEventListener("visibilitychange", onVisibility);

            void leave();
        };
    }, [sessionId, heartbeatMs]);
}
