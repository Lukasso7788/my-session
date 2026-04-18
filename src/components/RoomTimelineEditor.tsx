import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    X,
    Layers,
    ArrowUp,
    ArrowDown,
    Trash2,
    RotateCcw,
    Plus,
} from "lucide-react";
import type { RoomTheme } from "./VideoControls";

export type RoomTimelineBlockKind =
    | "welcome"
    | "intentions"
    | "focus"
    | "break"
    | "checkin"
    | "recap"
    | "celebrate"
    | "outro"
    | "custom";

export type RoomTimelineBlock = {
    id: string;
    kind: RoomTimelineBlockKind;
    title: string;
    minutes: number;
    note?: string;
};

interface Props {
    open: boolean;
    theme: RoomTheme;
    title?: string;
    blocks: RoomTimelineBlock[];
    onChange: (blocks: RoomTimelineBlock[]) => void;
    onClose: () => void;
    onSave: () => void | Promise<void>;
    saving?: boolean;
    preserveInfinite?: boolean;
}

const END_DROP_ID = "__end__";
const QUICK_MINUTES = [3, 5, 10, 15, 25, 50];

const KIND_OPTIONS: { value: RoomTimelineBlockKind; label: string }[] = [
    { value: "welcome", label: "Welcome" },
    { value: "intentions", label: "Intentions" },
    { value: "focus", label: "Focus" },
    { value: "break", label: "Break" },
    { value: "checkin", label: "Check-in" },
    { value: "recap", label: "Recap" },
    { value: "celebrate", label: "Celebrate" },
    { value: "outro", label: "Outro" },
    { value: "custom", label: "Custom" },
];

const LIBRARY: RoomTimelineBlock[] = [
    {
        id: "lib_welcome",
        kind: "welcome",
        title: "Welcome",
        minutes: 3,
        note: "Quick intro / rules / vibe",
    },
    {
        id: "lib_intentions",
        kind: "intentions",
        title: "Intentions",
        minutes: 5,
        note: "Say what you’ll finish",
    },
    {
        id: "lib_focus",
        kind: "focus",
        title: "Focus",
        minutes: 50,
        note: "Deep work block",
    },
    {
        id: "lib_break",
        kind: "break",
        title: "Break",
        minutes: 10,
        note: "Recharge / stretch",
    },
    {
        id: "lib_checkin",
        kind: "checkin",
        title: "Check-in",
        minutes: 3,
        note: "Short accountability checkpoint",
    },
    {
        id: "lib_recap",
        kind: "recap",
        title: "Recap",
        minutes: 5,
        note: "What got done / what’s next",
    },
    {
        id: "lib_celebrate",
        kind: "celebrate",
        title: "Celebrate",
        minutes: 3,
        note: "Closure + positive finish",
    },
    {
        id: "lib_outro",
        kind: "outro",
        title: "Outro",
        minutes: 3,
        note: "Wrap up / closing",
    },
    {
        id: "lib_custom",
        kind: "custom",
        title: "Custom",
        minutes: 5,
        note: "Any special block",
    },
];

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

