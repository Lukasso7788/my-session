// src/components/SessionCard.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface SessionCardProps {
    session: any;
    userId?: string;
    onBook: (sessionId: string) => void;
    onCancelBooking: (sessionId: string) => void;
    onJoin: (sessionId: string) => void;
    onDelete: (sessionId: string) => void;
}

export default function SessionCard({
    session,
    userId,
    onBook,
    onCancelBooking,
    onJoin,
    onDelete,
}: SessionCardProps) {
    const isHost = session.host_id === userId;
    const initialIsBooked = session.session_bookings?.some((b: any) => b.user_id === userId);

    const [isBookingConfirmed, setIsBookingConfirmed] = useState<boolean>(initialIsBooked);

    const [isHoveringCancel, setIsHoveringCancel] = useState(false);
    const [isHoveringBook, setIsHoveringBook] = useState(false);
    const [isHoveringJoin, setIsHoveringJoin] = useState(false);
    const [isHoveringCard, setIsHoveringCard] = useState(false);

    // ✅ Figma-like hover delay
    const CANCEL_HOVER_DELAY_MS = 120;
    const [cancelHoverTimer, setCancelHoverTimer] = useState<number | null>(null);

    useEffect(() => {
        setIsBookingConfirmed(initialIsBooked);
    }, [session.id, initialIsBooked]);

    useEffect(() => {
        return () => {
            if (cancelHoverTimer) window.clearTimeout(cancelHoverTimer);
        };
    }, [cancelHoverTimer]);

    const nameToTypeMap: Record<string, string> = {
        "1 Hour — Pomodoro 15/3": "Short sprints",
        "2 Hours — Pomodoro 15/3": "Short sprints",
        "1 Hour — Pomodoro 25/5": "Pomodoro",
        "2 Hours — Pomodoro 25/5": "Pomodoro",
        "1 Hour — Uninterrupted Focus": "Deep work",
        "2 Hours — 2x 50min Focus Blocks": "Deep work",
    };

    const resolvedType = nameToTypeMap[session.title] || session.type;

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

    // ✅ Join hover bg by type (your exact colors)
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

    const attendanceCount = new Set((session.session_attendance || []).map((a: any) => a.user_id)).size;

    const handleBookSession = () => {
        onBook(session.id);
        setIsBookingConfirmed(true);
        setIsHoveringBook(false);
    };

    const handleCancelBooking = () => {
        onCancelBooking(session.id);
        setIsBookingConfirmed(false);
        setIsHoveringCancel(false);
    };

    // ✅ delayed hover -> makes it feel like Figma
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

    // ✅ Book button: stable height + min width => looks “normal” next to other buttons
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
            />
            <span>Book session</span>
        </button>
    );

    /**
     * ✅ THIS IS THE ACTUAL “HOVER IS BACK” FIX:
     * - Not hovering: 48x48 green circle (w-12 h-12)
     * - Hovering: wide red cancel (px-6 h-12)
     * So you get the obvious expanding animation again.
     */
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
                    : "w-12 border border-[#65D46C] bg-[#65D46C]/10 text-[#65D46C]"
                }
      `}
            style={{ willChange: "width, padding" }}
        >
            {isHoveringCancel ? (
                <>
                    {/* ✅ 24x24 cancel icon */}
                    <img src="/icons/cross-cancel.svg" className="w-6 h-6 mr-2" />
                    Cancel booking
                </>
            ) : (
                <img src="/icons/book-session-green.svg" className="w-6 h-6" />
            )}
        </button>
    );

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
                            <img src="/icons/host.svg" className="w-4 h-4 opacity-70" />
                            <span>Host</span>
                            <span className="underline underline-offset-2">{session.host_name}</span>
                        </Link>

                        <div className="flex items-center gap-1">
                            <img src="/icons/duration.svg" className="w-4 h-4 opacity-70" />
                            <span>{session.duration_minutes} min</span>
                        </div>

                        <div className="flex items-center gap-1">
                            <img src="/icons/date.svg" className="w-4 h-4 opacity-70" />
                            <span>{startDateString}</span>
                        </div>

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
                            />
                            {resolvedType}
                        </div>
                    </div>
                </div>

                {/* ATTENDANCE ONLY ≥1280px */}
                <div className="hidden xl:flex items-center gap-6">
                    <div className="w-px h-10 bg-[#D9D9D9]" />
                    <div className="text-center">
                        <div className="text-[32px] font-bold text-brandBlack">{attendanceCount}</div>
                        <div className="text-[10px] text-[#606060] font-light -mt-1">in the session</div>
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

                <button
                    onClick={() => onJoin(session.id)}
                    onMouseEnter={() => setIsHoveringJoin(true)}
                    onMouseLeave={() => setIsHoveringJoin(false)}
                    className="
            h-12 rounded-full px-6 text-[14px] font-semibold
            flex items-center justify-center
            transition-colors duration-200 ease-in-out
            w-full xl:w-auto
            text-white
          "
                    style={{
                        backgroundColor: isHoveringJoin ? joinHoverBg : "#111827",
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
                    >
                        <img src="/icons/cross-cancel.svg" className="w-6 h-6" />
                    </button>
                )}
            </div>
        </div>
    );
}
