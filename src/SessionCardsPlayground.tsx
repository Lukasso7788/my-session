import React, { useMemo, useState } from "react";

/**
 * Paste into any React+Tailwind project.
 * Tailwind required. No external deps.
 */

type Segment = { kind: "work" | "break"; w: number };
type Session = {
    title: string;
    badges: string[];
    booked: number;
    live: number;
};

const session: Session = {
    title: "25/5 Pomodoro — 24/7",
    badges: ["Host", "Infinite", "Pomodoro"],
    booked: 3,
    live: 3,
};

function cn(...xs: Array<string | false | null | undefined>) {
    return xs.filter(Boolean).join(" ");
}

function TimelineBar({
    segments,
    height = 10,
    rounded = true,
    variant = "solid",
}: {
    segments: Segment[];
    height?: number;
    rounded?: boolean;
    variant?: "solid" | "soft" | "outline";
}) {
    return (
        <div
            className={cn(
                "w-full overflow-hidden",
                rounded && "rounded-full",
                variant === "outline" && "border border-slate-200",
                variant === "soft" && "bg-slate-100"
            )}
            style={{ height }}
        >
            <div className="flex h-full w-full">
                {segments.map((s, i) => (
                    <div
                        key={i}
                        className={cn(
                            "h-full",
                            s.kind === "work" ? "bg-emerald-500/70" : "bg-slate-300/80"
                        )}
                        style={{ width: `${s.w}%` }}
                        title={s.kind}
                    />
                ))}
            </div>
        </div>
    );
}

function SegmentedDots({ segments }: { segments: Segment[] }) {
    const dots = segments.flatMap((s) =>
        Array.from({ length: Math.max(1, Math.round(s.w / 8)) }, () => s.kind)
    );
    return (
        <div className="flex flex-wrap gap-1">
            {dots.slice(0, 20).map((k, i) => (
                <span
                    key={i}
                    className={cn(
                        "h-2 w-2 rounded-full",
                        k === "work" ? "bg-emerald-500/80" : "bg-slate-300"
                    )}
                />
            ))}
        </div>
    );
}

function MiniStack({ segments }: { segments: Segment[] }) {
    return (
        <div className="flex w-full gap-1">
            {segments.map((s, i) => (
                <div
                    key={i}
                    className={cn(
                        "h-8 rounded-lg",
                        s.kind === "work" ? "bg-emerald-500/15" : "bg-slate-200"
                    )}
                    style={{ width: `${s.w}%` }}
                >
                    <div
                        className={cn(
                            "h-full rounded-lg",
                            s.kind === "work" ? "bg-emerald-500/35" : "bg-slate-300/60"
                        )}
                        style={{ width: "100%" }}
                    />
                </div>
            ))}
        </div>
    );
}

function HeaderLeft({ title }: { title: string }) {
    return (
        <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-xl">
                🍅
            </div>
            <div className="min-w-0">
                <div className="truncate text-[18px] font-semibold text-slate-900">
                    {title}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                        Host
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                        Infinite
                    </span>
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-600">
                        Pomodoro
                    </span>
                    <span>Booked: 3</span>
                </div>
            </div>
        </div>
    );
}

function RightActions() {
    return (
        <div className="flex items-center gap-2">
            <button className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]">
                Join session
            </button>
            <button
                className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
                aria-label="More"
                title="More"
            >
                ⋯
            </button>
        </div>
    );
}

function LivePill({ live }: { live: number }) {
    return (
        <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-slate-900">
                <div className="text-lg font-semibold">{live}</div>
            </div>
            <div className="text-right leading-tight">
                <div className="text-xs text-slate-500">in the session</div>
                <div className="text-xs font-medium text-emerald-600">now</div>
            </div>
        </div>
    );
}

function useMockTimeline(): Segment[] {
    return useMemo(
        () => [
            { kind: "work", w: 12 },
            { kind: "break", w: 5 },
            { kind: "work", w: 14 },
            { kind: "break", w: 5 },
            { kind: "work", w: 18 },
            { kind: "break", w: 6 },
            { kind: "work", w: 28 },
            { kind: "break", w: 12 },
        ],
        []
    );
}

/** ===== Variant 1: Inline timeline under actions (clean) ===== */
function CardV1() {
    const t = useMockTimeline();
    return (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <HeaderLeft title={session.title} />
                <div className="flex items-center justify-between gap-4 md:justify-end">
                    <LivePill live={session.live} />
                    <RightActions />
                </div>
            </div>
            <div className="mt-4">
                <TimelineBar segments={t} height={10} />
            </div>
        </div>
    );
}

/** ===== Variant 2: Timeline as bottom strip full width ===== */
function CardV2() {
    const t = useMockTimeline();
    return (
        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <HeaderLeft title={session.title} />
                    <div className="flex items-center justify-between gap-4 md:justify-end">
                        <LivePill live={session.live} />
                        <RightActions />
                    </div>
                </div>
            </div>
            <div className="px-5 pb-5">
                <TimelineBar segments={t} height={12} rounded />
            </div>
        </div>
    );
}

