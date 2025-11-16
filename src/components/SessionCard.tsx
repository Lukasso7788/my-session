export function SessionCard({ session, userId, onBook, onCancel, onJoin, onDelete }) {
  const isHost = session.host_id === userId;
  const isBooked = session.bookings?.some(b => b.user_id === userId);

  const typeColor = {
    "Deep work": "deepWork",
    "Pomodoro": "pomodoro",
    "Short sprints": "sprints",
  }[session.type] || "brandBlack";

  return (
    <div className="border border-border rounded-2xl p-6 bg-white text-brandBlack relative">

      {/* DELETE BUTTON — only host */}
      {isHost && (
        <button
          className="absolute right-5 top-5 h-10 w-10 bg-[#F65252]/10 hover:bg-[#F65252]/20 transition rounded-full flex items-center justify-center"
          onClick={() => onDelete(session.id)}
        >
          ❌
        </button>
      )}

      <h2 className="text-[26px] font-semibold leading-tight">
        {session.title}
      </h2>

      <div className="flex items-center gap-2 mt-2 text-sm text-gray-600">
        <span>👤 Host: {session.host_name}</span>
        <span>⏱ {session.duration} min</span>
        <span>📅 Starts in {session.startsIn} mins</span>
      </div>

      {/* tag */}
      <div className={`inline-block px-3 py-1 text-xs rounded-full mt-3 bg-${typeColor}/10 text-${typeColor}`}>
        {session.type}
      </div>

      <div className="flex items-center gap-4 mt-5">

        {!isBooked ? (
          <button
            className="
              border border-brandBlack rounded-full px-6 py-3 font-medium
              hover:bg-[#32D74B]/20 hover:border-[#32D74B] transition
            "
            onClick={() => onBook(session.id)}
          >
            Book session
          </button>
        ) : (
          <button
            className="bg-[#32D74B]/20 border border-[#32D74B] rounded-full px-6 py-3 font-medium text-transparent"
            onClick={() => onCancel(session.id)}
          >
            Booked
          </button>
        )}

        <button
          className={`
            rounded-full px-6 py-3 font-medium border border-brandBlack
            hover:bg-${typeColor} hover:text-white transition
          `}
          onClick={() => onJoin(session.id)}
        >
          Join session
        </button>
      </div>

    </div>
  );
}
