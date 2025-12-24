import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseClient"; // поправь импорт под свой проект

type Options = {
    heartbeatMs?: number;   // как часто пингуем
    leaveOnHidden?: boolean;
};

export function useAttendancePresence(sessionId: string | null | undefined, opts: Options = {}) {
    const heartbeatMs = opts.heartbeatMs ?? 10_000;
    const leaveOnHidden = opts.leaveOnHidden ?? false;

    const timerRef = useRef<number | null>(null);
    const startedRef = useRef(false);

    useEffect(() => {
        if (!sessionId) return;

        let cancelled = false;

        const heartbeat = async () => {
            try {
                await supabase.rpc("attendance_heartbeat", { p_session_id: sessionId });
            } catch (e) {
                // не спамим консоль каждую секунду — но логируем, если нужно
                // console.error("[presence] heartbeat error", e);
            }
        };

        const start = async () => {
            if (startedRef.current) return;
            startedRef.current = true;

            await heartbeat();

            // setInterval в браузере может дрейфовать — ок, нам не нужна идеальная секунда
            timerRef.current = window.setInterval(() => {
                heartbeat();
            }, heartbeatMs);
        };

        const stop = async (reason: string) => {
            if (!startedRef.current) return;
            startedRef.current = false;

            if (timerRef.current) {
                window.clearInterval(timerRef.current);
                timerRef.current = null;
            }

            try {
                await supabase.rpc("attendance_leave", { p_session_id: sessionId });
            } catch (e) {
                // console.error(`[presence] leave error (${reason})`, e);
            }
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                // по умолчанию НЕ делаем leave на hidden:
                // человек мог просто переключить вкладку на 20 секунд и вернуться.
                if (leaveOnHidden) stop("hidden");
            } else {
                // вернулся — пинганём сразу
                heartbeat();
            }
        };

        const onBeforeUnload = () => {
            // В beforeunload async может не успеть. Но даже если не успеет — TTL решит.
            // Мы всё равно пробуем.
            stop("beforeunload");
        };

        start();

        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("beforeunload", onBeforeUnload);

        return () => {
            cancelled = true;
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("beforeunload", onBeforeUnload);
            // cleanup leave
            stop("unmount");
        };
    }, [sessionId, heartbeatMs, leaveOnHidden]);
}
