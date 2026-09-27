// Pure timeline data and serialization. Keep the editor UI out of room entry.
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
    color?: string;
};

export const DEFAULT_CUSTOM_BLOCK_COLOR = "#F63135";

function isValidHexColor(v: unknown) {
    return /^#[0-9a-f]{6}$/i.test(String(v || "").trim());
}

export function getDefaultBlockColor(kind: RoomTimelineBlockKind) {
    switch (kind) {
        case "welcome":
            return "#80DF86";
        case "intentions":
            return "#ADD3FF";
        case "focus":
            return "#4CA0FF";
        case "break":
            return "#FDA4AF";
        case "checkin":
            return "#ADD3FF";
        case "recap":
            return "#A78BFA";
        case "celebrate":
            return "#F472B6";
        case "outro":
            return "#6EE7B7";
        case "custom":
        default:
            return DEFAULT_CUSTOM_BLOCK_COLOR;
    }
}

function getRawBlockColor(raw: any) {
    return String(
        raw?.color ??
        raw?.colour ??
        raw?.bgColor ??
        raw?.backgroundColor ??
        raw?.background ??
        raw?.stageColor ??
        raw?.stage_color ??
        ""
    ).trim();
}

export function getBlockColor(block: Pick<RoomTimelineBlock, "kind" | "color">) {
    const raw = String(block.color || "").trim();
    return isValidHexColor(raw) ? raw : getDefaultBlockColor(block.kind);
}

export function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

export function uid() {
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
): { name: string; seconds: number; kind?: string; note?: string; color?: string }[] {
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
                const color = getRawBlockColor(p) || undefined;
                const seconds = toSeconds(p);
                return { name, seconds, kind, note, color };
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

                const color =
                    typeof v === "object" ? getRawBlockColor(v) || undefined : undefined;

                return { name: String(k || ""), seconds, kind, note, color };
            })
            .filter((x) => x.seconds > 0);
    }

    return [];
}

export function normalizeBlockKind(raw: any): RoomTimelineBlockKind {
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

export function defaultTitleForKind(kind: RoomTimelineBlockKind) {
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

                const rawColor = getRawBlockColor(b);

                return {
                    id: uid(),
                    kind,
                    title,
                    minutes,
                    note: String(b?.note || b?.description || "").trim() || undefined,
                    color: isValidHexColor(rawColor) ? rawColor : getDefaultBlockColor(kind),
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
                color: isValidHexColor(p?.color) ? p.color : getDefaultBlockColor(kind),
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

            const color = getBlockColor({ kind, color: b.color });

            return {
                kind,
                type: kind,
                title,
                name: title,
                minutes,
                note: String(b.note || "").trim() || null,
                color,
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
                    color: b.color,
                    order: index,
                    v: 1,
                })),
            },
            v: 1,
        };
    }

    return cleaned;
}

export type FreeFlowTimelinePreset = {
    id: string;
    name: string;
    description: string;
    emoji: string;
    sessionTitle: string;
    sessionDescription: string;
    blocks: Omit<RoomTimelineBlock, "id">[];
};

const FREE_FLOW_GOAL_SETTING: Omit<RoomTimelineBlock, "id"> = {
    kind: "checkin",
    title: "Goal setting",
    minutes: 2,
    note: "Set a clear goal before the first focus block",
};

