import { useEffect } from "react";
import { supabase } from "../lib/supabase";

type PresenceLease = {
    consumers: Set<symbol>;
    cadenceMs: number;
    timer: number | null;
    leaveTimer: number | null;
    inFlight: Promise<void> | null;
    leaving: Promise<void> | null;
    lastSuccessAt: number;
    beat: () => Promise<void>;
    leave: () => Promise<void>;
    onVisible: () => void;
    onUnload: () => void;
};

// One heartbeat timer per session in this browser tab, even if two components
// mount the hook. The last consumer owns the leave; StrictMode remounts cancel
// its short grace period instead of briefly marking attendance offline.
const presenceLeases = new Map<string, PresenceLease>();

function startTimer(lease: PresenceLease) {
    if (lease.timer !== null) window.clearInterval(lease.timer);
    lease.timer = window.setInterval(() => { void lease.beat(); }, lease.cadenceMs);
}

function acquirePresence(sessionId: string, cadenceMs: number, consumer: symbol) {
    let lease = presenceLeases.get(sessionId);
    if (!lease) {
        lease = {
            consumers: new Set(), cadenceMs, timer: null, leaveTimer: null,
            inFlight: null, leaving: null, lastSuccessAt: 0,
            beat: async () => {}, leave: async () => {}, onVisible: () => {}, onUnload: () => {},
        };
        const current = lease;
        current.beat = () => {
            if (current.consumers.size === 0) return Promise.resolve();
            if (current.inFlight) return current.inFlight;
            if (Date.now() - current.lastSuccessAt < 20_000) return Promise.resolve();
            const request = (async () => {
                const { error } = await supabase.rpc("attendance_heartbeat", { p_session_id: sessionId });
                if (!error) current.lastSuccessAt = Date.now();
            })().catch(() => {}).finally(() => {
                if (current.inFlight === request) current.inFlight = null;
            });
            current.inFlight = request;
            return request;
        };
        current.leave = () => {
            if (current.leaving) return current.leaving;
            const request = (async () => {
                await current.inFlight?.catch(() => {});
                await supabase.rpc("attendance_leave", { p_session_id: sessionId });
                current.lastSuccessAt = 0;
            })().catch(() => {}).finally(() => {
                current.leaving = null;
                if (current.consumers.size > 0) void current.beat();
                const replacement = presenceLeases.get(sessionId);
                if (replacement && replacement !== current && replacement.consumers.size > 0) {
                    replacement.lastSuccessAt = 0;
                    void replacement.beat();
                }
            });
            current.leaving = request;
            return request;
        };
        current.onVisible = () => {
            if (document.visibilityState === "visible") void current.beat();
        };
        current.onUnload = () => { void current.leave(); };
        presenceLeases.set(sessionId, current);
        document.addEventListener("visibilitychange", current.onVisible);
        window.addEventListener("online", current.onVisible);
        window.addEventListener("beforeunload", current.onUnload);
    }

    lease.consumers.add(consumer);
    if (lease.leaveTimer !== null) {
        window.clearTimeout(lease.leaveTimer);
        lease.leaveTimer = null;
    }
    if (cadenceMs < lease.cadenceMs) lease.cadenceMs = cadenceMs;
    startTimer(lease);
    void lease.beat();

    return () => {
        lease.consumers.delete(consumer);
        if (lease.consumers.size > 0) return;
        if (lease.timer !== null) window.clearInterval(lease.timer);
        lease.timer = null;
        lease.leaveTimer = window.setTimeout(() => {
            lease.leaveTimer = null;
            if (lease.consumers.size > 0) return;
            presenceLeases.delete(sessionId);
            document.removeEventListener("visibilitychange", lease.onVisible);
            window.removeEventListener("online", lease.onVisible);
            window.removeEventListener("beforeunload", lease.onUnload);
            void lease.leave();
        }, 1000);
    };
}

export function useAttendancePresence(
    sessionId: string | null,
    opts?: { heartbeatMs?: number },
) {
    const heartbeatMs = Math.max(25_000, Number(opts?.heartbeatMs) || 30_000);
    useEffect(() => {
        if (!sessionId) return;
        return acquirePresence(sessionId, heartbeatMs, Symbol(sessionId));
    }, [sessionId, heartbeatMs]);
}
