// src/components/body/BodyTriplingBody.tsx
import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";

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

export type BodySession = {
    id: string;
    title?: string;
    start_time?: string;
    duration_minutes?: number;
    host_name?: string;
    max_participants?: number | null;
    session_bookings?: SessionBookingRow[];
};

function todayLocalYMD() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function nextRoundedTimeHHMM(stepMinutes = 5) {
    const d = new Date();
    d.setSeconds(0);
    d.setMilliseconds(0);

    const m = d.getMinutes();
    const rounded = Math.ceil(m / stepMinutes) * stepMinutes;
    d.setMinutes(rounded);

    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

function fmtTime(iso?: string) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso?: string) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString([], { year: "numeric", month: "2-digit", day: "2-digit" });
}

function Initials({ name }: { name?: string }) {
    const v = (name || "").trim();
    const letters = v
        .split(/\s+/)
        .slice(0, 2)
        .map((x) => x[0]?.toUpperCase())
        .filter(Boolean)
        .join("");
    return (
        <div className="h-8 w-8 rounded-full bg-[#111827] text-white flex items-center justify-center text-[12px] font-semibold">
            {letters || "U"}
        </div>
    );
}

function Avatars({ bookings }: { bookings?: SessionBookingRow[] }) {
    const people = (bookings || [])
        .map((b) => b.profiles)
        .filter(Boolean) as BookingProfile[];

    const shown = people.slice(0, 3);

    return (
        <div className="flex items-center -space-x-2">
            {shown.map((p) =>
                p.avatar_url ? (
                    <img
                        key={p.id}
                        src={p.avatar_url}
                        alt=""
                        className="h-8 w-8 rounded-full border-2 border-white object-cover"
                        draggable={false}
                    />
                ) : (
                    <div key={p.id} className="h-8 w-8 rounded-full border-2 border-white overflow-hidden">
                        <Initials name={p.full_name || p.email || undefined} />
                    </div>
                )
            )}
            {people.length > 3 && (
                <div className="h-8 w-8 rounded-full border-2 border-white bg-[#F3F4F6] flex items-center justify-center text-[11px] font-semibold text-[#111827]">
                    +{people.length - 3}
                </div>
            )}
        </div>
    );
}

