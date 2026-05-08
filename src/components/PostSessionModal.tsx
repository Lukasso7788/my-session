import React from "react";

type Props = {
    open: boolean;
    theme: "dark" | "light";
    sessionTitle: string;
    hostName: string;
    minutesSpent: number;

    /**
     * Focus rating from 0 to 100.
     * Older code may still pass 1–5; in that case we gently normalize it to %.
     */
    rating: number;

    feedbackText: string;
    submitting: boolean;

    /**
     * Optional start time for the next/booked session shown in the post-session flow.
     * Pass an ISO string/date-like value from the parent when the user books a next session.
     */
    bookedSessionTitle?: string;
    bookedSessionStartTime?: string | null;

    /**
     * Backwards-friendly aliases if the parent already uses "next session" naming.
     */
    nextSessionTitle?: string;
    nextSessionStartTime?: string | null;

    onClose: () => void;
    onRatingChange: (value: number) => void;
    onFeedbackChange: (value: string) => void;
    onSubmitFeedback: () => void;
};

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

function normalizeFocusRating(raw: number) {
    const n = Number(raw);

    if (!Number.isFinite(n)) return 0;

    // Backwards compatibility:
    // if old parent state still sends 1–5 stars, display it as 20–100%.
    if (n > 0 && n <= 5) return clamp(Math.round((n / 5) * 100), 0, 100);

    return clamp(Math.round(n), 0, 100);
}

function formatSessionStartDateTime(raw: string | null | undefined) {
    const value = String(raw || "").trim();

    if (!value) return "";

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) return value;

    try {
        return new Intl.DateTimeFormat(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        }).format(date);
    } catch {
        return date.toLocaleString();
    }
}

