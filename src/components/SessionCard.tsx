// src/components/SessionCard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

interface SessionCardProps {
    session: any;
    userId?: string;

    onBook: (sessionId: string) => void;
    onCancelBooking: (sessionId: string) => void;
    onJoin: (sessionId: string) => void;
    onDelete: (sessionId: string) => void;

    /**
     * ✅ NEW (optional): host actions
     * Wire these later in SessionsPage if you want full functionality.
     */
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
        payload: {
            email?: string;
            userId?: string;
            message?: string;
        }
    ) => void | Promise<any>;

    /**
     * ✅ NEW (optional): current user display info for nicer avatar when YOU book.
     */
    currentUser?: {
        id: string;
        name?: string;
        avatar_url?: string;
        email?: string;
    };
}

type BookedUser = {
    id: string;
    name?: string;
    email?: string;
    avatar_url?: string;
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

/**
 * ✅ Best-effort extraction of booked users from session.session_bookings.
 * Supports shapes:
 * - { user_id, user_name, avatar_url, email }
 * - { user_id, profiles: { full_name, avatar_url, email, id } }
 * - { user_id, user: { name, avatar_url, email, id } }
 * - fallback: { user_id } only
 */
function extractBookers(session: any): BookedUser[] {
    const raw = session?.session_bookings || [];
    if (!Array.isArray(raw)) return [];

    const users: BookedUser[] = raw
        .map((b: any) => {
            const userId = b?.user_id || b?.userId || b?.attendee_id || b?.id || null;

            const p = b?.profiles || b?.profile || b?.user || b?.attendee || null;

            const name =
                b?.user_name ||
                b?.name ||
                p?.full_name ||
                p?.name ||
                p?.display_name ||
                p?.username ||
                undefined;

            const email = b?.email || p?.email || undefined;

            const avatar_url =
                b?.avatar_url || b?.avatarUrl || p?.avatar_url || p?.avatarUrl || undefined;

            if (!userId) return null;
            return { id: String(userId), name, email, avatar_url } as BookedUser;
        })
        .filter(Boolean);

    // de-dupe by id
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
function inferTypeFromTitle(title: any): "Deep work" | "Pomodoro" | "Short sprints" | null {
    const t = safeLower(title);

    if (t.includes("silent") || t.includes("drop-in") || t.includes("drop in")) return "Deep work";

    if (t.includes("deep work") || t.includes("deepwork") || t.includes("uninterrupted"))
        return "Deep work";
    if (t.includes("pomodoro")) return "Pomodoro";

    if (/\b25\s*[/\-]\s*5\b/.test(t)) return "Pomodoro";
    if (/\b15\s*[/\-]\s*3\b/.test(t)) return "Short sprints";

    if (/\b55\s*[/\-]\s*5\b/.test(t)) return "Deep work";
    if (/\b50\s*[/\-]\s*5(\s*[/\-]\s*5)?\b/.test(t)) return "Deep work";

    return null;
}

// ✅ single place to resolve session type (matches SessionsPage logic)
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
        if (sch.kind === "infinite_room") return "infinite";
        if (sch?.timer?.phases) return "infinite";
    }

    if (safeLower(session?.format) === "body") return "body";
    return "group";
}

function AvatarCircle({
    user,
    size = 28,
    className = "",
}: {
    user: BookedUser;
    size?: number;
    className?: string;
}) {
    const initials = getInitials(user?.name || user?.email || user?.id || "?");

    return (
        <div
            className={`rounded-full overflow-hidden flex items-center justify-center border border-[#E5E7EB] bg-white ${className}`}
            style={{ width: size, height: size }}
            title={user?.name || user?.email || user?.id}
        >
            {user?.avatar_url ? (
                <img
                    src={user.avatar_url}
                    alt={user?.name || "avatar"}
                    className="w-full h-full object-cover"
                    draggable={false}
                />
            ) : (
                <div className="text-[10px] font-semibold text-[#111827] select-none">{initials}</div>
            )}
        </div>
    );
}

