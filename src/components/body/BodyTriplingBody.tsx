// src/components/body/BodyTriplingBody.tsx
import { useEffect, useMemo } from "react";
import BodyTriplingSessionCard from "./BodyTriplingSessionCard";

function ymdTodayLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function addDaysYMD(ymd: string, deltaDays: number) {
    const d = new Date(`${ymd}T00:00:00`);
    d.setDate(d.getDate() + deltaDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function formatDatePill(ymd: string) {
    const d = new Date(`${ymd}T00:00:00`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function FilterIcon({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M4 5h16l-6.5 7.5V19l-3 1v-7.5L4 5Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function ChevronLeft({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

function ChevronRight({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

export default function BodyTriplingBody(props: {
    sessions: any[];
    isLoading: boolean;
    dateFilter: string | null;
    onDateChange: (v: string | null) => void;

    onCreateSession?: () => void;

    userId?: string;
    onBook: (sessionId: string) => void;
    onCancelBooking: (sessionId: string) => void;
}) {
    const {
        sessions,
        isLoading,
        dateFilter,
        onDateChange,
        onCreateSession,
        userId,
        onBook,
        onCancelBooking,
    } = props;

    // make the UI always show a date like on the screenshot
    useEffect(() => {
        if (!dateFilter) onDateChange(ymdTodayLocal());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const effectiveYMD = dateFilter || ymdTodayLocal();

    const dateLabel = useMemo(() => formatDatePill(effectiveYMD), [effectiveYMD]);

    return (
        <div className="w-full">
            {/* Filter bar (like on screenshot) */}
            <div className="w-full flex items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-2">
                    <div className="rounded-full border border-[#E5E7EB] bg-white px-3 py-2 flex items-center gap-2">
                        <button
                            type="button"
                            className="flex items-center gap-2 text-[13px] font-semibold text-[#111827] hover:opacity-80 transition"
                            onClick={() => {
                                // placeholder for future
                                // you can open a filter modal here
                            }}
                        >
                            <FilterIcon />
                            <span>Filter</span>
                        </button>

                        <div className="w-px h-5 bg-[#E5E7EB]" />

                        <button
                            type="button"
                            className="h-8 w-8 rounded-full hover:bg-[#F3F4F6] flex items-center justify-center transition"
                            onClick={() => onDateChange(addDaysYMD(effectiveYMD, -1))}
                            aria-label="Previous day"
                            title="Previous day"
                        >
                            <ChevronLeft />
                        </button>

                        <div className="text-[13px] font-semibold text-[#111827] px-1">
                            {dateLabel}
                        </div>

                        <button
                            type="button"
                            className="h-8 w-8 rounded-full hover:bg-[#F3F4F6] flex items-center justify-center transition"
                            onClick={() => onDateChange(addDaysYMD(effectiveYMD, +1))}
                            aria-label="Next day"
                            title="Next day"
                        >
                            <ChevronRight />
                        </button>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={onCreateSession}
                    className="
            h-11 px-5 rounded-full
            border border-[#111827]
            bg-[#111827] text-white
            hover:opacity-90 transition
            text-[13px] font-semibold
            flex items-center gap-2
            shrink-0
          "
                >
                    <span className="text-[16px] leading-none">+</span>
                    <span>Create session</span>
                </button>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="text-center py-10">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#111827]" />
                </div>
            ) : sessions.length === 0 ? (
                <div className="text-center py-10">
                    <div className="text-[13px] text-[#606060]">No buddy tripling sessions for this date.</div>
                    {onCreateSession && (
                        <button
                            className="mt-3 text-[13px] font-semibold underline underline-offset-4"
                            onClick={onCreateSession}
                        >
                            Create the first session
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {sessions.map((s) => (
                        <BodyTriplingSessionCard
                            key={s.id}
                            session={s}
                            userId={userId}
                            onBook={onBook}
                            onCancelBooking={onCancelBooking}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
