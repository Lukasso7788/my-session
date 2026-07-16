import {
    useEffect,
    useMemo,
    useRef,
    useState,
    useCallback,
    useLayoutEffect,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Layers, ArrowUp, ArrowDown, Trash2, RotateCcw, Eraser, Search, Crown, UserCheck, Lock } from "lucide-react";
import { SessionStageBar } from "./SessionStageBar";
import {
    loadEntitlementState,
    isPersonalPaywallForced,
    type EntitlementState,
} from "../lib/entitlements";
import { getPaywallDecision } from "../lib/paywall";
import PaywallModal from "./PaywallModal";
import type { SessionStage } from "../SessionConfig";
import { PAYWALL_ENABLED } from "../lib/flags";

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
        console.warn(
            "[SessionCard] Missing Supabase env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)."
        );
        g.__mysession_supabase__ = null;
        return null;
    }

    g.__mysession_supabase__ = createClient(url, anon, {
        auth: { persistSession: true, autoRefreshToken: true },
    });

    return g.__mysession_supabase__ || null;
}

type BookSessionOptions = {
    booked_start_time?: string | null;
    booked_end_time?: string | null;
    booking_note?: string | null;
};

interface SessionCardProps {
    session: any;
    userId?: string;

    onBook: (sessionId: string, opts?: BookSessionOptions) => void;
    onCancelBooking: (sessionId: string) => void;
    onJoin: (sessionId: string) => void;
    onDelete: (sessionId: string) => void;

    onEditSession?: (
        sessionId: string,
        updates: {
            title?: string;
            start_time?: string;
            max_participants?: number | null;
            description?: string | null;
            schedule?: any;
            duration_minutes?: number | null;
            host_id?: string | null;
            host_name?: string | null;
        }
    ) => void | Promise<any>;

    onInviteToSession?: (
        sessionId: string,
        payload: { email: string; message?: string }
    ) => void | Promise<any>;

    currentUser?: {
        id: string;
        full_name?: string;
        avatar_url?: string;
        email?: string;
    };
}

type BookedUser = { id: string; full_name?: string; avatar_url?: string; created_at?: string | null; booked_start_time?: string | null; booked_end_time?: string | null };
type HostTransferCandidate = {
    id: string;
    full_name?: string | null;
    avatar_url?: string | null;
    email?: string | null;
};


function safeLower(x: any) {
    return String(x || "").toLowerCase();
}

function getInitials(nameOrId: string) {
    const s = String(nameOrId || "").trim();
    if (!s) return "?";
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function extractBookers(session: any): BookedUser[] {
    const raw = session?.session_bookings || [];
    if (!Array.isArray(raw)) return [];

    const users = raw
        .map((b: any): BookedUser | null => {
            const uid = b?.user_id || b?.userId;
            const p = b?.profiles || b?.profile || b?.user || null;

            const full_name = p?.full_name ?? p?.name ?? b?.full_name ?? b?.name;
            const avatar_url = p?.avatar_url ?? b?.avatar_url;

            if (!uid) return null;

            return {
                id: String(uid),
                full_name,
                avatar_url,
                created_at: b?.created_at ?? b?.booked_at ?? null,
                booked_start_time: b?.booked_start_time ?? b?.start_time ?? null,
                booked_end_time: b?.booked_end_time ?? b?.end_time ?? null,
            };
        })
        .filter((u): u is BookedUser => !!u);

    const seen = new Set<string>();
    const out: BookedUser[] = [];

    for (const u of users) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        out.push(u);
    }

    return out;
}


