// src/components/body/BodyTriplingSessionCard.tsx
import { useMemo } from "react";
import { Clock3, Timer, Flame, Users } from "lucide-react";

type BookingProfile = {
    id: string;
    full_name?: string | null;
    avatar_url?: string | null;
    email?: string | null;
};

type SessionBookingRow = {
    user_id: string;
    profiles?: BookingProfile | null;
};

type BodySession = {
    id: string;
    title?: string;
    host_id?: string;
    host_name?: string;
    start_time?: string;
    duration_minutes?: number;
    max_participants?: number | null;
    session_bookings?: SessionBookingRow[];
};

function initials(name: string) {
    const s = (name || "").trim();
    if (!s) return "?";
    const parts = s.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || "?";
    const b = parts[1]?.[0] || "";
    return (a + b).toUpperCase();
}

function timeLabel(iso?: string) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isToday(iso?: string) {
    if (!iso) return false;
    const d = new Date(iso);
    const now = new Date();
    return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
    );
}

export default function BodyTriplingSessionCard(props: {
    session: BodySession;
    userId?: string;

    onJoin: (id: string) => void;
    onBook: (id: string) => Promise<void>;
    onCancelBooking: (id: string) => Promise<void>;
}) {
    const { session, userId, onJoin, onBook, onCancelBooking } = props;

    const max = session.max_participants ?? 3;
    const bookings = session.session_bookings?.length || 0;
    const filled = Math.min(max, bookings + 1); // host included
    const fillText = `${filled}/${max} filled`;

    const fillStyle = useMemo(() => {
        if (filled >= max) return { border: "#FCA5A5", bg: "#FEE2E2", text: "#B91C1C" }; // red
        if (filled === max - 1) return { border: "#93C5FD", bg: "#DBEAFE", text: "#1D4ED8" }; // blue
        return { border: "#86EFAC", bg: "#DCFCE7", text: "#15803D" }; // green
    }, [filled, max]);

    const hostIsYou = !!userId && session.host_id === userId;
    const youBooked = !!userId && (session.session_bookings || []).some((b) => b.user_id === userId);

    const canJoin = filled < max || hostIsYou || youBooked;
    const canBook = !hostIsYou && !youBooked && filled < max;

    const start = timeLabel(session.start_time);
    const today = isToday(session.start_time);

    const dur = Number(session.duration_minutes) || 0;
    const modeLabel = dur >= 50 ? "Deep Work" : "Pomodoro";
    const ModeIcon = dur >= 50 ? Flame : Timer;

    const avatars = useMemo(() => {
        const list: { key: string; url?: string | null; label: string }[] = [];

        // host (no profile here, so initials)
        list.push({
            key: "host",
            url: null,
            label: (session.host_name || (hostIsYou ? "You" : "Host")).trim() || "Host",
        });

        // bookings profiles
        for (const b of session.session_bookings || []) {
            const p = b.profiles;
            list.push({
                key: b.user_id,
                url: p?.avatar_url || null,
                label: (p?.full_name || p?.email || "User").trim(),
            });
        }

        return list;
    }, [session.host_name, session.session_bookings, hostIsYou]);

    const visibleAvatars = avatars.slice(0, 3);
    const rest = Math.max(0, avatars.length - visibleAvatars.length);

    return (
        <div className="rounded-[20px] border border-[#E6E6E6] bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
            <div className="flex items-start justify-between gap-4">
                {/* Left: host */}
                <div className="min-w-0">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-[#F3F4F6] border border-[#E6E6E6] flex items-center justify-center text-[12px] font-semibold text-[#111827]">
                            {initials((session.host_name || (hostIsYou ? "You" : "Host")) as string)}
                        </div>

                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <div className="font-inter font-semibold text-[16px] text-[#111827] truncate">
                                    {hostIsYou ? "You" : session.host_name || "Host"}
                                </div>
                                {hostIsYou && (
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#DBEAFE] text-[#1D4ED8] border border-[#93C5FD]">
                                        Host
                                    </span>
                                )}
                            </div>

                            {/* avatars row */}
                            <div className="mt-1 flex items-center gap-2">
                                <div className="flex -space-x-2">
                                    {visibleAvatars.map((a) => (
                                        <div
                                            key={a.key}
                                            className="h-7 w-7 rounded-full border border-white bg-[#F3F4F6] overflow-hidden flex items-center justify-center text-[10px] font-semibold text-[#111827]"
                                            title={a.label}
                                        >
                                            {a.url ? (
                                                <img src={a.url} alt="" className="h-full w-full object-cover" />
                                            ) : (
                                                initials(a.label)
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {rest > 0 && <div className="text-[12px] text-[#111827]/70">+{rest} more</div>}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right: filled pill */}
                <div
                    className="shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-semibold"
                    style={{ borderColor: fillStyle.border, backgroundColor: fillStyle.bg, color: fillStyle.text }}
                    title={fillText}
                >
                    {fillText}
                    <div className="h-5 w-5 rounded-full flex items-center justify-center" style={{ backgroundColor: fillStyle.border, color: "white" }}>
                        {Math.min(max, filled)}
                    </div>
                </div>
            </div>

            {/* Middle line: Today + session label */}
            <div className="mt-4 text-[14px] text-[#111827] flex items-center gap-2">
                <span className="font-semibold">{today ? "Today" : "Scheduled"}</span>
                <span className="text-[#111827]/60">·</span>
                <span className="inline-flex items-center gap-2 text-[#111827]/80">
                    <Users className="w-4 h-4" />
                    <span className="font-semibold">{modeLabel}</span>
                    <span className="text-[#111827]/60">·</span>
                    <span>{dur ? `${dur}min session` : session.title || "session"}</span>
                </span>
            </div>

            <div className="mt-3 border-t border-[#EFEFEF]" />

            {/* Starts at */}
            <div className="mt-3 flex items-center gap-2 text-[13px] text-[#111827]/80">
                <div className="h-5 w-5 rounded-full bg-[#DCFCE7] border border-[#86EFAC] inline-flex items-center justify-center text-[#15803D]">
                    <Clock3 className="w-3.5 h-3.5" />
                </div>
                <span>Starts {start ? `at ${start}` : "soon"}</span>

                {/* mode icon on the right */}
                <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-[#111827]/70">
                    <ModeIcon className="w-4 h-4" />
                    {dur >= 50 ? "Deep Work" : "Pomodoro"}
                </span>
            </div>

            {/* Buttons */}
            <div className="mt-4 flex items-center gap-3">
                <button
                    type="button"
                    disabled={!canBook && !youBooked}
                    onClick={() => {
                        if (youBooked) return onCancelBooking(session.id);
                        if (canBook) return onBook(session.id);
                    }}
                    className={`
            flex-1 rounded-full border px-4 py-2.5 text-[13px] font-semibold
            transition
            ${youBooked
                            ? "border-[#111827] text-[#111827] hover:bg-[#111827] hover:text-white"
                            : canBook
                                ? "border-[#DBD8D8] text-[#111827] hover:bg-[#F3F4F6]"
                                : "border-[#E6E6E6] text-[#A3A3A3] cursor-not-allowed"
                        }
          `}
                >
                    {filled >= max && !youBooked && !canBook ? "Fully booked" : youBooked ? "Cancel booking" : "Book session"}
                </button>

                <button
                    type="button"
                    disabled={!canJoin}
                    onClick={() => canJoin && onJoin(session.id)}
                    className={`
            flex-1 rounded-full px-4 py-2.5 text-[13px] font-semibold
            transition border
            ${canJoin
                            ? "bg-[#111827] text-white border-[#111827] hover:bg-black"
                            : "bg-[#E5E7EB] text-[#9CA3AF] border-[#E5E7EB] cursor-not-allowed"
                        }
          `}
                >
                    {canJoin ? "Join session" : "Fully booked"}
                </button>
            </div>
        </div>
    );
}
