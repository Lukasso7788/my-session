// src/components/SessionCard.tsx
import React from "react";
import { useNavigate } from "react-router-dom";

type Booking = {
  user_id: string;
};

type Attendance = {
  id: string;
  session_id: string;
  user_id: string;
};

type SessionCardProps = {
  session: any; // Session + session_bookings + session_attendance
  userId?: string | null;
  onBook: (sessionId: string) => void;
  onCancelBooking: (sessionId: string) => void;
  onJoin: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
};

const TYPE_META = {
  deep: {
    label: "Deep work",
    color: "#5286F6",
    bg: "#E4EDFF",
    joinHover: "hover:bg-deepWork",
  },
  pomo: {
    label: "Pomodoro 25/5",
    color: "#F65252",
    bg: "#FFE4E4",
    joinHover: "hover:bg-pomodoro",
  },
  short: {
    label: "Short sprints",
    color: "#65D46C",
    bg: "#E5FFE9",
    joinHover: "hover:bg-sprints",
  },
  other: {
    label: "Session",
    color: "#2F2F2F",
    bg: "#F3F4F6",
    joinHover: "hover:bg-brandBlack",
  },
} as const;

function getTypeKeyFromTitle(title: string): keyof typeof TYPE_META {
  const t = (title || "").toLowerCase();
  if (t.includes("15/3")) return "short";
  if (t.includes("25/5") || t.includes("pomodoro")) return "pomo";
  if (t.includes("uninterrupted") || t.includes("focus")) return "deep";
  return "other";
}

function formatStartLabel(start_time?: string | null): string {
  if (!start_time) return "";
  const start = new Date(start_time).getTime();
  const now = Date.now();
  const diffMs = start - now;
  const diffMin = Math.round(Math.abs(diffMs) / 60000);

  if (diffMs > 0) {
    // future
    return `Starts in ${diffMin} mins`;
  } else {
    return `Started ${diffMin} mins ago`;
  }
}

export function SessionCard({
  session,
  userId,
  onBook,
  onCancelBooking,
  onJoin,
  onDelete,
}: SessionCardProps) {
  const navigate = useNavigate();

  const isHost = session.host_id === userId;

  const bookings: Booking[] =
    session.session_bookings || session.bookings || [];

  const isBooked = !!userId && bookings.some((b) => b.user_id === userId);

  const attendance: Attendance[] =
    session.session_attendance || session.attendance || [];

  const currentCount = new Set(
    attendance.map((a) => a.user_id)
  ).size;

  const typeKey = getTypeKeyFromTitle(session.title) as keyof typeof TYPE_META;
  const type = TYPE_META[typeKey];

  const startLabel = formatStartLabel(session.start_time);

  return (
    <div
      className="
        border border-borderGray rounded-[42px]
        px-8 py-6 bg-white
        flex flex-col lg:flex-row items-start lg:items-center
        justify-between gap-6
        hover:bg-slate-50 transition
        relative
      "
    >
      {/* small red cross – cancel session (host only) */}
      {isHost && (
        <button
          onClick={() => onDelete(session.id)}
          className="
            absolute right-6 top-6
            h-9 w-9 rounded-full
            bg-[#FEE2E2]
            flex items-center justify-center
            hover:bg-[#FCA5A5]
            transition
          "
        >
          <span className="text-[#EF4444] text-lg leading-none">×</span>
        </button>
      )}

      {/* LEFT SIDE – title + meta + tag */}
      <div className="flex-1 space-y-3 pr-6">
        {/* title 29px → примерно text-[22px]/[24px], но оставим 22 чтобы не ломать */}
        <h3 className="text-[22px] md:text-[24px] font-semibold leading-tight">
          {session.title}
        </h3>

        {/* meta row */}
        <div className="flex flex-wrap items-center gap-4 text-[12px] md:text-[13px] text-[#606060]">
          {/* host */}
          <div className="flex items-center gap-1">
            <img
              src="/icons/group-inactive.svg"
              className="w-4 h-4 opacity-60"
              alt=""
            />
            <span>Host:</span>
            <button
              className="underline underline-offset-2"
              onClick={() => navigate(`/profile/${session.host_id}`)}
            >
              {session.host_name || "Unknown"}
            </button>
          </div>

          {/* duration */}
          <div className="flex items-center gap-1">
            <img
              src="/icons/clock.svg"
              className="w-4 h-4 opacity-60"
              alt=""
            />
            <span>{session.duration_minutes} min</span>
          </div>

          {/* start label */}
          {session.start_time && (
            <div className="flex items-center gap-1">
              <img
                src="/icons/calendar.svg"
                className="w-4 h-4 opacity-60"
                alt=""
              />
              <span>{startLabel}</span>
            </div>
          )}
        </div>

        {/* type pill */}
        <div
          className="
            inline-flex items-center rounded-full px-3 py-[4px]
            text-[10px] font-normal
          "
          style={{ backgroundColor: type.bg, color: type.color }}
        >
          {type.label}
        </div>
      </div>

      {/* RIGHT SIDE – count + buttons */}
      <div className="flex flex-col lg:flex-row items-center gap-4 flex-shrink-0">
        {/* count block */}
        <div className="px-12 text-center">
          <div className="text-[32px] font-bold text-brandBlack leading-none">
            {currentCount}
          </div>
          <div className="text-[10px] text-[#606060] mt-1 tracking-wide">
            In the session
          </div>
        </div>

        {/* buttons */}
        <div className="flex items-center gap-2">
          {/* Book / Booked */}
          {!isBooked ? (
            <button
              onClick={() => onBook(session.id)}
              className="
                inline-flex items-center justify-center gap-2
                px-6 py-3 rounded-full
                border border-brandBlack
                text-[14px] font-semibold
                hover:bg-bookedGreen/20 hover:border-bookedGreen
                transition-colors
              "
            >
              <img src="/icons/deepwork.svg" className="w-4 h-4" alt="" />
              <span>Book session</span>
            </button>
          ) : (
            <button
              onClick={() => onCancelBooking(session.id)}
              className="
                inline-flex items-center justify-center gap-2
                px-6 py-3 rounded-full
                border border-bookedGreen
                bg-bookedGreen/20
                text-[14px] font-semibold text-bookedGreen
                transition-colors
              "
            >
              <span>Booked</span>
            </button>
          )}

          {/* Join */}
          <button
            onClick={() => onJoin(session.id)}
            className={`
              inline-flex items-center justify-center
              px-6 py-3 rounded-full
              text-[14px] font-semibold
              bg-brandBlack text-white border border-brandBlack
              transition-colors
              ${type.joinHover}
            `}
          >
            Join session
          </button>
        </div>
      </div>
    </div>
  );
}

export default SessionCard;
