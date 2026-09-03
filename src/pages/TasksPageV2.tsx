import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  ListChecks,
  ListPlus,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TimerReset,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
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
  target_date: string | null;
  session_id: string | null;
  created_at: string;
  completed: boolean;
  sort_order: number;
};

type RecurrenceUnit = "day" | "week" | "month" | "year";

type RecurringTask = {
  id: string;
  user_id: string;
  plan_id: string | null;
  text: string;
  interval_value: number;
  interval_unit: RecurrenceUnit;
  starts_on: string;
  next_run_on: string;
  last_generated_on: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
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

type SessionLite = TaskSessionOption;

type EditTaskDraft = {
  id: string;
  text: string;
  session_id: string;
};

type EditRecurringDraft = {
  id: string;
  text: string;
  plan_id: string;
  interval_value: number;
  interval_unit: RecurrenceUnit;
  starts_on: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const TASK_TIME_MEASUREMENTS_STORAGE_PREFIX = "mysession_task_time_measurements_v1";

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeTaskText(value: unknown) {
  return safeText(value).replace(/\s+/g, " ").toLowerCase();
}

function loginNext(path: string) {
  return `/login?next=${encodeURIComponent(path || "/tasks")}`;
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

function fmtWhen(value?: string | null) {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtShortDate(value?: string | null) {
  if (!value) return "—";
  const ms = Date.parse(`${value}T00:00:00`);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fmtTaskCreatedAt(createdAt?: string | null) {
  if (!createdAt) return "—";
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function intervalMax(unit: RecurrenceUnit) {
  if (unit === "day") return 365;
  if (unit === "week") return 52;
  if (unit === "month") return 12;
  return 1;
}

function clampInterval(value: number, unit: RecurrenceUnit) {
  const next = Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.min(intervalMax(unit), Math.max(1, next));
}

function recurrenceLabel(task: Pick<RecurringTask, "interval_value" | "interval_unit">) {
  const value = Math.max(1, Number(task.interval_value || 1));
  const unit = task.interval_unit;
  if (value === 1 && unit === "day") return "Every day";
  if (value === 1 && unit === "week") return "Every week";
  if (value === 1 && unit === "month") return "Monthly";
  if (value === 1 && unit === "year") return "Every year";
  const plural = value === 1 ? unit : `${unit}s`;
  return `Every ${value} ${plural}`;
}

function nextDateFrom(start: string, value: number, unit: RecurrenceUnit) {
  const base = new Date(`${start}T12:00:00`);
  if (Number.isNaN(base.getTime())) return start;
  const amount = clampInterval(value, unit);
  if (unit === "day") base.setDate(base.getDate() + amount);
  if (unit === "week") base.setDate(base.getDate() + amount * 7);
  if (unit === "month") base.setMonth(base.getMonth() + amount);
  if (unit === "year") base.setFullYear(base.getFullYear() + amount);
  return base.toISOString().slice(0, 10);
}

function taskMeasurementsKey(userId: string) {
  return `${TASK_TIME_MEASUREMENTS_STORAGE_PREFIX}:${safeText(userId).toLowerCase() || "anon"}`;
}

function readLocalMeasurements(userId: string): TaskTimeMeasurement[] {
  try {
    const raw = window.localStorage.getItem(taskMeasurementsKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row: any) => ({
        id: String(row?.id || ""),
        user_id: String(row?.user_id || ""),
        session_id: row?.session_id ? String(row.session_id) : null,
        session_intention_id: row?.session_intention_id
          ? String(row.session_intention_id)
          : null,
        focus_plan_item_id: row?.focus_plan_item_id
          ? String(row.focus_plan_item_id)
          : null,
        task_text: safeText(row?.task_text),
        elapsed_ms: Math.max(0, Math.round(Number(row?.elapsed_ms || 0))),
        saved_at: String(row?.saved_at || ""),
      }))
      .filter((row) => row.id && row.task_text && row.elapsed_ms > 0)
      .slice(0, 500);
  } catch {
    return [];
  }
}

function IconMask({
  src,
  fallback,
  size = 15,
}: {
  src: string;
  fallback: ReactNode;
  size?: number;
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
      className="inline-block shrink-0 bg-current"
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
  const lower = title.toLowerCase();
  if (lower.includes("plan")) return "📋";
  if (lower.includes("pool")) return "📚";
  if (lower.includes("market")) return "🌐";
  if (lower.includes("essential")) return "🟡";
  return ["🗂️", "🎯", "📌", "🧩", "📝"][index % 5];
}

export default function TasksPageV2() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionParam = safeText(searchParams.get("sessionId"));

  const [user, setUser] = useState<any>(null);
  const [plans, setPlans] = useState<FocusPlan[]>([]);
  const [items, setItems] = useState<FocusPlanItem[]>([]);
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [recurringTasks, setRecurringTasks] = useState<RecurringTask[]>([]);
  const [measurements, setMeasurements] = useState<TaskTimeMeasurement[]>([]);

  const [plansLoading, setPlansLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [recurringLoading, setRecurringLoading] = useState(false);
  const [measurementsLoading, setMeasurementsLoading] = useState(false);
  const [recurringDbReady, setRecurringDbReady] = useState(true);

  const [pageMode, setPageMode] = useState<"tasks" | "recurring">("tasks");
  const [utilityMode, setUtilityMode] = useState<"none" | "measurements">("none");
  const [activeListId, setActiveListId] = useState("all");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [dateSortDescending, setDateSortDescending] = useState(false);

  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskSessionId, setNewTaskSessionId] = useState("");
  const [editTask, setEditTask] = useState<EditTaskDraft | null>(null);
  const [sessionPickerItemId, setSessionPickerItemId] = useState<string | null>(null);
  const [sessionPickerValue, setSessionPickerValue] = useState("");

  const [showNewListInput, setShowNewListInput] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState("");
  const [renamingPlanId, setRenamingPlanId] = useState<string | null>(null);
  const [renamePlanTitle, setRenamePlanTitle] = useState("");

  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [newRecurringText, setNewRecurringText] = useState("");
  const [newRecurringPlanId, setNewRecurringPlanId] = useState("");
  const [newRecurringValue, setNewRecurringValue] = useState(1);
  const [newRecurringUnit, setNewRecurringUnit] = useState<RecurrenceUnit>("day");
  const [newRecurringStartsOn, setNewRecurringStartsOn] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [editRecurring, setEditRecurring] = useState<EditRecurringDraft | null>(null);

  const [measurementsError, setMeasurementsError] = useState<string | null>(null);
  const [measurementsNonce, setMeasurementsNonce] = useState(0);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const quickAddRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUser(data.user || null));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  const requireAuth = () => {
    if (user?.id) return true;
    navigate(loginNext("/tasks"));
    return false;
  };

  const reloadPlans = async () => {
    if (!user?.id) return;
    setPlansLoading(true);
    try {
      const { data, error } = await supabase
        .from("focus_plans")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const next = (Array.isArray(data) ? data : []) as FocusPlan[];
      setPlans(next);
      setSelectedPlanId((current) => {
        if (current && next.some((plan) => plan.id === current)) return current;
        return next[0]?.id || null;
      });
    } catch {
      setPlans([]);
      setSelectedPlanId(null);
    } finally {
      setPlansLoading(false);
    }
  };

  const reloadItems = async () => {
    if (!user?.id) return;
    setItemsLoading(true);
    try {
      const { data, error } = await supabase
        .from("focus_plan_items")
        .select("id,plan_id,user_id,text,target_date,session_id,created_at,completed,sort_order")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      setItems((Array.isArray(data) ? data : []) as FocusPlanItem[]);
    } catch {
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  };

  const reloadSessions = async () => {
    if (!user?.id) return;
    setSessionsLoading(true);
    try {
      setSessions(await loadEligibleTaskSessions(user.id));
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  };

  const materializeRecurring = async () => {
    if (!user?.id) return;
    try {
      const { error } = await supabase.rpc("materialize_recurring_tasks");
      if (error) throw error;
      setRecurringDbReady(true);
    } catch {
      setRecurringDbReady(false);
    }
  };

  const reloadRecurring = async () => {
    if (!user?.id) return;
    setRecurringLoading(true);
    try {
      const { data, error } = await supabase
        .from("recurring_tasks")
        .select("id,user_id,plan_id,text,interval_value,interval_unit,starts_on,next_run_on,last_generated_on,active,created_at,updated_at")
        .eq("user_id", user.id)
        .order("active", { ascending: false })
        .order("next_run_on", { ascending: true });
      if (error) throw error;
      setRecurringTasks((Array.isArray(data) ? data : []) as RecurringTask[]);
      setRecurringDbReady(true);
    } catch {
      setRecurringTasks([]);
      setRecurringDbReady(false);
    } finally {
      setRecurringLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    void Promise.all([reloadPlans(), reloadItems(), reloadSessions()]);
    void (async () => {
      await materializeRecurring();
      await Promise.all([reloadRecurring(), reloadItems()]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!sessionParam || !UUID_RE.test(sessionParam)) return;
    if (sessions.some((session) => String(session.id) === sessionParam)) {
      setNewTaskSessionId((current) => current || sessionParam);
    }
  }, [sessionParam, sessions]);

  useEffect(() => {
    if (!sessionParam) return;
    if (searchParams.get("sessionId") === sessionParam) return;
    const next = new URLSearchParams(searchParams);
    next.set("sessionId", sessionParam);
    setSearchParams(next, { replace: true });
  }, [searchParams, sessionParam, setSearchParams]);

  useEffect(() => {
    if (!user?.id) {
      setMeasurements([]);
      setMeasurementsError(null);
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      setMeasurementsLoading(true);
      setMeasurementsError(null);
      const local = readLocalMeasurements(user.id);
      try {
        const { data, error } = await supabase
          .from("task_time_measurements")
          .select("id,user_id,session_id,session_intention_id,focus_plan_item_id,task_text,elapsed_ms,saved_at")
          .eq("user_id", user.id)
          .order("saved_at", { ascending: false })
          .limit(500);
        if (cancelled) return;
        if (error) throw error;
        const merged = new Map<string, TaskTimeMeasurement>();
        [...((Array.isArray(data) ? data : []) as TaskTimeMeasurement[]), ...local].forEach(
          (row) => {
            if (!merged.has(row.id)) merged.set(row.id, row);
          },
        );
        setMeasurements(
          Array.from(merged.values()).sort(
            (a, b) => Date.parse(b.saved_at || "") - Date.parse(a.saved_at || ""),
          ),
        );
      } catch (error: any) {
        if (cancelled) return;
        setMeasurements(local);
        setMeasurementsError(
          String(error?.message || "Measurements are currently available only on this device."),
        );
      } finally {
        if (!cancelled) setMeasurementsLoading(false);
      }
    };

    void refresh();
    const onMeasurements = () => void refresh();
    window.addEventListener("mysession:task-time-measurements-updated", onMeasurements);
    return () => {
      cancelled = true;
      window.removeEventListener("mysession:task-time-measurements-updated", onMeasurements);
    };
  }, [measurementsNonce, user?.id]);

  const eligibleSessionIds = useMemo(
    () => new Set(sessions.map((session) => String(session.id))),
    [sessions],
  );

  const completedCount = useMemo(
    () => items.filter((item) => Boolean(item.completed)).length,
    [items],
  );

  const allTasksCount = useMemo(
    () => items.filter((item) => !item.completed).length,
    [items],
  );

  const planTaskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      if (item.completed) return;
      counts[item.plan_id] = (counts[item.plan_id] || 0) + 1;
    });
    return counts;
  }, [items]);

  const visibleItems = useMemo(() => {
    let next = [...items];

    if (activeListId === "completed") {
      next = next.filter((item) => item.completed);
    } else {
      next = next.filter((item) => !item.completed);
      if (activeListId !== "all") {
        next = next.filter((item) => item.plan_id === activeListId);
      }
    }

    const query = normalizeTaskText(taskSearch);
    if (query) next = next.filter((item) => normalizeTaskText(item.text).includes(query));

    next.sort((a, b) => {
      const createdDiff = Date.parse(a.created_at || "") - Date.parse(b.created_at || "");
      if (createdDiff !== 0) return dateSortDescending ? -createdDiff : createdDiff;
      const orderDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
      return dateSortDescending ? -orderDiff : orderDiff;
    });
    return next;
  }, [activeListId, dateSortDescending, items, taskSearch]);

  const visibleRecurring = useMemo(() => {
    const query = normalizeTaskText(taskSearch);
    const next = recurringTasks.filter((task) => !query || normalizeTaskText(task.text).includes(query));
    return [...next].sort((a, b) => {
      const diff = Date.parse(`${a.next_run_on}T00:00:00`) - Date.parse(`${b.next_run_on}T00:00:00`);
      return dateSortDescending ? -diff : diff;
    });
  }, [dateSortDescending, recurringTasks, taskSearch]);

  const currentListTitle = useMemo(() => {
    if (activeListId === "completed") return "Completed Tasks";
    if (activeListId === "all") return "All Tasks";
    return plans.find((plan) => plan.id === activeListId)?.title || "All Tasks";
  }, [activeListId, plans]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) || null,
    [plans, selectedPlanId],
  );

  const visibleMeasurements = useMemo(() => {
    if (activeListId === "all" || activeListId === "completed") return measurements;
    const planItemIds = new Set(
      items.filter((item) => item.plan_id === activeListId).map((item) => item.id),
    );
    return measurements.filter((row) => row.focus_plan_item_id && planItemIds.has(row.focus_plan_item_id));
  }, [activeListId, items, measurements]);

  const totalMeasuredMs = useMemo(
    () => visibleMeasurements.reduce((sum, row) => sum + Math.max(0, Number(row.elapsed_ms || 0)), 0),
    [visibleMeasurements],
  );

  useEffect(() => {
    if (activeListId === "all" || activeListId === "completed") return;
    if (!plans.some((plan) => plan.id === activeListId)) setActiveListId("all");
  }, [activeListId, plans]);

  useEffect(() => {
    if (newRecurringPlanId) return;
    if (selectedPlanId) setNewRecurringPlanId(selectedPlanId);
    else if (plans[0]?.id) setNewRecurringPlanId(plans[0].id);
  }, [newRecurringPlanId, plans, selectedPlanId]);

  const createPlan = async () => {
    if (!requireAuth()) return;
    const title = safeText(newPlanTitle);
    if (!title) return;
    const { data, error } = await supabase
      .from("focus_plans")
      .insert({ user_id: user.id, title })
      .select("*")
      .single();
    if (error || !data) return;
    const plan = data as FocusPlan;
    setNewPlanTitle("");
    setShowNewListInput(false);
    await reloadPlans();
    setSelectedPlanId(plan.id);
    setActiveListId(plan.id);
  };

  const saveRenamePlan = async () => {
    if (!requireAuth() || !renamingPlanId) return;
    const title = safeText(renamePlanTitle);
    if (!title) return;
    const { error } = await supabase
      .from("focus_plans")
      .update({ title })
      .eq("id", renamingPlanId)
      .eq("user_id", user.id);
    if (error) return;
    setRenamingPlanId(null);
    setRenamePlanTitle("");
    await reloadPlans();
  };

  const deletePlan = async (planId: string) => {
    if (!requireAuth()) return;
    const { error } = await supabase
      .from("focus_plans")
      .delete()
      .eq("id", planId)
      .eq("user_id", user.id);
    if (error) return;
    if (activeListId === planId) setActiveListId("all");
    if (selectedPlanId === planId) setSelectedPlanId(null);
    await Promise.all([reloadPlans(), reloadItems(), reloadRecurring()]);
  };

  const targetPlanIdForNewTask = () => {
    if (activeListId !== "all" && activeListId !== "completed") return activeListId;
    if (selectedPlanId) return selectedPlanId;
    return plans[0]?.id || null;
  };

  const addTask = async () => {
    if (!requireAuth()) return;
    const text = safeText(newTaskText);
    const planId = targetPlanIdForNewTask();
    if (!text || !planId) return;
    const sessionId = safeText(newTaskSessionId);
    if (sessionId && !eligibleSessionIds.has(sessionId)) return;

    const maxSort = items
      .filter((item) => item.plan_id === planId)
      .reduce((max, item) => Math.max(max, Number(item.sort_order || 0)), -1);

    const { data, error } = await supabase
      .from("focus_plan_items")
      .insert({
        user_id: user.id,
        plan_id: planId,
        text,
        target_date: null,
        session_id: sessionId || null,
        sort_order: maxSort + 1,
        completed: false,
      })
      .select("id,plan_id,user_id,text,target_date,session_id,created_at,completed,sort_order")
      .single();
    if (error || !data) return;

    const item = data as FocusPlanItem;
    setItems((current) => [...current, item]);
    setNewTaskText("");

    try {
      await supabase.from("panel_intentions").insert({
        user_id: user.id,
        text: item.text,
        focus_plan_item_id: item.id,
        completed: false,
        visibility: "public",
        sort_order: maxSort + 1,
      });
    } catch {
      // Tasks page stays usable even if panel sync is temporarily unavailable.
    }
  };

  const toggleTaskCompleted = async (item: FocusPlanItem) => {
    if (!requireAuth()) return;
    const next = !item.completed;
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, completed: next } : row)));
    try {
      const { error } = await supabase
        .from("focus_plan_items")
        .update({ completed: next })
        .eq("id", item.id)
        .eq("user_id", user.id);
      if (error) throw error;
      await supabase
        .from("panel_intentions")
        .update({ completed: next })
        .eq("focus_plan_item_id", item.id)
        .eq("user_id", user.id);
    } catch {
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, completed: item.completed } : row)));
    }
  };

  const deleteTask = async (item: FocusPlanItem) => {
    if (!requireAuth()) return;
    const snapshot = items;
    setItems((current) => current.filter((row) => row.id !== item.id));
    try {
      const { error } = await supabase
        .from("focus_plan_items")
        .delete()
        .eq("id", item.id)
        .eq("user_id", user.id);
      if (error) throw error;
      await supabase
        .from("panel_intentions")
        .delete()
        .eq("focus_plan_item_id", item.id)
        .eq("user_id", user.id);
    } catch {
      setItems(snapshot);
    }
  };

  const saveTaskEdit = async () => {
    if (!requireAuth() || !editTask) return;
    const text = safeText(editTask.text);
    if (!text) return;
    const sessionId = safeText(editTask.session_id);
    if (sessionId && !eligibleSessionIds.has(sessionId)) return;
    const original = items.find((item) => item.id === editTask.id);
    if (!original) return;

    const patch = {
      text,
      session_id: sessionId || null,
    };
    const { error } = await supabase
      .from("focus_plan_items")
      .update(patch)
      .eq("id", editTask.id)
      .eq("user_id", user.id);
    if (error) return;

    setItems((current) => current.map((item) => (item.id === editTask.id ? { ...item, ...patch } : item)));
    setEditTask(null);

    await supabase
      .from("panel_intentions")
      .update({ text })
      .eq("focus_plan_item_id", editTask.id)
      .eq("user_id", user.id);
  };

  const assignTaskToSession = async (item: FocusPlanItem) => {
    if (!requireAuth()) return;
    const sessionId = safeText(sessionPickerValue);
    if (!sessionId || !eligibleSessionIds.has(sessionId)) return;
    setActionBusyId(item.id);
    try {
      const { error } = await supabase
        .from("focus_plan_items")
        .update({ session_id: sessionId })
        .eq("id", item.id)
        .eq("user_id", user.id);
      if (error) throw error;
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, session_id: sessionId } : row)));
      setSessionPickerItemId(null);
      setSessionPickerValue("");
    } finally {
      setActionBusyId(null);
    }
  };

  const createRecurringTask = async () => {
    if (!requireAuth()) return;
    const text = safeText(newRecurringText);
    const planId = newRecurringPlanId || plans[0]?.id || "";
    if (!text || !planId || !recurringDbReady) return;
    const intervalValue = clampInterval(newRecurringValue, newRecurringUnit);
    const startsOn = newRecurringStartsOn || new Date().toISOString().slice(0, 10);
    setActionBusyId("new-recurring");
    try {
      const { error } = await supabase.from("recurring_tasks").insert({
        user_id: user.id,
        plan_id: planId,
        text,
        interval_value: intervalValue,
        interval_unit: newRecurringUnit,
        starts_on: startsOn,
        next_run_on: startsOn,
        active: true,
      });
      if (error) throw error;
      setNewRecurringText("");
      setNewRecurringValue(1);
      setNewRecurringUnit("day");
      setShowRecurringForm(false);
      await materializeRecurring();
      await Promise.all([reloadRecurring(), reloadItems()]);
    } finally {
      setActionBusyId(null);
    }
  };

  const saveRecurringEdit = async () => {
    if (!requireAuth() || !editRecurring) return;
    const text = safeText(editRecurring.text);
    if (!text || !editRecurring.plan_id) return;
    const intervalValue = clampInterval(editRecurring.interval_value, editRecurring.interval_unit);
    const startsOn = editRecurring.starts_on || new Date().toISOString().slice(0, 10);
    const original = recurringTasks.find((task) => task.id === editRecurring.id);
    const nextRun = original?.last_generated_on
      ? nextDateFrom(original.last_generated_on, intervalValue, editRecurring.interval_unit)
      : startsOn;
    const { error } = await supabase
      .from("recurring_tasks")
      .update({
        text,
        plan_id: editRecurring.plan_id,
        interval_value: intervalValue,
        interval_unit: editRecurring.interval_unit,
        starts_on: startsOn,
        next_run_on: nextRun,
      })
      .eq("id", editRecurring.id)
      .eq("user_id", user.id);
    if (error) return;
    setEditRecurring(null);
    await reloadRecurring();
  };

  const toggleRecurring = async (task: RecurringTask) => {
    if (!requireAuth()) return;
    const next = !task.active;
    setRecurringTasks((current) => current.map((row) => (row.id === task.id ? { ...row, active: next } : row)));
    const { error } = await supabase
      .from("recurring_tasks")
      .update({ active: next })
      .eq("id", task.id)
      .eq("user_id", user.id);
    if (error) {
      setRecurringTasks((current) => current.map((row) => (row.id === task.id ? { ...row, active: task.active } : row)));
    }
  };

  const deleteRecurring = async (task: RecurringTask) => {
    if (!requireAuth()) return;
    const snapshot = recurringTasks;
    setRecurringTasks((current) => current.filter((row) => row.id !== task.id));
    const { error } = await supabase
      .from("recurring_tasks")
      .delete()
      .eq("id", task.id)
      .eq("user_id", user.id);
    if (error) setRecurringTasks(snapshot);
  };

  const focusAddTask = () => {
    setPageMode("tasks");
    setUtilityMode("none");
    if (activeListId === "completed") setActiveListId("all");
    window.setTimeout(() => quickAddRef.current?.focus(), 0);
  };

  if (!user?.id) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-6 py-10">
        <div className="rounded-[28px] border border-[#E4E4E4] bg-white p-8">
          <h1 className="text-[32px] font-bold text-[#2F2F2F]">Tasks</h1>
          <p className="mt-2 text-[14px] text-[#777]">Log in to manage tasks and recurring work.</p>
          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => navigate(loginNext("/tasks"))} className="rounded-full bg-[#303030] px-5 py-2.5 text-[13px] font-semibold text-white">
              Log in
            </button>
            <Link to="/sessions" className="rounded-full border border-[#DDD] px-5 py-2.5 text-[13px] font-semibold">Back to sessions</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-72px)] bg-white text-[#333]">
      <div className="flex min-h-[calc(100vh-72px)] w-full">
        <main className="min-w-0 flex-1 px-6 pb-14 pt-7 md:px-8 lg:px-9">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
              <button
                type="button"
                onClick={() => {
                  setPageMode("tasks");
                  setUtilityMode("none");
                }}
                className={[
                  "tracking-[-0.02em] transition",
                  pageMode === "tasks" && utilityMode === "none"
                    ? "text-[27px] font-bold text-[#303030]"
                    : "text-[19px] font-medium text-[#555] hover:text-[#303030]",
                ].join(" ")}
              >
                {currentListTitle}
              </button>
              <span className="text-[19px] font-medium text-[#555]">/</span>
              <button
                type="button"
                onClick={() => {
                  setPageMode("recurring");
                  setUtilityMode("none");
                  void materializeRecurring().then(() => Promise.all([reloadRecurring(), reloadItems()]));
                }}
                className={[
                  "transition",
                  pageMode === "recurring" && utilityMode === "none"
                    ? "text-[27px] font-bold tracking-[-0.02em] text-[#303030]"
                    : "text-[19px] font-medium text-[#555] hover:text-[#303030]",
                ].join(" ")}
              >
                Recurring Tasks
              </button>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2 xl:flex-nowrap">
              <label className="flex h-9 w-[210px] items-center gap-2 rounded-[10px] border border-[#D9D9D9] bg-white px-3 text-[#888]">
                <Search size={14} strokeWidth={1.8} />
                <input
                  value={taskSearch}
                  onChange={(event) => setTaskSearch(event.target.value)}
                  placeholder="Search tasks..."
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-[#444] outline-none placeholder:text-[#9B9B9B]"
                />
              </label>
              <button
                type="button"
                onClick={() => setDateSortDescending((value) => !value)}
                className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#D9D9D9] bg-white px-4 text-[12px] font-medium text-[#4A4A4A] transition hover:bg-[#F8F8F8]"
                title={dateSortDescending ? "Newest first" : "Oldest first"}
              >
                Sort by: Created
                <SlidersHorizontal size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => setUtilityMode((mode) => (mode === "measurements" ? "none" : "measurements"))}
                className={[
                  "inline-flex h-9 w-11 items-center justify-center rounded-[10px] border transition",
                  utilityMode === "measurements"
                    ? "border-[#303030] bg-[#303030] text-white"
                    : "border-[#D9D9D9] bg-white text-[#555] hover:bg-[#F8F8F8]",
                ].join(" ")}
                title="Measurements"
              >
                <IconMask src="/icons/tasks-page-measurements.svg" fallback={<BarChart3 size={16} />} size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pageMode === "recurring") {
                    setUtilityMode("none");
                    setShowRecurringForm(true);
                  } else {
                    focusAddTask();
                  }
                }}
                disabled={plans.length === 0}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#303030] px-5 text-[12px] font-medium text-white transition hover:bg-[#1F1F1F] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={13} /> Add Task
              </button>
            </div>
          </div>

          {utilityMode === "measurements" ? (
            <section className="mt-8 rounded-[14px] border border-[#E0E0E0] bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[16px] font-semibold">Focus measurements</h2>
                  <p className="mt-1 text-[12px] text-[#888]">Saved focus-time intervals from task timers.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setMeasurementsNonce((value) => value + 1)} className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#DDD] px-3 text-[12px]">
                    <RefreshCw size={13} className={measurementsLoading ? "animate-spin" : ""} /> Refresh
                  </button>
                  <div className="rounded-[9px] bg-[#303030] px-4 py-2 text-white">
                    <div className="text-[9px] uppercase tracking-[0.08em] text-white/60">Total</div>
                    <div className="text-[14px] font-semibold">{fmtDuration(totalMeasuredMs)}</div>
                  </div>
                </div>
              </div>
              {measurementsError ? <div className="mt-4 rounded-[9px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{measurementsError}</div> : null}
              {measurementsLoading ? (
                <div className="py-14 text-center text-[12px] text-[#888]">Loading measurements…</div>
              ) : visibleMeasurements.length === 0 ? (
                <div className="py-16 text-center">
                  <TimerReset size={26} className="mx-auto text-[#999]" />
                  <div className="mt-3 text-[14px] font-semibold">No saved time yet</div>
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-[11px] border border-[#E3E3E3]">
                  {visibleMeasurements.map((row) => (
                    <div key={row.id} className="grid grid-cols-[minmax(220px,1fr)_120px_170px] items-center border-b border-[#ECECEC] px-4 py-3 text-[12px] last:border-b-0">
                      <span className="truncate pr-4">{row.task_text}</span>
                      <span className="font-medium">{fmtDuration(row.elapsed_ms)}</span>
                      <span className="text-[#888]">{fmtWhen(row.saved_at) || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : pageMode === "recurring" ? (
            <section className="mt-8">
              {!recurringDbReady ? (
                <div className="mb-4 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
                  Recurring Tasks needs the new recurring-tasks database migration before it can save schedules.
                </div>
              ) : null}

              {showRecurringForm ? (
                <div className="mb-4 rounded-[13px] border border-[#DEDEDE] bg-[#FAFAFA] p-4">
                  <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_190px_110px_130px_150px_auto]">
                    <input value={newRecurringText} onChange={(event) => setNewRecurringText(event.target.value)} placeholder="Recurring task name..." className="h-10 rounded-[9px] border border-[#D8D8D8] bg-white px-3 text-[12px] outline-none" />
                    <select value={newRecurringPlanId} onChange={(event) => setNewRecurringPlanId(event.target.value)} className="h-10 rounded-[9px] border border-[#D8D8D8] bg-white px-2 text-[12px] outline-none">
                      {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}
                    </select>
                    <input type="number" min={1} max={intervalMax(newRecurringUnit)} value={newRecurringValue} onChange={(event) => setNewRecurringValue(clampInterval(Number(event.target.value), newRecurringUnit))} className="h-10 rounded-[9px] border border-[#D8D8D8] bg-white px-3 text-[12px] outline-none" title="Interval" />
                    <select value={newRecurringUnit} onChange={(event) => {
                      const unit = event.target.value as RecurrenceUnit;
                      setNewRecurringUnit(unit);
                      setNewRecurringValue((value) => clampInterval(value, unit));
                    }} className="h-10 rounded-[9px] border border-[#D8D8D8] bg-white px-2 text-[12px] outline-none">
                      <option value="day">day(s)</option>
                      <option value="week">week(s)</option>
                      <option value="month">month(s)</option>
                      <option value="year">year</option>
                    </select>
                    <input type="date" value={newRecurringStartsOn} onChange={(event) => setNewRecurringStartsOn(event.target.value)} className="h-10 rounded-[9px] border border-[#D8D8D8] bg-white px-2 text-[12px] outline-none" />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void createRecurringTask()} disabled={!recurringDbReady || !newRecurringText.trim() || !newRecurringPlanId || actionBusyId === "new-recurring"} className="h-10 rounded-[9px] bg-[#303030] px-4 text-[12px] font-medium text-white disabled:opacity-40">Create</button>
                      <button type="button" onClick={() => setShowRecurringForm(false)} className="flex h-10 w-10 items-center justify-center rounded-[9px] border border-[#D8D8D8] bg-white"><X size={15} /></button>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-[#8D8D8D]">Custom intervals are supported from every day up to every year, including every 2, 3, 42, 45, or 365 days.</div>
                </div>
              ) : null}

              <div className="mb-4 flex items-center gap-2 text-[18px] font-semibold text-[#333]">
                <RefreshCw size={18} strokeWidth={1.8} /> Recurring Tasks
              </div>

              {recurringLoading ? (
                <div className="py-16 text-center text-[12px] text-[#888]">Loading recurring tasks…</div>
              ) : visibleRecurring.length === 0 ? (
                <div className="rounded-[14px] border border-[#E2E2E2] py-20 text-center">
                  <RefreshCw size={28} className="mx-auto text-[#A0A0A0]" />
                  <h2 className="mt-4 text-[18px] font-semibold">No recurring tasks yet</h2>
                  <p className="mt-1 text-[12px] text-[#888]">Create one and it will automatically generate a normal task when it becomes due.</p>
                  <button type="button" onClick={() => setShowRecurringForm(true)} className="mt-5 rounded-full bg-[#303030] px-5 py-2 text-[12px] font-medium text-white">+ Add recurring task</button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {visibleRecurring.map((task) => {
                    const editing = editRecurring?.id === task.id;
                    return (
                      <div key={task.id} className={[
                        "rounded-[13px] border px-4 py-3.5 transition",
                        task.active ? "border-[#E0E0E0] bg-white" : "border-[#E8E8E8] bg-[#FBFBFB] opacity-65",
                      ].join(" ")}>
                        {editing && editRecurring ? (
                          <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_190px_110px_130px_150px_auto]">
                            <input value={editRecurring.text} onChange={(event) => setEditRecurring({ ...editRecurring, text: event.target.value })} className="h-10 rounded-[9px] border border-[#D8D8D8] bg-white px-3 text-[12px] outline-none" />
                            <select value={editRecurring.plan_id} onChange={(event) => setEditRecurring({ ...editRecurring, plan_id: event.target.value })} className="h-10 rounded-[9px] border border-[#D8D8D8] bg-white px-2 text-[12px] outline-none">
                              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}
                            </select>
                            <input type="number" min={1} max={intervalMax(editRecurring.interval_unit)} value={editRecurring.interval_value} onChange={(event) => setEditRecurring({ ...editRecurring, interval_value: clampInterval(Number(event.target.value), editRecurring.interval_unit) })} className="h-10 rounded-[9px] border border-[#D8D8D8] bg-white px-3 text-[12px] outline-none" />
                            <select value={editRecurring.interval_unit} onChange={(event) => {
                              const unit = event.target.value as RecurrenceUnit;
                              setEditRecurring({ ...editRecurring, interval_unit: unit, interval_value: clampInterval(editRecurring.interval_value, unit) });
                            }} className="h-10 rounded-[9px] border border-[#D8D8D8] bg-white px-2 text-[12px] outline-none">
                              <option value="day">day(s)</option><option value="week">week(s)</option><option value="month">month(s)</option><option value="year">year</option>
                            </select>
                            <input type="date" value={editRecurring.starts_on} onChange={(event) => setEditRecurring({ ...editRecurring, starts_on: event.target.value })} className="h-10 rounded-[9px] border border-[#D8D8D8] bg-white px-2 text-[12px] outline-none" />
                            <div className="flex gap-2"><button type="button" onClick={() => void saveRecurringEdit()} className="h-10 rounded-[9px] bg-[#303030] px-4 text-[12px] text-white">Save</button><button type="button" onClick={() => setEditRecurring(null)} className="flex h-10 w-10 items-center justify-center rounded-[9px] border border-[#D8D8D8] bg-white"><X size={15} /></button></div>
                          </div>
                        ) : (
                          <div className="flex min-h-[38px] items-center gap-4">
                            <RefreshCw size={17} className="shrink-0 text-[#777]" strokeWidth={1.8} />
                            <div className={[
                              "min-w-0 flex-1 truncate text-[14px]",
                              task.active ? "text-[#333]" : "text-[#7F7F7F]",
                            ].join(" ")}>{task.text}</div>
                            <div className="hidden shrink-0 rounded-full border border-[#E3E3E3] bg-[#FAFAFA] px-3 py-1 text-[11px] font-medium text-[#555] md:block">{recurrenceLabel(task)}</div>
                            <div className="hidden shrink-0 text-[11px] text-[#8A8A8A] lg:block">{task.active ? `Next: ${fmtShortDate(task.next_run_on)}` : "Paused"}</div>
                            <button type="button" onClick={() => setEditRecurring({ id: task.id, text: task.text, plan_id: task.plan_id || plans[0]?.id || "", interval_value: task.interval_value, interval_unit: task.interval_unit, starts_on: task.starts_on })} className="flex h-8 w-8 items-center justify-center rounded-[7px] hover:bg-[#F2F2F2]" title="Edit recurring task"><img src="/icons/edit_profile.svg" alt="" aria-hidden="true" className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => void deleteRecurring(task)} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[#E07A7A] hover:bg-[#FFF1F1]" title="Delete recurring task"><IconMask src="/icons/tasks-page-delete.svg" fallback={<Trash2 size={14} />} size={14} /></button>
                            <button type="button" onClick={() => void toggleRecurring(task)} className={[
                              "relative h-[24px] w-[42px] shrink-0 rounded-full transition",
                              task.active ? "bg-[#5BD36B]" : "bg-[#ECEEF1]",
                            ].join(" ")} aria-label={task.active ? "Pause recurring task" : "Resume recurring task"}>
                              <span className={[
                                "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-all",
                                task.active ? "left-[21px]" : "left-[3px]",
                              ].join(" ")} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ) : itemsLoading ? (
            <div className="flex min-h-[480px] items-center justify-center text-[12px] text-[#888]">Loading tasks…</div>
          ) : visibleItems.length === 0 ? (
            <section className="flex min-h-[560px] items-start justify-center pt-[130px]">
              <div className="w-full max-w-[440px] text-center">
                <div className="mx-auto flex h-[104px] w-[104px] items-center justify-center rounded-full border border-[#E2E2E2] bg-[#FAFAFA] text-[#333]"><ClipboardList size={38} strokeWidth={1.5} /></div>
                <h2 className="mt-7 text-[22px] font-semibold tracking-[-0.02em] text-[#303030]">{taskSearch ? "No tasks found" : activeListId === "completed" ? "No completed tasks yet" : "No tasks set yet"}</h2>
                <p className="mx-auto mt-2 max-w-[390px] text-[13px] leading-[1.4] text-[#888]">{taskSearch ? "Try another search or switch task lists." : activeListId === "completed" ? "Every task you complete is automatically collected here." : "Add your first one in the list. Focus on your deep work sessions with visual goals."}</p>
                {!taskSearch && activeListId !== "completed" ? (
                  <>
                    <div className="mx-auto mt-7 flex h-11 max-w-[410px] items-center overflow-hidden rounded-full border border-[#DEDEDE] bg-white">
                      <input ref={quickAddRef} value={newTaskText} onChange={(event) => setNewTaskText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void addTask()} disabled={plans.length === 0} placeholder="e.g. Prepare presentation slides..." className="h-full min-w-0 flex-1 bg-transparent px-4 text-[12px] outline-none placeholder:text-[#B0B0B0]" />
                      <button type="button" onClick={() => void addTask()} disabled={!newTaskText.trim() || plans.length === 0} className="mr-[-1px] inline-flex h-11 items-center gap-2 rounded-full border border-[#3A3A3A] bg-white px-5 text-[13px] font-medium text-[#3A3A3A] disabled:opacity-40"><span className="flex h-4 w-4 items-center justify-center rounded-full border border-current"><Plus size={10} /></span>Add First Task</button>
                    </div>
                    <button type="button" onClick={() => setShowNewListInput(true)} className="mt-3 text-[12px] font-medium text-[#5E8ED6] underline underline-offset-2">or create a task list first</button>
                  </>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="mt-8 overflow-visible rounded-[12px] border border-[#DCDCDC] bg-white">
              <div className="divide-y divide-[#E5E5E5]">
                {visibleItems.map((item) => {
                  const list = plans.find((plan) => plan.id === item.plan_id);
                  const session = item.session_id ? sessions.find((row) => String(row.id) === String(item.session_id)) : null;
                  const editing = editTask?.id === item.id;
                  const assigning = sessionPickerItemId === item.id;
                  return (
                    <div key={item.id}>
                      <div className="flex min-h-[48px] items-center gap-3 px-4 py-2.5">
                        <button type="button" onClick={() => void toggleTaskCompleted(item)} className={[
                          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition",
                          item.completed ? "border-[#75D67E] bg-[#75D67E] text-white" : "border-[#C9C9C9] bg-white hover:border-[#999]",
                        ].join(" ")}>{item.completed ? <Check size={11} strokeWidth={2.4} /> : null}</button>
                        <div className="min-w-0 flex-1 truncate text-[12px] text-[#3B3B3B]">{item.text}</div>
                        <div className="hidden shrink-0 items-center gap-2 text-[10px] text-[#888] md:flex">
                          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#6B9CF7]" />{list?.title || "Task list"}</span>
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title="Created"><CalendarDays size={13} strokeWidth={1.6} />{fmtTaskCreatedAt(item.created_at)}</span>
                          {session ? <span className="max-w-[130px] truncate">{session.title || "Session"}</span> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 text-[#8D8D8D]">
                          <button type="button" onClick={() => setEditTask({ id: item.id, text: item.text, session_id: item.session_id || "" })} className="flex h-7 w-7 items-center justify-center rounded-[6px] hover:bg-[#F2F2F2]" title="Edit task"><img src="/icons/edit_profile.svg" alt="" aria-hidden="true" className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => { setSessionPickerItemId((current) => current === item.id ? null : item.id); setSessionPickerValue(item.session_id || newTaskSessionId || ""); }} className="flex h-7 w-7 items-center justify-center rounded-[6px] hover:bg-[#F2F2F2]" title="Assign to session"><ListPlus size={14} strokeWidth={1.8} /></button>
                          <button type="button" onClick={() => void deleteTask(item)} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#E07A7A] hover:bg-[#FFF1F1]" title="Delete task"><IconMask src="/icons/tasks-page-delete.svg" fallback={<Trash2 size={14} />} size={14} /></button>
                        </div>
                      </div>
                      {editing && editTask ? (
                        <div className="border-t border-[#ECECEC] bg-[#FBFBFB] px-4 py-3">
                          <div className="grid gap-2 md:grid-cols-[minmax(240px,1fr)_minmax(190px,280px)_auto]">
                            <input value={editTask.text} onChange={(event) => setEditTask({ ...editTask, text: event.target.value })} className="h-9 rounded-[8px] border border-[#D8D8D8] bg-white px-3 text-[12px] outline-none" />
                            <select value={editTask.session_id} onChange={(event) => setEditTask({ ...editTask, session_id: event.target.value })} className="h-9 rounded-[8px] border border-[#D8D8D8] bg-white px-2 text-[11px] outline-none"><option value="">No session</option>{sessions.map((row) => <option key={row.id} value={row.id}>{row.title || "Session"}</option>)}</select>
                            <div className="flex gap-2"><button type="button" onClick={() => void saveTaskEdit()} className="h-9 rounded-[8px] bg-[#303030] px-4 text-[11px] text-white">Save</button><button type="button" onClick={() => setEditTask(null)} className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#D8D8D8] bg-white"><X size={14} /></button></div>
                          </div>
                        </div>
                      ) : null}
                      {assigning ? (
                        <div className="border-t border-[#ECECEC] bg-[#FBFBFB] px-4 py-3">
                          <div className="flex gap-2"><select value={sessionPickerValue} onChange={(event) => setSessionPickerValue(event.target.value)} className="h-9 min-w-[240px] flex-1 rounded-[8px] border border-[#D8D8D8] bg-white px-2 text-[11px]"><option value="">Choose a session…</option>{sessionsLoading ? <option disabled>Loading sessions…</option> : sessions.map((row) => <option key={row.id} value={row.id}>{row.title || "Session"}</option>)}</select><button type="button" onClick={() => void assignTaskToSession(item)} disabled={!sessionPickerValue || actionBusyId === item.id} className="h-9 rounded-[8px] bg-[#303030] px-4 text-[11px] text-white disabled:opacity-40">Assign</button><button type="button" onClick={() => setSessionPickerItemId(null)} className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#D8D8D8] bg-white"><X size={14} /></button></div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {activeListId !== "completed" ? (
                <div className="border-t border-[#E5E5E5] px-4 py-3">
                  <input ref={quickAddRef} value={newTaskText} onChange={(event) => setNewTaskText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void addTask()} placeholder="Type a task name..." className="h-8 w-full bg-transparent px-6 text-[12px] outline-none placeholder:text-[#A9A9A9]" />
                  <button type="button" onClick={() => void addTask()} disabled={!newTaskText.trim() || plans.length === 0} className="mt-1 inline-flex h-7 items-center gap-1 rounded-full bg-[#303030] px-3 text-[10px] font-medium text-white disabled:opacity-40"><Plus size={10} /> Add Task</button>
                </div>
              ) : null}
            </section>
          )}
        </main>

        <aside className="hidden w-[260px] shrink-0 border-l border-[#E5E5E5] bg-white px-5 pb-10 pt-7 min-[900px]:block">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.02em] text-[#707070]">Task Lists</div>
            <button type="button" onClick={() => setShowNewListInput((value) => !value)} className="inline-flex h-7 items-center gap-1 rounded-full border border-[#DADADA] px-2.5 text-[10px] text-[#888] hover:bg-[#F8F8F8]"><Plus size={10} /> Add list</button>
          </div>

          {showNewListInput ? (
            <div className="mt-3 rounded-[9px] border border-[#E0E0E0] bg-[#FAFAFA] p-2.5">
              <input autoFocus value={newPlanTitle} onChange={(event) => setNewPlanTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createPlan(); if (event.key === "Escape") setShowNewListInput(false); }} placeholder="List name..." className="h-8 w-full rounded-[7px] border border-[#D8D8D8] bg-white px-2.5 text-[11px] outline-none" />
              <div className="mt-2 flex gap-2"><button type="button" onClick={() => void createPlan()} disabled={!newPlanTitle.trim()} className="h-7 rounded-[7px] bg-[#303030] px-3 text-[10px] text-white disabled:opacity-40">Create</button><button type="button" onClick={() => { setShowNewListInput(false); setNewPlanTitle(""); }} className="h-7 rounded-[7px] px-2 text-[10px] text-[#777]">Cancel</button></div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-col gap-2">
            <button type="button" onClick={() => { setActiveListId("all"); setPageMode("tasks"); setUtilityMode("none"); }} className={[
              "flex h-10 w-full items-center gap-2 rounded-[8px] px-3 text-left text-[12px] text-[#555] transition hover:bg-[#F3F3F3]",
              activeListId === "all" ? "bg-[#F1F1F1] font-medium" : "",
            ].join(" ")}><ListChecks size={14} /><span className="min-w-0 flex-1 truncate">All Tasks</span><span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#EFEFEF] px-1.5 text-[9px] text-[#999]">{allTasksCount}</span></button>

            <button type="button" onClick={() => { setActiveListId("completed"); setPageMode("tasks"); setUtilityMode("none"); }} className={[
              "flex h-10 w-full items-center gap-2 rounded-[8px] px-3 text-left text-[12px] transition",
              activeListId === "completed" ? "bg-[#DDF7DF] text-[#60C86A] ring-1 ring-inset ring-[#BCEEBF]" : "bg-[#E9F9EA] text-[#6BCF74] hover:bg-[#E0F6E2]",
            ].join(" ")}><CheckCircle2 size={14} /><span className="min-w-0 flex-1 truncate">Completed Tasks</span><span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#68D273] px-1.5 text-[9px] font-semibold text-white">{completedCount}</span></button>

            {plansLoading ? <div className="px-3 py-3 text-[11px] text-[#999]">Loading lists…</div> : plans.map((plan, index) => {
              const active = activeListId === plan.id;
              return (
                <div key={plan.id} className="group relative">
                  <button type="button" onClick={() => { setActiveListId(plan.id); setSelectedPlanId(plan.id); setPageMode("tasks"); setUtilityMode("none"); }} className={[
                    "flex h-10 w-full items-center gap-2 rounded-[8px] px-3 text-left text-[12px] text-[#555] transition hover:bg-[#F3F3F3]",
                    active ? "bg-[#F1F1F1] font-medium" : "",
                  ].join(" ")}><span className="text-[12px]">{planEmoji(plan.title, index)}</span><span className="min-w-0 flex-1 truncate">{plan.title}</span><span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#EFEFEF] px-1.5 text-[9px] text-[#999]">{planTaskCounts[plan.id] || 0}</span></button>
                  {active ? <div className="mt-1 flex items-center justify-end gap-2 px-2"><button type="button" onClick={() => { setRenamingPlanId(plan.id); setRenamePlanTitle(plan.title); }} className="text-[9px] text-[#8A8A8A] hover:text-[#444]">Rename</button><span className="text-[#D0D0D0]">·</span><button type="button" onClick={() => void deletePlan(plan.id)} className="text-[9px] text-[#D98484]">Delete</button></div> : null}
                </div>
              );
            })}
          </div>

          {renamingPlanId ? (
            <div className="mt-3 rounded-[9px] border border-[#E0E0E0] bg-[#FAFAFA] p-2.5">
              <input value={renamePlanTitle} onChange={(event) => setRenamePlanTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveRenamePlan(); if (event.key === "Escape") setRenamingPlanId(null); }} className="h-8 w-full rounded-[7px] border border-[#D8D8D8] bg-white px-2.5 text-[11px] outline-none" />
              <div className="mt-2 flex gap-2"><button type="button" onClick={() => void saveRenamePlan()} className="h-7 rounded-[7px] bg-[#303030] px-3 text-[10px] text-white">Save</button><button type="button" onClick={() => setRenamingPlanId(null)} className="h-7 rounded-[7px] px-2 text-[10px] text-[#777]">Cancel</button></div>
            </div>
          ) : null}

          {selectedPlan ? <div className="mt-6 border-t border-[#F0F0F0] pt-3 text-[10px] leading-4 text-[#9A9A9A]">New tasks added from “All Tasks” go to <span className="font-medium text-[#666]">{selectedPlan.title}</span>.</div> : null}
        </aside>
      </div>
    </div>
  );
}