/** ===== Variant 3: Timeline inside a soft pill “chip” area ===== */
function CardV3() {
    const t = useMockTimeline();
    return (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <HeaderLeft title={session.title} />
                <div className="flex items-center justify-between gap-4 md:justify-end">
                    <LivePill live={session.live} />
                    <RightActions />
                </div>
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50 p-3">
                <div className="mb-2 text-xs font-medium text-slate-600">
                    Session timeline
                </div>
                <TimelineBar segments={t} height={10} variant="soft" />
            </div>
        </div>
    );
}

/** ===== Variant 4: Timeline as “rail” with markers ===== */
function CardV4() {
    const t = useMockTimeline();
    return (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <HeaderLeft title={session.title} />
                <div className="flex items-center justify-between gap-4 md:justify-end">
                    <LivePill live={session.live} />
                    <RightActions />
                </div>
            </div>

            <div className="mt-4">
                <TimelineBar segments={t} height={10} variant="outline" />
                <div className="mt-2 flex justify-between text-[11px] text-slate-400">
                    <span>Start</span>
                    <span>Now</span>
                    <span>Next break</span>
                </div>
            </div>
        </div>
    );
}

/** ===== Variant 5: Timeline collapsed behind “info” pill ===== */
function CardV5() {
    const t = useMockTimeline();
    const [open, setOpen] = useState(false);
    return (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <HeaderLeft title={session.title} />
                <div className="flex items-center justify-between gap-4 md:justify-end">
                    <LivePill live={session.live} />
                    <RightActions />
                </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
                <button
                    onClick={() => setOpen((v) => !v)}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100">
                        i
                    </span>
                    Session info
                    <span className={cn("transition", open && "rotate-180")}>⌄</span>
                </button>
                <div className="flex-1" />
            </div>

            <div
                className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-300",
                    open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                )}
            >
                <div className="overflow-hidden pt-3">
                    <TimelineBar segments={t} height={10} />
                    <div className="mt-2 text-xs text-slate-500">
                        Work/break pattern preview
                    </div>
                </div>
            </div>
        </div>
    );
}

/** ===== Variant 6: Timeline as dotted summary (compact) ===== */
function CardV6() {
    const t = useMockTimeline();
    return (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <HeaderLeft title={session.title} />
                <div className="flex items-center justify-between gap-4 md:justify-end">
                    <div className="hidden md:block">
                        <SegmentedDots segments={t} />
                        <div className="mt-1 text-[11px] text-slate-400">
                            quick timeline
                        </div>
                    </div>
                    <LivePill live={session.live} />
                    <RightActions />
                </div>
            </div>

            <div className="mt-4 md:hidden">
                <SegmentedDots segments={t} />
            </div>
        </div>
    );
}

/** ===== Variant 7: Timeline as stacked “blocks” (visual) ===== */
function CardV7() {
    const t = useMockTimeline();
    return (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <HeaderLeft title={session.title} />
                <div className="flex items-center justify-between gap-4 md:justify-end">
                    <LivePill live={session.live} />
                    <RightActions />
                </div>
            </div>
            <div className="mt-4">
                <MiniStack segments={t} />
            </div>
        </div>
    );
}

/** ===== Variant 8: Timeline in right column (vertical rail) ===== */
function CardV8() {
    const t = useMockTimeline();
    const total = t.reduce((a, s) => a + s.w, 0) || 1;
    return (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-stretch gap-4">
                <div className="min-w-0 flex-1">
                    <HeaderLeft title={session.title} />
                    <div className="mt-4 flex items-center justify-between gap-4">
                        <LivePill live={session.live} />
                        <RightActions />
                    </div>
                </div>

                <div className="w-3 overflow-hidden rounded-full bg-slate-100">
                    <div className="flex h-full w-full flex-col">
                        {t.map((s, i) => (
                            <div
                                key={i}
                                className={cn(
                                    s.kind === "work" ? "bg-emerald-500/70" : "bg-slate-300/80"
                                )}
                                style={{ height: `${(s.w / total) * 100}%` }}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

/** ===== Variant 9: Timeline as “progress + labels” (info-heavy) ===== */
function CardV9() {
    const t = useMockTimeline();
    return (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <HeaderLeft title={session.title} />
                <div className="flex items-center justify-between gap-4 md:justify-end">
                    <LivePill live={session.live} />
                    <RightActions />
                </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-slate-700">
                        Current block: Work
                    </div>
                    <div className="text-xs text-slate-500">Next: Break in ~4m</div>
                </div>
                <div className="mt-2">
                    <TimelineBar segments={t} height={10} />
                </div>
            </div>
        </div>
    );
}

/** ===== Variant 10: Minimal with timeline as background accent ===== */
function CardV10() {
    const t = useMockTimeline();
    return (
        <div className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            {/* background accent */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 opacity-60">
                <TimelineBar segments={t} height={14} rounded={false} />
            </div>

            <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <HeaderLeft title={session.title} />
                <div className="flex items-center justify-between gap-4 md:justify-end">
                    <LivePill live={session.live} />
                    <RightActions />
                </div>
            </div>

            <div className="relative mt-4 text-[11px] text-slate-500">
                Timeline preview embedded as footer accent
            </div>
        </div>
    );
}

export default function SessionCardsPlayground() {
    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="mx-auto max-w-5xl space-y-4">
                <CardV1 />
                <CardV2 />
                <CardV3 />
                <CardV4 />
                <CardV5 />
                <CardV6 />
                <CardV7 />
                <CardV8 />
                <CardV9 />
                <CardV10 />
            </div>
        </div>
    );
}
