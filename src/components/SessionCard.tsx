import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function SessionCard({
  session,
  userId,
  onBook,
  onCancel,
  onJoin,
  onDelete,
}) {
  const isHost = session.host_id === userId;
  const isBooked = session.bookings?.some((b) => b.user_id === userId);

  // --- SESSION TYPE COLORS ---
  const typeMap = {
    "Deep work": {
      color: "#3B82F6",
      bg: "#E4EDFF",
      hover: "hover:bg-deepWork",
    },
    Pomodoro: {
      color: "#EF4444",
      bg: "#FFE4E4",
      hover: "hover:bg-pomodoro",
    },
    "Short sprints": {
      color: "#22C55E",
      bg: "#E5FFE9",
      hover: "hover:bg-sprints",
    },
  };

  const t = typeMap[session.type] || {
    color: "#000",
    bg: "#EEE",
    hover: "hover:bg-brandBlack",
  };

  // --- REALTIME ATTENDANCE ---
  const [attendanceCount, setAttendanceCount] = useState<number>(0);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data, error } = await supabase
        .from("session_attendance")
        .select("user_id")
        .eq("session_id", session.id);

      if (!error && mounted) {
        const unique = new Set(data?.map((x) => x.user_id));
        setAttendanceCount(unique.size);
      }
    };

    load();

    // realtime listener
    const channel = supabase
      .channel(`attendance_${session.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_attendance" },
        () => {
          load();
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [session.id]);

  return (
    <div
      className="
        border border-borderGray rounded-[42px]
        px-8 py-6 bg-white
        flex flex-col lg:flex-row items-start lg:items-center
        justify-between gap-6
        hover:bg-slate-50 transition relative
      "
    >
      {/* HOST DELETE BUTTON */}
      {isHost && (
        <button
          onClick={() => onDelete(session.id)}
          className="
            absolute right-6 top-6 h-10 w-10 rounded-full
            bg-[#FEE2E2] flex items-center justify-center
            hover:bg-[#FECACA] transition
          "
        >
          <img src='/icons/delete.svg' className='w-5 h-5' />
        </button>
      )}

      {/* LEFT PART */}
      <div className="flex-1 space-y-3">
        {/* Title */}
        <h3 className="text-[29px] font-bold">{session.title}</h3>

        {/* META ROW */}
        <div className="flex flex-wrap gap-4 text-[12px] text-[#606060]">
          {/* HOST */}
          <div className="flex items-center gap-1">
            <img src="/icons/user.svg" className="w-4 h-4 opacity-60" />
            <span>Host</span>
            <span className="underline underline-offset-2">
              {session.host_name}
            </span>
          </div>

          {/* DURATION */}
          <div className="flex items-center gap-1">
            <img src="/icons/clock.svg" className="w-4 h-4 opacity-60" />
            <span>{session.duration_minutes} min</span>
          </div>

          {/* START TIME */}
          {session.startsLabel && (
            <div className="flex items-center gap-1">
              <img src="/icons/calendar.svg" className="w-4 h-4 opacity-60" />
              <span>{session.startsLabel}</span>
            </div>
          )}

          {/* TAG */}
          <div
            className="inline-flex items-center px-3 py-1 text-[10px] font-medium rounded-full"
            style={{ backgroundColor: t.bg, color: t.color }}
          >
            {session.type}
          </div>
        </div>
      </div>

      {/* RIGHT SIDE */}
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

          {/* BOOK / CANCEL BOOKING */}
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
              onClick={() => onCancel(session.id)}
              className="
                border border-[#32D74B]
                bg-[#32D74B]/20
                text-[#32D74B]
                px-6 py-3 rounded-full
                text-[14px] font-semibold
              "
            >
              Booked
            </button>
          )}

          {/* JOIN */}
          <button
            onClick={() => onJoin(session.id)}
            className={`
              rounded-full px-6 py-3 text-[14px] font-semibold
              bg-brandBlack text-white
              transition
              ${t.hover}
              hover:border-transparent
            `}
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
              <img src='/icons/delete.svg' className='w-4 h-4' />
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
