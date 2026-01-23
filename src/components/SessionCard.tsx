// src/components/SessionCard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

interface SessionCardProps {
    session: any;
    userId?: string;

    // Existing callbacks (can be sync or async)
    onBook: (sessionId: string) => void | Promise<any>;
    onCancelBooking: (sessionId: string) => void | Promise<any>;
    onJoin: (sessionId: string) => void | Promise<any>;
    onDelete: (sessionId: string) => void | Promise<any>;
}

function safeLower(x: any) {
    return String(x || "").toLowerCase();
}

function inferTypeFromTitle(title: any): "Deep work" | "Pomodoro" | "Short sprints" | null {
    const t = safeLower(title);

    if (t.includes("silent") || t.includes("drop-in") || t.includes("drop in")) return "Deep work";
    if (t.includes("deep work") || t.includes("deepwork") || t.includes("uninterrupted")) return "Deep work";
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
        if (sch.kind === "infinite_room") return "infinite";
        if (sch?.timer?.phases) return "infinite";
    }

    if (safeLower(session?.format) === "body") return "body";
    return "group";
}

function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function toIcsUtc(dt: Date) {
    return (
        dt.getUTCFullYear() +
        pad2(dt.getUTCMonth() + 1) +
        pad2(dt.getUTCDate()) +
        "T" +
        pad2(dt.getUTCHours()) +
        pad2(dt.getUTCMinutes()) +
        pad2(dt.getUTCSeconds()) +
        "Z"
    );
}

function icsEscape(s: string) {
    return String(s || "")
        .replace(/\\/g, "\\\\")
        .replace(/\n/g, "\\n")
        .replace(/,/g, "\\,")
        .replace(/;/g, "\\;");
}

function buildClientIcs(args: {
    uid: string;
    title: string;
    description: string;
    location?: string;
    start: Date;
    end: Date;
}) {
    const dtstamp = toIcsUtc(new Date());
    const dtstart = toIcsUtc(args.start);
    const dtend = toIcsUtc(args.end);

    return [
        "BEGIN:VCALENDAR",
        "PRODID:-//MySession//EN",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:${args.uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${dtstart}`,
        `DTEND:${dtend}`,
        `SUMMARY:${icsEscape(args.title)}`,
        `DESCRIPTION:${icsEscape(args.description)}`,
        `LOCATION:${icsEscape(args.location || "")}`,
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ].join("\r\n");
}

function downloadTextFile(filename: string, content: string, mime = "text/plain") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export default function SessionCard({
    session,
    userId,
    onBook,
    onCancelBooking,
    onJoin, // kept for compatibility
    onDelete,
}: SessionCardProps) {
    const navigate = useNavigate();

    const isHost = session.host_id === userId;

    const initialIsBooked = session.session_bookings?.some((b: any) => b.user_id === userId);
    const [isBookingConfirmed, setIsBookingConfirmed] = useState<boolean>(!!initialIsBooked);

    const [isHoveringCancel, setIsHoveringCancel] = useState(false);
    const [isHoveringBook, setIsHoveringBook] = useState(false);
    const [isHoveringJoinIframe, setIsHoveringJoinIframe] = useState(false);
    const [isHoveringCard, setIsHoveringCard] = useState(false);

    const [isBookingLoading, setIsBookingLoading] = useState(false);
    const [isCancelLoading, setIsCancelLoading] = useState(false);

    // ✅ hover delay
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

    const joinUrl = useMemo(() => {
        try {
            return `${window.location.origin}/room-iframe/${session.id}`;
        } catch {
            return `/room-iframe/${session.id}`;
        }
    }, [session.id]);

    const myBooking = useMemo(() => {
        if (!userId) return null;
        return session.session_bookings?.find((b: any) => b.user_id === userId) || null;
    }, [session.session_bookings, userId]);

    const inviteSentAt = myBooking?.invite_sent_at || null;

    const canDownloadIcs = useMemo(() => {
        if (isInfinite) return false;
        if (!session.start_time) return false;
        const d = new Date(session.start_time);
        if (Number.isNaN(d.getTime())) return false;
        return true;
    }, [isInfinite, session.start_time]);

    const handleDownloadIcs = (e: any) => {
        e?.preventDefault?.();
        if (!canDownloadIcs) return;

        const start = new Date(session.start_time);
        const duration = Math.max(1, Number(session.duration_minutes || 60));
        const end = new Date(start.getTime() + duration * 60 * 1000);

        const uid = `${session.id}-${userId || "user"}@mysession`;
        const ics = buildClientIcs({
            uid,
            title: `MySession — ${session.title}`,
            description: `Join link: ${joinUrl}`,
            location: joinUrl,
            start,
            end,
        });

        downloadTextFile("mysession-invite.ics", ics, "text/calendar");
    };

    const handleBookSession = async () => {
        if (isBookingLoading) return;
        setIsBookingLoading(true);

        try {
            await Promise.resolve(onBook(session.id));
            setIsBookingConfirmed(true);
            setIsHoveringBook(false);
            // invite отправит сервер (если onBook дергает /api/book-session)
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
        } finally {
            setIsCancelLoading(false);
        }
    };

    const onEnterBooked = () => {
        if (cancelHoverTimer) window.clearTimeout(cancelHoverTimer);
        const tmr = window.setTimeout(() => setIsHoveringCancel(true), CANCEL_HOVER_DELAY_MS);
        setCancelHoverTimer(tmr);
    };

    const onLeaveBooked = () => {
        if (cancelHoverTimer) window.clearTimeout(cancelHoverTimer);
        setCancelHoverTimer(null);
        setIsHoveringCancel(false);
    };

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

        if (isInfinite) {
            return (
                <div className="text-[11px] text-[#606060]">
                    Calendar invites are available for scheduled sessions only.
                </div>
            );
        }

        if (inviteSentAt) {
            return (
                <div className="text-[11px] text-[#15803D]">
                    Calendar invite sent (check email).{" "}
                    <button
                        type="button"
                        onClick={handleDownloadIcs}
                        className={`underline underline-offset-2 hover:opacity-80 ${canDownloadIcs ? "" : "opacity-40 cursor-not-allowed"
                            }`}
                        disabled={!canDownloadIcs}
                        title="Download .ics (fallback)"
                    >
                        Download .ics
                    </button>
                </div>
            );
        }

        return (
            <div className="text-[11px] text-[#606060] flex flex-wrap items-center gap-2">
                <span>Invite will be sent by email after booking (server-side).</span>
                <button
                    type="button"
                    onClick={handleDownloadIcs}
                    className={`underline underline-offset-2 hover:opacity-80 ${canDownloadIcs ? "" : "opacity-40 cursor-not-allowed"
                        }`}
                    disabled={!canDownloadIcs}
                    title="Download .ics (fallback)"
                >
                    Add to calendar (.ics)
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
                        <Link to={`/profile/${session.host_id}`} className="flex items-center gap-1 hover:opacity-70">
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

                    <div className="px-1">{inviteLine}</div>
                </div>

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
            </div>
        </div>
    );
}
