import { useEffect, useMemo, useRef, useState } from "react";
import {
    HOST_DURATION_OPTIONS,
    HOST_PERIODS,
    buildHostDayOptions,
    buildHostStartTimes,
    findHostOverlaps,
    formatHostClock,
    formatHostDuration,
    hhmmToMinutes,
    hostWindowFromDraft,
    periodForMinutes,
    toYmd,
    type HostBusyWindow,
    type HostPeriodId,
} from "../lib/hostTimePicker";

type Props = {
    dayYmd: string;
    startHhmm: string;
    durationMinutes: number;
    repeatWeek: boolean;
    /** Hosting windows already in this room's schedule. */
    busy: HostBusyWindow[];
    onDayChange: (ymd: string) => void;
    onStartChange: (hhmm: string) => void;
    onDurationChange: (minutes: number) => void;
    onRepeatWeekChange: (value: boolean) => void;
};

const sectionLabel = "mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8A8F98]";

/**
 * Click-first picker for hosting a 24/7 room: a day strip, part-of-day tabs
 * with half-hour start times, and duration chips. Times other hosts already
 * cover carry a dot, so a free slot is easy to spot.
 */
export default function HostTimePicker({
    dayYmd,
    startHhmm,
    durationMinutes,
    repeatWeek,
    busy,
    onDayChange,
    onStartChange,
    onDurationChange,
    onRepeatWeekChange,
}: Props) {
    // One clock for the whole open picker keeps "Today" and "Now" consistent.
    const [now] = useState(() => new Date());
    const days = useMemo(() => buildHostDayOptions(now), [now]);
    const times = useMemo(() => buildHostStartTimes(dayYmd, now), [dayYmd, now]);
    const startMinutes = hhmmToMinutes(startHhmm);
    const [period, setPeriod] = useState<HostPeriodId>(() => periodForMinutes(startMinutes ?? 9 * 60));
    const selectedDayRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (startMinutes !== null) setPeriod(periodForMinutes(startMinutes));
    }, [startMinutes]);

    useEffect(() => {
        selectedDayRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [dayYmd]);

    const busyDays = useMemo(() => {
        const set = new Set<string>();
        for (const window of busy) {
            for (let ms = window.startMs; ms < window.endMs; ms += 60 * 60_000) set.add(toYmd(new Date(ms)));
        }
        return set;
    }, [busy]);

    const periodTimes = times.filter((option) => option.period === period);
    const hostWindow = hostWindowFromDraft(dayYmd, startHhmm, durationMinutes);
    const overlaps = hostWindow ? findHostOverlaps(hostWindow.startMs, hostWindow.endMs, busy) : [];

    const chooseDay = (ymd: string) => {
        onDayChange(ymd);
        // Keep the chosen time unless it has already passed on that day.
        const options = buildHostStartTimes(ymd, now);
        if (!options.some((option) => option.hhmm === startHhmm) && options.length) {
            const minutes = startMinutes ?? 0;
            const sameOrLater = options.find((option) => option.minutes >= minutes);
            if (sameOrLater) onStartChange(sameOrLater.hhmm);
            else onStartChange(options[0].hhmm);
        }
    };

    const summary = (() => {
        if (!hostWindow) return null;
        const start = new Date(hostWindow.startMs);
        const end = new Date(hostWindow.endMs);
        const day = days.find((option) => option.ymd === dayYmd);
        const dateText = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        const nextDay = toYmd(end) !== dayYmd;
        const lastDay = new Date(start);
        lastDay.setDate(lastDay.getDate() + 6);
        return {
            heading: day && (day.label === "Today" || day.label === "Tomorrow") ? `${day.label}, ${dateText.replace(/^\w+, /, "")}` : dateText,
            range: `${formatHostClock(hostWindow.startMs)} – ${formatHostClock(hostWindow.endMs)}${nextDay ? " (next day)" : ""}`,
            repeatUntil: lastDay.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        };
    })();

    return (
        <div className="space-y-5">
            <section>
                <div className={sectionLabel}>Day</div>
                <div
                    className="-mx-5 flex snap-x scroll-px-5 gap-2 overflow-x-auto px-5 pb-1"
                    style={{ scrollbarWidth: "none" }}
                    role="radiogroup"
                    aria-label="Day"
                >
                    {days.map((day) => {
                        const selected = day.ymd === dayYmd;
                        return (
                            <button
                                key={day.ymd}
                                ref={selected ? selectedDayRef : undefined}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => chooseDay(day.ymd)}
                                className={`relative flex h-[64px] min-w-[60px] shrink-0 snap-start flex-col items-center justify-center rounded-[16px] border px-2 transition ${
                                    selected
                                        ? "border-[#111827] bg-[#111827] text-white shadow-[0_6px_16px_rgba(17,24,39,0.18)]"
                                        : "border-[#E5E7EB] bg-white text-[#111827] hover:border-[#9CA3AF]"
                                }`}
                            >
                                <span className={`text-[11px] font-semibold ${selected ? "text-white/75" : "text-[#6B7280]"}`}>
                                    {day.label}
                                </span>
                                <span className="text-[18px] font-bold leading-6">{day.dayNumber}</span>
                                {day.month ? (
                                    <span className={`text-[10px] leading-3 ${selected ? "text-white/60" : "text-[#9CA3AF]"}`}>{day.month}</span>
                                ) : null}
                                {busyDays.has(day.ymd) ? (
                                    <span
                                        className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${selected ? "bg-[#93B4FA]" : "bg-[#5286F6]"}`}
                                        title="Someone is hosting this day"
                                        aria-hidden="true"
                                    />
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            </section>

            <section>
                <div className={sectionLabel}>Start time</div>
                <div className="grid grid-cols-4 gap-1 rounded-[14px] bg-[#F3F4F6] p-1" role="tablist" aria-label="Part of day">
                    {HOST_PERIODS.map((entry) => {
                        const count = times.filter((option) => option.period === entry.id).length;
                        const active = entry.id === period;
                        return (
                            <button
                                key={entry.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                disabled={count === 0}
                                onClick={() => setPeriod(entry.id)}
                                className={`flex flex-col items-center rounded-[10px] px-1 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                    active ? "bg-white text-[#111827] shadow-sm" : "text-[#4B5563] hover:text-[#111827]"
                                }`}
                            >
                                <span className="text-[12px] font-semibold">{entry.label}</span>
                                <span className="hidden text-[10px] text-[#9CA3AF] sm:block">{entry.range}</span>
                            </button>
                        );
                    })}
                </div>

                <div className="mt-2 grid grid-cols-3 gap-1.5 min-[400px]:grid-cols-4 sm:grid-cols-6" role="radiogroup" aria-label="Start time">
                    {periodTimes.length === 0 ? (
                        <div className="col-span-full rounded-[12px] border border-dashed border-[#E5E7EB] px-3 py-4 text-center text-[12px] text-[#6B7280]">
                            This part of the day has passed. Pick another one or another day.
                        </div>
                    ) : (
                        periodTimes.map((option) => {
                            const selected = option.hhmm === startHhmm;
                            const slot = hostWindowFromDraft(dayYmd, option.hhmm, 30);
                            const taken = slot ? findHostOverlaps(slot.startMs, slot.endMs, busy) : [];
                            return (
                                <button
                                    key={`${option.hhmm}-${option.isNow ? "now" : "slot"}`}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    aria-label={`${option.isNow ? "Now, " : ""}${formatHostClock(option.hhmm)}${taken.length ? `, ${taken.map((entry) => entry.name).join(", ")} hosting` : ""}`}
                                    title={taken.length ? `${taken.map((entry) => entry.name).join(", ")} hosting` : undefined}
                                    onClick={() => onStartChange(option.hhmm)}
                                    className={`relative h-10 rounded-[12px] border text-[13px] font-semibold tabular-nums transition ${
                                        selected
                                            ? "border-[#111827] bg-[#111827] text-white"
                                            : option.isNow
                                                ? "border-[#BFD3FC] bg-[#EEF3FE] text-[#2F5FD0] hover:border-[#5286F6]"
                                                : "border-[#E5E7EB] bg-white text-[#111827] hover:border-[#9CA3AF]"
                                    }`}
                                >
                                    {option.isNow ? "Now" : formatHostClock(option.hhmm)}
                                    {taken.length ? (
                                        <span
                                            className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${selected ? "bg-[#93B4FA]" : "bg-[#5286F6]"}`}
                                            aria-hidden="true"
                                        />
                                    ) : null}
                                </button>
                            );
                        })
                    )}
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8A8F98]">
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#5286F6]" aria-hidden="true" />
                        Someone is already hosting
                    </span>
                    <label className="inline-flex items-center gap-2">
                        Exact time
                        <input
                            type="time"
                            step={300}
                            value={startHhmm}
                            onChange={(event) => event.target.value && onStartChange(event.target.value)}
                            className="h-8 rounded-[10px] border border-[#E5E7EB] bg-white px-2 text-[12px] text-[#111827] outline-none focus:border-[#111827]"
                        />
                    </label>
                </div>
            </section>

            <section>
                <div className={sectionLabel}>How long</div>
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8" role="radiogroup" aria-label="How long">
                    {HOST_DURATION_OPTIONS.map((minutes) => {
                        const selected = minutes === durationMinutes;
                        return (
                            <button
                                key={minutes}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => onDurationChange(minutes)}
                                className={`h-10 rounded-[12px] border text-[13px] font-semibold transition ${
                                    selected
                                        ? "border-[#111827] bg-[#111827] text-white"
                                        : "border-[#E5E7EB] bg-white text-[#111827] hover:border-[#9CA3AF]"
                                }`}
                            >
                                {formatHostDuration(minutes)}
                            </button>
                        );
                    })}
                </div>
            </section>

            <button
                type="button"
                role="switch"
                aria-checked={repeatWeek}
                onClick={() => onRepeatWeekChange(!repeatWeek)}
                className={`flex w-full items-center justify-between gap-3 rounded-[16px] border px-4 py-3 text-left transition ${repeatWeek ? "border-[#5286F6] bg-[#EEF3FE]" : "border-[#E5E7EB] bg-white hover:border-[#A3A3A3]"}`}
            >
                <span>
                    <span className="block text-[13px] font-semibold text-[#111827]">Repeat every day for 7 days</span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-[#7A7A7A]">Same time window, starting on the day above.</span>
                </span>
                <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${repeatWeek ? "bg-[#5286F6]" : "bg-[#D1D5DB]"}`} aria-hidden="true">
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${repeatWeek ? "left-[18px]" : "left-0.5"}`} />
                </span>
            </button>

            {summary ? (
                <div className="flex items-start gap-3 rounded-[18px] border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3" aria-live="polite">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-white text-[#111827] shadow-sm" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <rect x="3.5" y="5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="1.8" />
                            <path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                    </span>
                    <div className="min-w-0 text-[13px] leading-5">
                        <div className="font-semibold text-[#111827]">{summary.heading}</div>
                        <div className="text-[#374151] tabular-nums">
                            {summary.range} <span className="text-[#9CA3AF]">·</span> {formatHostDuration(durationMinutes)}
                        </div>
                        {repeatWeek ? (
                            <div className="text-[#3F6FD8]">Every day until {summary.repeatUntil}</div>
                        ) : null}
                        {overlaps.length ? (
                            <div className="mt-1 text-[12px] text-[#6B7280]">
                                Also hosting then: {overlaps.map((entry) => `${entry.name} (${formatHostClock(entry.startMs)}–${formatHostClock(entry.endMs)})`).join(", ")}
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
