// src/components/body/BodyTriplingBody.tsx
import { useMemo, useState } from "react";
import {
    ChevronLeft,
    ChevronRight,
    Calendar,
    Check,
    X,
    Timer,
    Flame,
} from "lucide-react";
import BodyTriplingSessionCard from "./BodyTriplingSessionCard";

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

function addDays(ymd: string, delta: number) {
    const d = new Date(`${ymd}T00:00:00`);
    d.setDate(d.getDate() + delta);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function formatDMY(ymd: string) {
    const [y, m, d] = ymd.split("-");
    return `${d}.${m}.${y}`;
}

function nextQuarterTimeHHMM() {
    const d = new Date();
    const mins = d.getMinutes();
    const add = (15 - (mins % 15)) % 15;
    d.setMinutes(mins + add);
    d.setSeconds(0);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

export default function BodyTriplingBody(props: {
    sessions: BodySession[];
    isLoading: boolean;

    dateFilter: string;
    onDateChange: (ymd: string | null) => void;

    userId?: string;

    onJoin: (id: string) => void;
    onBook: (id: string) => Promise<void>;
    onCancelBooking: (id: string) => Promise<void>;

    onCreateBodySession: (payload: {
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

    // create flow
    const [selectedDuration, setSelectedDuration] = useState<25 | 50 | null>(null);
    const [createDate, setCreateDate] = useState<string>(dateFilter);
    const [createTime, setCreateTime] = useState<string>(nextQuarterTimeHHMM());
    const [creating, setCreating] = useState(false);

    // keep createDate synced when dateFilter changes (only if user hasn't started creating)
    useMemo(() => {
        if (!selectedDuration) setCreateDate(dateFilter);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateFilter]);

    const canConfirm = !!selectedDuration && !!createDate && !!createTime && !creating;

    const filledCount = (s: BodySession) => {
        const max = s.max_participants ?? 3;
        const bookings = s.session_bookings?.length || 0;
        return { max, filled: Math.min(max, bookings + 1) }; // host included
    };

    const sortedSessions = useMemo(() => {
        const arr = [...(sessions || [])];
        arr.sort((a, b) => {
            const ta = a.start_time ? new Date(a.start_time).getTime() : 0;
            const tb = b.start_time ? new Date(b.start_time).getTime() : 0;
            return ta - tb;
        });
        return arr;
    }, [sessions]);

    const handleConfirm = async () => {
        if (!canConfirm || !selectedDuration) return;

        try {
            setCreating(true);

            // show the created session immediately (filter to that date)
            onDateChange(createDate);

            await onCreateBodySession({
                duration: selectedDuration,
                dateYMD: createDate,
                timeHHMM: createTime,
            });

            // reset
            setSelectedDuration(null);
            setCreateTime(nextQuarterTimeHHMM());
        } finally {
            setCreating(false);
        }
    };

    const handleCancel = () => {
        setSelectedDuration(null);
        setCreateDate(dateFilter);
        setCreateTime(nextQuarterTimeHHMM());
    };

    return (
        <div className="w-full">
            {/* Big panel (как у тебя на скрине где было Coming Soon) */}
            <div className="rounded-[24px] border border-[#DBD8D8] bg-white px-5 py-5 sm:px-8 sm:py-7">
                {/* Top row: left create, right date pill */}
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="font-inter font-semibold text-[15px] text-[#111827]">
                            Create a body session (25 / 50)
                        </div>
                        <div className="text-[12px] text-[#111827]/60 mt-1">
                            Click 25 or 50 → choose date & time → confirm.
                        </div>

                        {/* Combined 25/50 segmented control */}
                        <div className="mt-4 inline-flex rounded-full border border-[#111827] overflow-hidden">
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedDuration(25);
                                    setCreateDate(dateFilter);
                                }}
                                className={`
                  px-5 py-2.5 text-[13px] font-semibold
                  flex items-center gap-2
                  ${selectedDuration === 25 ? "bg-[#111827] text-white" : "bg-white text-[#111827]"}
                `}
                            >
                                <Timer className="w-4 h-4" />
                                25
                            </button>

                            <div className="w-[1px] bg-[#111827]" />

                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedDuration(50);
                                    setCreateDate(dateFilter);
                                }}
                                className={`
                  px-5 py-2.5 text-[13px] font-semibold
                  flex items-center gap-2
                  ${selectedDuration === 50 ? "bg-[#111827] text-white" : "bg-white text-[#111827]"}
                `}
                            >
                                <Flame className="w-4 h-4" />
                                50
                            </button>
                        </div>

                        {/* Date/time + confirm/cancel appear after choosing duration */}
                        {selectedDuration && (
                            <div className="mt-4 flex items-center gap-3 flex-wrap">
                                <label className="text-[12px] text-[#111827]/70 flex items-center gap-2">
                                    <Calendar className="w-4 h-4" />
                                    <input
                                        type="date"
                                        value={createDate}
                                        onChange={(e) => setCreateDate(e.target.value)}
                                        className="
                      border border-[#DBD8D8] rounded-[10px]
                      px-3 py-2 text-[13px]
                      focus:outline-none
                    "
                                    />
                                </label>

                                <label className="text-[12px] text-[#111827]/70 flex items-center gap-2">
                                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-[#DBD8D8]" />
                                    <input
                                        type="time"
                                        value={createTime}
                                        onChange={(e) => setCreateTime(e.target.value)}
                                        className="
                      border border-[#DBD8D8] rounded-[10px]
                      px-3 py-2 text-[13px]
                      focus:outline-none
                    "
                                    />
                                </label>

                                <button
                                    type="button"
                                    onClick={handleConfirm}
                                    disabled={!canConfirm}
                                    className={`
                    inline-flex items-center justify-center
                    h-10 w-10 rounded-full border
                    ${canConfirm ? "border-[#16A34A] text-[#16A34A] hover:bg-[#16A34A] hover:text-white" : "border-[#DBD8D8] text-[#A3A3A3]"}
                    transition
                  `}
                                    title="Confirm"
                                    aria-label="Confirm"
                                >
                                    <Check className="w-5 h-5" />
                                </button>

                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    disabled={creating}
                                    className="
                    inline-flex items-center justify-center
                    h-10 w-10 rounded-full border border-[#111827]
                    text-[#111827]
                    hover:bg-[#111827] hover:text-white
                    transition
                    disabled:opacity-50
                  "
                                    title="Cancel"
                                    aria-label="Cancel"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Date navigation pill (как на рефе) */}
                    <div className="shrink-0 flex items-center gap-2">
                        <div className="text-[12px] text-[#111827]/60">Date</div>

                        <div className="inline-flex items-center rounded-[16px] border border-[#DBD8D8] bg-white px-2 py-1.5">
                            <button
                                type="button"
                                onClick={() => onDateChange(addDays(dateFilter, -1))}
                                className="h-8 w-8 rounded-[12px] hover:bg-[#F3F4F6] inline-flex items-center justify-center"
                                aria-label="Previous day"
                                title="Previous day"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>

                            <div className="px-2 text-[13px] font-semibold text-[#111827] min-w-[110px] text-center">
                                {formatDMY(dateFilter)}
                            </div>

                            <button
                                type="button"
                                onClick={() => onDateChange(addDays(dateFilter, 1))}
                                className="h-8 w-8 rounded-[12px] hover:bg-[#F3F4F6] inline-flex items-center justify-center"
                                aria-label="Next day"
                                title="Next day"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Divider */}
                <div className="mt-6 border-t border-[#ECECEC]" />

                {/* Body content: sessions instead of Coming Soon */}
                <div className="mt-6">
                    {isLoading ? (
                        <div className="text-center py-16">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brandBlack" />
                        </div>
                    ) : sortedSessions.length === 0 ? (
                        <div className="text-center py-16">
                            <div className="text-[14px] text-[#111827]/70">
                                No sessions for this date yet.
                            </div>
                            <div className="text-[12px] text-[#111827]/50 mt-2">
                                Create a 25 or 50 minute session above.
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {sortedSessions.map((s) => (
                                <BodyTriplingSessionCard
                                    key={s.id}
                                    session={s as any}
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
