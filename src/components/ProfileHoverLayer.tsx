import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { CalendarDays, Clock, ExternalLink } from "lucide-react";
import { supabase } from "../lib/supabase";

// Account preview for every avatar in the app.
//
// Mark any element that shows a person with profileHoverAttrs(userId, name);
// this single layer (mounted once in main.tsx) opens a small card when a mouse
// rests on it. Touch taps are left alone. Stats load once per person per page
// view, and only when someone actually hovers.

export function profileHoverAttrs(userId?: string | null, name?: string | null): Record<string, string> {
    const id = String(userId || "").trim();
    if (!id) return {};
    return name ? { "data-profile-id": id, "data-profile-name": name } : { "data-profile-id": id };
}

type ProfileStats = {
    fullName: string | null;
    avatarUrl: string | null;
    bio: string | null;
    timezone: string | null;
    sessions: number | null;
    followers: number | null;
    memberSince: string | null;
};

const EMPTY_STATS: ProfileStats = {
    fullName: null,
    avatarUrl: null,
    bio: null,
    timezone: null,
    sessions: null,
    followers: null,
    memberSince: null,
};
const statsCache = new Map<string, Promise<ProfileStats>>();

function loadProfileStats(userId: string): Promise<ProfileStats> {
    const cached = statsCache.get(userId);
    if (cached) return cached;

    const request = (async (): Promise<ProfileStats> => {
        const [profileResult, followersResult] = await Promise.all([
            supabase
                .from("profiles")
                .select("full_name, avatar_url, bio, timezone, attended_sessions_count, created_at")
                .eq("id", userId)
                .maybeSingle(),
            supabase
                .from("host_followers")
                .select("id", { count: "exact", head: true })
                .eq("host_user_id", userId),
        ]);
        const profile = profileResult.error ? null : (profileResult.data as any);
        const createdAt = profile?.created_at ? new Date(profile.created_at) : null;
        return {
            fullName: profile?.full_name || null,
            avatarUrl: profile?.avatar_url || null,
            bio: profile?.bio ? String(profile.bio).trim() || null : null,
            timezone: profile?.timezone || null,
            sessions: typeof profile?.attended_sessions_count === "number" ? profile.attended_sessions_count : null,
            followers: followersResult.error ? null : followersResult.count ?? 0,
            memberSince:
                createdAt && !Number.isNaN(createdAt.getTime())
                    ? createdAt.toLocaleDateString("en-US", { month: "short", year: "numeric" })
                    : null,
        };
    })().catch(() => EMPTY_STATS);

    statsCache.set(userId, request);
    return request;
}

/** The person's local time ("4:12 PM") and city ("Berlin") for a valid IANA zone, otherwise null. */
function describeTimezone(timezone: string | null): { time: string; city: string; full: string } | null {
    if (!timezone) return null;
    try {
        const time = new Date().toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
        const city = timezone.split("/").pop()?.replace(/_/g, " ") || timezone;
        return { time, city, full: timezone };
    } catch {
        return null;
    }
}

function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

const CARD_WIDTH = 300;
const CARD_HEIGHT_GUESS = 300;
const OPEN_DELAY_MS = 260;
const CLOSE_DELAY_MS = 160;

type Target = { userId: string; name: string; top: number; left: number; above: boolean };

