// src/components/SessionCard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** =========================
 * ✅ Global Supabase singleton (avoid multiple GoTrueClient instances)
 * Uses Vite env vars:
 * - VITE_SUPABASE_URL
 * - VITE_SUPABASE_ANON_KEY
 * ========================= */
type GlobalAny = typeof globalThis & {
    __mysession_supabase__?: SupabaseClient | null;
    __mysession_supabase_inited__?: boolean;
};

function getSupabase(): SupabaseClient | null {
    const g = globalThis as GlobalAny;
    if (g.__mysession_supabase_inited__) return g.__mysession_supabase__ || null;

    g.__mysession_supabase_inited__ = true;

    const env: any = (import.meta as any).env || {};
    const url =
        env.VITE_SUPABASE_URL ||
        env.VITE_PUBLIC_SUPABASE_URL ||
        env.VITE_NEXT_PUBLIC_SUPABASE_URL ||
        "";
    const anon =
        env.VITE_SUPABASE_ANON_KEY ||
        env.VITE_SUPABASE_KEY ||
        env.VITE_PUBLIC_SUPABASE_ANON_KEY ||
        env.VITE_NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        "";

    if (!url || !anon) {
        console.warn("[SessionCard] Missing Supabase env vars.");
        g.__mysession_supabase__ = null;
        return null;
    }

    g.__mysession_supabase__ = createClient(url, anon, {
        auth: { persistSession: true, autoRefreshToken: true },
    });

    return g.__mysession_supabase__ || null;
}

/** =========================
 * Types
 * ========================= */
type LiveUser = {
    id: string;
    full_name?: string | null;
    avatar_url?: string | null;
    last_seen_at?: string | null;
    joined_at?: string | null;
};

type AttendanceRow = {
    user_id: string | null;
    joined_at?: string | null;
    left_at?: string | null;
    last_seen_at?: string | null;
    profiles?: { id?: string | null; full_name?: string | null; avatar_url?: string | null } | null;
};

/** =========================
 * Helpers
 * ========================= */
function parseTimeMs(input: any): number | null {
    if (input == null) return null;

    if (input instanceof Date) {
        const t = input.getTime();
        return Number.isFinite(t) ? t : null;
    }

    if (typeof input === "number") {
        if (!Number.isFinite(input)) return null;
        const ms = input < 1e12 ? input * 1000 : input;
        return Number.isFinite(ms) ? ms : null;
    }

    if (typeof input === "string") {
        const s = input.trim();
        if (!s) return null;

        // numeric string
        if (/^\d+$/.test(s)) {
            const n = Number(s);
            if (!Number.isFinite(n)) return null;
            const ms = n < 1e12 ? n * 1000 : n;
            return Number.isFinite(ms) ? ms : null;
        }

        const t = Date.parse(s);
        return Number.isFinite(t) ? t : null;
    }

    return null;
}

function getInitials(nameOrId: string) {
    const s = String(nameOrId || "").trim();
    if (!s) return "?";
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function uniqById<T extends { id: string }>(arr: T[]) {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const x of arr) {
        if (!x?.id) continue;
        if (seen.has(x.id)) continue;
        seen.add(x.id);
        out.push(x);
    }
    return out;
}

const LIVE_ACTIVE_WINDOW_MS = 2 * 60 * 1000; // last_seen_at within 2 minutes = "in session now"
const LIVE_FALLBACK_JOIN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // if last_seen_at missing -> accept joined_at within 24h