function ModalShell({
    title,
    isOpen,
    onClose,
    children,
    widthClass = "max-w-[520px]",
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
                <div className={`w-full ${widthClass} rounded-[24px] bg-white border border-[#E5E7EB] shadow-xl`}>
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

function DotsIcon({ size = 18 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="5" cy="12" r="2" fill="currentColor" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <circle cx="19" cy="12" r="2" fill="currentColor" />
        </svg>
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
    onInviteToSession,
    currentUser,
}: SessionCardProps) {
    const navigate = useNavigate();
    const isHost = session.host_id === userId;

    // ✅ booking status from sessions.session_bookings
    const initialIsBooked = session.session_bookings?.some((b: any) => b.user_id === userId);

    const [isBookingConfirmed, setIsBookingConfirmed] = useState<boolean>(!!initialIsBooked);

    const [isHoveringCancel, setIsHoveringCancel] = useState(false);
    const [isHoveringBook, setIsHoveringBook] = useState(false);
    const [isHoveringJoinIframe, setIsHoveringJoinIframe] = useState(false);
    const [isHoveringCard, setIsHoveringCard] = useState(false);

    // ✅ Figma-like hover delay
    const CANCEL_HOVER_DELAY_MS = 120;
    const [cancelHoverTimer, setCancelHoverTimer] = useState<number | null>(null);

    // ✅ NEW: booked people avatars
    const initialBookers = useMemo(() => extractBookers(session), [session]);
    const [bookers, setBookers] = useState<BookedUser[]>(initialBookers);

    // ✅ NEW: modals & options
    const [isBookersModalOpen, setIsBookersModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

    const [isOptionsOpen, setIsOptionsOpen] = useState(false);
    const optionsRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setIsBookingConfirmed(!!initialIsBooked);
    }, [session.id, initialIsBooked]);

    useEffect(() => {
        setBookers(initialBookers);
    }, [initialBookers]);

    useEffect(() => {
        return () => {
            if (cancelHoverTimer) window.clearTimeout(cancelHoverTimer);
        };
    }, [cancelHoverTimer]);

    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            if (!isOptionsOpen) return;
            const t = e.target as any;
            if (optionsRef.current && !optionsRef.current.contains(t)) {
                setIsOptionsOpen(false);
            }
        }
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [isOptionsOpen]);

    const sessionType = resolveSessionType(session);
    const isInfinite = sessionType === "infinite";

    // ✅ REAL live count must come from presence aggregation in SessionsPage.
    const liveCount: number | null = typeof session?.live_count === "number" ? session.live_count : null;

    const nameToTypeMap: Record<string, string> = {
        "1 Hour — Pomodoro 15/3": "Short sprints",
        "2 Hours — Pomodoro 15/3": "Short sprints",
        "1 Hour — Pomodoro 25/5": "Pomodoro",
        "2 Hours — Pomodoro 25/5": "Pomodoro",
        "1 Hour — Uninterrupted Focus": "Deep work",
        "2 Hours — 2x 50min Focus Blocks": "Deep work",
    };

    const inferredType = inferTypeFromTitle(session.title);
    const resolvedType = nameToTypeMap[session.title] || inferredType || session.type || "Deep work";

    const typeMap: Record<string, { color: string; bg: string; icon: string }> = {
        "Deep work": { color: "#3B82F6", bg: "#E4EDFF", icon: "/icons/deepwork.svg" },
        Pomodoro: { color: "#EF4444", bg: "#FFE4E4", icon: "/icons/pomodoro.svg" },
        "Short sprints": { color: "#22C55E", bg: "#E5FFE9", icon: "/icons/sprints.svg" },
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

    const ensureCurrentUserAsBooked = () => {
        if (!userId) return;
        const exists = bookers.some((u) => u.id === userId);
        if (exists) return;

        const cu: BookedUser = currentUser?.id
            ? {
                id: currentUser.id,
                name: currentUser.name || "You",
                avatar_url: currentUser.avatar_url,
                email: currentUser.email,
            }
            : { id: userId, name: "You" };

        setBookers((prev) => [cu, ...prev]);
    };

    const removeCurrentUserFromBooked = () => {
        if (!userId) return;
        setBookers((prev) => prev.filter((u) => u.id !== userId));
    };

    const handleBookSession = () => {
        onBook(session.id);
        setIsBookingConfirmed(true);
        ensureCurrentUserAsBooked();
        setIsHoveringBook(false);
    };

    const handleCancelBooking = () => {
        onCancelBooking(session.id);
        setIsBookingConfirmed(false);
        removeCurrentUserFromBooked();
        setIsHoveringCancel(false);
    };

    const onEnterBooked = () => {
        if (cancelHoverTimer) window.clearTimeout(cancelHoverTimer);
        const t = window.setTimeout(() => setIsHoveringCancel(true), CANCEL_HOVER_DELAY_MS);
        setCancelHoverTimer(t);
    };

    const onLeaveBooked = () => {
        if (cancelHoverTimer) window.clearTimeout(cancelHoverTimer);
        setCancelHoverTimer(null);
        setIsHoveringCancel(false);
    };

    const handleJoinIframe = () => {
        navigate(`/room-iframe/${session.id}`);
    };

    // ✅ NEW: stacked avatars preview
    const maxStack = 5;
    const bookedCount = bookers.length;
    const stackUsers = bookers.slice(0, maxStack);
    const remaining = bookedCount - stackUsers.length;

    // ✅ NEW: edit modal state
    const [editTitle, setEditTitle] = useState<string>(session?.title || "");
    const [editStartLocal, setEditStartLocal] = useState<string>(() => {
        // datetime-local expects "YYYY-MM-DDTHH:mm"
        if (!session?.start_time) return "";
        try {
            const d = new Date(session.start_time);
            const pad = (n: number) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
                d.getMinutes()
            )}`;
        } catch {
            return "";
        }
    });
    const [editMaxParticipants, setEditMaxParticipants] = useState<string>(() => {
        const v = session?.max_participants;
        if (v == null) return "";
        return String(v);
    });

    useEffect(() => {
        setEditTitle(session?.title || "");
        // don't aggressively reset editStartLocal to avoid annoying editing, but keep it in sync on session change
        if (session?.start_time) {
            try {
                const d = new Date(session.start_time);
                const pad = (n: number) => String(n).padStart(2, "0");
                setEditStartLocal(
                    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
                );
            } catch { }
        } else {
            setEditStartLocal("");
        }
        const v = session?.max_participants;
        setEditMaxParticipants(v == null ? "" : String(v));
    }, [session?.id]);

    // ✅ NEW: invite modal state
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
        ${isHoveringBook ? "text-[#65D46C] border border-[#65D46C] bg-[#65D46C]/10" : "border border-brandBlack text-brandBlack bg-white"}
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
        ${isHoveringCancel ? "px-6 border border-[#F65252] bg-[#F65252]/5 text-[#F65252]" : "px-5 border border-[#65D46C] bg-[#65D46C]/10 text-[#65D46C]"}
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

    const canEdit = isHost;
    const canInvite = isHost; // keep it host-only for now
    const canCancelBooking = !!isBookingConfirmed; // user booked
    const canCancelSession = isHost; // maps to onDelete

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
          flex flex-col xl:flex-row
          w-full gap-6
        "
            >
                {/* INFO */}
                <div
                    className="
            flex flex-col xl:flex-row
            items-start xl:items-center
            justify-between
            gap-4 flex-1
          "
                >
                    <div className="flex flex-col gap-3">
                        <h3 className="text-[24px] md:text-[29px] font-bold leading-tight">{session.title}</h3>

                        <div className="flex flex-wrap items-center gap-4 text-[12px] text-[#606060]">
                            {/* Host link */}
                            <Link to={`/profile/${session.host_id}`} className="flex items-center gap-1 hover:opacity-70">
                                <img src="/icons/host.svg" className="w-4 h-4 opacity-70" alt="" />
                                <span>Host</span>
                                <span className="underline underline-offset-2">{session.host_name}</span>
                            </Link>

                            {/* Duration */}
                            <div className="flex items-center gap-1">
                                <img src="/icons/duration.svg" className="w-4 h-4 opacity-70" alt="" />
                                <span>{isInfinite ? "Infinite" : `${session.duration_minutes} min`}</span>
                            </div>

                            {/* Date */}
                            {!isInfinite && (
                                <div className="flex items-center gap-1">
                                    <img src="/icons/date.svg" className="w-4 h-4 opacity-70" alt="" />
                                    <span>{startDateString}</span>
                                </div>
                            )}

                            {/* Type pill */}
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
                                    src={isHoveringCard ? t.icon.replace(".svg", "-white.svg") : t.icon}
                                    className="w-4 h-4"
                                    alt=""
                                />
                                {resolvedType}
                            </div>
                        </div>

                        {/* ✅ NEW: People who booked (avatars stack) */}
                        <button
                            type="button"
                            onClick={() => setIsBookersModalOpen(true)}
                            className="
                mt-1 inline-flex items-center gap-3
                hover:opacity-80 transition
                text-left
              "
                        >
                            <div className="flex items-center">
                                {stackUsers.length === 0 ? (
                                    <div className="text-[12px] text-[#606060]">Be the first to book</div>
                                ) : (
                                    <div className="flex items-center">
                                        {/* stacked avatars */}
                                        <div className="flex items-center">
                                            {stackUsers.map((u, idx) => (
                                                <div
                                                    key={u.id}
                                                    className="relative"
                                                    style={{
                                                        marginLeft: idx === 0 ? 0 : -10,
                                                        zIndex: 50 - idx,
                                                    }}
                                                >
                                                    <AvatarCircle user={u} size={28} />
                                                </div>
                                            ))}
                                            {remaining > 0 && (
                                                <div
                                                    className="relative"
                                                    style={{
                                                        marginLeft: -10,
                                                        zIndex: 0,
                                                    }}
                                                >
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

                                        <div className="ml-3 flex flex-col leading-tight">
                                            <div className="text-[12px] font-semibold text-[#111827]">People who booked this session</div>
                                            <div className="text-[11px] text-[#606060]">{bookedCount} booked</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </button>
                    </div>

                    {/* ✅ ONLY ONE participants indicator (desktop). No duplicate chip. */}
                    <div className="hidden xl:flex items-center gap-6">
                        <div className="w-px h-10 bg-[#D9D9D9]" />
                        <div className="text-center">
                            <div className="text-[32px] font-bold text-brandBlack">{liveCount ?? "—"}</div>
                            <div className="text-[10px] text-[#606060] font-light -mt-1">
                                {liveCount == null ? "live count soon" : "in the session now"}
                            </div>
                        </div>
                    </div>
                </div>

                {/* BUTTONS */}
                <div
                    className="
            flex flex-col sm:flex-row
            max-[480px]:flex-col
            gap-3 w-full xl:w-auto
            items-center justify-center
          "
                >
                    {isBookingConfirmed ? confirmedBookingButton : bookSessionButton}

                    {/* ✅ join via iFrame */}
                    <button
                        onClick={handleJoinIframe}
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

                    {/* ✅ NEW: options menu instead of delete крестик */}
                    <div ref={optionsRef} className="relative w-full xl:w-auto">
                        <button
                            type="button"
                            onClick={() => setIsOptionsOpen((v) => !v)}
                            className="
                h-12 w-full xl:w-12
                rounded-full border border-[#E5E7EB]
                bg-white
                flex items-center justify-center
                hover:bg-[#F3F4F6]
                transition
              "
                            title="Options"
                            aria-label="Options"
                        >
                            <DotsIcon />
                        </button>

                        {isOptionsOpen && (
                            <div
                                className="
                  absolute right-0 top-[52px]
                  z-[200]
                  w-[240px]
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
                                        <button
                                            className="w-full text-left px-3 py-2 rounded-[12px] hover:bg-[#F3F4F6] text-[13px] font-semibold text-[#111827]"
                                            onClick={() => {
                                                setIsOptionsOpen(false);
                                                setIsEditModalOpen(true);
                                            }}
                                        >
                                            Edit session
                                        </button>
                                    )}

                                    {canInvite && (
                                        <button
                                            className="w-full text-left px-3 py-2 rounded-[12px] hover:bg-[#F3F4F6] text-[13px] font-semibold text-[#111827]"
                                            onClick={() => {
                                                setIsOptionsOpen(false);
                                                setIsInviteModalOpen(true);
                                            }}
                                        >
                                            Invite…
                                        </button>
                                    )}

                                    {canCancelBooking && (
                                        <button
                                            className="w-full text-left px-3 py-2 rounded-[12px] hover:bg-[#FFF1F2] text-[13px] font-semibold text-[#F65252]"
                                            onClick={() => {
                                                setIsOptionsOpen(false);
                                                handleCancelBooking();
                                            }}
                                        >
                                            Cancel booking
                                        </button>
                                    )}

                                    {canCancelSession && (
                                        <button
                                            className="w-full text-left px-3 py-2 rounded-[12px] hover:bg-[#FFF1F2] text-[13px] font-semibold text-[#F65252]"
                                            onClick={() => {
                                                setIsOptionsOpen(false);
                                                onDelete(session.id);
                                            }}
                                        >
                                            Cancel session
                                        </button>
                                    )}

                                    {!canEdit && !canInvite && !canCancelBooking && !canCancelSession && (
                                        <div className="px-3 py-2 text-[12px] text-[#606060]">No actions available</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ✅ Bookers list modal */}
            <ModalShell
                title="People who booked this session"
                isOpen={isBookersModalOpen}
                onClose={() => setIsBookersModalOpen(false)}
                widthClass="max-w-[560px]"
            >
                <div className="flex items-center justify-between">
                    <div className="text-[12px] text-[#606060]">{bookedCount} booked</div>
                    <button
                        className="text-[12px] font-semibold underline underline-offset-2 hover:opacity-70"
                        onClick={() => {
                            // quick UX: if no one booked, prompt booking
                            if (!isBookingConfirmed) handleBookSession();
                        }}
                    >
                        {!isBookingConfirmed ? "Book this session" : "You're booked"}
                    </button>
                </div>

                <div className="mt-4 flex flex-col gap-2">
                    {bookedCount === 0 ? (
                        <div className="text-[13px] text-[#606060]">No one booked yet. Be the first.</div>
                    ) : (
                        bookers.map((u) => (
                            <div
                                key={u.id}
                                className="flex items-center gap-3 px-3 py-2 rounded-[16px] border border-[#F0F0F0]"
                            >
                                <AvatarCircle user={u} size={34} />
                                <div className="flex flex-col">
                                    <div className="text-[13px] font-semibold text-[#111827]">{u.name || u.email || u.id}</div>
                                    <div className="text-[12px] text-[#606060]">{u.email ? u.email : `User: ${u.id}`}</div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </ModalShell>

            {/* ✅ Edit modal */}
            <ModalShell
                title="Edit session"
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                widthClass="max-w-[560px]"
            >
                <div className="flex flex-col gap-4">
                    <div>
                        <div className="text-[12px] font-semibold text-[#111827] mb-1">Title</div>
                        <input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full h-11 px-4 rounded-[14px] border border-[#E5E7EB] outline-none focus:border-[#111827]"
                            placeholder="Session title"
                        />
                    </div>

                    <div>
                        <div className="text-[12px] font-semibold text-[#111827] mb-1">Start time</div>
                        <input
                            value={editStartLocal}
                            onChange={(e) => setEditStartLocal(e.target.value)}
                            type="datetime-local"
                            className="w-full h-11 px-4 rounded-[14px] border border-[#E5E7EB] outline-none focus:border-[#111827]"
                        />
                        <div className="text-[11px] text-[#606060] mt-1">Uses your local timezone.</div>
                    </div>

                    <div>
                        <div className="text-[12px] font-semibold text-[#111827] mb-1">Participants limit</div>
                        <input
                            value={editMaxParticipants}
                            onChange={(e) => setEditMaxParticipants(e.target.value)}
                            type="number"
                            min={1}
                            className="w-full h-11 px-4 rounded-[14px] border border-[#E5E7EB] outline-none focus:border-[#111827]"
                            placeholder="e.g. 12 (leave empty for unlimited)"
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
                                const updates: any = {};

                                const title = String(editTitle || "").trim();
                                if (title && title !== session?.title) updates.title = title;

                                if (editStartLocal) {
                                    // datetime-local gives local; convert to ISO
                                    try {
                                        const iso = new Date(editStartLocal).toISOString();
                                        if (iso !== session?.start_time) updates.start_time = iso;
                                    } catch { }
                                }

                                if (editMaxParticipants.trim() === "") {
                                    // treat as unlimited (null)
                                    if (session?.max_participants != null) updates.max_participants = null;
                                } else {
                                    const n = Number(editMaxParticipants);
                                    if (Number.isFinite(n) && n > 0 && n !== session?.max_participants) {
                                        updates.max_participants = n;
                                    }
                                }

                                setIsEditModalOpen(false);

                                if (!onEditSession) return;
                                try {
                                    await onEditSession(session.id, updates);
                                } catch (e) {
                                    // keep silent; wire toast later
                                    console.error("onEditSession failed:", e);
                                }
                            }}
                        >
                            Save changes
                        </button>
                    </div>
                </div>
            </ModalShell>

            {/* ✅ Invite modal */}
            <ModalShell
                title="Invite to session"
                isOpen={isInviteModalOpen}
                onClose={() => setIsInviteModalOpen(false)}
                widthClass="max-w-[560px]"
            >
                <div className="flex flex-col gap-4">
                    <div className="text-[12px] text-[#606060]">
                        Invite someone by email (platform invites can be wired later).
                    </div>

                    <div>
                        <div className="text-[12px] font-semibold text-[#111827] mb-1">Email</div>
                        <input
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            className="w-full h-11 px-4 rounded-[14px] border border-[#E5E7EB] outline-none focus:border-[#111827]"
                            placeholder="name@example.com"
                        />
                    </div>

                    <div>
                        <div className="text-[12px] font-semibold text-[#111827] mb-1">Message (optional)</div>
                        <textarea
                            value={inviteMessage}
                            onChange={(e) => setInviteMessage(e.target.value)}
                            className="w-full min-h-[90px] p-4 rounded-[14px] border border-[#E5E7EB] outline-none focus:border-[#111827]"
                            placeholder="Join my focus session on MySession…"
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
                                setIsInviteModalOpen(false);
                                setInviteEmail("");
                                setInviteMessage("");

                                if (!onInviteToSession) return;
                                try {
                                    await onInviteToSession(session.id, { email, message: inviteMessage });
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