function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function toLocalDateInputValue(date: Date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toLocalTimeInputValue(date: Date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function roundDateToNextQuarterHour(date = new Date()) {
    const d = new Date(date);
    d.setSeconds(0, 0);
    const minutes = d.getMinutes();
    const next = Math.ceil(minutes / 15) * 15;
    if (next >= 60) {
        d.setHours(d.getHours() + 1, 0, 0, 0);
    } else {
        d.setMinutes(next, 0, 0);
    }
    return d;
}

function combineLocalDateAndTimeToIso(dateYMD: string, timeHHMM: string) {
    const date = String(dateYMD || "").trim();
    const time = String(timeHHMM || "").trim();
    if (!date || !time) return null;

    const d = new Date(`${date}T${time}:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
}

function formatBookingRangeFromIso(startIso?: string | null, endIso?: string | null) {
    const startRaw = String(startIso || "").trim();
    const endRaw = String(endIso || "").trim();

    if (!startRaw && !endRaw) return "Any time — this room is always open";

    const start = startRaw ? new Date(startRaw) : null;
    const end = endRaw ? new Date(endRaw) : null;

    const hasStart = !!start && !Number.isNaN(start.getTime());
    const hasEnd = !!end && !Number.isNaN(end.getTime());

    if (!hasStart && !hasEnd) return "Any time — this room is always open";

    const dateFmt: Intl.DateTimeFormatOptions = {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    };

    if (hasStart && hasEnd) {
        const sameDay =
            start!.getFullYear() === end!.getFullYear() &&
            start!.getMonth() === end!.getMonth() &&
            start!.getDate() === end!.getDate();

        const startText = start!.toLocaleString("en-US", dateFmt);
        const endText = sameDay
            ? end!.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
            : end!.toLocaleString("en-US", dateFmt);

        return `${startText} — ${endText}`;
    }

    if (hasStart) return `From ${start!.toLocaleString("en-US", dateFmt)}`;
    return `Until ${end!.toLocaleString("en-US", dateFmt)}`;
}

async function persistInfiniteBookingTimeRangeFallback(args: {
    sessionId: string;
    userId: string;
    bookedStartTime: string;
    bookedEndTime: string;
    bookingNote?: string | null;
}) {
    const sb = getSupabase();
    if (!sb) return;

    try {
        await ensureAuthReady(sb);

        const payload = {
            session_id: args.sessionId,
            user_id: args.userId,
            booked_start_time: args.bookedStartTime,
            booked_end_time: args.bookedEndTime,
            booking_note: args.bookingNote ?? null,
        };

        const { data: existing, error: findError } = await sb
            .from("session_bookings")
            .select("id")
            .eq("session_id", args.sessionId)
            .eq("user_id", args.userId)
            .order("created_at", { ascending: false })
            .limit(1);

        if (findError) throw findError;

        const existingId = Array.isArray(existing) ? existing[0]?.id : null;

        if (existingId) {
            const { error: updateError } = await sb
                .from("session_bookings")
                .update({
                    booked_start_time: args.bookedStartTime,
                    booked_end_time: args.bookedEndTime,
                    booking_note: args.bookingNote ?? null,
                })
                .eq("id", existingId);

            if (updateError) throw updateError;
            return;
        }

        const { error: insertError } = await sb.from("session_bookings").insert(payload);
        if (insertError) throw insertError;
    } catch (e) {
        console.warn("[SessionCard] infinite booking time range persist fallback failed:", e);
    }
}

function inferTypeFromTitle(
    title: any
): "Deep work" | "Pomodoro" | "Short sprints" | null {
    const t = safeLower(title);
    if (t.includes("silent") || t.includes("drop-in") || t.includes("drop in"))
        return "Deep work";
    if (t.includes("deep work") || t.includes("deepwork") || t.includes("uninterrupted"))
        return "Deep work";
    if (t.includes("pomodoro")) return "Pomodoro";
    if (/\b25\s*[/\-]\s*5\b/.test(t)) return "Pomodoro";
    if (/\b15\s*[/\-]\s*3\b/.test(t)) return "Short sprints";
    if (/\b55\s*[/\-]\s*5\b/.test(t)) return "Deep work";
    if (/\b50\s*[/\-]\s*5(\s*[/\-]\s*5)?\b/.test(t)) return "Deep work";
    return null;
}

function resolveSessionType(session: any): "group" | "infinite" | "body" {
    const t = safeLower(session?.session_format_type);
    if (t === "infinite") return "infinite";
    if (t === "body") return "body";
    if (t === "group") return "group";

    const sch = (() => {
        const raw = session?.schedule;
        if (!raw) return null;
        if (typeof raw === "string") {
            try {
                return JSON.parse(raw);
            } catch {
                return null;
            }
        }
        return raw;
    })();

    if (sch && typeof sch === "object" && !Array.isArray(sch)) {
        if ((sch as any).kind === "infinite_room") return "infinite";
        if ((sch as any)?.timer?.phases) return "infinite";
        if ((sch as any)?.phases) return "infinite";
    }

    if (safeLower(session?.format) === "body") return "body";
    return "group";
}

function AvatarCircle({
    user,
    size = 28,
    isLive = false,
    showLiveDot = false,
}: {
    user: BookedUser;
    size?: number;
    isLive?: boolean;
    showLiveDot?: boolean;
}) {
    const label = user?.full_name || user?.id || "Participant";
    const initials = getInitials(label);

    return (
        <div className="relative" style={{ width: size, height: size }} title={label}>
            <div
                className="rounded-full overflow-hidden flex items-center justify-center border border-[#E5E7EB] bg-white"
                style={{ width: size, height: size }}
            >
                {user?.avatar_url ? (
                    <img
                        src={user.avatar_url}
                        alt={label}
                        className="w-full h-full object-cover"
                        draggable={false}
                    />
                ) : (
                    <div className="text-[10px] font-semibold text-[#111827] select-none">
                        {initials}
                    </div>
                )}
            </div>

            {showLiveDot && isLive && (
                <span
                    className="absolute -bottom-[1px] -right-[1px] h-[10px] w-[10px] rounded-full bg-[#65D46C] border-2 border-white"
                    aria-label="Online"
                    title="Online"
                />
            )}
        </div>
    );
}

function ModalShell({
    title,
    isOpen,
    onClose,
    children,
    widthClass = "max-w-[560px]",
}: {
    title: string;
    isOpen: boolean;
    onClose: () => void;
    children: any;
    widthClass?: string;
}) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999]">
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <div className="absolute inset-0 flex items-center justify-center p-4">
                <div
                    className={`w-full ${widthClass} rounded-[24px] bg-white border border-[#E5E7EB] shadow-xl max-h-[92vh] overflow-hidden flex flex-col`}
                >
                    <div className="px-5 py-4 flex items-center justify-between border-b border-[#F0F0F0] shrink-0">
                        <div className="text-[16px] font-bold text-[#111827]">{title}</div>
                        <button
                            onClick={onClose}
                            className="h-9 w-9 rounded-full hover:bg-[#F3F4F6] flex items-center justify-center"
                            aria-label="Close"
                            type="button"
                        >
                            <span className="text-[18px] leading-none">×</span>
                        </button>
                    </div>
                    <div className="p-5 overflow-y-auto">{children}</div>
                </div>
            </div>
        </div>
    );
}

function IconEdit({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3L16.5 4.5a2.1 2.1 0 0 0-3 0L3 15v5Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
            />
            <path d="M13.5 6.5l4 4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
    );
}

function IconCancel({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" stroke="currentColor" strokeWidth="2" />
            <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

function IconTrash({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M10 11v7M14 11v7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M6 7l1 14h10l1-14" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M9 7V4h6v3" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
    );
}

function IconInfo({ size = 16 }: { size?: number }) {
    const [useFallback, setUseFallback] = useState(false);

    if (!useFallback) {
        return (
            <img
                src="/icons/session-info.svg"
                alt=""
                draggable={false}
                onError={() => setUseFallback(true)}
                style={{ width: size, height: size }}
            />
        );
    }

    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
            <path d="M12 10v7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 7.25h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
    );
}

function IconCopy({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
            <path
                d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
        </svg>
    );
}

function IconCheckSuccess({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M20 7L10 17l-6-6"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function DotsFallbackIcon({ size = 18 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="5" cy="12" r="2" fill="currentColor" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <circle cx="19" cy="12" r="2" fill="currentColor" />
        </svg>
    );
}

function OptionsSmartIcon({ hovered, size = 18 }: { hovered: boolean; size?: number }) {
    const [useFallback, setUseFallback] = useState(false);

    if (useFallback) return <DotsFallbackIcon size={size} />;

    return (
        <img
            src="/icons/options.svg"
            alt=""
            draggable={false}
            onError={() => setUseFallback(true)}
            style={{
                width: size,
                height: size,
                filter: hovered ? "brightness(0) invert(1)" : "none",
            }}
        />
    );
}

function MenuItem({
    icon,
    label,
    danger,
    success,
    outlined,
    onClick,
}: {
    icon: any;
    label: string;
    danger?: boolean;
    success?: boolean;
    outlined?: boolean;
    onClick: () => void;
}) {
    const baseTone = danger
        ? "text-[#F65252] hover:bg-[#FFF1F2]"
        : success
            ? "text-[#22C55E] hover:bg-[#F0FDF4]"
            : "text-[#111827]";

    const outlinedTone = outlined
        ? success
            ? "border border-[#BBF7D0] bg-[#F0FDF4] hover:border-[#22C55E] hover:bg-[#DCFCE7]"
            : "border border-[#E5E7EB] hover:border-[#111827] hover:bg-[#F6F6F6]"
        : "";

    return (
        <button
            className={[
                "w-full text-left px-3 py-2 rounded-[12px] text-[13px] font-semibold flex items-center gap-2 transition",
                outlined ? outlinedTone : "hover:bg-[#F3F4F6]",
                baseTone,
            ].join(" ")}
            onClick={onClick}
            type="button"
        >
            <span
                className={
                    danger
                        ? "text-[#F65252]"
                        : success
                            ? "text-[#22C55E]"
                            : "text-[#111827]"
                }
            >
                {icon}
            </span>
            <span>{label}</span>
        </button>
    );
}

function isCustomStudioSession(session: any): boolean {
    if (session?.is_custom === true) return true;

    const f = safeLower(session?.format);
    if (f.includes("(studio)") || f.includes("session studio")) return true;

    const via = safeLower(session?.created_via);
    if (via === "studio") return true;

    return false;
}

function tryParseJson<T = any>(x: any): T | null {
    if (x == null) return null;
    if (typeof x === "object") return x as T;

    if (typeof x === "string") {
        let current: any = x.trim();
        if (!current) return null;

        // A few legacy rows contain JSON stored as a JSON string. Parse at
        // most twice so both normal and double-encoded schedules work.
        for (let attempt = 0; attempt < 2; attempt += 1) {
            if (typeof current !== "string") return current as T;

            const value = current.trim();
            if (!value) return null;

            try {
                current = JSON.parse(value);
            } catch {
                return null;
            }
        }

        return current as T;
    }

    return null;
}

function normalizeStages(raw: any): SessionStage[] {
    const arr = Array.isArray(raw) ? raw : [];
    return arr
        .map((s: any, idx: number) => {
            if (!s) return null;

            const kind = s.kind ?? s.type ?? s.stage_kind ?? s.stageKind ?? s.blockKind;
            const title = s.title ?? s.name ?? s.label ?? s.displayName;
            const color =
                s.color ??
                s.colour ??
                s.bgColor ??
                s.backgroundColor ??
                s.background ??
                s.stage_color ??
                s.stageColor;

            const durationSeconds =
                Number(s.durationSeconds) ||
                Number(s.duration_seconds) ||
                Number(s.seconds) ||
                (Number(s.duration_minutes) ? Number(s.duration_minutes) * 60 : 0) ||
                (Number(s.durationMinutes) ? Number(s.durationMinutes) * 60 : 0) ||
                (Number(s.duration) ? Number(s.duration) * 60 : 0) ||
                (Number(s.minutes) ? Number(s.minutes) * 60 : 0);

            return {
                ...(s || {}),
                id: s.id ?? `${idx}`,
                kind,
                title,
                name: title ?? s.name,
                color,
                durationSeconds:
                    durationSeconds || s.durationSeconds || s.seconds || s.duration_seconds,
                duration_seconds: s.duration_seconds ?? s.durationSeconds ?? s.seconds,
                seconds: s.seconds ?? s.durationSeconds ?? s.duration_seconds,
                duration_minutes: s.duration_minutes ?? s.durationMinutes,
            } as any;
        })
        .filter(Boolean);
}

function sortStagesInClient(stages: any[]): any[] {
    const toNum = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : null);
    return [...(stages || [])].sort((a, b) => {
        const ap =
            toNum(a?.position) ??
            toNum(a?.order_index) ??
            toNum(a?.order) ??
            toNum(a?.idx) ??
            toNum(a?.index) ??
            0;
        const bp =
            toNum(b?.position) ??
            toNum(b?.order_index) ??
            toNum(b?.order) ??
            toNum(b?.idx) ??
            toNum(b?.index) ??
            0;
        return ap - bp;
    });
}

function phasesToStages(phases: any[]): SessionStage[] {
    const mapped = (phases || []).map((p: any, i: number) => {
        const title = p?.title || p?.label || p?.name || "";
        const durationSeconds =
            Number(p?.seconds) ||
            Number(p?.duration_seconds) ||
            Number(p?.durationSeconds) ||
            (Number(p?.duration_minutes) ? Number(p?.duration_minutes) * 60 : 0) ||
            (Number(p?.minutes) ? Number(p?.minutes) * 60 : 0) ||
            (Number(p?.duration) ? Number(p?.duration) * 60 : 0);

        const kind = p?.kind || p?.type || p?.mode || undefined;

        return {
            id: String(p?.id ?? i),
            kind,
            title: title || undefined,
            name: title || undefined,
            color:
                p?.color ??
                p?.colour ??
                p?.bgColor ??
                p?.backgroundColor ??
                p?.background ??
                p?.stage_color ??
                p?.stageColor,
            durationSeconds,
            seconds: p?.seconds,
            duration_seconds: p?.duration_seconds,
            duration_minutes: p?.duration_minutes ?? p?.minutes,
            position: p?.position ?? p?.order_index ?? p?.order ?? i,
        } as any;
    });

    return normalizeStages(sortStagesInClient(mapped));
}

function tryStagesFromSchedule(scheduleAny: any): SessionStage[] {
    const schedule = tryParseJson<any>(scheduleAny);
    if (!schedule) return [];

    if (Array.isArray(schedule) && schedule.length) {
        return phasesToStages(schedule);
    }

    if (typeof schedule !== "object") return [];

    const phases =
        (schedule as any)?.timer?.phases ||
        (schedule as any)?.timer?.timeline ||
        (schedule as any)?.timer?.stages ||
        (schedule as any)?.timer?.segments ||
        (schedule as any)?.timer?.blocks ||
        (schedule as any)?.phases ||
        (schedule as any)?.timeline ||
        (schedule as any)?.stages ||
        (schedule as any)?.segments ||
        (schedule as any)?.blocks ||
        (schedule as any)?.script?.phases ||
        (schedule as any)?.script?.stages ||
        (schedule as any)?.script?.blocks ||
        (schedule as any)?.schedule?.phases ||
        (schedule as any)?.schedule?.stages ||
        (schedule as any)?.schedule?.blocks;

    if (Array.isArray(phases) && phases.length) return phasesToStages(phases);

    const focusSec = Number((schedule as any)?.timer?.focusSeconds || (schedule as any)?.timer?.focus_seconds);
    const breakSec = Number((schedule as any)?.timer?.breakSeconds || (schedule as any)?.timer?.break_seconds);
    const cycles = Number((schedule as any)?.timer?.cycles || (schedule as any)?.timer?.rounds);

    if (
        Number.isFinite(focusSec) &&
        focusSec > 0 &&
        Number.isFinite(breakSec) &&
        breakSec > 0 &&
        Number.isFinite(cycles) &&
        cycles > 0
    ) {
        const ph: any[] = [];
        for (let i = 0; i < cycles; i++) {
            ph.push({ title: `Focus`, seconds: focusSec, position: ph.length });
            ph.push({ title: `Break`, seconds: breakSec, position: ph.length });
        }
        return phasesToStages(ph);
    }

    return [];
}

async function ensureAuthReady(sb: SupabaseClient) {
    try {
        await sb.auth.getSession();
    } catch {
        // ignore
    }
}

const _stagesBySessionId = new Map<string, SessionStage[]>();
const _stagesByTemplateId = new Map<string, SessionStage[]>();
const _sessionExtrasById = new Map<string, any | null>();
const _sessionDescriptionById = new Map<string, string>();

function looksLikeUuid(x: any): boolean {
    const s = String(x || "").trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        s
    );
}

async function fetchSessionExtrasForStages(sessionId: string): Promise<any | null> {
    const sid = String(sessionId || "").trim();
    if (!sid) return null;
    if (!looksLikeUuid(sid)) return null;

    if (_sessionExtrasById.has(sid)) {
        return _sessionExtrasById.get(sid) || null;
    }

    const sb = getSupabase();
    if (!sb) return null;

    await ensureAuthReady(sb);

    /**
     * IMPORTANT:
     * Sessions created by CreateSessionModal store the selected template in
     * `template_id`. Some older deployments do not have `session_template_id`.
     *
     * Selecting a missing Postgres column makes the whole request fail, which
     * previously caused the info popover to fall back to one solid
     * `duration_minutes` stage.
     */
    const primary = await sb
        .from("sessions")
        .select("id, schedule, template_id")
        .eq("id", sid)
        .maybeSingle();

    if (!primary.error && primary.data) {
        _sessionExtrasById.set(sid, primary.data);
        return primary.data;
    }

    /**
     * Very old schemas may not expose template_id either. The schedule itself
     * is enough to render a SessionStageBar, so retry with the smallest safe
     * selection instead of collapsing the timeline.
     */
    const fallback = await sb
        .from("sessions")
        .select("id, schedule")
        .eq("id", sid)
        .maybeSingle();

    if (!fallback.error && fallback.data) {
        _sessionExtrasById.set(sid, fallback.data);
        return fallback.data;
    }

    console.warn("[SessionCard] Unable to load session schedule:", {
        sessionId: sid,
        primaryError: primary.error,
        fallbackError: fallback.error,
    });

    // Do not cache failures. A transient auth/network error should be retryable
    // the next time the user opens the info popover.
    return null;
}

async function fetchSessionDescriptionById(sessionId: string): Promise<string> {
    const sid = String(sessionId || "").trim();
    if (!sid) return "";
    if (!looksLikeUuid(sid)) return "";

    if (_sessionDescriptionById.has(sid)) {
        return _sessionDescriptionById.get(sid) || "";
    }

    const sb = getSupabase();
    if (!sb) {
        _sessionDescriptionById.set(sid, "");
        return "";
    }

    await ensureAuthReady(sb);

    const { data, error } = await sb
        .from("sessions")
        .select("description")
        .eq("id", sid)
        .maybeSingle();

    if (error || !data) {
        _sessionDescriptionById.set(sid, "");
        return "";
    }

    const text =
        typeof data?.description === "string" ? data.description.trim() : "";

    _sessionDescriptionById.set(sid, text);
    return text;
}

function isNotFoundErr(err: any): boolean {
    const status = (err as any)?.status;
    const msg = String((err as any)?.message || "");
    return status === 404 || msg.toLowerCase().includes("not found");
}

function getTemplateIdFromSession(session: any): string | null {
    const direct = session?.session_template_id || session?.template_id;
    if (direct) return String(direct);

    const embedded =
        session?.session_template ||
        session?.session_templates ||
        session?.template ||
        session?.templates;

    if (embedded?.id) return String(embedded.id);

    return null;
}

function getEmbeddedTemplate(session: any): any | null {
    return (
        session?.session_template ||
        session?.session_templates ||
        session?.template ||
        session?.templates ||
        null
    );
}

async function fetchStagesForSession(session: any): Promise<SessionStage[]> {
    const sessionId = session?.id ? String(session.id) : "";
    if (sessionId && _stagesBySessionId.has(sessionId)) return _stagesBySessionId.get(sessionId)!;

    if (Array.isArray(session?.session_stages) && session.session_stages.length) {
        const out = normalizeStages(sortStagesInClient(session.session_stages));
        if (sessionId) _stagesBySessionId.set(sessionId, out);
        return out;
    }
    if (Array.isArray(session?.stages) && session.stages.length) {
        const out = normalizeStages(sortStagesInClient(session.stages));
        if (sessionId) _stagesBySessionId.set(sessionId, out);
        return out;
    }

    const scheduleStages = tryStagesFromSchedule(session?.schedule);
    if (scheduleStages.length) {
        if (sessionId) _stagesBySessionId.set(sessionId, scheduleStages);
        return scheduleStages;
    }

    const embeddedTemplate = getEmbeddedTemplate(session);
    if (embeddedTemplate) {
        const embBlocks =
            tryParseJson<any[]>(embeddedTemplate?.blocks) ||
            tryParseJson<any[]>(embeddedTemplate?.stages);

        if (Array.isArray(embBlocks) && embBlocks.length) {
            const out = normalizeStages(sortStagesInClient(embBlocks));
            if (sessionId) _stagesBySessionId.set(sessionId, out);
            return out;
        }

        const embScheduleStages = tryStagesFromSchedule(embeddedTemplate?.schedule);
        if (embScheduleStages.length) {
            if (sessionId) _stagesBySessionId.set(sessionId, embScheduleStages);
            return embScheduleStages;
        }
    }

    const sb = getSupabase();
    if (!sb) {
        const durMin = Number(session?.duration_minutes);
        if (Number.isFinite(durMin) && durMin > 0) {
            const out = normalizeStages(
                sortStagesInClient([
                    { id: "0", kind: "focus", title: "Focus", durationMinutes: durMin, position: 0 },
                ])
            );
            if (sessionId) _stagesBySessionId.set(sessionId, out);
            return out;
        }
        return [];
    }
    await ensureAuthReady(sb);

    const templateId = getTemplateIdFromSession(session);
    if (templateId && _stagesByTemplateId.has(templateId)) {
        const out = _stagesByTemplateId.get(templateId)!;
        if (sessionId) _stagesBySessionId.set(sessionId, out);
        return out;
    }

    if (templateId) {
        const { data: tData, error: tErr } = await sb
            .from("session_templates")
            .select("id, blocks, stages, schedule")
            .eq("id", templateId)
            .maybeSingle();

        if (!tErr && tData) {
            const sj =
                tryParseJson<any[]>(tData?.blocks) || tryParseJson<any[]>(tData?.stages);
            if (Array.isArray(sj) && sj.length) {
                const out = normalizeStages(sortStagesInClient(sj));
                _stagesByTemplateId.set(templateId, out);
                if (sessionId) _stagesBySessionId.set(sessionId, out);
                return out;
            }

            const schedStages = tryStagesFromSchedule(tData?.schedule);
            if (schedStages.length) {
                _stagesByTemplateId.set(templateId, schedStages);
                if (sessionId) _stagesBySessionId.set(sessionId, schedStages);
                return schedStages;
            }
        }
    }

    if (sessionId) {
        const extra = await fetchSessionExtrasForStages(sessionId);
        if (extra) {
            const schedStages = tryStagesFromSchedule(extra?.schedule);
            if (schedStages.length) {
                _stagesBySessionId.set(sessionId, schedStages);
                return schedStages;
            }

            const tid =
                extra?.session_template_id ||
                extra?.template_id ||
                session?.session_template_id ||
                session?.template_id ||
                null;

            const tidStr = tid ? String(tid) : "";
            if (tidStr) {
                if (_stagesByTemplateId.has(tidStr)) {
                    const out = _stagesByTemplateId.get(tidStr)!;
                    _stagesBySessionId.set(sessionId, out);
                    return out;
                }

                const { data: tData, error: tErr } = await sb
                    .from("session_templates")
                    .select("id, blocks, stages, schedule")
                    .eq("id", tidStr)
                    .maybeSingle();

                if (!tErr && tData) {
                    const tj =
                        tryParseJson<any[]>(tData?.blocks) ||
                        tryParseJson<any[]>(tData?.stages);
                    if (Array.isArray(tj) && tj.length) {
                        const out = normalizeStages(sortStagesInClient(tj));
                        _stagesByTemplateId.set(tidStr, out);
                        _stagesBySessionId.set(sessionId, out);
                        return out;
                    }

                    const ts = tryStagesFromSchedule(tData?.schedule);
                    if (ts.length) {
                        _stagesByTemplateId.set(tidStr, ts);
                        _stagesBySessionId.set(sessionId, ts);
                        return ts;
                    }
                }
            }
        }
    }

    const durMin = Number(session?.duration_minutes);
    if (Number.isFinite(durMin) && durMin > 0) {
        const out = normalizeStages(
            sortStagesInClient([
                { id: "0", kind: "focus", title: "Focus", durationMinutes: durMin, position: 0 },
            ])
        );
        if (sessionId) _stagesBySessionId.set(sessionId, out);
        return out;
    }

    return [];
}

function normalizeUsers(raw: any[]): BookedUser[] {
    const users = (raw || [])
        .map((row: any): BookedUser | null => {
            const p = row?.profiles || row?.profile || row?.user || null;
            const uid = row?.user_id || row?.userId || p?.id || row?.id;

            if (!uid) return null;

            return {
                id: String(uid),
                full_name: p?.full_name ?? p?.name ?? row?.full_name ?? row?.name,
                avatar_url: p?.avatar_url ?? row?.avatar_url,
            };
        })
        .filter((u): u is BookedUser => !!u);

    const seen = new Set<string>();
    const out: BookedUser[] = [];

    for (const u of users) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        out.push(u);
    }

    return out;
}

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

function parseDbCount(v: any): number | null {
    if (v == null) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;

    if (typeof v === "string") {
        const s = v.trim();
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    }

    return null;
}

const LIVE_ACTIVE_WINDOW_MS = 2 * 60 * 1000;
const LIVE_FALLBACK_JOIN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isColumnMissingErr(err: any, col: string): boolean {
    const status = (err as any)?.status;
    const msg = String((err as any)?.message || "").toLowerCase();
    return (
        status === 400 &&
        (msg.includes("does not exist") || msg.includes("unknown") || msg.includes("column")) &&
        msg.includes(col.toLowerCase())
    );
}

function filterActiveRows(rows: any[], cutoffMs: number): any[] {
    const joinCutoffMs = Date.now() - LIVE_FALLBACK_JOIN_MAX_AGE_MS;

    return (rows || []).filter((r: any) => {
        if (!r) return false;
        if (r?.left_at) return false;

        const ls = parseTimeMs(r?.last_seen_at);
        if (ls != null) return ls >= cutoffMs;

        const j = parseTimeMs(r?.joined_at ?? r?.created_at);
        if (j != null) return j >= joinCutoffMs;

        return true;
    });
}

async function fetchLiveUsers(sessionId: string): Promise<BookedUser[]> {
    const sb = getSupabase();
    if (!sb) return [];
    await ensureAuthReady(sb);

    const { data: rpcData, error: rpcErr } = await sb.rpc("get_live_users", {
        p_session_id: sessionId,
    });

    if (!rpcErr && Array.isArray(rpcData)) {
        return (rpcData || []).map((r: any) => ({
            id: String(r.user_id),
            full_name: r.full_name ?? undefined,
            avatar_url: r.avatar_url ?? undefined,
        }));
    }

    const cutoffMs = Date.now() - LIVE_ACTIVE_WINDOW_MS;

    {
        const selectSimple =
            "user_id, profiles:profiles(id, full_name, avatar_url), last_seen_at, created_at";

        const resWithLastSeen = await sb
            .from("session_attendance")
            .select(selectSimple)
            .eq("session_id", sessionId)
            .order("last_seen_at", { ascending: false })
            .limit(12);

        if (!resWithLastSeen.error && Array.isArray(resWithLastSeen.data)) {
            const rows = filterActiveRows(resWithLastSeen.data, cutoffMs);
            return normalizeUsers(rows);
        }

        if (resWithLastSeen.error && isColumnMissingErr(resWithLastSeen.error, "last_seen_at")) {
            const resCreatedOnly = await sb
                .from("session_attendance")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), created_at")
                .eq("session_id", sessionId)
                .order("created_at", { ascending: false })
                .limit(12);

            if (!resCreatedOnly.error && Array.isArray(resCreatedOnly.data)) {
                const rows = filterActiveRows(resCreatedOnly.data, cutoffMs);
                return normalizeUsers(rows);
            }
        }

        const selectLegacy =
            "user_id, profiles:profiles(id, full_name, avatar_url), left_at, joined_at, last_seen_at, created_at";

        const legacyFull = await sb
            .from("session_attendance")
            .select(selectLegacy)
            .eq("session_id", sessionId)
            .is("left_at", null)
            .order("joined_at", { ascending: false })
            .limit(12);

        if (!legacyFull.error && Array.isArray(legacyFull.data)) {
            const rows = filterActiveRows(legacyFull.data, cutoffMs);
            return normalizeUsers(rows);
        }

        if (legacyFull.error && isColumnMissingErr(legacyFull.error, "left_at")) {
            const legacyNoLeftAt = await sb
                .from("session_attendance")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), joined_at, last_seen_at, created_at")
                .eq("session_id", sessionId)
                .order("joined_at", { ascending: false })
                .limit(12);

            if (!legacyNoLeftAt.error && Array.isArray(legacyNoLeftAt.data)) {
                const rows = filterActiveRows(legacyNoLeftAt.data, cutoffMs);
                return normalizeUsers(rows);
            }
        }

        if (legacyFull.error && isColumnMissingErr(legacyFull.error, "joined_at")) {
            const legacyNoJoinedAt = await sb
                .from("session_attendance")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), last_seen_at, created_at")
                .eq("session_id", sessionId)
                .order("created_at", { ascending: false })
                .limit(12);

            if (!legacyNoJoinedAt.error && Array.isArray(legacyNoJoinedAt.data)) {
                const rows = filterActiveRows(legacyNoJoinedAt.data, cutoffMs);
                return normalizeUsers(rows);
            }
        }

        if (legacyFull.error && isColumnMissingErr(legacyFull.error, "last_seen_at")) {
            const legacyCreatedOnly = await sb
                .from("session_attendance")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), created_at")
                .eq("session_id", sessionId)
                .order("created_at", { ascending: false })
                .limit(12);

            if (!legacyCreatedOnly.error && Array.isArray(legacyCreatedOnly.data)) {
                const rows = filterActiveRows(legacyCreatedOnly.data, cutoffMs);
                return normalizeUsers(rows);
            }
        }
    }

    {
        const selectLegacy =
            "user_id, profiles:profiles(id, full_name, avatar_url), left_at, joined_at, last_seen_at, created_at";

        const participantsFull = await sb
            .from("session_participants")
            .select(selectLegacy)
            .eq("session_id", sessionId)
            .is("left_at", null)
            .order("joined_at", { ascending: false })
            .limit(12);

        if (!participantsFull.error && Array.isArray(participantsFull.data)) {
            const rows = filterActiveRows(participantsFull.data, cutoffMs);
            return normalizeUsers(rows);
        }

        if (participantsFull.error && isColumnMissingErr(participantsFull.error, "left_at")) {
            const participantsNoLeftAt = await sb
                .from("session_participants")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), joined_at, last_seen_at, created_at")
                .eq("session_id", sessionId)
                .order("joined_at", { ascending: false })
                .limit(12);

            if (!participantsNoLeftAt.error && Array.isArray(participantsNoLeftAt.data)) {
                const rows = filterActiveRows(participantsNoLeftAt.data, cutoffMs);
                return normalizeUsers(rows);
            }
        }

        if (participantsFull.error && isColumnMissingErr(participantsFull.error, "joined_at")) {
            const participantsNoJoinedAt = await sb
                .from("session_participants")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), last_seen_at, created_at")
                .eq("session_id", sessionId)
                .order("created_at", { ascending: false })
                .limit(12);

            if (!participantsNoJoinedAt.error && Array.isArray(participantsNoJoinedAt.data)) {
                const rows = filterActiveRows(participantsNoJoinedAt.data, cutoffMs);
                return normalizeUsers(rows);
            }
        }

        if (participantsFull.error && isColumnMissingErr(participantsFull.error, "last_seen_at")) {
            const participantsCreatedOnly = await sb
                .from("session_participants")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), created_at")
                .eq("session_id", sessionId)
                .order("created_at", { ascending: false })
                .limit(12);

            if (!participantsCreatedOnly.error && Array.isArray(participantsCreatedOnly.data)) {
                const rows = filterActiveRows(participantsCreatedOnly.data, cutoffMs);
                return normalizeUsers(rows);
            }
        }
    }

    return [];
}

type StageKind =
    | "welcome"
    | "intentions"
    | "focus"
    | "break"
    | "checkin"
    | "recap"
    | "celebrate"
    | "custom";

const KIND_META: Record<StageKind, { label: string; color: string }> = {
    welcome: { label: "Welcome", color: "#34D399" },
    intentions: { label: "Intentions", color: "#38BDF8" },
    focus: { label: "Focus", color: "#3B82F6" },
    break: { label: "Break", color: "#FDA4AF" },
    checkin: { label: "Check-in", color: "#38BDF8" },
    recap: { label: "Recap", color: "#A78BFA" },
    celebrate: { label: "Celebrate", color: "#F472B6" },
    custom: { label: "Custom", color: "#F63135" },
};

function normKey(raw: any) {
    return String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
}

function normalizeKind(raw: any): StageKind {
    const k = normKey(raw);

    if (k.includes("farewell") || k.includes("goodbye") || k === "celebrate-and-farewell") {
        return "celebrate";
    }

    if (k === "check-in" || k === "checkin" || k === "check_in") return "checkin";
    if (k === "intention" || k === "intentions") return "intentions";
    if (k === "welcome") return "welcome";
    if (k === "focus") return "focus";
    if (k === "break") return "break";
    if (k === "recap") return "recap";
    if (k === "celebrate" || k === "celebration") return "celebrate";
    if (k === "custom") return "custom";

    return "custom";
}

function inferKindFromText(text: any): StageKind | null {
    const t = String(text || "").trim();
    if (!t) return null;
    const k = normKey(t);

    if (k.includes("farewell") || k.includes("goodbye") || k.includes("closing"))
        return "celebrate";
    if (k.includes("welcome") || k.includes("intro")) return "welcome";
    if (k.includes("intention")) return "intentions";
    if (k.includes("check-in") || k.includes("checkin")) return "checkin";
    if (k.includes("focus") || k.includes("work") || k.includes("deep")) return "focus";
    if (k.includes("break") || k.includes("rest")) return "break";
    if (k.includes("recap") || k.includes("reflection") || k.includes("review")) return "recap";
    if (k.includes("celebrate") || k.includes("celebration")) return "celebrate";
    if (k.includes("custom")) return "custom";

    return null;
}

function getStageKind(stage: any): StageKind {
    const rawKind =
        stage?.kind ??
        stage?.type ??
        stage?.stageKind ??
        stage?.stage_kind ??
        stage?.blockKind;

    const k0 = rawKind ? normalizeKind(rawKind) : null;

    const title = stage?.title ?? stage?.name ?? stage?.label ?? stage?.displayName ?? "";
    const k1 = inferKindFromText(title);

    return (k0 || k1 || "custom") as StageKind;
}

function getDisplayName(stage: any, kind: StageKind) {
    const name = String(
        stage?.title ??
        stage?.label ??
        stage?.displayName ??
        stage?.name ??
        ""
    ).trim();

    return name || KIND_META[kind].label;
}