function normalizeLiveUsers(rows: AttendanceRow[], cutoffMs: number): LiveUser[] {
    const joinCutoffMs = Date.now() - LIVE_FALLBACK_JOIN_MAX_AGE_MS;

    const filtered = (rows || []).filter((r) => {
        if (!r) return false;
        if (!r.user_id) return false;
        if (r.left_at) return false;

        const ls = parseTimeMs(r.last_seen_at);
        if (ls != null) return ls >= cutoffMs;

        const j = parseTimeMs(r.joined_at);
        if (j != null) return j >= joinCutoffMs;

        // если нет ни last_seen_at ни joined_at — считаем неактивным
        return false;
    });

    const mapped: LiveUser[] = filtered.map((r) => {
        const p = r.profiles || null;
        const id = String(r.user_id);
        return {
            id,
            full_name: p?.full_name ?? null,
            avatar_url: p?.avatar_url ?? null,
            last_seen_at: r.last_seen_at ?? null,
            joined_at: r.joined_at ?? null,
        };
    });

    // сорт: свежие сверху
    mapped.sort((a, b) => {
        const at = parseTimeMs(a.last_seen_at) ?? parseTimeMs(a.joined_at) ?? 0;
        const bt = parseTimeMs(b.last_seen_at) ?? parseTimeMs(b.joined_at) ?? 0;
        return bt - at;
    });

    return uniqById(mapped);
}

function buildLoginNext(urlPath: string): string {
    const next = urlPath || "/sessions";
    return `/login?next=${encodeURIComponent(next)}`;
}

function getRoomParam(session: any): string {
    const id = session?.id != null ? String(session.id).trim() : "";
    if (id) return id;
    const slug = session?.custom_slug != null ? String(session.custom_slug).trim() : "";
    return slug;
}

/** =========================
 * Hook: live users from session_attendance
 * realtime + polling fallback
 * ========================= */
function useSessionLiveUsers(sessionId?: string | null, opts?: { pollMs?: number; activeWindowMs?: number }) {
    const sb = useMemo(() => getSupabase(), []);
    const [liveUsers, setLiveUsers] = useState<LiveUser[]>([]);
    const pollMs = opts?.pollMs ?? 12000;
    const activeWindowMs = opts?.activeWindowMs ?? LIVE_ACTIVE_WINDOW_MS;

    const lastFetchAt = useRef(0);

    useEffect(() => {
        if (!sb || !sessionId) {
            setLiveUsers([]);
            return;
        }

        let cancelled = false;
        let pollTimer: number | null = null;
        let channel: any = null;

        const fetchNow = async () => {
            const now = Date.now();
            // tiny throttle (realtime может спамить)
            if (now - lastFetchAt.current < 250) return;
            lastFetchAt.current = now;

            const cutoffMs = Date.now() - activeWindowMs;

            const { data, error } = await sb
                .from("session_attendance")
                .select("user_id, joined_at, left_at, last_seen_at, profiles:profiles(id, full_name, avatar_url)")
                .eq("session_id", sessionId)
                .is("left_at", null)
                .order("joined_at", { ascending: false });

            if (cancelled) return;

            if (error) {
                console.error("[SessionCard] session_attendance fetch error:", error);
                setLiveUsers([]);
                return;
            }

            const rows = Array.isArray(data) ? (data as AttendanceRow[]) : [];
            const users = normalizeLiveUsers(rows, cutoffMs);
            setLiveUsers(users);
        };

        // initial
        fetchNow();

        // realtime (если включён)
        try {
            channel = sb
                .channel(`att:${sessionId}`)
                .on(
                    "postgres_changes",
                    { event: "*", schema: "public", table: "session_attendance", filter: `session_id=eq.${sessionId}` },
                    () => fetchNow()
                )
                .subscribe();
        } catch (e) {
            console.warn("[SessionCard] realtime subscribe failed (ok, will poll):", e);
            channel = null;
        }

        // polling fallback
        pollTimer = window.setInterval(fetchNow, pollMs);

        return () => {
            cancelled = true;
            if (pollTimer) window.clearInterval(pollTimer);
            if (channel) {
                try {
                    sb.removeChannel(channel);
                } catch {
                    // ignore
                }
            }
        };
    }, [sb, sessionId, pollMs, activeWindowMs]);

    return liveUsers;
}

/** =========================
 * UI bits
 * ========================= */
