// src/components/SessionCard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SessionStageBar } from "./SessionStageBar";
import type { SessionStage } from "../SessionConfig";

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

interface SessionCardProps {
    session: any;
    userId?: string;

    onBook: (sessionId: string) => void;
    onCancelBooking: (sessionId: string) => void;
    onJoin: (sessionId: string) => void;
    onDelete: (sessionId: string) => void;

    onEditSession?: (
        sessionId: string,
        updates: {
            title?: string;
            start_time?: string; // ISO
            max_participants?: number | null;
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

type BookedUser = { id: string; full_name?: string; avatar_url?: string };

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

/**
 * ✅ Extract bookers from nested select:
 * session_bookings ( user_id, profiles:profiles ( id, full_name, avatar_url ) )
 *
 * ❌ Privacy: do NOT keep or show emails
 */
function extractBookers(session: any): BookedUser[] {
    const raw = session?.session_bookings || [];
    if (!Array.isArray(raw)) return [];

    const users: BookedUser[] = raw
        .map((b: any) => {
            const uid = b?.user_id || b?.userId;
            const p = b?.profiles || b?.profile || b?.user || null;

            const full_name = p?.full_name ?? p?.name ?? b?.full_name ?? b?.name;
            const avatar_url = p?.avatar_url ?? b?.avatar_url;

            if (!uid) return null;
            return { id: String(uid), full_name, avatar_url } as BookedUser;
        })
        .filter(Boolean);

    const seen = new Set<string>();
    const out: BookedUser[] = [];
    for (const u of users) {
        if (!u) continue;
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        out.push(u);
    }
    return out;
}

// ✅ NEW: infer visual type from title for newer/infinite room titles
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
                    className={`w-full ${widthClass} rounded-[24px] bg-white border border-[#E5E7EB] shadow-xl`}
                >
                    <div className="px-5 py-4 flex items-center justify-between border-b border-[#F0F0F0]">
                        <div className="text-[16px] font-bold text-[#111827]">{title}</div>
                        <button
                            onClick={onClose}
                            className="h-9 w-9 rounded-full hover:bg-[#F3F4F6] flex items-center justify-center"
                            aria-label="Close"
                        >
                            <span className="text-[18px] leading-none">×</span>
                        </button>
                    </div>
                    <div className="p-5">{children}</div>
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

function IconInvite({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 6h16v12H4V6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
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
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
            <path d="M12 10v7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 7.25h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
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

/**
 * ✅ Options icon from file:
 * Put your custom SVG here: public/icons/options.svg  ->  "/icons/options.svg"
 */
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

function InfoSmartIcon({ hovered, size = 16 }: { hovered: boolean; size?: number }) {
    const [useFallback, setUseFallback] = useState(false);

    if (useFallback) return <IconInfo size={size} />;

    return (
        <img
            src="/icons/info.svg"
            alt=""
            draggable={false}
            onError={() => setUseFallback(true)}
            style={{
                width: size,
                height: size,
                // делаем белой на hover/pinned ровно как options
                filter: hovered ? "brightness(0) invert(1)" : "none",
                opacity: 0.85,
            }}
        />
    );
}

function MenuItem({
    icon,
    label,
    danger,
    outlined,
    onClick,
}: {
    icon: any;
    label: string;
    danger?: boolean;
    outlined?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            className={[
                "w-full text-left px-3 py-2 rounded-[12px] text-[13px] font-semibold flex items-center gap-2 transition",
                outlined
                    ? "border border-[#E5E7EB] hover:border-[#111827] hover:bg-[#F6F6F6]"
                    : "hover:bg-[#F3F4F6]",
                danger ? "text-[#F65252] hover:bg-[#FFF1F2]" : "text-[#111827]",
            ].join(" ")}
            onClick={onClick}
        >
            <span className={danger ? "text-[#F65252]" : "text-[#111827]"}>{icon}</span>
            <span>{label}</span>
        </button>
    );
}

// ✅ Detect studio/custom sessions (prefer DB flag; fallback to formatLabel)
function isCustomStudioSession(session: any): boolean {
    if (session?.is_custom === true) return true;

    const f = safeLower(session?.format);
    if (f.includes("(studio)") || f.includes("session studio")) return true;

    const via = safeLower(session?.created_via);
    if (via === "studio") return true;

    return false;
}

/** =========================
 * ✅ Stages resolver
 * Derive from:
 *   1) session.schedule.timer.phases
 *   2) embedded template schedule
 *   3) session.stages_json / template.stages_json
 *   4) optional session_stages table
 * ========================= */
function tryParseJson<T = any>(x: any): T | null {
    if (!x) return null;
    if (typeof x === "object") return x as T;
    if (typeof x === "string") {
        const s = x.trim();
        if (!s) return null;
        try {
            return JSON.parse(s) as T;
        } catch {
            return null;
        }
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
            const color = s.color ?? s.stage_color ?? s.stageColor;

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
            color: p?.color,
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
    if (!schedule || typeof schedule !== "object") return [];

    const phases =
        schedule?.timer?.phases ||
        schedule?.phases ||
        schedule?.timer?.blocks ||
        schedule?.blocks;

    if (Array.isArray(phases) && phases.length) return phasesToStages(phases);

    const focusSec = Number(schedule?.timer?.focusSeconds || schedule?.timer?.focus_seconds);
    const breakSec = Number(schedule?.timer?.breakSeconds || schedule?.timer?.break_seconds);
    const cycles = Number(schedule?.timer?.cycles || schedule?.timer?.rounds);

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

let _hasSessionStagesTable: boolean | null = null;
const _stagesBySessionId = new Map<string, SessionStage[]>();
const _stagesByTemplateId = new Map<string, SessionStage[]>();

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

    const fromSessionJson =
        tryParseJson<any[]>(session?.stages_json) ||
        tryParseJson<any[]>(session?.session_stages_json);
    if (Array.isArray(fromSessionJson) && fromSessionJson.length) {
        const out = normalizeStages(sortStagesInClient(fromSessionJson));
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
        const embStagesJson =
            tryParseJson<any[]>(embeddedTemplate?.stages_json) ||
            tryParseJson<any[]>(embeddedTemplate?.stages);

        if (Array.isArray(embStagesJson) && embStagesJson.length) {
            const out = normalizeStages(sortStagesInClient(embStagesJson));
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
    if (!sb) return [];
    await ensureAuthReady(sb);

    if (_hasSessionStagesTable !== false && sessionId) {
        const { data: ssData, error: ssErr } = await sb
            .from("session_stages")
            .select("*")
            .eq("session_id", session.id);

        if (ssErr) {
            if (isNotFoundErr(ssErr)) _hasSessionStagesTable = false;
        } else if (Array.isArray(ssData) && ssData.length) {
            _hasSessionStagesTable = true;
            const out = normalizeStages(sortStagesInClient(ssData));
            _stagesBySessionId.set(sessionId, out);
            return out;
        }
    }

    const templateId = getTemplateIdFromSession(session);
    if (templateId && _stagesByTemplateId.has(templateId)) {
        const out = _stagesByTemplateId.get(templateId)!;
        if (sessionId) _stagesBySessionId.set(sessionId, out);
        return out;
    }

    if (templateId) {
        const { data: tData, error: tErr } = await sb
            .from("session_templates")
            .select("id, stages, stages_json, schedule, description")
            .eq("id", templateId)
            .maybeSingle();

        if (!tErr && tData) {
            const sj =
                tryParseJson<any[]>(tData?.stages_json) || tryParseJson<any[]>(tData?.stages);
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

    return [];
}

/** =========================
 * ✅ Live users resolver (ACTIVE = last_seen_at within window)
 * ========================= */
function normalizeUsers(raw: any[]): BookedUser[] {
    const users: BookedUser[] = (raw || [])
        .map((row: any) => {
            const p = row?.profiles || row?.profile || row?.user || null;
            const uid = row?.user_id || row?.userId || p?.id || row?.id;
            if (!uid) return null;
            return {
                id: String(uid),
                full_name: p?.full_name ?? p?.name ?? row?.full_name ?? row?.name,
                avatar_url: p?.avatar_url ?? row?.avatar_url,
            } as BookedUser;
        })
        .filter(Boolean);

    const seen = new Set<string>();
    const out: BookedUser[] = [];
    for (const u of users) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        out.push(u);
    }
    return out;
}

/** === local time parser for current-stage calc (also used for last_seen_at) === */
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

/** ✅ NEW: parse Postgres counts that may come as bigint strings */
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

const LIVE_ACTIVE_WINDOW_MS = 2 * 60 * 1000; // last_seen_at within 2 minutes = "in session now"
const LIVE_FALLBACK_JOIN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // ✅ if last_seen_at missing/null, accept joined_at/created_at within 24h

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

        // left_at might not exist in your schema
        if (r?.left_at) return false;

        const ls = parseTimeMs(r?.last_seen_at);
        if (ls != null) return ls >= cutoffMs;

        // joined_at might not exist; created_at is a good fallback in your current schema
        const j = parseTimeMs(r?.joined_at ?? r?.created_at);
        if (j != null) return j >= joinCutoffMs;

        return true;
    });
}

async function fetchLiveUsers(sessionId: string): Promise<BookedUser[]> {
    const sb = getSupabase();
    if (!sb) return [];
    await ensureAuthReady(sb);
    // ✅ 0) Try SECURITY DEFINER RPC first (bypasses RLS issues)
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

    // 1) Try session_attendance
    {
        const selectSimple =
            "user_id, profiles:profiles(id, full_name, avatar_url), last_seen_at, created_at";

        let res = await sb
            .from("session_attendance")
            .select(selectSimple)
            .eq("session_id", sessionId)
            .order("last_seen_at", { ascending: false });

        if (res.error && isColumnMissingErr(res.error, "last_seen_at")) {
            res = await sb
                .from("session_attendance")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), created_at")
                .eq("session_id", sessionId)
                .order("created_at", { ascending: false });
        }

        if (!res.error && Array.isArray(res.data)) {
            const rows = filterActiveRows(res.data, cutoffMs);
            return normalizeUsers(rows);
        }

        // legacy attempt
        const selectLegacy =
            "user_id, profiles:profiles(id, full_name, avatar_url), left_at, joined_at, last_seen_at, created_at";

        let legacy = await sb
            .from("session_attendance")
            .select(selectLegacy)
            .eq("session_id", sessionId)
            .is("left_at", null)
            .order("joined_at", { ascending: false });

        if (legacy.error && isColumnMissingErr(legacy.error, "left_at")) {
            legacy = await sb
                .from("session_attendance")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), joined_at, last_seen_at, created_at")
                .eq("session_id", sessionId)
                .order("joined_at", { ascending: false });
        }

        if (legacy.error && isColumnMissingErr(legacy.error, "joined_at")) {
            legacy = await sb
                .from("session_attendance")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), last_seen_at, created_at")
                .eq("session_id", sessionId)
                .order("created_at", { ascending: false });
        }

        if (legacy.error && isColumnMissingErr(legacy.error, "last_seen_at")) {
            legacy = await sb
                .from("session_attendance")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), created_at")
                .eq("session_id", sessionId)
                .order("created_at", { ascending: false });
        }

        if (!legacy.error && Array.isArray(legacy.data)) {
            const rows = filterActiveRows(legacy.data, cutoffMs);
            return normalizeUsers(rows);
        }
    }

    // 2) Fallback to session_participants
    {
        const selectLegacy =
            "user_id, profiles:profiles(id, full_name, avatar_url), left_at, joined_at, last_seen_at, created_at";

        let res = await sb
            .from("session_participants")
            .select(selectLegacy)
            .eq("session_id", sessionId)
            .is("left_at", null)
            .order("joined_at", { ascending: false });

        if (res.error && isColumnMissingErr(res.error, "left_at")) {
            res = await sb
                .from("session_participants")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), joined_at, last_seen_at, created_at")
                .eq("session_id", sessionId)
                .order("joined_at", { ascending: false });
        }

        if (res.error && isColumnMissingErr(res.error, "joined_at")) {
            res = await sb
                .from("session_participants")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), last_seen_at, created_at")
                .eq("session_id", sessionId)
                .order("created_at", { ascending: false });
        }

        if (res.error && isColumnMissingErr(res.error, "last_seen_at")) {
            res = await sb
                .from("session_participants")
                .select("user_id, profiles:profiles(id, full_name, avatar_url), created_at")
                .eq("session_id", sessionId)
                .order("created_at", { ascending: false });
        }

        if (!res.error && Array.isArray(res.data)) {
            const rows = filterActiveRows(res.data, cutoffMs);
            return normalizeUsers(rows);
        }
    }