export default function ProfileHoverLayer() {
    const location = useLocation();
    const [target, setTarget] = useState<Target | null>(null);
    const [stats, setStats] = useState<ProfileStats | null>(null);
    const anchorRef = useRef<HTMLElement | null>(null);
    const cardRef = useRef<HTMLDivElement | null>(null);
    const openTimer = useRef<number | null>(null);
    const closeTimer = useRef<number | null>(null);

    const clearTimers = useCallback(() => {
        if (openTimer.current) window.clearTimeout(openTimer.current);
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
        openTimer.current = null;
        closeTimer.current = null;
    }, []);

    const close = useCallback(() => {
        clearTimers();
        anchorRef.current = null;
        setTarget(null);
    }, [clearTimers]);

    const scheduleClose = useCallback(() => {
        if (openTimer.current) window.clearTimeout(openTimer.current);
        openTimer.current = null;
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
        closeTimer.current = window.setTimeout(close, CLOSE_DELAY_MS);
    }, [close]);

    useEffect(() => {
        const onOver = (event: PointerEvent) => {
            if (event.pointerType !== "mouse") return;
            const node = event.target as Element | null;
            if (cardRef.current?.contains(node)) return;
            let anchor = node?.closest?.("[data-profile-id]") as HTMLElement | null;
            if (!anchor) return;
            // A chip and the avatar inside it describe the same person: anchor on the outer one.
            for (let up = anchor.parentElement?.closest("[data-profile-id]") as HTMLElement | null; up; up = up.parentElement?.closest("[data-profile-id]") as HTMLElement | null) {
                if (up.dataset.profileId !== anchor.dataset.profileId) break;
                anchor = up;
            }
            const userId = anchor.dataset.profileId || "";
            if (!userId) return;

            if (closeTimer.current) window.clearTimeout(closeTimer.current);
            closeTimer.current = null;
            if (anchor === anchorRef.current) return;
            anchorRef.current = anchor;

            if (openTimer.current) window.clearTimeout(openTimer.current);
            openTimer.current = window.setTimeout(() => {
                if (!anchor.isConnected || anchorRef.current !== anchor) return;
                const rect = anchor.getBoundingClientRect();
                const left = Math.min(
                    Math.max(12, rect.left + rect.width / 2 - CARD_WIDTH / 2),
                    window.innerWidth - CARD_WIDTH - 12,
                );
                const above = rect.bottom + 10 + CARD_HEIGHT_GUESS > window.innerHeight && rect.top > CARD_HEIGHT_GUESS;
                setStats(null);
                setTarget({
                    userId,
                    name: anchor.dataset.profileName || "",
                    top: above ? rect.top - 10 : rect.bottom + 10,
                    left,
                    above,
                });
            }, OPEN_DELAY_MS);
        };

        const onOut = (event: PointerEvent) => {
            if (event.pointerType !== "mouse") return;
            const anchor = anchorRef.current;
            if (!anchor) return;
            const to = event.relatedTarget as Node | null;
            if (to && (anchor.contains(to) || cardRef.current?.contains(to))) return;
            const from = event.target as Node | null;
            if (from && (anchor.contains(from) || cardRef.current?.contains(from))) scheduleClose();
        };

        document.addEventListener("pointerover", onOver);
        document.addEventListener("pointerout", onOut);
        return () => {
            document.removeEventListener("pointerover", onOver);
            document.removeEventListener("pointerout", onOut);
            clearTimers();
        };
    }, [clearTimers, scheduleClose]);

    // Load the person's stats once the card is open.
    useEffect(() => {
        if (!target) return;
        let alive = true;
        void loadProfileStats(target.userId).then((next) => {
            if (alive) setStats(next);
        });
        return () => {
            alive = false;
        };
    }, [target?.userId]);

    // A card left over after scrolling, resizing or navigating would float in the wrong place.
    useEffect(() => {
        if (!target) return;
        window.addEventListener("scroll", close, true);
        window.addEventListener("resize", close);
        return () => {
            window.removeEventListener("scroll", close, true);
            window.removeEventListener("resize", close);
        };
    }, [target, close]);

    useEffect(() => {
        close();
    }, [location.pathname, close]);

    if (!target) return null;

    const loading = stats === null;
    const displayName = stats?.fullName || target.name || "MySession member";
    const zone = describeTimezone(stats?.timezone || null);

    return createPortal(
        // The outer box only positions (and flips above the anchor); the inner card animates.
        <div
            ref={cardRef}
            className="fixed z-[2147483647]"
            style={{
                top: target.top,
                left: target.left,
                width: CARD_WIDTH,
                transform: target.above ? "translateY(-100%)" : undefined,
            }}
            onPointerEnter={() => {
                if (closeTimer.current) window.clearTimeout(closeTimer.current);
                closeTimer.current = null;
            }}
            onPointerLeave={(event) => {
                if (event.pointerType !== "mouse") return;
                const to = event.relatedTarget as Node | null;
                if (to instanceof Node && anchorRef.current?.contains(to)) return;
                scheduleClose();
            }}
        >
            <div className="profile-hover-card overflow-hidden rounded-[24px] border border-[#EEEEEE] bg-white text-left font-inter shadow-[0_22px_60px_rgba(17,24,39,0.18)]">
                <div className="h-14 bg-[#EEF3FE]" aria-hidden="true" />

                <div className="px-4 pb-4">
                    <div className="-mt-7 flex items-end justify-between gap-3">
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-[3px] border-white bg-[#F1F1F1] shadow-[0_4px_12px_rgba(17,24,39,0.10)]">
                            {stats?.avatarUrl ? (
                                <img src={stats.avatarUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                            ) : (
                                <span className="text-[15px] font-semibold text-[#2F2F2F]">{initialsOf(displayName)}</span>
                            )}
                        </span>
                        {zone ? (
                            <span
                                className="mb-1 inline-flex items-center gap-1 rounded-full bg-[#F6F6F6] px-2.5 py-1 text-[11px] font-medium text-[#606060]"
                                title={`${zone.full} · local time`}
                            >
                                <Clock size={11} strokeWidth={2.2} aria-hidden="true" />
                                {zone.time} in {zone.city}
                            </span>
                        ) : null}
                    </div>

                    <div className="mt-2 truncate text-[16px] font-semibold leading-6 text-[#111827]">{displayName}</div>
                    <div className="flex items-center gap-1 text-[12px] text-[#8A8A8A]">
                        <CalendarDays size={12} strokeWidth={2} aria-hidden="true" />
                        {loading ? "Loading…" : stats?.memberSince ? `Member since ${stats.memberSince}` : "MySession member"}
                    </div>

                    {stats?.bio ? (
                        <p
                            className="mt-2.5 text-[12px] leading-[1.5] text-[#606060]"
                            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                        >
                            {stats.bio}
                        </p>
                    ) : null}

                    <div className="mt-3 grid grid-cols-2 divide-x divide-[#E3E3E3] rounded-[16px] bg-[#F6F6F6] py-2.5">
                        {[
                            { label: "Sessions", value: stats?.sessions },
                            { label: "Followers", value: stats?.followers },
                        ].map((stat) => (
                            <div key={stat.label} className="px-3.5">
                                <div className="text-[17px] font-bold leading-5 text-[#111827] tabular-nums">
                                    {loading ? "…" : stat.value ?? "—"}
                                </div>
                                <div className="mt-0.5 text-[11px] text-[#7A7A7A]">{stat.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Opens in a new tab so a room or session in progress is never left. */}
                    <Link
                        to={`/profile/${target.userId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={close}
                        title="Opens in a new tab"
                        className="group/open mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-[#2F2F2F] text-[13px] font-semibold text-white transition hover:bg-[#111827]"
                    >
                        Check account
                        <ExternalLink
                            className="h-3.5 w-3.5 opacity-70 transition-[transform,opacity] duration-200 group-hover/open:-translate-y-px group-hover/open:translate-x-px group-hover/open:opacity-100"
                            aria-hidden="true"
                        />
                        <span className="sr-only">(opens in a new tab)</span>
                    </Link>
                </div>
            </div>
        </div>,
        document.body,
    );
}
