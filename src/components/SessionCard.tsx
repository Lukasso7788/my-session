export function SessionCard({ session, userId, onBook, onCancel, onJoin, onDelete }) {
  const isHost = session.host_id === userId;
  const isBooked = session.bookings?.some(b => b.user_id === userId);

  const typeMap = {
    "Deep work": { color: "#3B82F6", bg: "#E4EDFF" },
    "Pomodoro": { color: "#EF4444", bg: "#FFE4E4" },
    "Short sprints": { color: "#22C55E", bg: "#E5FFE9" },
  };

  const t = typeMap[session.type] || { color: "#000", bg: "#EEE" };

  return (
    <div className="
      border border-borderGray rounded-[42px]
      px-10 py-6 bg-white flex flex-col lg:flex-row
      items-start lg:items-center justify-between gap-6
      hover:bg-slate-50 transition
      relative
    ">

      {/* DELETE (host only) */}
      {isHost && (
        <button
          className="
            absolute right-6 top-6 h-10 w-10 rounded-full
            bg-[#F65252]/10 hover:bg-[#F65252]/20 flex items-center justify-center
          "
          onClick={() => onDelete(session.id)}
        >
          <img src="/icons/delete.svg" className="w-5 h-5" />
        </button>
      )}

      {/* LEFT SECTION */}
      <div className="flex-1 space-y-3">
        
        {/* TITLE */}
        <h3 className="text-[22px] font-semibold">
          {session.title}
        </h3>

        {/* META ROW */}
        <div className="flex flex-wrap gap-4 text-xs md:text-sm text-slate-600">

          {/* HOST */}
          <div className="flex items-center gap-1">
            <img src="/icons/user.svg" className="w-4 h-4 opacity-60" />
            <span>Host</span>
            <button
              className="underline underline-offset-2"
              onClick={() => {/* navigate to profile */}}
            >
              {session.host_name || "Unknown"}
            </button>
          </div>

          {/* DURATION */}
          <div className="flex items-center gap-1">
            <img src="/icons/clock.svg" className="w-4 h-4 opacity-60" />
            <span>{session.duration_minutes} min</span>
          </div>

          {/* START TIME */}
          <div className="flex items-center gap-1 font-medium text-pomodoro">
            <img src="/icons/calendar.svg" className="w-4 h-4 opacity-60" />
            <span>{session.startsLabel}</span>
          </div>
        </div>

        {/* TAG */}
        <div
          className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full"
          style={{ backgroundColor: t.bg, color: t.color }}
        >
          {session.type}
        </div>
      </div>

      {/* RIGHT SECTION */}
      <div className="flex flex-col items-center gap-4 flex-shrink-0">

        {/* COUNT BLOCK */}
        <div className="text-center">
          <div className="text-[32px] font-semibold">
            {session.currentCount ?? 6}
          </div>
          <div className="text-xs text-slate-500 -mt-1">In the session</div>
        </div>

        {/* BUTTONS */}
        <div className="flex items-center gap-3">

          {/* BOOK / BOOKED */}
          {!isBooked ? (
            <button
              className="
                border border-brandBlack rounded-full px-6 py-3 font-medium
                hover:bg-brandBlack hover:text-white transition
                flex items-center gap-2
              "
              onClick={() => onBook(session.id)}
            >
              <img src="/icons/book.svg" className="w-4 h-4" />
              Book session
            </button>
          ) : (
            <button
              className="
                bg-[#32D74B]/20 border border-[#32D74B]
                rounded-full px-6 py-3 font-medium text-[#32D74B]
                flex items-center gap-2
              "
              onClick={() => onCancel(session.id)}
            >
              Booked
            </button>
          )}

          {/* JOIN */}
          <button
            className="
              rounded-full px-6 py-3 font-medium
              bg-brandBlack text-white
              hover:bg-black transition
            "
            onClick={() => onJoin(session.id)}
          >
            Join session
          </button>
        </div>
      </div>

    </div>
  );
}
