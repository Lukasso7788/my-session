import {
    useEffect,
    useMemo,
    useRef,
    useState,
    useCallback,
    useLayoutEffect,
    type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Layers, ArrowUp, ArrowDown, Trash2, RotateCcw, Eraser, Search, Crown, UserCheck, Lock, Eye, EyeOff, Pin, PinOff, MessageSquareOff } from "lucide-react";
import { MonitorUp, MicOff, Link2, Check as CheckIcon, X as XIcon, Plus as PlusIcon, GripVertical, ChevronDown as ChevronDownIcon, Copy as CopyIcon } from "lucide-react";
import { SessionStageBar } from "./SessionStageBar";
import { supabase } from "../lib/supabase";
import { isFreeFlowSchedule } from "../lib/freeFlowSession";
import {
    loadEntitlementState,
    isPersonalPaywallForced,
    type EntitlementState,
} from "../lib/entitlements";
import { getPaywallDecision } from "../lib/paywall";
import PaywallModal from "./PaywallModal";
import type { SessionStage } from "../SessionConfig";
import { readSessionRoomPolicies, withRoomPolicies } from "../lib/roomPolicies";
import { CHECK_IN_BREAK_TITLE, INTENTIONS_COLOR, isCheckInBreakName } from "../lib/checkInBreak";
import SessionRoomPolicyIndicator from "./SessionRoomPolicyIndicator";
import SessionMusicIndicator from "./SessionMusicIndicator";
import { profileHoverAttrs } from "./ProfileHoverLayer";
import { getSessionCardPolicyState } from "../lib/sessionCardIndicators";
import { SERIES_WINDOW_DAYS, type SeriesOccurrence } from "../lib/sessionSeries";
import { CursorEditHintArea, InlineEditableStart, InlineEditableTitle } from "./SessionInlineEdit";
import GuestBlur, { GUEST_BLUR_HINT } from "./GuestBlur";
import HostTimePicker from "./HostTimePicker";
import { HOST_DEFAULT_DURATION_MINUTES, hostWindowFromDraft, type HostBusyWindow } from "../lib/hostTimePicker";

let roomPagePrefetchPromise: Promise<unknown> | null = null;
function prefetchRoomPage() {
    // Warm the LiveKit route only when the visitor is about to join a room.
    // A failed download can be retried on the next interaction.
    roomPagePrefetchPromise ??= import("../pages/RoomPageLiveKit").catch(() => {
        roomPagePrefetchPromise = null;
    });
}

function getSupabase(): SupabaseClient | null {
    // SessionCard must use the same client and auth storage key as the rest of
    // the app. Creating a second client here used the default Supabase storage
    // key instead of `mysession-auth`, so requests were sent without the active
    // user's JWT even while the app correctly showed the user as signed in.
    return supabase;
}

type BookSessionOptions = {
    booked_start_time?: string | null;
    booked_end_time?: string | null;
    booking_note?: string | null;
    booking_role?: "participant" | "host";
};

interface SessionCardProps {
    session: any;
    musicPlaying?: boolean;
    userId?: string;

    onBook: (sessionId: string, opts?: BookSessionOptions) => boolean | Promise<boolean>;
    onCancelBooking: (sessionId: string) => void;
    // Upcoming occurrences of the same series (this session included), when
    // it repeats within the next week.
    seriesOccurrences?: SeriesOccurrence[];
    onBookSeries?: (sessionIds: string[]) => Promise<string[]>;
    // Extra days of a "host every day" booking in an infinite room.
    onBookHostSlots?: (
        sessionId: string,
        slots: Array<{ starts_at: string; ends_at: string }>
    ) => Promise<"ok" | "unavailable" | "error">;
    onCancelSeries?: (sessionIds: string[]) => Promise<boolean>;
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
            camera_required?: boolean;
            screen_share_required?: boolean;
            public_chat_disabled?: boolean;
        }
    ) => void | Promise<any>;

    onInviteToSession?: (
        sessionId: string,
        payload: { email: string; message?: string }
    ) => void | Promise<any>;

    onHostTransferComplete?: () => void | Promise<void>;
    canManageAnySession?: boolean;
    onVisibilityChange?: (sessionId: string, hidden: boolean) => void | Promise<void>;
    onPinnedChange?: (sessionId: string, pinned: boolean) => void | Promise<void>;

    currentUser?: {
        id: string;
        full_name?: string;
        avatar_url?: string;
        email?: string;
    };
}

type BookedUser = { id: string; full_name?: string; avatar_url?: string; created_at?: string | null; booked_start_time?: string | null; booked_end_time?: string | null; booking_role?: "participant" | "host" };
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
                booking_role: b?.booking_role === "host" ? "host" : "participant",
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

