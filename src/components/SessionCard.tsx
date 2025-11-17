import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function SessionCard({
  session,
  userId,
  onBook,
  onCancel,
  onJoin,
  onDelete,
}) {
  const navigate = useNavigate();

  const isHost = session.host_id === userId;
  const isBooked = session.session_bookings?.some((b) => b.user_id === userId);

  // ---- TYPE STYLES ----
  const typeMap = {
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

  const t = typeMap[session.type] || {
    color: "#000",
    bg: "#EEE",
    icon: "/icons/default.svg",
  };

  // ---- REALTIME ATTENDANCE ----
  const [attendanceCount, setAttendanceCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data, error } = await supabase
        .from("session_attendance")
        .select("user_id")
        .eq("session_id", session.id);

      if (!error && mounted) {
        setAttendanceCount(new Set(data?.map((v) => v.user_id)).size);
      }
    };

    load();

    const channel = supabase
      .channel(`attendance_${session.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "session_attendance",
      }, load)
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [session.id]);

  // Format start time
  const formattedStart =
    session.start_time ?
    new Date(session.start_time).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) :
    "";

  return (
    <div
      className="
        border border-borderGray bg-white rounded-[42px]
        px-8 py-6
        flex flex-col lg:flex-row
        justify-between items-start lg:items-center
        gap-6 relative
        hover:bg-slate-50 transition
      "
    >

      {/* DELETE BUTTON (HOST) */}
      {isHost && (
        <button
          onClick={() => onDelete(session.id)}
          className="
            absolute top-6 right-6
            h-10 w-10 rounded-full bg-[#FEE2E2]
            flex items-center justify-center
            hover:bg-[#FECACA] transition
          "
        >
          <img src="/icons/delete.svg" className="w-5 h-5" />
        </button>
      )}

      {/* LEFT BLOCK */}
      <div className="flex-1 flex flex-col gap-3">

        {/* TITLE */}
        <h3 className="text-[29px] font-bold">
          {session.title}
        </h3>

        {/* META ROW */}
        <div className="flex flex-wrap items-center gap-4 text-[12px] text-[#606060]">

          {/* HOST */}
          <button
            onClick={() => navigate(`/profile/${session.host_id}`)}
            className="flex items-center gap-1 hover:opacity-70 transition"
          >
            <img src="/icons/host.svg" className="w-4 h-4 opacity-60" />
            <span>Host:</span>
            <span className="underline underline-offset-2">{session.host_name}</span>
          </button>

          {/* DURATION */}
          <div className="flex items-center gap-1">
            <img src="/icons/duration.svg" className="w-4 h-4 opacity-60" />
            <span>{session.duration_minutes} min</span>
          </div>

          {/* START TIME */}
          <div className="flex items-center gap-1">
            <img src="/icons/date.svg" className="w-4 h-4 opacity-60" />
            <span>{formattedStart}</span>
          </div>

          {/* TYPE TAG */}
          <div
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-medium"
            style={{ backgroundColor: t.bg, color: t.color }}
          >
            <img src={t.icon} className="w-4 h-4" />
            {session.type}
          </div>

        </div>
      </div>

      {/* RIGHT SIDE (COUNT + BUTTONS) */}
      <div className="flex flex-row items-center gap-4 flex-shrink-0">

        {/* COUNT BLOCK */}
        <div className="px-12 text-center">
          <div className="text-[32px] font-bold text-brandBlack">
            {attendanceCount}
          </div>
          <div className="text-[10px] text-[#606060] font-light -mt-1">
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
                px-6 py-3 text-[14px] font-semibold flex items-center gap-2
                hover:text-[#65D46C] transition
              "
            >
              <img src="/icons/book.svg" className="w-4 h-4" />
              Book session
            </button>
          ) : (
            <button
              onClick={() => onCancel(session.id)}
              className="
                border border-[#32D74B] bg-[#32D74B]/20 text-[#32D74B]
                px-6 py-3 rounded-full text-[14px] font-semibold
              "
            >
              Booked
            </button>
          )}

          {/* JOIN BUTTON */}
          <button
            onClick={() => onJoin(session.id)}
            className="
              rounded-full px-6 py-3 text-[14px] font-semibold
              bg-brandBlack text-white
              hover:bg-black transition
              border-none outline-none
            "
          >
            Join session
          </button>

          {/* CANCEL SESSION (HOST) */}
          {isHost && (
            <button
              onClick={() => onDelete(session.id)}
              className="
                bg-[#FEE2E2] text-[#EF4444]
                px-6 py-3 rounded-full text-[14px] font-semibold
                flex items-center gap-2
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