    return [];
}

/** =========================
 * ✅ Stage visuals
 * ========================= */
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
    custom: { label: "Custom", color: "#6366F1" },
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
        return "welcome";
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
        return "welcome";
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

function resolveStageColor(stage: any, kind: StageKind) {
    const raw = stage?.color;
    if (!raw) return KIND_META[kind].color;

    const s = String(raw).trim().toLowerCase();

    if (
        s === "#4ca0ff" ||
        s === "rgb(76,160,255)" ||
        s === "rgba(76,160,255,1)"
    ) {
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

/** ✅ IMPORTANT: must exist at module scope (fixes "clamp is not defined") */
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

/** =========================
 * ✅ Room param resolver (uuid preferred; fallback to custom_slug)
 * ========================= */
function getRoomParam(session: any): string {
    const id = session?.id != null ? String(session.id).trim() : "";
    if (id) return id;
    const slug = session?.custom_slug != null ? String(session.custom_slug).trim() : "";
    return slug;
}

function buildLoginNext(urlPath: string): string {
    const next = urlPath || "/sessions";
    return `/login?next=${encodeURIComponent(next)}`;
}

export default function SessionCard({
    session,
    userId,
    onBook,
    onCancelBooking,
    onJoin,
    onDelete,
    onEditSession,
    onInviteToSession,
    currentUser,
}: SessionCardProps) {
    const navigate = useNavigate();
    const isHost = session.host_id === userId;

    const initialIsBooked =
        session.session_bookings?.some((b: any) => b.user_id === userId) ||
        session?.is_booked === true;
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

    const [stages, setStages] = useState<SessionStage[]>([]);
    const [liveUsers, setLiveUsers] = useState<BookedUser[]>([]);
    const [isLiveLoading, setIsLiveLoading] = useState(false); // ✅ NEW
    const [peopleTab, setPeopleTab] = useState<"booked" | "live">("booked");
    const [peopleTabPinned, setPeopleTabPinned] = useState(false);

    // quick lookup: кто сейчас online
    const liveIdSet = useMemo(() => new Set(liveUsers.map((u) => u.id)), [liveUsers]);

    // если сменили сессию — сброс “ручного выбора”
    useEffect(() => {
        setPeopleTabPinned(false);
    }, [session?.id]);

    const [isBookersModalOpen, setIsBookersModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

    const [isOptionsOpen, setIsOptionsOpen] = useState(false);
    const optionsRef = useRef<HTMLDivElement | null>(null);

    // ✅ Info popover
    const [isInfoOpen, setIsInfoOpen] = useState(false);
    const [isInfoPinned, setIsInfoPinned] = useState(false);
    const infoRef = useRef<HTMLDivElement | null>(null);

    // ✅ current stage state
    const [nowStage, setNowStage] = useState<{
        name: string;
        color: string;
        kind: any;
        leftSec: number;
    } | null>(null);

    useEffect(() => setIsBookingConfirmed(!!initialIsBooked), [session.id, initialIsBooked]);
    useEffect(() => setBookers(initialBookers), [initialBookers]);

    useEffect(() => {
        return () => {
            if (cancelHoverTimer) window.clearTimeout(cancelHoverTimer);
        };
    }, [cancelHoverTimer]);

    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            const t = e.target as any;

            if (isOptionsOpen && optionsRef.current && !optionsRef.current.contains(t)) {
                setIsOptionsOpen(false);
            }

            if (isInfoOpen && infoRef.current && !infoRef.current.contains(t)) {
                setIsInfoOpen(false);
                setIsInfoPinned(false);
            }
        }
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [isOptionsOpen, isInfoOpen]);

    const sessionType = resolveSessionType(session);
    const isInfinite = sessionType === "infinite";

    // ✅ FIX: live_count может прилетать строкой (bigint)
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

    const hasStarted = useMemo(() => {
        if (isInfinite) return true;
        if (liveNowCount > 0) return true;

        if (!session?.start_time) return false;
        const t = Date.parse(String(session.start_time));
        if (!Number.isFinite(t)) return false;
        return Date.now() >= t;
    }, [isInfinite, liveNowCount, session?.start_time]);

    // For future sessions: don't pass real future start_time to stage timeline.
    // ✅ Prefer started_at; if only start_time is in the future -> use "now"
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

    const startDateString = session.start_time
        ? new Date(session.start_time).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
        : "";

    // ✅ Load stages
    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const s = await fetchStagesForSession(session);
                if (!cancelled) setStages(Array.isArray(s) ? s : []);
            } catch (e) {
                console.error("[SessionCard] fetchStagesForSession failed:", e);
                if (!cancelled) setStages([]);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [session?.id, session?.schedule, session?.session_template_id, session?.template_id]);

    // ✅ Precompute stages with normalized kind + color
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

    // ✅ Poll live users (background)
    const shouldPollLive = useMemo(() => {
        if (!session?.id) return false;
        if (isInfinite) return true;
        if (liveNowCount > 0) return true;

        const startMs = parseTimeMs(session?.start_time);
        if (startMs == null) return false;

        const diff = startMs - Date.now();
        const beforeMs = 6 * 60 * 60 * 1000; // 6h before
        const afterMs = 12 * 60 * 60 * 1000; // 12h after
        return diff <= beforeMs && diff >= -afterMs;
    }, [session?.id, isInfinite, liveNowCount, session?.start_time]);

    useEffect(() => {
        if (!session?.id) return;

        if (!shouldPollLive) {
            setLiveUsers([]);
            return;
        }

        let cancelled = false;

        const run = async () => {
            try {
                const users = await fetchLiveUsers(String(session.id));
                if (!cancelled) setLiveUsers(users || []);
            } catch (e) {
                console.error("[SessionCard] fetchLiveUsers failed:", e);
                if (!cancelled) setLiveUsers([]);
            }
        };

        run();
        const timer = window.setInterval(run, isInfinite ? 15000 : 12000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [session?.id, shouldPollLive, isInfinite]);

    // ✅ NEW: On-demand fetch when modal is open AND "live" tab selected
    useEffect(() => {
        if (!session?.id) return;
        if (!isBookersModalOpen) return;
        if (peopleTab !== "live") return;

        let cancelled = false;

        const run = async () => {
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

        // while modal open, keep it fresh even if shouldPollLive was false
        const every = isInfinite ? 15000 : 8000;
        const timer = window.setInterval(run, every);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [session?.id, isBookersModalOpen, peopleTab, isInfinite]);

    useEffect(() => {
        if (peopleTabPinned) return; // не ломаем выбор юзера
        if (hasLiveNow) setPeopleTab("live");
        else setPeopleTab("booked");
    }, [peopleTabPinned, hasLiveNow, session?.id]);

    // ✅ compute current stage only when info popover open
    useEffect(() => {
        if (!isInfoOpen) {
            setNowStage(null);
            return;
        }
        if (!stagesVisual?.length) {
            setNowStage(null);
            return;
        }

        const scheduleObj = tryParseJson<any>(session?.schedule);
        const cycleSeconds =
            Number(scheduleObj?.timer?.cycleSeconds) ||
            Number(scheduleObj?.timer?.cycle_seconds) ||
            undefined;

        const everyMs = isInfinite ? 15000 : 1000;

        const tick = () => {
            try {
                const res = computeNowStage(stagesVisual, timelineStartTime, cycleSeconds);
                if (!res?.curStage) {
                    setNowStage(null);
                    return;
                }
                const v = resolveStageVisualLocal(res.curStage as any);
                setNowStage({
                    name: v.name,
                    color: v.color,
                    kind: v.kind,
                    leftSec: res.stageLeft,
                });
            } catch (e) {
                console.error("[SessionCard] nowStage tick failed:", e);
                setNowStage(null);
            }
        };

        tick();
        const timer = window.setInterval(tick, everyMs);
        return () => window.clearInterval(timer);
    }, [isInfoOpen, stagesVisual, timelineStartTime, isInfinite, session?.schedule]);

    const ensureCurrentUserAsBooked = () => {
        if (!userId) return;
        const exists = bookers.some((u) => u.id === userId);
        if (exists) return;

        const cu: BookedUser = currentUser?.id
            ? {
                id: currentUser.id,
                full_name: currentUser.full_name || "You",
                avatar_url: currentUser.avatar_url,
            }
            : { id: userId, full_name: "You" };

        setBookers((prev) => [cu, ...prev]);
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
        onBook(session.id);
        setIsBookingConfirmed(true);
        ensureCurrentUserAsBooked();
        setIsHoveringBook(false);
    };

    const handleCancelBooking = () => {
        if (!userId) return;
        onCancelBooking(session.id);
        setIsBookingConfirmed(false);
        removeCurrentUserFromBooked();
        setIsHoveringCancel(false);
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

        const nextPath = `/room-iframe/${roomParam}`;

        // ✅ RoomPageIFrame requires auth — redirect early for nicer UX
        if (!userId) {
            navigate(buildLoginNext(nextPath));
            return;
        }

        try {
            // keep uuid if available; fallback to roomParam
            const idForJoin = session?.id ? String(session.id) : roomParam;
            onJoin(idForJoin);
        } catch { }

        navigate(nextPath);
    };

    const maxStack = 6;

    // ✅ Always show BOTH: Booked + Live Now
    const bookedStackUsers = bookers.slice(0, maxStack);
    const bookedRemaining = Math.max(0, bookedCount - bookedStackUsers.length);

    const liveStackUsers = liveUsers.slice(0, maxStack);
    const liveRemaining = Math.max(0, liveNowCount - liveStackUsers.length);

    const [editTitle, setEditTitle] = useState<string>(session?.title || "");
    const [editStartLocal, setEditStartLocal] = useState<string>(() => {
        if (!session?.start_time) return "";
        try {
            const d = new Date(session.start_time);
            const pad = (n: number) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
                d.getHours()
            )}:${pad(d.getMinutes())}`;
        } catch {
            return "";
        }
    });
    const [editMaxParticipants, setEditMaxParticipants] = useState<string>(() => {
        const v = session?.max_participants;
        return v == null ? "" : String(v);
    });

    useEffect(() => {
        setEditTitle(session?.title || "");
        if (session?.start_time) {
            try {
                const d = new Date(session.start_time);
                const pad = (n: number) => String(n).padStart(2, "0");
                setEditStartLocal(
                    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
                        d.getHours()
                    )}:${pad(d.getMinutes())}`
                );
            } catch { }
        } else setEditStartLocal("");
        setEditMaxParticipants(session?.max_participants == null ? "" : String(session?.max_participants));
    }, [session?.id]);

    const [inviteEmail, setInviteEmail] = useState<string>("");
    const [inviteMessage, setInviteMessage] = useState<string>("");

    const bookSessionButton = (
        <button
            onClick={handleBookSession}
            onMouseEnter={() => setIsHoveringBook(true)}
            onMouseLeave={() => setIsHoveringBook(false)}
            className={`
        h-12 min-w-[160px] rounded-full px-6 text-[14px] font-semibold
        flex items-center justify-center gap-2
        transition-all duration-200 ease-in-out
        w-full xl:w-auto
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
            <span>Book session</span>
        </button>
    );

    const confirmedBookingButton = (
        <button
            onClick={isHoveringCancel ? handleCancelBooking : undefined}
            onMouseEnter={onEnterBooked}
            onMouseLeave={onLeaveBooked}
            className={`
        h-12 rounded-full text-[14px] font-semibold
        flex items-center justify-center
        transition-all duration-300 ease-in-out
        w-full xl:w-auto
        ${isHoveringCancel
                    ? "px-6 border border-[#F65252] bg-[#F65252]/5 text-[#F65252]"
                    : "px-5 border border-[#65D46C] bg-[#65D46C]/10 text-[#65D46C]"
                }
      `}
            style={{ willChange: "width, padding" }}
        >
            {isHoveringCancel ? (
                <>
                    <img src="/icons/cross-cancel.svg" className="w-6 h-6 mr-2" alt="" />
                    Cancel booking
                </>
            ) : (
                <img src="/icons/book-session-green.svg" className="w-6 h-6" alt="" />
            )}
        </button>
    );

    const canEdit = isHost && !!onEditSession;
    const canInvite = isHost && !!onInviteToSession;
    const canCancelBooking = !!isBookingConfirmed;
    const canCancelSession = isHost;

    const peopleInline = (
        <div className="inline-flex items-center gap-3">
            {/* LIVE NOW */}
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
                            <div className="flex items-center">
                                {liveStackUsers.map((u, idx) => (
                                    <div
                                        key={u.id}
                                        className="relative"
                                        style={{
                                            marginLeft: idx === 0 ? 0 : -10,
                                            zIndex: 50 - idx,
                                        }}
                                    >
                                        <AvatarCircle
                                            user={u}
                                            size={26}
                                            isLive={true}
                                            showLiveDot={true}
                                        />
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

            {/* BOOKED */}
            <button
                type="button"
                onClick={() => {
                    setPeopleTab("booked");
                    setPeopleTabPinned(true);
                    setIsBookersModalOpen(true);
                }}
                className="inline-flex items-center gap-2 hover:opacity-80 transition text-left whitespace-nowrap"
                title="People who booked"
            >
                {bookedCount === 0 ? (
                    <div className="text-[12px] text-[#606060] whitespace-nowrap">
                        Booked: <span className="font-medium">0</span>
                    </div>
                ) : (
                    <>
                        {bookedStackUsers.length > 0 && (
                            <div className="flex items-center">
                                {bookedStackUsers.map((u, idx) => (
                                    <div
                                        key={u.id}
                                        className="relative"
                                        style={{
                                            marginLeft: idx === 0 ? 0 : -10,
                                            zIndex: 50 - idx,
                                        }}
                                    >
                                        <AvatarCircle
                                            user={u}
                                            size={26}
                                            isLive={liveIdSet.has(u.id)}
                                            showLiveDot={true}
                                        />
                                    </div>
                                ))}
                                {bookedRemaining > 0 && (
                                    <div className="relative" style={{ marginLeft: -10, zIndex: 0 }}>
                                        <div
                                            className="rounded-full border border-[#E5E7EB] bg-white flex items-center justify-center text-[10px] font-semibold text-[#111827]"
                                            style={{ width: 26, height: 26 }}
                                            title={`${bookedRemaining} more`}
                                        >
                                            +{bookedRemaining}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="text-[12px] text-[#606060] font-normal">
                            Booked: <span className="font-medium">{bookedCount}</span>
                        </div>
                    </>
                )}
            </button>
        </div>
    );

    const modalUsers = peopleTab === "live" ? liveUsers : bookers;
    const modalCount = peopleTab === "live" ? liveNowCount : bookedCount;

    // ✅ description: prefer session.description, else template description if nested
    const embeddedTemplate = getEmbeddedTemplate(session);
    const description = String(
        session?.description ??
        embeddedTemplate?.description ??
        session?.session_template?.description ??
        session?.template?.description ??
        ""
    ).trim();

    // cycleSeconds is optional; StageBar also works without it
    const scheduleObj = tryParseJson<any>(session?.schedule);
    const cycleSeconds =
        Number(scheduleObj?.timer?.cycleSeconds) ||
        Number(scheduleObj?.timer?.cycle_seconds) ||
        undefined;

    const tickEveryMs = isInfinite ? 15000 : 1000;

    return (
        <>
            <div
                onMouseEnter={() => setIsHoveringCard(true)}
                onMouseLeave={() => setIsHoveringCard(false)}
                className="
          border border-borderGray rounded-[42px] bg-white
          transition-all duration-200
          hover:bg-[#F6F6F6] hover:border-[#A3A3A3]
          p-6
          flex flex-col
          w-full gap-4
        "
            >
                <div className="flex flex-col xl:flex-row w-full gap-6">
                    <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 flex-1">
                        <div className="flex flex-col gap-3 w-full">
                            <h3 className="text-[24px] md:text-[29px] font-bold leading-tight">
                                {session.title}
                            </h3>

                            <div className="flex flex-wrap items-center gap-4 text-[12px] text-[#606060]">
                                <Link
                                    to={`/profile/${session.host_id}`}
                                    className="flex items-center gap-1 hover:opacity-70"
                                >
                                    <img src="/icons/host.svg" className="w-4 h-4 opacity-70" alt="" />
                                    <span>Host</span>
                                    <span className="underline underline-offset-2">{session.host_name}</span>
                                </Link>

                                <div className="flex items-center gap-1">
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
                                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full border"
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

                                    {/* ✅ Info icon (hover + click) */}
                                    <div
                                        ref={infoRef}
                                        className="relative"
                                        onMouseEnter={() => setIsInfoOpen(true)}
                                        onMouseLeave={() => {
                                            if (!isInfoPinned) setIsInfoOpen(false);
                                        }}
                                    >
                                        <button
                                            type="button"
                                            className="h-8 w-8 rounded-full border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] flex items-center justify-center transition"
                                            title="Info"
                                            aria-label="Info"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setIsInfoOpen(true);
                                                setIsInfoPinned((v) => !v);
                                            }}
                                        >
                                            <span className="text-[#111827] opacity-80">
                                                <IconInfo size={16} />
                                            </span>
                                        </button>

                                        {isInfoOpen && (
                                            <div
                                                className="
                          absolute left-0 top-[38px]
                          z-[250]
                          w-[420px] max-w-[85vw]
                          rounded-[18px]
                          border border-[#E5E7EB]
                          bg-white
                          shadow-xl
                          overflow-hidden
                        "
                                            >
                                                <div className="px-4 py-3 text-[12px] text-[#606060] border-b border-[#F3F4F6] flex items-center justify-between">
                                                    <span>Session info</span>
                                                    {isInfoPinned && (
                                                        <span className="text-[11px] text-[#111827]/60">
                                                            Pinned
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="p-4 flex flex-col gap-3">
                                                    {description ? (
                                                        <div className="text-[13px] text-[#111827] leading-snug">
                                                            {description}
                                                        </div>
                                                    ) : (
                                                        <div className="text-[12px] text-[#606060]">
                                                            No description yet.
                                                        </div>
                                                    )}

                                                    {/* current stage */}
                                                    {nowStage && (
                                                        <div className="flex items-center gap-2">
                                                            <div className="text-[12px] text-[#606060]">
                                                                Current:
                                                            </div>
                                                            <div
                                                                className="inline-flex items-center gap-2 px-3 py-1 rounded-full border"
                                                                style={{
                                                                    borderColor: nowStage.color,
                                                                    backgroundColor: `${nowStage.color}20`,
                                                                    color: nowStage.color,
                                                                    fontSize: 12,
                                                                    fontWeight: 600,
                                                                }}
                                                            >
                                                                <span>{nowStage.name}</span>
                                                                {Number.isFinite(nowStage.leftSec) &&
                                                                    nowStage.leftSec > 0 && (
                                                                        <span className="opacity-80 font-semibold">
                                                                            ·{" "}
                                                                            {Math.ceil(
                                                                                nowStage.leftSec / 60
                                                                            )}
                                                                            m left
                                                                        </span>
                                                                    )}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* timeline */}
                                                    {stagesVisual?.length ? (
                                                        <div className="w-full">
                                                            <SessionStageBar
                                                                {...({
                                                                    stages: stagesVisual,
                                                                    startTime: timelineStartTime,
                                                                    cycleSeconds,
                                                                    progressStyle: "tick",
                                                                    tickEveryMs,
                                                                } as any)}
                                                            />
                                                            <div className="mt-2 text-[11px] text-[#606060]">
                                                                {isInfinite
                                                                    ? "Updates every 15s for infinite rooms (low CPU)."
                                                                    : "Live timeline (1s tick)."}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="w-full h-2 rounded-full bg-[#111827]/5" />
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="hidden xl:flex items-center gap-6">
                            <div className="w-px h-10 bg-[#D9D9D9]" />
                            <div className="text-center">
                                <div className="text-[32px] font-bold text-brandBlack">
                                    {liveNowCount}
                                </div>
                                <div className="text-[10px] text-[#606060] font-light -mt-1">
                                    {shouldPollLive ? "in the session now" : "live count soon"}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row max-[480px]:flex-col gap-3 w-full xl:w-auto items-center justify-center">
                        {isBookingConfirmed ? confirmedBookingButton : bookSessionButton}

                        <button
                            onClick={handleJoinRoom}
                            onMouseEnter={() => setIsHoveringJoinIframe(true)}
                            onMouseLeave={() => setIsHoveringJoinIframe(false)}
                            className="
                h-12 rounded-full px-6 text-[14px] font-semibold
                flex items-center justify-center
                transition-all duration-200 ease-in-out
                w-full xl:w-auto
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

                        <div ref={optionsRef} className="relative w-full xl:w-auto">
                            <button
                                type="button"
                                onClick={() => setIsOptionsOpen((v) => !v)}
                                onMouseEnter={() => setIsHoveringOptions(true)}
                                onMouseLeave={() => setIsHoveringOptions(false)}
                                className="
                  h-12 w-full xl:w-12
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
                                    className="
                    absolute right-0 top-[52px]
                    z-[200]
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

                                        {canInvite && (
                                            <MenuItem
                                                icon={<IconInvite />}
                                                label="Invite…"
                                                onClick={() => {
                                                    setIsOptionsOpen(false);
                                                    setIsInviteModalOpen(true);
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

                                        {!canEdit && !canInvite && !canCancelBooking && !canCancelSession && (
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

            {/* people modal (booked + live switch) */}
            <ModalShell
                title={hasStarted || hasLiveNow ? "People" : "People who booked this session"}
                isOpen={isBookersModalOpen}
                onClose={() => setIsBookersModalOpen(false)}
            >
                {(hasStarted || hasLiveNow || isInfinite) && (
                    <div className="flex items-center gap-2 mb-4">
                        <button
                            className={[
                                "h-9 px-4 rounded-full text-[13px] font-semibold border transition",
                                peopleTab === "live"
                                    ? "border-[#111827] bg-[#111827] text-white"
                                    : "border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#F3F4F6]",
                            ].join(" ")}
                            onClick={() => setPeopleTab("live")}
                        >
                            In session ({liveNowCount})
                        </button>
                        <button
                            className={[
                                "h-9 px-4 rounded-full text-[13px] font-semibold border transition",
                                peopleTab === "booked"
                                    ? "border-[#111827] bg-[#111827] text-white"
                                    : "border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#F3F4F6]",
                            ].join(" ")}
                            onClick={() => setPeopleTab("booked")}
                        >
                            Booked ({bookedCount})
                        </button>
                    </div>
                )}

                {!hasStarted && !hasLiveNow && !isInfinite && (
                    <div className="text-[12px] text-[#606060]">{bookedCount} booked</div>
                )}

                <div className="mt-1 flex flex-col gap-2">
                    {modalCount === 0 ? (
                        <div className="text-[13px] text-[#606060]">
                            {peopleTab === "live"
                                ? "No one in the session right now."
                                : "No one booked yet. Be the first."}
                        </div>
                    ) : peopleTab === "live" && modalUsers.length === 0 ? (
                        <div className="text-[13px] text-[#606060]">
                            {isLiveLoading
                                ? "Loading people in the session…"
                                : `${liveNowCount} people are in the session right now (profiles may be private or still loading).`}
                        </div>
                    ) : (
                        modalUsers.map((u) => {
                            const label = u.full_name || u.id || "Participant";
                            const isLive = liveIdSet.has(u.id);

                            return (
                                <Link
                                    key={u.id}
                                    to={`/profile/${u.id}`}
                                    onClick={() => setIsBookersModalOpen(false)}
                                    className="
                flex items-center gap-3 px-3 py-2 rounded-[16px]
                border border-[#F0F0F0]
                hover:bg-[#F6F6F6] hover:border-[#E5E7EB]
                transition
            "
                                >
                                    <AvatarCircle
                                        user={u}
                                        size={34}
                                        isLive={peopleTab === "live" ? true : isLive}
                                        showLiveDot={true}
                                    />

                                    <div className="flex flex-col min-w-0 flex-1">
                                        <div className="text-[13px] font-semibold text-[#111827] truncate">
                                            {label}
                                        </div>

                                        {peopleTab === "booked" && isLive && (
                                            <div className="text-[11px] text-[#65D46C] font-semibold">
                                                Online
                                            </div>
                                        )}
                                    </div>
                                </Link>
                            );
                        })
                    )}
                </div>
            </ModalShell>

            {/* edit modal */}
            <ModalShell
                title="Edit session"
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
            >
                <div className="flex flex-col gap-4">
                    <div>
                        <div className="text-[12px] font-semibold text-[#111827] mb-1">
                            Title
                        </div>
                        <input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full h-11 px-4 rounded-[14px] border border-[#E5E7EB] outline-none focus:border-[#111827]"
                            placeholder="Session title"
                        />
                    </div>

                    <div>
                        <div className="text-[12px] font-semibold text-[#111827] mb-1">
                            Start time
                        </div>
                        <input
                            value={editStartLocal}
                            onChange={(e) => setEditStartLocal(e.target.value)}
                            type="datetime-local"
                            className="w-full h-11 px-4 rounded-[14px] border border-[#E5E7EB] outline-none focus:border-[#111827]"
                        />
                        <div className="text-[11px] text-[#606060] mt-1">
                            Uses your local timezone.
                        </div>
                    </div>

                    <div>
                        <div className="text-[12px] font-semibold text-[#111827] mb-1">
                            Participants limit
                        </div>
                        <input
                            value={editMaxParticipants}
                            onChange={(e) => setEditMaxParticipants(e.target.value)}
                            type="number"
                            min={1}
                            className="w-full h-11 px-4 rounded-[14px] border border-[#E5E7EB] outline-none focus:border-[#111827]"
                            placeholder="e.g. 12 (empty = unlimited)"
                        />
                    </div>

                    <div className="flex gap-3 justify-end">
                        <button
                            className="h-11 px-5 rounded-full border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[13px] font-semibold"
                            onClick={() => setIsEditModalOpen(false)}
                        >
                            Cancel
                        </button>
                        <button
                            className="h-11 px-6 rounded-full border border-[#111827] bg-[#111827] text-white hover:opacity-90 text-[13px] font-semibold"
                            onClick={async () => {
                                setIsEditModalOpen(false);

                                const updates: any = {};
                                const title = String(editTitle || "").trim();
                                if (title && title !== session?.title) updates.title = title;

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

                                if (!onEditSession) return;
                                try {
                                    await onEditSession(session.id, updates);
                                } catch (e) {
                                    console.error("onEditSession failed:", e);
                                }
                            }}
                        >
                            Save changes
                        </button>
                    </div>
                </div>
            </ModalShell>

            {/* invite modal */}
            <ModalShell
                title="Invite to session"
                isOpen={isInviteModalOpen}
                onClose={() => setIsInviteModalOpen(false)}
            >
                <div className="flex flex-col gap-4">
                    <div className="text-[12px] text-[#606060]">Invite someone by email.</div>

                    <div>
                        <div className="text-[12px] font-semibold text-[#111827] mb-1">
                            Email
                        </div>
                        <input
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            className="w-full h-11 px-4 rounded-[14px] border border-[#E5E7EB] outline-none focus:border-[#111827]"
                            placeholder="name@example.com"
                        />
                    </div>

                    <div>
                        <div className="text-[12px] font-semibold text-[#111827] mb-1">
                            Message (optional)
                        </div>
                        <textarea
                            value={inviteMessage}
                            onChange={(e) => setInviteMessage(e.target.value)}
                            className="w-full min-h-[90px] p-4 rounded-[14px] border border-[#E5E7EB] outline-none focus:border-[#111827]"
                            placeholder="Join my focus session…"
                        />
                    </div>

                    <div className="flex gap-3 justify-end">
                        <button
                            className="h-11 px-5 rounded-full border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[13px] font-semibold"
                            onClick={() => setIsInviteModalOpen(false)}
                        >
                            Cancel
                        </button>
                        <button
                            className="h-11 px-6 rounded-full border border-[#111827] bg-[#111827] text-white hover:opacity-90 text-[13px] font-semibold"
                            onClick={async () => {
                                const email = inviteEmail.trim();
                                const msg = inviteMessage.trim();

                                setIsInviteModalOpen(false);
                                setInviteEmail("");
                                setInviteMessage("");

                                if (!email) return;
                                if (!onInviteToSession) return;

                                try {
                                    await onInviteToSession(session.id, { email, message: msg || undefined });
                                } catch (e) {
                                    console.error("onInviteToSession failed:", e);
                                }
                            }}
                        >
                            Send invite
                        </button>
                    </div>
                </div>
            </ModalShell>
        </>
    );
}
