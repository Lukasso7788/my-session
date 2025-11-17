import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function SessionCard({
  session,
  userId,
  onBook,
  onCancelBooking,
  onJoin,
  onDelete,
}) {
  const navigate = useNavigate();

  const isHost = session.host_id === userId;
  const isBooked = session.session_bookings?.some((b) => b.user_id === userId);

  // ---------- TEMPLATE → TYPE ----------
  const nameToTypeMap = {
    "1 Hour — Pomodoro 15/3": "Short sprints",
    "2 Hours — Pomodoro 15/3": "Short sprints",

    "1 Hour — Pomodoro 25/5": "Pomodoro",
    "2 Hours — Pomodoro 25/5": "Pomodoro",

    "1 Hour — Uninterrupted Focus": "Deep work",
    "2 Hours — 2x 50min Focus Blocks": "Deep work",
  };

  const resolvedType = nameToTypeMap[session.title] || session.type;

  const typeMap = {
    "Deep work": {
      bg: "#E4EDFF",
      color: "#3B82F6",
      icon: "/icons/deepwork.svg",
    },
    Pomodoro: {
      bg: "#FFE4E4",
      color: "#EF4444",
      icon: "/icons/pomodoro.svg",
    },
    "Short sprints": {
      bg: "#E5FFE9",
      color: "#22C55E",
      icon: "/icons/sprints.svg",
    },
  };

  const t = typeMap[resolvedType];

  // ---------- REALTIME ATTENDANCE ----------
  const [attendanceCount, setAttendanceCount] = useState(0);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("session_attendance")
        .select("user_id")
        .eq("session_id", session.id);

      const uniq = new Set(data?.map((x) => x.user_id));
      setAttendanceCount(uniq.size);
    };

    load();

    const channel = supabase
      .channel(`attendance_${session.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_attendance" },
        load
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session.id]);

  // ---------- FORMAT START TIME ----------
  const dateString = session.start_time
    ? new Date(session.start_time).toLocaleString("en-US", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <div
      className="
        relative
        border border-borderGray rounded-[42px]
        bg-white
        flex flex-col lg:flex-row 
        justify-between
        gap-6
      "
      style={{ padding: "24px 32px" }}
    >
      {/* DELETE BUTTON FLOATING */}
      {isHost && (
        <button
          onClick={() => onDelete(session.id)}
          className="
            absolute right-8 top-8 h-10 w-10 rounded-full
            bg-[#FEE2E2]
            flex items-center justify-center
            hover:bg-[#FECACA]
            transition
          "
        >
          <img src="/icons/delete.svg" className="w-4 h-4" />
        </button>
      )}

      {/* LEFT SIDE */}
      <div className="flex-1 space-y-3">
        {/* TITLE */}
        <h3 className="text-[29px] font-bold leading-tight">{session.title}</h3>

        {/* META */}
        <div className="flex flex-wrap items-center gap-4 text-[12px] text-[#606060]">

          {/* HOST */}
          <button
            onClick={() => navigate(`/profile/${session.host_id}`)}
            className="flex items-center gap-1 hover:opacity-70 transition"
          >
            <img src="/icons/host.svg" className="w-4 h-4 opacity-70" />
            <span>Host</span>
            <span className="underline underline-offset-2">
              {session.host_name}
            </span>
          </button>

          {/* DURATION */}
          <div className="flex items-center gap-1">
            <img src="/icons/duration.svg" className="w-4 h-4 opacity-70" />
            <span>{session.duration_minutes} min</span>
          </div>

          {/* START TIME */}
          <div className="flex items-center gap-1">
            <img src="/icons/date.svg" className="w-4 h-4 opacity-70" />
            <span>{dateString}</span>
          </div>

          {/* TYPE BADGE (OLD STYLE) */}
          <div
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full"
            style={{
              backgroundColor: t.bg,
              color: t.color,
              fontSize: 10,
              fontWeight: 500,
            }}
          >
            <img src={t.icon} className="w-4 h-4" />
            {resolvedType}
          </div>
        </div>
      </div>

      {/* RIGHT SIDE */}
      <div className="flex items-center gap-6">

        {/* VERTICAL SEPARATOR */}
        <div className="w-px h-16 bg-[#D9D9D9]" />

        {/* COUNT BLOCK */}
        <div className="px-12 text-center">
          <div className="text-[32px] font-bold text-brandBlack">
            {attendanceCount}
          </div>
          <div className="text-[10px] mt-[-2px] text-[#606060]">
            in the session
          </div>
        </div>

        {/* BUTTONS */}
        <div className="flex items-center gap-2">

          {/* BOOK BUTTON */}
          {!isBooked ? (
            <button
              onClick={() => onBook(session.id)}
              className="
                border border-brandBlack rounded-full
                px-6 py-3
                text-[14px] font-semibold
                flex items-center gap-2
                hover:text-[#65D46C]
                hover:bg-transparent
                transition
              "
            >
              <img src="/icons/book-session.svg" className="w-4 h-4" />
              Book session
            </button>
          ) : (
            <button
              onClick={() => onCancelBooking(session.id)}
              className="
                bg-[#32D74B]/20 border border-[#32D74B]
                text-[#32D74B]
                px-6 py-3 rounded-full
                text-[14px] font-semibold
              "
            >
              Cancel booking
            </button>
          )}

          {/* JOIN */}
          <button
            onClick={() => onJoin(session.id)}
            className="
              rounded-full px-6 py-3
              text-[14px] font-semibold
              bg-brandBlack text-white
              hover:bg-black
              transition
              border-none
            "
          >
            Join session
          </button>

          {/* HOST CANCEL SESSION */}
          {isHost && (
            <button
              onClick={() => onDelete(session.id)}
              className="
                bg-[#FEE2E2] text-[#EF4444]
                px-6 py-3 rounded-full
                flex items-center gap-2
                text-[14px] font-semibold
              "
            >
              <img src="/icons/delete.svg" className="w-4 h-4" />
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