function BodySessionCard(props: {
    s: BodySession;
    userId?: string;
    onJoin: (id: string) => void;
    onBook: (id: string) => Promise<void>;
    onCancelBooking: (id: string) => Promise<void>;
}) {
    const { s, userId, onJoin, onBook, onCancelBooking } = props;

    const [busy, setBusy] = useState(false);

    const bookedByMe = useMemo(() => {
        if (!userId) return false;
        return (s.session_bookings || []).some((b) => b.user_id === userId);
    }, [s.session_bookings, userId]);

    const count = (s.session_bookings || []).length;
    const max = typeof s.max_participants === "number" ? s.max_participants : 3;

    const onToggleBooking = async () => {
        if (!userId) return;
        try {
            setBusy(true);
            if (bookedByMe) await onCancelBooking(s.id);
            else await onBook(s.id);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-[20px] border border-[#E6E6E6] bg-white p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-[#111827] truncate">
                        {s.title || "body"}
                    </div>

                    <div className="mt-1 text-[13px] text-[#111827]/70">
                        {s.start_time ? (
                            <>
                                {fmtDate(s.start_time)} · {fmtTime(s.start_time)} ·{" "}
                                {s.duration_minutes || 0} min
                            </>
                        ) : (
                            <>Scheduled · {s.duration_minutes || 0} min</>
                        )}
                    </div>

                    <div className="mt-3 flex items-center gap-3">
                        <Avatars bookings={s.session_bookings} />
                        <div className="text-[13px] text-[#111827]/70">
                            {count}/{max} booked
                        </div>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                    <button
                        onClick={() => onJoin(s.id)}
                        className="
              rounded-full
              bg-[#111827] text-white
              px-4 py-2
              text-[13px] font-semibold
              hover:opacity-90
              transition
            "
                    >
                        Join
                    </button>

                    <button
                        disabled={!userId || busy}
                        onClick={onToggleBooking}
                        className={`
              rounded-full border px-4 py-2 text-[13px] font-semibold transition
              ${bookedByMe
                                ? "border-[#111827] text-[#111827] hover:bg-[#111827] hover:text-white"
                                : "border-[#E6E6E6] text-[#111827] hover:bg-[#F3F4F6]"
                            }
              ${!userId ? "opacity-40 cursor-not-allowed" : ""}
            `}
                        title={!userId ? "Login to book" : bookedByMe ? "Cancel booking" : "Book"}
                    >
                        {bookedByMe ? "Cancel" : "Book"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function BodyTriplingBody(props: {
    sessions: BodySession[];
    isLoading: boolean;
    dateFilter: string | null;
    onDateChange: (v: string | null) => void;
    userId?: string;
    onJoin: (id: string) => void;
    onBook: (id: string) => Promise<void>;
    onCancelBooking: (id: string) => Promise<void>;
    onCreateBodySession: (p: {
        duration: 25 | 50;
        dateYMD: string;
        timeHHMM: string;
    }) => Promise<void>;
}) {
    const {
        sessions,
        isLoading,
        dateFilter,
        onDateChange,
        userId,
        onJoin,
        onBook,
        onCancelBooking,
        onCreateBodySession,
    } = props;

    const dateValue = dateFilter || todayLocalYMD();

    const [draftDuration, setDraftDuration] = useState<25 | 50 | null>(null);
    const [draftTime, setDraftTime] = useState<string>(nextRoundedTimeHHMM(5));
    const [creating, setCreating] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        // when user switches date, keep it as creation date too
        setErr(null);
    }, [dateValue]);

    const cancelDraft = () => {
        setDraftDuration(null);
        setDraftTime(nextRoundedTimeHHMM(5));
        setErr(null);
    };

    const confirmDraft = async () => {
        if (!draftDuration) return;
        if (!userId) {
            setErr("Login required.");
            return;
        }

        try {
            setCreating(true);
            setErr(null);
            await onCreateBodySession({
                duration: draftDuration,
                dateYMD: dateValue,
                timeHHMM: draftTime,
            });
            cancelDraft();
        } catch (e: any) {
            setErr(e?.message || "Failed to create session");
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="w-full">
            <div className="rounded-[24px] border border-[#DBD8D8] bg-white p-6 sm:p-8">
                {/* Top bar */}
                <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                        <div className="text-[14px] font-semibold text-[#111827]">
                            Create a body session (25 / 50)
                        </div>
                        <div className="text-[12px] text-[#111827]/60 mt-1">
                            Choose duration → pick date & time → confirm.
                        </div>

                        {/* Segmented 25/50 */}
                        <div className="mt-4 flex items-center gap-3">
                            <div className="inline-flex rounded-full border border-[#111827] overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setDraftDuration(25)}
                                    className={`
                    w-[52px] h-[44px]
                    text-[14px] font-semibold
                    transition
                    ${draftDuration === 25 ? "bg-[#111827] text-white" : "bg-white text-[#111827] hover:bg-[#F3F4F6]"}
                  `}
                                >
                                    25
                                </button>
                                <div className="w-px bg-[#111827]" />
                                <button
                                    type="button"
                                    onClick={() => setDraftDuration(50)}
                                    className={`
                    w-[52px] h-[44px]
                    text-[14px] font-semibold
                    transition
                    ${draftDuration === 50 ? "bg-[#111827] text-white" : "bg-white text-[#111827] hover:bg-[#F3F4F6]"}
                  `}
                                >
                                    50
                                </button>
                            </div>

                            {/* Draft controls */}
                            {draftDuration && (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="time"
                                        value={draftTime}
                                        onChange={(e) => setDraftTime(e.target.value)}
                                        step={300}
                                        className="
                      h-[44px]
                      rounded-[14px]
                      border border-[#E6E6E6]
                      px-3
                      text-[13px]
                      outline-none
                      focus:border-[#111827]
                    "
                                        aria-label="Time"
                                    />

                                    <button
                                        type="button"
                                        onClick={confirmDraft}
                                        disabled={creating}
                                        className="
                      h-[44px] w-[44px]
                      rounded-full
                      border border-[#16A34A]
                      bg-white
                      text-[#16A34A]
                      inline-flex items-center justify-center
                      hover:bg-[#16A34A] hover:text-white
                      transition
                      disabled:opacity-50
                    "
                                        title="Confirm"
                                        aria-label="Confirm"
                                    >
                                        <Check size={18} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={cancelDraft}
                                        disabled={creating}
                                        className="
                      h-[44px] w-[44px]
                      rounded-full
                      border border-[#111827]
                      bg-white
                      text-[#111827]
                      inline-flex items-center justify-center
                      hover:bg-[#111827] hover:text-white
                      transition
                      disabled:opacity-50
                    "
                                        title="Cancel"
                                        aria-label="Cancel"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                            )}
                        </div>

                        {err && (
                            <div className="mt-3 text-[12px] text-red-600">
                                {err}
                            </div>
                        )}
                    </div>

                    {/* Date picker */}
                    <div className="shrink-0 flex items-center gap-3">
                        <div className="text-[12px] text-[#111827]/60">Date</div>
                        <input
                            type="date"
                            value={dateValue}
                            onChange={(e) => onDateChange(e.target.value || null)}
                            className="
                h-[44px]
                rounded-[14px]
                border border-[#E6E6E6]
                px-3
                text-[13px]
                outline-none
                focus:border-[#111827]
              "
                            aria-label="Date"
                        />
                    </div>
                </div>

                {/* Body list */}
                <div className="mt-8">
                    {isLoading ? (
                        <div className="text-center py-10">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#111827]" />
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="py-14 text-center text-[14px] text-[#111827]/60">
                            No body sessions for this date.
                        </div>
                    ) : (
                        <div className="space-y-3 sm:space-y-5">
                            {sessions.map((s) => (
                                <BodySessionCard
                                    key={s.id}
                                    s={s}
                                    userId={userId}
                                    onJoin={onJoin}
                                    onBook={onBook}
                                    onCancelBooking={onCancelBooking}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
