import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";

export default function SessionCard({
  session,
  userId,
  onBook,
  onCancelBooking,
  onJoin,
  onDelete,
}) {
  const isHost = session.host_id === userId;
  const initialIsBooked = session.session_bookings?.some(
    (b) => b.user_id === userId
  );

  // Состояние для управления переходом к кнопке "Cancel Booking" после клика
  const [isBookingConfirmed, setIsBookingConfirmed] =
    useState(initialIsBooked);
  // Состояние для управления ховером на кнопке "Cancel Booking"
  const [isHoveringCancel, setIsHoveringCancel] = useState(false);
  // Состояние для управления ховером на кнопке "Book Session"
  const [isHoveringBook, setIsHoveringBook] = useState(false);
  // Состояние для управления ховером на кнопке "Join Session"
  const [isHoveringJoin, setIsHoveringJoin] = useState(false);
  
  // НОВОЕ: Состояние для управления ховером на всей карточке
  const [isHoveringCard, setIsHoveringCard] = useState(false);

  // Синхронизация initialIsBooked с isBookingConfirmed при изменении сессии
  useEffect(() => {
    setIsBookingConfirmed(initialIsBooked);
  }, [session.id, initialIsBooked]);

  // ---------- FIXED TEMPLATE → TYPE MAP ----------
  const nameToTypeMap: Record<string, string> = {
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
      color: "#3B82F6", // Синий
      bg: "#E4EDFF",
      icon: "/icons/deepwork.svg",
    },
    Pomodoro: {
      color: "#EF4444", // Красный
      bg: "#FFE4E4",
      icon: "/icons/pomodoro.svg",
    },
    "Short sprints": {
      color: "#22C55E", // Зеленый
      bg: "#E5FFE9",
      icon: "/icons/sprints.svg",
    },
  };
  
  const t = typeMap[resolvedType];

  // ---------- FORMAT START TIME ----------
  const startDateString = session.start_time
    ? new Date(session.start_time).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  // ---------- REALTIME ATTENDANCE ----------
  const [attendanceCount, setAttendanceCount] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data } = await supabase
        .from("session_attendance")
        .select("user_id")
        .eq("session_id", session.id);

      if (active) {
        const s = new Set(data?.map((x) => x.user_id));
        setAttendanceCount(s.size);
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
      active = false;
      supabase.removeChannel(channel);
    };
  }, [session.id]);

  // Обработчик клика для бронирования
  const handleBookSession = () => {
    onBook(session.id);
    setIsBookingConfirmed(true);
    setIsHoveringBook(false);
  };

  // Обработчик клика для отмены бронирования
  const handleCancelBooking = () => {
    onCancelBooking(session.id);
    setIsBookingConfirmed(false);
    setIsHoveringCancel(false);
  };

  // Кнопка Book session (начальное состояние)
  const bookSessionButton = (
    <button
      onClick={handleBookSession}
      onMouseEnter={() => setIsHoveringBook(true)}
      onMouseLeave={() => setIsHoveringBook(false)}
      className={`
        rounded-full px-6 py-3 text-[14px] font-semibold
        flex items-center gap-2 transition-all duration-150
        ${
          isHoveringBook
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
      Book session
    </button>
  );

  // Кнопка Cancel booking (состояние после бронирования)
  const confirmedBookingButton = (
    <button
      onClick={isHoveringCancel ? handleCancelBooking : undefined}
      onMouseEnter={() => setIsHoveringCancel(true)}
      onMouseLeave={() => setIsHoveringCancel(false)}
      className={`
        rounded-full py-3 text-[14px] font-semibold flex items-center justify-center
        transition-all duration-150 ease-in-out
        ${
          isHoveringCancel
            ? "border border-[#F65252] bg-[#F65252]/5 text-[#F65252] px-6"
            : "border border-[#65D46C] bg-[#65D46C]/10 w-[48px] h-[48px]"
        }
      `}
    >
      {isHoveringCancel ? (
        // Контент при ховере (Cancel booking)
        <>
          <img
            src="/icons/cross-cancel.svg"
            className="w-4 h-4 mr-2"
          />
          Cancel booking
        </>
      ) : (
        // Контент в нормальном состоянии (Booked, маленькая иконка 24px)
        <img
          src="/icons/book-session-green.svg"
          className="w-6 h-6"
        />
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
        flex flex-col lg:flex-row justify-between
        gap-6
        transition-all duration-200 
        hover:bg-[#F6F6F6] hover:border-[#A3A3A3]
      "
      style={{ padding: "24px 32px" }}
    >
      {/* LEFT SIDE */}
      <div className="flex-1 space-y-3">
        <h3 className="text-[29px] font-bold leading-tight">{session.title}</h3>

        {/* META ROW */}
        <div className="flex flex-wrap items-center gap-4 text-[12px] text-[#606060]">
          {/* HOST */}
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

          {/* DURATION */}
          <div className="flex items-center gap-1">
            <img src="/icons/duration.svg" className="w-4 h-4 opacity-70" />
            <span>{session.duration_minutes} min</span>
          </div>

          {/* START DATE */}
          <div className="flex items-center gap-1">
            <img src="/icons/date.svg" className="w-4 h-4 opacity-70" />
            <span>{startDateString}</span>
          </div>

          {/* ORIGINAL TYPE INDICATOR (С обводкой) */}
          <div
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-1 transition-all duration-200"
            style={{
              // Динамические стили при ховере
              backgroundColor: isHoveringCard ? t.color : t.bg,
              color: isHoveringCard ? "white" : t.color,
              borderColor: t.color,
              fontSize: 10,
              fontWeight: 500,
            }}
          >
            <img 
              // Динамический путь к иконке (предполагая наличие -white версии)
              src={isHoveringCard ? t.icon.replace(".svg", "-white.svg") : t.icon}
              className="w-4 h-4" 
            />
            {resolvedType}
          </div>
        </div>
      </div>

      {/* RIGHT SIDE */}
      <div className="flex items-center gap-8">
        {/* VERTICAL LINE */}
        <div className  className="w-px h-16 bg-[#D9D9D9]" />

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
          {/* BOOK OR CANCEL BOOKING */}
          {isBookingConfirmed ? confirmedBookingButton : bookSessionButton}

          {/* JOIN (Измененные стили ховера: сплошной t.color, белый текст) */}
          <button
            onClick={() => onJoin(session.id)}
            onMouseEnter={() => setIsHoveringJoin(true)}
            onMouseLeave={() => setIsHoveringJoin(false)}
            style={{
              // Установка динамического цвета фона
              backgroundColor: isHoveringJoin ? t.color : undefined,
            }}
            className={`
              rounded-full px-6 py-3
              text-[14px] font-semibold
              transition-colors duration-150
              ${
                isHoveringJoin
                  ? // Ховер: Фон динамический (через style), текст белый
                    "text-white"
                  : // По умолчанию: Фон черный, текст белый
                    "bg-brandBlack text-white hover:bg-black"
              }
            `}
          >
            Join session
          </button>

          {/* HOST CANCEL */}
          {isHost && (
            <button
              onClick={() => onDelete(session.id)}
              className="
                h-10 w-10 rounded-full
                bg-[#FEE2E2] flex items-center justify-center
                hover:bg-[#FECACA]
              "
            >
              <img src="/icons/cross-cancel.svg" className="w-6 h-6" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}