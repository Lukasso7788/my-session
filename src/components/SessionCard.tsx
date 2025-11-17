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

  // ---------- TYPE COLORS ----------
  const typeMap = {
    "Deep work": {
      color: "#3B82F6",
      bg: "#E4EDFF",
    },
    Pomodoro: {
      color: "#EF4444",
      bg: "#FFE4E4",
    },
    "Short sprints": {
      color: "#22C55E",
      bg: "#E5FFE9",
    },
  };

  const t = typeMap[session.type] || {
    color: "#000",
    bg: "#EEE",
  };

  // ---------- REALTIME ATTENDANCE ----------
  const [attendanceCount, setAttendance] = useState(0);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data } = await supabase
        .from("session_attendance")
        .select("user_id")
        .eq("session_id", session.id);

      if (mounted && data) {
        const unique = new Set(data.map((u) => u.user_id));
        setAttendance(unique.size);
      }
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
        flex flex-col lg:flex-row
        justify-between items-start lg:items-center
        gap-6 relative
      "
    >
      {/* DELETE BUTTON (HOST ONLY) */}
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

      {/* LEFT SECTION */}
      <div className="flex-1 space-y-3">
        {/* TITLE */}
        <h3 className="text-[29px] font-bold">{session.title}</h3>

        {/* META ROW */}
        <div className="flex flex-wrap items-center gap-4 text-[12px] text-[#606060]">

          {/* HOST */}
          <button
            onClick={() => navigate(`/profile/${session.host_id}`)}
            className="flex items-center gap-2 hover:text-black transition"
          >
            <img
              src="/icons/host.svg"
              className="w-4 h-4"
              style={{ opacity: 0.7 }}
            />
            <span className="underline underline-offset-2">{session.host_name}</span>
          </button>

          {/* DURATION */}
          <div className="flex items-center gap-2">
            <img
              src="/icons/duration.svg"
              className="w-4 h-4"
              style={{ opacity: 0.7 }}
            />
            <span>{session.duration_minutes} min</span>
          </div>

          {/* START DATE */}
          <div className="flex items-center gap-2">
            <img
              src="/icons/date.svg"
              className="w-4 h-4"
              style={{ opacity: 0.7 }}
            />
            <span>{session.startsLabel || "—"}</span>
          </div>

          {/* —— OLD STYLE TYPE TAG —— */}
          <div
            className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-medium"
            style={{
              backgroundColor: t.bg,
              color: t.color,
            }}
          >
            {session.type}
          </div>
        </div>
      </div>

      {/* RIGHT SECTION */}
      <div className="flex flex-row items-center gap-4 flex-shrink-0">

        {/* COUNT BLOCK */}
        <div className="px-12 text-center">
          <div className="text-[32px] font-bold text-brandBlack">
            {attendanceCount}
          </div>
          <div className="text-[10px] font-light text-[#606060] -mt-1">
            in the session
          </div>
        </div>

        {/* BUTTONS */}
        <div className="flex items-center gap-2">

          {/* BOOK / CANCEL */}
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
                bg-[#32D74B]/20 border border-[#32D74B]
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
            className="
              rounded-full px-6 py-3 text-[14px] font-semibold
              bg-brandBlack text-white transition
              hover:bg-black hover:border-transparent
            "
          >
            Join session
          </button>

          {/* HOST CANCEL */}
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