function AvatarCircle({ user, size = 28 }: { user: LiveUser; size?: number }) {
    const label = user?.full_name || user?.id || "Participant";
    const initials = getInitials(label);

    return (
        <div
            className="rounded-full overflow-hidden flex items-center justify-center border border-[#E5E7EB] bg-white"
            style={{ width: size, height: size }}
            title={label}
        >
            {user?.avatar_url ? (
                <img src={user.avatar_url} alt={label} className="w-full h-full object-cover" draggable={false} />
            ) : (
                <div className="text-[10px] font-semibold text-[#111827] select-none">{initials}</div>
            )}
        </div>
    );
}

/** =========================
 * Props (оставил совместимыми по форме)
 * ========================= */
interface SessionCardProps {
    session: any;
    userId?: string;

    onBook: (sessionId: string) => void;
    onCancelBooking: (sessionId: string) => void;
    onJoin: (sessionId: string) => void;

    // можно передавать, но мы их тут не используем (упрощение)
    onDelete?: (sessionId: string) => void;
    onEditSession?: any;
    onInviteToSession?: any;

    currentUser?: {
        id: string;
        full_name?: string;
        avatar_url?: string;
        email?: string;
    };
}

export default function SessionCard({
    session,
    userId,
    onBook,
    onCancelBooking,
    onJoin,
}: SessionCardProps) {
    const navigate = useNavigate();

    const sessionId = session?.id ? String(session.id) : null;
    const roomParam = getRoomParam(session);

    const liveUsers = useSessionLiveUsers(sessionId, { pollMs: 12000, activeWindowMs: LIVE_ACTIVE_WINDOW_MS });

    const liveCountFromAttendance = liveUsers.length;
    const liveCountFromSession = typeof session?.live_count === "number" ? session.live_count : 0;
    const liveCount = Math.max(liveCountFromAttendance, liveCountFromSession);

    const [peopleOpen, setPeopleOpen] = useState(false);

    const initialIsBooked = useMemo(() => {
        const nested = Array.isArray(session?.session_bookings)
            ? session.session_bookings.some((b: any) => String(b?.user_id || b?.userId) === String(userId || ""))
            : false;
        return nested || session?.is_booked === true;
    }, [session?.id, session?.session_bookings, session?.is_booked, userId]);

    const [isBooked, setIsBooked] = useState<boolean>(!!initialIsBooked);

    useEffect(() => setIsBooked(!!initialIsBooked), [initialIsBooked, session?.id]);

    const startDateString = session?.start_time
        ? new Date(session.start_time).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
        : "";

    const durationLabel =
        session?.session_format_type === "infinite" || session?.is_infinite === true
            ? "Infinite"
            : session?.duration_minutes
                ? `${session.duration_minutes} min`
                : "";

    const handleJoin = () => {
        if (!roomParam) return;
        const nextPath = `/room-iframe/${roomParam}`;

        if (!userId) {
            navigate(buildLoginNext(nextPath));
            return;
        }

        try {
            onJoin(sessionId || roomParam);
        } catch {
            // ignore
        }

        navigate(nextPath);
    };

    const handleBook = () => {
        if (!userId) {
            navigate(buildLoginNext("/sessions"));
            return;
        }
        setIsBooked(true);
        onBook(String(session.id));
    };

    const handleCancelBooking = () => {
        if (!userId) return;
        setIsBooked(false);
        onCancelBooking(String(session.id));
    };

    const maxStack = 6;
    const stackUsers = liveUsers.slice(0, maxStack);
    const remaining = Math.max(0, liveCount - stackUsers.length);

    return (
        <div className="border border-borderGray rounded-[28px] bg-white p-5 flex flex-col gap-4 hover:bg-[#F6F6F6] transition">
            {/* header */}
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-[18px] md:text-[20px] font-bold leading-tight truncate">{session?.title || "Session"}</div>

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-[#606060]">
                        {session?.host_id && (
                            <Link to={`/profile/${session.host_id}`} className="hover:opacity-70 truncate">
                                Host: <span className="underline underline-offset-2">{session?.host_name || "Host"}</span>
                            </Link>
                        )}

                        {durationLabel && <span>{durationLabel}</span>}
                        {startDateString && <span>· {startDateString}</span>}
                        {session?.max_participants ? <span>· limit {session.max_participants}</span> : null}
                    </div>
                </div>

                {/* live count big */}
                <div className="shrink-0 text-right">
                    <div className="text-[26px] font-bold text-[#111827] leading-none">{liveCount}</div>
                    <div className="text-[10px] text-[#606060] -mt-1">in session now</div>
                </div>
            </div>

            {/* people row */}
            <button
                type="button"
                onClick={() => setPeopleOpen((v) => !v)}
                className="flex items-center justify-between gap-3 text-left"
                title="Show people in session"
            >
                <div className="flex items-center gap-2 min-w-0">
                    <div className="flex items-center">
                        {stackUsers.map((u, idx) => (
                            <div key={u.id} className="relative" style={{ marginLeft: idx === 0 ? 0 : -10, zIndex: 50 - idx }}>
                                <AvatarCircle user={u} size={28} />
                            </div>
                        ))}
                        {remaining > 0 && (
                            <div className="relative" style={{ marginLeft: -10, zIndex: 0 }}>
                                <div
                                    className="rounded-full border border-[#E5E7EB] bg-white flex items-center justify-center text-[10px] font-semibold text-[#111827]"
                                    style={{ width: 28, height: 28 }}
                                    title={`${remaining} more`}
                                >
                                    +{remaining}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="text-[12px] text-[#606060]">
                        {liveCount > 0 ? (
                            <>
                                Live: <span className="font-semibold text-[#111827]">{liveCount}</span>
                            </>
                        ) : (
                            "No one live right now"
                        )}
                    </div>
                </div>

                <div className="text-[12px] text-[#606060]">{peopleOpen ? "Hide" : "Show"}</div>
            </button>

            {/* expanded people */}
            {peopleOpen && (
                <div className="border border-[#E5E7EB] bg-white rounded-[18px] p-3 flex flex-col gap-2">
                    {liveUsers.length === 0 ? (
                        <div className="text-[13px] text-[#606060]">No live users.</div>
                    ) : (
                        liveUsers.map((u) => (
                            <Link
                                key={u.id}
                                to={`/profile/${u.id}`}
                                className="flex items-center gap-3 px-2 py-2 rounded-[14px] hover:bg-[#F3F4F6] transition"
                            >
                                <AvatarCircle user={u} size={34} />
                                <div className="min-w-0">
                                    <div className="text-[13px] font-semibold text-[#111827] truncate">
                                        {u.full_name || u.id}
                                    </div>
                                    <div className="text-[11px] text-[#606060] truncate">
                                        {u.last_seen_at ? `last seen: ${new Date(u.last_seen_at).toLocaleString()}` : ""}
                                    </div>
                                </div>
                            </Link>
                        ))
                    )}
                </div>
            )}

            {/* actions */}
            <div className="flex flex-col sm:flex-row gap-3">
                {isBooked ? (
                    <button
                        onClick={handleCancelBooking}
                        className="h-11 rounded-full px-5 text-[14px] font-semibold border border-[#F65252] text-[#F65252] bg-[#F65252]/5 hover:bg-[#F65252]/10 transition"
                    >
                        Cancel booking
                    </button>
                ) : (
                    <button
                        onClick={handleBook}
                        className="h-11 rounded-full px-5 text-[14px] font-semibold border border-[#111827] text-[#111827] bg-white hover:bg-[#F3F4F6] transition"
                    >
                        Book session
                    </button>
                )}

                <button
                    onClick={handleJoin}
                    className="h-11 rounded-full px-5 text-[14px] font-semibold border border-[#111827] bg-[#111827] text-white hover:opacity-90 transition"
                >
                    Join session
                </button>
            </div>
        </div>
    );
}
