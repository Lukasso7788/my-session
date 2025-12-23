import { useMemo, useState } from "react";

type Props = {
    /**
     * Selected date in "YYYY-MM-DD" (local date), or null = all dates
     */
    value: string | null;
    onChange: (next: string | null) => void;

    /**
     * How many weeks вперед можно листать (default 3)
     */
    weeksAhead?: number;
};

function startOfDayLocal(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function toYmdLocal(d: Date) {
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

export function SessionsDateFilter({ value, onChange, weeksAhead = 3 }: Props) {
    const [page, setPage] = useState(0); // 0..weeksAhead-1

    const today = useMemo(() => startOfDayLocal(new Date()), []);
    const maxPage = Math.max(0, weeksAhead - 1);

    const days = useMemo(() => {
        const start = new Date(today);
        start.setDate(start.getDate() + page * 7);

        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(start);
            d.setDate(start.getDate() + i);

            const ymd = toYmdLocal(d);
            const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d);
            const dayNum = new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(d);
            const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(d);

            return { date: d, ymd, weekday, dayNum, month };
        });
    }, [today, page]);

    const canPrev = page > 0;
    const canNext = page < maxPage;

    return (
        <div className="w-full">
            <div
                className="
          border border-[#DBD8D8] rounded-[24px]
          px-4 py-3
          flex items-center justify-between gap-3
        "
            >
                {/* Left controls */}
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => canPrev && setPage((p) => p - 1)}
                        disabled={!canPrev}
                        className="
              w-9 h-9 rounded-full border border-[#DBD8D8]
              flex items-center justify-center
              hover:bg-black/5 transition
              disabled:opacity-40 disabled:cursor-not-allowed
            "
                        aria-label="Previous week"
                        title="Previous week"
                    >
                        ‹
                    </button>

                    <button
                        type="button"
                        onClick={() => canNext && setPage((p) => p + 1)}
                        disabled={!canNext}
                        className="
              w-9 h-9 rounded-full border border-[#DBD8D8]
              flex items-center justify-center
              hover:bg-black/5 transition
              disabled:opacity-40 disabled:cursor-not-allowed
            "
                        aria-label="Next week"
                        title="Next week"
                    >
                        ›
                    </button>
                </div>

                {/* Days */}
                <div className="flex-1 overflow-x-auto">
                    <div className="min-w-max flex items-center gap-2 justify-center">
                        {/* All */}
                        <button
                            type="button"
                            onClick={() => onChange(null)}
                            className={[
                                "px-4 py-2 rounded-full border text-sm transition whitespace-nowrap",
                                value === null
                                    ? "bg-[#2F2F2F] text-white border-[#2F2F2F]"
                                    : "bg-white text-[#2F2F2F] border-[#DBD8D8] hover:bg-black/5",
                            ].join(" ")}
                        >
                            All
                        </button>

                        {days.map((d) => {
                            const isSelected = value === d.ymd;

                            return (
                                <button
                                    key={d.ymd}
                                    type="button"
                                    onClick={() => onChange(d.ymd)}
                                    className={[
                                        "px-4 py-2 rounded-full border text-sm transition whitespace-nowrap",
                                        isSelected
                                            ? "bg-[#2F2F2F] text-white border-[#2F2F2F]"
                                            : "bg-white text-[#2F2F2F] border-[#DBD8D8] hover:bg-black/5",
                                    ].join(" ")}
                                    title={d.ymd}
                                >
                                    <span className="mr-2 opacity-70">{d.weekday}</span>
                                    <span className="font-medium">
                                        {d.dayNum} {d.month}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Right hint */}
                <div className="hidden md:block text-xs text-[#2E2E2E] opacity-70 whitespace-nowrap">
                    Up to {weeksAhead} weeks ahead
                </div>
            </div>
        </div>
    );
}

export default SessionsDateFilter;
