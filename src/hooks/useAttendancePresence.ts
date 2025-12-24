import { useEffect } from "react";
import { supabase } from "../lib/supabase";

type Options = {
    heartbeatMs?: number;
};

export function useAttendancePresence(sessionId: string | null, options: Options = {}) {
    const heartbeatMs = options.heartbeatMs ?? 10_000;

    useEffect(() => {
        if (!sessionId) return;

        let cancelled = false;
        let interval: any = null;

        const join = async () => {
            try {
                // если у тебя есть attendance_join — отлично
                await supabase.rpc("attendance_join", { p_session_id: sessionId });
            } catch (e) {
                // если RPC нет — просто молча игнорируем (важно: не ломаем UI)
                // console.warn("attendance_join missing or failed:", e);
            }
        };

        const heartbeat = async () => {
            try {
                await supabase.rpc("attendance_heartbeat", { p_session_id: sessionId });
            } catch (e) {
                // console.warn("attendance_heartbeat missing or failed:", e);
            }
        };

        (async () => {
            await join();
            await heartbeat();

            if (cancelled) return;

            interval = setInterval(() => {
                heartbeat();
            }, heartbeatMs);
        })();

        return () => {
            cancelled = true;
            if (interval) clearInterval(interval);
        };
    }, [sessionId, heartbeatMs]);
}
