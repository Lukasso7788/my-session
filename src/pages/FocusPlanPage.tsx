import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Check, Trash2, Plus, ExternalLink, RefreshCw, TimerReset, ListChecks, BarChart3 } from "lucide-react";

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

type SessionLite = {
    id: string;
    title?: string | null;
    start_time?: string | null;
    duration_minutes?: number | null;
    session_format_type?: string | null;
    custom_slug?: string | null;
};

type IntentionRow = {
    id: string;
    text: string;
    user_id: string;
    session_id: string;
    created_at?: string;
    completed?: boolean;
    profiles?: {
        full_name?: string;
        avatar_url?: string;
    };
};

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

function fmtDueDate(yyyyMmDd?: string | null) {
    if (!yyyyMmDd) return "";
    const ms = Date.parse(`${yyyyMmDd}T00:00:00.000Z`);
    if (!Number.isFinite(ms)) return "";
    try {
        return new Date(ms).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
        });
    } catch {
        return "";
    }
}

function buildLoginNext(urlPath: string) {
    const next = urlPath || "/sessions";
    return `/login?next=${encodeURIComponent(next)}`;
}

export default function FocusPlanPage() {
    const navigate = useNavigate();
    const [sp, setSp] = useSearchParams();

    // optional: deep-link from room: /focus-plan?sessionId=...
    const initialParam = (sp.get("sessionId") || "").trim();

    const [user, setUser] = useState<any>(null);

    // sessions
    const [sessions, setSessions] = useState<SessionLite[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(true);

    // default session for "new item" (raw may be uuid or slug)
    const [rawDefaultSession, setRawDefaultSession] = useState<string>(initialParam);
    const [defaultSessionId, setDefaultSessionId] = useState<string | null>(null);

    // library (recent unique intentions)
    const [library, setLibrary] = useState<IntentionRow[]>([]);
    const [loadingLibrary, setLoadingLibrary] = useState(false);
    const [deletingLibraryText, setDeletingLibraryText] = useState<string | null>(null);
    const [taskMeasurements, setTaskMeasurements] = useState<TaskTimeMeasurement[]>([]);
    const [activeTab, setActiveTab] = useState<"plan" | "measurements">("plan");
    const [measurementsLoading, setMeasurementsLoading] = useState(false);
    const [measurementsError, setMeasurementsError] = useState<string | null>(null);
    const [measurementsRefreshNonce, setMeasurementsRefreshNonce] = useState(0);

    // plans + items (Supabase)
    const [plans, setPlans] = useState<FocusPlan[]>([]);
    const [plansLoading, setPlansLoading] = useState(false);
    const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

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

    // seq guards
    const libSeqRef = useRef(0);

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
            try {
                const { data, error } = await supabase
                    .from("sessions")
                    .select("id, title, start_time, duration_minutes, session_format_type, custom_slug")
                    .order("start_time", { ascending: true })
                    .limit(150);

                if (!cancelled) {
                    if (!error && Array.isArray(data)) setSessions(data as any);
                    else setSessions([]);
                }
            } catch {
                if (!cancelled) setSessions([]);
            } finally {
                if (!cancelled) setSessionsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

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
                if (!cancelled) setDefaultSessionId(raw);
                return;
            }

            const slug = raw.toLowerCase();

            const fromList = sessions.find((s) => safeLower(s.custom_slug) === slug);
            if (fromList?.id) {
                if (!cancelled) setDefaultSessionId(String(fromList.id));
                return;
            }

            try {
                const { data, error } = await supabase
                    .from("sessions")
                    .select("id")
                    .eq("custom_slug", slug)
                    .maybeSingle();

                if (!cancelled) {
                    if (!error && data?.id) setDefaultSessionId(String(data.id));
                    else setDefaultSessionId(null);
                }
            } catch {
                if (!cancelled) setDefaultSessionId(null);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [rawDefaultSession, sessions]);

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

    const defaultSession = useMemo(() => {
        if (!defaultSessionId) return null;
        return sessions.find((s) => String(s.id) === String(defaultSessionId)) || null;
    }, [sessions, defaultSessionId]);

    // ===== auth guard =====
    const requireAuth = () => {
        if (user?.id) return true;
        navigate(buildLoginNext("/focus-plan"));
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
    const reloadItems = async (planId: string) => {
        if (!user?.id) return;

        setItemsLoading(true);
        try {
            const { data, error } = await supabase
                .from("focus_plan_items")
                .select("*")
                .eq("user_id", user.id)
                .eq("plan_id", planId)
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

    // ===== library (recent unique intentions) =====
    const loadLibrary = async () => {
        if (!user?.id) return;

        const seq = ++libSeqRef.current;
        setLoadingLibrary(true);

        try {
            const { data, error } = await supabase
                .from("intentions")
                .select("id, text, user_id, session_id, created_at, completed")
                .eq("user_id", user.id)
                .order("created_at", { ascending: false })
                .limit(120);

            if (seq !== libSeqRef.current) return;

            if (error || !Array.isArray(data)) {
                setLibrary([]);
                return;
            }

            const seen = new Set<string>();
            const out: IntentionRow[] = [];
            for (const row of data as any[]) {
                const t = String(row?.text || "").trim();
                if (!t) continue;
                const k = t.toLowerCase();
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(row as any);
                if (out.length >= 24) break;
            }
            setLibrary(out);
        } catch {
            if (seq === libSeqRef.current) setLibrary([]);
        } finally {
            if (seq === libSeqRef.current) setLoadingLibrary(false);
        }
    };

    useEffect(() => {
        if (!user?.id) return;
        loadLibrary();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

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

            // optimistic: prepend
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

        // optimistic remove
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

    // ✅ sync intentions.completed when focus_plan_items.completed changes
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

        // optimistic
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

            // ✅ sync to intentions
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

        const prev = items;
        const before = items.find((x) => x.id === editingItemId);
        const oldText = safeTrim(before?.text);

        // optimistic
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

            // ✅ best-effort sync rename into intentions if item is linked to a session
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

    const addLibraryTextToPlan = (text: string) => {
        if (!requireAuth()) return;
        const t = String(text || "").trim();
        if (!t) return;
        setNewItemText(t);
    };

    const deleteLibraryText = async (text: string) => {
        if (!requireAuth()) return;

        const normalized = safeTrim(text);
        if (!normalized) return;

        const key = normalized.toLowerCase();
        const prev = library;

        setDeletingLibraryText(key);

        // optimistic remove from visible unique library
        setLibrary((cur) => cur.filter((row) => safeTrim(row.text).toLowerCase() !== key));

        try {
            const { data, error } = await supabase
                .from("intentions")
                .select("id, text")
                .eq("user_id", user.id)
                .limit(300);

            if (error) {
                setLibrary(prev);
                return;
            }

            const idsToDelete = (data || [])
                .filter((row: any) => safeTrim(row?.text).toLowerCase() === key)
                .map((row: any) => row.id)
                .filter(Boolean);

            if (idsToDelete.length === 0) {
                return;
            }

            const { error: deleteError } = await supabase
                .from("intentions")
                .delete()
                .in("id", idsToDelete)
                .eq("user_id", user.id);

            if (deleteError) {
                setLibrary(prev);
                return;
            }

            void loadLibrary();
        } catch {
            setLibrary(prev);
        } finally {
            setDeletingLibraryText(null);
        }
    };

    // attach = create real intention row (so it appears in room panel)
    const attachItemToSession = async (item: FocusPlanItem) => {
        if (!requireAuth()) return;

        const sid = String(item.session_id || "").trim();
        const text = String(item.text || "").trim();
        if (!sid || !UUID_RE.test(sid) || !text) return;

        setAttachingItemId(item.id);

        try {
            // avoid obvious duplicates for this user/session/text
            const { data: existing } = await supabase
                .from("intentions")
                .select("id")
                .eq("user_id", user.id)
                .eq("session_id", sid)
                .eq("text", text)
                .limit(1);

            if (!existing || existing.length === 0) {
                const { error } = await supabase
                    .from("intentions")
                    .insert([{ user_id: user.id, session_id: sid, text, completed: Boolean(item.completed) }]);

                if (error) return;
            }

            setAttachedItemIds((m) => ({ ...m, [item.id]: true }));
            loadLibrary();
        } finally {
            setAttachingItemId(null);
        }
    };

    const openRoom = (sessionId?: string | null) => {
        const sid = String(sessionId || "").trim();
        if (!sid) return;
        navigate(`/room-iframe/${sid}`);
    };

    const pageWrap = "w-full max-w-[1200px] mx-auto px-4 md:px-6 py-8";
    const card = "border border-borderGray rounded-[42px] bg-white p-6 md:p-7 transition-all duration-200";
    const softCard = "border border-[#E5E7EB] rounded-[24px] bg-white p-4 md:p-5";

    const btnPrimary =
        "h-11 rounded-full px-5 text-[13px] font-semibold border border-[#111827] bg-[#111827] text-white hover:opacity-90 transition";
    const btnGhost =
        "h-11 rounded-full px-5 text-[13px] font-semibold border border-[#E5E7EB] hover:bg-[#F3F4F6] transition";

    const inputPill =
        "h-11 px-4 rounded-full border border-[#E5E7EB] text-[13px] text-[#111827] outline-none focus:border-[#111827] bg-white";

    const allMeasurements = useMemo(
        () =>
            [...taskMeasurements]
                .filter((measurement) => Number(measurement.elapsed_ms || 0) > 0)
                .sort((a, b) => Date.parse(b.saved_at || "") - Date.parse(a.saved_at || "")),
        [taskMeasurements],
    );

    const planMeasurements = useMemo(() => {
        const itemIds = new Set(items.map((item) => String(item.id || "")).filter(Boolean));
        const itemTexts = new Set(items.map((item) => normalizeTaskText(item.text)).filter(Boolean));
        const itemSessionIds = new Set(
            items.map((item) => String(item.session_id || "")).filter(Boolean),
        );

        return allMeasurements.filter((measurement) => {
            const focusItemId = String(measurement.focus_plan_item_id || "");
            const measurementText = normalizeTaskText(measurement.task_text);
            const measurementSessionId = String(measurement.session_id || "");

            if (focusItemId && itemIds.has(focusItemId)) return true;
            if (measurementText && itemTexts.has(measurementText)) return true;

            // Older measurements were often saved without focus_plan_item_id.
            // If they belong to a session used by this plan, keep them visible
            // instead of silently hiding valid data.
            if (measurementSessionId && itemSessionIds.has(measurementSessionId)) return true;

            return false;
        });
    }, [allMeasurements, items]);

    const visibleMeasurements = useMemo(() => {
        if (!selectedPlan) return allMeasurements;
        if (planMeasurements.length > 0) return planMeasurements;

        // Do not show an empty Measurements tab when Supabase already contains
        // valid measurements that simply were not linked to a plan item.
        return allMeasurements;
    }, [allMeasurements, planMeasurements, selectedPlan]);

    const usingAllMeasurementsFallback =
        Boolean(selectedPlan) &&
        planMeasurements.length === 0 &&
        allMeasurements.length > 0;

    const visibleMeasuredMs = useMemo(
        () =>
            visibleMeasurements.reduce(
                (sum, measurement) =>
                    sum + Math.max(0, Number(measurement.elapsed_ms || 0)),
                0,
            ),
        [visibleMeasurements],
    );

    const measurementsByTask = useMemo(() => {
        const groups = new Map<
            string,
            {
                key: string;
                taskText: string;
                focusPlanItemId: string | null;
                sessionId: string | null;
                measurements: TaskTimeMeasurement[];
                totalMs: number;
            }
        >();

        visibleMeasurements.forEach((measurement) => {
            const normalizedText = normalizeTaskText(measurement.task_text);
            const focusPlanItemId = String(measurement.focus_plan_item_id || "") || null;
            const sessionId = String(measurement.session_id || "") || null;
            const key =
                focusPlanItemId ||
                `${normalizedText || "untitled"}::${sessionId || "no-session"}`;

            const current = groups.get(key) || {
                key,
                taskText: measurement.task_text || "Untitled task",
                focusPlanItemId,
                sessionId,
                measurements: [],
                totalMs: 0,
            };

            current.measurements.push(measurement);
            current.totalMs += Math.max(0, Number(measurement.elapsed_ms || 0));
            groups.set(key, current);
        });

        return Array.from(groups.values())
            .map((group) => ({
                ...group,
                measurements: [...group.measurements].sort(
                    (a, b) =>
                        Date.parse(b.saved_at || "") - Date.parse(a.saved_at || ""),
                ),
            }))
            .sort((a, b) => {
                const aLatest = Date.parse(a.measurements[0]?.saved_at || "");
                const bLatest = Date.parse(b.measurements[0]?.saved_at || "");
                return bLatest - aLatest;
            });
    }, [visibleMeasurements]);

    const planMeasuredMs = useMemo(
        () =>
            planMeasurements.reduce(
                (sum, measurement) =>
                    sum + Math.max(0, Number(measurement.elapsed_ms || 0)),
                0,
            ),
        [planMeasurements],
    );

    const getMeasurementsForItem = (item: FocusPlanItem) => {
        const itemId = String(item.id || "");
        const itemText = normalizeTaskText(item.text);
        const itemSessionId = String(item.session_id || "");

        return allMeasurements.filter((measurement) => {
            if (
                measurement.focus_plan_item_id &&
                String(measurement.focus_plan_item_id) === itemId
            ) {
                return true;
            }

            if (
                itemText &&
                normalizeTaskText(measurement.task_text) === itemText
            ) {
                return true;
            }

            if (
                itemSessionId &&
                String(measurement.session_id || "") === itemSessionId
            ) {
                return true;
            }

            return false;
        });
    };

    if (!user?.id) {
        return (
            <div className={pageWrap}>
                <div className={card}>
                    <div className="text-[28px] md:text-[34px] font-bold text-[#111827] leading-tight">Focus plan</div>
                    <div className="mt-2 text-[13px] text-[#606060]">Build your plan: intentions + due dates + session links.</div>

                    <div className="mt-6 flex flex-col sm:flex-row gap-3">
                        <button className={btnPrimary} onClick={() => navigate(buildLoginNext("/focus-plan"))} type="button">
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

    const planItemsCount = items.length;

    return (
        <div className={pageWrap}>
            <div className={card}>
                {/* header */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                        <div className="text-[28px] md:text-[34px] font-bold text-[#111827] leading-tight">Focus plan</div>
                        <div className="mt-2 text-[13px] text-[#606060]">Plans → items (intentions) → due date → session link → attach to room.</div>

                        {defaultSession ? (
                            <div className="mt-2 text-[12px] text-[#606060]">
                                Default session for new items:{" "}
                                <span className="font-semibold text-[#111827]">{defaultSession.title || "Session"}</span>
                                {safeLower(defaultSession.session_format_type) === "infinite"
                                    ? " · ∞"
                                    : defaultSession.start_time
                                        ? ` · ${fmtWhen(defaultSession.start_time)}`
                                        : ""}
                            </div>
                        ) : rawDefaultSession ? (
                            <div className="mt-2 text-[12px] text-[#606060]">Default session: resolving…</div>
                        ) : null}
                    </div>

                    <div className="flex items-center gap-3">
                        <Link to="/sessions" className={btnGhost + " inline-flex items-center justify-center"}>
                            Sessions
                        </Link>

                        <button className={btnGhost} onClick={() => loadLibrary()} type="button" title="Refresh library">
                            <span className="inline-flex items-center gap-2">
                                <RefreshCw size={16} />
                                Refresh
                            </span>
                        </button>
                    </div>
                </div>

                <div className="mt-6 inline-flex rounded-[18px] border border-[#E5E7EB] bg-[#F8F8F8] p-1">
                    <button
                        type="button"
                        onClick={() => setActiveTab("plan")}
                        className={[
                            "inline-flex h-10 items-center gap-2 rounded-[14px] px-4 text-[13px] font-semibold transition",
                            activeTab === "plan"
                                ? "bg-[#2F2F2F] text-white shadow-sm"
                                : "text-[#606060] hover:bg-white",
                        ].join(" ")}
                    >
                        <ListChecks size={16} />
                        Plan
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab("measurements")}
                        className={[
                            "inline-flex h-10 items-center gap-2 rounded-[14px] px-4 text-[13px] font-semibold transition",
                            activeTab === "measurements"
                                ? "bg-[#2F2F2F] text-white shadow-sm"
                                : "text-[#606060] hover:bg-white",
                        ].join(" ")}
                    >
                        <BarChart3 size={16} />
                        Measurements
                    </button>
                </div>

                {activeTab === "plan" ? (
                    <>

                        {/* default session picker (optional) */}
                        <div className="mt-6">
                            <div className={softCard}>
                                <div className="text-[12px] font-semibold text-[#111827] mb-2">Default session (optional)</div>

                                <div className="flex flex-col md:flex-row gap-3 md:items-center">
                                    <div className="flex-1">
                                        <select
                                            value={rawDefaultSession}
                                            onChange={(e) => setRawDefaultSession(e.target.value)}
                                            className="w-full h-11 px-4 rounded-full border border-[#E5E7EB] text-[13px] font-semibold text-[#111827] bg-white outline-none focus:border-[#111827]"
                                        >
                                            <option value="">— none —</option>
                                            {sessionsLoading ? (
                                                <option value="" disabled>
                                                    Loading sessions…
                                                </option>
                                            ) : sessions.length === 0 ? (
                                                <option value="" disabled>
                                                    No sessions found
                                                </option>
                                            ) : (
                                                sessions.map((s) => {
                                                    const when = fmtWhen(s.start_time);
                                                    const isInf = safeLower(s.session_format_type) === "infinite";
                                                    const label = `${s.title || "Session"}${isInf ? " · ∞" : when ? ` · ${when}` : ""}`;
                                                    return (
                                                        <option key={s.id} value={s.id}>
                                                            {label}
                                                        </option>
                                                    );
                                                })
                                            )}
                                        </select>

                                        <div className="mt-2 text-[12px] text-[#606060]">If you open this page from the room later, we can auto-set this.</div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <button
                                            className={btnGhost}
                                            onClick={() => {
                                                sp.delete("sessionId");
                                                setSp(sp, { replace: true });
                                                setRawDefaultSession("");
                                                setDefaultSessionId(null);
                                                setNewItemSessionId("");
                                            }}
                                            type="button"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* main grid */}
                        <div className="mt-6 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
                            {/* left: plans */}
                            <div className={softCard}>
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-[16px] font-bold text-[#111827]">Plans</div>
                                        <div className="mt-1 text-[13px] text-[#606060]">Create a plan, then add items.</div>
                                    </div>

                                    <button className={btnGhost} onClick={() => reloadPlans()} type="button" title="Refresh plans">
                                        <span className="inline-flex items-center gap-2">
                                            <RefreshCw size={16} />
                                            Refresh
                                        </span>
                                    </button>
                                </div>

                                {/* create plan */}
                                <div className="mt-4 flex items-center gap-2">
                                    <input
                                        value={newPlanTitle}
                                        onChange={(e) => setNewPlanTitle(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && createPlan()}
                                        placeholder="New plan title…"
                                        className={"flex-1 " + inputPill}
                                    />
                                    <button className={btnPrimary} onClick={createPlan} type="button" title="Create plan">
                                        <span className="inline-flex items-center gap-2">
                                            <Plus size={16} />
                                            Create
                                        </span>
                                    </button>
                                </div>

                                {/* plan list */}
                                <div className="mt-4 flex flex-col gap-2">
                                    {plansLoading ? (
                                        <div className="text-[13px] text-[#606060] italic">Loading plans…</div>
                                    ) : plans.length === 0 ? (
                                        <div className="text-[13px] text-[#606060] italic">No plans yet. Create your first one above.</div>
                                    ) : (
                                        plans.map((p) => {
                                            const active = p.id === selectedPlanId;
                                            const count = active ? planItemsCount : undefined;

                                            return (
                                                <button
                                                    key={p.id}
                                                    onClick={() => {
                                                        setSelectedPlanId(p.id);
                                                        setEditingPlanTitle(false);
                                                    }}
                                                    className={[
                                                        "w-full text-left rounded-[18px] px-4 py-3 border transition",
                                                        active
                                                            ? "border-[#111827] bg-[#111827] text-white"
                                                            : "border-[#F0F0F0] hover:bg-[#F6F6F6] hover:border-[#E5E7EB] text-[#111827]",
                                                    ].join(" ")}
                                                    type="button"
                                                >
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className={["text-[13px] font-semibold truncate", active ? "text-white" : "text-[#111827]"].join(" ")}>
                                                                {p.title}
                                                            </div>
                                                            <div className={["text-[11px] mt-1", active ? "text-white/70" : "text-[#606060]"].join(" ")}>
                                                                {typeof count === "number" ? `${count} items` : "—"}
                                                            </div>
                                                        </div>

                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                deletePlan(p.id);
                                                            }}
                                                            className={[
                                                                "h-10 w-10 rounded-full border flex items-center justify-center transition",
                                                                active ? "border-white/25 hover:bg-white/10" : "border-[#E5E7EB] hover:bg-[#F3F4F6]",
                                                            ].join(" ")}
                                                            type="button"
                                                            title="Delete plan"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* right: plan builder */}
                            <div className={softCard}>
                                {!selectedPlan ? (
                                    <div className="text-[13px] text-[#606060] italic">Select or create a plan.</div>
                                ) : (
                                    <>
                                        {/* plan title row */}
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                {!editingPlanTitle ? (
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-[18px] font-bold text-[#111827] truncate">{selectedPlan.title}</div>
                                                        <button
                                                            onClick={beginRenamePlan}
                                                            className="h-10 px-4 rounded-full border border-[#E5E7EB] hover:bg-[#F3F4F6] transition text-[12px] font-semibold"
                                                            type="button"
                                                        >
                                                            Rename
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                                        <input
                                                            value={planTitleDraft}
                                                            onChange={(e) => setPlanTitleDraft(e.target.value)}
                                                            onKeyDown={(e) => e.key === "Enter" && saveRenamePlan()}
                                                            className={"flex-1 " + inputPill}
                                                            placeholder="Plan title…"
                                                        />
                                                        <div className="flex items-center gap-2">
                                                            <button className={btnPrimary} onClick={saveRenamePlan} type="button">
                                                                Save
                                                            </button>
                                                            <button className={btnGhost} onClick={cancelRenamePlan} type="button">
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="mt-1 text-[12px] text-[#606060]">Updated: {fmtWhen(selectedPlan.updated_at)}</div>
                                            </div>

                                            <button className={btnGhost} onClick={() => selectedPlanId && reloadItems(selectedPlanId)} type="button" title="Refresh items">
                                                <span className="inline-flex items-center gap-2">
                                                    <RefreshCw size={16} />
                                                    Refresh
                                                </span>
                                            </button>
                                        </div>

                                        {/* time measurements */}
                                        <div className="mt-5 border border-[#F0F0F0] rounded-[22px] p-4 md:p-5 bg-[#FAFAFA]">
                                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                                <div>
                                                    <div className="text-[14px] font-bold text-[#111827] inline-flex items-center gap-2">
                                                        <TimerReset size={16} />
                                                        Task time measurements
                                                    </div>
                                                    <div className="mt-1 text-[12px] text-[#606060]">
                                                        Saved from the Tasks panel timer via Save.
                                                    </div>
                                                </div>

                                                <div className="rounded-full border border-[#E5E7EB] bg-white px-4 py-2 text-[12px] font-bold text-[#111827]">
                                                    {fmtDuration(planMeasuredMs)} total
                                                </div>
                                            </div>

                                            {planMeasurements.length === 0 ? (
                                                <div className="mt-3 text-[12px] text-[#606060] italic">
                                                    No saved time yet. Start a task timer in a room, then press Save.
                                                </div>
                                            ) : (
                                                <div className="mt-3 flex flex-col gap-2">
                                                    {planMeasurements.slice(0, 8).map((measurement) => (
                                                        <div
                                                            key={measurement.id}
                                                            className="flex items-center justify-between gap-3 rounded-[16px] border border-[#F0F0F0] bg-white px-4 py-3"
                                                        >
                                                            <div className="min-w-0">
                                                                <div className="truncate text-[13px] font-semibold text-[#111827]">
                                                                    {measurement.task_text}
                                                                </div>
                                                                <div className="mt-1 text-[11px] text-[#606060]">
                                                                    {measurement.saved_at ? `Saved: ${fmtWhen(measurement.saved_at)}` : "Saved time"}
                                                                </div>
                                                            </div>
                                                            <div className="shrink-0 rounded-full bg-[#111827] px-3 py-1.5 text-[12px] font-bold text-white">
                                                                {fmtDuration(measurement.elapsed_ms)}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* add item */}
                                        <div className="mt-5 border border-[#F0F0F0] rounded-[22px] p-4 md:p-5">
                                            <div className="text-[14px] font-bold text-[#111827]">Add item</div>
                                            <div className="mt-1 text-[12px] text-[#606060]">Each item = intention + due date + session link.</div>

                                            <div className="mt-4 flex flex-col gap-3">
                                                <input
                                                    value={newItemText}
                                                    onChange={(e) => setNewItemText(e.target.value)}
                                                    onKeyDown={(e) => e.key === "Enter" && addItemToPlan()}
                                                    placeholder="What will you work on? (intention)…"
                                                    className={inputPill}
                                                />

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    <div>
                                                        <div className="text-[11px] font-semibold text-[#606060] mb-2">Due date (optional)</div>
                                                        <input type="date" value={newItemDueDate} onChange={(e) => setNewItemDueDate(e.target.value)} className={inputPill} />
                                                    </div>

                                                    <div>
                                                        <div className="text-[11px] font-semibold text-[#606060] mb-2">Session (optional)</div>
                                                        <select
                                                            value={newItemSessionId}
                                                            onChange={(e) => setNewItemSessionId(e.target.value)}
                                                            className="w-full h-11 px-4 rounded-full border border-[#E5E7EB] text-[13px] font-semibold text-[#111827] bg-white outline-none focus:border-[#111827]"
                                                        >
                                                            <option value="">— none —</option>
                                                            {sessionsLoading ? (
                                                                <option value="" disabled>
                                                                    Loading sessions…
                                                                </option>
                                                            ) : sessions.length === 0 ? (
                                                                <option value="" disabled>
                                                                    No sessions found
                                                                </option>
                                                            ) : (
                                                                sessions.map((s) => {
                                                                    const when = fmtWhen(s.start_time);
                                                                    const isInf = safeLower(s.session_format_type) === "infinite";
                                                                    const label = `${s.title || "Session"}${isInf ? " · ∞" : when ? ` · ${when}` : ""}`;
                                                                    return (
                                                                        <option key={s.id} value={s.id}>
                                                                            {label}
                                                                        </option>
                                                                    );
                                                                })
                                                            )}
                                                        </select>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <button className={btnPrimary} onClick={addItemToPlan} type="button">
                                                        <span className="inline-flex items-center gap-2">
                                                            <Plus size={16} />
                                                            Add to plan
                                                        </span>
                                                    </button>
                                                    <button
                                                        className={btnGhost}
                                                        onClick={() => {
                                                            setNewItemText("");
                                                            setNewItemDueDate("");
                                                        }}
                                                        type="button"
                                                    >
                                                        Clear
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        {/* items list */}
                                        <div className="mt-5">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-[16px] font-bold text-[#111827]">Items</div>
                                                <div className="text-[12px] text-[#606060]">{items.length} total</div>
                                            </div>

                                            <div className="mt-3 flex flex-col gap-2">
                                                {itemsLoading ? (
                                                    <div className="text-[13px] text-[#606060] italic">Loading items…</div>
                                                ) : items.length === 0 ? (
                                                    <div className="text-[13px] text-[#606060] italic">Add your first item above.</div>
                                                ) : (
                                                    items.map((it) => {
                                                        const isEditing = editingItemId === it.id;
                                                        const done = Boolean(it.completed);

                                                        const session = it.session_id ? sessions.find((s) => String(s.id) === String(it.session_id)) : null;

                                                        const canAttach = Boolean(it.session_id) && UUID_RE.test(String(it.session_id)) && String(it.text || "").trim().length > 0;
                                                        const attached = Boolean(attachedItemIds[it.id]);

                                                        return (
                                                            <div key={it.id} className="rounded-[18px] border border-[#F0F0F0] hover:bg-[#F6F6F6] hover:border-[#E5E7EB] transition px-4 py-3">
                                                                {!isEditing ? (
                                                                    <div className="flex items-start gap-3">
                                                                        <button
                                                                            className="mt-[2px] h-6 w-6 rounded-full border border-[#D1D5DB] flex items-center justify-center hover:bg-white transition"
                                                                            onClick={() => toggleItemDone(it.id)}
                                                                            type="button"
                                                                            title={done ? "Mark as not done" : "Mark as done"}
                                                                            style={{
                                                                                borderColor: done ? "#65D46C" : "#D1D5DB",
                                                                                background: done ? "rgba(101,212,108,0.15)" : "transparent",
                                                                            }}
                                                                        >
                                                                            {done ? <Check size={14} color="#2F2F2F" /> : null}
                                                                        </button>

                                                                        <div className="flex-1 min-w-0">
                                                                            <div className={["text-[13px] leading-5 break-words", done ? "text-[#606060] line-through" : "text-[#111827]"].join(" ")}>
                                                                                {it.text}
                                                                            </div>

                                                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[#606060]">
                                                                                {it.target_date ? (
                                                                                    <span className="px-3 py-1 rounded-full border border-[#E5E7EB] bg-white">
                                                                                        Due: <span className="font-semibold text-[#111827]">{fmtDueDate(it.target_date)}</span>
                                                                                    </span>
                                                                                ) : null}

                                                                                {session ? (
                                                                                    <span className="px-3 py-1 rounded-full border border-[#E5E7EB] bg-white">
                                                                                        Session: <span className="font-semibold text-[#111827]">{session.title || "Session"}</span>
                                                                                        {safeLower(session.session_format_type) === "infinite"
                                                                                            ? " · ∞"
                                                                                            : session.start_time
                                                                                                ? ` · ${fmtWhen(session.start_time)}`
                                                                                                : ""}
                                                                                    </span>
                                                                                ) : it.session_id ? (
                                                                                    <span className="px-3 py-1 rounded-full border border-[#E5E7EB] bg-white">
                                                                                        Session: <span className="font-semibold text-[#111827]">resolving…</span>
                                                                                    </span>
                                                                                ) : (
                                                                                    <span className="px-3 py-1 rounded-full border border-[#E5E7EB] bg-white">
                                                                                        Session: <span className="font-semibold text-[#111827]">—</span>
                                                                                    </span>
                                                                                )}

                                                                                {attached ? (
                                                                                    <span className="px-3 py-1 rounded-full border border-[#65D46C] bg-[#65D46C]/10 text-[#2F2F2F] font-semibold">
                                                                                        Attached to room
                                                                                    </span>
                                                                                ) : null}
                                                                            </div>
                                                                        </div>

                                                                        {/* actions */}
                                                                        <div className="flex items-center gap-2 shrink-0">
                                                                            <button className="h-10 px-4 rounded-full border border-[#E5E7EB] hover:bg-[#F3F4F6] transition text-[12px] font-semibold" onClick={() => startEditItem(it)} type="button">
                                                                                Edit
                                                                            </button>

                                                                            <button className="h-10 w-10 rounded-full border border-[#E5E7EB] hover:bg-[#F3F4F6] transition flex items-center justify-center" onClick={() => deleteItem(it.id)} type="button" title="Delete item">
                                                                                <Trash2 size={16} />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex flex-col gap-3">
                                                                        <div className="text-[12px] font-semibold text-[#606060]">Edit item</div>

                                                                        <input
                                                                            value={editingItemText}
                                                                            onChange={(e) => setEditingItemText(e.target.value)}
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === "Enter") saveEditItem();
                                                                                if (e.key === "Escape") cancelEditItem();
                                                                            }}
                                                                            className={inputPill}
                                                                            placeholder="Intention…"
                                                                            autoFocus
                                                                        />

                                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                            <div>
                                                                                <div className="text-[11px] font-semibold text-[#606060] mb-2">Due date (optional)</div>
                                                                                <input type="date" value={editingItemDueDate} onChange={(e) => setEditingItemDueDate(e.target.value)} className={inputPill} />
                                                                            </div>

                                                                            <div>
                                                                                <div className="text-[11px] font-semibold text-[#606060] mb-2">Session (optional)</div>
                                                                                <select
                                                                                    value={editingItemSessionId}
                                                                                    onChange={(e) => setEditingItemSessionId(e.target.value)}
                                                                                    className="w-full h-11 px-4 rounded-full border border-[#E5E7EB] text-[13px] font-semibold text-[#111827] bg-white outline-none focus:border-[#111827]"
                                                                                >
                                                                                    <option value="">— none —</option>
                                                                                    {sessions.map((s) => {
                                                                                        const when = fmtWhen(s.start_time);
                                                                                        const isInf = safeLower(s.session_format_type) === "infinite";
                                                                                        const label = `${s.title || "Session"}${isInf ? " · ∞" : when ? ` · ${when}` : ""}`;
                                                                                        return (
                                                                                            <option key={s.id} value={s.id}>
                                                                                                {label}
                                                                                            </option>
                                                                                        );
                                                                                    })}
                                                                                </select>
                                                                            </div>
                                                                        </div>

                                                                        <div className="flex flex-wrap items-center gap-2">
                                                                            <button className={btnPrimary} onClick={saveEditItem} type="button">
                                                                                Save
                                                                            </button>
                                                                            <button className={btnGhost} onClick={cancelEditItem} type="button">
                                                                                Cancel
                                                                            </button>
                                                                            <button
                                                                                className="h-11 rounded-full px-5 text-[13px] font-semibold border border-[#F65252] bg-[#F65252]/5 text-[#F65252] hover:bg-[#F65252]/10 transition"
                                                                                onClick={() => deleteItem(it.id)}
                                                                                type="button"
                                                                            >
                                                                                Delete
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {!isEditing && (() => {
                                                                    const measurements = getMeasurementsForItem(it);
                                                                    const totalMs = measurements.reduce((sum, measurement) => sum + Math.max(0, Number(measurement.elapsed_ms || 0)), 0);

                                                                    if (!measurements.length) return null;

                                                                    return (
                                                                        <div className="mt-3 rounded-[16px] border border-[#E5E7EB] bg-[#FAFAFA] px-4 py-3">
                                                                            <div className="flex items-center justify-between gap-3">
                                                                                <div className="inline-flex items-center gap-2 text-[12px] font-bold text-[#111827]">
                                                                                    <TimerReset size={15} />
                                                                                    Time saved
                                                                                </div>
                                                                                <div className="rounded-full bg-[#111827] px-3 py-1 text-[11px] font-bold text-white">
                                                                                    {fmtDuration(totalMs)}
                                                                                </div>
                                                                            </div>
                                                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                                                {measurements.slice(0, 5).map((measurement) => (
                                                                                    <span
                                                                                        key={measurement.id}
                                                                                        className="rounded-full border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] text-[#606060]"
                                                                                        title={measurement.saved_at ? fmtWhen(measurement.saved_at) : "Saved time"}
                                                                                    >
                                                                                        {fmtDuration(measurement.elapsed_ms)}
                                                                                    </span>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })()}

                                                                {/* secondary actions row */}
                                                                {!isEditing ? (
                                                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                                                        <button
                                                                            className={btnGhost}
                                                                            onClick={() => {
                                                                                if (!it.session_id) return;
                                                                                openRoom(it.session_id);
                                                                            }}
                                                                            type="button"
                                                                            disabled={!it.session_id}
                                                                            style={{ opacity: it.session_id ? 1 : 0.5 }}
                                                                            title={!it.session_id ? "Select a session first" : "Open room"}
                                                                        >
                                                                            <span className="inline-flex items-center gap-2">
                                                                                <ExternalLink size={16} />
                                                                                Open room
                                                                            </span>
                                                                        </button>

                                                                        <button
                                                                            className={btnPrimary}
                                                                            onClick={() => attachItemToSession(it)}
                                                                            type="button"
                                                                            disabled={!canAttach || attachingItemId === it.id}
                                                                            style={{ opacity: canAttach ? 1 : 0.5 }}
                                                                            title={
                                                                                !canAttach
                                                                                    ? "Set session + intention text first"
                                                                                    : attached
                                                                                        ? "Already attached (will still be safe)"
                                                                                        : "Attach intention to the session (shows in room)"
                                                                            }
                                                                        >
                                                                            {attachingItemId === it.id ? "Attaching…" : attached ? "Attached" : "Attach to session"}
                                                                        </button>

                                                                        <div className="text-[11px] text-[#606060]">Attach = create real intention row for that session.</div>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>

                                        {/* library */}
                                        <div className="mt-6 border border-[#F0F0F0] rounded-[22px] p-4 md:p-5">
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-[14px] font-bold text-[#111827]">My library</div>
                                                    <div className="mt-1 text-[12px] text-[#606060]">Your recent intentions (unique by text). Click to fill “Add item”.</div>
                                                </div>

                                                <button className={btnGhost} onClick={() => loadLibrary()} type="button" title="Refresh library">
                                                    <span className="inline-flex items-center gap-2">
                                                        <RefreshCw size={16} />
                                                        Refresh
                                                    </span>
                                                </button>
                                            </div>

                                            <div className="mt-4">
                                                {loadingLibrary ? (
                                                    <div className="text-[13px] text-[#606060] italic">Loading…</div>
                                                ) : library.length === 0 ? (
                                                    <div className="text-[13px] text-[#606060] italic">No recent intentions yet. Attach some intentions in rooms first, or create items above.</div>
                                                ) : (
                                                    <div className="flex flex-col gap-2">
                                                        {library.map((it) => {
                                                            const text = String(it.text || "").trim();
                                                            const deleting = deletingLibraryText === text.toLowerCase();

                                                            return (
                                                                <div key={it.id} className="rounded-[18px] border border-[#F0F0F0] hover:bg-[#F6F6F6] hover:border-[#E5E7EB] transition px-4 py-3 flex items-center gap-3">
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="text-[13px] text-[#111827] break-words leading-5">{text}</div>
                                                                        <div className="mt-1 text-[11px] text-[#606060]">{it.created_at ? `Last used: ${fmtWhen(it.created_at)}` : ""}</div>
                                                                    </div>

                                                                    <div className="flex items-center gap-2 shrink-0">
                                                                        <button
                                                                            className="h-10 px-4 rounded-full border border-[#111827] text-[#111827] hover:bg-[#111827] hover:text-white transition text-[12px] font-semibold whitespace-nowrap"
                                                                            onClick={() => addLibraryTextToPlan(text)}
                                                                            type="button"
                                                                        >
                                                                            Use
                                                                        </button>

                                                                        <button
                                                                            className="h-10 w-10 rounded-full border border-[#E5E7EB] hover:bg-[#F3F4F6] transition flex items-center justify-center"
                                                                            onClick={() => deleteLibraryText(text)}
                                                                            type="button"
                                                                            disabled={deleting}
                                                                            title="Delete this intention from library"
                                                                            style={{ opacity: deleting ? 0.6 : 1 }}
                                                                        >
                                                                            <Trash2 size={16} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="mt-6">
                        <div className={softCard}>
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <div className="text-[18px] font-bold text-[#111827]">Focus measurements</div>
                                    <div className="mt-1 text-[13px] text-[#606060]">
                                        Saved work intervals for the selected focus plan.
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setMeasurementsRefreshNonce((value) => value + 1)}
                                        className={btnGhost}
                                        disabled={measurementsLoading}
                                        title="Reload measurements from Supabase"
                                    >
                                        <span className="inline-flex items-center gap-2">
                                            <RefreshCw
                                                size={16}
                                                className={measurementsLoading ? "animate-spin" : ""}
                                            />
                                            Refresh
                                        </span>
                                    </button>

                                    <div className="rounded-[16px] bg-[#2F2F2F] px-4 py-3 text-white">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/60">
                                            Total measured
                                        </div>
                                        <div className="mt-1 text-[20px] font-bold">
                                            {fmtDuration(visibleMeasuredMs)}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {measurementsError ? (
                                <div className="mt-4 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
                                    {measurementsError}
                                </div>
                            ) : null}

                            {usingAllMeasurementsFallback ? (
                                <div className="mt-4 rounded-[14px] border border-[#D8DCE3] bg-[#F8F8F8] px-4 py-3 text-[12px] leading-5 text-[#475467]">
                                    These measurements are saved in Supabase, but older rows are not linked to a specific Focus Plan item.
                                    They are shown here instead of being hidden. New linked measurements will automatically be grouped under the selected plan.
                                </div>
                            ) : null}

                            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-[#667085]">
                                <span className="rounded-full border border-[#E5E7EB] bg-white px-3 py-1.5">
                                    {allMeasurements.length} total saved
                                </span>
                                <span className="rounded-full border border-[#E5E7EB] bg-white px-3 py-1.5">
                                    {planMeasurements.length} linked to selected plan
                                </span>
                            </div>

                            {measurementsLoading ? (
                                <div className="mt-6 text-[13px] italic text-[#606060]">Loading measurements…</div>
                            ) : !selectedPlan ? (
                                <div className="mt-6 text-[13px] italic text-[#606060]">
                                    Select a plan to see its measurements.
                                </div>
                            ) : visibleMeasurements.length === 0 ? (
                                <div className="mt-6 rounded-[18px] border border-dashed border-[#D8DCE3] bg-[#FAFAFA] px-5 py-8 text-center">
                                    <TimerReset className="mx-auto text-[#98A2B3]" size={24} />
                                    <div className="mt-3 text-[14px] font-semibold text-[#344054]">
                                        No saved time yet
                                    </div>
                                    <div className="mt-1 text-[12px] text-[#667085]">
                                        Start a task timer in the room and press Save. The interval will appear here.
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-6 overflow-x-auto">
                                    <div className="min-w-full rounded-[18px] border border-[#E5E7EB] overflow-hidden bg-white">
                                        {measurementsByTask.map((group) => {
                                            const linkedItem = group.focusPlanItemId
                                                ? items.find(
                                                    (item) =>
                                                        String(item.id) ===
                                                        String(group.focusPlanItemId),
                                                )
                                                : items.find(
                                                    (item) =>
                                                        normalizeTaskText(item.text) ===
                                                        normalizeTaskText(group.taskText),
                                                );

                                            return (
                                                <div
                                                    key={group.key}
                                                    className="grid grid-cols-[1fr_140px_160px] items-center border-b border-[#E5E7EB] px-4 py-3 last:border-b-0"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="min-w-0">
                                                            <div className="truncate text-[14px] font-semibold text-[#111827]">
                                                                {linkedItem?.text || group.taskText}
                                                            </div>
                                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#667085]">
                                                                <span>
                                                                    {group.measurements.length} saved{" "}
                                                                    {group.measurements.length === 1
                                                                        ? "interval"
                                                                        : "intervals"}
                                                                </span>
                                                                {linkedItem ? (
                                                                    <span className="rounded-full border border-[#D8DCE3] bg-white px-2 py-0.5">
                                                                        Linked to plan
                                                                    </span>
                                                                ) : (
                                                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                                                                        Unlinked measurement
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="text-[12px] font-semibold text-[#111827]">{group.measurements.length}</div><div className="text-[12px] font-bold text-[#111827]">{fmtDuration(group.totalMs)}</div>
                                                    </div>

                                                    <div className="mt-3 divide-y divide-[#E5E7EB] rounded-[14px] border border-[#E5E7EB] bg-white">
                                                        {group.measurements.map((measurement) => (
                                                            <div
                                                                key={measurement.id}
                                                                className="flex items-center justify-between gap-3 px-3 py-2.5"
                                                            >
                                                                <div className="min-w-0">
                                                                    <div className="text-[11px] text-[#667085]">
                                                                        {fmtWhen(measurement.saved_at) ||
                                                                            "Saved interval"}
                                                                    </div>
                                                                    {measurement.session_id ? (
                                                                        <div className="mt-0.5 truncate text-[10px] text-[#98A2B3]">
                                                                            Session: {measurement.session_id}
                                                                        </div>
                                                                    ) : null}
                                                                </div>
                                                                <div className="text-[12px] font-semibold text-[#344054]">
                                                                    {fmtDuration(measurement.elapsed_ms)}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                            )}
                                </div>
                    </div>
                )}
                    </div>
        </div>
            );
}