function getRawStageColor(stage: any): string {
    return String(
        stage?.color ??
        stage?.colour ??
        stage?.bgColor ??
        stage?.backgroundColor ??
        stage?.background ??
        stage?.stageColor ??
        stage?.stage_color ??
        ""
    ).trim();
}

function isValidCssColor(raw: unknown): boolean {
    const s = String(raw || "").trim();
    if (!s) return false;

    if (/^#[0-9a-f]{3}$/i.test(s)) return true;
    if (/^#[0-9a-f]{6}$/i.test(s)) return true;
    if (/^#[0-9a-f]{8}$/i.test(s)) return true;
    if (/^rgb\(/i.test(s)) return true;
    if (/^rgba\(/i.test(s)) return true;
    if (/^hsl\(/i.test(s)) return true;
    if (/^hsla\(/i.test(s)) return true;
    if (/^var\(--[a-z0-9-_]+\)$/i.test(s)) return true;
    if (s.toLowerCase().includes("gradient(")) return true;

    return false;
}

function resolveStageColor(stage: any, kind: StageKind) {
    const raw = getRawStageColor(stage);
    if (!raw) return KIND_META[kind].color;
    if (!isValidCssColor(raw)) return KIND_META[kind].color;

    const s = raw.replace(/\s+/g, "").toLowerCase();

    const legacyBlue =
        s === "#4ca0ff" ||
        s === "rgb(76,160,255)" ||
        s === "rgba(76,160,255,1)" ||
        s === "rgba(76,160,255,1.0)";

    if (legacyBlue && kind !== "focus") {
        return KIND_META[kind].color;
    }

    return raw;
}

function resolveStageVisualLocal(stage: any) {
    const kind = getStageKind(stage);
    const name = getDisplayName(stage, kind);
    const color = resolveStageColor(stage, kind);
    return { kind, name, color };
}

function getStageSeconds(stage: any): number {
    const s =
        Number(stage?.durationSeconds) ||
        Number(stage?.duration_seconds) ||
        Number(stage?.seconds);

    if (Number.isFinite(s) && s > 0) return s;

    const mins = Number(stage?.duration ?? stage?.minutes);
    if (Number.isFinite(mins) && mins > 0) return mins * 60;

    return 0;
}

function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n));
}

function computeNowStage(
    stages: SessionStage[],
    startTime: string,
    cycleSeconds?: number
) {
    const startMs = parseTimeMs(startTime);
    const stageSecondsList = (stages || []).map((s) => Math.max(0, getStageSeconds(s)));
    const totalStagesSeconds = Math.max(1, stageSecondsList.reduce((a, v) => a + v, 0));
    const loopSeconds = (Number(cycleSeconds) || 0) > 0 ? Number(cycleSeconds) : totalStagesSeconds;

    const elapsedSec = startMs ? Math.floor((Date.now() - startMs) / 1000) : 0;
    const raw = Number.isFinite(elapsedSec) ? elapsedSec : 0;
    const normalized = loopSeconds > 0 ? ((raw % loopSeconds) + loopSeconds) % loopSeconds : raw;

    let total = 0;
    let stageIndex = 0;
    let stageProgress = 0;

    const firstNonZero = stageSecondsList.findIndex((x) => x > 0);
    if (firstNonZero >= 0) stageIndex = firstNonZero;

    for (let i = 0; i < stages.length; i++) {
        const durSec = stageSecondsList[i] || 0;
        const nextTotal = total + durSec;

        if (durSec <= 0) continue;

        if (normalized < nextTotal) {
            stageIndex = i;
            const stageElapsed = normalized - total;
            stageProgress = clamp(stageElapsed / durSec, 0, 1);
            break;
        }

        total = nextTotal;
        stageIndex = i;
    }

    const curStage = stages[stageIndex] || null;
    const curDur = stageSecondsList[stageIndex] || 0;
    const stageElapsed = curDur > 0 ? Math.round(stageProgress * curDur) : 0;
    const stageLeft = curDur > 0 ? Math.max(0, curDur - stageElapsed) : 0;

    return {
        stageIndex,
        stageProgress,
        curStage,
        stageLeft,
    };
}

function getRoomParam(session: any): string {
    const sessionSlug = getSessionPublicSlug(session);
    if (sessionSlug) return sessionSlug;

    const id = session?.id != null ? String(session.id).trim() : "";
    return id;
}

function buildLoginNext(urlPath: string): string {
    const next = urlPath || "/sessions";
    return `/login?next=${encodeURIComponent(next)}`;
}

function buildSessionInvitePath(session: any): string {
    const sessionSlug = getSessionPublicSlug(session);

    if (sessionSlug) {
        return `/${sessionSlug}`;
    }

    const roomParam = getRoomParam(session);
    return roomParam ? `/room-livekit/${roomParam}` : "/sessions";
}

function getSessionPublicSlug(session: any): string {
    const direct = String(
        session?.custom_slug ||
        session?.customSlug ||
        session?.public_slug ||
        session?.publicSlug ||
        session?.session_slug ||
        session?.sessionSlug ||
        session?.slug ||
        ""
    ).trim();

    if (direct) return direct;

    const embedded =
        session?.public_url_slugs ||
        session?.publicUrlSlugs ||
        session?.public_url_slug ||
        session?.publicUrlSlug ||
        session?.slug_row ||
        session?.slugRow ||
        null;

    if (Array.isArray(embedded)) {
        const first = embedded.find((row: any) => String(row?.slug || "").trim());
        return String(first?.slug || "").trim();
    }

    return String(embedded?.slug || "").trim();
}

function getEmbeddedHostSlug(session: any): string {
    return String(
        session?.host_slug ||
        session?.host_profile?.host_slug ||
        session?.host_profile?.public_slug ||
        session?.profiles?.host_slug ||
        ""
    ).trim();
}

function buildPrettySessionUrl(session: any, _hostSlug?: string | null): string {
    const origin =
        typeof window !== "undefined" && window.location?.origin
            ? window.location.origin
            : "https://mysession.club";

    const sessionSlug = getSessionPublicSlug(session);
    if (sessionSlug) return `${origin}/${sessionSlug}`;

    const id = session?.id != null ? String(session.id).trim() : "";
    return id ? `${origin}/room-livekit/${id}` : `${origin}/sessions`;
}

function buildPrettyHostUrl(hostSlug?: string | null): string {
    const origin =
        typeof window !== "undefined" && window.location?.origin
            ? window.location.origin
            : "https://mysession.club";

    const hs = String(hostSlug || "").trim();
    return hs ? `${origin}/${hs}` : "";
}

async function copyTextToClipboard(text: string): Promise<boolean> {
    try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { }

    try {
        if (typeof document === "undefined") return false;

        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        ta.style.pointerEvents = "none";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);

        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

function normalizeHostTransferCandidate(raw: any): HostTransferCandidate | null {
    const id = String(raw?.id || raw?.user_id || raw?.userId || "").trim();
    if (!id) return null;

    const profile = raw?.profiles || raw?.profile || raw?.user || null;

    return {
        id,
        full_name: raw?.full_name ?? raw?.name ?? profile?.full_name ?? profile?.name ?? null,
        avatar_url: raw?.avatar_url ?? profile?.avatar_url ?? null,
        email: raw?.email ?? profile?.email ?? null,
    };
}

function uniqueHostTransferCandidates(items: HostTransferCandidate[]): HostTransferCandidate[] {
    const seen = new Set<string>();
    const out: HostTransferCandidate[] = [];

    for (const item of items || []) {
        const id = String(item?.id || "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(item);
    }

    return out;
}

async function searchHostTransferCandidates(query: string): Promise<HostTransferCandidate[]> {
    const q = String(query || "").trim();
    if (!q) return [];

    const sb = getSupabase();
    if (!sb) return [];

    await ensureAuthReady(sb);

    const looksLikeId = looksLikeUuid(q);

    try {
        let queryBuilder = sb
            .from("profiles")
            .select("id, full_name, avatar_url, email")
            .limit(8);

        if (looksLikeId) {
            queryBuilder = queryBuilder.eq("id", q);
        } else {
            const safeQ = q.replace(/[%_,]/g, "");
            queryBuilder = queryBuilder.or(
                `full_name.ilike.%${safeQ}%,email.ilike.%${safeQ}%`
            );
        }

        const { data, error } = await queryBuilder;
        if (error) throw error;

        return uniqueHostTransferCandidates(
            (data || [])
                .map(normalizeHostTransferCandidate)
                .filter((x): x is HostTransferCandidate => !!x)
        );
    } catch (firstError: any) {
        // Some profiles schemas do not expose an email column to the client.
        try {
            let queryBuilder = sb
                .from("profiles")
                .select("id, full_name, avatar_url")
                .limit(8);

            if (looksLikeId) {
                queryBuilder = queryBuilder.eq("id", q);
            } else {
                const safeQ = q.replace(/[%_,]/g, "");
                queryBuilder = queryBuilder.ilike("full_name", `%${safeQ}%`);
            }

            const { data, error } = await queryBuilder;
            if (error) throw error;

            return uniqueHostTransferCandidates(
                (data || [])
                    .map(normalizeHostTransferCandidate)
                    .filter((x): x is HostTransferCandidate => !!x)
            );
        } catch (secondError) {
            console.warn("[SessionCard] host transfer search failed:", firstError, secondError);
            return [];
        }
    }
}

async function transferSessionHostRights(args: {
    sessionId: string;
    newHostId: string;
}): Promise<void> {
    const sessionId = String(args.sessionId || "").trim();
    const newHostId = String(args.newHostId || "").trim();

    if (!sessionId || !newHostId) {
        throw new Error("Missing session or new host id.");
    }

    const sb = getSupabase();
    if (!sb) throw new Error("Supabase is not configured.");

    await ensureAuthReady(sb);

    const { error } = await sb.rpc("transfer_session_host_rights", {
        p_session_id: sessionId,
        p_new_host_id: newHostId,
    });

    if (error) throw error;
}


/** =========================
 * ✅ Edit Session Studio (CreateSessionModal-like)
 * ========================= */
type StudioBlockKind =
    | "welcome"
    | "intentions"
    | "focus"
    | "break"
    | "checkin"
    | "recap"
    | "celebrate"
    | "custom";

type StudioBlock = {
    id: string;
    kind: StudioBlockKind;
    title: string;
    note?: string;
    minutes: number;
    color?: string;
};

function uid() {
    const c: any = (globalThis as any)?.crypto;
    if (c?.randomUUID) return c.randomUUID();
    return `b_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

const DEFAULT_CUSTOM_BLOCK_COLOR = "#F63135";

const BLOCK_COLOR_PRESETS = [
    "#F63135", // red
    "#4CA0FF", // blue
    "#80DF86", // green
    "#F9ADA2", // coral
    "#ADD3FF", // light blue
    "#A78BFA", // violet
    "#FBBF24", // amber
    "#22C55E", // emerald
    "#111827", // dark
];

function isValidHexColor(v: unknown) {
    return /^#[0-9a-f]{6}$/i.test(String(v || "").trim());
}

function getDefaultBlockColor(kind: StudioBlockKind) {
    switch (kind) {
        case "welcome":
            return "#80DF86";
        case "intentions":
            return "#ADD3FF";
        case "focus":
            return "#4CA0FF";
        case "break":
            return "#F9ADA2";
        case "checkin":
            return "#38BDF8";
        case "recap":
            return "#A78BFA";
        case "celebrate":
            return "#F472B6";
        case "custom":
        default:
            return DEFAULT_CUSTOM_BLOCK_COLOR;
    }
}

function getRawStudioBlockColor(block: any): string {
    return String(
        block?.color ??
        block?.colour ??
        block?.bgColor ??
        block?.backgroundColor ??
        block?.background ??
        block?.stageColor ??
        block?.stage_color ??
        ""
    ).trim();
}

function getBlockColor(block: Pick<StudioBlock, "kind" | "color"> | any) {
    const raw = getRawStudioBlockColor(block);
    return isValidHexColor(raw) ? raw : getDefaultBlockColor(block?.kind || "custom");
}

function blockColorStyle(block: StudioBlock) {
    return { backgroundColor: getBlockColor(block) };
}

const STUDIO_LIBRARY: StudioBlock[] = [
    { id: "lib_welcome", kind: "welcome", title: "Welcome", note: "Quick intro / rules / vibe", minutes: 3 },
    { id: "lib_intentions", kind: "intentions", title: "Intentions", note: "Say what you’ll finish", minutes: 5 },
    { id: "lib_focus", kind: "focus", title: "Focus", note: "Deep work block", minutes: 50 },
    { id: "lib_break", kind: "break", title: "Break", note: "Recharge / stretch", minutes: 10 },
    { id: "lib_checkin", kind: "checkin", title: "Check-in", note: "Short accountability checkpoint", minutes: 3 },
    { id: "lib_recap", kind: "recap", title: "Recap", note: "What got done / what’s next", minutes: 5 },
    { id: "lib_celebrate", kind: "celebrate", title: "Celebrate", note: "Closure + positive finish", minutes: 3 },
    { id: "lib_custom", kind: "custom", title: "Custom", note: "Any special block", minutes: 5, color: DEFAULT_CUSTOM_BLOCK_COLOR },
];



const STUDIO_KIND_OPTIONS: { value: StudioBlockKind; label: string }[] = [
    { value: "welcome", label: "Welcome" },
    { value: "intentions", label: "Intentions" },
    { value: "focus", label: "Focus" },
    { value: "break", label: "Break" },
    { value: "checkin", label: "Check-in" },
    { value: "recap", label: "Recap" },
    { value: "celebrate", label: "Celebrate" },
    { value: "custom", label: "Custom" },
];


const QUICK_MINUTES = [3, 5, 10, 15, 25, 50];
const END_DROP_ID = "__end__";
const TIMELINE_MIN_SEGMENT_WIDTH = 6;
const TIMELINE_RESIZE_PX_PER_MINUTE = 4;

function defaultStudioTitle(kind: StudioBlockKind) {
    switch (kind) {
        case "welcome": return "Welcome";
        case "intentions": return "Intentions";
        case "focus": return "Focus";
        case "break": return "Break";
        case "checkin": return "Check-in";
        case "recap": return "Recap";
        case "celebrate": return "Celebrate";
        default: return "Custom";
    }
}

function studioKindFromRaw(raw: any): StudioBlockKind {
    const s = String(raw || "").trim().toLowerCase();

    if (s.includes("welcome") || s.includes("intro") || s.includes("opening")) return "welcome";
    if (s.includes("intention") || s.includes("goal") || s.includes("plan")) return "intentions";
    if (s.includes("checkin") || s.includes("check-in")) return "checkin";
    if (s.includes("focus") || s.includes("work") || s.includes("deep")) return "focus";
    if (s.includes("break") || s.includes("pause") || s.includes("rest")) return "break";
    if (s.includes("recap") || s.includes("review") || s.includes("reflection")) return "recap";
    if (s.includes("celebrate") || s.includes("celebration")) return "celebrate";

    return "custom";
}

function studioMinutesFromAny(raw: any) {
    const sec =
        Number(raw?.durationSeconds) ||
        Number(raw?.duration_seconds) ||
        Number(raw?.seconds);

    if (Number.isFinite(sec) && sec > 0) {
        return Math.max(1, Math.round(sec / 60));
    }

    const mins =
        Number(raw?.minutes) ||
        Number(raw?.duration_minutes) ||
        Number(raw?.durationMinutes) ||
        Number(raw?.duration);

    if (Number.isFinite(mins) && mins > 0) {
        return Math.max(1, Math.round(mins));
    }

    return 0;
}
function normalizeStudioBlocksFromSession(session: any): StudioBlock[] {
    const rawStages =
        session?.session_stages ??
        session?.stages;

    if (Array.isArray(rawStages) && rawStages.length) {
        const sorted = sortStagesInClient(rawStages);
        const out = sorted
            .map((s: any) => {
                const kind = studioKindFromRaw(s?.kind || s?.type || s?.title || s?.name);
                const title =
                    String(s?.title || s?.name || s?.label || defaultStudioTitle(kind)).trim() ||
                    defaultStudioTitle(kind);
                const minutes = studioMinutesFromAny(s);
                if (!minutes) return null;

                return {
                    id: uid(),
                    kind,
                    title,
                    note: String(s?.note || s?.description || "").trim() || undefined,
                    minutes,
                    color: getBlockColor({ ...s, kind }),
                } as StudioBlock;
            })
            .filter(Boolean) as StudioBlock[];

        if (out.length) return out;
    }

    const parsed = tryParseJson<any>(session?.schedule);

    if (Array.isArray(parsed) && parsed.length) {
        const out = parsed
            .map((b: any) => {
                const kind = studioKindFromRaw(b?.kind || b?.type || b?.title || b?.name);
                const title =
                    String(b?.title || b?.name || b?.label || defaultStudioTitle(kind)).trim() ||
                    defaultStudioTitle(kind);
                const minutes = studioMinutesFromAny(b);
                if (!minutes) return null;

                return {
                    id: uid(),
                    kind,
                    title,
                    note: String(b?.note || b?.description || "").trim() || undefined,
                    minutes,
                    color: getBlockColor({ ...b, kind }),
                } as StudioBlock;
            })
            .filter(Boolean) as StudioBlock[];

        if (out.length) return out;
    }

    const phases =
        parsed?.timer?.phases ||
        parsed?.timer?.timeline ||
        parsed?.timer?.stages ||
        parsed?.timer?.segments ||
        parsed?.phases ||
        parsed?.timeline ||
        parsed?.stages ||
        parsed?.segments ||
        parsed?.timer?.blocks ||
        parsed?.blocks;

    if (Array.isArray(phases) && phases.length) {
        const out = phases
            .map((b: any) => {
                const kind = studioKindFromRaw(b?.kind || b?.type || b?.title || b?.name);
                const title =
                    String(b?.title || b?.name || b?.label || defaultStudioTitle(kind)).trim() ||
                    defaultStudioTitle(kind);
                const minutes = studioMinutesFromAny(b);
                if (!minutes) return null;

                return {
                    id: uid(),
                    kind,
                    title,
                    note: String(b?.note || b?.description || "").trim() || undefined,
                    minutes,
                    color: getBlockColor({ ...b, kind }),
                } as StudioBlock;
            })
            .filter(Boolean) as StudioBlock[];

        if (out.length) return out;
    }

    const durMin = Number(session?.duration_minutes);
    if (Number.isFinite(durMin) && durMin > 0) {
        return [
            {
                id: uid(),
                kind: "focus",
                title: "Focus",
                minutes: Math.max(1, Math.round(durMin)),
                color: getDefaultBlockColor("focus"),
            },
        ];
    }

    return [
        { id: uid(), kind: "welcome", title: "Welcome", note: "Quick intro / rules / vibe", minutes: 3 },
        { id: uid(), kind: "intentions", title: "Intentions", note: "Say what you’ll finish", minutes: 5 },
        { id: uid(), kind: "focus", title: "Focus", note: "Deep work block", minutes: 50 },
        { id: uid(), kind: "recap", title: "Recap", note: "What got done / what’s next", minutes: 5 },
    ];
}

function exportStudioToSchedule(blocks: StudioBlock[], preserveInfinite = false, anchorTs?: string | null) {
    const cleaned = (blocks || [])
        .map((b, index) => ({
            kind: b.kind,
            title: String(b.title || "").trim() || defaultStudioTitle(b.kind),
            minutes: clamp(Number(b.minutes) || 1, 1, 24 * 60),
            note: String(b.note || "").trim() || null,
            color: getBlockColor(b),
            order: index,
            v: 1,
        }))
        .filter((b) => b.minutes > 0);

    if (preserveInfinite) {
        return {
            kind: "infinite_room",
            anchor_ts: String(anchorTs || new Date().toISOString()),
            timer: {
                phases: cleaned.map((b, index) => ({
                    kind: b.kind,
                    type: b.kind,
                    name: b.title,
                    title: b.title,
                    minutes: b.minutes,
                    note: b.note,
                    color: (b as any).color,
                    order: index,
                    v: 1,
                })),
            },
            v: 1,
        };
    }

    return cleaned;
}

function formatMinutes(total: number) {
    const mins = Math.max(0, Math.round(Number(total) || 0));
    const h = Math.floor(mins / 60);
    const m = mins % 60;

    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

function SessionTimeline({
    blocks,
    onChange,
    selectedBlockId,
    setSelectedBlockId,
}: {
    blocks: StudioBlock[];
    onChange: (blocks: StudioBlock[]) => void;
    selectedBlockId: string | null;
    setSelectedBlockId: (id: string | null) => void;
}) {
    const [dragId, setDragId] = useState<string | null>(null);

    const total = blocks.reduce((s, b) => s + (Number(b.minutes) || 0), 0);

    const selectedBlock = useMemo(
        () => blocks.find((b) => b.id === selectedBlockId) || null,
        [blocks, selectedBlockId]
    );

    const rows = useMemo(() => {
        let acc = 0;
        return blocks.map((b) => {
            const start = acc;
            const end = acc + (Number(b.minutes) || 0);
            acc = end;
            return { ...b, start, end };
        });
    }, [blocks]);

    const move = useCallback(
        (fromId: string, toId: string) => {
            const from = blocks.findIndex((b) => b.id === fromId);
            const to = blocks.findIndex((b) => b.id === toId);
            if (from < 0 || to < 0 || from === to) return;

            const copy = [...blocks];
            const [item] = copy.splice(from, 1);
            copy.splice(to, 0, item);
            onChange(copy);
            setSelectedBlockId(item.id);
        },
        [blocks, onChange, setSelectedBlockId]
    );

    const moveByDelta = useCallback(
        (id: string, delta: -1 | 1) => {
            const from = blocks.findIndex((b) => b.id === id);
            if (from < 0) return;
            const to = from + delta;
            if (to < 0 || to >= blocks.length) return;

            const copy = [...blocks];
            const [item] = copy.splice(from, 1);
            copy.splice(to, 0, item);
            onChange(copy);
            setSelectedBlockId(item.id);
        },
        [blocks, onChange, setSelectedBlockId]
    );

    const update = useCallback(
        (id: string, patch: Partial<StudioBlock>) => {
            onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
        },
        [blocks, onChange]
    );

    const remove = useCallback(
        (id: string) => {
            const idx = blocks.findIndex((b) => b.id === id);
            if (idx < 0) return;

            const copy = blocks.filter((b) => b.id !== id);
            onChange(copy);

            const next = copy[idx] || copy[idx - 1] || null;
            setSelectedBlockId(next ? next.id : null);
        },
        [blocks, onChange, setSelectedBlockId]
    );

    const duplicate = useCallback(
        (id: string) => {
            const idx = blocks.findIndex((b) => b.id === id);
            if (idx < 0) return;

            const clone: StudioBlock = {
                ...blocks[idx],
                id: uid(),
            };

            const copy = [...blocks];
            copy.splice(idx + 1, 0, clone);
            onChange(copy);
            setSelectedBlockId(clone.id);
        },
        [blocks, onChange, setSelectedBlockId]
    );

    const insertAfter = useCallback(
        (id: string) => {
            const idx = blocks.findIndex((b) => b.id === id);
            if (idx < 0) return;

            const nextBlock: StudioBlock = {
                id: uid(),
                kind: "focus",
                title: "New block",
                note: "",
                minutes: 25,
                color: getDefaultBlockColor("focus"),
            };

            const copy = [...blocks];
            copy.splice(idx + 1, 0, nextBlock);
            onChange(copy);
            setSelectedBlockId(nextBlock.id);
        },
        [blocks, onChange, setSelectedBlockId]
    );

    return (
        <div className="mt-3">
            <div className="flex items-center justify-between">
                <div className="font-inter text-[12px] text-gray-600">Session timeline</div>
                <div className="font-inter text-[12px] text-gray-600">
                    Total:{" "}
                    <span className="font-semibold text-brandBlack">{formatMinutes(total)}</span>
                </div>
            </div>

            <div className="mt-2 border border-gray-200 rounded-[999px] overflow-hidden bg-gray-50">
                <div className="flex h-3 w-full">
                    {blocks.length === 0 ? (
                        <div className="w-full h-full flex items-center justify-center text-[12px] text-gray-500 font-inter">
                            Add blocks to build a timeline
                        </div>
                    ) : (
                        blocks.map((b) => {
                            const mins = clamp(Number(b.minutes) || 1, 1, 24 * 60);
                            const showText = mins >= 10;
                            const isSelected = selectedBlockId === b.id;

                            return (
                                <button
                                    key={b.id}
                                    type="button"
                                    draggable
                                    onDragStart={() => {
                                        setDragId(b.id);
                                        setSelectedBlockId(b.id);
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        if (dragId && dragId !== b.id) {
                                            move(dragId, b.id);
                                        }
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        if (dragId && dragId !== b.id) {
                                            move(dragId, b.id);
                                        }
                                        setDragId(null);
                                    }}
                                    onDragEnd={() => setDragId(null)}
                                    onClick={() => setSelectedBlockId(b.id)}
                                    onKeyDown={(e) => {
                                        if (e.key === "ArrowLeft") {
                                            e.preventDefault();
                                            moveByDelta(b.id, -1);
                                        } else if (e.key === "ArrowRight") {
                                            e.preventDefault();
                                            moveByDelta(b.id, 1);
                                        } else if (e.key === "Delete" || e.key === "Backspace") {
                                            e.preventDefault();
                                            remove(b.id);
                                        }
                                    }}
                                    className="relative h-full min-w-0 border-r border-white/70 flex items-center justify-center outline-none"
                                    style={{
                                        flexGrow: mins,
                                        flexBasis: 0,
                                        minWidth: TIMELINE_MIN_SEGMENT_WIDTH,
                                        ...blockColorStyle(b),
                                        boxShadow: isSelected
                                            ? "inset 0 0 0 2px rgba(17,24,39,0.34)"
                                            : "none",
                                    }}
                                    title={`${b.title} • ${mins} min`}
                                >
                                    {showText ? (
                                        <span className="px-2 text-[11px] font-inter text-gray-800 truncate">
                                            {b.title} · {mins}m
                                        </span>
                                    ) : null}

                                    <span
                                        className="absolute right-0 top-0 bottom-0 w-[8px] cursor-ew-resize bg-black/10"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();

                                            const startX = e.clientX;
                                            const startMinutes = mins;

                                            const onMove = (ev: MouseEvent) => {
                                                const deltaPx = ev.clientX - startX;
                                                const next = clamp(
                                                    Math.round(
                                                        startMinutes + deltaPx / TIMELINE_RESIZE_PX_PER_MINUTE
                                                    ),
                                                    1,
                                                    24 * 60
                                                );
                                                update(b.id, { minutes: next });
                                            };

                                            const onUp = () => {
                                                window.removeEventListener("mousemove", onMove);
                                                window.removeEventListener("mouseup", onUp);
                                            };

                                            window.addEventListener("mousemove", onMove);
                                            window.addEventListener("mouseup", onUp);
                                        }}
                                    />
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            {selectedBlock && (
                <div className="mt-3 rounded-[18px] border border-gray-200 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-[#111827]">
                                Edit selected block
                            </div>
                            <div className="mt-0.5 text-[11px] text-gray-500">
                                Click a segment to edit it. Drag to reorder. Pull the right edge to resize.
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                            <button
                                type="button"
                                onClick={() => moveByDelta(selectedBlock.id, -1)}
                                className="h-9 w-9 rounded-[12px] border border-gray-200 bg-white text-gray-700 flex items-center justify-center hover:bg-gray-50"
                                title="Move left"
                            >
                                <ArrowUp className="rotate-[-90deg]" size={15} />
                            </button>
                            <button
                                type="button"
                                onClick={() => moveByDelta(selectedBlock.id, 1)}
                                className="h-9 w-9 rounded-[12px] border border-gray-200 bg-white text-gray-700 flex items-center justify-center hover:bg-gray-50"
                                title="Move right"
                            >
                                <ArrowDown className="rotate-[-90deg]" size={15} />
                            </button>
                            <button
                                type="button"
                                onClick={() => duplicate(selectedBlock.id)}
                                className="px-3 h-9 rounded-[12px] border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Duplicate
                            </button>
                            <button
                                type="button"
                                onClick={() => insertAfter(selectedBlock.id)}
                                className="px-3 h-9 rounded-[12px] border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Add after
                            </button>
                            <button
                                type="button"
                                onClick={() => remove(selectedBlock.id)}
                                className="h-9 w-9 rounded-[12px] border border-gray-200 bg-white text-red-500 flex items-center justify-center hover:bg-red-50"
                                title="Delete"
                            >
                                <Trash2 size={15} />
                            </button>
                        </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-[160px,minmax(0,1fr),140px] gap-2">
                        <select
                            value={selectedBlock.kind}
                            onChange={(e) => {
                                const nextKind = e.target.value as StudioBlockKind;
                                update(selectedBlock.id, {
                                    kind: nextKind,
                                    title:
                                        String(selectedBlock.title || "").trim() ||
                                        defaultStudioTitle(nextKind),
                                    color: getDefaultBlockColor(nextKind),
                                });
                            }}
                            className="w-full px-3 py-2.5 rounded-[14px] border border-gray-200 bg-white text-[13px] font-inter text-[#111827]"
                        >
                            {STUDIO_KIND_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>

                        <input
                            value={selectedBlock.title}
                            onChange={(e) => update(selectedBlock.id, { title: e.target.value })}
                            className="w-full px-3 py-2.5 rounded-[14px] border border-gray-200 bg-white text-[13px] font-inter text-[#111827]"
                            placeholder="Block title…"
                        />

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() =>
                                    update(selectedBlock.id, {
                                        minutes: clamp(
                                            (Number(selectedBlock.minutes) || 1) - 1,
                                            1,
                                            24 * 60
                                        ),
                                    })
                                }
                                className="w-9 h-9 rounded-[12px] border border-gray-200 bg-white text-gray-700"
                            >
                                –
                            </button>
                            <input
                                type="number"
                                min={1}
                                max={24 * 60}
                                value={selectedBlock.minutes}
                                onChange={(e) =>
                                    update(selectedBlock.id, {
                                        minutes: clamp(Number(e.target.value) || 1, 1, 24 * 60),
                                    })
                                }
                                className="w-full h-9 px-2 rounded-[12px] border border-gray-200 bg-white text-center text-[13px] font-inter text-[#111827]"
                            />
                            <button
                                type="button"
                                onClick={() =>
                                    update(selectedBlock.id, {
                                        minutes: clamp(
                                            (Number(selectedBlock.minutes) || 1) + 1,
                                            1,
                                            24 * 60
                                        ),
                                    })
                                }
                                className="w-9 h-9 rounded-[12px] border border-gray-200 bg-white text-gray-700"
                            >
                                +
                            </button>
                        </div>
                    </div>

                    <textarea
                        value={selectedBlock.note || ""}
                        onChange={(e) => update(selectedBlock.id, { note: e.target.value })}
                        className="mt-2 w-full px-3 py-2.5 rounded-[14px] border border-gray-200 bg-white text-[13px] font-inter text-[#111827]"
                        placeholder="Block note…"
                        rows={2}
                    />

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        {QUICK_MINUTES.map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => update(selectedBlock.id, { minutes: m })}
                                className="px-2.5 py-1.5 rounded-full border border-gray-200 bg-white text-[11px] font-inter text-gray-700 hover:bg-gray-50"
                            >
                                {m}m
                            </button>
                        ))}
                    </div>

                    {selectedBlock.kind === "custom" && (
                        <div className="mt-3 rounded-[14px] border border-gray-200 bg-gray-50 px-3 py-3">
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <div>
                                    <div className="font-inter text-[12px] font-semibold text-[#111827]">
                                        Custom block color
                                    </div>
                                    <div className="font-inter text-[11px] text-gray-500">
                                        This color will be saved into the session timeline.
                                    </div>
                                </div>

                                <input
                                    type="color"
                                    value={getBlockColor(selectedBlock)}
                                    onChange={(e) =>
                                        update(selectedBlock.id, { color: e.target.value })
                                    }
                                    className="h-9 w-12 cursor-pointer rounded-lg border border-gray-200 bg-white p-1"
                                    title="Custom block color"
                                />
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {BLOCK_COLOR_PRESETS.map((color) => {
                                    const selected =
                                        getBlockColor(selectedBlock).toLowerCase() ===
                                        color.toLowerCase();

                                    return (
                                        <button
                                            key={`${selectedBlock.id}-${color}`}
                                            type="button"
                                            onClick={() => update(selectedBlock.id, { color })}
                                            className={
                                                "h-7 w-7 rounded-full border transition " +
                                                (selected
                                                    ? "border-[#111827] ring-2 ring-black/20"
                                                    : "border-gray-200 hover:scale-105")
                                            }
                                            style={{ backgroundColor: color }}
                                            title={color}
                                            aria-label={`Set custom block color ${color}`}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {blocks.length > 0 && (
                <details className="mt-2">
                    <summary className="cursor-pointer select-none text-[12px] text-gray-600 font-inter hover:text-gray-800">
                        Show breakdown
                    </summary>

                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                        {rows.map((r) => (
                            <button
                                key={r.id}
                                type="button"
                                onClick={() => setSelectedBlockId(r.id)}
                                className={
                                    "border rounded-[14px] px-3 py-2 flex items-center justify-between gap-3 text-left " +
                                    (selectedBlockId === r.id
                                        ? "border-[#111827] bg-gray-50"
                                        : "border-gray-200 bg-white")
                                }
                            >
                                <div className="min-w-0 flex items-center gap-2">
                                    <span
                                        className="w-3 h-3 rounded-full shrink-0"
                                        style={blockColorStyle(r)}
                                    />
                                    <span className="text-[12px] font-inter text-[#111827] truncate">
                                        {r.title}
                                    </span>
                                </div>

                                <div className="text-[12px] font-inter text-gray-600 whitespace-nowrap">
                                    {r.start}–{r.end}m · {r.minutes}m
                                </div>
                            </button>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}


function isInteractiveEl(target: EventTarget | null) {
    const t = target as HTMLElement | null;
    if (!t) return false;
    const tag = (t.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") return true;
    if (t.isContentEditable) return true;
    return !!t.closest?.("input,textarea,select,button,[contenteditable='true']");
}

function EditSessionStudioModal(props: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (payload: {
        title?: string;
        start_time?: string;
        max_participants?: number | null;
        description?: string | null;
        schedule?: any;
        duration_minutes?: number | null;
        host_id?: string | null;
        host_name?: string | null;
    }) => Promise<void> | void;
    session: any;
    currentUserId?: string;
    hostCandidates?: HostTransferCandidate[];
    onHostTransferred?: (newHost: HostTransferCandidate) => void;
}) {
    const {
        isOpen,
        onClose,
        onSave,
        session,
        currentUserId,
        hostCandidates = [],
        onHostTransferred,
    } = props;

    const [editTitle, setEditTitle] = useState<string>(session?.title || "");
    const [editDescription, setEditDescription] = useState<string>(
        typeof session?.description === "string" ? session.description : ""
    );
    const [editStartLocal, setEditStartLocal] = useState<string>("");
    const [editMaxParticipants, setEditMaxParticipants] = useState<string>(() => {
        const v = session?.max_participants;
        return v == null ? "" : String(v);
    });

    const [studioBlocks, setStudioBlocks] = useState<StudioBlock[]>([]);
    const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [dropEdge, setDropEdge] = useState<"before" | "after">("after");
    const [isSaving, setIsSaving] = useState(false);
    const [transferQuery, setTransferQuery] = useState("");
    const [transferResults, setTransferResults] = useState<HostTransferCandidate[]>([]);
    const [isTransferSearching, setIsTransferSearching] = useState(false);
    const [isTransferringHostId, setIsTransferringHostId] = useState<string | null>(null);
    const [transferError, setTransferError] = useState<string | null>(null);
    const [transferNotice, setTransferNotice] = useState<string | null>(null);

    const modalScrollRef = useRef<HTMLDivElement | null>(null);
    const autoScrollRafRef = useRef<number | null>(null);
    const autoScrollVelRef = useRef<number>(0);
    const draggingRef = useRef<boolean>(false);

    const flipPrevTopsRef = useRef<Record<string, number>>({});
    const flipArmedRef = useRef<boolean>(false);

    const isInfinite = resolveSessionType(session) === "infinite";
    const currentHostId = String(session?.host_id || "").trim();
    const studioTotal = useMemo(
        () => studioBlocks.reduce((sum, b) => sum + (Number(b.minutes) || 0), 0),
        [studioBlocks]
    );

    const suggestedHostCandidates = useMemo(() => {
        return uniqueHostTransferCandidates(
            (hostCandidates || [])
                .map(normalizeHostTransferCandidate)
                .filter((x): x is HostTransferCandidate => !!x)
                .filter((x) => String(x.id) !== currentHostId)
        ).slice(0, 8);
    }, [hostCandidates, currentHostId]);

    const visibleTransferCandidates = useMemo(() => {
        return uniqueHostTransferCandidates([
            ...(transferResults || []),
            ...suggestedHostCandidates,
        ]).filter((x) => String(x.id) !== currentHostId);
    }, [transferResults, suggestedHostCandidates, currentHostId]);

    useEffect(() => {
        if (!isOpen) return;

        setEditTitle(session?.title || "");
        setEditDescription(typeof session?.description === "string" ? session.description : "");
        if (session?.start_time) {
            try {
                const d = new Date(session.start_time);
                const pad = (n: number) => String(n).padStart(2, "0");
                setEditStartLocal(
                    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
                        d.getHours()
                    )}:${pad(d.getMinutes())}`
                );
            } catch {
                setEditStartLocal("");
            }
        } else {
            setEditStartLocal("");
        }

        setEditMaxParticipants(
            session?.max_participants == null ? "" : String(session?.max_participants)
        );
        setStudioBlocks(normalizeStudioBlocksFromSession(session));
        setSelectedBlockId(null);
        setDraggingId(null);
        setDragOverId(null);
        setDropEdge("after");
        setIsSaving(false);
        setTransferQuery("");
        setTransferResults([]);
        setIsTransferSearching(false);
        setIsTransferringHostId(null);
        setTransferError(null);
        setTransferNotice(null);
    }, [isOpen, session?.id, session?.description, session?.title, session?.start_time, session?.max_participants]);

    useEffect(() => {
        if (!isOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [isOpen]);

    const focusBlock = useCallback((id: string) => {
        if (!id) return;
        requestAnimationFrame(() => {
            const el = document.getElementById(`studio-block-${id}`) as HTMLElement | null;
            if (!el) return;
            el.focus();
            try {
                el.scrollIntoView({ block: "nearest", behavior: "smooth" });
            } catch { }
        });
    }, []);

    const startAutoScrollLoop = useCallback(() => {
        if (autoScrollRafRef.current) return;
        draggingRef.current = true;

        const tick = () => {
            if (!draggingRef.current) {
                autoScrollRafRef.current = null;
                return;
            }

            const scroller = modalScrollRef.current;
            const v = autoScrollVelRef.current;

            if (scroller && v !== 0) {
                scroller.scrollTop += v;
            }

            autoScrollRafRef.current = requestAnimationFrame(tick);
        };

        autoScrollRafRef.current = requestAnimationFrame(tick);
    }, []);

    const stopAutoScrollLoop = useCallback(() => {
        draggingRef.current = false;
        autoScrollVelRef.current = 0;
        if (autoScrollRafRef.current) {
            cancelAnimationFrame(autoScrollRafRef.current);
            autoScrollRafRef.current = null;
        }
    }, []);

    const updateAutoScrollFromClientY = useCallback((clientY: number) => {
        const scroller = modalScrollRef.current;
        if (!scroller) {
            autoScrollVelRef.current = 0;
            return;
        }

        const rect = scroller.getBoundingClientRect();
        const threshold = 80;
        const maxSpeed = 18;

        const topZone = rect.top + threshold;
        const bottomZone = rect.bottom - threshold;

        let vel = 0;

        if (clientY < topZone) {
            const t = clamp((topZone - clientY) / threshold, 0, 1);
            vel = -Math.round(maxSpeed * t);
        } else if (clientY > bottomZone) {
            const t = clamp((clientY - bottomZone) / threshold, 0, 1);
            vel = Math.round(maxSpeed * t);
        } else {
            vel = 0;
        }

        autoScrollVelRef.current = vel;
    }, []);

    const armFlip = useCallback(() => {
        const tops: Record<string, number> = {};
        for (const b of studioBlocks) {
            const el = document.getElementById(`studio-block-${b.id}`) as HTMLElement | null;
            if (!el) continue;
            tops[b.id] = el.getBoundingClientRect().top;
        }
        flipPrevTopsRef.current = tops;
        flipArmedRef.current = true;
    }, [studioBlocks]);

    useLayoutEffect(() => {
        if (!flipArmedRef.current) return;

        const prev = flipPrevTopsRef.current || {};
        flipArmedRef.current = false;

        for (const b of studioBlocks) {
            const el = document.getElementById(`studio-block-${b.id}`) as HTMLElement | null;
            if (!el) continue;

            const prevTop = prev[b.id];
            if (typeof prevTop !== "number") continue;

            const nextTop = el.getBoundingClientRect().top;
            const dy = prevTop - nextTop;

            if (Math.abs(dy) < 1) continue;

            try {
                el.animate(
                    [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0px)" }],
                    {
                        duration: 180,
                        easing: "cubic-bezier(0.2, 0, 0, 1)",
                    }
                );
            } catch { }
        }
    }, [studioBlocks]);

    const updateBlock = useCallback((id: string, patch: Partial<StudioBlock>) => {
        setStudioBlocks((prev) =>
            prev.map((b) => (b.id === id ? { ...b, ...patch } : b))
        );
    }, []);

    const removeBlock = useCallback((id: string) => {
        setStudioBlocks((prev) => prev.filter((b) => b.id !== id));
        setSelectedBlockId((cur) => (cur === id ? null : cur));
    }, []);

    const addFromLibrary = useCallback((b: StudioBlock) => {
        setStudioBlocks((prev) => [
            ...prev,
            {
                id: uid(),
                kind: b.kind,
                title: b.title,
                note: b.note,
                minutes: b.minutes,
                color: getBlockColor(b),
            },
        ]);
    }, []);

    const resetDefaultStudio = useCallback(() => {
        setStudioBlocks([
            { id: uid(), kind: "welcome", title: "Welcome", note: "Quick intro / rules / vibe", minutes: 3 },
            { id: uid(), kind: "intentions", title: "Intentions", note: "Say what you’ll finish", minutes: 5 },
            { id: uid(), kind: "focus", title: "Focus", note: "Deep work block", minutes: 50 },
            { id: uid(), kind: "break", title: "Break", note: "Recharge / stretch", minutes: 10 },
            { id: uid(), kind: "focus", title: "Focus", note: "Second focus block", minutes: 50 },
            { id: uid(), kind: "recap", title: "Recap", note: "What got done / what’s next", minutes: 5 },
            { id: uid(), kind: "celebrate", title: "Celebrate", note: "Closure + positive finish", minutes: 3 },
        ]);
    }, []);

    const clearStudio = useCallback(() => setStudioBlocks([]), []);

    const moveBlock = useCallback(
        (id: string, dir: -1 | 1) => {
            armFlip();

            setStudioBlocks((prev) => {
                const idx = prev.findIndex((b) => b.id === id);
                if (idx < 0) return prev;
                const nextIdx = idx + dir;
                if (nextIdx < 0 || nextIdx >= prev.length) return prev;
                const copy = [...prev];
                const [item] = copy.splice(idx, 1);
                copy.splice(nextIdx, 0, item);
                return copy;
            });

            setSelectedBlockId(id);
            focusBlock(id);
        },
        [armFlip, focusBlock]
    );

    const moveBlockTo = useCallback(
        (dragId: string, overId: string, edge: "before" | "after") => {
            if (!dragId || !overId) return;

            armFlip();

            setStudioBlocks((prev) => {
                const from = prev.findIndex((b) => b.id === dragId);
                if (from < 0) return prev;

                if (overId === END_DROP_ID) {
                    const copy = [...prev];
                    const [item] = copy.splice(from, 1);
                    copy.push(item);
                    return copy;
                }

                const to = prev.findIndex((b) => b.id === overId);
                if (to < 0 || dragId === overId) return prev;

                const copy = [...prev];
                const [item] = copy.splice(from, 1);
                const toAfterRemoval = from < to ? to - 1 : to;
                const insertIndex = toAfterRemoval + (edge === "after" ? 1 : 0);
                copy.splice(clamp(insertIndex, 0, copy.length), 0, item);
                return copy;
            });

            setSelectedBlockId(dragId);
            focusBlock(dragId);
        },
        [armFlip, focusBlock]
    );

    useEffect(() => {
        if (!isOpen) return;

        const q = transferQuery.trim();

        if (!q) {
            setTransferResults([]);
            setIsTransferSearching(false);
            return;
        }

        setIsTransferSearching(true);
        setTransferError(null);

        const t = window.setTimeout(async () => {
            try {
                const results = await searchHostTransferCandidates(q);
                setTransferResults(results);
            } catch (e: any) {
                setTransferResults([]);
                setTransferError(e?.message || "Could not search users.");
            } finally {
                setIsTransferSearching(false);
            }
        }, 350);

        return () => window.clearTimeout(t);
    }, [isOpen, transferQuery]);

    const handleTransferHost = useCallback(
        async (candidate: HostTransferCandidate) => {
            const newHostId = String(candidate?.id || "").trim();
            if (!newHostId || !session?.id) return;

            if (currentUserId && currentHostId && currentUserId !== currentHostId) {
                setTransferError("Only the current host can transfer host rights.");
                return;
            }

            if (newHostId === currentHostId) {
                setTransferError("This user is already the host.");
                return;
            }

            const label = String(candidate.full_name || candidate.email || candidate.id || "this user");
            const ok = window.confirm(
                `Transfer host rights for this session to ${label}?\n\nAfter this, they will become the session host.`
            );

            if (!ok) return;

            setIsTransferringHostId(newHostId);
            setTransferError(null);
            setTransferNotice(null);

            try {
                await transferSessionHostRights({
                    sessionId: String(session.id),
                    newHostId,
                });

                setTransferNotice(`Host rights transferred to ${label}.`);
                onHostTransferred?.(candidate);
            } catch (e: any) {
                console.error("[SessionCard] transfer host rights failed:", e);
                setTransferError(
                    e?.message ||
                    "Could not transfer host rights. Check the SQL RPC/policies and try again."
                );
            } finally {
                setIsTransferringHostId(null);
            }
        },
        [session?.id, currentHostId, currentUserId, onHostTransferred]
    );

    if (!isOpen) return null;

    return (
        <ModalShell
            title="Edit session"
            isOpen={isOpen}
            onClose={onClose}
            widthClass="max-w-[1200px]"
        >
            <div ref={modalScrollRef} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-[14px] font-medium text-brandBlack mb-1 font-inter">
                            Session title
                        </label>
                        <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="e.g., Deep Work Session"
                            className="w-full px-3 py-3 border border-gray-300 rounded-[16px] font-inter"
                        />
                    </div>

                    <div>
                        <label className="block text-[14px] font-medium text-brandBlack mb-1 font-inter">
                            Start time
                        </label>
                        <input
                            type="datetime-local"
                            value={editStartLocal}
                            onChange={(e) => setEditStartLocal(e.target.value)}
                            className="w-full px-3 py-3 border border-gray-300 rounded-[16px] font-inter"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-[14px] font-medium text-brandBlack mb-1 font-inter">
                        Description
                    </label>
                    <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Optional. Describe what this session is about."
                        rows={4}
                        className="w-full px-3 py-3 border border-gray-300 rounded-[16px] font-inter resize-y"
                    />
                </div>

                <div className="border border-[#DBD8D8] rounded-[18px] bg-white p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                            <div className="w-10 h-10 p-2 rounded-[14px] bg-[#111827] text-white flex items-center justify-center shrink-0">
                                <Layers size={18} />
                            </div>

                            <div className="min-w-0">
                                <div className="font-inter font-semibold text-[14px] text-brandBlack">
                                    Session Studio
                                </div>
                                <div className="font-inter text-[12px] text-gray-500">
                                    Edit session description and timeline with the same style as CreateSessionModal.
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 border border-gray-200 rounded-[16px] p-3">
                        <div className="font-inter font-semibold text-[13px] text-brandBlack">
                            Participant limit
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                            <input
                                type="number"
                                min={1}
                                value={editMaxParticipants}
                                onChange={(e) => setEditMaxParticipants(e.target.value)}
                                className="w-28 px-3 py-2 border border-gray-300 rounded-[14px] font-inter text-center"
                            />
                            <span className="font-inter text-[12px] text-gray-600">people</span>
                        </div>
                    </div>

                    <div className="mt-4 border border-[#DBD8D8] rounded-[18px] bg-[#FAFAFA] p-3 sm:p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 font-inter font-semibold text-[13px] text-brandBlack">
                                    <Crown size={15} />
                                    Transfer host rights
                                </div>
                                <div className="mt-1 font-inter text-[12px] leading-5 text-gray-500">
                                    Move ownership and host controls for this session to another user.
                                    Use this when someone else should run the room.
                                </div>
                            </div>
                        </div>

                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                            <div className="relative flex-1">
                                <Search
                                    size={15}
                                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                                />
                                <input
                                    value={transferQuery}
                                    onChange={(e) => setTransferQuery(e.target.value)}
                                    placeholder="Search user by name, email, or user id…"
                                    className="w-full rounded-[14px] border border-gray-300 bg-white py-2.5 pl-9 pr-3 font-inter text-[13px] text-brandBlack"
                                />
                            </div>
                        </div>

                        {isTransferSearching && (
                            <div className="mt-2 font-inter text-[12px] text-gray-500">
                                Searching users…
                            </div>
                        )}

                        {transferError && (
                            <div className="mt-2 rounded-[12px] border border-red-100 bg-red-50 px-3 py-2 font-inter text-[12px] text-red-600">
                                {transferError}
                            </div>
                        )}

                        {transferNotice && (
                            <div className="mt-2 rounded-[12px] border border-emerald-100 bg-emerald-50 px-3 py-2 font-inter text-[12px] text-emerald-700">
                                {transferNotice}
                            </div>
                        )}

                        {visibleTransferCandidates.length > 0 ? (
                            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                                {visibleTransferCandidates.map((candidate) => {
                                    const label = String(candidate.full_name || candidate.email || candidate.id);
                                    const sub = candidate.email && candidate.email !== label ? candidate.email : candidate.id;
                                    const isBusy = isTransferringHostId === candidate.id;

                                    return (
                                        <button
                                            key={candidate.id}
                                            type="button"
                                            disabled={!!isTransferringHostId}
                                            onClick={() => handleTransferHost(candidate)}
                                            className="flex items-center justify-between gap-3 rounded-[14px] border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-brandBlack hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <div className="flex min-w-0 items-center gap-2">
                                                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-white text-[11px] font-semibold text-brandBlack">
                                                    {candidate.avatar_url ? (
                                                        <img
                                                            src={candidate.avatar_url}
                                                            alt={label}
                                                            className="h-full w-full object-cover"
                                                            draggable={false}
                                                        />
                                                    ) : (
                                                        getInitials(label)
                                                    )}
                                                </div>

                                                <div className="min-w-0">
                                                    <div className="truncate font-inter text-[13px] font-semibold text-brandBlack">
                                                        {label}
                                                    </div>
                                                    <div className="truncate font-inter text-[11px] text-gray-500">
                                                        {sub}
                                                    </div>
                                                </div>
                                            </div>

                                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 font-inter text-[11px] font-semibold text-gray-700">
                                                <UserCheck size={13} />
                                                {isBusy ? "Transferring…" : "Make host"}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : transferQuery.trim() && !isTransferSearching ? (
                            <div className="mt-2 font-inter text-[12px] text-gray-500">
                                No matching users found.
                            </div>
                        ) : suggestedHostCandidates.length === 0 ? (
                            <div className="mt-2 font-inter text-[12px] text-gray-500">
                                Booked/live participants will appear here. You can also search manually above.
                            </div>
                        ) : null}
                    </div>

                    <SessionTimeline
                        blocks={studioBlocks}
                        onChange={setStudioBlocks}
                        selectedBlockId={selectedBlockId}
                        setSelectedBlockId={setSelectedBlockId}
                    />

                    <div className="mt-3">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                            <button
                                onClick={resetDefaultStudio}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
                                type="button"
                            >
                                <RotateCcw size={14} />
                                Reset default
                            </button>

                            <button
                                onClick={clearStudio}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
                                type="button"
                            >
                                <Eraser size={14} />
                                Clear
                            </button>
                        </div>

                        <div className="mt-2 text-[12px] text-gray-500 font-inter">
                            Tip: drag blocks to reorder, or click a block and use ↑ / ↓.
                        </div>

                        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                            <div className="border border-gray-200 rounded-[18px] p-3 sm:p-4">
                                <div>
                                    <div className="font-inter font-semibold text-[13px] text-brandBlack">
                                        Block Library
                                    </div>
                                    <div className="font-inter text-[12px] text-gray-500">
                                        Add blocks to the script.
                                    </div>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3">
                                    {STUDIO_LIBRARY.map((b) => (
                                        <button
                                            key={b.id}
                                            onClick={() => addFromLibrary(b)}
                                            className="text-left border border-gray-200 rounded-[14px] p-3 hover:bg-gray-50 transition"
                                            type="button"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="font-inter font-semibold text-[12px] text-brandBlack">
                                                    {b.title}
                                                </div>
                                                <div className="font-inter text-[12px] text-gray-500 whitespace-nowrap">
                                                    {b.minutes}m
                                                </div>
                                            </div>
                                            <div className="mt-1 font-inter text-[12px] text-gray-500 leading-snug">
                                                {b.note}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div
                                className="border border-gray-200 rounded-[18px] p-3 sm:p-4"
                                onDragOver={(e) => {
                                    if (!draggingId) return;
                                    updateAutoScrollFromClientY(e.clientY);
                                }}
                                onDragLeave={() => {
                                    if (!draggingId) return;
                                    autoScrollVelRef.current = 0;
                                }}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="font-inter font-semibold text-[13px] text-brandBlack">
                                            Script
                                        </div>
                                        <div className="font-inter text-[12px] text-gray-500">
                                            Reorder with drag & drop, keyboard ↑/↓, or arrows.
                                        </div>
                                    </div>

                                    <div className="text-right shrink-0">
                                        <div className="font-inter text-[12px] text-gray-500">Total:</div>
                                        <div className="font-inter font-semibold text-[12px] text-brandBlack whitespace-nowrap">
                                            {studioTotal} min
                                        </div>
                                    </div>
                                </div>

                                {studioBlocks.length === 0 ? (
                                    <div className="mt-4 text-[12px] text-gray-500 font-inter">
                                        No blocks yet. Add from the library on the left.
                                    </div>
                                ) : (
                                    <div className="mt-3 space-y-2 sm:space-y-3">
                                        {studioBlocks.map((b, idx) => {
                                            const selected = selectedBlockId === b.id;
                                            const isDragging = draggingId === b.id;
                                            const isOverSelf =
                                                dragOverId === b.id &&
                                                draggingId &&
                                                draggingId !== b.id;

                                            return (
                                                <div
                                                    key={b.id}
                                                    id={`studio-block-${b.id}`}
                                                    tabIndex={0}
                                                    draggable
                                                    onClick={() => {
                                                        setSelectedBlockId(b.id);
                                                        focusBlock(b.id);
                                                    }}
                                                    onFocus={() => setSelectedBlockId(b.id)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "ArrowUp") {
                                                            e.preventDefault();
                                                            moveBlock(b.id, -1);
                                                        } else if (e.key === "ArrowDown") {
                                                            e.preventDefault();
                                                            moveBlock(b.id, 1);
                                                        } else if (
                                                            e.key === "Delete" ||
                                                            e.key === "Backspace"
                                                        ) {
                                                            if (!isInteractiveEl(e.target)) {
                                                                e.preventDefault();
                                                                removeBlock(b.id);
                                                            }
                                                        }
                                                    }}
                                                    onDragStart={(e) => {
                                                        if (isInteractiveEl(e.target)) {
                                                            e.preventDefault();
                                                            return;
                                                        }
                                                        setDraggingId(b.id);
                                                        setDragOverId(null);
                                                        setDropEdge("after");

                                                        try {
                                                            e.dataTransfer.effectAllowed = "move";
                                                            e.dataTransfer.setData("text/plain", b.id);
                                                            const img = new Image();
                                                            img.src =
                                                                "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
                                                            e.dataTransfer.setDragImage(img, 0, 0);
                                                        } catch { }

                                                        startAutoScrollLoop();
                                                    }}
                                                    onDragOver={(e) => {
                                                        e.preventDefault();
                                                        if (!draggingId) return;

                                                        updateAutoScrollFromClientY(e.clientY);

                                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                        const mid = rect.top + rect.height / 2;
                                                        const edge: "before" | "after" =
                                                            e.clientY < mid ? "before" : "after";

                                                        if (dragOverId !== b.id) setDragOverId(b.id);
                                                        if (dropEdge !== edge) setDropEdge(edge);
                                                    }}
                                                    onDrop={(e) => {
                                                        e.preventDefault();

                                                        const dragIdFromData = (() => {
                                                            try {
                                                                return e.dataTransfer.getData("text/plain") || "";
                                                            } catch {
                                                                return "";
                                                            }
                                                        })();

                                                        const dragId = draggingId || dragIdFromData;
                                                        if (dragId) moveBlockTo(dragId, b.id, dropEdge);

                                                        setDraggingId(null);
                                                        setDragOverId(null);
                                                        setDropEdge("after");
                                                        stopAutoScrollLoop();
                                                    }}
                                                    onDragEnd={() => {
                                                        setDraggingId(null);
                                                        setDragOverId(null);
                                                        setDropEdge("after");
                                                        stopAutoScrollLoop();
                                                    }}
                                                    className={
                                                        "relative border rounded-[16px] p-2.5 sm:p-3 outline-none transition " +
                                                        "cursor-grab active:cursor-grabbing " +
                                                        (selected
                                                            ? "border-brandBlack ring-2 ring-black/10"
                                                            : "border-gray-200") +
                                                        (isDragging ? " opacity-60" : "") +
                                                        " hover:bg-gray-50"
                                                    }
                                                    title="Drag to reorder. Click + use ↑/↓ to move."
                                                >
                                                    {isOverSelf && (
                                                        <div
                                                            className={
                                                                "pointer-events-none absolute left-3 right-3 h-[3px] rounded-full bg-brandBlack/80 " +
                                                                (dropEdge === "before" ? "-top-[6px]" : "-bottom-[6px]")
                                                            }
                                                        />
                                                    )}

                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="px-2 py-1 rounded-full border border-gray-200 text-[10px] sm:text-[11px] font-inter text-gray-600 whitespace-nowrap">
                                                            {b.kind}
                                                        </span>

                                                        <div className="flex items-center gap-2 shrink-0">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    moveBlock(b.id, -1);
                                                                }}
                                                                disabled={idx === 0}
                                                                className="w-8 h-8 sm:w-9 sm:h-9 rounded-[12px] border border-gray-200 flex items-center justify-center disabled:opacity-40 hover:bg-gray-50 transition"
                                                                type="button"
                                                                title="Move up"
                                                            >
                                                                <ArrowUp size={16} />
                                                            </button>

                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    moveBlock(b.id, 1);
                                                                }}
                                                                disabled={idx === studioBlocks.length - 1}
                                                                className="w-8 h-8 sm:w-9 sm:h-9 rounded-[12px] border border-gray-200 flex items-center justify-center disabled:opacity-40 hover:bg-gray-50 transition"
                                                                type="button"
                                                                title="Move down"
                                                            >
                                                                <ArrowDown size={16} />
                                                            </button>

                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    removeBlock(b.id);
                                                                }}
                                                                className="w-8 h-8 sm:w-9 sm:h-9 rounded-[12px] border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition"
                                                                type="button"
                                                                title="Remove"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="mt-2">
                                                        <input
                                                            value={b.title}
                                                            onChange={(e) =>
                                                                updateBlock(b.id, { title: e.target.value })
                                                            }
                                                            className="w-full px-3 py-2.5 border border-gray-200 rounded-[14px] text-[13px] font-inter"
                                                            placeholder="Block title…"
                                                            onClick={(e) => e.stopPropagation()}
                                                            onFocus={() => setSelectedBlockId(b.id)}
                                                        />
                                                    </div>

                                                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                        <span className="text-[12px] text-gray-500 font-inter shrink-0">
                                                            Minutes
                                                        </span>

                                                        <div
                                                            className="flex items-center gap-1 sm:gap-2 flex-nowrap shrink-0"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    updateBlock(b.id, {
                                                                        minutes: clamp(b.minutes - 1, 1, 24 * 60),
                                                                    })
                                                                }
                                                                className="w-8 h-8 sm:w-9 sm:h-9 rounded-[12px] border border-gray-200 hover:bg-gray-50 transition"
                                                            >
                                                                –
                                                            </button>

                                                            <input
                                                                type="number"
                                                                value={b.minutes}
                                                                onChange={(e) =>
                                                                    updateBlock(b.id, {
                                                                        minutes: clamp(
                                                                            Number(e.target.value) || 1,
                                                                            1,
                                                                            24 * 60
                                                                        ),
                                                                    })
                                                                }
                                                                className="w-14 sm:w-16 h-8 sm:h-9 px-2 border border-gray-200 rounded-[12px] text-[13px] font-inter text-center"
                                                                onFocus={() => setSelectedBlockId(b.id)}
                                                            />

                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    updateBlock(b.id, {
                                                                        minutes: clamp(b.minutes + 1, 1, 24 * 60),
                                                                    })
                                                                }
                                                                className="w-8 h-8 sm:w-9 sm:h-9 rounded-[12px] border border-gray-200 hover:bg-gray-50 transition"
                                                            >
                                                                +
                                                            </button>

                                                            <span className="hidden sm:inline text-[12px] text-gray-500 font-inter whitespace-nowrap">
                                                                min
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div
                                                        className="mt-2 flex items-center gap-2 flex-wrap"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {QUICK_MINUTES.map((m) => (
                                                            <button
                                                                key={m}
                                                                type="button"
                                                                onClick={() => updateBlock(b.id, { minutes: m })}
                                                                className="px-2.5 py-1.5 rounded-full border border-gray-200 text-[11px] sm:text-[12px] font-inter hover:bg-gray-50 transition"
                                                            >
                                                                {m}m
                                                            </button>
                                                        ))}
                                                    </div>

                                                    {b.kind === "custom" && (
                                                        <div
                                                            className="mt-3 rounded-[14px] border border-gray-200 bg-white px-3 py-3"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                                <div>
                                                                    <div className="font-inter text-[12px] font-semibold text-brandBlack">
                                                                        Custom block color
                                                                    </div>
                                                                    <div className="font-inter text-[11px] text-gray-500">
                                                                        This color will be used in the session timeline.
                                                                    </div>
                                                                </div>

                                                                <input
                                                                    type="color"
                                                                    value={getBlockColor(b)}
                                                                    onChange={(e) => updateBlock(b.id, { color: e.target.value })}
                                                                    className="h-9 w-12 cursor-pointer rounded-lg border border-gray-200 bg-white p-1"
                                                                    title="Custom block color"
                                                                />
                                                            </div>

                                                            <div className="flex flex-wrap gap-2">
                                                                {BLOCK_COLOR_PRESETS.map((color) => {
                                                                    const selected =
                                                                        getBlockColor(b).toLowerCase() === color.toLowerCase();

                                                                    return (
                                                                        <button
                                                                            key={`${b.id}-${color}`}
                                                                            type="button"
                                                                            onClick={() => updateBlock(b.id, { color })}
                                                                            className={
                                                                                "h-7 w-7 rounded-full border transition " +
                                                                                (selected
                                                                                    ? "border-brandBlack ring-2 ring-brandBlack/20"
                                                                                    : "border-gray-200 hover:scale-105")
                                                                            }
                                                                            style={{ backgroundColor: color }}
                                                                            title={color}
                                                                            aria-label={`Set custom block color ${color}`}
                                                                        />
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}

                                        {draggingId && (
                                            <div
                                                className="relative h-10 rounded-[14px] border border-dashed border-gray-200 bg-gray-50/60"
                                                onDragOver={(e) => {
                                                    e.preventDefault();
                                                    updateAutoScrollFromClientY(e.clientY);
                                                    if (dragOverId !== END_DROP_ID) setDragOverId(END_DROP_ID);
                                                    if (dropEdge !== "after") setDropEdge("after");
                                                }}
                                                onDrop={(e) => {
                                                    e.preventDefault();
                                                    const dragIdFromData = (() => {
                                                        try {
                                                            return e.dataTransfer.getData("text/plain") || "";
                                                        } catch {
                                                            return "";
                                                        }
                                                    })();
                                                    const dragId = draggingId || dragIdFromData;
                                                    if (dragId) moveBlockTo(dragId, END_DROP_ID, "after");

                                                    setDraggingId(null);
                                                    setDragOverId(null);
                                                    setDropEdge("after");
                                                    stopAutoScrollLoop();
                                                }}
                                            >
                                                {dragOverId === END_DROP_ID && (
                                                    <div className="pointer-events-none absolute left-3 right-3 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-brandBlack/70" />
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3 justify-end">
                    <button
                        className="h-11 px-5 rounded-full border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[13px] font-semibold"
                        onClick={onClose}
                        type="button"
                        disabled={isSaving}
                    >
                        Cancel
                    </button>
                    <button
                        className="h-11 px-6 rounded-full border border-[#111827] bg-[#111827] text-white hover:opacity-90 text-[13px] font-semibold disabled:opacity-60"
                        type="button"
                        disabled={isSaving || !studioBlocks.length}
                        onClick={async () => {
                            setIsSaving(true);
                            try {
                                const updates: any = {};
                                const title = String(editTitle || "").trim();
                                if (title !== String(session?.title || "").trim()) updates.title = title;

                                const description = String(editDescription || "").trim();
                                const prevDescription = String(session?.description || "").trim();
                                if (description !== prevDescription) {
                                    updates.description = description || null;
                                }

                                if (editStartLocal) {
                                    try {
                                        const iso = new Date(editStartLocal).toISOString();
                                        if (iso !== session?.start_time) updates.start_time = iso;
                                    } catch { }
                                }

                                if (editMaxParticipants.trim() === "") {
                                    if (session?.max_participants != null) updates.max_participants = null;
                                } else {
                                    const n = Number(editMaxParticipants);
                                    if (Number.isFinite(n) && n > 0 && n !== session?.max_participants) {
                                        updates.max_participants = n;
                                    }
                                }

                                const nextSchedule = exportStudioToSchedule(
                                    studioBlocks,
                                    isInfinite,
                                    session?.start_time || session?.created_at || new Date().toISOString()
                                );
                                updates.schedule = nextSchedule;
                                updates.duration_minutes = studioTotal || null;

                                await onSave(updates);
                            } finally {
                                setIsSaving(false);
                            }
                        }}
                    >
                        {isSaving ? "Saving..." : "Save changes"}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}

export default function SessionCard({
    session,
    userId,
    onBook,
    onCancelBooking,
    onJoin,
    onDelete,
    onEditSession,
    currentUser,
}: SessionCardProps) {
    const navigate = useNavigate();
    const [hostIdOverride, setHostIdOverride] = useState<string | null>(null);

    useEffect(() => {
        setHostIdOverride(null);
    }, [session?.id, session?.host_id]);

    const effectiveHostId = hostIdOverride || session.host_id;
    const isHost = !!userId && effectiveHostId === userId;

    const initialIsBooked =
        !!userId &&
        (
            session.session_bookings?.some((b: any) => b.user_id === userId) ||
            session?.is_booked === true
        );
    const [isBookingConfirmed, setIsBookingConfirmed] = useState<boolean>(!!initialIsBooked);

    const [isHoveringCancel, setIsHoveringCancel] = useState(false);
    const [isHoveringBook, setIsHoveringBook] = useState(false);
    const [isHoveringJoinIframe, setIsHoveringJoinIframe] = useState(false);
    const [isHoveringOptions, setIsHoveringOptions] = useState(false);
    const [isHoveringCard, setIsHoveringCard] = useState(false);

    const CANCEL_HOVER_DELAY_MS = 120;
    const [cancelHoverTimer, setCancelHoverTimer] = useState<number | null>(null);

    const initialBookers = useMemo(() => extractBookers(session), [session]);
    const [bookers, setBookers] = useState<BookedUser[]>(initialBookers);
    const sortedBookingTimeline = useMemo(() => {
        return [...bookers].sort((a, b) => {
            const aStart = Date.parse(String(a.booked_start_time || ""));
            const bStart = Date.parse(String(b.booked_start_time || ""));
            const aValue = Number.isFinite(aStart) ? aStart : Number.POSITIVE_INFINITY;
            const bValue = Number.isFinite(bStart) ? bStart : Number.POSITIVE_INFINITY;
            if (aValue !== bValue) return aValue - bValue;
            return String(a.full_name || a.id).localeCompare(String(b.full_name || b.id));
        });
    }, [bookers]);

    const [stages, setStages] = useState<SessionStage[]>([]);
    const [isStagesLoading, setIsStagesLoading] = useState(false);
    const [liveUsers, setLiveUsers] = useState<BookedUser[]>([]);
    const [isLiveLoading, setIsLiveLoading] = useState(false);
    const [peopleTab, setPeopleTab] = useState<"booked" | "live">("booked");
    const [peopleTabPinned, setPeopleTabPinned] = useState(false);

    const liveIdSet = useMemo(() => new Set(liveUsers.map((u) => u.id)), [liveUsers]);

    useEffect(() => {
        setPeopleTabPinned(false);
    }, [session?.id]);

    const [isBookersModalOpen, setIsBookersModalOpen] = useState(false);
    const [isBookingTimeModalOpen, setIsBookingTimeModalOpen] = useState(false);
    const [bookingDateDraft, setBookingDateDraft] = useState(() => {
        const start = roundDateToNextQuarterHour();
        return toLocalDateInputValue(start);
    });
    const [bookingEndDateDraft, setBookingEndDateDraft] = useState(() => {
        const start = roundDateToNextQuarterHour();
        const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
        return toLocalDateInputValue(end);
    });
    const [bookingStartTimeDraft, setBookingStartTimeDraft] = useState(() => {
        const start = roundDateToNextQuarterHour();
        return toLocalTimeInputValue(start);
    });
    const [bookingEndTimeDraft, setBookingEndTimeDraft] = useState(() => {
        const start = roundDateToNextQuarterHour();
        const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
        return toLocalTimeInputValue(end);
    });
    const [bookingDraftError, setBookingDraftError] = useState("");
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [entitlementState, setEntitlementState] = useState<EntitlementState | null>(null);
    const [paywallOpen, setPaywallOpen] = useState(false);
    const [sessionFullOpen, setSessionFullOpen] = useState(false);

    const [isOptionsOpen, setIsOptionsOpen] = useState(false);
    const optionsRef = useRef<HTMLDivElement | null>(null);

    const [resolvedDescription, setResolvedDescription] = useState<string>(() =>
        typeof session?.description === "string" ? session.description.trim() : ""
    );

    const [copyInviteState, setCopyInviteState] = useState<"idle" | "copied" | "error">("idle");
    const [copyHostState, setCopyHostState] = useState<"idle" | "copied" | "error">("idle");
    const [resolvedHostSlug, setResolvedHostSlug] = useState<string>(() => getEmbeddedHostSlug(session));
    const copyInviteTimerRef = useRef<number | null>(null);
    const copyHostTimerRef = useRef<number | null>(null);
    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            if (!userId) {
                setEntitlementState(null);
                return;
            }

            try {
                const state = await loadEntitlementState();
                if (!cancelled) setEntitlementState(state);
            } catch (e) {
                console.error("[SessionCard] entitlement load failed:", e);
                if (!cancelled) setEntitlementState(null);
            }
        };

        void run();

        return () => {
            cancelled = true;
        };
    }, [userId]);

    const paywallDecision = useMemo(() => {
        if (!entitlementState) return null;

        return getPaywallDecision({
            entitlement: entitlementState.entitlement,
            usage: entitlementState.usage,
        });
    }, [entitlementState]);

    const paywallRuntimeEnabled =
        PAYWALL_ENABLED || isPersonalPaywallForced(entitlementState);

    const paywallBlocked =
        isPersonalPaywallForced(entitlementState)
            ? true
            : paywallRuntimeEnabled && !!paywallDecision?.blocked;

    useEffect(() => setIsBookingConfirmed(!!initialIsBooked), [session.id, initialIsBooked]);
    useEffect(() => setBookers(initialBookers), [initialBookers]);

    useEffect(() => {
        return () => {
            if (cancelHoverTimer) window.clearTimeout(cancelHoverTimer);
        };
    }, [cancelHoverTimer]);

    useEffect(() => {
        return () => {
            if (copyInviteTimerRef.current) {
                window.clearTimeout(copyInviteTimerRef.current);
            }
            if (copyHostTimerRef.current) {
                window.clearTimeout(copyHostTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const embedded = getEmbeddedHostSlug(session);
        if (embedded) {
            setResolvedHostSlug(embedded);
            return;
        }

        const hostId = String(session?.host_id || "").trim();
        if (!hostId) {
            setResolvedHostSlug("");
            return;
        }

        let cancelled = false;

        const run = async () => {
            try {
                const sb = getSupabase();
                if (!sb) return;
                await ensureAuthReady(sb);

                const { data, error } = await sb
                    .from("profiles")
                    .select("host_slug")
                    .eq("id", hostId)
                    .maybeSingle();

                if (error) throw error;
                if (!cancelled) setResolvedHostSlug(String((data as any)?.host_slug || "").trim());
            } catch (e) {
                if (!cancelled) setResolvedHostSlug("");
                console.warn("[SessionCard] host slug load failed:", e);
            }
        };

        void run();

        return () => {
            cancelled = true;
        };
    }, [session?.host_id, session?.host_slug, session?.host_profile?.host_slug]);

    useEffect(() => {
        function onDocClick(e: globalThis.MouseEvent) {
            const t = e.target as any;

            if (isOptionsOpen && optionsRef.current && !optionsRef.current.contains(t)) {
                setIsOptionsOpen(false);
            }

        }
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [isOptionsOpen]);

    useEffect(() => {
        let cancelled = false;

        const immediate =
            typeof session?.description === "string" ? session.description.trim() : "";

        setResolvedDescription(immediate);

        if (immediate || !session?.id) return;

        // PostgREST egress guard:
        // Do not fetch description for every card in the list.
        // Load it only when the user opens details or edit modal.
        if (!isBookersModalOpen && !isEditModalOpen) return;

        (async () => {
            try {
                const text = await fetchSessionDescriptionById(String(session.id));
                if (!cancelled) setResolvedDescription(text);
            } catch {
                if (!cancelled) setResolvedDescription("");
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [session?.id, session?.description, isBookersModalOpen, isEditModalOpen]);

    const sessionType = resolveSessionType(session);
    const isInfinite = sessionType === "infinite";

    useEffect(() => {
        if (!isBookersModalOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setIsBookersModalOpen(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isBookersModalOpen]);

    const bookingTimeRangeString = useMemo(() => {
        const start = session?.start_time ? new Date(session.start_time) : null;
        const durationMinutes = Number(session?.duration_minutes || 0);

        if (!start || Number.isNaN(start.getTime())) {
            return isInfinite ? "Any time — this room is always open" : "Time TBD";
        }

        if (isInfinite) return "Any time — this room is always open";

        const end = durationMinutes > 0
            ? new Date(start.getTime() + durationMinutes * 60_000)
            : null;

        const startText = start.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

        if (!end || Number.isNaN(end.getTime())) return startText;

        const endText = end.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
        });

        return `${startText} — ${endText}`;
    }, [session?.start_time, session?.duration_minutes, isInfinite]);


    const liveCountFromSession: number | null = parseDbCount(
        session?.live_count ??
        session?.liveCount ??
        session?.live_now_count ??
        session?.liveNowCount ??
        null
    );

    const bookedCount = bookers.length;
    const liveUsersCount = liveUsers.length;

    const liveNowDisplay =
        liveCountFromSession != null
            ? Math.max(liveCountFromSession, liveUsersCount)
            : liveUsersCount;

    const liveNowCount = Number.isFinite(liveNowDisplay) ? liveNowDisplay : 0;
    const hasLiveNow = liveNowCount > 0;

    const maxParticipantsRaw = parseDbCount(
        session?.max_participants ??
        session?.maxParticipants ??
        session?.participant_limit ??
        session?.participantLimit ??
        null
    );

    const maxParticipants =
        maxParticipantsRaw != null && Number.isFinite(maxParticipantsRaw) && maxParticipantsRaw > 0
            ? Math.max(1, Math.round(maxParticipantsRaw))
            : null;

    const isSessionFull =
        maxParticipants != null &&
        liveNowCount >= maxParticipants;

    const sessionFullDescription =
        maxParticipants != null
            ? `This session is full right now (${liveNowCount}/${maxParticipants} in session). If someone leaves, you can try joining again.`
            : "This session is full right now. If someone leaves, you can try joining again.";

    const hasStarted = useMemo(() => {
        if (isInfinite) return true;
        if (liveNowCount > 0) return true;

        if (!session?.start_time) return false;
        const t = Date.parse(String(session.start_time));
        if (!Number.isFinite(t)) return false;
        return Date.now() >= t;
    }, [isInfinite, liveNowCount, session?.start_time]);

    const timelineStartTime = useMemo(() => {
        const startedAt = session?.started_at;
        const startTime = session?.start_time;
        const createdAt = session?.created_at;

        const start = startedAt || startTime || createdAt || "";
        if (!start) return String(Date.now());

        if (!startedAt && startTime) {
            const ms = Date.parse(String(startTime));
            if (Number.isFinite(ms) && ms > Date.now()) return String(Date.now());
        }

        return String(start);
    }, [session?.start_time, session?.started_at, session?.created_at]);

    const nameToTypeMap: Record<string, string> = {
        "1 Hour — Pomodoro 15/3": "Short sprints",
        "2 Hours — Pomodoro 15/3": "Short sprints",
        "1 Hour — Pomodoro 25/5": "Pomodoro",
        "2 Hours — Pomodoro 25/5": "Pomodoro",
        "1 Hour — Uninterrupted Focus": "Deep work",
        "2 Hours — 2x 50min Focus Blocks": "Deep work",
    };

    const inferredType = inferTypeFromTitle(session.title);
    const baseResolvedType =
        nameToTypeMap[session.title] || inferredType || session.type || "Deep work";

    const custom = isCustomStudioSession(session);
    const resolvedType = custom ? "Custom session" : baseResolvedType;

    const typeMap: Record<string, { color: string; bg: string; icon: string }> = {
        "Deep work": { color: "#3B82F6", bg: "#E4EDFF", icon: "/icons/deepwork.svg" },
        Pomodoro: { color: "#EF4444", bg: "#FFE4E4", icon: "/icons/pomodoro.svg" },
        "Short sprints": { color: "#22C55E", bg: "#E5FFE9", icon: "/icons/sprints.svg" },
        "Custom session": { color: "#6366F1", bg: "#EEF2FF", icon: "/icons/custom.svg" },
    };

    const t = typeMap[resolvedType] || {
        color: "#111827",
        bg: "#E5E7EB",
        icon: "/icons/deepwork.svg",
    };

    const JOIN_HOVER_BG: Record<string, string> = {
        "Deep work": "#5286F6",
        Pomodoro: "#F65252",
        "Short sprints": "#65D46C",
        "Custom session": "#6366F1",
    };
    const joinHoverBg = JOIN_HOVER_BG[resolvedType] || "#111827";

    const hostCardUser: BookedUser = {
        id: String(session?.host_id || "host"),
        full_name: session?.host_name || session?.host_profile?.full_name || "Host",
        avatar_url:
            session?.host_avatar_url ||
            session?.host_avatar ||
            session?.host_profile?.avatar_url ||
            session?.host_profile?.avatar ||
            session?.profiles?.avatar_url ||
            undefined,
    };

    const startDateString = session.start_time
        ? new Date(session.start_time).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
        : "";

    useEffect(() => {
        let cancelled = false;

        // Stage/timeline data can include large schedule/template JSON, so load
        // and fully normalize it only when the drawer or editor is opened.
        if (!isBookersModalOpen && !isEditModalOpen) {
            setStages([]);
            setIsStagesLoading(false);
            return;
        }

        setIsStagesLoading(true);
        (async () => {
            try {
                const s = await fetchStagesForSession(session);
                if (!cancelled) setStages(Array.isArray(s) ? s : []);
            } catch (e) {
                console.error("[SessionCard] fetchStagesForSession failed:", e);
                if (!cancelled) setStages([]);
            } finally {
                if (!cancelled) setIsStagesLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        session?.id,
        session?.schedule,
        session?.session_template_id,
        session?.template_id,
        isBookersModalOpen,
        isEditModalOpen,
    ]);

    const stagesVisual = useMemo(() => {
        return (stages || []).map((s) => {
            const v = resolveStageVisualLocal(s as any);
            const baseTitle = (s as any)?.title ?? (s as any)?.name ?? (s as any)?.label ?? v.name;

            return {
                ...(s as any),
                title: baseTitle,
                name: v.name,
                kind: v.kind,
                color: v.color,
            } as SessionStage;
        });
    }, [stages]);

    useEffect(() => {
        const sid = String(session?.id || "").trim();
        if (!sid) return;

        const status = safeLower(session?.status);
        const shouldLoadLiveAvatars =
            isInfinite ||
            liveNowCount > 0 ||
            liveCountFromSession != null ||
            status === "active" ||
            status === "live" ||
            status === "started" ||
            status === "in_progress";

        if (!shouldLoadLiveAvatars) {
            setLiveUsers([]);
            return;
        }

        let cancelled = false;
        let inFlight = false;
        let timer: number | undefined;

        const run = async () => {
            if (cancelled || inFlight) return;
            if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

            inFlight = true;
            try {
                const users = await fetchLiveUsers(sid);
                if (!cancelled) setLiveUsers(users || []);
            } catch (e) {
                console.error("[SessionCard] live avatar fetch failed:", e);
                if (!cancelled) setLiveUsers([]);
            } finally {
                inFlight = false;
            }
        };

        void run();

        timer = window.setInterval(() => {
            void run();
        }, 60_000);

        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                void run();
            }
        };

        document.addEventListener("visibilitychange", onVisibilityChange);

        return () => {
            cancelled = true;
            if (timer) window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [
        session?.id,
        session?.status,
        isInfinite,
        liveNowCount,
        liveCountFromSession,
    ]);

    useEffect(() => {
        if (!session?.id) return;
        if (!isBookersModalOpen) return;

        let cancelled = false;

        const run = async () => {
            if (document.visibilityState !== "visible") return;

            setIsLiveLoading(true);
            try {
                const users = await fetchLiveUsers(String(session.id));
                if (!cancelled) setLiveUsers(users || []);
            } catch (e) {
                console.error("[SessionCard] modal fetchLiveUsers failed:", e);
                if (!cancelled) setLiveUsers([]);
            } finally {
                if (!cancelled) setIsLiveLoading(false);
            }
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [session?.id, isBookersModalOpen]);

    useEffect(() => {
        if (peopleTabPinned) return;
        if (hasLiveNow) setPeopleTab("live");
        else setPeopleTab("booked");
    }, [peopleTabPinned, hasLiveNow, session?.id]);

    const ensureCurrentUserAsBooked = (opts?: { booked_start_time?: string | null; booked_end_time?: string | null }) => {
        if (!userId) return;

        const cu: BookedUser = currentUser?.id
            ? {
                id: currentUser.id,
                full_name: currentUser.full_name || "You",
                avatar_url: currentUser.avatar_url,
                booked_start_time: opts?.booked_start_time || null,
                booked_end_time: opts?.booked_end_time || null,
            }
            : {
                id: userId,
                full_name: "You",
                booked_start_time: opts?.booked_start_time || null,
                booked_end_time: opts?.booked_end_time || null,
            };

        setBookers((prev) => {
            const exists = prev.some((u) => u.id === userId);
            if (!exists) return [cu, ...prev];

            return prev.map((u) =>
                u.id === userId
                    ? {
                        ...u,
                        booked_start_time: opts?.booked_start_time ?? u.booked_start_time ?? null,
                        booked_end_time: opts?.booked_end_time ?? u.booked_end_time ?? null,
                    }
                    : u
            );
        });
    };

    const removeCurrentUserFromBooked = () => {
        if (!userId) return;
        setBookers((prev) => prev.filter((u) => u.id !== userId));
    };

    const handleBookSession = () => {
        if (!userId) {
            navigate(buildLoginNext("/sessions"));
            return;
        }

        if (isInfinite) {
            setBookingDraftError("");

            const start = roundDateToNextQuarterHour();
            const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

            setBookingDateDraft(toLocalDateInputValue(start));
            setBookingEndDateDraft(toLocalDateInputValue(end));
            setBookingStartTimeDraft(toLocalTimeInputValue(start));
            setBookingEndTimeDraft(toLocalTimeInputValue(end));
            setIsBookingTimeModalOpen(true);
            setIsHoveringBook(false);
            return;
        }

        onBook(session.id);
        setIsBookingConfirmed(true);
        ensureCurrentUserAsBooked();
        setIsHoveringBook(false);
    };

    const handleConfirmInfiniteBooking = async () => {
        if (!userId) {
            navigate(buildLoginNext("/sessions"));
            return;
        }

        const startIso = combineLocalDateAndTimeToIso(bookingDateDraft, bookingStartTimeDraft);
        const endIso = combineLocalDateAndTimeToIso(bookingEndDateDraft, bookingEndTimeDraft);

        if (!startIso || !endIso) {
            setBookingDraftError("Choose a valid start and end time.");
            return;
        }

        const startMs = new Date(startIso).getTime();
        const endMs = new Date(endIso).getTime();

        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
            setBookingDraftError("End time should be after start time.");
            return;
        }

        setBookingDraftError("");

        await Promise.resolve(onBook(session.id, {
            booked_start_time: startIso,
            booked_end_time: endIso,
            booking_note: null,
        }));

        await persistInfiniteBookingTimeRangeFallback({
            sessionId: session.id,
            userId,
            bookedStartTime: startIso,
            bookedEndTime: endIso,
            bookingNote: null,
        });

        setIsBookingConfirmed(true);
        ensureCurrentUserAsBooked({
            booked_start_time: startIso,
            booked_end_time: endIso,
        });
        setIsBookingTimeModalOpen(false);
        setIsHoveringBook(false);
    };

    const handleCancelBooking = () => {
        if (!userId) return;
        onCancelBooking(session.id);
        setIsBookingConfirmed(false);
        removeCurrentUserFromBooked();
        setIsHoveringCancel(false);
    };

    const handleCopyInviteLink = async () => {
        const url = buildPrettySessionUrl(session, resolvedHostSlug);

        const ok = await copyTextToClipboard(url);

        setCopyInviteState(ok ? "copied" : "error");

        if (copyInviteTimerRef.current) {
            window.clearTimeout(copyInviteTimerRef.current);
        }

        copyInviteTimerRef.current = window.setTimeout(() => {
            setCopyInviteState("idle");
        }, ok ? 2200 : 2600);
    };

    const handleCopyHostLink = async () => {
        const url = buildPrettyHostUrl(resolvedHostSlug);
        if (!url) {
            setCopyHostState("error");
            return;
        }

        const ok = await copyTextToClipboard(url);

        setCopyHostState(ok ? "copied" : "error");

        if (copyHostTimerRef.current) {
            window.clearTimeout(copyHostTimerRef.current);
        }

        copyHostTimerRef.current = window.setTimeout(() => {
            setCopyHostState("idle");
        }, ok ? 2200 : 2600);
    };

    const onEnterBooked = () => {
        if (cancelHoverTimer) window.clearTimeout(cancelHoverTimer);
        const tt = window.setTimeout(() => setIsHoveringCancel(true), CANCEL_HOVER_DELAY_MS);
        setCancelHoverTimer(tt);
    };

    const onLeaveBooked = () => {
        if (cancelHoverTimer) window.clearTimeout(cancelHoverTimer);
        setCancelHoverTimer(null);
        setIsHoveringCancel(false);
    };

    const handleJoinRoom = () => {
        const roomParam = getRoomParam(session);
        if (!roomParam) return;

        const nextPath = buildSessionInvitePath(session);

        // Capacity gate belongs on the card because it is useful before opening the room.
        // Auth gate does NOT belong here anymore: logged-out users should be sent to the
        // room and see the in-room auth modal there.
        if (!isHost && isSessionFull) {
            setSessionFullOpen(true);
            return;
        }

        if (userId && paywallBlocked) {
            setPaywallOpen(true);
            return;
        }

        if (userId) {
            try {
                const idForJoin = session?.id ? String(session.id) : roomParam;
                onJoin(idForJoin);
            } catch { }
        }

        navigate(nextPath);
    };

    const maxStack = 6;

    const liveStackUsers = liveUsers.slice(0, maxStack);
    const liveRemaining = Math.max(0, liveNowCount - liveStackUsers.length);

    const canEdit = isHost && !!onEditSession;
    const canCancelBooking = !!isBookingConfirmed;
    const canCancelSession = isHost;

    const hasPrettySessionSlug = !!getSessionPublicSlug(session);
    const hasHostSlug = !!String(resolvedHostSlug || "").trim();
    const publicSessionUrl = buildPrettySessionUrl(session, resolvedHostSlug);
    const publicSessionUrlLabel = publicSessionUrl.replace(/^https?:\/\//i, "");

    const copyInviteLabel =
        copyInviteState === "copied"
            ? "Copied!"
            : copyInviteState === "error"
                ? "Copy failed"
                : hasPrettySessionSlug
                    ? "Copy session link"
                    : hasHostSlug
                        ? "Copy host link"
                        : "Copy invite link";

    const copyHostLabel =
        copyHostState === "copied"
            ? "Host link copied!"
            : copyHostState === "error"
                ? "Copy failed"
                : "Copy host link";

    const peopleInline = (
        <div className="inline-flex items-center gap-3">
            <button
                type="button"
                onClick={() => {
                    setPeopleTab("live");
                    setPeopleTabPinned(true);
                    setIsBookersModalOpen(true);
                }}
                className="inline-flex items-center gap-2 hover:opacity-80 transition text-left whitespace-nowrap"
                title="People in the session now"
            >
                {liveNowCount === 0 ? (
                    <div className="text-[12px] text-[#606060] whitespace-nowrap">
                        In session: <span className="font-medium">0</span>
                    </div>
                ) : (
                    <>
                        {liveStackUsers.length > 0 && (
                            <div className="hidden md:flex items-center">
                                {liveStackUsers.map((u, idx) => (
                                    <div
                                        key={u.id}
                                        className="relative"
                                        style={{ marginLeft: idx === 0 ? 0 : -10, zIndex: 50 - idx }}
                                    >
                                        <AvatarCircle user={u} size={26} isLive={true} showLiveDot={true} />
                                    </div>
                                ))}
                                {liveRemaining > 0 && (
                                    <div className="relative" style={{ marginLeft: -10, zIndex: 0 }}>
                                        <div
                                            className="rounded-full border border-[#E5E7EB] bg-white flex items-center justify-center text-[10px] font-semibold text-[#111827]"
                                            style={{ width: 26, height: 26 }}
                                            title={`${liveRemaining} more`}
                                        >
                                            +{liveRemaining}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="text-[12px] text-[#606060] font-normal">
                            In session: <span className="font-medium">{liveNowCount}</span>
                        </div>
                    </>
                )}
            </button>

        </div>
    );

    const description = resolvedDescription;

    const scheduleObj = tryParseJson<any>(session?.schedule);
    const cycleSeconds =
        Number((scheduleObj as any)?.timer?.cycleSeconds) ||
        Number((scheduleObj as any)?.timer?.cycle_seconds) ||
        undefined;

    const tickEveryMs = isInfinite ? 15000 : 1000;

    const bookSessionButton = (
        <button
            onClick={handleBookSession}
            aria-label="Book session"
            onMouseEnter={() => setIsHoveringBook(true)}
            onMouseLeave={() => setIsHoveringBook(false)}
            className={`
                h-12 min-w-0 sm:min-w-[160px] rounded-full px-4 sm:px-6 text-[14px] font-semibold
                flex items-center justify-center gap-2
                transition-all duration-200 ease-in-out
                w-auto
                ${isHoveringBook
                    ? "text-[#65D46C] border border-[#65D46C] bg-[#65D46C]/10"
                    : "border border-brandBlack text-brandBlack bg-white"
                }
            `}
        >
            <img
                src={isHoveringBook ? "/icons/book-session-green.svg" : "/icons/book-session.svg"}
                className="w-4 h-4"
                alt=""
            />
            <span className="hidden sm:inline">Book session</span>
        </button>
    );

    const confirmedBookingButton = (
        <button
            aria-label={isInfinite ? "View booking details" : "Booked session"}
            onClick={isInfinite
                ? () => {
                    setPeopleTab("booked");
                    setPeopleTabPinned(true);
                    setIsBookersModalOpen(true);
                }
                : isHoveringCancel
                    ? handleCancelBooking
                    : undefined}
            onMouseEnter={isInfinite ? undefined : onEnterBooked}
            onMouseLeave={isInfinite ? undefined : onLeaveBooked}
            className={`
                h-12 rounded-full text-[14px] font-semibold
                flex items-center justify-center
                transition-all duration-300 ease-in-out
                w-auto
                ${!isInfinite && isHoveringCancel
                    ? "px-6 border border-[#F65252] bg-[#F65252]/5 text-[#F65252]"
                    : "px-5 border border-[#65D46C] bg-[#65D46C]/10 text-[#65D46C]"
                }
            `}
            style={{ willChange: "width, padding" }}
        >
            {!isInfinite && isHoveringCancel ? (
                <>
                    <img src="/icons/cross-cancel.svg" className="w-6 h-6 mr-2" alt="" />
                    Cancel booking
                </>
            ) : (
                <img src="/icons/book-session-green.svg" className="w-6 h-6" alt="" />
            )}
        </button>
    );

    return (
        <>
            <div
                onMouseEnter={() => setIsHoveringCard(true)}
                onMouseLeave={() => setIsHoveringCard(false)}
                onClick={(event) => {
                    const target = event.target as HTMLElement;
                    if (target.closest("button, a, input, select, textarea, [role='button']")) return;
                    setPeopleTab("booked");
                    setIsBookersModalOpen(true);
                }}
                className={`
                    relative
                    border rounded-[42px] bg-white
                    transition-all duration-200
                    border-borderGray
                    hover:bg-[#F6F6F6] hover:border-[#A3A3A3]
                    cursor-pointer
                    p-6
                    flex flex-col
                    w-full gap-4
                    ${isOptionsOpen ? "z-[220]" : "z-0"}
                `}
            >
                <div className="flex flex-col xl:flex-row w-full gap-6">
                    <div className="flex min-w-0 flex-1 items-stretch justify-between gap-4">
                        <Link
                            to={`/profile/${session.host_id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="shrink-0 self-start rounded-full transition hover:scale-[1.03] hover:opacity-90"
                            title={`View ${session.host_name || "host"}'s profile`}
                            aria-label={`View ${session.host_name || "host"}'s profile`}
                        >
                            <AvatarCircle user={hostCardUser} size={68} isLive={false} showLiveDot={false} />
                        </Link>

                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-3">
                                <h3 className="flex min-w-0 items-center gap-2 text-[24px] md:text-[29px] font-bold leading-tight">
                                    {session?.is_private && (
                                        <Lock
                                            size={22}
                                            className="shrink-0 text-[#606060]"
                                            aria-label="Private session"
                                        />
                                    )}
                                    <span className="min-w-0 break-words">{session.title}</span>
                                </h3>

                            </div>

                            <div className="flex flex-wrap items-center gap-4 text-[12px] text-[#606060]">
                                <div className={isInfinite ? "hidden min-[481px]:flex items-center gap-1" : "flex items-center gap-1"}>
                                    <img src="/icons/duration.svg" className="w-4 h-4 opacity-70" alt="" />
                                    <span>{isInfinite ? "Infinite" : `${session.duration_minutes} min`}</span>
                                </div>

                                {!isInfinite && (
                                    <div className="flex items-center gap-1">
                                        <img src="/icons/date.svg" className="w-4 h-4 opacity-70" alt="" />
                                        <span>{startDateString}</span>
                                    </div>
                                )}

                                <div className="inline-flex items-center gap-3">
                                    <div
                                        className="hidden min-[481px]:inline-flex items-center gap-1 px-3 py-1 rounded-full border"
                                        style={{
                                            backgroundColor: isHoveringCard ? t.color : t.bg,
                                            color: isHoveringCard ? "white" : t.color,
                                            borderColor: t.color,
                                            fontSize: 10,
                                            fontWeight: 500,
                                        }}
                                    >
                                        <img
                                            src={
                                                isHoveringCard
                                                    ? t.icon.endsWith(".svg")
                                                        ? t.icon.replace(".svg", "-white.svg")
                                                        : t.icon
                                                    : t.icon
                                            }
                                            className="w-4 h-4"
                                            alt=""
                                            onError={(e) => {
                                                const img = e.currentTarget as HTMLImageElement;
                                                img.src = "/icons/deepwork.svg";
                                            }}
                                        />
                                        {resolvedType}
                                    </div>

                                    {peopleInline}

                                    <button
                                        type="button"
                                        className="flex h-8 items-center justify-center gap-1.5 px-1 text-[12px] font-normal text-[#606060] transition hover:text-[#303030]"
                                        title="Session details"
                                        aria-label="Session details"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setPeopleTab("booked");
                                            setIsBookersModalOpen(true);
                                        }}
                                    >
                                        <IconInfo size={15} />
                                        <span>Details</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="hidden xl:flex items-center gap-6">
                            <div className="w-px h-10 bg-[#D9D9D9]" />
                            <div className="text-center">
                                <div className="text-[32px] font-bold text-brandBlack">
                                    {liveNowCount}
                                </div>
                                <div className="min-w-[68px] text-[10px] leading-[1.15] text-[#606060] font-light">
                                    {hasLiveNow ? (
                                        <>
                                            <span className="block whitespace-nowrap">in the session</span>
                                            <span className="block">now</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="block">live count</span>
                                            <span className="block">soon</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_48px] items-center gap-3 min-[769px]:flex min-[769px]:justify-end xl:min-w-[420px] xl:w-auto">
                        {isBookingConfirmed ? confirmedBookingButton : bookSessionButton}

                        <button
                            onClick={handleJoinRoom}
                            onMouseEnter={() => setIsHoveringJoinIframe(true)}
                            onMouseLeave={() => setIsHoveringJoinIframe(false)}
                            className="
                                h-12 rounded-full px-6 text-[14px] font-semibold
                                flex items-center justify-center
                                transition-all duration-200 ease-in-out
                                w-full min-[769px]:flex-1 xl:w-auto xl:flex-none xl:min-w-[160px]
                                border
                            "
                            style={{
                                borderColor: isHoveringJoinIframe ? joinHoverBg : "#111827",
                                color: isHoveringJoinIframe ? "white" : "#111827",
                                backgroundColor: isHoveringJoinIframe ? joinHoverBg : "transparent",
                            }}
                        >
                            Join session
                        </button>

                        <div ref={optionsRef} className={`relative w-12 ${isOptionsOpen ? "z-[230]" : "z-0"}`}>
                            <button
                                type="button"
                                onClick={() => setIsOptionsOpen((v) => !v)}
                                onMouseEnter={() => setIsHoveringOptions(true)}
                                onMouseLeave={() => setIsHoveringOptions(false)}
                                className="
                                    h-12 w-12
                                    rounded-full border
                                    flex items-center justify-center
                                    transition-all duration-200 ease-in-out
                                "
                                title="Options"
                                aria-label="Options"
                                style={{
                                    borderColor: isHoveringOptions ? joinHoverBg : "#111827",
                                    color: isHoveringOptions ? "white" : "#111827",
                                    backgroundColor: isHoveringOptions ? joinHoverBg : "transparent",
                                }}
                            >
                                <OptionsSmartIcon hovered={isHoveringOptions} size={18} />
                            </button>

                            {isOptionsOpen && (
                                <div
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    className="
                                        absolute right-0 top-[52px]
                                        z-[9990]
                                        w-[260px]
                                        rounded-[18px]
                                        border border-[#E5E7EB]
                                        bg-white
                                        shadow-xl
                                        overflow-hidden
                                    "
                                >
                                    <div className="px-4 py-3 text-[12px] text-[#606060] border-b border-[#F3F4F6]">
                                        Session options
                                    </div>

                                    <div className="p-2 flex flex-col gap-1">
                                        <MenuItem
                                            icon={
                                                copyInviteState === "copied"
                                                    ? <IconCheckSuccess />
                                                    : <IconCopy />
                                            }
                                            label={copyInviteLabel}
                                            outlined
                                            success={copyInviteState === "copied"}
                                            onClick={handleCopyInviteLink}
                                        />

                                        {hasPrettySessionSlug && hasHostSlug && (
                                            <MenuItem
                                                icon={
                                                    copyHostState === "copied"
                                                        ? <IconCheckSuccess />
                                                        : <IconCopy />
                                                }
                                                label={copyHostLabel}
                                                outlined
                                                success={copyHostState === "copied"}
                                                onClick={handleCopyHostLink}
                                            />
                                        )}

                                        <div className="mt-1 rounded-[12px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
                                            <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                                                Public link
                                            </div>
                                            <div
                                                className="mt-1 truncate font-mono text-[12px] text-[#111827]"
                                                title={publicSessionUrl}
                                            >
                                                {publicSessionUrlLabel}
                                            </div>
                                        </div>

                                        {canEdit && (
                                            <MenuItem
                                                icon={<IconEdit />}
                                                label="Edit…"
                                                outlined
                                                onClick={() => {
                                                    setIsOptionsOpen(false);
                                                    setIsEditModalOpen(true);
                                                }}
                                            />
                                        )}

                                        {canCancelBooking && (
                                            <MenuItem
                                                icon={<IconCancel />}
                                                label="Cancel booking"
                                                danger
                                                onClick={() => {
                                                    setIsOptionsOpen(false);
                                                    handleCancelBooking();
                                                }}
                                            />
                                        )}

                                        {canCancelSession && (
                                            <MenuItem
                                                icon={<IconTrash />}
                                                label="Cancel session"
                                                danger
                                                onClick={() => {
                                                    setIsOptionsOpen(false);
                                                    onDelete(session.id);
                                                }}
                                            />
                                        )}

                                        {!canEdit && !canCancelBooking && !canCancelSession && (
                                            <div className="px-3 py-2 text-[12px] text-[#606060]">
                                                No actions available
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <ModalShell
                title="Book your focus time"
                isOpen={isBookingTimeModalOpen}
                onClose={() => setIsBookingTimeModalOpen(false)}
                widthClass="max-w-[500px]"
            >
                <div className="space-y-4">
                    <div className="rounded-[18px] border border-[#DBEAFE] bg-[#EFF6FF] px-4 py-3 text-[13px] leading-5 text-[#1E3A8A]">
                        Choose when you plan to use this 24/7 room. The room stays open, but your booking helps others see when people are planning to focus.
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1.5">
                            <span className="text-[12px] font-semibold text-[#606060]">Start date</span>
                            <input
                                type="date"
                                value={bookingDateDraft}
                                onChange={(e) => setBookingDateDraft(e.target.value)}
                                className="h-11 rounded-[14px] border border-[#E5E7EB] px-3 text-[13px] outline-none focus:border-[#111827]"
                            />
                        </label>

                        <label className="flex flex-col gap-1.5">
                            <span className="text-[12px] font-semibold text-[#606060]">Start time</span>
                            <input
                                type="time"
                                value={bookingStartTimeDraft}
                                onChange={(e) => setBookingStartTimeDraft(e.target.value)}
                                className="h-11 rounded-[14px] border border-[#E5E7EB] px-3 text-[13px] outline-none focus:border-[#111827]"
                            />
                        </label>

                        <label className="flex flex-col gap-1.5">
                            <span className="text-[12px] font-semibold text-[#606060]">End date</span>
                            <input
                                type="date"
                                value={bookingEndDateDraft}
                                onChange={(e) => setBookingEndDateDraft(e.target.value)}
                                className="h-11 rounded-[14px] border border-[#E5E7EB] px-3 text-[13px] outline-none focus:border-[#111827]"
                            />
                        </label>

                        <label className="flex flex-col gap-1.5">
                            <span className="text-[12px] font-semibold text-[#606060]">End time</span>
                            <input
                                type="time"
                                value={bookingEndTimeDraft}
                                onChange={(e) => setBookingEndTimeDraft(e.target.value)}
                                className="h-11 rounded-[14px] border border-[#E5E7EB] px-3 text-[13px] outline-none focus:border-[#111827]"
                            />
                        </label>
                    </div>

                    {bookingDraftError ? (
                        <div className="rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                            {bookingDraftError}
                        </div>
                    ) : null}

                    <div className="rounded-[16px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[12px] text-[#606060]">
                        Preview: <span className="font-semibold text-[#111827]">
                            {formatBookingRangeFromIso(
                                combineLocalDateAndTimeToIso(bookingDateDraft, bookingStartTimeDraft),
                                combineLocalDateAndTimeToIso(bookingEndDateDraft, bookingEndTimeDraft)
                            )}
                        </span>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                        <button
                            type="button"
                            onClick={() => setIsBookingTimeModalOpen(false)}
                            className="h-11 flex-1 rounded-full border border-[#111827] bg-white px-4 text-[14px] font-semibold text-[#111827] transition hover:bg-[#F3F4F6]"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleConfirmInfiniteBooking()}
                            className="h-11 flex-1 rounded-full bg-[#111827] px-4 text-[14px] font-semibold text-white transition hover:bg-[#2F2F2F]"
                        >
                            Book this time
                        </button>
                    </div>
                </div>
            </ModalShell>

            {isBookersModalOpen ? (
                <div className="fixed inset-0 z-[950] flex justify-end" role="dialog" aria-modal="true" aria-label="Session details">
                    <button
                        type="button"
                        className="session-booking-drawer-backdrop absolute inset-0 bg-black/30 backdrop-blur-[2px]"
                        aria-label="Close session details"
                        onClick={() => setIsBookersModalOpen(false)}
                    />

                    <aside className="session-booking-drawer relative flex h-full w-full max-w-[460px] flex-col border-l border-[#E5E7EB] bg-white shadow-[-18px_0_60px_rgba(17,24,39,0.14)]">
                        <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] px-5 py-5">
                            <div>
                                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#65A96A]">
                                    {isInfinite ? "Infinite room" : resolvedType}
                                </div>
                                <h3 className="mt-1 text-[22px] font-bold leading-tight text-[#111827]">{session.title}</h3>
                                <p className="mt-1 text-[12px] leading-5 text-[#606060]">
                                    {isInfinite ? "Always open · book the focus window that works for you." : bookingTimeRangeString}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsBookersModalOpen(false)}
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E5E7EB] text-[24px] leading-none text-[#606060] transition hover:bg-[#F3F4F6] hover:text-[#111827]"
                                aria-label="Close session details"
                            >
                                ×
                            </button>
                        </div>

                        <div className="border-b border-[#E5E7EB] px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#606060]">
                                <Link to={`/profile/${session.host_id}`} onClick={() => setIsBookersModalOpen(false)} className="inline-flex items-center gap-2.5 rounded-full border border-[#E5E7EB] bg-white py-1.5 pl-1.5 pr-3 transition hover:border-[#BFC8C0] hover:bg-[#F8FAF8]">
                                    <AvatarCircle user={hostCardUser} size={32} isLive={false} showLiveDot={false} />
                                    <span><span className="text-[#7A7A7A]">Hosted by</span> <strong className="font-semibold text-[#111827]">{session.host_name}</strong></span>
                                </Link>
                                <span className="rounded-full bg-[#F3F4F6] px-3 py-1.5 font-medium text-[#111827]">
                                    {isInfinite ? "24/7 room" : `${session.duration_minutes} min`}
                                </span>
                            </div>

                            <p className="mt-4 whitespace-pre-wrap text-[13px] leading-5 text-[#334155]">
                                {description || "No description yet."}
                            </p>

                            <div className="mt-5 rounded-[18px] border border-[#E8EBE8] bg-[#FAFBFA] px-3 py-3">
                                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#7A7A7A]">Session timeline</div>
                                {stagesVisual?.length ? (
                                    <SessionStageBar
                                        {...({
                                            stages: stagesVisual,
                                            startTime: timelineStartTime,
                                            cycleSeconds,
                                            progressStyle: "tick",
                                            tickEveryMs,
                                        } as any)}
                                    />
                                ) : (
                                    <div className="text-[11px] text-[#8A8A8A]">
                                        {isStagesLoading ? "Loading session stages…" : "No timeline stages configured."}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="border-b border-[#E5E7EB] px-5 py-4">
                            <div className="flex items-center justify-between rounded-[18px] bg-[#F3F8F3] px-4 py-3">
                                <div>
                                    <div className="text-[12px] text-[#606060]">Planned participants</div>
                                    <div className="mt-0.5 text-[18px] font-bold text-[#111827]">{bookedCount}</div>
                                </div>
                                <div className="text-right text-[12px] text-[#606060]">
                                    <div>{liveNowCount} currently online</div>
                                    <div className="mt-1 font-semibold text-[#65A96A]">Times shown locally</div>
                                </div>
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                            <div className="mb-4 flex items-center justify-between">
                                <div>
                                    <div className="text-[15px] font-bold text-[#111827]">Who booked</div>
                                    <div className="mt-0.5 text-[11px] text-[#7A7A7A]">
                                        {isInfinite ? "Planned focus windows are shown in your local time." : "Participants planning to attend this session."}
                                    </div>
                                </div>
                            </div>
                            {sortedBookingTimeline.length === 0 ? (
                                <div className="rounded-[20px] border border-dashed border-[#D1D5DB] px-5 py-8 text-center">
                                    <div className="text-[15px] font-semibold text-[#111827]">No bookings yet</div>
                                    <div className="mt-1 text-[12px] leading-5 text-[#606060]">Be the first person to book this session.</div>
                                </div>
                            ) : (
                                <div className="relative pl-7">
                                    <div className="absolute bottom-4 left-[9px] top-4 w-px bg-[#DDE7DE]" />
                                    <div className="flex flex-col gap-4">
                                        {sortedBookingTimeline.map((booking) => {
                                            const label = booking.full_name || booking.id || "Participant";
                                            const isLive = liveIdSet.has(booking.id);
                                            const isCurrentUser = booking.id === userId;
                                            const start = booking.booked_start_time ? new Date(booking.booked_start_time) : null;
                                            const hasStart = !!start && !Number.isNaN(start.getTime());

                                            return (
                                                <div key={booking.id} className="relative">
                                                    <div className={`absolute -left-7 top-5 h-[11px] w-[11px] rounded-full border-2 border-white ring-1 ${isLive ? "bg-[#65D46C] ring-[#65D46C]" : "bg-[#A7CDAA] ring-[#A7CDAA]"}`} />
                                                    <Link
                                                        to={`/profile/${booking.id}`}
                                                        onClick={() => setIsBookersModalOpen(false)}
                                                        className={`block rounded-[20px] border px-4 py-3 transition hover:-translate-y-0.5 hover:shadow-sm ${isCurrentUser ? "border-[#81DB86] bg-[#F3FBF3]" : "border-[#E5E7EB] bg-white hover:border-[#BFD8C1]"}`}
                                                    >
                                                        <div className="flex items-start gap-3">
                                                            <AvatarCircle user={booking} size={38} isLive={isLive} showLiveDot={true} />
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <div className="truncate text-[13px] font-bold text-[#111827]">
                                                                        {isCurrentUser ? `${label} (you)` : label}
                                                                    </div>
                                                                    {isLive ? <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[#49A650]">Online</span> : null}
                                                                </div>
                                                                <div className="mt-1 text-[12px] font-semibold text-[#334155]">
                                                                    {isInfinite
                                                                        ? hasStart
                                                                            ? formatBookingRangeFromIso(booking.booked_start_time, booking.booked_end_time)
                                                                            : "Booking time not specified"
                                                                        : bookingTimeRangeString}
                                                                </div>
                                                                {hasStart ? (
                                                                    <div className="mt-1 text-[11px] text-[#7A7A7A]">
                                                                        {start!.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    </Link>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>

                        {isBookingConfirmed ? (
                            <div className="border-t border-[#E5E7EB] p-5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        handleCancelBooking();
                                        setIsBookersModalOpen(false);
                                    }}
                                    className="h-11 w-full rounded-full border border-[#F65252] bg-[#FFF7F7] text-[13px] font-semibold text-[#D83F3F] transition hover:bg-[#FFEDED]"
                                >
                                    Cancel my booking
                                </button>
                            </div>
                        ) : null}
                    </aside>
                </div>
            ) : null}

            {isEditModalOpen && onEditSession && (
                <EditSessionStudioModal
                    isOpen={isEditModalOpen}
                    onClose={() => setIsEditModalOpen(false)}
                    session={{
                        ...session,
                        host_id: effectiveHostId,
                        description: resolvedDescription,
                    }}
                    currentUserId={userId}
                    hostCandidates={uniqueHostTransferCandidates([
                        ...bookers.map((u) => ({
                            id: u.id,
                            full_name: u.full_name || null,
                            avatar_url: u.avatar_url || null,
                        })),
                        ...liveUsers.map((u) => ({
                            id: u.id,
                            full_name: u.full_name || null,
                            avatar_url: u.avatar_url || null,
                        })),
                        currentUser?.id
                            ? {
                                id: currentUser.id,
                                full_name: currentUser.full_name || "You",
                                avatar_url: currentUser.avatar_url || null,
                                email: currentUser.email || null,
                            }
                            : null,
                    ].filter(Boolean) as HostTransferCandidate[])}
                    onHostTransferred={(newHost) => {
                        setHostIdOverride(newHost.id);
                        window.setTimeout(() => {
                            setIsEditModalOpen(false);
                        }, 650);
                    }}
                    onSave={async (updates) => {
                        await onEditSession(session.id, updates);

                        setResolvedDescription(
                            updates.description == null
                                ? ""
                                : String(updates.description || "").trim()
                        );

                        _sessionDescriptionById.set(
                            String(session.id),
                            updates.description == null ? "" : String(updates.description || "").trim()
                        );

                        _sessionExtrasById.delete(String(session.id));
                        _stagesBySessionId.delete(String(session.id));

                        if (updates.schedule !== undefined) {
                            const nextStages = tryStagesFromSchedule(updates.schedule);
                            setStages(Array.isArray(nextStages) ? nextStages : []);
                        }

                        setIsEditModalOpen(false);
                    }}
                />
            )}

            <ModalShell
                title="Session is full"
                isOpen={sessionFullOpen}
                onClose={() => setSessionFullOpen(false)}
                widthClass="max-w-[460px]"
            >
                <div className="space-y-4">
                    <div className="rounded-[18px] border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-[14px] leading-6 text-[#92400E]">
                        <div className="font-bold text-[#78350F]">Participant limit reached</div>
                        <div className="mt-1">{sessionFullDescription}</div>
                    </div>

                    <div className="rounded-[18px] border border-[#E5E7EB] bg-white px-4 py-3">
                        <div className="text-[13px] font-semibold text-[#111827]">
                            {String(session?.title || "This session")}
                        </div>
                        <div className="mt-1 text-[12px] leading-5 text-[#606060]">
                            You can wait a little and try again, or choose another available session.
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                        <button
                            type="button"
                            onClick={() => setSessionFullOpen(false)}
                            className="h-11 flex-1 rounded-full border border-[#111827] bg-white px-4 text-[14px] font-semibold text-[#111827] transition hover:bg-[#F3F4F6]"
                        >
                            Stay here
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setSessionFullOpen(false);
                                navigate("/sessions");
                            }}
                            className="h-11 flex-1 rounded-full bg-[#111827] px-4 text-[14px] font-semibold text-white transition hover:bg-[#2F2F2F]"
                        >
                            Find another session
                        </button>
                    </div>
                </div>
            </ModalShell>

            <PaywallModal
                open={paywallOpen}
                onClose={() => setPaywallOpen(false)}
                title="Upgrade to join sessions"
                description="You’ve reached the current Free plan limit. Upgrade to Pro to keep joining sessions."
            />
        </>
    );
}