async function persistInfiniteBookingTimeRangeFallback(args: {
    sessionId: string;
    userId: string;
    bookedStartTime: string;
    bookedEndTime: string;
    bookingNote?: string | null;
    bookingRole: "participant" | "host";
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
            booking_role: args.bookingRole,
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
                    booking_role: args.bookingRole,
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
    }

    if (safeLower(session?.format) === "infinite") return "infinite";
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
        <div className="relative" style={{ width: size, height: size }} title={user?.id ? undefined : label} {...profileHoverAttrs(user?.id, user?.full_name)}>
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

const DRAWER_BOOKERS_PREVIEW = 12;
const DRAWER_LIVE_PREVIEW = 12;

// Session details tiles: "type" uses the session type's colors (set inline),
// "on" is green, "rule" is a blue requirement, "off" is gray.
type DrawerDetailTone = "type" | "neutral" | "on" | "rule" | "off";
type DrawerDetail = {
    key: string;
    label: string;
    value: string;
    sub?: string;
    tone: DrawerDetailTone;
    icon: ReactNode;
    meter?: number;
};
const DETAIL_TONE_CLASSES: Record<DrawerDetailTone, string> = {
    type: "",
    neutral: "bg-[#F3F4F6] text-[#2F2F2F]",
    on: "bg-[#65D46C]/15 text-[#2F8F35]",
    rule: "bg-[#EEF3FE] text-[#3F6FD8]",
    off: "bg-[#F6F6F6] text-[#A3A3A3]",
};

// The room's own control icons (bottom bar, people panel), tinted with the chip's color.
function RoomIcon({ src, size = 15 }: { src: string; size?: number }) {
    const mask = `url('${src}') center / contain no-repeat`;
    return <span className="block shrink-0" style={{ width: size, height: size, backgroundColor: "currentColor", mask, WebkitMask: mask }} />;
}

// Keeps only the details that are switched on (falsy entries are dropped).
function optionalDetails(details: Array<DrawerDetail | false | null | undefined>): DrawerDetail[] {
    return details.filter((detail): detail is DrawerDetail => !!detail);
}

function formatStartsIn(ms: number): string {
    if (!Number.isFinite(ms)) return "Upcoming";
    const minutes = Math.round(ms / 60_000);
    if (minutes < 1) return "Starting now";
    if (minutes < 60) return `Starts in ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `Starts in ${hours} h`;
    const days = Math.round(hours / 24);
    return `Starts in ${days} day${days === 1 ? "" : "s"}`;
}

function ModalShell({
    title,
    isOpen,
    onClose,
    children,
    footer,
    widthClass = "max-w-[560px]",
}: {
    title: string;
    isOpen: boolean;
    onClose: () => void;
    children: any;
    footer?: any;
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
                    <div className="p-5 overflow-y-auto flex-1">{children}</div>
                    {footer ? (
                        <div className="shrink-0 border-t border-[#EEEEEE] bg-white px-5 py-4">
                            {footer}
                        </div>
                    ) : null}
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
    if (isCheckInBreakName(name)) {
        return { kind: "checkin" as StageKind, name: CHECK_IN_BREAK_TITLE, color: INTENTIONS_COLOR };
    }
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
    newHostName?: string | null;
    canManageAnySession?: boolean;
}): Promise<void> {
    const sessionId = String(args.sessionId || "").trim();
    const newHostId = String(args.newHostId || "").trim();
    const newHostName = String(args.newHostName || "").trim() || "Host";

    if (!sessionId || !newHostId) {
        throw new Error("Missing session or new host id.");
    }

    const sb = getSupabase();
    if (!sb) throw new Error("Supabase is not configured.");

    await ensureAuthReady(sb);

    if (args.canManageAnySession) {
        const { data: updated, error: updateError } = await sb
            .from("sessions")
            .update({ host_id: newHostId, host_name: newHostName })
            .eq("id", sessionId)
            .select("id, host_id")
            .maybeSingle();

        if (updateError) throw updateError;
        if (!updated || String(updated.host_id || "") !== newHostId) {
            throw new Error("Super-admin host transfer was blocked by database policy.");
        }
        return;
    }

    const { error: rpcError } = await sb.rpc("transfer_session_host_rights", {
        p_session_id: sessionId,
        p_new_host_id: newHostId,
    });

    if (!rpcError) return;

    const rpcErrorCode = String((rpcError as any)?.code || "").toUpperCase();
    const rpcErrorMessage = String((rpcError as any)?.message || "").toLowerCase();
    const rpcIsMissing =
        rpcErrorCode === "PGRST202" ||
        rpcErrorCode === "42883" ||
        rpcErrorMessage.includes("could not find the function") ||
        rpcErrorMessage.includes("function public.transfer_session_host_rights") &&
            rpcErrorMessage.includes("does not exist");

    if (!rpcIsMissing) throw rpcError;

    // Compatibility path for deployments where the migration has not reached
    // Supabase yet. The host_id guard makes this an atomic owner-only transfer;
    // select() also lets us detect an RLS-blocked zero-row update.
    const { data: authData, error: authError } = await sb.auth.getUser();
    if (authError) throw authError;

    const currentUserId = String(authData?.user?.id || "").trim();
    if (!currentUserId) throw new Error("You must be signed in to transfer host rights.");

    const { data: updated, error: updateError } = await sb
        .from("sessions")
        .update({
            host_id: newHostId,
            host_name: newHostName,
        })
        .eq("id", sessionId)
        .eq("host_id", currentUserId)
        .select("id, host_id")
        .maybeSingle();

    if (updateError) throw updateError;
    if (!updated || String(updated.host_id || "") !== newHostId) {
        throw new Error("Host transfer was blocked. Only the current host can transfer this session.");
    }
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
            // Check-ins share the Intentions color.
            return INTENTIONS_COLOR;
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
    if (isCheckInBreakName(block?.title ?? block?.name)) return INTENTIONS_COLOR;
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
    // Older sessions saved "Break & check-in" in the break color; editors show
    // the canonical "Check-in & break" in the Intentions color (and save it so).
    return readStudioBlocksFromSession(session).map((block) =>
        isCheckInBreakName(block.title)
            ? { ...block, title: CHECK_IN_BREAK_TITLE, color: INTENTIONS_COLOR }
            : block
    );
}

function readStudioBlocksFromSession(session: any): StudioBlock[] {
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

/**
 * Timeline editing for hosts, opened by double-clicking a session's timeline.
 * It does everything the full timeline editor does (reorder, resize, rename,
 * change kind, minutes, note, color, duplicate, add, remove) in a compact
 * panel: a segment bar on top (drag or ← → to reorder, pull a segment's right
 * edge to resize) and the blocks as rows below (drag by the grip to reorder,
 * open a row for the rest). It saves the schedule the same way the full
 * editor does, keeping the room policies.
 */
function QuickTimelineEditor({
    session,
    stages,
    isLoading,
    isInfinite,
    variant,
    onSave,
    onClose,
    onOpenFullEditor,
}: {
    session: any;
    stages: any[];
    isLoading: boolean;
    isInfinite: boolean;
    variant: "popover" | "inline";
    onSave: (updates: { schedule: any; duration_minutes: number | null }) => Promise<unknown> | void;
    onClose: () => void;
    onOpenFullEditor: () => void;
}) {
    const [blocks, setBlocks] = useState<StudioBlock[] | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    // Bar and list drags share one "being dragged" id; rows only drag from their grip.
    const [dragId, setDragId] = useState<string | null>(null);
    const [gripArmedId, setGripArmedId] = useState<string | null>(null);
    const barRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (blocks || isLoading) return;
        setBlocks(normalizeStudioBlocksFromSession({ ...session, session_stages: stages.length ? stages : session?.session_stages }));
    }, [blocks, isLoading, session, stages]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const list = blocks || [];
    const total = list.reduce((sum, block) => sum + (Number(block.minutes) || 0), 0);

    const setList = (next: StudioBlock[]) => setBlocks(next);
    const update = (id: string, patch: Partial<StudioBlock>) =>
        setBlocks((current) => (current || []).map((block) => (block.id === id ? { ...block, ...patch } : block)));
    const setMinutes = (id: string, minutes: number) => update(id, { minutes: clamp(Math.round(minutes) || 1, 1, 24 * 60) });
    const moveTo = (id: string, toIndex: number) => {
        const from = list.findIndex((block) => block.id === id);
        if (from < 0 || toIndex < 0 || toIndex >= list.length || from === toIndex) return;
        const copy = [...list];
        const [item] = copy.splice(from, 1);
        copy.splice(toIndex, 0, item);
        setList(copy);
    };
    const moveBy = (id: string, delta: -1 | 1) => moveTo(id, list.findIndex((block) => block.id === id) + delta);
    const remove = (id: string) => {
        if (list.length <= 1) return;
        const index = list.findIndex((block) => block.id === id);
        const copy = list.filter((block) => block.id !== id);
        setList(copy);
        if (selectedId === id) setSelectedId((copy[index] || copy[index - 1])?.id || null);
    };
    const insertAt = (index: number, block: StudioBlock) => {
        const copy = [...list];
        copy.splice(index, 0, block);
        setList(copy);
        setSelectedId(block.id);
    };
    const duplicate = (id: string) => {
        const index = list.findIndex((block) => block.id === id);
        if (index >= 0) insertAt(index + 1, { ...list[index], id: uid() });
    };
    const addAfter = (id: string) => {
        const index = list.findIndex((block) => block.id === id);
        insertAt(index + 1, { id: uid(), kind: "focus", title: "New block", note: "", minutes: 25, color: getDefaultBlockColor("focus") });
    };

    // While dragging over another block, move into its place once the pointer
    // passes its middle (so blocks of different sizes do not flicker).
    const dragOverBlock = (event: React.DragEvent<HTMLElement>, targetId: string, axis: "x" | "y") => {
        if (!dragId || dragId === targetId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const from = list.findIndex((block) => block.id === dragId);
        const to = list.findIndex((block) => block.id === targetId);
        const rect = event.currentTarget.getBoundingClientRect();
        const pos = axis === "x" ? event.clientX - rect.left : event.clientY - rect.top;
        const mid = (axis === "x" ? rect.width : rect.height) / 2;
        if ((from < to && pos < mid) || (from > to && pos > mid)) return;
        moveTo(dragId, to);
    };
    const endDrag = () => {
        setDragId(null);
        setGripArmedId(null);
    };

    // Pull a segment's right edge: minutes follow the pointer at the bar's scale.
    const startResize = (event: React.PointerEvent<HTMLSpanElement>, block: StudioBlock) => {
        event.preventDefault();
        event.stopPropagation();
        const barWidth = barRef.current?.getBoundingClientRect().width || 1;
        const minutesPerPx = Math.max(total, 1) / barWidth;
        const startX = event.clientX;
        const startMinutes = Number(block.minutes) || 1;
        const handle = event.currentTarget;
        try {
            handle.setPointerCapture(event.pointerId);
        } catch { }
        setSelectedId(block.id);
        const onMove = (ev: PointerEvent) => setMinutes(block.id, startMinutes + (ev.clientX - startX) * minutesPerPx);
        const onUp = () => {
            handle.removeEventListener("pointermove", onMove);
            handle.removeEventListener("pointerup", onUp);
            handle.removeEventListener("pointercancel", onUp);
        };
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        handle.addEventListener("pointercancel", onUp);
    };

    const save = async () => {
        if (!list.length || saving) return;
        setSaving(true);
        setError("");
        try {
            // Room policies live in the schedule JSON; read them fresh so saving
            // the timeline never resets camera or chat rules.
            let policySource: any = session;
            if (looksLikeUuid(session?.id)) {
                const { data } = await supabase
                    .from("sessions")
                    .select("camera_required, screen_share_required, public_chat_disabled, schedule")
                    .eq("id", session.id)
                    .maybeSingle();
                if (data) policySource = data;
            }
            const schedule = withRoomPolicies(
                exportStudioToSchedule(list, isInfinite, session?.start_time || session?.created_at || new Date().toISOString()),
                readSessionRoomPolicies(policySource),
            );
            await onSave({ schedule, duration_minutes: total || null });
            onClose();
        } catch (cause) {
            setError(cause instanceof Error && cause.message ? cause.message : "Timeline was not saved.");
        } finally {
            setSaving(false);
        }
    };

    const stepBtn =
        "flex h-6 w-6 items-center justify-center rounded-full text-[14px] leading-none text-[#606060] transition-[background-color,transform] duration-150 hover:bg-[#EAEAEA] hover:text-[#2F2F2F] active:scale-90";
    // Base chip without colors, so active and plain chips do not fight over classes.
    const chipBase =
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-95 disabled:opacity-35";
    const chipPlain = "border-[#E5E5E5] bg-white hover:bg-[#F1F1F1]";
    const chipBtn = `${chipBase} ${chipPlain}`;

    let elapsed = 0;

    return (
        <div
            data-inline-editing
            role="dialog"
            aria-label="Edit timeline"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            className={[
                "session-quick-timeline cursor-default rounded-[20px] border border-[#E5E5E5] bg-white p-3 text-left font-inter text-[#2F2F2F]",
                variant === "popover"
                    ? "absolute left-0 top-full z-[40] mt-2 w-[480px] max-w-[calc(100vw-48px)] shadow-[0_18px_48px_rgba(0,0,0,0.16)]"
                    : "w-full shadow-[0_6px_20px_rgba(0,0,0,0.06)]",
            ].join(" ")}
        >
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <span className="text-[13px] font-semibold">Timeline</span>
                <span className="text-[12px] text-[#7A7A7A]">Total {formatMinutes(total)}</span>
            </div>

            {/* Thin live bar of the blocks: drag or ← → to reorder, pull a right edge to resize. */}
            <div
                ref={barRef}
                role="listbox"
                aria-label="Timeline blocks. Drag or use the arrow keys to reorder."
                className="mb-3 flex h-2.5 w-full overflow-hidden rounded-full bg-[#F1F1F1] transition-[height] duration-200 ease-out hover:h-3.5"
            >
                {list.map((block) => {
                    const mins = clamp(Number(block.minutes) || 1, 1, 24 * 60);
                    const selected = selectedId === block.id;
                    return (
                        <button
                            key={block.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            draggable
                            onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", block.id);
                                setDragId(block.id);
                                setSelectedId(block.id);
                            }}
                            onDragOver={(event) => dragOverBlock(event, block.id, "x")}
                            onDrop={(event) => {
                                event.preventDefault();
                                endDrag();
                            }}
                            onDragEnd={endDrag}
                            onClick={() => setSelectedId(selected ? null : block.id)}
                            onKeyDown={(event) => {
                                if (event.key === "ArrowLeft") {
                                    event.preventDefault();
                                    moveBy(block.id, -1);
                                } else if (event.key === "ArrowRight") {
                                    event.preventDefault();
                                    moveBy(block.id, 1);
                                } else if (event.key === "Delete" || event.key === "Backspace") {
                                    event.preventDefault();
                                    remove(block.id);
                                }
                            }}
                            title={`${block.title} · ${mins} min — drag or ← → to move`}
                            className={[
                                // Blocks sit flush against each other, like the card's timeline.
                                "relative h-full min-w-0 cursor-grab outline-none transition-[flex-grow,filter,opacity,box-shadow] duration-300 ease-out hover:brightness-105 focus-visible:brightness-110 active:cursor-grabbing",
                                // A selected block stays vivid while the others fade back.
                                dragId === block.id ? "opacity-50" : selectedId && !selected ? "opacity-35 saturate-50" : "opacity-100",
                            ].join(" ")}
                            style={{
                                flexGrow: mins,
                                flexBasis: 0,
                                minWidth: TIMELINE_MIN_SEGMENT_WIDTH,
                                ...blockColorStyle(block),
                            }}
                        >
                            {/* Invisible grab area on the right edge for resizing. */}
                            <span
                                aria-hidden="true"
                                onPointerDown={(event) => startResize(event, block)}
                                className="absolute bottom-0 right-0 top-0 w-2 cursor-ew-resize"
                            />
                        </button>
                    );
                })}
            </div>

            {!blocks ? (
                <div className="mt-2 space-y-1.5 px-1 py-1">
                    {[0, 1, 2].map((index) => (
                        <div key={index} className="h-8 animate-pulse rounded-[10px] bg-[#F4F4F4]" />
                    ))}
                </div>
            ) : (
                <ul className="max-h-[320px] space-y-0.5 overflow-y-auto">
                    {list.map((block, index) => {
                        const open = selectedId === block.id;
                        const start = elapsed;
                        elapsed += Number(block.minutes) || 0;
                        return (
                            <li
                                key={block.id}
                                draggable={gripArmedId === block.id}
                                onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = "move";
                                    event.dataTransfer.setData("text/plain", block.id);
                                    setDragId(block.id);
                                }}
                                onDragOver={(event) => dragOverBlock(event, block.id, "y")}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    endDrag();
                                }}
                                onDragEnd={endDrag}
                                className={[
                                    "group rounded-[14px] border transition-[background-color,border-color,box-shadow,opacity] duration-200",
                                    open
                                        ? "border-[#EDEDED] bg-white shadow-[0_6px_18px_rgba(0,0,0,0.07)]"
                                        : "border-transparent hover:bg-[#F7F7F7]",
                                    dragId === block.id ? "opacity-40" : "",
                                ].join(" ")}
                            >
                                <div className="flex items-center gap-1.5 py-1 pl-0 pr-1">
                                    {/* Grip shows on hover; rows drag from it. */}
                                    <span
                                        onPointerDown={() => setGripArmedId(block.id)}
                                        onPointerUp={() => setGripArmedId(null)}
                                        className="-mr-0.5 flex h-6 w-3.5 shrink-0 cursor-grab items-center justify-center text-[#B5B5B5] opacity-0 transition-[opacity,color] duration-150 hover:text-[#2F2F2F] group-hover:opacity-100 active:cursor-grabbing"
                                        title="Drag to reorder"
                                        aria-hidden="true"
                                    >
                                        <GripVertical size={13} />
                                    </span>
                                    <span
                                        className="h-3 w-3 shrink-0 rounded-full transition-shadow duration-200"
                                        style={{
                                            ...blockColorStyle(block),
                                            // The open block's dot gets a soft halo in its own color.
                                            boxShadow: open ? `0 0 0 3px #fff, 0 0 0 5px ${getBlockColor(block)}55` : "none",
                                        }}
                                        aria-hidden="true"
                                    />
                                    <input
                                        value={block.title}
                                        onChange={(event) => update(block.id, { title: event.target.value })}
                                        onFocus={() => setSelectedId(block.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") void save();
                                        }}
                                        aria-label="Block name"
                                        className="h-7 min-w-0 flex-1 rounded-[8px] border border-transparent bg-transparent px-1.5 text-[13px] outline-none transition-colors hover:border-[#E5E5E5] focus:border-[#2F2F2F] focus:bg-white"
                                    />
                                    <div
                                        className="flex shrink-0 items-center gap-0.5 rounded-full border border-[#E5E5E5] bg-white px-0.5"
                                        title={`${start}–${start + (Number(block.minutes) || 0)} min`}
                                    >
                                        <button type="button" className={stepBtn} onClick={() => setMinutes(block.id, block.minutes - 5)} aria-label={`Shorten ${block.title}`}>
                                            −
                                        </button>
                                        <input
                                            type="number"
                                            min={1}
                                            max={24 * 60}
                                            value={block.minutes}
                                            onChange={(event) => setMinutes(block.id, Number(event.target.value))}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter") void save();
                                            }}
                                            aria-label={`${block.title} minutes`}
                                            className="h-6 w-9 bg-transparent text-center text-[12px] font-semibold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                        />
                                        <button type="button" className={stepBtn} onClick={() => setMinutes(block.id, block.minutes + 5)} aria-label={`Lengthen ${block.title}`}>
                                            +
                                        </button>
                                    </div>
                                    <span className="w-6 shrink-0 text-[11px] text-[#9A9A9A]">min</span>
                                    <button
                                        type="button"
                                        onClick={() => remove(block.id)}
                                        disabled={list.length <= 1}
                                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#A3A3A3] opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-red-50 hover:text-[#C93C3C] group-hover:opacity-100 focus-visible:opacity-100 disabled:hidden"
                                        aria-label={`Remove ${block.title}`}
                                    >
                                        <XIcon size={13} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedId(open ? null : block.id)}
                                        aria-expanded={open}
                                        aria-label={`More for ${block.title}`}
                                        className={[
                                            "-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#8A8A8A] transition-[opacity,background-color,color] duration-150 hover:bg-[#EAEAEA] hover:text-[#2F2F2F] focus-visible:opacity-100",
                                            open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                        ].join(" ")}
                                    >
                                        <ChevronDownIcon size={14} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                                    </button>
                                </div>

                                {open ? (
                                    <div className="space-y-2.5 px-2 pb-2.5 pt-1">
                                        {/* Kind */}
                                        <div className="flex flex-wrap gap-1.5">
                                            {STUDIO_KIND_OPTIONS.map((option) => {
                                                const active = block.kind === option.value;
                                                return (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        onClick={() =>
                                                            update(block.id, {
                                                                kind: option.value,
                                                                title:
                                                                    !String(block.title || "").trim() || block.title === defaultStudioTitle(block.kind)
                                                                        ? defaultStudioTitle(option.value)
                                                                        : block.title,
                                                                color: getDefaultBlockColor(option.value),
                                                            })
                                                        }
                                                        className={[
                                                            chipBase,
                                                            active ? "border-[#2F2F2F] bg-[#2F2F2F] text-white" : chipPlain,
                                                        ].join(" ")}
                                                    >
                                                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getDefaultBlockColor(option.value) }} aria-hidden="true" />
                                                        {option.label}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {/* Quick minutes */}
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {QUICK_MINUTES.map((minutes) => (
                                                <button
                                                    key={minutes}
                                                    type="button"
                                                    onClick={() => setMinutes(block.id, minutes)}
                                                    className={[chipBase, "px-2", block.minutes === minutes ? "border-[#2F2F2F] bg-[#2F2F2F] text-white" : chipPlain].join(" ")}
                                                >
                                                    {minutes}m
                                                </button>
                                            ))}
                                        </div>

                                        {/* Color */}
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {BLOCK_COLOR_PRESETS.map((color) => {
                                                const active = getBlockColor(block).toLowerCase() === color.toLowerCase();
                                                return (
                                                    <button
                                                        key={color}
                                                        type="button"
                                                        onClick={() => update(block.id, { color })}
                                                        className={[
                                                            "h-5 w-5 rounded-full transition-[transform,box-shadow] duration-150 hover:scale-110",
                                                            active ? "scale-110" : "",
                                                        ].join(" ")}
                                                        style={{
                                                            backgroundColor: color,
                                                            boxShadow: active ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : "inset 0 0 0 1px rgba(0,0,0,0.06)",
                                                        }}
                                                        aria-label={`Color ${color}`}
                                                    />
                                                );
                                            })}
                                            <input
                                                type="color"
                                                value={getBlockColor(block)}
                                                onChange={(event) => update(block.id, { color: event.target.value })}
                                                className="h-5 w-7 cursor-pointer rounded-md border border-[#E5E5E5] bg-white p-0.5"
                                                aria-label="Custom color"
                                            />
                                        </div>

                                        <textarea
                                            value={block.note || ""}
                                            onChange={(event) => update(block.id, { note: event.target.value })}
                                            placeholder="Note for this block (optional)"
                                            rows={2}
                                            className="w-full resize-none rounded-[12px] border border-[#E5E5E5] bg-white px-2.5 py-1.5 text-[12px] outline-none transition-colors focus:border-[#2F2F2F]"
                                        />

                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <button type="button" className={chipBtn} disabled={index === 0} onClick={() => moveBy(block.id, -1)}>
                                                <ArrowUp size={12} /> Earlier
                                            </button>
                                            <button type="button" className={chipBtn} disabled={index === list.length - 1} onClick={() => moveBy(block.id, 1)}>
                                                <ArrowDown size={12} /> Later
                                            </button>
                                            <button type="button" className={chipBtn} onClick={() => duplicate(block.id)}>
                                                <CopyIcon size={12} /> Duplicate
                                            </button>
                                            <button type="button" className={chipBtn} onClick={() => addAfter(block.id)}>
                                                <PlusIcon size={12} /> Add after
                                            </button>
                                            <button
                                                type="button"
                                                className={[chipBase, "border-[#F2D4D4] bg-white text-[#C93C3C] hover:bg-red-50"].join(" ")}
                                                disabled={list.length <= 1}
                                                onClick={() => remove(block.id)}
                                            >
                                                <Trash2 size={12} /> Delete
                                            </button>
                                        </div>
                                    </div>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            )}

            {blocks ? (
                <div className="mt-1.5 px-1">
                    {adding ? (
                        <div className="flex flex-wrap gap-1.5">
                            {STUDIO_LIBRARY.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                        insertAt(list.length, { ...item, id: uid(), color: getBlockColor(item) });
                                        setAdding(false);
                                    }}
                                    className={chipBtn}
                                >
                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getBlockColor(item) }} aria-hidden="true" />
                                    {item.title}
                                    <span className="text-[#9A9A9A]">{item.minutes}m</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setAdding(true)}
                            className="inline-flex h-7 items-center gap-1 rounded-full px-1.5 text-[12px] font-medium text-[#606060] transition-colors hover:text-[#2F2F2F]"
                        >
                            <PlusIcon size={13} /> Add block
                        </button>
                    )}
                </div>
            ) : null}

            {error ? <div className="mx-1 mt-2 rounded-[10px] bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700">{error}</div> : null}

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#F0F0F0] px-1 pt-3">
                <button
                    type="button"
                    onClick={onOpenFullEditor}
                    className="text-[12px] font-medium text-[#606060] underline-offset-4 transition-colors hover:text-[#2F2F2F] hover:underline"
                >
                    All settings
                </button>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-8 rounded-full border border-[#E5E5E5] px-3.5 text-[12px] font-semibold transition-[background-color,transform] duration-150 hover:bg-[#F3F4F6] active:scale-95"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => void save()}
                        disabled={!list.length || saving}
                        className="h-8 rounded-full bg-[#2F2F2F] px-4 text-[12px] font-semibold text-white transition-[background-color,transform,opacity] duration-150 hover:bg-[#1F1F1F] active:scale-95 disabled:opacity-50"
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
        </div>
    );
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
        camera_required?: boolean;
        screen_share_required?: boolean;
        public_chat_disabled?: boolean;
    }) => Promise<void> | void;
    session: any;
    resolvedStages?: SessionStage[];
    currentUserId?: string;
    hostCandidates?: HostTransferCandidate[];
    onHostTransferred?: (newHost: HostTransferCandidate) => void;
    canManageAnySession?: boolean;
}) {
    const {
        isOpen,
        onClose,
        onSave,
        session,
        resolvedStages = [],
        currentUserId,
        hostCandidates = [],
        onHostTransferred,
        canManageAnySession = false,
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
    const initialRoomPolicies = readSessionRoomPolicies(session);
    const [editCameraRequired, setEditCameraRequired] = useState(initialRoomPolicies.cameraRequired);
    const [editScreenShareRequired, setEditScreenShareRequired] = useState(initialRoomPolicies.screenShareRequired === true);
    const [editCameraOrScreenShareRequired, setEditCameraOrScreenShareRequired] = useState(initialRoomPolicies.cameraOrScreenShareRequired === true);
    const [editPublicChatDisabled, setEditPublicChatDisabled] = useState(initialRoomPolicies.publicChatDisabled);

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
        if (!isOpen || !Array.isArray(resolvedStages) || resolvedStages.length === 0) return;

        setStudioBlocks(
            normalizeStudioBlocksFromSession({
                ...session,
                session_stages: resolvedStages,
            })
        );
        setSelectedBlockId(null);
    }, [isOpen, session?.id, resolvedStages]);
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
        const nextPolicies = readSessionRoomPolicies(session);
        setEditCameraRequired(nextPolicies.cameraRequired);
        setEditScreenShareRequired(nextPolicies.screenShareRequired === true);
        setEditCameraOrScreenShareRequired(nextPolicies.cameraOrScreenShareRequired === true);
        setEditPublicChatDisabled(nextPolicies.publicChatDisabled);
        setStudioBlocks(normalizeStudioBlocksFromSession({
            ...session,
            session_stages: resolvedStages.length ? resolvedStages : session?.session_stages,
        }));
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
    }, [
        isOpen,
        session?.id,
        session?.description,
        session?.title,
        session?.start_time,
        session?.max_participants,
        session?.schedule,
        session?.camera_required,
        session?.screen_share_required,
        session?.public_chat_disabled,
    ]);

    useEffect(() => {
        if (!isOpen || !looksLikeUuid(session?.id)) return;

        let cancelled = false;
        void supabase
            .from("sessions")
            .select("camera_required, screen_share_required, public_chat_disabled, schedule")
            .eq("id", session.id)
            .maybeSingle()
            .then(({ data, error }) => {
                if (cancelled || error || !data) return;
                const policies = readSessionRoomPolicies(data);
                setEditCameraRequired(policies.cameraRequired);
                setEditScreenShareRequired(policies.screenShareRequired === true);
                setEditCameraOrScreenShareRequired(policies.cameraOrScreenShareRequired === true);
                setEditPublicChatDisabled(policies.publicChatDisabled);
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen, session?.id]);

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

            if (!canManageAnySession && currentUserId && currentHostId && currentUserId !== currentHostId) {
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
                    newHostName: candidate.full_name || candidate.email || null,
                    canManageAnySession,
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
        [session?.id, currentHostId, currentUserId, onHostTransferred, canManageAnySession]
    );

    if (!isOpen) return null;

    return (
        <ModalShell
            title="Edit session"
            isOpen={isOpen}
            onClose={onClose}
            widthClass="max-w-[1200px]"
            footer={
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
                                updates.schedule = withRoomPolicies(nextSchedule, {
                                    cameraRequired: editCameraRequired,
                                    screenShareRequired: editScreenShareRequired,
                                    cameraOrScreenShareRequired: editCameraOrScreenShareRequired,
                                    publicChatDisabled: editPublicChatDisabled,
                                });
                                updates.duration_minutes = studioTotal || null;
                                updates.camera_required = editCameraRequired;
                                updates.screen_share_required = editScreenShareRequired;
                                updates.public_chat_disabled = editPublicChatDisabled;

                                await onSave(updates);
                            } finally {
                                setIsSaving(false);
                            }
                        }}
                    >
                        {isSaving ? "Saving..." : "Save changes"}
                    </button>
                </div>
            }
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

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => {
                                setEditCameraRequired((value) => !value);
                                setEditCameraOrScreenShareRequired(false);
                            }}
                            className={`rounded-[16px] px-4 py-3 text-left transition ${editCameraRequired ? "bg-[#2F2F2F] text-white" : "bg-[#F3F3F3] text-[#344054] hover:bg-[#EAEAEA]"}`}
                            aria-pressed={editCameraRequired}
                        >
                            <div className="text-[13px] font-semibold">Cameras required</div>
                            <div className={`mt-1 text-[11px] leading-4 ${editCameraRequired ? "text-white/70" : "text-[#667085]"}`}>
                                Warn twice, then disconnect participants whose camera stays off.
                            </div>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setEditScreenShareRequired((value) => !value);
                                setEditCameraOrScreenShareRequired(false);
                            }}
                            className={`rounded-[16px] px-4 py-3 text-left transition ${editScreenShareRequired ? "bg-[#2F2F2F] text-white" : "bg-[#F3F3F3] text-[#344054] hover:bg-[#EAEAEA]"}`}
                            aria-pressed={editScreenShareRequired}
                        >
                            <div className="text-[13px] font-semibold">Screen share required</div>
                            <div className={`mt-1 text-[11px] leading-4 ${editScreenShareRequired ? "text-white/70" : "text-[#667085]"}`}>
                                Warn twice, then disconnect participants who do not share their screen.
                            </div>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setEditCameraOrScreenShareRequired((value) => !value);
                                setEditCameraRequired(false);
                                setEditScreenShareRequired(false);
                            }}
                            className={`rounded-[16px] px-4 py-3 text-left transition ${editCameraOrScreenShareRequired ? "bg-[#2F2F2F] text-white" : "bg-[#F3F3F3] text-[#344054] hover:bg-[#EAEAEA]"}`}
                            aria-pressed={editCameraOrScreenShareRequired}
                        >
                            <div className="text-[13px] font-semibold">Camera or screen share required</div>
                            <div className={`mt-1 text-[11px] leading-4 ${editCameraOrScreenShareRequired ? "text-white/70" : "text-[#667085]"}`}>
                                Either one is enough. Disconnect only if both stay off after two reminders.
                            </div>
                        </button>
                        <button
                            type="button"
                            onClick={() => setEditPublicChatDisabled((value) => !value)}
                            className={`rounded-[16px] px-4 py-3 text-left transition ${editPublicChatDisabled ? "bg-[#2F2F2F] text-white" : "bg-[#F3F3F3] text-[#344054] hover:bg-[#EAEAEA]"}`}
                            aria-pressed={editPublicChatDisabled}
                        >
                            <div className="text-[13px] font-semibold">Disable public chat</div>
                            <div className={`mt-1 text-[11px] leading-4 ${editPublicChatDisabled ? "text-white/70" : "text-[#667085]"}`}>
                                Keep only private participant-to-host messages available.
                            </div>
                        </button>

                    </div>

                    <div className="mt-4 border border-[#DBD8D8] rounded-[18px] bg-[#FAFAFA] p-3 sm:p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 font-inter font-semibold text-[13px] text-brandBlack">
                                    <Crown size={15} />
                                    Transfer host rights
                                </div>
                                <div className="mt-1 font-inter text-[12px] leading-5 text-gray-500">
                                    Assign the host role and room controls to another user.
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


            </div>
        </ModalShell>
    );
}