function uid() {
    const c: any = (globalThis as any)?.crypto;
    if (c?.randomUUID) return c.randomUUID();
    return `rt_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function safeParseJson(raw: any) {
    if (!raw) return null;
    if (typeof raw === "string") {
        const s = raw.trim();
        if (!s || s === "undefined" || s === "null") return null;
        try {
            return JSON.parse(s);
        } catch {
            return null;
        }
    }
    return raw;
}

function parse50505(
    raw: any
): { focus: number; break: number; intentions: number } | null {
    if (typeof raw !== "string") return null;
    const s = raw.trim();
    const m1 = s.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/);
    const m2 = s.match(/^(\d+)\s*-\s*(\d+)\s*-\s*(\d+)$/);
    const m = m1 || m2;
    if (!m) return null;

    const focus = Number(m[1]);
    const br = Number(m[2]);
    const intentions = Number(m[3]);

    if (
        !Number.isFinite(focus) ||
        !Number.isFinite(br) ||
        !Number.isFinite(intentions)
    ) {
        return null;
    }
    if (focus <= 0 || br <= 0 || intentions <= 0) return null;

    return { focus, break: br, intentions };
}

function unwrapScheduleBlocks(parsed: any): any {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return parsed;
    }

    const candidates: any[] = [
        parsed?.blocks,
        parsed?.script,
        parsed?.agenda,
        parsed?.items,
        parsed?.stages,
        parsed?.data?.blocks,
        parsed?.data?.script,
        parsed?.data?.agenda,
        parsed?.data?.items,
        parsed?.data?.stages,
    ];

    for (const c of candidates) {
        if (Array.isArray(c)) return c;
    }

    return parsed;
}

function normalizeInfinitePhases(
    anyPhases: any
): { name: string; seconds: number; kind?: string; note?: string }[] {
    if (!anyPhases) return [];

    const toSeconds = (raw: any): number => {
        const explicitSeconds =
            Number(raw?.seconds) ||
            Number(raw?.duration_seconds) ||
            Number(raw?.durationSeconds);
        if (explicitSeconds > 0) return explicitSeconds;

        const explicitMinutes =
            Number(raw?.minutes) ||
            Number(raw?.mins) ||
            Number(raw?.duration_minutes) ||
            Number(raw?.durationMinutes);
        if (explicitMinutes > 0) return explicitMinutes * 60;

        const n =
            typeof raw === "number" ? raw : Number(raw?.duration ?? raw?.value ?? raw ?? 0);
        if (!Number.isFinite(n) || n <= 0) return 0;

        if (n <= 180) return n * 60;
        return n;
    };

    if (Array.isArray(anyPhases)) {
        return anyPhases
            .map((p: any) => {
                const name = String(
                    p?.name || p?.title || p?.key || p?.type || p?.kind || ""
                );
                const kind = String(p?.kind || p?.type || "");
                const note = String(p?.note || p?.description || "").trim() || undefined;
                const seconds = toSeconds(p);
                return { name, seconds, kind, note };
            })
            .filter((x) => x.seconds > 0);
    }

    if (typeof anyPhases === "object") {
        return Object.entries(anyPhases)
            .map(([k, v]: any) => {
                const seconds =
                    typeof v === "number"
                        ? v <= 180
                            ? Number(v) * 60
                            : Number(v)
                        : toSeconds(v);

                const kind =
                    typeof v === "object" ? String(v?.kind || v?.type || k || "") : String(k || "");

                const note =
                    typeof v === "object"
                        ? String(v?.note || v?.description || "").trim() || undefined
                        : undefined;

                return { name: String(k || ""), seconds, kind, note };
            })
            .filter((x) => x.seconds > 0);
    }

    return [];
}

function normalizeBlockKind(raw: any): RoomTimelineBlockKind {
    const s = String(raw || "").trim().toLowerCase();

    if (
        s.includes("welcome") ||
        s.includes("intro") ||
        s.includes("opening") ||
        s === "start"
    ) {
        return "welcome";
    }

    if (s.includes("intention") || s.includes("goal") || s.includes("plan")) {
        return "intentions";
    }

    if (s.includes("checkin") || s.includes("check-in")) return "checkin";
    if (s.includes("focus") || s.includes("work")) return "focus";
    if (s.includes("break") || s.includes("pause") || s.includes("rest")) {
        return "break";
    }
    if (s.includes("recap") || s.includes("review") || s.includes("reflection")) {
        return "recap";
    }
    if (s.includes("celebrate") || s.includes("celebration")) {
        return "celebrate";
    }
    if (
        s.includes("outro") ||
        s.includes("farewell") ||
        s.includes("wrap") ||
        s.includes("closing") ||
        s.includes("end")
    ) {
        return "outro";
    }
    if (s.includes("custom")) return "custom";

    return "custom";
}

function defaultTitleForKind(kind: RoomTimelineBlockKind) {
    switch (kind) {
        case "welcome":
            return "Welcome";
        case "intentions":
            return "Intentions";
        case "focus":
            return "Focus";
        case "break":
            return "Break";
        case "checkin":
            return "Check-in";
        case "recap":
            return "Recap";
        case "celebrate":
            return "Celebrate";
        case "outro":
            return "Outro";
        default:
            return "Custom";
    }
}

function minutesFromAny(raw: any) {
    const sec =
        Number(raw?.durationSeconds) ||
        Number(raw?.duration_seconds) ||
        Number(raw?.seconds);

    if (Number.isFinite(sec) && sec > 0) {
        return Math.max(1, Math.round(sec / 60));
    }

    const mins =
        Number(raw?.minutes) ||
        Number(raw?.mins) ||
        Number(raw?.duration_minutes) ||
        Number(raw?.durationMinutes) ||
        Number(raw?.duration);

    if (Number.isFinite(mins) && mins > 0) {
        return Math.max(1, Math.round(mins));
    }

    return 0;
}

function kindDot(kind: RoomTimelineBlockKind) {
    switch (kind) {
        case "welcome":
            return "bg-emerald-300";
        case "intentions":
            return "bg-sky-300";
        case "focus":
            return "bg-blue-400";
        case "break":
            return "bg-rose-300";
        case "checkin":
            return "bg-cyan-300";
        case "recap":
            return "bg-violet-300";
        case "celebrate":
            return "bg-pink-300";
        case "outro":
            return "bg-emerald-400";
        default:
            return "bg-indigo-300";
    }
}

function timelineBarBg(kind: RoomTimelineBlockKind) {
    switch (kind) {
        case "welcome":
            return "#86EFAC";
        case "intentions":
            return "#7DD3FC";
        case "focus":
            return "#60A5FA";
        case "break":
            return "#FDA4AF";
        case "checkin":
            return "#67E8F9";
        case "recap":
            return "#C4B5FD";
        case "celebrate":
            return "#F9A8D4";
        case "outro":
            return "#6EE7B7";
        default:
            return "#A5B4FC";
    }
}

function formatMinutes(min: number) {
    const m = Math.max(0, Math.floor(min || 0));
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h <= 0) return `${mm}m`;
    if (mm === 0) return `${h}h`;
    return `${h}h ${mm}m`;
}

function isInteractiveElement(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    if (!el) return false;

    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") {
        return true;
    }
    if (el.isContentEditable) return true;
    return !!el.closest("input, textarea, select, button, [contenteditable='true']");
}

export function makeDefaultTimelineBlocks(): RoomTimelineBlock[] {
    return [
        {
            id: uid(),
            kind: "welcome",
            title: "Welcome",
            minutes: 3,
            note: "Quick intro / rules / vibe",
        },
        {
            id: uid(),
            kind: "intentions",
            title: "Intentions",
            minutes: 5,
            note: "Say what you’ll finish",
        },
        {
            id: uid(),
            kind: "focus",
            title: "Focus",
            minutes: 50,
            note: "Deep work block",
        },
        {
            id: uid(),
            kind: "break",
            title: "Break",
            minutes: 10,
            note: "Recharge / stretch",
        },
        {
            id: uid(),
            kind: "focus",
            title: "Focus",
            minutes: 50,
            note: "Second focus block",
        },
        {
            id: uid(),
            kind: "recap",
            title: "Recap",
            minutes: 5,
            note: "What got done / what’s next",
        },
        {
            id: uid(),
            kind: "celebrate",
            title: "Celebrate",
            minutes: 3,
            note: "Closure + positive finish",
        },
    ];
}

export function getTimelineTotalMinutes(blocks: RoomTimelineBlock[]) {
    return (blocks || []).reduce(
        (sum, b) => sum + clamp(Number(b.minutes) || 0, 0, 24 * 60),
        0
    );
}

export function timelineBlocksFromSchedule(rawSchedule: any): RoomTimelineBlock[] {
    let parsed: any = safeParseJson(rawSchedule);

    if (!parsed) {
        const t = parse50505(rawSchedule);
        if (t) {
            return [
                { id: uid(), kind: "focus", title: "Focus", minutes: t.focus },
                { id: uid(), kind: "break", title: "Break", minutes: t.break },
                { id: uid(), kind: "intentions", title: "Intentions", minutes: t.intentions },
            ];
        }
        return [];
    }

    parsed = unwrapScheduleBlocks(parsed);

    if (Array.isArray(parsed)) {
        return parsed
            .map((b: any) => {
                const kind = normalizeBlockKind(
                    b?.kind || b?.type || b?.stageType || b?.title || b?.name
                );
                const title =
                    String(
                        b?.title || b?.name || b?.label || defaultTitleForKind(kind)
                    ).trim() || defaultTitleForKind(kind);

                const minutes = minutesFromAny(b);
                if (!minutes) return null;

                return {
                    id: uid(),
                    kind,
                    title,
                    minutes,
                    note: String(b?.note || b?.description || "").trim() || undefined,
                } as RoomTimelineBlock;
            })
            .filter(Boolean) as RoomTimelineBlock[];
    }

    const isInfiniteLike =
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (String(parsed?.kind || "").toLowerCase().includes("infinite") ||
            parsed?.timer?.phases ||
            parsed?.timer?.segments ||
            parsed?.phases ||
            parsed?.segments);

    if (isInfiniteLike) {
        const phasesRaw =
            parsed?.timer?.phases ||
            parsed?.timer?.segments ||
            parsed?.phases ||
            parsed?.segments ||
            null;

        const phases = normalizeInfinitePhases(phasesRaw);

        return phases.map((p) => {
            const kind = normalizeBlockKind(p?.kind || p?.name);
            return {
                id: uid(),
                kind,
                title:
                    String(p?.name || defaultTitleForKind(kind)).trim() ||
                    defaultTitleForKind(kind),
                minutes: Math.max(1, Math.round((Number(p.seconds) || 0) / 60)),
                note: p?.note,
            } as RoomTimelineBlock;
        });
    }

    return [];
}

export function timelineBlocksToSchedulePayload(
    blocks: RoomTimelineBlock[],
    opts?: { preserveInfinite?: boolean; anchorTs?: string | null }
) {
    const cleaned = (blocks || [])
        .map((b, index) => {
            const kind = normalizeBlockKind(b.kind);
            const minutes = clamp(Number(b.minutes) || 1, 1, 24 * 60);
            const title = String(b.title || "").trim() || defaultTitleForKind(kind);

            return {
                kind,
                title,
                minutes,
                note: String(b.note || "").trim() || null,
                order: index,
                v: 1,
            };
        })
        .filter((b) => b.minutes > 0);

    if (opts?.preserveInfinite) {
        return {
            kind: "infinite_room",
            anchor_ts: String(opts?.anchorTs || new Date().toISOString()),
            timer: {
                phases: cleaned.map((b, index) => ({
                    kind: b.kind,
                    type: b.kind,
                    name: b.title,
                    title: b.title,
                    minutes: b.minutes,
                    note: b.note,
                    order: index,
                    v: 1,
                })),
            },
            v: 1,
        };
    }

    return cleaned;
}

function TimelinePreview({
    blocks,
    onChange,
}: {
    blocks: RoomTimelineBlock[];
    onChange: (b: RoomTimelineBlock[]) => void;
}) {
    const [dragId, setDragId] = useState<string | null>(null);

    const total = getTimelineTotalMinutes(blocks);

    const move = (fromId: string, toId: string) => {
        const from = blocks.findIndex(b => b.id === fromId);
        const to = blocks.findIndex(b => b.id === toId);
        if (from < 0 || to < 0) return;

        const copy = [...blocks];
        const [item] = copy.splice(from, 1);
        copy.splice(to, 0, item);

        onChange(copy);
    };

    const update = (id: string, patch: Partial<RoomTimelineBlock>) => {
        onChange(blocks.map(b => b.id === id ? { ...b, ...patch } : b));
    };

    if (!blocks.length) {
        return (
            <div className="mt-3 text-sm opacity-50">
                Empty timeline
            </div>
        );
    }

    return (
        <div className="mt-3">

            {/* HEADER */}
            <div className="flex justify-between text-xs opacity-60">
                <span>Timeline</span>
                <span>{total} min</span>
            </div>

            {/* BAR */}
            <div className="mt-2 flex h-10 rounded-xl overflow-hidden bg-black/10">

                {blocks.map((b) => (
                    <div
                        key={b.id}
                        draggable
                        onDragStart={() => setDragId(b.id)}
                        onDragOver={(e) => {
                            e.preventDefault();
                            if (dragId && dragId !== b.id) {
                                move(dragId, b.id);
                            }
                        }}
                        className="relative group flex items-center justify-center border-r border-white/20 cursor-grab active:cursor-grabbing"
                        style={{ flexGrow: b.minutes }}
                    >

                        {/* BACKGROUND */}
                        <div
                            className="absolute inset-0 opacity-80"
                            style={{ background: timelineBarBg(b.kind) }}
                        />

                        {/* CONTENT */}
                        <div className="relative z-10 text-[11px] font-medium px-2 truncate">
                            {b.title}
                        </div>

                        {/* HOVER EDIT */}
                        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-black/60 flex flex-col items-center justify-center gap-1 transition">

                            <input
                                value={b.title}
                                onChange={(e) =>
                                    update(b.id, { title: e.target.value })
                                }
                                className="text-[10px] bg-black/40 px-1 rounded text-white w-[90%]"
                            />

                            <input
                                type="number"
                                value={b.minutes}
                                onChange={(e) =>
                                    update(b.id, {
                                        minutes: clamp(Number(e.target.value) || 1, 1, 600),
                                    })
                                }
                                className="text-[10px] bg-black/40 px-1 rounded w-14 text-center"
                            />

                        </div>

                        {/* RESIZE HANDLE */}
                        <div
                            onMouseDown={(e) => {
                                e.preventDefault();

                                const startX = e.clientX;
                                const startMinutes = b.minutes;

                                const onMove = (ev: MouseEvent) => {
                                    const delta = ev.clientX - startX;
                                    const next = clamp(startMinutes + delta / 5, 1, 600);

                                    update(b.id, { minutes: Math.round(next) });
                                };

                                const onUp = () => {
                                    window.removeEventListener("mousemove", onMove);
                                    window.removeEventListener("mouseup", onUp);
                                };

                                window.addEventListener("mousemove", onMove);
                                window.addEventListener("mouseup", onUp);
                            }}
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/20 opacity-0 group-hover:opacity-100"
                        />

                    </div>
                ))}
            </div>
        </div>
    );
}

export default function RoomTimelineEditor({
    open,
    theme,
    title,
    blocks,
    onChange,
    onClose,
    onSave,
    saving = false,
    preserveInfinite = false,
}: Props) {
    const isLight = theme === "light";

    const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [dropEdge, setDropEdge] = useState<"before" | "after">("after");

    const modalScrollRef = useRef<HTMLDivElement | null>(null);
    const autoScrollRafRef = useRef<number | null>(null);
    const autoScrollVelRef = useRef<number>(0);
    const draggingRef = useRef<boolean>(false);

    const flipPrevTopsRef = useRef<Record<string, number>>({});
    const flipArmedRef = useRef<boolean>(false);

    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !saving) onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose, saving]);

    const totalMinutes = useMemo(() => getTimelineTotalMinutes(blocks), [blocks]);

    const focusBlock = useCallback((id: string) => {
        if (!id) return;
        requestAnimationFrame(() => {
            const el = document.getElementById(`room-timeline-block-${id}`) as HTMLElement | null;
            if (!el) return;
            el.focus();
            try {
                el.scrollIntoView({ block: "nearest", behavior: "smooth" });
            } catch { }
        });
    }, []);

    const startAutoScrollLoop = useCallback(() => {
        if (autoScrollRafRef.current) return;
        draggingRef.current = true;

        const tick = () => {
            if (!draggingRef.current) {
                autoScrollRafRef.current = null;
                return;
            }

            const scroller = modalScrollRef.current;
            const v = autoScrollVelRef.current;

            if (scroller && v !== 0) {
                scroller.scrollTop += v;
            }

            autoScrollRafRef.current = requestAnimationFrame(tick);
        };

        autoScrollRafRef.current = requestAnimationFrame(tick);
    }, []);

    const stopAutoScrollLoop = useCallback(() => {
        draggingRef.current = false;
        autoScrollVelRef.current = 0;
        if (autoScrollRafRef.current) {
            cancelAnimationFrame(autoScrollRafRef.current);
            autoScrollRafRef.current = null;
        }
    }, []);

    const updateAutoScrollFromClientY = useCallback((clientY: number) => {
        const scroller = modalScrollRef.current;
        if (!scroller) {
            autoScrollVelRef.current = 0;
            return;
        }

        const rect = scroller.getBoundingClientRect();
        const threshold = 80;
        const maxSpeed = 18;

        const topZone = rect.top + threshold;
        const bottomZone = rect.bottom - threshold;

        let vel = 0;

        if (clientY < topZone) {
            const t = clamp((topZone - clientY) / threshold, 0, 1);
            vel = -Math.round(maxSpeed * t);
        } else if (clientY > bottomZone) {
            const t = clamp((clientY - bottomZone) / threshold, 0, 1);
            vel = Math.round(maxSpeed * t);
        } else {
            vel = 0;
        }

        autoScrollVelRef.current = vel;
    }, []);

    const armFlip = useCallback(() => {
        const tops: Record<string, number> = {};
        for (const b of blocks) {
            const el = document.getElementById(`room-timeline-block-${b.id}`) as HTMLElement | null;
            if (!el) continue;
            tops[b.id] = el.getBoundingClientRect().top;
        }
        flipPrevTopsRef.current = tops;
        flipArmedRef.current = true;
    }, [blocks]);

    useLayoutEffect(() => {
        if (!flipArmedRef.current) return;

        const prev = flipPrevTopsRef.current || {};
        flipArmedRef.current = false;

        for (const b of blocks) {
            const el = document.getElementById(`room-timeline-block-${b.id}`) as HTMLElement | null;
            if (!el) continue;

            const prevTop = prev[b.id];
            if (typeof prevTop !== "number") continue;

            const nextTop = el.getBoundingClientRect().top;
            const dy = prevTop - nextTop;

            if (Math.abs(dy) < 1) continue;

            try {
                el.animate(
                    [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0px)" }],
                    {
                        duration: 180,
                        easing: "cubic-bezier(0.2, 0, 0, 1)",
                    }
                );
            } catch { }
        }
    }, [blocks]);

    const addFromLibrary = useCallback(
        (b: RoomTimelineBlock) => {
            onChange([
                ...blocks,
                {
                    id: uid(),
                    kind: b.kind,
                    title: b.title,
                    minutes: b.minutes,
                    note: b.note,
                },
            ]);
        },
        [blocks, onChange]
    );

    const updateBlock = useCallback(
        (id: string, patch: Partial<RoomTimelineBlock>) => {
            onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
        },
        [blocks, onChange]
    );

    const removeBlock = useCallback(
        (id: string) => {
            onChange(blocks.filter((b) => b.id !== id));
            setSelectedBlockId((cur) => (cur === id ? null : cur));
        },
        [blocks, onChange]
    );

    const moveBlock = useCallback(
        (id: string, dir: -1 | 1) => {
            armFlip();

            const idx = blocks.findIndex((b) => b.id === id);
            if (idx < 0) return;

            const nextIdx = idx + dir;
            if (nextIdx < 0 || nextIdx >= blocks.length) return;

            const copy = [...blocks];
            const [item] = copy.splice(idx, 1);
            copy.splice(nextIdx, 0, item);

            onChange(copy);
            setSelectedBlockId(id);
            focusBlock(id);
        },
        [armFlip, blocks, focusBlock, onChange]
    );

    const moveBlockTo = useCallback(
        (dragId: string, overId: string, edge: "before" | "after") => {
            if (!dragId || !overId) return;

            armFlip();

            const from = blocks.findIndex((b) => b.id === dragId);
            if (from < 0) return;

            if (overId === END_DROP_ID) {
                const copy = [...blocks];
                const [item] = copy.splice(from, 1);
                copy.push(item);
                onChange(copy);
                setSelectedBlockId(dragId);
                focusBlock(dragId);
                return;
            }

            const to = blocks.findIndex((b) => b.id === overId);
            if (to < 0 || dragId === overId) return;

            const copy = [...blocks];
            const [item] = copy.splice(from, 1);

            const toAfterRemoval = from < to ? to - 1 : to;
            const insertIndex = toAfterRemoval + (edge === "after" ? 1 : 0);
            copy.splice(clamp(insertIndex, 0, copy.length), 0, item);

            onChange(copy);
            setSelectedBlockId(dragId);
            focusBlock(dragId);
        },
        [armFlip, blocks, focusBlock, onChange]
    );

    const resetDefault = useCallback(() => {
        onChange(makeDefaultTimelineBlocks());
    }, [onChange]);

    if (!open) return null;

    const overlayBg = isLight ? "bg-black/45" : "bg-black/60";
    const panelBg = isLight ? "bg-white text-black/85" : "bg-[#06111C] text-white";
    const subtleBorder = isLight ? "border-black/10" : "border-white/10";
    const softBg = isLight ? "bg-black/5" : "bg-white/5";
    const mutedText = isLight ? "text-black/55" : "text-white/55";
    const inputCls = isLight
        ? "bg-white border-black/10 text-black/85"
        : "bg-[#0B1220] border-white/10 text-white/90";

    return (
        <div className={`fixed inset-0 z-[90] ${overlayBg} p-2 sm:p-4 flex items-center justify-center`}>
            <div
                className={`w-full max-w-[1200px] max-h-[92vh] rounded-[24px] shadow-2xl border ${subtleBorder} ${panelBg} overflow-hidden flex flex-col`}
            >
                <div
                    className={`px-4 sm:px-6 py-4 border-b ${subtleBorder} flex items-center justify-between gap-3`}
                >
                    <div className="min-w-0">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${softBg}`}>
                                <Layers size={18} />
                            </div>
                            <div className="min-w-0">
                                <div className="font-inter font-bold text-[18px] truncate">
                                    Edit timeline
                                </div>
                                <div className={`font-inter text-[12px] ${mutedText} truncate`}>
                                    {title || "Session"}
                                    {preserveInfinite ? " • infinite room" : " • finite session"}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={resetDefault}
                            className={`px-3 py-2 rounded-xl border ${subtleBorder} ${softBg} text-[12px] font-semibold`}
                        >
                            <span className="inline-flex items-center gap-2">
                                <RotateCcw size={14} />
                                Reset
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            className={`w-10 h-10 rounded-2xl border ${subtleBorder} ${softBg} flex items-center justify-center disabled:opacity-50`}
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div ref={modalScrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6">
                    <TimelinePreview blocks={blocks} onChange={onChange} />

                    <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                        <div className={`font-inter text-[12px] ${mutedText}`}>
                            Drag blocks to reorder, click a card and use ↑ / ↓, or change block kind directly.
                        </div>
                        <div className="font-inter text-[12px]">
                            Total: <span className="font-semibold">{totalMinutes} min</span>
                        </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className={`border rounded-[20px] p-4 ${subtleBorder}`}>
                            <div className="font-inter font-semibold text-[14px]">Block library</div>
                            <div className={`mt-1 font-inter text-[12px] ${mutedText}`}>
                                Add blocks to the current in-room timeline.
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3">
                                {LIBRARY.map((b) => (
                                    <button
                                        key={b.id}
                                        type="button"
                                        onClick={() => addFromLibrary(b)}
                                        className={`text-left border rounded-[16px] p-3 transition ${subtleBorder} ${softBg}`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="font-inter font-semibold text-[12px] truncate">
                                                    {b.title}
                                                </div>
                                                <div className={`mt-1 font-inter text-[11px] ${mutedText} leading-snug`}>
                                                    {b.note}
                                                </div>
                                            </div>
                                            <div className="shrink-0 text-[11px] font-inter opacity-70">
                                                {b.minutes}m
                                            </div>
                                        </div>

                                        <div className="mt-3 inline-flex items-center gap-2 text-[11px] font-semibold">
                                            <Plus size={13} />
                                            Add block
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div
                            className={`border rounded-[20px] p-4 ${subtleBorder}`}
                            onDragOver={(e) => {
                                if (!draggingId) return;
                                updateAutoScrollFromClientY(e.clientY);
                            }}
                            onDragLeave={() => {
                                if (!draggingId) return;
                                autoScrollVelRef.current = 0;
                            }}
                        >
                            <div className="font-inter font-semibold text-[14px]">Script</div>
                            <div className={`mt-1 font-inter text-[12px] ${mutedText}`}>
                                These blocks will be saved into <span className="font-semibold">sessions.schedule</span>.
                            </div>

                            {!blocks.length ? (
                                <div
                                    className={`mt-4 rounded-[16px] border border-dashed ${subtleBorder} p-5 font-inter text-[12px] ${mutedText}`}
                                >
                                    Timeline is empty. Add blocks from the library.
                                </div>
                            ) : (
                                <div className="mt-4 space-y-3">
                                    {blocks.map((b, idx) => {
                                        const selected = selectedBlockId === b.id;
                                        const isDragging = draggingId === b.id;
                                        const isOverSelf =
                                            dragOverId === b.id && draggingId && draggingId !== b.id;

                                        return (
                                            <div
                                                key={b.id}
                                                id={`room-timeline-block-${b.id}`}
                                                tabIndex={0}
                                                draggable
                                                onClick={(e) => {
                                                    if (isInteractiveElement(e.target)) return;
                                                    setSelectedBlockId(b.id);
                                                    focusBlock(b.id);
                                                }}
                                                onFocus={(e) => {
                                                    if (e.target !== e.currentTarget) return;
                                                    setSelectedBlockId(b.id);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === "ArrowUp") {
                                                        e.preventDefault();
                                                        moveBlock(b.id, -1);
                                                    } else if (e.key === "ArrowDown") {
                                                        e.preventDefault();
                                                        moveBlock(b.id, 1);
                                                    } else if (e.key === "Delete" || e.key === "Backspace") {
                                                        if (!isInteractiveElement(e.target)) {
                                                            e.preventDefault();
                                                            removeBlock(b.id);
                                                        }
                                                    }
                                                }}
                                                onDragStart={(e) => {
                                                    if (isInteractiveElement(e.target)) {
                                                        e.preventDefault();
                                                        return;
                                                    }

                                                    setDraggingId(b.id);
                                                    setDragOverId(null);
                                                    setDropEdge("after");

                                                    try {
                                                        e.dataTransfer.effectAllowed = "move";
                                                        e.dataTransfer.setData("text/plain", b.id);
                                                        const img = new Image();
                                                        img.src =
                                                            "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
                                                        e.dataTransfer.setDragImage(img, 0, 0);
                                                    } catch { }

                                                    startAutoScrollLoop();
                                                }}
                                                onDragOver={(e) => {
                                                    e.preventDefault();
                                                    if (!draggingId) return;

                                                    updateAutoScrollFromClientY(e.clientY);

                                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                    const mid = rect.top + rect.height / 2;
                                                    const edge: "before" | "after" =
                                                        e.clientY < mid ? "before" : "after";

                                                    if (dragOverId !== b.id) setDragOverId(b.id);
                                                    if (dropEdge !== edge) setDropEdge(edge);
                                                }}
                                                onDrop={(e) => {
                                                    e.preventDefault();

                                                    const dragIdFromData = (() => {
                                                        try {
                                                            return e.dataTransfer.getData("text/plain") || "";
                                                        } catch {
                                                            return "";
                                                        }
                                                    })();

                                                    const dragId = draggingId || dragIdFromData;
                                                    if (dragId) moveBlockTo(dragId, b.id, dropEdge);

                                                    setDraggingId(null);
                                                    setDragOverId(null);
                                                    setDropEdge("after");
                                                    stopAutoScrollLoop();
                                                }}
                                                onDragEnd={() => {
                                                    setDraggingId(null);
                                                    setDragOverId(null);
                                                    setDropEdge("after");
                                                    stopAutoScrollLoop();
                                                }}
                                                className={
                                                    "relative border rounded-[18px] p-3 outline-none transition cursor-grab active:cursor-grabbing " +
                                                    (selected
                                                        ? isLight
                                                            ? "border-black/20 ring-2 ring-black/10"
                                                            : "border-white/20 ring-2 ring-white/10"
                                                        : subtleBorder) +
                                                    (isDragging ? " opacity-60" : "")
                                                }
                                            >
                                                {isOverSelf && (
                                                    <div
                                                        className={
                                                            "pointer-events-none absolute left-3 right-3 h-[3px] rounded-full " +
                                                            (isLight ? "bg-black/70" : "bg-white/70") +
                                                            (dropEdge === "before" ? " -top-[6px]" : " -bottom-[6px]")
                                                        }
                                                    />
                                                )}

                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className={`w-3 h-3 rounded-full ${kindDot(b.kind)}`} />
                                                        <span
                                                            className={`px-2 py-1 rounded-full border ${subtleBorder} text-[10px] font-inter ${mutedText}`}
                                                        >
                                                            {b.kind}
                                                        </span>
                                                    </div>

                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                moveBlock(b.id, -1);
                                                            }}
                                                            disabled={idx === 0}
                                                            className={`w-9 h-9 rounded-[12px] border ${subtleBorder} ${softBg} flex items-center justify-center disabled:opacity-40`}
                                                        >
                                                            <ArrowUp size={16} />
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                moveBlock(b.id, 1);
                                                            }}
                                                            disabled={idx === blocks.length - 1}
                                                            className={`w-9 h-9 rounded-[12px] border ${subtleBorder} ${softBg} flex items-center justify-center disabled:opacity-40`}
                                                        >
                                                            <ArrowDown size={16} />
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                removeBlock(b.id);
                                                            }}
                                                            className={`w-9 h-9 rounded-[12px] border ${subtleBorder} ${softBg} flex items-center justify-center`}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-[160px,minmax(0,1fr),110px] gap-2">
                                                    <select
                                                        value={b.kind}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        onFocus={(e) => e.stopPropagation()}
                                                        onChange={(e) => {
                                                            const nextKind = normalizeBlockKind(e.target.value);
                                                            updateBlock(b.id, {
                                                                kind: nextKind,
                                                                title:
                                                                    String(b.title || "").trim() ||
                                                                    defaultTitleForKind(nextKind),
                                                            });
                                                        }}
                                                        className={`w-full px-3 py-2.5 rounded-[14px] border font-inter text-[13px] ${inputCls}`}
                                                    >
                                                        {KIND_OPTIONS.map((opt) => (
                                                            <option key={opt.value} value={opt.value}>
                                                                {opt.label}
                                                            </option>
                                                        ))}
                                                    </select>

                                                    <input
                                                        value={b.title}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        onFocus={(e) => e.stopPropagation()}
                                                        onChange={(e) => updateBlock(b.id, { title: e.target.value })}
                                                        className={`w-full px-3 py-2.5 rounded-[14px] border font-inter text-[13px] ${inputCls}`}
                                                        placeholder="Block title…"
                                                    />

                                                    <div
                                                        className="flex items-center gap-2"
                                                        onClick={(e) => e.stopPropagation()}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                updateBlock(b.id, {
                                                                    minutes: clamp((Number(b.minutes) || 1) - 1, 1, 24 * 60),
                                                                });
                                                            }}
                                                            className={`w-9 h-9 rounded-[12px] border ${subtleBorder} ${softBg}`}
                                                        >
                                                            –
                                                        </button>

                                                        <input
                                                            type="number"
                                                            min={1}
                                                            max={24 * 60}
                                                            value={b.minutes}
                                                            onClick={(e) => e.stopPropagation()}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                            onFocus={(e) => e.stopPropagation()}
                                                            onChange={(e) =>
                                                                updateBlock(b.id, {
                                                                    minutes: clamp(Number(e.target.value) || 1, 1, 24 * 60),
                                                                })
                                                            }
                                                            className={`w-full h-9 px-2 rounded-[12px] border text-center font-inter text-[13px] ${inputCls}`}
                                                        />

                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                updateBlock(b.id, {
                                                                    minutes: clamp((Number(b.minutes) || 1) + 1, 1, 24 * 60),
                                                                });
                                                            }}
                                                            className={`w-9 h-9 rounded-[12px] border ${subtleBorder} ${softBg}`}
                                                        >
                                                            +
                                                        </button>
                                                    </div>
                                                </div>

                                                <div
                                                    className="mt-2 flex items-center gap-2 flex-wrap"
                                                    onClick={(e) => e.stopPropagation()}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                >
                                                    {QUICK_MINUTES.map((m) => (
                                                        <button
                                                            key={m}
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                updateBlock(b.id, { minutes: m });
                                                            }}
                                                            className={`px-2.5 py-1.5 rounded-full border ${subtleBorder} text-[11px] font-inter ${softBg}`}
                                                        >
                                                            {m}m
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {draggingId && (
                                        <div
                                            className={`relative h-10 rounded-[14px] border border-dashed ${subtleBorder} ${softBg}`}
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                updateAutoScrollFromClientY(e.clientY);
                                                if (dragOverId !== END_DROP_ID) setDragOverId(END_DROP_ID);
                                                if (dropEdge !== "after") setDropEdge("after");
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault();

                                                const dragIdFromData = (() => {
                                                    try {
                                                        return e.dataTransfer.getData("text/plain") || "";
                                                    } catch {
                                                        return "";
                                                    }
                                                })();

                                                const dragId = draggingId || dragIdFromData;
                                                if (dragId) moveBlockTo(dragId, END_DROP_ID, "after");

                                                setDraggingId(null);
                                                setDragOverId(null);
                                                setDropEdge("after");
                                                stopAutoScrollLoop();
                                            }}
                                        >
                                            {dragOverId === END_DROP_ID && (
                                                <div
                                                    className={`pointer-events-none absolute left-3 right-3 top-1/2 -translate-y-1/2 h-[3px] rounded-full ${isLight ? "bg-black/70" : "bg-white/70"
                                                        }`}
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div
                    className={`px-4 sm:px-6 py-4 border-t ${subtleBorder} flex items-center justify-between gap-3`}
                >
                    <div className={`font-inter text-[12px] ${mutedText}`}>
                        Timeline editing is available only inside the room.
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            className={`px-4 py-2.5 rounded-xl border ${subtleBorder} ${softBg} text-[13px] font-semibold disabled:opacity-50`}
                        >
                            Cancel
                        </button>

                        <button
                            type="button"
                            onClick={onSave}
                            disabled={saving || blocks.length === 0}
                            className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-50 ${isLight
                                ? "bg-blue-600 hover:bg-blue-700 text-white"
                                : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                                }`}
                        >
                            {saving ? "Saving..." : "Save timeline"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}