export default function PostSessionModal({
    open,
    theme,
    sessionTitle,
    hostName,
    minutesSpent,
    rating,
    feedbackText,
    submitting,
    bookedSessionTitle,
    bookedSessionStartTime,
    nextSessionTitle,
    nextSessionStartTime,
    onClose,
    onRatingChange,
    onFeedbackChange,
    onSubmitFeedback,
}: Props) {
    if (!open) return null;

    const isLight = theme === "light";

    const focusRating = normalizeFocusRating(rating);
    const bookedTitle = String(bookedSessionTitle || nextSessionTitle || "").trim();
    const bookedStart = bookedSessionStartTime || nextSessionStartTime || "";
    const bookedStartLabel = formatSessionStartDateTime(bookedStart);

    const focusTone =
        focusRating >= 80
            ? "Great focus"
            : focusRating >= 55
                ? "Solid focus"
                : focusRating >= 25
                    ? "Some focus"
                    : "Low focus";

    return (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 px-4">
            <div
                className={[
                    "w-full max-w-[560px] rounded-[28px] border p-6 shadow-2xl",
                    isLight
                        ? "border-black/10 bg-white text-black"
                        : "border-white/10 bg-[#0F172A] text-white",
                ].join(" ")}
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="text-[24px] font-semibold leading-tight">
                            Session complete
                        </div>
                        <div
                            className={[
                                "mt-2 text-[14px]",
                                isLight ? "text-black/65" : "text-white/70",
                            ].join(" ")}
                        >
                            {sessionTitle || "Session"}
                        </div>
                        <div
                            className={[
                                "mt-1 text-[14px]",
                                isLight ? "text-black/65" : "text-white/70",
                            ].join(" ")}
                        >
                            Hosted by <span className="font-semibold">{hostName || "Host"}</span>
                        </div>
                        <div
                            className={[
                                "mt-1 text-[14px]",
                                isLight ? "text-black/65" : "text-white/70",
                            ].join(" ")}
                        >
                            You spent <span className="font-semibold">{minutesSpent}</span> min in session
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className={[
                            "h-10 w-10 rounded-full border text-[18px] transition",
                            isLight
                                ? "border-black/10 bg-black/5 hover:bg-black/10"
                                : "border-white/10 bg-white/5 hover:bg-white/10",
                        ].join(" ")}
                        type="button"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                {(bookedTitle || bookedStartLabel) && (
                    <div
                        className={[
                            "mt-5 rounded-[20px] border px-4 py-3",
                            isLight
                                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                                : "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
                        ].join(" ")}
                    >
                        <div className="text-[13px] font-semibold">
                            Next session booked
                        </div>

                        {bookedTitle && (
                            <div className="mt-1 text-[14px] font-semibold">
                                {bookedTitle}
                            </div>
                        )}

                        {bookedStartLabel && (
                            <div
                                className={[
                                    "mt-1 text-[13px]",
                                    isLight ? "text-emerald-900/75" : "text-emerald-100/75",
                                ].join(" ")}
                            >
                                Starts: <span className="font-semibold">{bookedStartLabel}</span>
                            </div>
                        )}
                    </div>
                )}

                <div className="mt-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="text-[15px] font-semibold">
                                Rate your focus in this session
                            </div>
                            <div
                                className={[
                                    "mt-1 text-[13px]",
                                    isLight ? "text-black/55" : "text-white/55",
                                ].join(" ")}
                            >
                                Not the host, not the room — just your own focus.
                            </div>
                        </div>

                        <div
                            className={[
                                "rounded-full px-3 py-1 text-[13px] font-bold",
                                isLight
                                    ? "bg-black text-white"
                                    : "bg-white text-black",
                            ].join(" ")}
                        >
                            {focusRating}%
                        </div>
                    </div>

                    <div className="mt-4">
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={focusRating}
                            onChange={(e) => onRatingChange(clamp(Number(e.target.value), 0, 100))}
                            className="w-full accent-blue-600"
                            aria-label="Rate your focus from 0 to 100 percent"
                        />

                        <div
                            className={[
                                "mt-2 flex items-center justify-between text-[12px]",
                                isLight ? "text-black/45" : "text-white/45",
                            ].join(" ")}
                        >
                            <span>0%</span>
                            <span className="font-semibold">{focusTone}</span>
                            <span>100%</span>
                        </div>
                    </div>

                    <div className="mt-3 grid grid-cols-5 gap-2">
                        {[20, 40, 60, 80, 100].map((value) => {
                            const active = focusRating === value;

                            return (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => onRatingChange(value)}
                                    className={[
                                        "h-9 rounded-full border text-[12px] font-semibold transition",
                                        active
                                            ? isLight
                                                ? "border-blue-600 bg-blue-600 text-white"
                                                : "border-blue-400 bg-blue-400 text-black"
                                            : isLight
                                                ? "border-black/10 bg-black/5 text-black/70 hover:bg-black/10"
                                                : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10",
                                    ].join(" ")}
                                >
                                    {value}%
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="mt-6">
                    <div className="text-[15px] font-semibold">Quick feedback</div>
                    <textarea
                        value={feedbackText}
                        onChange={(e) => onFeedbackChange(e.target.value)}
                        placeholder="How was your focus? Anything that helped or distracted you?"
                        className={[
                            "mt-3 min-h-[110px] w-full rounded-[18px] border px-4 py-3 text-[14px] outline-none transition",
                            isLight
                                ? "border-black/10 bg-black/5 text-black placeholder:text-black/40"
                                : "border-white/10 bg-white/5 text-white placeholder:text-white/35",
                        ].join(" ")}
                    />
                </div>

                <div className="mt-7 flex flex-wrap items-center justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className={[
                            "h-11 rounded-full px-5 text-[14px] font-semibold transition",
                            isLight
                                ? "bg-black/5 text-black/75 hover:bg-black/10"
                                : "bg-white/5 text-white/85 hover:bg-white/10",
                        ].join(" ")}
                    >
                        Close
                    </button>

                    <button
                        type="button"
                        onClick={onSubmitFeedback}
                        disabled={submitting}
                        className={[
                            "h-11 rounded-full px-5 text-[14px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
                            isLight
                                ? "bg-blue-600 text-white hover:bg-blue-700"
                                : "bg-blue-500 text-white hover:bg-blue-600",
                        ].join(" ")}
                    >
                        {submitting ? "Submitting..." : "Submit feedback"}
                    </button>
                </div>
            </div>
        </div>
    );
}
