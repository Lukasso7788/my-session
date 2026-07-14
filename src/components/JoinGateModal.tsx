import React from "react";
import {
    ArrowLeft,
    ArrowRight,
    CalendarClock,
    Check,
    Clock3,
    RefreshCw,
    Users,
} from "lucide-react";

export type JoinGateHostSession = {
    id: string;
    title: string;
    startMs: number;
    bookedCount: number;
    maxParticipants: number;
};

export type JoinGateModalProps = {
    open: boolean;
    theme: "light" | "dark";
    sessionTitle: string;
    joinEarlyWindowMinutes: number;
    startMs: number;
    allowMs: number;
    msUntilAllowed: number;
    hostName?: string;
    hostAvatarUrl?: string | null;
    bookedCount?: number;
    maxParticipants?: number;
    otherHostSessions?: JoinGateHostSession[];
    otherHostSessionsLoading?: boolean;

    onBack: () => void;
    onReload: () => void;
    onOpenOtherSession?: (sessionId: string) => void;

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
            day: "numeric",
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

function HostAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
    const initials = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "M";

    if (avatarUrl) {
        return <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />;
    }

    return (
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#81DB86] text-[12px] font-bold text-black">
            {initials}
        </div>
    );
}

export default function JoinGateModal({
    open,
    theme,
    sessionTitle,
    joinEarlyWindowMinutes,
    startMs,
    allowMs,
    msUntilAllowed,
    hostName = "Session host",
    hostAvatarUrl,
    bookedCount = 0,
    maxParticipants = 16,
    otherHostSessions = [],
    otherHostSessionsLoading = false,
    onBack,
    onReload,
    onOpenOtherSession,
    bookingCtaLabel = "Book this session",
    bookingBusy = false,
    bookingDone = false,
    onBook,
}: JoinGateModalProps) {
    if (!open) return null;

    const isLight = theme === "light";
    const safeCapacity = Math.max(1, Number(maxParticipants) || 16);
    const safeBooked = Math.max(0, Number(bookedCount) || 0);
    const occupancyPct = Math.min(100, Math.round((safeBooked / safeCapacity) * 100));
    const panel = isLight
        ? "border-[#D8D0D0] bg-white text-[#1B1B1B]"
        : "border-[#2B2B2B] bg-[#242424] text-white";
    const inset = isLight
        ? "border-[#D8D0D0] bg-[#F3F1F1]"
        : "border-[#343434] bg-[#1B1B1B]";
    const muted = isLight ? "text-black/55" : "text-white/55";
    const secondaryButton = isLight
        ? "border-[#D8D0D0] bg-[#F3F1F1] text-black/75 hover:bg-[#E7E7E7]"
        : "border-[#343434] bg-[#2B2B2B] text-white/80 hover:bg-[#343434]";

    return (
        <div
            className={`min-h-[100dvh] w-full overflow-y-auto px-4 py-6 sm:px-6 sm:py-10 ${
                isLight ? "bg-[#F3F1F1] text-[#1B1B1B]" : "bg-[#1B1B1B] text-white"
            }`}
        >
            <div className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-[1040px] items-center">
                <div className={`w-full overflow-hidden rounded-[28px] border shadow-2xl ${panel}`}>
                    <div className={`flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-7 ${isLight ? "border-[#D8D0D0]" : "border-[#343434]"}`}>
                        <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#81DB86] text-[17px] font-black text-black">
                                M
                            </div>
                            <div>
                                <div className="text-[15px] font-bold tracking-[-0.02em]">MySession</div>
                                <div className={`text-[11px] ${muted}`}>
                                    {bookingDone ? "Your place is booked and waiting" : "The room opens before the session starts"}
                                </div>
                            </div>
                        </div>

                        <div className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold sm:flex ${inset}`}>
                            <span className="h-2 w-2 animate-pulse rounded-full bg-[#81DB86]" />
                            Join window opens soon
                        </div>
                    </div>

                    <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
                        <main className={`p-5 sm:p-7 lg:border-r ${isLight ? "lg:border-[#D8D0D0]" : "lg:border-[#343434]"}`}>
                            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${inset}`}>
                                <Clock3 size={13} />
                                Available in {formatCountdown(msUntilAllowed)}
                            </div>

                            <h1 className="mt-5 max-w-[650px] text-[28px] font-bold leading-[1.12] tracking-[-0.035em] sm:text-[36px]">
                                You’re early — the room will open shortly.
                            </h1>
                            <p className={`mt-3 max-w-[620px] text-[14px] leading-6 ${muted}`}>
                                You can enter {joinEarlyWindowMinutes} minutes before the session starts. Your booking and place in the session stay saved while you wait.
                            </p>

                            <div className={`mt-6 rounded-[22px] border p-4 sm:p-5 ${inset}`}>
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className={`text-[11px] font-bold uppercase tracking-[0.1em] ${muted}`}>Upcoming session</div>
                                        <div className="mt-1 truncate text-[18px] font-bold">{sessionTitle}</div>
                                        <div className="mt-3 flex items-center gap-2">
                                            <HostAvatar name={hostName} avatarUrl={hostAvatarUrl} />
                                            <div>
                                                <div className={`text-[10px] ${muted}`}>Hosted by</div>
                                                <div className="text-[12px] font-semibold">{hostName}</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className={`hidden rounded-2xl bg-[#81DB86]/15 p-3 sm:block ${isLight ? "text-[#36733B]" : "text-[#A9EDAD]"}`}>
                                        <CalendarClock size={22} />
                                    </div>
                                </div>

                                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                    <div className={`rounded-2xl border p-3.5 ${panel}`}>
                                        <div className={`text-[11px] ${muted}`}>Starts at</div>
                                        <div className="mt-1 text-[13px] font-semibold">{formatLocalDateTime(startMs)}</div>
                                    </div>
                                    <div className={`rounded-2xl border p-3.5 ${panel}`}>
                                        <div className={`text-[11px] ${muted}`}>Join opens</div>
                                        <div className="mt-1 text-[13px] font-semibold">{formatLocalDateTime(allowMs)}</div>
                                    </div>
                                </div>

                                <div className="mt-4">
                                    <div className="flex items-center justify-between gap-3 text-[12px]">
                                        <div className="flex items-center gap-2 font-semibold">
                                            <Users size={15} />
                                            {safeBooked} {safeBooked === 1 ? "person" : "people"} booked
                                        </div>
                                        <div className={muted}>{safeBooked} / {safeCapacity}</div>
                                    </div>
                                    <div className={`mt-2 h-2 overflow-hidden rounded-full ${isLight ? "bg-black/10" : "bg-white/10"}`}>
                                        <div
                                            className="h-full rounded-full bg-[#81DB86] transition-[width] duration-500"
                                            style={{ width: `${occupancyPct}%` }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {onBook ? (
                                <button
                                    type="button"
                                    onClick={onBook}
                                    disabled={bookingBusy || bookingDone}
                                    className={`mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-[14px] font-bold transition disabled:cursor-default ${
                                        bookingDone
                                            ? "border border-[#81DB86]/50 bg-[#81DB86]/15 text-[#4B9A51]"
                                            : "bg-[#81DB86] text-black hover:bg-[#72CF78] active:scale-[0.99] disabled:opacity-65"
                                    }`}
                                >
                                    {bookingDone ? <Check size={17} /> : <CalendarClock size={17} />}
                                    {bookingDone ? "You’re booked" : bookingBusy ? "Booking…" : bookingCtaLabel}
                                </button>
                            ) : null}

                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={onBack}
                                    className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-[13px] font-semibold transition ${secondaryButton}`}
                                >
                                    <ArrowLeft size={15} />
                                    Back to sessions
                                </button>
                                <button
                                    type="button"
                                    onClick={onReload}
                                    className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-[13px] font-semibold transition ${secondaryButton}`}
                                >
                                    <RefreshCw size={15} />
                                    Check availability
                                </button>
                            </div>
                        </main>

                        <aside className={`p-5 sm:p-7 ${isLight ? "bg-[#ECEAEA]" : "bg-[#202020]"}`}>
                            <div className="flex items-end justify-between gap-3">
                                <div>
                                    <div className="text-[15px] font-bold">Other sessions by {hostName}</div>
                                    <div className={`mt-1 text-[11px] ${muted}`}>More ways to focus with this host.</div>
                                </div>
                            </div>

                            <div className="mt-4 space-y-3">
                                {otherHostSessionsLoading ? (
                                    [0, 1].map((index) => (
                                        <div key={index} className={`h-[104px] animate-pulse rounded-2xl border ${inset}`} />
                                    ))
                                ) : otherHostSessions.length ? (
                                    otherHostSessions.map((otherSession) => (
                                        <button
                                            key={otherSession.id}
                                            type="button"
                                            onClick={() => onOpenOtherSession?.(otherSession.id)}
                                            className={`group w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${panel}`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-[13px] font-bold">{otherSession.title}</div>
                                                    <div className={`mt-1 text-[11px] ${muted}`}>
                                                        {formatLocalDateTime(otherSession.startMs)}
                                                    </div>
                                                </div>
                                                <ArrowRight size={16} className="mt-0.5 shrink-0 opacity-45 transition group-hover:translate-x-0.5 group-hover:opacity-90" />
                                            </div>
                                            <div className={`mt-3 flex items-center gap-2 text-[11px] ${muted}`}>
                                                <Users size={13} />
                                                {otherSession.bookedCount} booked · capacity {otherSession.maxParticipants}
                                            </div>
                                        </button>
                                    ))
                                ) : (
                                    <div className={`rounded-2xl border p-4 ${inset}`}>
                                        <div className="text-[13px] font-semibold">No other upcoming sessions yet</div>
                                        <div className={`mt-1 text-[11px] leading-5 ${muted}`}>
                                            Browse all sessions to find another room while you wait.
                                        </div>
                                        <button
                                            type="button"
                                            onClick={onBack}
                                            className="mt-3 inline-flex items-center gap-2 text-[12px] font-bold text-[#4B9A51] hover:opacity-75"
                                        >
                                            Browse sessions <ArrowRight size={14} />
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className={`mt-5 rounded-2xl border p-4 text-[11px] leading-5 ${inset} ${muted}`}>
                                This screen updates automatically every second. Use “Check availability” if the join window has just opened.
                            </div>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}
