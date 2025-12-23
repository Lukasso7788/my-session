import { useMemo, useState } from "react";

type Props = {
    value: string | null;              // YYYY-MM-DD (local)
    onChange: (v: string | null) => void;
    weeksForward?: number;             // default 3
};

const BRAND = "#2F2F2F";

function startOfWeek(d: Date) {
    const copy = new Date(d);
    const day = copy.getDay(); // 0..6 (Sun..Sat)
    const diff = (day + 6) % 7; // make Monday=0
    copy.setDate(copy.getDate() - diff);
    copy.setHours(0, 0, 0, 0);
    return copy;
}

function addDays(d: Date, days: number) {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + days);
    return copy;
}

function toLocalYMD(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export function SessionsDateFilter({ value, onChange, weeksForward = 3 }: Props) {
    const [weekOffset, setWeekOffset] = useState(0); // 0..weeksForward-1

    const today = useMemo(() => {
        const t = new Date();
        t.setHours(0, 0, 0, 0);
        return t;
    }, []);

    const baseWeekStart = useMemo(() => startOfWeek(today), [today]);

    const maxOffset = Math.max(0, weeksForward - 1);

    const days = useMemo(() => {
        const weekStart = addDays(baseWeekStart, weekOffset * 7);
        return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    }, [baseWeekStart, weekOffset]);

    const monthLabel = useMemo(() => {
        const fmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
        const labelDate = addDays(baseWeekStart, weekOffset * 7);
        return fmt.format(labelDate);
    }, [baseWeekStart, weekOffset]);

    return (
        <div className="w-full">
            <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-[#2E2E2E] font-light">
                    {monthLabel}
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
                        disabled={weekOffset === 0}
                        className={[
                            "px-3 py-1 rounded-full border text-sm transition",
                            weekOffset === 0
                                ? "border-[#DBD8D8] text-slate-300 cursor-not-allowed"
                                : "border-[#DBD8D8] text-[#2F2F2F] hover:bg-black/5",
                        ].join(" ")}
                    >
                        ←
                    </button>

                    <button
                        onClick={() => setWeekOffset((w) => Math.min(maxOffset, w + 1))}
                        disabled={weekOffset === maxOffset}
                        className={[
                            "px-3 py-1 rounded-full border text-sm transition",
                            weekOffset === maxOffset
                                ? "border-[#DBD8D8] text-slate-300 cursor-not-allowed"
                                : "border-[#DBD8D8] text-[#2F2F2F] hover:bg-black/5",
                        ].join(" ")}
                    >
                        →
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                <button
                    onClick={() => onChange(null)}
                    className={[
                        "px-4 py-2 rounded-full border text-sm transition",
                        value === null
                            ? "bg-[#2F2F2F] text-white border-[#2F2F2F]"
                            : "bg-white text-[#2F2F2F] border-[#DBD8D8] hover:bg-black/5",
                    ].join(" ")}
                >
                    All dates
                </button>

                {days.map((d) => {
                    const ymd = toLocalYMD(d);
                    const isSelected = value === ymd;
                    const isToday = ymd === toLocalYMD(today);

                    const weekday = new Intl.Dat
