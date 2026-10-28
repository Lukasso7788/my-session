// Pure helpers for the "Host this room" picker of 24/7 (infinite) rooms
// (see src/components/HostTimePicker.tsx). Everything works in the viewer's
// local time; dates are "YYYY-MM-DD" and times "HH:MM", like <input> values.

export const HOST_PICKER_DAYS = 14;
export const HOST_TIME_STEP_MINUTES = 30;
export const HOST_DURATION_OPTIONS = [30, 60, 90, 120, 180, 240, 360, 480] as const;
export const HOST_DEFAULT_DURATION_MINUTES = 120;

export type HostPeriodId = "night" | "morning" | "afternoon" | "evening";

// Four six-hour parts of the day; each holds 12 half-hour start times.
export const HOST_PERIODS: ReadonlyArray<{ id: HostPeriodId; label: string; range: string; fromHour: number }> = [
    { id: "night", label: "Night", range: "12–6 AM", fromHour: 0 },
    { id: "morning", label: "Morning", range: "6 AM–12", fromHour: 6 },
    { id: "afternoon", label: "Afternoon", range: "12–6 PM", fromHour: 12 },
    { id: "evening", label: "Evening", range: "6 PM–12", fromHour: 18 },
];

export type HostDayOption = {
    ymd: string;
    /** "Today", "Tomorrow" or a short weekday such as "Fri". */
    label: string;
    dayNumber: number;
    /** Short month, shown on the first day and wherever a new month starts. */
    month: string | null;
};

export type HostTimeOption = {
    hhmm: string;
    minutes: number;
    period: HostPeriodId;
    /** The next quarter hour on today's list, shown as "Now". */
    isNow: boolean;
};

export type HostBusyWindow = { startMs: number; endMs: number; name: string };

const pad = (value: number) => String(value).padStart(2, "0");

export function toYmd(date: Date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toHhmm(date: Date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function hhmmToMinutes(hhmm: string) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    if (!match) return null;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

export function periodForMinutes(minutes: number): HostPeriodId {
    if (minutes < 6 * 60) return "night";
    if (minutes < 12 * 60) return "morning";
    if (minutes < 18 * 60) return "afternoon";
    return "evening";
}

/** The next quarter hour from `now` (a time already on the quarter moves on). */
export function nextQuarterHour(now = new Date()) {
    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setMinutes(Math.floor(next.getMinutes() / 15) * 15 + 15);
    return next;
}

export function buildHostDayOptions(now = new Date(), count = HOST_PICKER_DAYS): HostDayOption[] {
    // The first day is the day of the next quarter hour, so 23:50 starts tomorrow.
    const first = nextQuarterHour(now);
    const today = toYmd(now);
    return Array.from({ length: count }, (_, index) => {
        const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
        const ymd = toYmd(day);
        const offset = Math.round(
            (Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) -
                Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
                86_400_000,
        );
        const label = ymd === today ? "Today" : offset === 1 ? "Tomorrow" : day.toLocaleDateString("en-US", { weekday: "short" });
        return {
            ymd,
            label,
            dayNumber: day.getDate(),
            month: index === 0 || day.getDate() === 1 ? day.toLocaleDateString("en-US", { month: "short" }) : null,
        };
    });
}

/**
 * Start times for one day: every half hour, and for today only the times still
 * ahead, led by the next quarter hour as "Now".
 */
export function buildHostStartTimes(dayYmd: string, now = new Date()): HostTimeOption[] {
    const options: HostTimeOption[] = [];
    let fromMinutes = 0;
    if (dayYmd === toYmd(now)) {
        const soon = nextQuarterHour(now);
        if (toYmd(soon) !== dayYmd) return [];
        fromMinutes = soon.getHours() * 60 + soon.getMinutes();
        options.push({ hhmm: toHhmm(soon), minutes: fromMinutes, period: periodForMinutes(fromMinutes), isNow: true });
    }
    for (let minutes = 0; minutes < 24 * 60; minutes += HOST_TIME_STEP_MINUTES) {
        if (minutes <= fromMinutes && options.length) continue;
        const hhmm = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
        options.push({ hhmm, minutes, period: periodForMinutes(minutes), isNow: false });
    }
    return options;
}

/** Start and end of the window, or null for an invalid draft. */
export function hostWindowFromDraft(dayYmd: string, hhmm: string, durationMinutes: number) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayYmd || "")) || hhmmToMinutes(hhmm) === null) return null;
    const start = new Date(`${dayYmd}T${hhmm}:00`);
    const startMs = start.getTime();
    if (!Number.isFinite(startMs) || !(durationMinutes > 0)) return null;
    return { startMs, endMs: startMs + durationMinutes * 60_000 };
}

export function formatHostDuration(minutes: number) {
    if (minutes < 60) return `${minutes} min`;
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

export function formatHostClock(value: number | string) {
    let date: Date;
    if (typeof value === "number") {
        date = new Date(value);
    } else {
        const minutes = hhmmToMinutes(value) ?? 0;
        date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
    }
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Hosts whose windows overlap [startMs, endMs). */
export function findHostOverlaps(startMs: number, endMs: number, busy: HostBusyWindow[]) {
    return busy.filter((window) => window.startMs < endMs && window.endMs > startMs);
}
