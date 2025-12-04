// FULL CODE STARTS HERE
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
    const initialIsBooked = session.session_bookings?.some(
        (b: any) => b.user_id === userId
    );

    const [isBookingConfirmed, setIsBookingConfirmed] =
        useState<boolean>(initialIsBooked);
    const [isHoveringCancel, setIsHoveringCancel] = useState(false);
    const [isHoveringBook, setIsHoveringBook] = useState(false);
    const [isHoveringJoin, setIsHoveringJoin] = useState(false);
    const [isHoveringCard, setIsHoveringCard] = useState(false);

    useEffect(() => {
        setIsBookingConfirmed(initialIsBooked);
    }, [session.id, initialIsBooked]);

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
        "Deep work": {
            color: "#3B82F6",
            bg: "#E4EDFF",
            icon: "/icons/deepwork.svg",
        },
        Pomodoro: {
            color: "#EF4444",
            bg: "#FFE4E4",
            icon: "/icons/pomodoro.svg",
        },
        "Short sprints": {
            color: "#22C55E",
            bg: "#E5FFE9",
            icon: "/icons/sprints.svg",
        },
    };

    const t = typeMap[resolvedType] || {
        color: "#111827",
        bg: "#E5E7EB",
        icon: "/icons/deepwork.svg",
    };

    const startDateString = session.start_time
        ? new Date(session.start_time).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
        : "";

    const attendanceCount = new Set(
        (session.session_attendance || []).map((a: any) => a.user_id)
    ).size;

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

    const bookSessionButton = (
        <button
            onClick={handleBookSession}
            onMouseEnter={() => setIsHoveringBook(true)}
            onMouseLeave={() => setIsHoveringBook(false)}
            className={`
        rounded-full px-6 py-3 text-[14px] font-semibold
        flex items-center gap-2 transition-all duration-150
        ${isHoveringBook
                    ? "text-[#65D46C] border border-[#65D46C] bg-[#65D46C]/10"
                    : "border border-brandBlack text-brandBlack bg-white"
                }
      `}
        >
            <img
                src={
                    isHoveringBook
                        ? "/icons/book-session-green.svg"
                        : "/icons/book-session.svg"
                }
                className="w-4 h-4"
            />
            <span>Book session</span>
        </button>
    );

    const confirmedBookingButton = (
        <button
            onClick={isHoveringCancel ? handleCancelBooking : undefined}
            onMouseEnter={() => setIsHoveringCancel(true)}
            onMouseLeave={() => setIsHoveringCancel(false)}
            className={`
        rounded-full py-3 text-[14px] font-semibold flex items-center justify-center
        transition-all duration-150 ease-in-out
        ${isHoveringCancel
                    ? "border border-[#F65252] bg-[#F65252]/5 text-[#F65252] px-6"
                    : "border border-[#65D46C] bg-[#65D46C]/10 w-[48px] h-[48px]"
                }
      `}
        >
            {isHoveringCancel ? (
                <>
                    <img src="/icons/cross-cancel.svg" className="w-4 h-4 mr-2" />
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
        border border-borderGray rounded-[42px]
        bg-white relative
        flex flex-col gap-4
        transition-all duration-200 
        hover:bg-[#F6F6F6] hover:border-[#A3A3A3]
      "
            style={{ padding: "24px 32px" }}
        >
            {/* TOP ROW: session-info + attendance */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                {/* LEFT: title + info */}
                <div className="flex-1 space-y-3">
                    <h3 className="text-[22px] sm:text-[26px] lg:text-[29px] font-bold leading-tight">
                        {session.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-4 text-[12px] text-[#606060]">
                        <Link
                            to={`/profile/${session.host_id}`}
                            className="flex items-center gap-1 hover:opacity-70"
                        >
                            <img src="/icons/host.svg" className="w-4 h-4 opacity-70" />
                            <span>Host</span>
                            <span className="underline underline-offset-2">
                                {session.host_name}
                            </span>
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
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-full border transition-all duration-200"
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
                                        ? t.icon.replace(".svg", "-white.svg")
                                        : t.icon
                                }
                                className="w-4 h-4"
                            />
                            {resolvedType}
                        </div>
                    </div>
                </div>

                {/* RIGHT: attendance + divider, hidden under 480px */}
                <div className="hidden sm:flex items-center gap-6 shrink-0">
                    <div className="w-px h-12 bg-[#D9D9D9]" />
                    <div className="text-center">
                        <div className="text-[28px] font-bold text-brandBlack">
                            {attendanceCount}
                        </div>
                        <div className="text-[10px] text-[#606060] font-light">
                            in the session
                        </div>
                    </div>
                </div>
            </div>

            {/* BUTTON BLOCK */}
            <div
                className="
          flex flex-row xs:flex-col xs:items-center 
          gap-2 xs:gap-3 
          mt-2
        "
            >
                {isBookingConfirmed ? confirmedBookingButton : bookSessionButton}

                <button
                    onClick={() => onJoin(session.id)}
                    onMouseEnter={() => setIsHoveringJoin(true)}
                    onMouseLeave={() => setIsHoveringJoin(false)}
                    style={{ backgroundColor: isHoveringJoin ? t.color : undefined }}
                    className={`
            rounded-full px-6 py-3 text-[14px] font-semibold transition-colors duration-150
            ${isHoveringJoin
                            ? "text-white"
                            : "bg-brandBlack text-white hover:bg-black"
                        }
          `}
                >
                    Join session
                </button>

                {isHost && (
                    <button
                        onClick={() => onDelete(session.id)}
                        className="
              xs:h-10 xs:w-10 rounded-full
              bg-[#FEE2E2] flex items-center justify-center
              hover:bg-[#FECACA]
              px-4 py-3 xs:px-0 xs:py-0
            "
                    >
                        <img src="/icons/cross-cancel.svg" className="w-6 h-6" />
                    </button>
                )}
            </div>
        </div>
    );
}
// FULL CODE ENDS
