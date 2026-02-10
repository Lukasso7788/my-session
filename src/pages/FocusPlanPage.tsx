// src/pages/FocusPlanPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import {
    Plus,
    Trash2,
    Check,
    ExternalLink,
    Link as LinkIcon,
} from "lucide-react";

type FocusPlanItem = {
    id: string;
    text: string;
    targetDate: string; // YYYY-MM-DD or ""
    sessionRef: string; // uuid | slug | full link
    done: boolean;
    attached: boolean; // whether we already created intention in DB for session
    lastAttachError?: string;
};

type FocusPlan = {
    id: string;
    title: string;
    createdAt: string;
    items: FocusPlanItem[];
};

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uid(prefix = "id") {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeParse<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function extractSessionRef(input: string) {
    const s = (input || "").trim();
    if (!s) return "";

    // If user pasted full URL, try to parse /room-iframe/:id or /room/:id
    try {
        if (s.startsWith("http://") || s.startsWith("https://")) {
            const u = new URL(s);
            const parts = u.pathname.split("/").filter(Boolean);
            // room-iframe/:id OR room/:id
            const idx = parts.findIndex((p) => p === "room-iframe" || p === "room");
            if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
            // maybe sessions/:id
            const idx2 = parts.findIndex((p) => p === "sessions");
            if (idx2 >= 0 && parts[idx2 + 1]) return parts[idx2 + 1];
            return s;
        }
    } catch {
        // ignore
    }

    return s;
}

async function resolveSessionUuid(sessionRef: string): Promise<string | null> {
    const raw = (sessionRef || "").trim();
    if (!raw) return null;

    if (UUID_RE.test(raw)) return raw;

    // treat as slug (lowercased)
    const slug = raw.toLowerCase();

    const { data, error } = await supabase
        .from("sessions")
        .select("id")
        .eq("custom_slug", slug)
        .single();

    if (!error && data?.id) return String(data.id);
    return null;
}

export default function FocusPlanPage() {
    const { user } = useAuth();
    const location = useLocation();

    const qsSessionRef = useMemo(() => {
        const p = new URLSearchParams(location.search);
        const v = p.get("sessionId") || p.get("session") || "";
        return v.trim();
    }, [location.search]);

    const storageKey = useMemo(() => {
        const uidPart = user?.id || "anon";
        return `mysession_focus_plans_v1_${uidPart}`;
    }, [user?.id]);

    const [plans, setPlans] = useState<FocusPlan[]>([]);
    const [activePlanId, setActivePlanId] = useState<string | null>(null);

    const [newPlanTitle, setNewPlanTitle] = useState("");
    const [newItemText, setNewItemText] = useState("");

    // Load from localStorage
    useEffect(() => {
        const loaded = safeParse<FocusPlan[]>(localStorage.getItem(storageKey), []);
        setPlans(Array.isArray(loaded) ? loaded : []);
        setActivePlanId((prev) => prev || (loaded?.[0]?.id ?? null));
    }, [storageKey]);

    // Persist
    useEffect(() => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(plans));
        } catch {
            // ignore
        }
    }, [plans, storageKey]);

    const activePlan = useMemo(
        () => plans.find((p) => p.id === activePlanId) || null,
        [plans, activePlanId]
    );

    const createPlan = () => {
        const title = newPlanTitle.trim() || "My plan";
        const p: FocusPlan = {
            id: uid("plan"),
            title,
            createdAt: new Date().toISOString(),
            items: [],
        };
        setPlans((prev) => [p, ...prev]);
        setActivePlanId(p.id);
        setNewPlanTitle("");
    };

    const renameActivePlan = (title: string) => {
        if (!activePlan) return;
        setPlans((prev) =>
            prev.map((p) => (p.id === activePlan.id ? { ...p, title } : p))
        );
    };

    const deletePlan = (id: string) => {
        setPlans((prev) => prev.filter((p) => p.id !== id));
        setActivePlanId((prev) => (prev === id ? null : prev));
    };

    const addItem = () => {
        if (!activePlan) return;
        const text = newItemText.trim();
        if (!text) return;

        const it: FocusPlanItem = {
            id: uid("item"),
            text,
            targetDate: "",
            sessionRef: qsSessionRef ? extractSessionRef(qsSessionRef) : "",
            done: false,
            attached: false,
        };

        setPlans((prev) =>
            prev.map((p) =>
                p.id === activePlan.id ? { ...p, items: [it, ...p.items] } : p
            )
        );
        setNewItemText("");
    };

    const updateItem = (itemId: string, patch: Partial<FocusPlanItem>) => {
        if (!activePlan) return;
        setPlans((prev) =>
            prev.map((p) => {
                if (p.id !== activePlan.id) return p;
                return {
                    ...p,
                    items: p.items.map((it) =>
                        it.id === itemId ? { ...it, ...patch } : it
                    ),
                };
            })
        );
    };

    const removeItem = (itemId: string) => {
        if (!activePlan) return;
        setPlans((prev) =>
            prev.map((p) =>
                p.id === activePlan.id
                    ? { ...p, items: p.items.filter((it) => it.id !== itemId) }
                    : p
            )
        );
    };

    const attachItemToSession = async (it: FocusPlanItem) => {
        if (!user?.id) {
            updateItem(it.id, { lastAttachError: "Please log in to attach intentions." });
            return;
        }

        const sessionRef = extractSessionRef(it.sessionRef);
        if (!sessionRef) {
            updateItem(it.id, { lastAttachError: "Add session link / slug / UUID first." });
            return;
        }

        updateItem(it.id, { lastAttachError: "" });

        const sessionUuid = await resolveSessionUuid(sessionRef);
        if (!sessionUuid) {
            updateItem(it.id, { lastAttachError: "Session not found (bad slug/UUID)." });
            return;
        }

        // Create intention in DB (this is what makes IntentionsPanel show it)
        const { error } = await supabase.from("intentions").insert([
            {
                user_id: user.id,
                session_id: sessionUuid,
                text: it.text.trim(),
                completed: Boolean(it.done),
            },
        ]);

        if (error) {
            updateItem(it.id, { lastAttachError: "Failed to attach. Try again." });
            return;
        }

        updateItem(it.id, { attached: true, lastAttachError: "" });
    };

    const openSession = (sessionRef: string) => {
        const ref = extractSessionRef(sessionRef);
        if (!ref) return;

        // If it’s already full link — open it
        if (sessionRef.startsWith("http://") || sessionRef.startsWith("https://")) {
            window.open(sessionRef, "_blank", "noopener,noreferrer");
            return;
        }

        // Try room-iframe first (you can swap to /room/ if needed)
        window.open(`/room-iframe/${ref}`, "_blank", "noopener,noreferrer");
    };

    return (
        <div className="w-full px-5 md:px-8 py-8">
            <div className="max-w-6xl mx-auto">
                {/* Top title */}
                <div className="mb-6">
                    <div className="text-2xl md:text-3xl font-extrabold text-brandBlack">
                        Focus plan
                    </div>
                    <div className="text-sm text-black/50 mt-1">
                        Make a plan → attach items to sessions → open the room and execute.
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left: Plans list */}
                    <div className="lg:col-span-4">
                        <div className="bg-white border border-borderGray rounded-2xl p-5">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-base font-semibold text-brandBlack">Plans</div>
                                <button
                                    onClick={createPlan}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-borderGray hover:bg-slate-50 text-sm"
                                    type="button"
                                    title="Create plan"
                                >
                                    <Plus size={16} />
                                    Create
                                </button>
                            </div>

                            <div className="mt-4 flex items-center gap-2">
                                <input
                                    value={newPlanTitle}
                                    onChange={(e) => setNewPlanTitle(e.target.value)}
                                    placeholder="Plan title…"
                                    className="flex-1 px-4 py-2 rounded-full border border-borderGray text-sm outline-none focus:ring-1 focus:ring-black/20"
                                />
                            </div>

                            <div className="mt-4 flex flex-col gap-2">
                                {plans.length === 0 ? (
                                    <div className="text-sm text-black/45 italic">
                                        No plans yet. Create your first one.
                                    </div>
                                ) : (
                                    plans.map((p) => {
                                        const active = p.id === activePlanId;
                                        return (
                                            <button
                                                key={p.id}
                                                onClick={() => setActivePlanId(p.id)}
                                                className={[
                                                    "w-full text-left px-4 py-3 rounded-2xl border transition",
                                                    active
                                                        ? "border-black/20 bg-black/[0.03]"
                                                        : "border-borderGray hover:bg-slate-50",
                                                ].join(" ")}
                                                type="button"
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="font-semibold text-brandBlack truncate">
                                                            {p.title}
                                                        </div>
                                                        <div className="text-xs text-black/45 mt-0.5">
                                                            {p.items.length} items
                                                        </div>
                                                    </div>

                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            deletePlan(p.id);
                                                        }}
                                                        className="p-2 rounded-xl hover:bg-black/5"
                                                        type="button"
                                                        title="Delete plan"
                                                    >
                                                        <Trash2 size={16} className="text-black/50" />
                                                    </button>
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right: Active plan editor */}
                    <div className="lg:col-span-8">
                        <div className="bg-white border border-borderGray rounded-2xl p-6">
                            {!activePlan ? (
                                <div className="text-sm text-black/45 italic">
                                    Select a plan to edit.
                                </div>
                            ) : (
                                <>
                                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm text-black/50">Plan</div>
                                            <input
                                                value={activePlan.title}
                                                onChange={(e) => renameActivePlan(e.target.value)}
                                                className="w-full text-xl font-extrabold text-brandBlack outline-none border-b border-transparent focus:border-black/10 py-1"
                                            />
                                        </div>
                                    </div>

                                    {/* Add item */}
                                    <div className="mt-6 flex flex-col md:flex-row gap-3">
                                        <input
                                            value={newItemText}
                                            onChange={(e) => setNewItemText(e.target.value)}
                                            onKeyDown={(e) => e.key === "Enter" && addItem()}
                                            placeholder="Add intention (e.g. Ship pricing page)…"
                                            className="flex-1 px-5 py-3 rounded-full border border-borderGray text-sm outline-none focus:ring-1 focus:ring-black/20"
                                        />
                                        <button
                                            onClick={addItem}
                                            className="px-6 py-3 rounded-full bg-brandBlack text-white text-sm font-medium hover:opacity-95"
                                            type="button"
                                        >
                                            Add
                                        </button>
                                    </div>

                                    {/* Items */}
                                    <div className="mt-6 flex flex-col gap-3">
                                        {activePlan.items.length === 0 ? (
                                            <div className="text-sm text-black/45 italic">
                                                No items yet. Add your first intention above.
                                            </div>
                                        ) : (
                                            activePlan.items.map((it) => {
                                                const rowBg = "bg-white";
                                                return (
                                                    <div
                                                        key={it.id}
                                                        className={[
                                                            "border border-borderGray rounded-2xl p-4",
                                                            rowBg,
                                                        ].join(" ")}
                                                    >
                                                        <div className="flex flex-col gap-3">
                                                            {/* top row */}
                                                            <div className="flex items-start gap-3">
                                                                <button
                                                                    onClick={() => updateItem(it.id, { done: !it.done })}
                                                                    className="mt-0.5 w-9 h-9 rounded-xl border border-borderGray hover:bg-slate-50 flex items-center justify-center"
                                                                    type="button"
                                                                    title="Done"
                                                                >
                                                                    <Check
                                                                        size={18}
                                                                        className={it.done ? "text-emerald-600" : "text-black/30"}
                                                                    />
                                                                </button>

                                                                <div className="flex-1 min-w-0">
                                                                    <input
                                                                        value={it.text}
                                                                        onChange={(e) => updateItem(it.id, { text: e.target.value, attached: false })}
                                                                        className={[
                                                                            "w-full text-base font-semibold outline-none",
                                                                            it.done ? "text-black/35 line-through" : "text-brandBlack",
                                                                        ].join(" ")}
                                                                    />
                                                                    <div className="text-xs text-black/45 mt-1 flex items-center gap-2">
                                                                        {it.attached ? (
                                                                            <span className="inline-flex items-center gap-1 text-emerald-700">
                                                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                                                                                Attached to session
                                                                            </span>
                                                                        ) : (
                                                                            <span className="inline-flex items-center gap-1">
                                                                                <span className="w-1.5 h-1.5 rounded-full bg-black/20" />
                                                                                Not attached
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                <button
                                                                    onClick={() => removeItem(it.id)}
                                                                    className="w-9 h-9 rounded-xl border border-borderGray hover:bg-slate-50 flex items-center justify-center"
                                                                    type="button"
                                                                    title="Remove"
                                                                >
                                                                    <Trash2 size={16} className="text-black/50" />
                                                                </button>
                                                            </div>

                                                            {/* controls row */}
                                                            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                                                                <div className="md:col-span-4">
                                                                    <div className="text-xs text-black/50 mb-1">Target date</div>
                                                                    <input
                                                                        type="date"
                                                                        value={it.targetDate}
                                                                        onChange={(e) => updateItem(it.id, { targetDate: e.target.value })}
                                                                        className="w-full px-4 py-2.5 rounded-2xl border border-borderGray text-sm outline-none focus:ring-1 focus:ring-black/20"
                                                                    />
                                                                </div>

                                                                <div className="md:col-span-8">
                                                                    <div className="text-xs text-black/50 mb-1">Session link / slug / UUID</div>
                                                                    <div className="flex gap-2">
                                                                        <div className="flex-1 relative">
                                                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-black/30">
                                                                                <LinkIcon size={16} />
                                                                            </span>
                                                                            <input
                                                                                value={it.sessionRef}
                                                                                onChange={(e) =>
                                                                                    updateItem(it.id, {
                                                                                        sessionRef: e.target.value,
                                                                                        attached: false,
                                                                                    })
                                                                                }
                                                                                placeholder="Paste /room-iframe/... or slug or UUID"
                                                                                className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-borderGray text-sm outline-none focus:ring-1 focus:ring-black/20"
                                                                            />
                                                                        </div>

                                                                        <button
                                                                            onClick={() => attachItemToSession(it)}
                                                                            className="px-4 py-2.5 rounded-2xl border border-borderGray hover:bg-slate-50 text-sm font-medium"
                                                                            type="button"
                                                                            title="Attach to session"
                                                                        >
                                                                            Attach
                                                                        </button>

                                                                        <button
                                                                            onClick={() => openSession(it.sessionRef)}
                                                                            className="px-4 py-2.5 rounded-2xl border border-borderGray hover:bg-slate-50 text-sm font-medium inline-flex items-center gap-2"
                                                                            type="button"
                                                                            title="Open session"
                                                                        >
                                                                            <ExternalLink size={16} />
                                                                            Open
                                                                        </button>
                                                                    </div>

                                                                    {it.lastAttachError ? (
                                                                        <div className="text-xs text-red-600 mt-2">
                                                                            {it.lastAttachError}
                                                                        </div>
                                                                    ) : null}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>

                                    {/* Small footer note */}
                                    <div className="mt-6 text-xs text-black/40">
                                        Tip: when you attach an item, it becomes a real intention inside that session — so the room panel will show it automatically.
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* tiny dev hint */}
                {DEBUG ? (
                    <div className="max-w-6xl mx-auto mt-6 text-xs text-black/30">
                        FocusPlanPage (localStorage MVP) — user: {user?.id ? "logged in" : "guest"}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
