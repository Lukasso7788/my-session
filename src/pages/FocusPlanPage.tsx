import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
    BarChart3,
    CalendarDays,
    Check,
    CheckCircle2,
    ClipboardList,
    ListPlus,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    SlidersHorizontal,
    TimerReset,
    Trash2,
    X,
} from "lucide-react";
import {
    loadEligibleTaskSessions,
    type TaskSessionOption,
} from "../lib/taskSessionEligibility";

type FocusPlan = {
    id: string;
    user_id: string;
    title: string;
    created_at: string;
    updated_at: string;
};

type FocusPlanItem = {
    id: string;
    plan_id: string;
    user_id: string;
    text: string;
    target_date: string | null; // YYYY-MM-DD
    session_id: string | null;
    created_at: string;
    completed: boolean;
    sort_order: number;
};

type SessionLite = TaskSessionOption;

type TaskTimeMeasurement = {
    id: string;
    user_id: string;
    session_id: string | null;
    session_intention_id: string | null;
    focus_plan_item_id: string | null;
    task_text: string;
    elapsed_ms: number;
    saved_at: string;
};

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TASK_TIME_MEASUREMENTS_STORAGE_PREFIX = "mysession_task_time_measurements_v1";

function makeTaskTimeMeasurementsStorageKey(userId: string | null | undefined) {
    const uid = String(userId || "anon").trim().toLowerCase() || "anon";
    return `${TASK_TIME_MEASUREMENTS_STORAGE_PREFIX}:${uid}`;
}

function readTaskTimeMeasurements(storageKey: string): TaskTimeMeasurement[] {
    if (!storageKey || typeof window === "undefined") return [];

    try {
        const raw = window.localStorage.getItem(storageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map((item: any) => ({
                id: String(item?.id || ""),
                user_id: String(item?.user_id || ""),
                session_id: item?.session_id ? String(item.session_id) : null,
                session_intention_id: item?.session_intention_id ? String(item.session_intention_id) : null,
                focus_plan_item_id: item?.focus_plan_item_id ? String(item.focus_plan_item_id) : null,
                task_text: String(item?.task_text || "").trim(),
                elapsed_ms: Math.max(0, Math.round(Number(item?.elapsed_ms || 0))),
                saved_at: String(item?.saved_at || ""),
            }))
            .filter((item) => item.id && item.task_text && item.elapsed_ms > 0)
            .slice(0, 500);
    } catch {
        return [];
    }
}

function normalizeTaskText(x: unknown) {
    return String(x || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function fmtDuration(ms: number) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function safeLower(x: any) {
    return String(x || "").toLowerCase();
}

function safeTrim(x: any) {
    return String(x || "").trim();
}

function fmtWhen(iso?: string | null) {
    if (!iso) return "";
    const ms = Date.parse(String(iso));
    if (!Number.isFinite(ms)) return "";
    try {
        return new Date(ms).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return "";
    }
}

function fmtTaskRowDate(targetDate?: string | null, createdAt?: string | null) {
    try {
        if (targetDate) {
            const dueMs = Date.parse(`${targetDate}T00:00:00`);
            if (Number.isFinite(dueMs)) {
                return new Date(dueMs).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                });
            }
        }

        if (createdAt) {
            const createdMs = Date.parse(createdAt);
            if (Number.isFinite(createdMs)) {
                return new Date(createdMs).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                });
            }
        }
    } catch {
        // fall through
    }
    return "—";
}

function TasksPageMaskIcon({
    src,
    fallback,
    size = 14,
    className = "",
}: {
    src: string;
    fallback: ReactNode;
    size?: number;
    className?: string;
}) {
    const [available, setAvailable] = useState(false);

    useEffect(() => {
        let active = true;
        const image = new Image();
        image.onload = () => active && setAvailable(true);
        image.onerror = () => active && setAvailable(false);
        image.src = src;
        return () => {
            active = false;
        };
    }, [src]);

    if (!available) return <>{fallback}</>;

    return (
        <span
            aria-hidden="true"
            className={`inline-block shrink-0 bg-current ${className}`}
            style={{
                width: size,
                height: size,
                WebkitMaskImage: `url(${src})`,
                maskImage: `url(${src})`,
                WebkitMaskPosition: "center",
                maskPosition: "center",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskSize: "contain",
                maskSize: "contain",
            }}
        />
    );
}

function planEmoji(title: string, index: number) {
    const lower = safeLower(title);
    if (lower.includes("plan")) return "📋";
    if (lower.includes("pool")) return "📚";
    if (lower.includes("market")) return "🌐";
    if (lower.includes("essential")) return "🟡";
    const fallbacks = ["🗂️", "🎯", "📌", "🧩", "📝"];
    return fallbacks[index % fallbacks.length];
}

function buildLoginNext(urlPath: string) {
    const next = urlPath || "/sessions";
    return `/login?next=${encodeURIComponent(next)}`;
}

