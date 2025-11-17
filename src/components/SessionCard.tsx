// src/components/SessionCard.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type SessionCardProps = {
  session: any; // SessionWithRelations, но не жёстко типизируем, чтобы не падать
  userId?: string;
  onBook: (sessionId: string) => void;
  onCancelBooking: (sessionId: string) => void;
  onJoin: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
};

// маппинг названия шаблона в тип сессии
function mapFormatToType(format?: string | null): "Deep work" | "Pomodoro" | "Short sprints" {
  const f = (format || "").toLowerCase();

  if (f.includes("pomodoro 15/3")) return "Short sprints"; // 1h & 2h 15/3
  if (f.includes("pomodoro 25/5")) return "Pomodoro";      // 1h & 2h 25/5
  if (f.includes("uninterrupted focus")) return "Deep work";
  if (f.includes("2x 50min focus blocks")) return "Deep work";

  return "Deep work"; // дефолт
}

// форматируем дату старта в label
function getStartsLabel(startTime?: string | null): string | null {
  if (!startTime) return null;
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SessionCard({
  session,
  userId,
  onBook,
  onCancelBooking,
  onJoin,
  onDelete,
}: SessionCardProps) {
  const isHost = session.host_id === userId;

  // бронирования – из session_bookings
  const isBooked = session.session_bookings?.some(
    (b: { user_id: string }) => b.user_id === userId
  );

  const typeLabel = mapFormatToType(session.format);
  const startsLabel = getStartsLabel(session.start_time);

  // --- SESSION TYPE COLORS / hover для Join ---
  const typeMap: Record<
    string,
    { color: string; bg: string; hover: string }
  > = {
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

  const t =
    typeMap[typeLabel] || ({
      color: "#000000",
      bg: "#EEEEEE",
      hover: "hover:bg-brandBlack",
    } as const);

  // --- REALTIME ATTENDANCE (уникальные user_id) ---
  const [attendanceCount, setAttendanceCount] = useState<number>(0);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data, error } = await supabase
        .from("session_attendance")
        .select("user_id")
        .eq("session_id", session.id);

      if (!error && mounted) {
        const unique = new Set((data || []).map((x) => x.user_id));
        setAttendanceCount(unique.size);
      }
    };

    load();

    const channel = supabase
      .channel(`attendance_${session.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_attendance" },
        () => {
          // при любом INSERT/DELETE/UPDATE пересчитываем
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
        hover:bg-slate-50 transition
        relative
      "
    >
      {/* HOST DELETE BUTTON (красный кружок с крестиком, только для хоста) */}
      {isHost && (
        <button
          onClick={() => onDelete(session.id)}
          className="
            absolute right-6 top-6 h-10 w-10 rounded-full
            bg-[#FEE2E2] flex items-center justify-center
            hover:bg-[#FECACA] transition
          "
        >
          <img src="/icons/delete.svg" className="w-4 h-4" alt="Cancel session" />
        </button>
      )}

      {/* ===== LEFT: заголовок + мета ===== */}
      <div className="flex-1 space-y-3">
        {/* Заголовок 29px, Inter Bold */}
        <h3 className="text-[29px] font-bold">{session.title}</h3>

        {/* Мета-ряд под заголовком */}
        <div className="flex flex-wrap gap-4 text-[12px] text-[#606060]">
          {/* HOST */}
          <div className="flex items-center gap-1">
            <img src="/icons/user.svg" className="w-4 h-4 opacity-60" alt="" />
            <span>Host</span>
            <span className="underline underline-offset-2">
              {session.host_name || "Unknown"}
            </span>
          </div>

          {/* DURATION */}
          <div className="flex items-center gap-1">
            <img src="/icons/clock.svg" className="w-4 h-4 opacity-60" alt="" />
            <span>{session.duration_minutes} min</span>
          </div>

          {/* START TIME */}
          {startsLabel && (
            <div className="flex items-center gap-1">
              <img src="/icons/calendar.svg" className="w-4 h-4 opacity-60" alt="" />
              <span>{startsLabel}</span>
            </div>
          )}

          {/* TYPE TAG (deep work / pomodoro / short sprints) */}
          <div
            className="
              inline-flex items-center px-3 py-1
              text-[10px] font-medium rounded-full
            "
            style={{ backgroundColor: t.bg, color: t.color }}
          >
            {typeLabel}
          </div>
        </div>
      </div>

      {/* ===== RIGHT: индикатор участников + кнопки ===== */}
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

        {/* BUTTONS ROW */}
        <div className="flex items-center gap-2">
          {/* BOOK / BOOKED */}
          {!isBooked ? (
            <button
              onClick={() => onBook(session.id)}
              className="
                border border-brandBlack rounded-full
                px-6 py-3 text-[14px] font-semibold
                flex items-center gap-2
                text-brandBlack
                hover:text-[#65D46C] hover:bg-transparent
                transition
              "
            >
              <img src="/icons/book.svg" className="w-4 h-4" alt="" />
              Book session
            </button>
          ) : (
            <button
              onClick={() => onCancelBooking(session.id)}
              className="
                border border-[#32D74B]
                bg-[#32D74B]/20
                text-[#32D74B]
                px-6 py-3 rounded-full
                text-[14px] font-semibold
                flex items-center gap-2
              "
            >
              Booked
            </button>
          )}

          {/* JOIN – без чёрной обводки, ховер в цвет типа сессии */}
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

          {/* HOST: отменить сессию (опциональная кнопка) */}
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
              <img src="/icons/delete.svg" className="w-4 h-4" alt="" />
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SessionCard;