export default function SessionCard({
    session,
    musicPlaying = false,
    userId,
    onBook,
    onCancelBooking,
    seriesOccurrences,
    onBookSeries,
    onCancelSeries,
    onBookHostSlots,
    onJoin,
    onDelete,
    onEditSession,
    onHostTransferComplete,
    canManageAnySession = false,
    onVisibilityChange,
    onPinnedChange,
    currentUser,
}: SessionCardProps) {
    const navigate = useNavigate();
    const [hostIdOverride, setHostIdOverride] = useState<string | null>(null);

    useEffect(() => {
        setHostIdOverride(null);
    }, [session?.id, session?.host_id]);

    const effectiveHostId = hostIdOverride || session.host_id;
    const isHost = !!userId && effectiveHostId === userId;
    // Signed-out visitors see participant counts and people blurred.
    const isGuest = !userId;
    const canManageSession = isHost || canManageAnySession;
    const sessionIsInfinite = resolveSessionType(session) === "infinite";
    const cardRoomPolicies = readSessionRoomPolicies(session);
    const hasUpcomingTimedBooking = (booking: any) => {
        const startMs = Date.parse(String(booking?.booked_start_time || ""));
        const endMs = Date.parse(String(booking?.booked_end_time || ""));
        return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > Date.now() && endMs > startMs;
    };
    const initialIsBooked =
        !!userId &&
        (
            session.session_bookings?.some((booking: any) =>
                booking.user_id === userId && (!sessionIsInfinite || hasUpcomingTimedBooking(booking))
            ) ||
            (!sessionIsInfinite && session?.is_booked === true)
        );
    const [isBookingConfirmed, setIsBookingConfirmed] = useState<boolean>(!!initialIsBooked);

    const [isHoveringCancel, setIsHoveringCancel] = useState(false);
    const [isHoveringBook, setIsHoveringBook] = useState(false);
    const [isHoveringJoinIframe, setIsHoveringJoinIframe] = useState(false);
    const [isHoveringOptions, setIsHoveringOptions] = useState(false);
    const [isHoveringCard, setIsHoveringCard] = useState(false);
    const pendingDetailsOpenRef = useRef(0);
    useEffect(() => () => window.clearTimeout(pendingDetailsOpenRef.current), []);
    // Where the quick timeline editor is open: on the card, in the details, or nowhere.
    const [quickTimeline, setQuickTimeline] = useState<"card" | "drawer" | null>(null);
    const [isSavingVisibility, setIsSavingVisibility] = useState(false);
    const [isSavingPinned, setIsSavingPinned] = useState(false);

    const CANCEL_HOVER_DELAY_MS = 120;
    const [cancelHoverTimer, setCancelHoverTimer] = useState<number | null>(null);

    const initialBookers = useMemo(() => extractBookers(session), [session]);
    const [bookers, setBookers] = useState<BookedUser[]>(initialBookers);
    const sortedBookingTimeline = useMemo(() => {
        const nowMs = Date.now();
        // Extra days a host booked (infinite rooms); each is its own entry.
        const extraSlots: BookedUser[] = (Array.isArray(session?.host_slots) ? session.host_slots : []).map((slot: any) => {
            const profile = Array.isArray(slot?.profiles) ? slot.profiles[0] : slot?.profiles;
            return {
                id: String(slot?.user_id || ""),
                full_name: profile?.full_name || undefined,
                avatar_url: profile?.avatar_url || undefined,
                booked_start_time: slot?.starts_at || null,
                booked_end_time: slot?.ends_at || null,
                booking_role: "host" as const,
            };
        });
        const seen = new Set<string>();
        return [...bookers, ...extraSlots]
            .filter((booking) => {
                const key = `${booking.id}|${booking.booked_start_time}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .filter((booking) => {
                const startMs = Date.parse(String(booking.booked_start_time || ""));
                const endMs = Date.parse(String(booking.booked_end_time || ""));
                return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > nowMs && endMs > startMs;
            })
            .sort((a, b) => {
                const aStart = Date.parse(String(a.booked_start_time || ""));
                const bStart = Date.parse(String(b.booked_start_time || ""));
                const aValue = Number.isFinite(aStart) ? aStart : Number.POSITIVE_INFINITY;
                const bValue = Number.isFinite(bStart) ? bStart : Number.POSITIVE_INFINITY;
                if (aValue !== bValue) return aValue - bValue;
                return String(a.full_name || a.id).localeCompare(String(b.full_name || b.id));
            });
    }, [bookers, session?.host_slots]);

    // Hosting windows already planned, marked as taken in the host picker.
    const hostBusyWindows = useMemo<HostBusyWindow[]>(
        () =>
            sortedBookingTimeline.map((booking) => ({
                startMs: Date.parse(String(booking.booked_start_time)),
                endMs: Date.parse(String(booking.booked_end_time)),
                name: userId && booking.id === userId ? "You" : booking.full_name || "A host",
            })),
        [sortedBookingTimeline, userId]
    );

    // Infinite rooms: hosting windows grouped by local day for the drawer.
    const scheduleNowMs = Date.now();
    const hostingScheduleDays = useMemo(() => {
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);
        const groups: Array<{ key: string; label: string; isToday: boolean; items: BookedUser[] }> = [];
        for (const booking of sortedBookingTimeline) {
            const start = new Date(String(booking.booked_start_time || ""));
            if (Number.isNaN(start.getTime())) continue;
            const key = start.toDateString();
            let group = groups.find((entry) => entry.key === key);
            if (!group) {
                const isToday = key === today.toDateString();
                const label = isToday
                    ? "Today"
                    : key === tomorrow.toDateString()
                        ? "Tomorrow"
                        : start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                group = { key, label, isToday, items: [] };
                groups.push(group);
            }
            group.items.push(booking);
        }
        return groups;
    }, [sortedBookingTimeline]);

    const [stages, setStages] = useState<SessionStage[]>([]);
    const [isStagesLoading, setIsStagesLoading] = useState(false);
    const [liveUsers, setLiveUsers] = useState<BookedUser[]>([]);
    const [isLiveLoading, setIsLiveLoading] = useState(false);

    const liveIdSet = useMemo(() => new Set(liveUsers.map((u) => u.id)), [liveUsers]);

    const [isBookersModalOpen, setIsBookersModalOpen] = useState(false);
    const [isLiveUsersModalOpen, setIsLiveUsersModalOpen] = useState(false);
    const [isBookingTimeModalOpen, setIsBookingTimeModalOpen] = useState(false);
    const [bookingDateDraft, setBookingDateDraft] = useState(() => {
        const start = roundDateToNextQuarterHour();
        return toLocalDateInputValue(start);
    });
    const [bookingStartTimeDraft, setBookingStartTimeDraft] = useState(() => {
        const start = roundDateToNextQuarterHour();
        return toLocalTimeInputValue(start);
    });
    const [bookingDurationDraft, setBookingDurationDraft] = useState<number>(HOST_DEFAULT_DURATION_MINUTES);
    const [isSavingHostBooking, setIsSavingHostBooking] = useState(false);
    const [bookingDraftError, setBookingDraftError] = useState("");
    // Infinite rooms are booked to host; there is no participant booking.
    const bookingRoleDraft = "host" as const;
    const [repeatWeekDraft, setRepeatWeekDraft] = useState(false);
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
            lifetimeSessionsCount: entitlementState.lifetimeSessionsCount,
        });
    }, [entitlementState]);

    const paywallBlocked =
        isPersonalPaywallForced(entitlementState)
            ? true
            : !!paywallDecision?.blocked;

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

    const isInfinite = sessionIsInfinite;
    const isGroupSession = resolveSessionType(session) === "group";
    const presenceOpensAt = isGroupSession ? Date.parse(String(session?.start_time || "")) - 10 * 60_000 : Number.NaN;
    const [presenceTime, setPresenceTime] = useState(Date.now);

    useEffect(() => {
        if (!Number.isFinite(presenceOpensAt)) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const refresh = () => {
            if (timer) clearTimeout(timer);
            const now = Date.now();
            setPresenceTime(now);
            const remaining = presenceOpensAt - now;
            if (remaining > 0) timer = setTimeout(refresh, Math.min(remaining, 2_147_483_647));
        };
        refresh();
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            if (timer) clearTimeout(timer);
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, [presenceOpensAt]);

    const showLivePresence = !isGroupSession || (Number.isFinite(presenceOpensAt) && presenceTime >= presenceOpensAt);
    useEffect(() => {
        if (!isBookersModalOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setIsBookersModalOpen(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isBookersModalOpen]);


    const liveCountFromSession: number | null = parseDbCount(
        session?.live_count ??
        session?.liveCount ??
        session?.live_now_count ??
        session?.liveNowCount ??
        null
    );

    const bookedCount = isInfinite ? sortedBookingTimeline.length : bookers.length;
    // The booked button shows the head count only once a session has some momentum.
    const BOOKED_COUNT_SHOW_FROM = 4;
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
    const displayedMaxParticipants = maxParticipants ?? 16;

    const occupiedSlots = Math.min(liveNowCount, displayedMaxParticipants);
    const occupancyPercent = displayedMaxParticipants > 0
        ? Math.min(100, Math.max(0, (occupiedSlots / displayedMaxParticipants) * 100))
        : 0;

    const isSessionFull =
        maxParticipants != null &&
        liveNowCount >= maxParticipants;

    const sessionFullDescription =
        maxParticipants != null
            ? `This session is full right now (${liveNowCount}/${maxParticipants} in session). If someone leaves, you can try joining again.`
            : "This session is full right now. If someone leaves, you can try joining again.";

    const hasStarted = useMemo(() => {
    if (isInfinite) return true;

    const status = safeLower(session?.status);
    if (
        status === "active" ||
        status === "live" ||
        status === "started" ||
        status === "in_progress"
    ) {
        return true;
    }

    if (!session?.start_time) return false;
    const t = Date.parse(String(session.start_time));
    if (!Number.isFinite(t)) return false;
    return Date.now() >= t;
}, [isInfinite, session?.status, session?.start_time]);

    const timelineStartTime = useMemo(() => {
        const startedAt = session?.started_at;
        const startTime = session?.start_time;
        const createdAt = session?.created_at;
        const start = startedAt || startTime || createdAt || "";

        return start ? String(start) : String(Date.now());
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

    const scheduleObj = tryParseJson<any>(session?.schedule);
    const custom = isCustomStudioSession(session);
    const freeFlow = isInfinite && isFreeFlowSchedule(scheduleObj);
    const resolvedType = freeFlow ? "Free Flow" : custom ? "Custom session" : baseResolvedType;

    const typeMap: Record<string, { color: string; bg: string; icon: string }> = {
        "Deep work": { color: "#3B82F6", bg: "#E4EDFF", icon: "/icons/deepwork.svg" },
        Pomodoro: { color: "#EF4444", bg: "#FFE4E4", icon: "/icons/pomodoro.svg" },
        "Short sprints": { color: "#22C55E", bg: "#E5FFE9", icon: "/icons/sprints.svg" },
        "Custom session": { color: "#6366F1", bg: "#EEF2FF", icon: "/icons/custom.svg" },
        "Free Flow": { color: "#6366F1", bg: "#EEF2FF", icon: "/icons/custom.svg" },
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
        "Free Flow": "#6366F1",
    };
    const joinHoverBg = JOIN_HOVER_BG[resolvedType] || "#111827";

    const activeInfiniteHost = isInfinite ? session?.active_host_profile : null;
    const displayedHostId = String(
        activeInfiniteHost?.id || session?.active_host_user_id || session?.host_id || "host"
    );
    const hostCardUser: BookedUser = {
        id: displayedHostId,
        full_name:
            activeInfiniteHost?.full_name ||
            session?.host_name ||
            session?.host_profile?.full_name ||
            "Host",
        avatar_url:
            activeInfiniteHost?.avatar_url ||
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
        if (!isBookersModalOpen && !isEditModalOpen && !quickTimeline) {
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
        quickTimeline,
        isInfinite,
    ]);

    // Closing the details also closes a timeline edit that was open there.
    useEffect(() => {
        if (!isBookersModalOpen) setQuickTimeline((value) => (value === "drawer" ? null : value));
    }, [isBookersModalOpen]);

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
            liveNowCount > 0 ||
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
        if (!isBookersModalOpen && !isLiveUsersModalOpen) return;

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
    }, [session?.id, isBookersModalOpen, isLiveUsersModalOpen]);

    const ensureCurrentUserAsBooked = (opts?: {
        booked_start_time?: string | null;
        booked_end_time?: string | null;
        booking_role?: "participant" | "host";
    }) => {
        if (!userId) return;

        const cu: BookedUser = currentUser?.id
            ? {
                id: currentUser.id,
                full_name: currentUser.full_name || "You",
                avatar_url: currentUser.avatar_url,
                booked_start_time: opts?.booked_start_time || null,
                booked_end_time: opts?.booked_end_time || null,
                booking_role: opts?.booking_role || "participant",
            }
            : {
                id: userId,
                full_name: "You",
                booked_start_time: opts?.booked_start_time || null,
                booked_end_time: opts?.booked_end_time || null,
                booking_role: opts?.booking_role || "participant",
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
                        booking_role: opts?.booking_role ?? u.booking_role ?? "participant",
                    }
                    : u
            );
        });
    };

    const removeCurrentUserFromBooked = () => {
        if (!userId) return;
        setBookers((prev) => prev.filter((u) => u.id !== userId));
    };

    const handleBookSession = async () => {
        if (!userId) {
            navigate(buildLoginNext("/sessions"));
            return;
        }

        if (isInfinite) {
            setBookingDraftError("");

            const start = roundDateToNextQuarterHour();

            setBookingDateDraft(toLocalDateInputValue(start));
            setBookingStartTimeDraft(toLocalTimeInputValue(start));
            setBookingDurationDraft(HOST_DEFAULT_DURATION_MINUTES);
            setRepeatWeekDraft(false);
            setIsBookingTimeModalOpen(true);
            setIsHoveringBook(false);
            return;
        }

        const saved = await Promise.resolve(onBook(session.id));
        if (!saved) return;
        setIsBookingConfirmed(true);
        ensureCurrentUserAsBooked();
        setIsHoveringBook(false);
    };

    const handleConfirmInfiniteBooking = async () => {
        if (!userId) {
            navigate(buildLoginNext("/sessions"));
            return;
        }

        if (isSavingHostBooking) return;

        const hostWindow = hostWindowFromDraft(bookingDateDraft, bookingStartTimeDraft, bookingDurationDraft);
        if (!hostWindow) {
            setBookingDraftError("Choose a day, a start time and how long you will host.");
            return;
        }

        const { startMs, endMs } = hostWindow;
        if (endMs <= Date.now()) {
            setBookingDraftError("That time has already passed. Pick a later one.");
            return;
        }
        const startIso = new Date(startMs).toISOString();
        const endIso = new Date(endMs).toISOString();

        setBookingDraftError("");

        // Repeating: the same window on each of the next six days.
        const DAY_MS = 24 * 60 * 60 * 1000;
        const extraSlots = repeatWeekDraft
            ? Array.from({ length: 6 }, (_, index) => ({
                starts_at: new Date(startMs + (index + 1) * DAY_MS).toISOString(),
                ends_at: new Date(endMs + (index + 1) * DAY_MS).toISOString(),
            }))
            : [];
        if (extraSlots.length && endMs - startMs > DAY_MS) {
            setBookingDraftError("To repeat daily, keep the window under 24 hours.");
            return;
        }

        setIsSavingHostBooking(true);
        try {
            await saveInfiniteBooking(startIso, endIso, extraSlots);
        } finally {
            setIsSavingHostBooking(false);
        }
    };

    const saveInfiniteBooking = async (
        startIso: string,
        endIso: string,
        extraSlots: Array<{ starts_at: string; ends_at: string }>,
    ) => {
        const saved = await Promise.resolve(onBook(session.id, {
            booked_start_time: startIso,
            booked_end_time: endIso,
            booking_note: null,
            booking_role: bookingRoleDraft,
        }));
        if (!saved) {
            setBookingDraftError("Could not save this booking. Please try again.");
            return;
        }

        setIsBookingConfirmed(true);
        ensureCurrentUserAsBooked({
            booked_start_time: startIso,
            booked_end_time: endIso,
            booking_role: bookingRoleDraft,
        });

        if (extraSlots.length && onBookHostSlots) {
            const result = await onBookHostSlots(session.id, extraSlots);
            if (result !== "ok") {
                setBookingDraftError(
                    result === "unavailable"
                        ? "Your first day is booked. Booking the whole week is not available yet."
                        : "Your first day is booked, but the other days could not be saved. Please try again."
                );
                return;
            }
        }
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

    // The list comes from the page; this card's own booking state is newer
    // than the page data right after a click, so it wins for this session.
    const seriesList = useMemo(() => {
        if (isInfinite || !seriesOccurrences || seriesOccurrences.length < 2) return null;
        const currentId = String(session.id);
        return seriesOccurrences.map((occurrence) =>
            occurrence.id === currentId ? { ...occurrence, booked: isBookingConfirmed } : occurrence
        );
    }, [isInfinite, seriesOccurrences, session.id, isBookingConfirmed]);
    const seriesOpenIds = seriesList?.filter((occurrence) => !occurrence.booked).map((occurrence) => occurrence.id) ?? [];
    const seriesBookedIds = seriesList?.filter((occurrence) => occurrence.booked).map((occurrence) => occurrence.id) ?? [];
    const [seriesPending, setSeriesPending] = useState<string | null>(null);
    const [seriesMessage, setSeriesMessage] = useState("");

    const handleBookWholeSeries = async () => {
        if (!userId) {
            navigate(buildLoginNext("/sessions"));
            return;
        }
        if (!onBookSeries || !seriesOpenIds.length || seriesPending) return;
        const requested = seriesOpenIds;
        setSeriesPending("all");
        setSeriesMessage("");
        try {
            const booked = await onBookSeries(requested);
            if (booked.includes(String(session.id))) {
                setIsBookingConfirmed(true);
                ensureCurrentUserAsBooked();
            }
            if (booked.length < requested.length) {
                setSeriesMessage(
                    booked.length
                        ? `Booked ${booked.length} of ${requested.length}. The rest could not be booked, try again.`
                        : "Could not book these sessions. Please try again."
                );
            }
        } finally {
            setSeriesPending(null);
        }
    };

    const handleCancelWholeSeries = async () => {
        if (!onCancelSeries || !seriesBookedIds.length || seriesPending) return;
        const requested = seriesBookedIds;
        setSeriesPending("cancel");
        setSeriesMessage("");
        try {
            const ok = await onCancelSeries(requested);
            if (!ok) {
                setSeriesMessage("Could not cancel these bookings. Please try again.");
                return;
            }
            if (requested.includes(String(session.id))) {
                setIsBookingConfirmed(false);
                removeCurrentUserFromBooked();
            }
        } finally {
            setSeriesPending(null);
        }
    };

    const handleToggleSeriesOccurrence = async (occurrence: SeriesOccurrence) => {
        if (seriesPending) return;
        if (occurrence.id === String(session.id)) {
            if (occurrence.booked) handleCancelBooking();
            else await handleBookSession();
            return;
        }
        if (!userId) {
            navigate(buildLoginNext("/sessions"));
            return;
        }
        setSeriesPending(occurrence.id);
        setSeriesMessage("");
        try {
            if (occurrence.booked) {
                await Promise.resolve(onCancelBooking(occurrence.id));
            } else if (!(await Promise.resolve(onBook(occurrence.id)))) {
                setSeriesMessage("Could not book that session. Please try again.");
            }
        } finally {
            setSeriesPending(null);
        }
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
        if (!canManageSession && isSessionFull) {
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
    const [showAllDrawerBookers, setShowAllDrawerBookers] = useState(false);

    const drawerWhen = useMemo(() => {
        if (isInfinite) return { date: "Always open", time: "hosts pick the times they keep the room company" };
        const start = session?.start_time ? new Date(session.start_time) : null;
        if (!start || Number.isNaN(start.getTime())) return { date: "Time TBD", time: "" };
        const durationMinutes = Number(session?.duration_minutes || 0);
        const timeOptions: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
        const startText = start.toLocaleTimeString("en-US", timeOptions);
        const endText = durationMinutes > 0
            ? new Date(start.getTime() + durationMinutes * 60_000).toLocaleTimeString("en-US", timeOptions)
            : "";
        return {
            date: start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
            time: endText ? `${startText} – ${endText}` : startText,
        };
    }, [isInfinite, session?.start_time, session?.duration_minutes]);

    const drawerStatus = isInfinite
        ? hasLiveNow
            ? { live: true, label: isGuest ? "People in the room now" : `${liveNowCount} in the room now` }
            : { live: false, label: "Open 24/7" }
        : hasStarted
            ? { live: true, label: hasLiveNow && !isGuest ? `Happening now · ${liveNowCount} in the room` : "Happening now" }
            : { live: false, label: formatStartsIn(Date.parse(String(session?.start_time || "")) - Date.now()) };

    const canEdit = canManageSession && !!onEditSession;
    const canCancelBooking = !!isBookingConfirmed;
    const canCancelSession = canManageSession;
    const canToggleVisibility = canManageAnySession && !!onVisibilityChange;
    const canTogglePinned = canManageAnySession && isInfinite && !!onPinnedChange;
    const isHidden = session?.is_hidden === true;
    const isPinned = session?.is_pinned === true;

    // Everything the card shows, spelled out for the session details modal.
    const drawerPolicies = getSessionCardPolicyState(cardRoomPolicies);
    const drawerMediaRequired = drawerPolicies.camera || drawerPolicies.screen;
    const drawerSeatsTaken = isInfinite ? liveNowCount : bookedCount;
    // Short form for the header: "Fri, Oct 16" and "9:00 – 10:00 AM".
    const drawerStartShort = (() => {
        const start = session?.start_time ? new Date(session.start_time) : null;
        if (isInfinite || !start || Number.isNaN(start.getTime())) return null;
        const minutes = Number(session?.duration_minutes || 0);
        const end = minutes > 0 ? new Date(start.getTime() + minutes * 60_000) : null;
        const time = (d: Date, withPeriod: boolean) => {
            const text = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            return withPeriod ? text : text.replace(/\s?[AP]M$/, "");
        };
        const samePeriod = !!end && (start.getHours() < 12) === (end.getHours() < 12);
        return {
            date: start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
            time: end ? `${time(start, !samePeriod)} – ${time(end, true)}` : time(start, true),
        };
    })();
    const drawerDetails: DrawerDetail[] = [


        {
            key: "capacity",
            label: "Capacity",
            value: `${displayedMaxParticipants} seats`,
            sub: isInfinite
                ? `${liveNowCount} in room`
                : `${Math.max(0, displayedMaxParticipants - bookedCount)} open`,
            tone: "rule",
            icon: <RoomIcon src="/icons/participants-light.svg" />,
            meter: displayedMaxParticipants > 0 ? Math.min(1, drawerSeatsTaken / displayedMaxParticipants) : 0,
        },
        // Everything below appears only when it is switched on; defaults are left out.
        ...optionalDetails([
            session?.is_private && {
                key: "access",
                label: "Access",
                value: "Private",
                sub: "invite only",
                tone: "rule",
                icon: <Lock size={14} strokeWidth={2.2} />,
            },
            isHidden && {
                key: "listing",
                label: "Hidden from Sessions; direct links still work",
                value: "Hidden",
                tone: "rule",
                icon: <EyeOff size={14} strokeWidth={2.2} />,
            },
            isInfinite && isPinned && {
                key: "pinned",
                label: "Pinned to the top of the list",
                value: "Pinned",
                tone: "rule",
                icon: <Pin size={14} strokeWidth={2.2} />,
            },
            drawerMediaRequired && {
                key: "media",
                label: "Camera and screen rules",
                value: drawerPolicies.either
                    ? "Camera or screen"
                    : drawerPolicies.camera && drawerPolicies.screen
                        ? "Camera + screen"
                        : drawerPolicies.camera
                            ? "Camera on"
                            : "Screen share",
                sub: "required",
                tone: "rule",
                icon: drawerPolicies.screen && !drawerPolicies.camera ? <MonitorUp size={14} strokeWidth={2.2} /> : <RoomIcon src="/icons/camera-on-light.svg" />,
            },
            drawerPolicies.chat && {
                key: "chat",
                label: "Public chat is off; DMs to the host still work",
                value: "Chat off",
                tone: "rule",
                icon: <MessageSquareOff size={14} strokeWidth={2.2} />,
            },
            cardRoomPolicies.microphoneLocked && {
                key: "mic",
                label: "Microphones are locked by the host",
                value: "Mics muted",
                tone: "rule",
                icon: <MicOff size={14} strokeWidth={2.2} />,
            },
            musicPlaying && {
                key: "music",
                label: "Shared room audio is playing",
                value: "Music on",
                tone: "type",
                icon: <span className="flex scale-[0.72] items-center justify-center"><SessionMusicIndicator color={t.color} /></span>,
            },
        ]),
    ];

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
                    if (!isGuest) setIsLiveUsersModalOpen(true);
                }}
                className={`inline-flex items-center gap-2 transition text-left whitespace-nowrap ${isGuest ? "cursor-default" : "hover:opacity-80"}`}
                title={isGuest ? GUEST_BLUR_HINT : "People in the session now"}
            >
                <GuestBlur active={isGuest}>
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
                </GuestBlur>
            </button>

        </div>
    );

    const description = resolvedDescription;

    const cycleSeconds =
        Number((scheduleObj as any)?.timer?.cycleSeconds) ||
        Number((scheduleObj as any)?.timer?.cycle_seconds) ||
        undefined;

    const tickEveryMs = isInfinite ? 15000 : 1000;


    // Render the card timeline from data that is already in the session payload.
    // This keeps the stage bar visible by default without reintroducing a
    // per-card PostgREST request (important for the current egress budget).
    const cardStages = useMemo<SessionStage[]>(() => {
        if (Array.isArray(session?.session_stages) && session.session_stages.length) {
            return normalizeStages(sortStagesInClient(session.session_stages));
        }

        if (Array.isArray(session?.stages) && session.stages.length) {
            return normalizeStages(sortStagesInClient(session.stages));
        }

        const scheduleStages = tryStagesFromSchedule(session?.schedule);
        if (scheduleStages.length) return scheduleStages;

        const embeddedTemplate = getEmbeddedTemplate(session);
        if (embeddedTemplate) {
            const embeddedBlocks =
                tryParseJson<any[]>(embeddedTemplate?.blocks) ||
                tryParseJson<any[]>(embeddedTemplate?.stages);

            if (Array.isArray(embeddedBlocks) && embeddedBlocks.length) {
                return normalizeStages(sortStagesInClient(embeddedBlocks));
            }

            const embeddedScheduleStages = tryStagesFromSchedule(embeddedTemplate?.schedule);
            if (embeddedScheduleStages.length) return embeddedScheduleStages;
        }

        const durationMinutes = Number(session?.duration_minutes);
        if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
            return normalizeStages(
                sortStagesInClient([
                    {
                        id: `card-fallback-${String(session?.id || "session")}`,
                        kind: "focus",
                        title: "Focus",
                        durationMinutes,
                        position: 0,
                    },
                ])
            );
        }

        return [];
    }, [
        session?.id,
        session?.session_stages,
        session?.stages,
        session?.schedule,
        session?.session_template,
        session?.session_templates,
        session?.template,
        session?.templates,
        session?.duration_minutes,
    ]);

    const bookSessionButton = (
        <button
            onClick={handleBookSession}
            aria-label={isInfinite ? "Host a time" : "Book session"}
            onMouseEnter={() => setIsHoveringBook(true)}
            onMouseLeave={() => setIsHoveringBook(false)}
            className={`
                h-12 min-w-0 min-[1024px]:min-w-[160px] rounded-full px-4 min-[1024px]:px-6 text-[14px] font-semibold
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
            <span className="hidden min-[1024px]:inline">{isInfinite ? "Host a time" : "Book session"}</span>
        </button>
    );

    const confirmedBookingButton = (
        <button
            aria-label={
                isInfinite
                    ? "View booking details"
                    : bookedCount >= BOOKED_COUNT_SHOW_FROM
                        ? `Booked session, ${bookedCount} people going`
                        : "Booked session"
            }
            title={!isInfinite && bookedCount >= BOOKED_COUNT_SHOW_FROM ? `${bookedCount} people going` : undefined}
            onClick={isInfinite
                ? () => {
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
                <>
                    <img src="/icons/book-session-green.svg" className="w-6 h-6" alt="" />
                    {/* From a few people up, show how many are going. */}
                    {!isInfinite && bookedCount >= BOOKED_COUNT_SHOW_FROM ? (
                        <span className="ml-1.5 tabular-nums">
                            {bookedCount}
                        </span>
                    ) : null}
                </>
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
                    if (target.closest("button, a, input, select, textarea, [role='button'], [data-inline-editing]")) return;
                    // A host's title or date may be the first click of a double-click
                    // (inline edit), so wait a moment before opening the details.
                    if (canEdit && target.closest("[data-inline-edit]")) {
                        window.clearTimeout(pendingDetailsOpenRef.current);
                        pendingDetailsOpenRef.current = window.setTimeout(() => setIsBookersModalOpen(true), 260);
                        return;
                    }
                    setIsBookersModalOpen(true);
                }}
                onDoubleClick={() => window.clearTimeout(pendingDetailsOpenRef.current)}
                className={`
                    relative
                    border rounded-[30px] sm:rounded-[36px] min-[1024px]:rounded-[42px] bg-white
                    transition-all duration-200
                    border-borderGray
                    hover:bg-[#F6F6F6] hover:border-[#A3A3A3]
                    cursor-pointer
                    px-5 py-4 sm:px-6 sm:py-[18px]
                    flex flex-col
                    w-full gap-4
                    ${isOptionsOpen || quickTimeline === "card" ? "z-[220]" : "z-0"}
                `}
            >
                <div className="flex flex-col min-[1024px]:flex-row min-[1024px]:items-center w-full gap-3 min-[1024px]:gap-3 xl:gap-4">
                    <div className="flex w-full min-w-0 items-stretch justify-between gap-3 min-[1024px]:w-auto min-[1024px]:max-w-[600px] min-[1024px]:shrink-0">
                        <Link
                            to={`/profile/${displayedHostId}`}
                            onClick={(event) => event.stopPropagation()}
                            className="shrink-0 self-start rounded-full transition hover:scale-[1.03] hover:opacity-90"
                            title={`View ${hostCardUser.full_name || "host"}'s profile`}
                            aria-label={`View ${hostCardUser.full_name || "host"}'s profile`}
                        >
                            <AvatarCircle user={hostCardUser} size={68} isLive={false} showLiveDot={false} />
                        </Link>

                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-3">
                                <h3 className="flex min-w-0 items-center gap-2 text-[16px] min-[420px]:text-[18px] sm:text-[20px] min-[1024px]:text-[24px] xl:text-[29px] font-bold leading-tight">
                                    {session?.is_private && (
                                        <Lock
                                            size={22}
                                            className="shrink-0 text-[#606060]"
                                            aria-label="Private session"
                                        />
                                    )}
                                    {isHidden && (
                                        <span
                                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#F1F1F1] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#606060]"
                                            title="Hidden from public session lists; direct links still work"
                                        >
                                            <EyeOff size={13} aria-hidden="true" />
                                            Hidden
                                        </span>
                                    )}
                                    <InlineEditableTitle
                                        value={String(session.title || "")}
                                        canEdit={canEdit}
                                        onSave={(title) => onEditSession?.(session.id, { title })}
                                    />
                                </h3>

                                <SessionRoomPolicyIndicator policies={cardRoomPolicies} color={t.color} background={t.bg} />

                            </div>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-[12px] text-[#606060]">
                                <div className={isInfinite ? "hidden min-[481px]:flex items-center gap-1" : "flex items-center gap-1"}>
                                    <img src="/icons/duration.svg" className="w-4 h-4 opacity-70" alt="" />
                                    <span>{isInfinite ? "Infinite" : `${session.duration_minutes} min`}</span>
                                </div>

                                {!isInfinite && (
                                    <div className="flex items-center gap-1">
                                        <img src="/icons/date.svg" className="w-4 h-4 opacity-70" alt="" />
                                        <InlineEditableStart
                                            startTime={session.start_time}
                                            label={startDateString}
                                            canEdit={canEdit}
                                            onSave={(start_time) => onEditSession?.(session.id, { start_time })}
                                        />
                                    </div>
                                )}

                                <div className="inline-flex items-center gap-3">
                                    <div
                                        className="inline-flex items-center gap-1 px-2 min-[481px]:px-3 py-1 rounded-full border"
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

                                    {showLivePresence && peopleInline}



                                    <button
                                        type="button"
                                        className="flex h-8 items-center justify-center gap-1.5 px-1 text-[12px] font-normal text-[#606060] transition hover:text-[#303030]"
                                        title="Session details"
                                        aria-label="Session details"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setIsBookersModalOpen(true);
                                        }}
                                    >
                                        <IconInfo size={15} />
                                        <span>Details</span>
                                    </button>
                                    {musicPlaying && <SessionMusicIndicator color={t.color} />}
                                </div>
                            </div>
                        </div>

                    </div>

                                        <div
                        className={`relative hidden min-[1024px]:block min-[1024px]:min-w-0 min-[1024px]:flex-1 min-[1024px]:px-0 transition-opacity duration-200 ${
                            isHoveringCard || quickTimeline === "card" ? "min-[1024px]:opacity-100" : "min-[1024px]:opacity-0"
                        }`}
                        aria-hidden={!isHoveringCard && quickTimeline !== "card"}
                    >
                        {(() => {
                            const bar = cardStages.length > 0 ? (
                                <SessionStageBar
                                    stages={cardStages}
                                    startTime={timelineStartTime}
                                    cycleSeconds={cycleSeconds}
                                    progressStyle="tick"
                                    tickEveryMs={tickEveryMs}
                                    theme="light"
                                    size="card"
                                />
                            ) : (
                                <div
                                    className="h-[10px] w-full rounded-full bg-[#E7E7E7]"
                                    aria-label="Session timeline"
                                />
                            );
                            if (!canEdit) return bar;
                            // Hosts double-click the timeline to edit it in place.
                            return (
                                <CursorEditHintArea label="Edit timeline" onActivate={() => setQuickTimeline("card")} block>
                                    <div data-inline-edit onDoubleClick={() => setQuickTimeline("card")} title="Double-click to edit the timeline">
                                        {bar}
                                    </div>
                                </CursorEditHintArea>
                            );
                        })()}
                        {quickTimeline === "card" ? (
                            <QuickTimelineEditor
                                session={session}
                                stages={stages}
                                isLoading={isStagesLoading}
                                isInfinite={isInfinite}
                                variant="popover"
                                onSave={(updates) => onEditSession?.(session.id, updates)}
                                onClose={() => setQuickTimeline(null)}
                                onOpenFullEditor={() => {
                                    setQuickTimeline(null);
                                    setIsEditModalOpen(true);
                                }}
                            />
                        ) : null}
                    </div>

                    <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_48px] items-center gap-3 min-[1024px]:flex min-[1024px]:w-auto min-[1024px]:shrink-0 min-[1024px]:justify-end">
                        {showLivePresence && <button
                            type="button"
                            onClick={() => {
                                if (!isGuest) setIsLiveUsersModalOpen(true);
                            }}
                            className={`hidden xl:flex items-center gap-5 xl:mr-3 transition-opacity ${isGuest ? "cursor-default" : "hover:opacity-70"}`}
                            title={isGuest ? GUEST_BLUR_HINT : "People in the session now"}
                            aria-label={isGuest ? GUEST_BLUR_HINT : `${liveNowCount} of ${displayedMaxParticipants} slots occupied${isSessionFull ? ", session full" : ""}`}
                        >
                            <div className="w-px h-10 bg-[#D9D9D9]" />
                            <GuestBlur active={isGuest} block>
                            <div className="w-fit min-w-[74px] text-center">
                                <div className="relative flex min-h-[22px] items-baseline justify-center">
                                    <div className="text-[29px] font-bold leading-[0.92] text-brandBlack">
                                        {liveNowCount}
                                        <span className="ml-1 text-[13px] font-medium text-[#8A8A8A]">
                                            / {displayedMaxParticipants}
                                        </span>
                                    </div>
                                    {isSessionFull && (
                                        <span className="ml-2.5 shrink-0 rounded-full bg-[#2F2F2F] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-white">
                                            Full
                                        </span>
                                    )}
                                </div>
                                <div className="-mt-3 inline-flex flex-col items-stretch">
                                    <div className="text-center text-[10px] leading-none text-[#777777]">
                                        {isSessionFull ? "No slots available" : hasLiveNow ? "slots occupied" : "all slots available"}
                                    </div>
                                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#E7E7E7]">
                                        <div
                                            className={`h-full rounded-full transition-[width,background-color] duration-300 ease-out ${isSessionFull ? "bg-[#2F2F2F]" : "bg-[#65D46C]"}`}
                                            style={{ width: `${occupancyPercent}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                            </GuestBlur>
                        </button>}

                        {isBookingConfirmed ? confirmedBookingButton : bookSessionButton}

                        <button
                            onClick={handleJoinRoom}
                            onMouseEnter={() => {
                                setIsHoveringJoinIframe(true);
                                prefetchRoomPage();
                            }}
                            onFocus={prefetchRoomPage}
                            onTouchStart={prefetchRoomPage}
                            onMouseLeave={() => setIsHoveringJoinIframe(false)}
                            className="
                                h-12 rounded-full px-6 text-[14px] font-semibold
                                flex items-center justify-center
                                transition-all duration-200 ease-in-out
                                w-full min-[1024px]:w-auto min-[1024px]:flex-none min-[1024px]:min-w-[150px] xl:min-w-[160px]
                                text-white
                            "
                            style={{
                                backgroundColor: !canManageSession && isSessionFull
                                    ? "#8A8A8A"
                                    : isHoveringJoinIframe
                                        ? joinHoverBg
                                        : "#2f2f2f",
                                cursor: !canManageSession && isSessionFull ? "not-allowed" : "pointer",
                            }}
                            aria-label={!canManageSession && isSessionFull ? "Session full" : "Join session"}
                        >
                            {!canManageSession && isSessionFull ? "Full" : "Join session"}
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

                                        {canTogglePinned && (
                                            <MenuItem
                                                icon={isPinned ? <PinOff /> : <Pin />}
                                                label={
                                                    isSavingPinned
                                                        ? "Saving…"
                                                        : isPinned
                                                          ? "Unpin from top"
                                                          : "Pin to top"
                                                }
                                                outlined
                                                onClick={async () => {
                                                    if (isSavingPinned) return;
                                                    setIsSavingPinned(true);
                                                    try {
                                                        await onPinnedChange?.(session.id, !isPinned);
                                                        setIsOptionsOpen(false);
                                                    } catch (error) {
                                                        console.error("[SessionCard] pin update failed:", error);
                                                        window.alert("Could not update pinned state. Please try again.");
                                                    } finally {
                                                        setIsSavingPinned(false);
                                                    }
                                                }}
                                            />
                                        )}

                                        {canToggleVisibility && (
                                            <MenuItem
                                                icon={isHidden ? <Eye /> : <EyeOff />}
                                                label={
                                                    isSavingVisibility
                                                        ? "Saving…"
                                                        : isHidden
                                                          ? "Unhide session"
                                                          : "Hide session"
                                                }
                                                outlined
                                                onClick={async () => {
                                                    if (isSavingVisibility) return;
                                                    setIsSavingVisibility(true);
                                                    try {
                                                        await onVisibilityChange?.(session.id, !isHidden);
                                                        setIsOptionsOpen(false);
                                                    } catch (error) {
                                                        console.error("[SessionCard] visibility update failed:", error);
                                                        window.alert("Could not update session visibility. Please try again.");
                                                    } finally {
                                                        setIsSavingVisibility(false);
                                                    }
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
                title="Host this room"
                isOpen={isBookingTimeModalOpen}
                onClose={() => setIsBookingTimeModalOpen(false)}
                widthClass="max-w-[560px]"
                footer={
                    <div className="space-y-3">
                        {bookingDraftError ? (
                            <div className="rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">
                                {bookingDraftError}
                            </div>
                        ) : null}
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setIsBookingTimeModalOpen(false)}
                                className="h-11 rounded-full border border-[#E5E7EB] bg-white px-5 text-[14px] font-semibold text-[#111827] transition hover:bg-[#F3F4F6]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleConfirmInfiniteBooking()}
                                disabled={isSavingHostBooking}
                                className="h-11 flex-1 rounded-full bg-[#111827] px-4 text-[14px] font-semibold text-white transition hover:bg-[#2F2F2F] disabled:cursor-wait disabled:opacity-70"
                            >
                                {isSavingHostBooking ? "Saving…" : repeatWeekDraft ? "Host every day" : "Host this time"}
                            </button>
                        </div>
                    </div>
                }
            >
                <p className="-mt-1 mb-5 text-[13px] leading-5 text-[#6B7280]">
                    Your name and time show in the room's schedule, so people know when to join.
                </p>
                <HostTimePicker
                    dayYmd={bookingDateDraft}
                    startHhmm={bookingStartTimeDraft}
                    durationMinutes={bookingDurationDraft}
                    repeatWeek={repeatWeekDraft}
                    busy={hostBusyWindows}
                    onDayChange={(ymd) => {
                        setBookingDateDraft(ymd);
                        setBookingDraftError("");
                    }}
                    onStartChange={(hhmm) => {
                        setBookingStartTimeDraft(hhmm);
                        setBookingDraftError("");
                    }}
                    onDurationChange={(minutes) => {
                        setBookingDurationDraft(minutes);
                        setBookingDraftError("");
                    }}
                    onRepeatWeekChange={setRepeatWeekDraft}
                />
            </ModalShell>

            <ModalShell
                title={`In session (${liveNowCount})`}
                isOpen={isLiveUsersModalOpen}
                onClose={() => setIsLiveUsersModalOpen(false)}
                widthClass="max-w-[460px]"
            >
                <div className="mb-4 text-[12px] text-[#606060]">
                    People currently focusing in this session.
                </div>

                <div className="flex flex-col gap-2">
                    {liveNowCount === 0 ? (
                        <div className="rounded-[16px] border border-dashed border-[#D1D5DB] px-4 py-6 text-center text-[13px] text-[#606060]">
                            No one is in the session right now.
                        </div>
                    ) : liveUsers.length === 0 ? (
                        <div className="rounded-[16px] border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-4 text-[13px] text-[#606060]">
                            {isLiveLoading
                                ? "Loading people in the session…"
                                : `${liveNowCount} people are currently online. Their profiles may be private or still loading.`}
                        </div>
                    ) : (
                        liveUsers.map((user) => {
                            const label = user.full_name || user.id || "Participant";

                            return (
                                <Link
                                    key={user.id}
                                    to={`/profile/${user.id}`}
                                    onClick={() => setIsLiveUsersModalOpen(false)}
                                    className="flex items-center gap-3 rounded-[16px] border border-[#F0F0F0] px-3 py-2 transition hover:border-[#E5E7EB] hover:bg-[#F6F6F6]"
                                >
                                    <AvatarCircle user={user} size={34} isLive={true} showLiveDot={true} />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-[13px] font-semibold text-[#111827]">{label}</div>
                                        <div className="text-[11px] font-semibold text-[#49A650]">Online now</div>
                                    </div>
                                </Link>
                            );
                        })
                    )}
                </div>
            </ModalShell>

            {isBookersModalOpen ? (
                // Session details: a centered modal on desktop, a bottom sheet on phones.
                <div className="fixed inset-0 z-[950] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Session details">
                    <button
                        type="button"
                        className="session-booking-drawer-backdrop absolute inset-0 bg-black/30 backdrop-blur-[2px]"
                        aria-label="Close session details"
                        onClick={() => setIsBookersModalOpen(false)}
                    />

                    <aside className="session-booking-drawer relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_24px_80px_rgba(17,24,39,0.22)] sm:max-h-[min(90vh,900px)] sm:max-w-[1280px] sm:rounded-[32px]">
                        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
                            <span className="h-1 w-10 rounded-full bg-[#DBD8D8]" />
                        </div>
                        {/* One line: title, start date and time, status. */}
                        <header className="flex shrink-0 items-center gap-4 px-6 pb-4 pt-3 sm:px-10 sm:py-6">
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
                                <h3 className="flex min-w-0 items-center gap-2 text-[22px] font-bold leading-tight text-[#111827] sm:text-[28px]">
                                    {session?.is_private ? <Lock size={22} className="shrink-0 text-[#606060]" aria-label="Private session" /> : null}
                                    {/* Hosts rename and reschedule here too, by double-click. */}
                                    <InlineEditableTitle
                                        value={String(session.title || "")}
                                        canEdit={canEdit}
                                        onSave={(title) => onEditSession?.(session.id, { title })}
                                    />
                                </h3>
                                <span className="whitespace-nowrap text-[14px] font-semibold text-[#3F6FD8] sm:text-[16px]">
                                    {isInfinite ? (
                                        "Always open"
                                    ) : (
                                        <InlineEditableStart
                                            startTime={session.start_time}
                                            label={drawerStartShort ? `${drawerStartShort.date} · ${drawerStartShort.time}` : drawerWhen.date}
                                            canEdit={canEdit}
                                            onSave={(start_time) => onEditSession?.(session.id, { start_time })}
                                        />
                                    )}
                                </span>
                                <span className="flex flex-wrap items-center gap-2">
                                    {drawerStatus.live ? (
                                        <span className="inline-flex items-center gap-2 rounded-full bg-[#65D46C]/15 px-3 py-1 text-[12px] font-semibold text-[#2F8F35]">
                                            <span className="h-2 w-2 rounded-full bg-[#65D46C]" aria-hidden="true" />
                                            {drawerStatus.label}
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center rounded-full bg-[#F3F4F6] px-3 py-1 text-[12px] font-semibold text-[#2F2F2F]">
                                            {drawerStatus.label}
                                        </span>
                                    )}
                                    {isBookingConfirmed ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#65D46C] px-3 py-1 text-[12px] font-semibold text-[#2F8F35]">
                                            <img src="/icons/book-session-green.svg" className="h-3.5 w-3.5" alt="" aria-hidden="true" />
                                            You're booked
                                        </span>
                                    ) : null}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => void handleCopyInviteLink()}
                                title={publicSessionUrl}
                                aria-label="Copy session link"
                                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 self-start rounded-full border text-[13px] font-semibold transition sm:w-auto sm:self-center sm:px-4 ${copyInviteState === "copied" ? "border-[#65D46C] bg-[#65D46C]/10 text-[#2F8F35]" : "border-[#E5E7EB] text-[#2F2F2F] hover:border-[#A3A3A3]"}`}
                            >
                                {copyInviteState === "copied" ? <CheckIcon size={14} strokeWidth={2.4} aria-hidden="true" /> : <Link2 size={14} strokeWidth={2} aria-hidden="true" />}
                                <span className="hidden sm:inline">
                                    {copyInviteState === "copied" ? "Link copied" : copyInviteState === "error" ? "Copy failed" : "Copy link"}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsBookersModalOpen(false)}
                                className="flex h-10 w-10 shrink-0 items-center justify-center self-start rounded-full border border-[#E5E7EB] text-[#606060] transition hover:border-[#A3A3A3] hover:text-[#111827] sm:self-center"
                                aria-label="Close session details"
                            >
                                <XIcon size={18} strokeWidth={2.2} aria-hidden="true" />
                            </button>
                        </header>

                        {/* Phones scroll the whole body; from 1024px the two columns scroll on their own. */}
                        <div className="min-h-0 flex-1 overflow-y-auto border-t border-[#F0F0F0] lg:grid lg:grid-cols-[minmax(0,1fr)_440px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
                        <div className="px-6 pb-6 sm:px-10 sm:pb-8 lg:min-h-0 lg:overflow-y-auto">
                            {/* Host and session flow share one line. */}
                            <section className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:gap-5">
                                <Link
                                    to={`/profile/${displayedHostId}`}
                                    {...profileHoverAttrs(String(displayedHostId || ""), hostCardUser.full_name)}
                                    onClick={() => setIsBookersModalOpen(false)}
                                    className="group flex min-w-0 shrink-0 items-center gap-3 sm:max-w-[220px]"
                                >
                                    <AvatarCircle user={hostCardUser} size={40} isLive={false} showLiveDot={false} />
                                    <span className="min-w-0">
                                        <span className="block text-[11px] font-medium text-[#7A7A7A]">Hosted by</span>
                                        <span className="block truncate text-[14px] font-semibold text-[#111827] group-hover:underline">
                                            {hostCardUser.full_name || "Not assigned"}
                                        </span>
                                    </span>
                                </Link>
                                {quickTimeline === "drawer" ? (
                                    <div className="min-w-0 flex-1">
                                        <QuickTimelineEditor
                                            session={session}
                                            stages={stages}
                                            isLoading={isStagesLoading}
                                            isInfinite={isInfinite}
                                            variant="inline"
                                            onSave={(updates) => onEditSession?.(session.id, updates)}
                                            onClose={() => setQuickTimeline(null)}
                                            onOpenFullEditor={() => {
                                                setQuickTimeline(null);
                                                setIsEditModalOpen(true);
                                            }}
                                        />
                                    </div>
                                ) : (
                                <div className="min-w-0 flex-1 rounded-[16px] border border-[#EEEEEE] px-3 py-2.5" aria-label="Session flow">
                                    {(() => {
                                        const flow = stagesVisual?.length ? (
                                            <SessionStageBar
                                                {...({
                                                    stages: stagesVisual,
                                                    startTime: timelineStartTime,
                                                    cycleSeconds,
                                                    progressStyle: "tick",
                                                    tickEveryMs,
                                                    // The modal's column scrolls and would clip the tooltip.
                                                    tooltipPortal: true,
                                                } as any)}
                                            />
                                        ) : (
                                            <div className="text-[12px] text-[#8A8A8A]">
                                                {isStagesLoading ? "Loading session stages…" : "No timeline stages configured."}
                                            </div>
                                        );
                                        if (!canEdit) return flow;
                                        return (
                                            <CursorEditHintArea label="Edit timeline" onActivate={() => setQuickTimeline("drawer")} block>
                                                <div onDoubleClick={() => setQuickTimeline("drawer")} title="Double-click to edit the timeline">
                                                    {flow}
                                                </div>
                                            </CursorEditHintArea>
                                        );
                                    })()}
                                </div>
                                )}
                            </section>

                            <section className="mt-4 grid grid-cols-3 divide-x divide-[#E3E3E3] rounded-[18px] bg-[#F6F6F6] py-3">
                                {[
                                    { label: "Length", value: isInfinite ? "24/7" : `${session.duration_minutes} min` },
                                    { label: isInfinite ? "Planned" : "Booked", value: String(bookedCount), people: true },
                                    { label: "In room", value: `${liveNowCount}/${displayedMaxParticipants}`, people: true },
                                ].map((fact) => (
                                    <div key={fact.label} className="min-w-0 px-4 sm:px-5">
                                        <div className="text-[11px] font-medium text-[#7A7A7A]">{fact.label}</div>
                                        <div className="mt-0.5 truncate text-[18px] font-bold leading-6 text-[#111827] sm:text-[20px]">
                                            <GuestBlur active={isGuest && !!fact.people}>{fact.value}</GuestBlur>
                                        </div>
                                    </div>
                                ))}
                            </section>

                            {/* Details in one line of chips. */}
                            <section className="mt-3 flex flex-wrap items-center gap-2" aria-label="Details">
                                {/* The session type uses the same badge as the session card. */}
                                <span
                                    className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium"
                                    style={{ backgroundColor: t.bg, color: t.color, borderColor: t.color }}
                                    title={isInfinite ? `${resolvedType} · 24/7 room` : resolvedType}
                                >
                                    <img
                                        src={t.icon}
                                        className="h-3.5 w-3.5"
                                        alt=""
                                        aria-hidden="true"
                                        onError={(e) => { e.currentTarget.src = "/icons/deepwork.svg"; }}
                                    />
                                    {resolvedType}
                                </span>
                                {drawerDetails.map((detail) => (
                                    <span
                                        key={detail.key}
                                        title={detail.sub ? `${detail.label}: ${detail.sub}` : detail.label}
                                        className="inline-flex h-9 max-w-full items-center gap-2 rounded-full border border-[#EEEEEE] bg-white pl-1 pr-3 text-[13px]"
                                    >
                                        <span
                                            className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full ${DETAIL_TONE_CLASSES[detail.tone]}`}
                                            style={detail.tone === "type" ? { backgroundColor: t.bg, color: t.color } : undefined}
                                            aria-hidden="true"
                                        >
                                            {detail.icon}
                                        </span>
                                        <span className="truncate font-semibold text-[#111827]">{detail.value}</span>
                                        {/* How many seats are taken is participant info: blurred for guests. */}
                                        <GuestBlur active={isGuest && detail.key === "capacity"} className="inline-flex items-center gap-2">
                                        {detail.sub ? <span className="hidden truncate text-[#8A8A8A] sm:inline">{detail.sub}</span> : null}
                                        {detail.meter != null ? (
                                            <span className="inline-block h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-[#F1F1F1] align-middle" aria-hidden="true">
                                                <span className="block h-full rounded-full" style={{ width: `${Math.round(detail.meter * 100)}%`, backgroundColor: t.color }} />
                                            </span>
                                        ) : null}
                                        </GuestBlur>
                                    </span>
                                ))}

                            </section>

                            {description ? (
                                <section className="pt-5">
                                    <h4 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#7A7A7A]">About</h4>
                                    <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-[1.55] text-[#334155]">{description}</p>
                                </section>
                            ) : null}

                            {seriesList ? (
                                <section className="pt-6" aria-label="This week">
                                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                        <h4 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#7A7A7A]">This week</h4>
                                        <p className="text-[12px] text-[#8A8A8A]">
                                            {isHost
                                                ? `You host ${seriesList.length} sessions in the next ${SERIES_WINDOW_DAYS} days`
                                                : `Same time, same host · ${seriesList.length} sessions in the next ${SERIES_WINDOW_DAYS} days`}
                                        </p>
                                    </div>

                                    {/* Compact day chips with the booking action at the end of the same line. */}
                                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                                        {seriesList.map((occurrence) => {
                                            const start = new Date(occurrence.startTime);
                                            const isCurrent = occurrence.id === String(session.id);
                                            const pending =
                                                seriesPending === occurrence.id ||
                                                (seriesPending === "all" && !occurrence.booked) ||
                                                (seriesPending === "cancel" && occurrence.booked);
                                            const dayLabel = start.toLocaleDateString("en-US", { weekday: "short" });
                                            const fullLabel = start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

                                            return (
                                                <button
                                                    key={occurrence.id}
                                                    type="button"
                                                    disabled={isHost || !!seriesPending}
                                                    onClick={() => void handleToggleSeriesOccurrence(occurrence)}
                                                    aria-pressed={occurrence.booked}
                                                    aria-label={`${fullLabel}: ${occurrence.booked ? "booked, click to cancel" : "not booked, click to book"}`}
                                                    title={isCurrent ? `${fullLabel} · this session` : fullLabel}
                                                    className={`inline-flex h-9 items-center gap-1 rounded-full border px-3 text-[12px] transition disabled:cursor-default ${occurrence.booked
                                                        ? "border-[#65D46C] bg-[#65D46C]/10 text-[#2F8F35]"
                                                        : "border-[#E5E7EB] bg-white text-[#2F2F2F] enabled:hover:border-[#A3A3A3]"
                                                        } ${isCurrent ? "ring-1 ring-[#2F2F2F] ring-offset-1" : ""} ${pending ? "opacity-50" : ""}`}
                                                >
                                                    {occurrence.booked ? <CheckIcon size={12} strokeWidth={2.6} aria-hidden="true" /> : null}
                                                    <span className="opacity-70">{dayLabel}</span>
                                                    <span className="font-semibold tabular-nums">{start.getDate()}</span>
                                                </button>
                                            );
                                        })}

                                        {!isHost ? (
                                            <span className="ml-auto flex items-center gap-1">
                                                {seriesBookedIds.length > 1 ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleCancelWholeSeries()}
                                                        disabled={!!seriesPending}
                                                        className="h-9 rounded-full px-3 text-[12px] font-semibold text-[#7A7A7A] transition hover:text-[#D83F3F] disabled:opacity-60"
                                                    >
                                                        {seriesPending === "cancel" ? "Cancelling…" : `Cancel all ${seriesBookedIds.length}`}
                                                    </button>
                                                ) : null}
                                                {seriesOpenIds.length ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleBookWholeSeries()}
                                                        disabled={!!seriesPending}
                                                        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#2F2F2F] px-4 text-[13px] font-semibold text-white transition hover:bg-[#111827] disabled:opacity-60"
                                                    >
                                                        <img src="/icons/book-session-green.svg" className="h-3.5 w-3.5 brightness-0 invert" alt="" aria-hidden="true" />
                                                        {seriesPending === "all"
                                                            ? "Booking…"
                                                            : seriesBookedIds.length
                                                                ? `Book the other ${seriesOpenIds.length}`
                                                                : `Book all ${seriesOpenIds.length}`}
                                                    </button>
                                                ) : (
                                                    <span className="px-1 text-[12px] font-semibold text-[#2F8F35]">Booked for the whole week</span>
                                                )}
                                            </span>
                                        ) : null}
                                    </div>
                                    {seriesMessage ? (
                                        <p className="mt-2 text-[12px] font-medium text-[#D83F3F]" role="status">{seriesMessage}</p>
                                    ) : null}
                                </section>
                            ) : null}
                        </div>

                        <div className="border-t border-[#F0F0F0] px-6 pb-6 sm:px-10 sm:pb-8 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:bg-[#FAFAFA] lg:px-8">
                            <section className="pt-6">
                                <div className="flex items-center justify-between gap-3">
                                    <h4 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#7A7A7A]">In the room now</h4>
                                    <GuestBlur active={isGuest}>
                                        <span className="text-[12px] font-semibold text-[#606060]">{liveNowCount}</span>
                                    </GuestBlur>
                                </div>
                                <GuestBlur active={isGuest} block>
                                {liveUsers.length === 0 ? (
                                    <p className="mt-2 text-[13px] text-[#7A7A7A]">
                                        {liveNowCount > 0 ? `${liveNowCount} ${liveNowCount === 1 ? "person is" : "people are"} focusing right now.` : "No one is in the room right now."}
                                    </p>
                                ) : (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {liveUsers.slice(0, DRAWER_LIVE_PREVIEW).map((u) => (
                                            <Link
                                                key={u.id}
                                                to={`/profile/${u.id}`}
                                                {...profileHoverAttrs(u.id, u.full_name)}
                                                onClick={() => setIsBookersModalOpen(false)}
                                                className="flex max-w-full items-center gap-2 rounded-full border border-[#EEEEEE] bg-white py-1 pl-1 pr-3 transition hover:border-[#A3A3A3]"
                                            >
                                                <AvatarCircle user={u} size={28} isLive={true} showLiveDot={true} />
                                                <span className="min-w-0 truncate text-[12px] font-semibold text-[#111827]">
                                                    {u.id === userId ? "You" : u.full_name || "Participant"}
                                                </span>
                                            </Link>
                                        ))}
                                        {liveNowCount > Math.min(liveUsers.length, DRAWER_LIVE_PREVIEW) ? (
                                            <span className="flex items-center rounded-full bg-[#F1F1F1] px-3 text-[12px] font-semibold text-[#606060]">
                                                +{liveNowCount - Math.min(liveUsers.length, DRAWER_LIVE_PREVIEW)}
                                            </span>
                                        ) : null}
                                    </div>
                                )}
                                </GuestBlur>
                            </section>

                            {isInfinite ? (
                                <section className="pt-6">
                                    <div className="flex items-end justify-between gap-3">
                                        <h4 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#7A7A7A]">Hosting schedule</h4>
                                        <span className="text-[11px] text-[#A3A3A3]">Your local time</span>
                                    </div>
                                    {hostingScheduleDays.length === 0 ? (
                                        <div className="mt-3 rounded-[20px] border border-dashed border-[#D1D5DB] px-5 py-7 text-center">
                                            <div className="text-[14px] font-semibold text-[#111827]">No one is hosting yet</div>
                                            <div className="mt-1 text-[12px] leading-5 text-[#606060]">Pick a time to host and people will see when the room has company.</div>
                                        </div>
                                    ) : (
                                        <div className="mt-3 space-y-4">
                                            {hostingScheduleDays.map((day) => (
                                                <div key={day.key}>
                                                    <div className="mb-1.5 flex items-center gap-2 px-1">
                                                        <span className={`text-[12px] font-semibold ${day.isToday ? "text-[#3F6FD8]" : "text-[#2F2F2F]"}`}>{day.label}</span>
                                                        <span className="h-px flex-1 bg-[#EEEEEE]" aria-hidden="true" />
                                                    </div>
                                                    <div className="overflow-hidden rounded-[18px] border border-[#EEEEEE]">
                                                        {day.items.map((booking, index) => {
                                                            const label = booking.full_name || booking.id || "Host";
                                                            const isLive = liveIdSet.has(booking.id);
                                                            const isCurrentUser = booking.id === userId;
                                                            const startMs = Date.parse(String(booking.booked_start_time || ""));
                                                            const endMs = Date.parse(String(booking.booked_end_time || ""));
                                                            const isNow = Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= scheduleNowMs && scheduleNowMs < endMs;
                                                            const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

                                                            return (
                                                                <Link
                                                                    key={`${booking.id}-${booking.booked_start_time || ""}`}
                                                                    to={`/profile/${booking.id}`}
                                                                    onClick={() => setIsBookersModalOpen(false)}
                                                                    className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${index > 0 ? "border-t border-[#F1F1F1]" : ""} ${isNow ? "bg-[#EEF3FE]" : "hover:bg-[#F6F6F6]"}`}
                                                                >
                                                                    <div className="w-[64px] shrink-0 leading-tight">
                                                                        <div className={`text-[13px] font-semibold tabular-nums ${isNow ? "text-[#3F6FD8]" : "text-[#2F2F2F]"}`}>
                                                                            {Number.isFinite(startMs) ? new Date(startMs).toLocaleTimeString("en-US", timeOpts) : "—"}
                                                                        </div>
                                                                        <div className="text-[11px] tabular-nums text-[#8A8A8A]">
                                                                            {Number.isFinite(endMs) ? `to ${new Date(endMs).toLocaleTimeString("en-US", timeOpts)}` : ""}
                                                                        </div>
                                                                    </div>
                                                                    <AvatarCircle user={booking} size={32} isLive={isLive} showLiveDot={isLive} />
                                                                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#111827]">{label}</span>
                                                                    {isCurrentUser ? (
                                                                        <span className="shrink-0 rounded-full bg-[#F1F1F1] px-2 py-0.5 text-[10px] font-semibold text-[#606060]">you</span>
                                                                    ) : null}
                                                                    {isNow ? (
                                                                        <span className="shrink-0 rounded-full bg-[#5286F6] px-2 py-0.5 text-[10px] font-semibold text-white">Now</span>
                                                                    ) : null}
                                                                </Link>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            ) : (
                                <section className="pt-6">
                                    <div className="flex items-center justify-between gap-3">
                                        <h4 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#7A7A7A]">Who's coming</h4>
                                        <GuestBlur active={isGuest}>
                                            <span className="text-[12px] font-semibold text-[#606060]">{bookedCount}</span>
                                        </GuestBlur>
                                    </div>
                                    <GuestBlur active={isGuest} block>
                                    {bookers.length === 0 ? (
                                        <p className="mt-2 text-[13px] text-[#7A7A7A]">No one has booked yet. Be the first.</p>
                                    ) : (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {(showAllDrawerBookers ? bookers : bookers.slice(0, DRAWER_BOOKERS_PREVIEW)).map((booking) => {
                                                const label = booking.full_name || booking.id || "Participant";
                                                const isLive = liveIdSet.has(booking.id);
                                                const isBookingHost = booking.id === effectiveHostId;

                                                return (
                                                    <Link
                                                        key={booking.id}
                                                        to={`/profile/${booking.id}`}
                                                        {...profileHoverAttrs(booking.id, label)}
                                                        onClick={() => setIsBookersModalOpen(false)}
                                                        className={`flex max-w-full items-center gap-2 rounded-full border bg-white py-1 pl-1 pr-3 transition hover:border-[#A3A3A3] ${isLive ? "border-[#65D46C]" : "border-[#EEEEEE]"}`}
                                                    >
                                                        <AvatarCircle user={booking} size={28} isLive={isLive} showLiveDot={isLive} />
                                                        <span className="min-w-0 truncate text-[12px] font-semibold text-[#111827]">
                                                            {booking.id === userId ? "You" : label}
                                                        </span>
                                                        {isBookingHost ? (
                                                            <span className="shrink-0 rounded-full bg-[#2F2F2F] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">Host</span>
                                                        ) : null}
                                                    </Link>
                                                );
                                            })}
                                            {bookers.length > DRAWER_BOOKERS_PREVIEW ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setShowAllDrawerBookers((value) => !value)}
                                                    className="flex h-9 items-center rounded-full bg-[#F1F1F1] px-3 text-[12px] font-semibold text-[#606060] transition hover:text-[#111827]"
                                                >
                                                    {showAllDrawerBookers ? "Show less" : `+${bookers.length - DRAWER_BOOKERS_PREVIEW} more`}
                                                </button>
                                            ) : null}
                                        </div>                                    )}
                                    </GuestBlur>
                                </section>
                            )}
                        </div>
                        </div>

                        <footer className="shrink-0 border-t border-[#EEEEEE] px-6 py-4 sm:px-10">
                            <div className="flex gap-2 sm:justify-end sm:[&>button]:max-w-[240px]">
                                {isBookingConfirmed ? (
                                    isInfinite ? (
                                        <button
                                            type="button"
                                            onClick={() => void handleBookSession()}
                                            className="h-12 flex-1 rounded-full border border-[#2F2F2F] text-[14px] font-semibold text-[#2F2F2F] transition hover:bg-[#F6F6F6]"
                                        >
                                            Change my hosting
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={handleCancelBooking}
                                            className="h-12 flex-1 rounded-full border border-[#E5E7EB] text-[14px] font-semibold text-[#606060] transition hover:border-[#F65252] hover:bg-[#F65252]/5 hover:text-[#D83F3F]"
                                        >
                                            Cancel booking
                                        </button>
                                    )
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => void handleBookSession()}
                                        className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-[#2F2F2F] text-[14px] font-semibold text-[#2F2F2F] transition hover:border-[#65D46C] hover:bg-[#65D46C]/10 hover:text-[#2F8F35]"
                                    >
                                        {isInfinite ? "Host a time" : "Book session"}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={handleJoinRoom}
                                    onMouseEnter={prefetchRoomPage}
                                    onFocus={prefetchRoomPage}
                                    onTouchStart={prefetchRoomPage}
                                    className={`h-12 flex-1 rounded-full text-[14px] font-semibold text-white transition ${!canManageSession && isSessionFull ? "cursor-not-allowed bg-[#8A8A8A]" : "bg-[#2F2F2F] hover:bg-[#111827]"}`}
                                >
                                    {!canManageSession && isSessionFull ? "Full" : "Join session"}
                                </button>
                            </div>
                            {isInfinite && isBookingConfirmed ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        handleCancelBooking();
                                        setIsBookersModalOpen(false);
                                    }}
                                    className="mx-auto mt-2 block rounded-full px-3 py-1 text-[12px] font-semibold text-[#7A7A7A] transition hover:text-[#D83F3F]"
                                >
                                    Cancel my booking
                                </button>
                            ) : null}
                        </footer>
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
                    resolvedStages={stages}
                    currentUserId={userId}
                    canManageAnySession={canManageAnySession}
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
                    onHostTransferred={async (newHost) => {
                        setHostIdOverride(newHost.id);
                        await onHostTransferComplete?.();
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
                description="You’ve used your 15 free sessions. Upgrade to Pro to keep joining sessions without limits."
            />
        </>
    );
}