export default function FocusPlanPage() {
    const navigate = useNavigate();
    const [sp, setSp] = useSearchParams();

    // optional: deep-link from room: /tasks?sessionId=...
    const initialParam = (sp.get("sessionId") || "").trim();

    const [user, setUser] = useState<any>(null);

    // sessions
    const [sessions, setSessions] = useState<SessionLite[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(true);
    const eligibleSessionIds = useMemo(
        () => new Set(sessions.map((session) => String(session.id))),
        [sessions],
    );

    // default session for "new item" (raw may be uuid or slug)
    const [rawDefaultSession] = useState<string>(initialParam);
    const [defaultSessionId, setDefaultSessionId] = useState<string | null>(null);

    const [taskMeasurements, setTaskMeasurements] = useState<TaskTimeMeasurement[]>([]);
    const [activeTab, setActiveTab] = useState<"plan" | "measurements">("plan");
    const [measurementsLoading, setMeasurementsLoading] = useState(false);
    const [measurementsError, setMeasurementsError] = useState<string | null>(null);
    const [measurementsRefreshNonce, setMeasurementsRefreshNonce] = useState(0);

    // plans + items (Supabase)
    const [plans, setPlans] = useState<FocusPlan[]>([]);
    const [plansLoading, setPlansLoading] = useState(false);
    const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

    // redesigned Tasks page view state
    const [activeListId, setActiveListId] = useState<string>("all");
    const [taskSearch, setTaskSearch] = useState("");
    const [dueSortDescending, setDueSortDescending] = useState(false);
    const [showNewListInput, setShowNewListInput] = useState(false);
    const [sessionPickerItemId, setSessionPickerItemId] = useState<string | null>(null);
    const [sessionPickerValue, setSessionPickerValue] = useState("");
    const quickAddInputRef = useRef<HTMLInputElement | null>(null);

    const [items, setItems] = useState<FocusPlanItem[]>([]);
    const [itemsLoading, setItemsLoading] = useState(false);

    // plan create/rename
    const [newPlanTitle, setNewPlanTitle] = useState("");
    const [editingPlanTitle, setEditingPlanTitle] = useState(false);
    const [planTitleDraft, setPlanTitleDraft] = useState("");

    // item add form
    const [newItemText, setNewItemText] = useState("");
    const [newItemDueDate, setNewItemDueDate] = useState(""); // YYYY-MM-DD
    const [newItemSessionId, setNewItemSessionId] = useState<string>("");

    // item edit
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [editingItemText, setEditingItemText] = useState("");
    const [editingItemDueDate, setEditingItemDueDate] = useState("");
    const [editingItemSessionId, setEditingItemSessionId] = useState<string>("");

    // attach loading
    const [attachingItemId, setAttachingItemId] = useState<string | null>(null);
    const [attachedItemIds, setAttachedItemIds] = useState<Record<string, boolean>>({});

    // ===== auth =====
    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUser(data.user || null));

        const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
            setUser(session?.user || null);
        });

        return () => {
            sub.subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!user?.id) {
            setTaskMeasurements([]);
            setMeasurementsError(null);
            return;
        }

        let cancelled = false;
        const storageKey = makeTaskTimeMeasurementsStorageKey(user.id);

        const refresh = async () => {
            setMeasurementsLoading(true);
            setMeasurementsError(null);

            const localRows = readTaskTimeMeasurements(storageKey);

            try {
                const { data, error } = await supabase
                    .from("task_time_measurements")
                    .select("id,user_id,session_id,session_intention_id,focus_plan_item_id,task_text,elapsed_ms,saved_at")
                    .eq("user_id", user.id)
                    .order("saved_at", { ascending: false })
                    .limit(500);

                if (cancelled) return;
                if (error) throw error;

                const remoteRows = Array.isArray(data) ? (data as TaskTimeMeasurement[]) : [];
                const merged = new Map<string, TaskTimeMeasurement>();

                [...remoteRows, ...localRows].forEach((row) => {
                    const key = String(row.id || `${row.saved_at}:${row.task_text}:${row.elapsed_ms}`);
                    if (!merged.has(key)) merged.set(key, row);
                });

                setTaskMeasurements(
                    Array.from(merged.values())
                        .filter((row) => Number(row.elapsed_ms || 0) > 0)
                        .sort((a, b) => Date.parse(b.saved_at || "") - Date.parse(a.saved_at || ""))
                        .slice(0, 500),
                );
            } catch (error: any) {
                if (cancelled) return;
                setTaskMeasurements(localRows);
                setMeasurementsError(
                    String(error?.message || "Measurements are currently available only on this device."),
                );
            } finally {
                if (!cancelled) setMeasurementsLoading(false);
            }
        };

        void refresh();

        const onStorage = (event: StorageEvent) => {
            if (event.key === storageKey) void refresh();
        };
        const onMeasurements = () => void refresh();

        window.addEventListener("storage", onStorage);
        window.addEventListener("mysession:task-time-measurements-updated", onMeasurements);

        return () => {
            cancelled = true;
            window.removeEventListener("storage", onStorage);
            window.removeEventListener("mysession:task-time-measurements-updated", onMeasurements);
        };
    }, [user?.id, measurementsRefreshNonce]);

    // ===== sessions list =====
    useEffect(() => {
        let cancelled = false;

        (async () => {
            setSessionsLoading(true);
            if (!user?.id) {
                if (!cancelled) {
                    setSessions([]);
                    setSessionsLoading(false);
                }
                return;
            }
            try {
                const data = await loadEligibleTaskSessions(user.id);
                if (!cancelled) setSessions(data);
            } catch {
                if (!cancelled) setSessions([]);
            } finally {
                if (!cancelled) setSessionsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [user?.id]);

    // resolve default session uuid from uuid/slug
    useEffect(() => {
        let cancelled = false;

        (async () => {
            const raw = String(rawDefaultSession || "").trim();
            if (!raw) {
                if (!cancelled) setDefaultSessionId(null);
                return;
            }

            if (UUID_RE.test(raw)) {
                if (!cancelled) setDefaultSessionId(eligibleSessionIds.has(raw) ? raw : null);
                return;
            }

            const slug = raw.toLowerCase();

            const fromList = sessions.find((s) => safeLower(s.custom_slug) === slug);
            if (fromList?.id) {
                if (!cancelled) setDefaultSessionId(String(fromList.id));
                return;
            }

            if (!cancelled) setDefaultSessionId(null);
        })();

        return () => {
            cancelled = true;
        };
    }, [rawDefaultSession, sessions, eligibleSessionIds]);

    // keep query param in sync (nice UX)
    useEffect(() => {
        const raw = String(rawDefaultSession || "").trim();
        if (!raw) return;
        const cur = (sp.get("sessionId") || "").trim();
        if (cur === raw) return;

        sp.set("sessionId", raw);
        setSp(sp, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawDefaultSession]);

    // default session flows into "new item"
    useEffect(() => {
        if (!defaultSessionId) return;
        if (newItemSessionId) return;
        setNewItemSessionId(defaultSessionId);
    }, [defaultSessionId, newItemSessionId]);

    // ===== auth guard =====
    const requireAuth = () => {
        if (user?.id) return true;
        navigate(buildLoginNext("/tasks"));
        return false;
    };

    // ===== plans (Supabase) =====
    const reloadPlans = async () => {
        if (!user?.id) return;

        setPlansLoading(true);
        try {
            const { data, error } = await supabase
                .from("focus_plans")
                .select("*")
                .eq("user_id", user.id)
                .order("updated_at", { ascending: false });

            if (error || !Array.isArray(data)) {
                setPlans([]);
                setSelectedPlanId(null);
                return;
            }

            const p = data as FocusPlan[];
            setPlans(p);

            if (!selectedPlanId) setSelectedPlanId(p[0]?.id || null);
            else if (p.length && !p.some((x) => x.id === selectedPlanId)) setSelectedPlanId(p[0]?.id || null);
        } catch {
            setPlans([]);
            setSelectedPlanId(null);
        } finally {
            setPlansLoading(false);
        }
    };

    useEffect(() => {
        if (!user?.id) return;
        reloadPlans();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    const selectedPlan = useMemo(() => {
        if (!selectedPlanId) return null;
        return plans.find((p) => p.id === selectedPlanId) || null;
    }, [plans, selectedPlanId]);

    // items load for selected plan
    const reloadItems = async (_planId: string) => {
        if (!user?.id) return;

        setItemsLoading(true);
        try {
            const { data, error } = await supabase
                .from("focus_plan_items")
                .select("*")
                .eq("user_id", user.id)
                .order("sort_order", { ascending: true })
                .order("created_at", { ascending: false });

            if (error || !Array.isArray(data)) {
                setItems([]);
                setAttachedItemIds({});
                return;
            }

            setItems(data as FocusPlanItem[]);
            setAttachedItemIds({}); // UI-only
        } catch {
            setItems([]);
            setAttachedItemIds({});
        } finally {
            setItemsLoading(false);
        }
    };

    useEffect(() => {
        if (!user?.id) return;
        if (!selectedPlanId) {
            setItems([]);
            return;
        }
        reloadItems(selectedPlanId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, selectedPlanId]);

    // ===== plan actions =====
    const createPlan = async () => {
        if (!requireAuth()) return;

        const t = newPlanTitle.trim();
        if (!t) return;

        try {
            const { data, error } = await supabase
                .from("focus_plans")
                .insert({ user_id: user.id, title: t })
                .select("*")
                .single();

            if (error || !data) return;

            setNewPlanTitle("");
            setEditingPlanTitle(false);

            await reloadPlans();
            setSelectedPlanId((data as FocusPlan).id);
            setActiveListId((data as FocusPlan).id);
            setShowNewListInput(false);
        } catch {
            // silent MVP
        }
    };

    const deletePlan = async (id: string) => {
        if (!requireAuth()) return;
        try {
            const { error } = await supabase.from("focus_plans").delete().eq("id", id).eq("user_id", user.id);
            if (error) return;
            await reloadPlans();
        } catch {
            // silent
        } finally {
            setEditingPlanTitle(false);
        }
    };

    const beginRenamePlan = () => {
        if (!selectedPlan) return;
        setEditingPlanTitle(true);
        setPlanTitleDraft(selectedPlan.title || "");
    };

    const saveRenamePlan = async () => {
        if (!requireAuth()) return;
        if (!selectedPlan) return;

        const t = planTitleDraft.trim();
        if (!t) return;

        try {
            const { error } = await supabase
                .from("focus_plans")
                .update({ title: t })
                .eq("id", selectedPlan.id)
                .eq("user_id", user.id);

            if (error) return;

            setEditingPlanTitle(false);
            await reloadPlans();
        } catch {
            // silent
        }
    };

    const cancelRenamePlan = () => {
        setEditingPlanTitle(false);
        setPlanTitleDraft("");
    };

    // ===== item actions =====
    const addItemToPlan = async () => {
        if (!requireAuth()) return;
        if (!selectedPlan) return;

        const text = newItemText.trim();
        if (!text) return;

        const due = newItemDueDate ? newItemDueDate : null; // YYYY-MM-DD
        const sid = newItemSessionId ? String(newItemSessionId) : null;
        if (sid && !eligibleSessionIds.has(sid)) return;

        try {
            const { data, error } = await supabase
                .from("focus_plan_items")
                .insert({
                    user_id: user.id,
                    plan_id: selectedPlan.id,
                    text,
                    target_date: due,
                    session_id: sid,
                    sort_order: 0,
                    completed: false,
                })
                .select("*")
                .single();

            if (error || !data) return;

            setItems((prev) => [data as FocusPlanItem, ...prev]);
            setNewItemText("");
            setNewItemDueDate("");
        } catch {
            // silent
        }
    };

    const deleteItem = async (itemId: string) => {
        if (!requireAuth()) return;
        if (!selectedPlan) return;

        const prev = items;
        setItems((x) => x.filter((it) => it.id !== itemId));

        try {
            const { error } = await supabase.from("focus_plan_items").delete().eq("id", itemId).eq("user_id", user.id);
            if (error) setItems(prev);
        } catch {
            setItems(prev);
        }

        if (editingItemId === itemId) cancelEditItem();
    };

    const syncIntentionsCompletedFromItem = async (item: FocusPlanItem, nextCompleted: boolean) => {
        try {
            const sid = safeTrim(item.session_id);
            const text = safeTrim(item.text);
            if (!sid || !UUID_RE.test(sid) || !text) return;

            await supabase
                .from("intentions")
                .update({ completed: nextCompleted })
                .eq("user_id", user.id)
                .eq("session_id", sid)
                .eq("text", text);
        } catch {
            // ignore
        }
    };

    const toggleItemDone = async (itemId: string) => {
        if (!requireAuth()) return;

        const cur = items.find((x) => x.id === itemId);
        if (!cur) return;

        const nextVal = !Boolean(cur.completed);
        setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, completed: nextVal } : it)));

        try {
            const { error } = await supabase
                .from("focus_plan_items")
                .update({ completed: nextVal })
                .eq("id", itemId)
                .eq("user_id", user.id);

            if (error) {
                setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, completed: !nextVal } : it)));
                return;
            }

            void syncIntentionsCompletedFromItem(cur, nextVal);
        } catch {
            setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, completed: !nextVal } : it)));
        }
    };

    const startEditItem = (it: FocusPlanItem) => {
        setEditingItemId(it.id);
        setEditingItemText(it.text || "");
        setEditingItemSessionId(it.session_id || "");
        setEditingItemDueDate(it.target_date || "");
    };

    const cancelEditItem = () => {
        setEditingItemId(null);
        setEditingItemText("");
        setEditingItemDueDate("");
        setEditingItemSessionId("");
    };

    const saveEditItem = async () => {
        if (!requireAuth()) return;
        if (!editingItemId) return;

        const text = editingItemText.trim();
        if (!text) return;

        const due = editingItemDueDate ? editingItemDueDate : null;
        const sid = editingItemSessionId ? String(editingItemSessionId) : null;
        if (sid && !eligibleSessionIds.has(sid)) return;

        const prev = items;
        const before = items.find((x) => x.id === editingItemId);
        const oldText = safeTrim(before?.text);

        setItems((x) =>
            x.map((it) =>
                it.id === editingItemId ? { ...it, text, target_date: due, session_id: sid } : it
            )
        );

        try {
            const { error } = await supabase
                .from("focus_plan_items")
                .update({ text, target_date: due, session_id: sid })
                .eq("id", editingItemId)
                .eq("user_id", user.id);

            if (error) {
                setItems(prev);
                return;
            }

            cancelEditItem();

            try {
                if (sid && UUID_RE.test(String(sid)) && oldText && oldText !== text) {
                    await supabase
                        .from("intentions")
                        .update({ text })
                        .eq("user_id", user.id)
                        .eq("session_id", String(sid))
                        .eq("text", oldText);
                }
            } catch {
                // ignore
            }
        } catch {
            setItems(prev);
        }
    };

    const assignItemToSession = async (item: FocusPlanItem, sessionId: string) => {
        if (!requireAuth()) return;

        const sid = safeTrim(sessionId);
        if (!sid || !UUID_RE.test(sid) || !eligibleSessionIds.has(sid)) return;

        const previous = items;
        setAttachingItemId(item.id);
        setItems((current) =>
            current.map((candidate) =>
                candidate.id === item.id ? { ...candidate, session_id: sid } : candidate,
            ),
        );

        try {
            const { error } = await supabase
                .from("focus_plan_items")
                .update({ session_id: sid })
                .eq("id", item.id)
                .eq("user_id", user.id);

            if (error) {
                setItems(previous);
                return;
            }

            const taskText = safeTrim(item.text);
            if (taskText) {
                const { data: existing } = await supabase
                    .from("intentions")
                    .select("id")
                    .eq("user_id", user.id)
                    .eq("session_id", sid)
                    .eq("text", taskText)
                    .limit(1);

                if (!existing || existing.length === 0) {
                    await supabase.from("intentions").insert([{
                        user_id: user.id,
                        session_id: sid,
                        text: taskText,
                        completed: Boolean(item.completed),
                    }]);
                }
            }

            setAttachedItemIds((current) => ({ ...current, [item.id]: true }));
            setSessionPickerItemId(null);
            setSessionPickerValue("");
        } catch {
            setItems(previous);
        } finally {
            setAttachingItemId(null);
        }
    };

    const pageWrap = "w-full max-w-[1200px] mx-auto px-4 md:px-6 py-8";
    const card = "border border-borderGray rounded-[42px] bg-white p-6 md:p-7 transition-all duration-200";

    const btnPrimary =
        "h-11 rounded-full px-5 text-[13px] font-semibold border border-[#111827] bg-[#111827] text-white hover:opacity-90 transition";
    const btnGhost =
        "h-11 rounded-full px-5 text-[13px] font-semibold border border-[#E5E7EB] hover:bg-[#F3F4F6] transition";

    const allMeasurements = useMemo(
        () =>
            [...taskMeasurements]
                .filter((measurement) => Number(measurement.elapsed_ms || 0) > 0)
                .sort((a, b) => Date.parse(b.saved_at || "") - Date.parse(a.saved_at || "")),
        [taskMeasurements],
    );

    const selectedPlanItems = useMemo(
        () =>
            selectedPlanId
                ? items.filter((item) => String(item.plan_id) === String(selectedPlanId))
                : [],
        [items, selectedPlanId],
    );

    const planMeasurements = useMemo(() => {
        const itemIds = new Set(selectedPlanItems.map((item) => String(item.id || "")).filter(Boolean));
        const itemTexts = new Set(selectedPlanItems.map((item) => normalizeTaskText(item.text)).filter(Boolean));
        const itemSessionIds = new Set(
            selectedPlanItems.map((item) => String(item.session_id || "")).filter(Boolean),
        );

        return allMeasurements.filter((measurement) => {
            const focusItemId = String(measurement.focus_plan_item_id || "");
            const measurementText = normalizeTaskText(measurement.task_text);
            const measurementSessionId = String(measurement.session_id || "");

            if (focusItemId && itemIds.has(focusItemId)) return true;
            if (measurementText && itemTexts.has(measurementText)) return true;
            if (measurementSessionId && itemSessionIds.has(measurementSessionId)) return true;

            return false;
        });
    }, [allMeasurements, selectedPlanItems]);

    const visibleMeasurements = useMemo(() => {
        if (activeListId === "all" || activeListId === "completed") return allMeasurements;
        if (!selectedPlan) return allMeasurements;
        if (planMeasurements.length > 0) return planMeasurements;
        return allMeasurements;
    }, [activeListId, allMeasurements, planMeasurements, selectedPlan]);

    const visibleMeasuredMs = useMemo(
        () =>
            visibleMeasurements.reduce(
                (sum, measurement) =>
                    sum + Math.max(0, Number(measurement.elapsed_ms || 0)),
                0,
            ),
        [visibleMeasurements],
    );

    const completedItemsCount = useMemo(
        () => items.filter((item) => Boolean(item.completed)).length,
        [items],
    );

    const planTaskCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        items.forEach((item) => {
            const key = String(item.plan_id || "");
            if (!key) return;
            counts[key] = (counts[key] || 0) + 1;
        });
        return counts;
    }, [items]);

    const visibleTaskItems = useMemo(() => {
        let next = [...items];

        if (activeListId === "completed") {
            next = next.filter((item) => Boolean(item.completed));
        } else if (activeListId !== "all") {
            next = next.filter((item) => String(item.plan_id) === String(activeListId));
        }

        const query = normalizeTaskText(taskSearch);
        if (query) {
            next = next.filter((item) => normalizeTaskText(item.text).includes(query));
        }

        next.sort((a, b) => {
            const aDue = a.target_date ? Date.parse(`${a.target_date}T00:00:00`) : Number.POSITIVE_INFINITY;
            const bDue = b.target_date ? Date.parse(`${b.target_date}T00:00:00`) : Number.POSITIVE_INFINITY;

            if (aDue !== bDue) {
                return dueSortDescending ? bDue - aDue : aDue - bDue;
            }

            const aCreated = Date.parse(a.created_at || "") || 0;
            const bCreated = Date.parse(b.created_at || "") || 0;
            return bCreated - aCreated;
        });

        return next;
    }, [activeListId, dueSortDescending, items, taskSearch]);

    const currentListTitle = useMemo(() => {
        if (activeListId === "completed") return "Completed Tasks";
        if (activeListId === "all") return "All Tasks";
        return plans.find((plan) => String(plan.id) === String(activeListId))?.title || "All Tasks";
    }, [activeListId, plans]);

    useEffect(() => {
        if (activeListId === "all" || activeListId === "completed") return;
        if (plans.some((plan) => String(plan.id) === String(activeListId))) return;
        setActiveListId("all");
    }, [activeListId, plans]);

    const focusQuickAdd = () => {
        setActiveTab("plan");
        if (activeListId === "completed") setActiveListId("all");
        window.setTimeout(() => quickAddInputRef.current?.focus(), 0);
    };

    if (!user?.id) {
        return (
            <div className={pageWrap}>
                <div className={card}>
                    <div className="text-[28px] md:text-[34px] font-bold text-[#111827] leading-tight">Tasks</div>
                    <div className="mt-2 text-[13px] text-[#606060]">Plan tasks and connect them to the sessions where you will work on them.</div>

                    <div className="mt-6 flex flex-col sm:flex-row gap-3">
                        <button className={btnPrimary} onClick={() => navigate(buildLoginNext("/tasks"))} type="button">
                            Log in
                        </button>
                        <Link to="/sessions" className={btnGhost + " inline-flex items-center justify-center"}>
                            Back to sessions
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const taskListEmpty = !itemsLoading && visibleTaskItems.length === 0;

    return (
        <div className="min-h-[calc(100vh-72px)] bg-white text-[#2F2F2F]">
            <div className="flex min-h-[calc(100vh-72px)] w-full">
                <main className="min-w-0 flex-1 px-5 pb-12 pt-6 md:px-7 lg:px-8">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
                            <h1 className="truncate text-[24px] font-bold leading-none tracking-[-0.02em] text-[#303030]">
                                {activeTab === "measurements" ? "Measurements" : currentListTitle}
                            </h1>
                            <span className="text-[18px] font-medium text-[#4D4D4D]">/</span>
                            <button
                                type="button"
                                className="text-[16px] font-medium text-[#4D4D4D] transition hover:text-[#2F2F2F]"
                                title="Recurring tasks will use the same task-list layout"
                            >
                                Recurring Tasks
                            </button>
                        </div>

                        <div className="flex min-w-0 flex-wrap items-center gap-2 md:flex-nowrap">
                            <label className="flex h-8 w-[170px] items-center gap-2 rounded-[9px] border border-[#DCDCDC] bg-white px-3 text-[#8C8C8C] shadow-[0_1px_1px_rgba(0,0,0,0.02)]">
                                <Search size={13} strokeWidth={1.8} />
                                <input
                                    value={taskSearch}
                                    onChange={(event) => setTaskSearch(event.target.value)}
                                    placeholder="Search tasks..."
                                    className="min-w-0 flex-1 bg-transparent text-[11px] text-[#3D3D3D] outline-none placeholder:text-[#9A9A9A]"
                                />
                            </label>

                            <button
                                type="button"
                                onClick={() => setDueSortDescending((value) => !value)}
                                className="inline-flex h-8 items-center gap-2 rounded-[9px] border border-[#DCDCDC] bg-white px-3 text-[11px] font-medium text-[#4A4A4A] transition hover:bg-[#F8F8F8]"
                                title={dueSortDescending ? "Due date: latest first" : "Due date: earliest first"}
                            >
                                Sort by: Due Date
                                <SlidersHorizontal size={13} strokeWidth={1.8} />
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveTab((tab) => (tab === "measurements" ? "plan" : "measurements"))}
                                className={[
                                    "inline-flex h-8 w-10 items-center justify-center rounded-[9px] border transition",
                                    activeTab === "measurements"
                                        ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                                        : "border-[#DCDCDC] bg-white text-[#545454] hover:bg-[#F8F8F8]",
                                ].join(" ")}
                                title={activeTab === "measurements" ? "Back to tasks" : "Measurements"}
                            >
                                <TasksPageMaskIcon
                                    src="/icons/tasks-page-measurements.svg"
                                    size={15}
                                    fallback={<BarChart3 size={15} strokeWidth={1.8} />}
                                />
                            </button>

                            <button
                                type="button"
                                onClick={focusQuickAdd}
                                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#303030] px-4 text-[11px] font-medium text-white transition hover:bg-[#1F1F1F] disabled:cursor-not-allowed disabled:opacity-45"
                                disabled={plans.length === 0 && activeTab === "plan"}
                                title={plans.length === 0 ? "Create a task list first" : "Add task"}
                            >
                                <Plus size={12} strokeWidth={2} />
                                Add Task
                            </button>
                        </div>
                    </div>

                    {activeTab === "measurements" ? (
                        <section className="mt-7">
                            <div className="flex flex-col gap-4 rounded-[12px] border border-[#E2E2E2] bg-white p-4 md:p-5">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <div className="text-[14px] font-semibold text-[#333333]">Focus measurements</div>
                                        <div className="mt-1 text-[11px] text-[#8A8A8A]">
                                            Saved task-timer intervals. No separate Measurements tab anymore — this button is the entry point.
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setMeasurementsRefreshNonce((value) => value + 1)}
                                            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#DEDEDE] px-3 text-[11px] text-[#5A5A5A] hover:bg-[#F8F8F8]"
                                            disabled={measurementsLoading}
                                        >
                                            <RefreshCw size={12} className={measurementsLoading ? "animate-spin" : ""} />
                                            Refresh
                                        </button>
                                        <div className="rounded-[8px] bg-[#303030] px-3 py-2 text-right text-white">
                                            <div className="text-[9px] uppercase tracking-[0.08em] text-white/60">Total</div>
                                            <div className="text-[13px] font-semibold">{fmtDuration(visibleMeasuredMs)}</div>
                                        </div>
                                    </div>
                                </div>

                                {measurementsError ? (
                                    <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                                        {measurementsError}
                                    </div>
                                ) : null}

                                {measurementsLoading ? (
                                    <div className="py-10 text-center text-[12px] text-[#8A8A8A]">Loading measurements…</div>
                                ) : visibleMeasurements.length === 0 ? (
                                    <div className="py-14 text-center">
                                        <TimerReset size={24} className="mx-auto text-[#A0A0A0]" />
                                        <div className="mt-3 text-[13px] font-semibold">No saved time yet</div>
                                        <div className="mt-1 text-[11px] text-[#8A8A8A]">Start a task timer in a room and press Save.</div>
                                    </div>
                                ) : (
                                    <div className="overflow-hidden rounded-[10px] border border-[#E4E4E4]">
                                        <div className="grid grid-cols-[minmax(220px,1fr)_120px_160px] border-b border-[#E4E4E4] bg-[#FAFAFA] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#888888]">
                                            <span>Task</span>
                                            <span>Duration</span>
                                            <span>Saved</span>
                                        </div>
                                        {visibleMeasurements.map((measurement) => (
                                            <div
                                                key={measurement.id}
                                                className="grid grid-cols-[minmax(220px,1fr)_120px_160px] items-center border-b border-[#EEEEEE] px-4 py-2.5 text-[11px] last:border-b-0 hover:bg-[#FCFCFC]"
                                            >
                                                <span className="truncate pr-4 text-[#3D3D3D]">{measurement.task_text || "Untitled task"}</span>
                                                <span className="font-medium text-[#4A4A4A]">{fmtDuration(measurement.elapsed_ms)}</span>
                                                <span className="text-[#858585]">{fmtWhen(measurement.saved_at) || "—"}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </section>
                    ) : itemsLoading ? (
                        <div className="flex min-h-[420px] items-center justify-center text-[12px] text-[#8E8E8E]">
                            Loading tasks…
                        </div>
                    ) : taskListEmpty ? (
                        <section className="flex min-h-[510px] items-start justify-center pt-[118px]">
                            <div className="w-full max-w-[390px] text-center">
                                <div className="mx-auto flex h-[92px] w-[92px] items-center justify-center rounded-full border border-[#E5E5E5] bg-[#FAFAFA] text-[#323232]">
                                    <ClipboardList size={34} strokeWidth={1.55} />
                                </div>
                                <h2 className="mt-6 text-[20px] font-semibold tracking-[-0.02em] text-[#303030]">
                                    {taskSearch ? "No tasks found" : activeListId === "completed" ? "No completed tasks yet" : "No tasks set yet"}
                                </h2>
                                <p className="mx-auto mt-2 max-w-[340px] text-[12px] leading-[1.35] text-[#8A8A8A]">
                                    {taskSearch
                                        ? "Try another search or switch task lists."
                                        : activeListId === "completed"
                                            ? "Tasks you complete will appear here."
                                            : "Add your first one in the list. Focus on your deep work sessions with visual goals."}
                                </p>

                                {!taskSearch && activeListId !== "completed" ? (
                                    <>
                                        <div className="mx-auto mt-6 flex h-10 max-w-[360px] items-center overflow-hidden rounded-full border border-[#E0E0E0] bg-white">
                                            <input
                                                ref={quickAddInputRef}
                                                value={newItemText}
                                                onChange={(event) => setNewItemText(event.target.value)}
                                                onKeyDown={(event) => event.key === "Enter" && addItemToPlan()}
                                                disabled={plans.length === 0}
                                                placeholder="e.g. Prepare presentation slides..."
                                                className="h-full min-w-0 flex-1 bg-transparent px-4 text-[11px] text-[#3C3C3C] outline-none placeholder:text-[#B0B0B0] disabled:bg-[#FAFAFA]"
                                            />
                                            <button
                                                type="button"
                                                onClick={addItemToPlan}
                                                disabled={plans.length === 0 || !newItemText.trim()}
                                                className="mr-[-1px] inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-[#3B3B3B] bg-white px-4 text-[12px] font-medium text-[#3B3B3B] transition hover:bg-[#F7F7F7] disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current">
                                                    <Plus size={10} />
                                                </span>
                                                Add First Task
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShowNewListInput(true)}
                                            className="mt-3 text-[11px] font-medium text-[#5E8ED6] underline underline-offset-2"
                                        >
                                            or create a task list first
                                        </button>
                                    </>
                                ) : null}
                            </div>
                        </section>
                    ) : (
                        <section className="mt-7 overflow-visible rounded-[11px] border border-[#DEDEDE] bg-white">
                            <div className="divide-y divide-[#E7E7E7]">
                                {visibleTaskItems.map((item) => {
                                    const done = Boolean(item.completed);
                                    const list = plans.find((plan) => String(plan.id) === String(item.plan_id));
                                    const session = item.session_id
                                        ? sessions.find((candidate) => String(candidate.id) === String(item.session_id))
                                        : null;
                                    const editing = editingItemId === item.id;
                                    const assigning = sessionPickerItemId === item.id;
                                    const attached = Boolean(attachedItemIds[item.id]);

                                    return (
                                        <div key={item.id} className="group relative">
                                            <div className="flex min-h-[41px] items-center gap-3 px-3 py-2.5">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleItemDone(item.id)}
                                                    className={[
                                                        "flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border transition",
                                                        done
                                                            ? "border-[#79D783] bg-[#79D783] text-white"
                                                            : "border-[#CFCFCF] bg-white hover:border-[#9D9D9D]",
                                                    ].join(" ")}
                                                    title={done ? "Mark as not completed" : "Mark as completed"}
                                                >
                                                    {done ? <Check size={11} strokeWidth={2.4} /> : null}
                                                </button>

                                                <div className="min-w-0 flex-1">
                                                    <div
                                                        className={[
                                                            "truncate text-[11px] leading-4",
                                                            done ? "text-[#8A8A8A] line-through" : "text-[#3C3C3C]",
                                                        ].join(" ")}
                                                        title={item.text}
                                                    >
                                                        {item.text}
                                                    </div>
                                                </div>

                                                <div className="hidden shrink-0 items-center gap-2 text-[9px] text-[#8C8C8C] md:flex">
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-[#6B9CF7]" />
                                                        {list?.title || "Task list"}
                                                    </span>
                                                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                                        <CalendarDays size={12} strokeWidth={1.6} />
                                                        {fmtTaskRowDate(item.target_date, item.created_at)}
                                                    </span>
                                                    {session ? (
                                                        <span className="max-w-[120px] truncate text-[#6B6B6B]" title={session.title || "Session"}>
                                                            {session.title || "Session"}
                                                        </span>
                                                    ) : null}
                                                </div>

                                                <div className="flex shrink-0 items-center gap-1 text-[#909090]">
                                                    <button
                                                        type="button"
                                                        onClick={() => startEditItem(item)}
                                                        className="flex h-6 w-6 items-center justify-center rounded-[5px] transition hover:bg-[#F2F2F2] hover:text-[#4A4A4A]"
                                                        title="Edit task"
                                                    >
                                                        <TasksPageMaskIcon
                                                            src="/icons/tasks-page-edit.svg"
                                                            size={12}
                                                            fallback={<Pencil size={12} strokeWidth={1.8} />}
                                                        />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSessionPickerItemId((current) => (current === item.id ? null : item.id));
                                                            setSessionPickerValue(item.session_id || defaultSessionId || "");
                                                        }}
                                                        className={[
                                                            "flex h-6 w-6 items-center justify-center rounded-[5px] transition hover:bg-[#F2F2F2] hover:text-[#4A4A4A]",
                                                            attached ? "text-[#5FBE69]" : "",
                                                        ].join(" ")}
                                                        title={attached ? "Assigned to session" : "Assign to session"}
                                                    >
                                                        <ListPlus size={12} strokeWidth={1.8} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => deleteItem(item.id)}
                                                        className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[#E48686] transition hover:bg-[#FFF1F1] hover:text-[#D85F5F]"
                                                        title="Delete task"
                                                    >
                                                        <TasksPageMaskIcon
                                                            src="/icons/tasks-page-delete.svg"
                                                            size={12}
                                                            fallback={<Trash2 size={12} strokeWidth={1.8} />}
                                                        />
                                                    </button>
                                                </div>
                                            </div>

                                            {editing ? (
                                                <div className="border-t border-[#EEEEEE] bg-[#FBFBFB] px-4 py-3">
                                                    <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_145px_minmax(180px,260px)_auto]">
                                                        <input
                                                            value={editingItemText}
                                                            onChange={(event) => setEditingItemText(event.target.value)}
                                                            onKeyDown={(event) => {
                                                                if (event.key === "Enter") void saveEditItem();
                                                                if (event.key === "Escape") cancelEditItem();
                                                            }}
                                                            className="h-8 rounded-[8px] border border-[#DCDCDC] bg-white px-3 text-[11px] outline-none focus:border-[#AFAFAF]"
                                                            placeholder="Task name"
                                                        />
                                                        <input
                                                            type="date"
                                                            value={editingItemDueDate}
                                                            onChange={(event) => setEditingItemDueDate(event.target.value)}
                                                            className="h-8 rounded-[8px] border border-[#DCDCDC] bg-white px-2 text-[10px] text-[#555555] outline-none focus:border-[#AFAFAF]"
                                                        />
                                                        <select
                                                            value={editingItemSessionId}
                                                            onChange={(event) => setEditingItemSessionId(event.target.value)}
                                                            className="h-8 rounded-[8px] border border-[#DCDCDC] bg-white px-2 text-[10px] text-[#555555] outline-none focus:border-[#AFAFAF]"
                                                        >
                                                            <option value="">No session</option>
                                                            {sessions.map((candidate) => (
                                                                <option key={candidate.id} value={candidate.id}>
                                                                    {candidate.title || "Session"}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <div className="flex items-center gap-1.5">
                                                            <button
                                                                type="button"
                                                                onClick={() => void saveEditItem()}
                                                                className="h-8 rounded-[8px] bg-[#303030] px-3 text-[10px] font-medium text-white hover:bg-[#1F1F1F]"
                                                            >
                                                                Save
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={cancelEditItem}
                                                                className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#DCDCDC] bg-white text-[#777777] hover:bg-[#F4F4F4]"
                                                                title="Cancel"
                                                            >
                                                                <X size={13} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : null}

                                            {assigning ? (
                                                <div className="border-t border-[#EEEEEE] bg-[#FBFBFB] px-4 py-3">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <select
                                                            value={sessionPickerValue}
                                                            onChange={(event) => setSessionPickerValue(event.target.value)}
                                                            className="h-8 min-w-[220px] flex-1 rounded-[8px] border border-[#DCDCDC] bg-white px-2 text-[10px] text-[#555555] outline-none focus:border-[#AFAFAF]"
                                                        >
                                                            <option value="">Choose a session…</option>
                                                            {sessionsLoading ? (
                                                                <option value="" disabled>Loading sessions…</option>
                                                            ) : (
                                                                sessions.map((candidate) => (
                                                                    <option key={candidate.id} value={candidate.id}>
                                                                        {candidate.title || "Session"}
                                                                        {safeLower(candidate.session_format_type) === "infinite"
                                                                            ? " · ∞"
                                                                            : candidate.start_time
                                                                                ? ` · ${fmtWhen(candidate.start_time)}`
                                                                                : ""}
                                                                    </option>
                                                                ))
                                                            )}
                                                        </select>
                                                        <button
                                                            type="button"
                                                            onClick={() => void assignItemToSession(item, sessionPickerValue)}
                                                            disabled={!sessionPickerValue || attachingItemId === item.id}
                                                            className="h-8 rounded-[8px] bg-[#303030] px-3 text-[10px] font-medium text-white disabled:opacity-40"
                                                        >
                                                            {attachingItemId === item.id ? "Assigning…" : "Assign"}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setSessionPickerItemId(null)}
                                                            className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#DCDCDC] bg-white text-[#777777] hover:bg-[#F4F4F4]"
                                                            title="Close"
                                                        >
                                                            <X size={13} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="border-t border-[#E7E7E7] px-3 py-2.5">
                                <input
                                    ref={quickAddInputRef}
                                    value={newItemText}
                                    onChange={(event) => setNewItemText(event.target.value)}
                                    onKeyDown={(event) => event.key === "Enter" && addItemToPlan()}
                                    placeholder="Type a task name..."
                                    className="h-7 w-full bg-transparent px-6 text-[11px] text-[#3C3C3C] outline-none placeholder:text-[#A9A9A9]"
                                />
                                <button
                                    type="button"
                                    onClick={addItemToPlan}
                                    disabled={!newItemText.trim() || plans.length === 0}
                                    className="mt-1 inline-flex h-6 items-center gap-1 rounded-full bg-[#303030] px-2.5 text-[9px] font-medium text-white transition hover:bg-[#1F1F1F] disabled:opacity-40"
                                >
                                    <Plus size={9} />
                                    Add Task
                                </button>
                            </div>
                        </section>
                    )}
                </main>

                <aside className="hidden w-[210px] shrink-0 border-l border-[#E7E7E7] bg-white px-4 pb-8 pt-6 min-[900px]:block">
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.02em] text-[#767676]">Task Lists</div>
                        <button
                            type="button"
                            onClick={() => setShowNewListInput((value) => !value)}
                            className="inline-flex h-6 items-center gap-1 rounded-full border border-[#DCDCDC] px-2 text-[9px] text-[#8B8B8B] transition hover:bg-[#F8F8F8]"
                        >
                            <Plus size={9} />
                            Add list
                        </button>
                    </div>

                    {showNewListInput ? (
                        <div className="mt-3 rounded-[8px] border border-[#E1E1E1] bg-[#FAFAFA] p-2">
                            <input
                                autoFocus
                                value={newPlanTitle}
                                onChange={(event) => setNewPlanTitle(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") void createPlan();
                                    if (event.key === "Escape") setShowNewListInput(false);
                                }}
                                placeholder="List name..."
                                className="h-7 w-full rounded-[6px] border border-[#DCDCDC] bg-white px-2 text-[10px] outline-none focus:border-[#AFAFAF]"
                            />
                            <div className="mt-2 flex items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => void createPlan()}
                                    disabled={!newPlanTitle.trim()}
                                    className="h-6 rounded-[6px] bg-[#303030] px-2 text-[9px] text-white disabled:opacity-40"
                                >
                                    Create
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowNewListInput(false);
                                        setNewPlanTitle("");
                                    }}
                                    className="h-6 rounded-[6px] px-2 text-[9px] text-[#777777] hover:bg-[#EEEEEE]"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : null}

                    <div className="mt-3 flex flex-col gap-1.5">
                        <button
                            type="button"
                            onClick={() => {
                                setActiveListId((current) => (current === "completed" ? "all" : "completed"));
                                setActiveTab("plan");
                            }}
                            className={[
                                "flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[10px] transition",
                                activeListId === "completed"
                                    ? "bg-[#DBF7DD] text-[#61C86B] ring-1 ring-inset ring-[#BDEFC1]"
                                    : "bg-[#E8F9E9] text-[#6CCF75] hover:bg-[#DFF6E1]",
                            ].join(" ")}
                        >
                            <CheckCircle2 size={12} strokeWidth={1.8} />
                            <span className="min-w-0 flex-1 truncate">Completed Tasks</span>
                            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#68D273] px-1 text-[8px] font-semibold text-white">
                                {completedItemsCount}
                            </span>
                        </button>

                        {plansLoading ? (
                            <div className="px-2 py-3 text-[9px] text-[#9A9A9A]">Loading lists…</div>
                        ) : plans.length === 0 ? (
                            <div className="px-2 py-3 text-[9px] leading-4 text-[#9A9A9A]">No task lists yet.</div>
                        ) : (
                            plans.map((plan, index) => {
                                const active = activeListId === plan.id;
                                return (
                                    <button
                                        key={plan.id}
                                        type="button"
                                        onClick={() => {
                                            setActiveListId((current) => (current === plan.id ? "all" : plan.id));
                                            setSelectedPlanId(plan.id);
                                            setActiveTab("plan");
                                        }}
                                        className={[
                                            "flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[10px] text-[#555555] transition hover:bg-[#F4F4F4]",
                                            active ? "bg-[#F2F2F2] font-medium" : "",
                                        ].join(" ")}
                                    >
                                        <span className="text-[10px] leading-none">{planEmoji(plan.title, index)}</span>
                                        <span className="min-w-0 flex-1 truncate">{plan.title}</span>
                                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#EFEFEF] px-1 text-[8px] text-[#9A9A9A]">
                                            {planTaskCounts[plan.id] || 0}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    {selectedPlan && activeListId !== "all" && activeListId !== "completed" ? (
                        <div className="mt-5 border-t border-[#F0F0F0] pt-3">
                            <div className="flex items-center gap-1.5 opacity-0 transition hover:opacity-100 focus-within:opacity-100">
                                <button
                                    type="button"
                                    onClick={beginRenamePlan}
                                    className="text-[9px] text-[#8A8A8A] hover:text-[#4A4A4A]"
                                >
                                    Rename
                                </button>
                                <span className="text-[#D0D0D0]">·</span>
                                <button
                                    type="button"
                                    onClick={() => void deletePlan(selectedPlan.id)}
                                    className="text-[9px] text-[#D98484] hover:text-[#C85C5C]"
                                >
                                    Delete list
                                </button>
                            </div>
                            {editingPlanTitle ? (
                                <div className="mt-2 flex gap-1.5">
                                    <input
                                        value={planTitleDraft}
                                        onChange={(event) => setPlanTitleDraft(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") void saveRenamePlan();
                                            if (event.key === "Escape") cancelRenamePlan();
                                        }}
                                        className="h-7 min-w-0 flex-1 rounded-[6px] border border-[#DCDCDC] px-2 text-[9px] outline-none"
                                    />
                                    <button type="button" onClick={() => void saveRenamePlan()} className="h-7 rounded-[6px] bg-[#303030] px-2 text-[9px] text-white">Save</button>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </aside>
            </div>
        </div>
    );
}
