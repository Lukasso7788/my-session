import React from "react";

export type JoinGateModalProps = {
    open: boolean;
    theme: "light" | "dark";
    sessionTitle: string;
    joinEarlyWindowMinutes: number;
    startMs: number;
    allowMs: number;
    msUntilAllowed: number;

    onBack: () => void;
    onReload: () => void;

    bookingCtaLabel?: string;
    bookingBusy?: boolean;
    bookingDone?: boolean;
    onBook?: () => void;
};

function formatLocalDateTime(ms: number) {
    try {
        return new Intl.DateTimeFormat(undefined, {
            weekday: "short",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(ms));
    } catch {
        return new Date(ms).toLocaleString();
    }
}

function formatCountdown(msUntil: number) {
    const ms = Math.max(0, Number(msUntil) || 0);
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const s = totalSec % 60;
    const totalMin = Math.floor(totalSec / 60);
    const m = totalMin % 60;
    const h = Math.floor(totalMin / 60);

    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

export default function JoinGateModal({
    open,
    theme,
    sessionTitle,
    joinEarlyWindowMinutes,
    startMs,
    allowMs,
    msUntilAllowed,
    onBack,
    onReload,
    bookingCtaLabel = "Book this session",
    bookingBusy = false,
    bookingDone = false,
    onBook,
}: JoinGateModalProps) {
    if (!open) return null;

    const isLight = theme === "light";

    return (
        <div className={`h-[100dvh] w-full flex items-center justify-center ${isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white"}`}>
            <div
                className={[
                    "w-[92%] max-w-[560px] rounded-2xl border shadow-2xl p-6",
                    isLight
                        ? "bg-white/90 border-black/10 text-black/85"
                        : "bg-[#020617]/70 border-white/10 text-white/90",
                ].join(" ")}
            >
                <div className="text-[22px] font-extrabold tracking-tight">MySession</div>

                <div className={`mt-1 text-[14px] font-semibold ${isLight ? "text-black/70" : "text-white/75"}`}>
                    {sessionTitle}
                </div>

                <div className="mt-5 text-[14px] leading-relaxed">
                    <div className="font-semibold">You can’t join this session yet.</div>
                    <div className={`mt-1 ${isLight ? "text-black/65" : "text-white/70"}`}>
                        You’ll be able to join <b>{joinEarlyWindowMinutes} minutes</b> before the start.
                    </div>
                </div>

                <div className={`mt-5 rounded-xl border p-4 ${isLight ? "border-black/10 bg-black/5" : "border-white/10 bg-white/5"}`}>
                    <div className="flex items-center justify-between gap-3">
                        <div className={`${isLight ? "text-black/60" : "text-white/65"} text-[12px]`}>Starts at</div>
                        <div className="text-[13px] font-semibold">{formatLocalDateTime(startMs)}</div>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-3">
                        <div className={`${isLight ? "text-black/60" : "text-white/65"} text-[12px]`}>Join opens</div>
                        <div className="text-[13px] font-semibold">{formatLocalDateTime(allowMs)}</div>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-3">
                        <div className={`${isLight ? "text-black/60" : "text-white/65"} text-[12px]`}>Available in</div>
                        <div className="text-[13px] font-semibold">{formatCountdown(msUntilAllowed)}</div>
                    </div>
                </div>

                {onBook ? (
                    <div className="mt-5">
                        <div className={`mb-2 text-[13px] ${isLight ? "text-black/65" : "text-white/70"}`}>
                            Do you want to join this session later?
                        </div>

                        <button
                            type="button"
                            onClick={onBook}
                            disabled={bookingBusy || bookingDone}
                            className={[
                                "w-full h-11 px-4 rounded-xl font-semibold transition",
                                bookingDone
                                    ? isLight
                                        ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                                        : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                    : isLight
                                        ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                        : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]",
                            ].join(" ")}
                        >
                            {bookingDone ? "Booked ✅" : bookingBusy ? "Booking..." : bookingCtaLabel}
                        </button>
                    </div>
                ) : null}

                <div className="mt-6 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onBack}
                        className={[
                            "h-11 px-4 rounded-xl font-semibold border transition",
                            isLight
                                ? "bg-black/5 border-black/10 hover:bg-black/10 text-black/75"
                                : "bg-white/5 border-white/10 hover:bg-white/10 text-white/85",
                        ].join(" ")}
                    >
                        Back to sessions
                    </button>

                    <button
                        type="button"
                        onClick={onReload}
                        className={[
                            "h-11 px-4 rounded-xl font-semibold transition",
                            isLight
                                ? "bg-blue-600 hover:bg-blue-700 text-white"
                                : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]",
                        ].join(" ")}
                    >
                        Reload
                    </button>
                </div>
            </div>
        </div>
    );
}