export const FREE_FLOW_TIMELINE_PRESETS: FreeFlowTimelinePreset[] = [
    {
        id: "ladder",
        name: "Ladder",
        description: "Focus blocks gradually grow from 10 to 25 minutes.",
        emoji: "📈",
        sessionTitle: "📈 Ladder · 10→25 min focus - 24/7",
        sessionDescription: "Start with 2 minutes of goal setting. Focus for 10, 15, 20 and 25 minutes, with 2-minute check-ins between blocks, then take a 10-minute break. The structure repeats.",
        blocks: [
            FREE_FLOW_GOAL_SETTING,
            { kind: "focus", title: "Focus", minutes: 10, note: "Start with a quick focused win" },
            { kind: "checkin", title: "Check-in", minutes: 2, note: "Share progress and reset" },
            { kind: "focus", title: "Focus", minutes: 15, note: "Continue with the next clear step" },
            { kind: "checkin", title: "Check-in", minutes: 2, note: "Short progress check" },
            { kind: "focus", title: "Focus", minutes: 20, note: "Settle into deeper work" },
            { kind: "checkin", title: "Check-in", minutes: 2, note: "Share progress and adjust" },
            { kind: "focus", title: "Focus", minutes: 25, note: "Finish with the longest focus block" },
            { kind: "break", title: "Break", minutes: 10, note: "Recharge and wrap up" },
        ],
    },
    {
        id: "30-10",
        name: "30/10",
        description: "A balanced focus block with a proper reset.",
        emoji: "⏱️",
        sessionTitle: "⏱️ 30/10 · Focus / Break - 24/7",
        sessionDescription: "Set a goal for 2 minutes, focus for 30 minutes, then take a 10-minute break. The structure repeats.",
        blocks: [
            FREE_FLOW_GOAL_SETTING,
            { kind: "focus", title: "Focus", minutes: 30, note: "One clear focused outcome" },
            { kind: "break", title: "Break", minutes: 10, note: "Step away and recharge" },
        ],
    },
    {
        id: "75-15",
        name: "75/15",
        description: "A long deep-work block followed by recovery.",
        emoji: "⚡",
        sessionTitle: "⚡ 75/15 · Deep Focus / Break - 24/7",
        sessionDescription: "Set a goal for 2 minutes, do 75 minutes of uninterrupted deep work, then take a 15-minute recovery break. The structure repeats.",
        blocks: [
            FREE_FLOW_GOAL_SETTING,
            { kind: "focus", title: "Deep focus", minutes: 75, note: "Protect one substantial work block" },
            { kind: "break", title: "Break", minutes: 15, note: "Recover after deep work" },
        ],
    },
    {
        id: "sprint-stack",
        name: "Sprint stack",
        description: "Two short sprints with a quick accountability reset.",
        emoji: "🚀",
        sessionTitle: "🚀 Sprint Stack · 2×25 min focus - 24/7",
        sessionDescription: "Set a goal for 2 minutes, complete a 25-minute focus sprint, check in for 2 minutes, then do another 25-minute sprint and take an 8-minute break. The structure repeats.",
        blocks: [
            FREE_FLOW_GOAL_SETTING,
            { kind: "focus", title: "Focus", minutes: 25, note: "Complete the first sprint" },
            { kind: "checkin", title: "Check-in", minutes: 2, note: "Reset the next target" },
            { kind: "focus", title: "Focus", minutes: 25, note: "Complete the second sprint" },
            { kind: "break", title: "Break", minutes: 8, note: "Recharge and wrap up" },
        ],
    },
    {
        id: "deep-arc",
        name: "Deep arc",
        description: "Build into a longer uninterrupted deep-work finish.",
        emoji: "🌊",
        sessionTitle: "🌊 Deep Arc · 45→60 min focus - 24/7",
        sessionDescription: "Set a goal for 2 minutes, focus for 45 minutes, check in for 3 minutes, then finish with 60 minutes of deep work and a 15-minute break. The structure repeats.",
        blocks: [
            FREE_FLOW_GOAL_SETTING,
            { kind: "focus", title: "Focus", minutes: 45, note: "Build momentum" },
            { kind: "checkin", title: "Check-in", minutes: 3, note: "Review and choose the finish" },
            { kind: "focus", title: "Deep focus", minutes: 60, note: "Finish with uninterrupted deep work" },
            { kind: "break", title: "Break", minutes: 15, note: "Recover and close" },
        ],
    },
];

export function makeFreeFlowTimelineBlocks(presetId = "ladder"): RoomTimelineBlock[] {
    const block = (kind: RoomTimelineBlockKind, title: string, minutes: number, note: string): RoomTimelineBlock => ({
        id: uid(),
        kind,
        title,
        minutes,
        note,
    });

    const preset = FREE_FLOW_TIMELINE_PRESETS.find((item) => item.id === presetId)
        || FREE_FLOW_TIMELINE_PRESETS[0];
    return preset.blocks.map((item) =>
        block(item.kind, item.title, item.minutes, item.note || "")
    );
}
