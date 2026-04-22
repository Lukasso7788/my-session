import React from "react";

type Props = {
    open: boolean;
    theme: "dark" | "light";
    sessionTitle: string;
    hostName: string;
    minutesSpent: number;
    rating: number;
    feedbackText: string;
    submitting: boolean;
    onClose: () => void;
    onRatingChange: (value: number) => void;
    onFeedbackChange: (value: string) => void;
    onSubmitFeedback: () => void;
};

export default function PostSessionModal({
    open,
    theme,
    sessionTitle,
    hostName,
    minutesSpent,
    rating,
    feedbackText,
    submitting,
    onClose,
    onRatingChange,
    onFeedbackChange,
    onSubmitFeedback,
}: Props) {
    if (!open) return null;

    const isLight = theme === "light";

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

                <div className="mt-6">
                    <div className="text-[15px] font-semibold">Rate this session</div>
                    <div className="mt-3 flex items-center gap-2">
                        {[1, 2, 3, 4, 5].map((n) => {
                            const active = n <= rating;
                            return (
                                <button
                                    key={n}
                                    type="button"
                                    onClick={() => onRatingChange(n)}
                                    className={[
                                        "h-11 w-11 rounded-full border text-[18px] font-semibold transition",
                                        active
                                            ? "border-yellow-400 bg-yellow-400 text-black"
                                            : isLight
                                                ? "border-black/10 bg-black/5 text-black/70 hover:bg-black/10"
                                                : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10",
                                    ].join(" ")}
                                >
                                    ★
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
                        placeholder="How was it? Anything confusing or especially good?"
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
                        disabled={submitting || rating < 1}
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