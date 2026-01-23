// src/components/SessionCard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

interface SessionCardProps {
    session: any;
    userId?: string;

    // ✅ NEW (optional): needed to send calendar invite email from the client
    userEmail?: string;
    userName?: string;

    // Existing callbacks (can be sync or async)
    onBook: (sessionId: string) => void | Promise<any>;
    onCancelBooking: (sessionId: string) => void | Promise<any>;
    onJoin: (sessionId: string) => void | Promise<any>;
    onDelete: (sessionId: string) => void | Promise<any>;
}

function safeLower(x: any) {
    return String(x || "").toLowerCase();
}

// ✅ NEW: infer visual type from title for newer/infinite room titles
function inferTypeFromTitle(title: any): "Deep work" | "Pomodoro" | "Short sprints" | null {
    const t = safeLower(title);

    // Silent / drop-in -> treat as Deep work
    if (t.includes("silent") || t.includes("drop-in") || t.includes("drop in")) return "Deep work";

    if (t.includes("deep work") || t.includes("deepwork") || t.includes("uninterrupted")) return "Deep work";
    if (t.includes("pomodoro")) return "Pomodoro";

    // Ratios
    if (/\b25\s*[/\-]\s*5\b/.test(t)) return "Pomodoro";
    if (/\b15\s*[/\-]\s*3\b/.test(t)) return "Short sprints";

    // Deep work style blocks
    if (/\b55\s*[/\-]\s*5\b/.test(t)) return "Deep work";
    if (/\b50\s*[/\-]\s*5(\s*[/\-]\s*5)?\b/.test(t)) return "Deep work";

    return null;
}

// ✅ single place to resolve session type
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

function toIsoMaybe(x: any): string | null {
    if (!x) return null;
    try {
        const d = new Date(x);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString();
    } catch {
        return null;
    }
}

function addMinutesIso(startIso: string, minutes: number): string {
    const d = new Date(startIso);
    d.setMinutes(d.getMinutes() + (Number(minutes) || 0));
    return d.toISOString();
}

