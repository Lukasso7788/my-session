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
  const isBooked = session.session_bookings?.some(b => b.user_id === userId);

  // ========= TYPE COLORS =========
  const typeMap = {
    "Deep work": {
      text: "text-[#3B82F6]",
      border: "border-[#3B82F6]",
    },
    "Pomodoro": {
      text: "text-[#EF4444]",
      border: "border-[#EF4444]",
    },
    "Short sprints": {
      text: "text-[#22C55E]",
      border: "border-[#22C55E]",
    },
  };

  const t = typeMap[session.type] || {
    text: "text-black",
    border: "border-black",
  };

  // ========= REALTIME ATTENDANCE =========
  const [attendanceCount, setAttendance] = useState<number>(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data } = await supabase
        .from("session_attendance")
        .select("user_id")
        .eq("session_id", session.id);

      if (!active) return;
      const unique = new Set(data?.map(x => x.user_id));
      setAttendance(unique.size);
    };

    load();

    const channel = supabase
      .channel(`attendance_${session.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_attendance" },
        () => load()
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [session.id]);

  // ========= RENDER =========
  return (
    <div
      className="
        border border-borderGray rounded-[42px]
        px-8 py-6 bg-white
        flex flex-col lg:flex-row justify-between gap-6
        hover:bg-slate-50 transition relative
      "
    >
      {/* DELETE (HOST) */}
      {isHost && (
        <button
          onClick={() => onDelete(session.id)}
          className="
            absolute right-6 top-6 h-10 w-10 rounded-full
            bg-[#FEE2E2] hover:bg-[#FECACA]
            flex items-center justify-center transition
          "
        >
          <img src="/icons/delete.svg" className="w-5 h-5" />
        </button>
      )}

      {/* LEFT SIDE */}
      <div className="flex-1 space-y-3">
        {/* TITLE */}
        <h3 className="text-[29px] font-bold">{session.title}</h3>

        {/* META */}
        <div className="flex flex-wrap gap-4 text-[12px] text-[#606060]">

          <button
            className="flex items-center gap-1 underline underline-offset-2"
            onClick={() => navigate(`/profile/${session.host_id}`)}
          >
            <img src="/icons/host.svg" className="w-4 h-4 opacity-60" />
            Host: {session.host_name}
          </button>

          <div className="flex items-center gap-1">
            <img src="/icons/duration.svg" className="w-4 h-4 opacity-60" />
            {session.duration_minutes} min
          </div>

          {/* START DATETIME */}
          {session.start_time && (
            <div className="flex items-center gap-1">
              <img src="/icons/date.svg" className="w-4 h-4 opacity-60" />
              {new Date(session.start_time).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
          )}

          {/* OLD STYLE TYPE INDICATOR */}
          <div
            className={`
              inline-flex items-center gap-1
              px-3 py-1 rounded-full text-[10px] font-medium
              border ${t.border} ${t.text}
            `}
          >
            {/* ICON */}
            {session.type === "Pomodoro" && (
              <img src="/icons/pomodoro.svg" className="w-4 h-4" />
            )}
            {session.type === "Short sprints" && (
              <img src="/icons/sprints.svg" className="w-4 h-4" />
            )}
            {session.type === "Deep work" && (
              <img src="/icons/deepwork.svg" className="w-4 h-4" />
            )}

            {session.type}
          </div>
        </div>
      </div>

      {/* RIGHT SIDE */}
      <div className="flex flex-row items-center gap-6">

        {/* VERTICAL SEPARATOR */}
        <div className="w-px bg-borderGray h-20" />

        {/* COUNT BLOCK */}
        <div className="pl-[36px] pr-12 text-center">
          <div className="text-[32px] font-bold text-brandBlack">
            {attendanceCount}
          </div>
          <div className="text-[10px] text-[#606060] font-light">
            in the session
          </div>
        </div>

        {/* BUTTONS */}
        <div className="flex items-center gap-2">

          {/* BOOK */}
          {!isBooked ? (
            <button
              onClick={() => onBook(session.id)}
              className="
                border border-brandBlack rounded-full
                px-6 py-3 text-[14px] font-semibold
                flex items-center gap-2
                hover:text-[#65D46C] hover:bg-transparent transition
              "
            >
              <img src="/icons/book.svg" className="w-4 h-4" />
              Book session
            </button>
          ) : (
            <button
              onClick={() => onCancelBooking(session.id)}
              className="
                bg-[#FEE2E2] text-[#EF4444]
                px-6 py-3 rounded-full
                flex items-center gap-2 text-[14px] font-semibold
              "
            >
              <img src="/icons/delete.svg" className="w-4 h-4" />
              Cancel booking
            </button>
          )}

          {/* JOIN */}
          <button
            onClick={() => onJoin(session.id)}
            className="
              rounded-full px-6 py-3 text-[14px] font-semibold
              bg-brandBlack text-white
              hover:bg-black transition
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
                flex items-center gap-2 text-[14px] font-semibold
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