export default function SessionCard({
    session,
    userId,
    userEmail,
    userName,
    onBook,
    onCancelBooking,
    onJoin, // kept for compatibility (we still use iframe navigate as primary join)
    onDelete,
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

    const [isBookingLoading, setIsBookingLoading] = useState(false);
    const [isCancelLoading, setIsCancelLoading] = useState(false);

    // Calendar invite status
    const [inviteStatus, setInviteStatus] = useState<"idle" | "sending" | "sent" | "failed" | "skipped">("idle");
    const [inviteError, setInviteError] = useState<string | null>(null);

    // ✅ Figma-like hover delay
    const CANCEL_HOVER_DELAY_MS = 120;
    const [cancelHoverTimer, setCancelHoverTimer] = useState<number | null>(null);

    useEffect(() => {
        setIsBookingConfirmed(!!initialIsBooked);
    }, [session.id, initialIsBooked]);

    useEffect(() => {
        return () => {
            if (cancelHoverTimer) window.clearTimeout(cancelHoverTimer);
        };
    }, [cancelHoverTimer]);

    const sessionType = resolveSessionType(session);
    const isInfinite = sessionType === "infinite";

    // REAL live count passed from SessionsPage presence aggregation (optional)
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

    const t = typeMap[resolvedType] || { color: "#111827", bg: "#E5E7EB", icon: "/icons/deepwork.svg" };

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

    // ✅ join link used for calendar invite (prefer iframe join since that’s your primary UX)
    const joinUrl = useMemo(() => {
        try {
            return `${window.location.origin}/room-iframe/${session.id}`;
        } catch {
            return `/room-iframe/${session.id}`;
        }
    }, [session.id]);

    const myExistingBookingId = useMemo(() => {
        const b = session.session_bookings?.find((x: any) => x.user_id === userId);
        return b?.id || b?.booking_id || session?.my_booking_id || session?.booking_id || null;
    }, [session.session_bookings, session?.my_booking_id, session?.booking_id, userId]);

    const canSendInvite = useMemo(() => {
        if (isInfinite) return false; // no start time
        if (!userEmail) return false;
        const startIso = toIsoMaybe(session.start_time);
        if (!startIso) return false;
        return true;
    }, [isInfinite, userEmail, session.start_time]);

    async function sendCalendarInvite(opts?: { bookingIdOverride?: string }) {
        setInviteError(null);

        // If we can’t, mark as skipped (don’t silently “pretend”)
        if (!canSendInvite) {
            setInviteStatus("skipped");
            return;
        }

        const startIso = toIsoMaybe(session.start_time)!;
        const endIso =
            toIsoMaybe(session.end_time) ||
            addMinutesIso(startIso, Number(session.duration_minutes) || 60);

        const bookingId =
            opts?.bookingIdOverride ||
            myExistingBookingId ||
            // fallback: stable enough for now, until you pass real booking.id back
            `${session.id}-${userId || "user"}`;

        setInviteStatus("sending");

        try {
            const resp = await fetch("/api/send-session-invite", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    attendeeEmail: userEmail,
                    attendeeName: userName || undefined,
                    sessionTitle: `MySession — ${session.title}`,
                    sessionDescription: `Focus session (${resolvedType}) • intention → focus → recap`,
                    startIso,
                    endIso,
                    joinUrl,
                    bookingId,
                }),
            });

            if (!resp.ok) {
                const txt = await resp.text().catch(() => "");
                throw new Error(txt || `Invite request failed (${resp.status})`);
            }

            setInviteStatus("sent");
        } catch (e: any) {
            setInviteStatus("failed");
            setInviteError(e?.message || "Failed to send invite");
        }
    }

    const handleBookSession = async () => {
        if (isBookingLoading) return;
        setIsBookingLoading(true);
        setInviteStatus("idle");
        setInviteError(null);

        try {
            // Let onBook be sync or async
            const result = await Promise.resolve(onBook(session.id));

            setIsBookingConfirmed(true);
            setIsHoveringBook(false);

            // If your onBook returns booking info, we try to use it (non-breaking)
            const bookingIdFromResult =
                (result && (result.id || result.bookingId || result.booking_id)) || null;

            // Send invite (best-effort)
            await sendCalendarInvite({ bookingIdOverride: bookingIdFromResult || undefined });
        } finally {
            setIsBookingLoading(false);
        }
    };

    const handleCancelBooking = async () => {
        if (isCancelLoading) return;
        setIsCancelLoading(true);

        try {
            await Promise.resolve(onCancelBooking(session.id));
            setIsBookingConfirmed(false);
            setIsHoveringCancel(false);

            // (Optional later) you can implement METHOD:CANCEL here to remove from calendar
            // For now we just reset invite state.
            setInviteStatus("idle");
            setInviteError(null);
        } finally {
            setIsCancelLoading(false);
        }
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

    // ✅ Join via iFrame page (RoomPageIFrame)
    const handleJoinIframe = () => {
        navigate(`/room-iframe/${session.id}`);
    };

    const bookSessionButton = (
        <button
            onClick={handleBookSession}
            disabled={isBookingLoading}
            onMouseEnter={() => setIsHoveringBook(true)}
            onMouseLeave={() => setIsHoveringBook(false)}
            className={`
        h-12 min-w-[160px] rounded-full px-6 text-[14px] font-semibold
        flex items-center justify-center gap-2
        transition-all duration-200 ease-in-out
        w-full xl:w-auto
        ${isBookingLoading ? "opacity-60 cursor-not-allowed" : ""}
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
            <span>{isBookingLoading ? "Booking..." : "Book session"}</span>
        </button>
    );

    const confirmedBookingButton = (
        <button
            onClick={isHoveringCancel ? handleCancelBooking : undefined}
            disabled={isCancelLoading}
            onMouseEnter={onEnterBooked}
            onMouseLeave={onLeaveBooked}
            className={`
        h-12 rounded-full text-[14px] font-semibold
        flex items-center justify-center
        transition-all duration-300 ease-in-out
        w-full xl:w-auto
        ${isCancelLoading ? "opacity-60 cursor-not-allowed" : ""}
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
                    {isCancelLoading ? "Canceling..." : "Cancel booking"}
                </>
            ) : (
                <img src="/icons/book-session-green.svg" className="w-6 h-6" alt="" />
            )}
        </button>
    );

    const inviteLine = (() => {
        if (!isBookingConfirmed) return null;

        // For infinite rooms: no calendar invite
        if (isInfinite) {
            return <div className="text-[11px] text-[#606060]">Calendar invites are available for scheduled sessions only.</div>;
        }

        // If userEmail missing: explain why not sent (without breaking flow)
        if (!userEmail) {
            return <div className="text-[11px] text-[#606060]">Tip: add userEmail to SessionCard props to auto-send calendar invite.</div>;
        }

        if (inviteStatus === "sending") {
            return <div className="text-[11px] text-[#606060]">Sending calendar invite…</div>;
        }

        if (inviteStatus === "sent") {
            return (
                <div className="text-[11px] text-[#15803D]">
                    Calendar invite sent to <span className="underline underline-offset-2">{userEmail}</span> (Google often auto-adds it).
                </div>
            );
        }

        if (inviteStatus === "failed") {
            return (
                <div className="text-[11px] text-[#B91C1C] flex flex-wrap items-center gap-2">
                    <span>Calendar invite failed.</span>
                    <button
                        type="button"
                        onClick={() => sendCalendarInvite()}
                        className="underline underline-offset-2 hover:opacity-80"
                    >
                        Try again
                    </button>
                    {inviteError ? <span className="text-[#606060]">({inviteError})</span> : null}
                </div>
            );
        }

        if (inviteStatus === "skipped") {
            return <div className="text-[11px] text-[#606060]">Invite not sent (missing email or time).</div>;
        }

        // idle state after booking (some users prefer explicit “resend”)
        return (
            <div className="text-[11px] text-[#606060] flex flex-wrap items-center gap-2">
                <span>Calendar invite + reminders</span>
                <button
                    type="button"
                    onClick={() => sendCalendarInvite()}
                    className="underline underline-offset-2 hover:opacity-80"
                >
                    Resend
                </button>
            </div>
        );
    })();

    return (
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
          flex flex-col
          gap-2
          w-full xl:w-auto
          items-stretch xl:items-center
          justify-center
        "
            >
                <div
                    className="
            flex flex-col sm:flex-row
            max-[480px]:flex-col
            gap-3 w-full xl:w-auto
            items-center justify-center
          "
                >
                    {isBookingConfirmed ? confirmedBookingButton : bookSessionButton}

                    {/* ✅ Join via iFrame (primary) */}
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

                    {isHost && (
                        <button
                            onClick={() => onDelete(session.id)}
                            className="
                h-10 w-10 rounded-full
                bg-[#FEE2E2]
                flex items-center justify-center
                hover:bg-[#FECACA]
              "
                            title="Delete session"
                        >
                            <img src="/icons/cross-cancel.svg" className="w-6 h-6" alt="" />
                        </button>
                    )}
                </div>

                {/* ✅ Calendar invite status line (small, but реально важная фича) */}
                <div className="px-1">{inviteLine}</div>
            </div>
        </div>
    );
}
