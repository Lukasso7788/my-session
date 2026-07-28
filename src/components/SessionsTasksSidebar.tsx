import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, ListChecks, Plus, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  isInfiniteTaskSession,
  loadEligibleTaskSessions,
  type TaskSessionOption,
} from "../lib/taskSessionEligibility";

type TaskPlan = {
  id: string;
  title: string;
};

type TaskItem = {
  id: string;
  plan_id: string;
  user_id: string;
  text: string;
  session_id: string | null;
  completed: boolean;
  created_at: string;
  sort_order: number;
};

type Props = {
  open: boolean;
  userId: string;
  onClose: () => void;
};

function formatSessionTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dispatchTasksUpdated(sessionId?: string | null) {
  window.dispatchEvent(
    new CustomEvent("mysession:tasks-updated", {
      detail: { sessionId: sessionId || null },
    }),
  );
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export default function SessionsTasksSidebar({ open, userId, onClose }: Props) {
  const navigate = useNavigate();
  const [items, setItems] = useState<TaskItem[]>([]);
  const [plans, setPlans] = useState<TaskPlan[]>([]);
  const [sessions, setSessions] = useState<TaskSessionOption[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [String(session.id), session])),
    [sessions],
  );

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError("");

    try {
      const [plansResult, itemsResult, eligibleSessions] = await Promise.all([
        supabase
          .from("focus_plans")
          .select("id,title")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("focus_plan_items")
          .select(
            "id,plan_id,user_id,text,session_id,completed,created_at,sort_order",
          )
          .eq("user_id", userId)
          .order("completed", { ascending: true })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false })
          .limit(250),
        loadEligibleTaskSessions(userId),
      ]);

      if (plansResult.error) throw plansResult.error;
      if (itemsResult.error) throw itemsResult.error;

      setPlans((plansResult.data || []) as TaskPlan[]);
      setItems((itemsResult.data || []) as TaskItem[]);
      setSessions(eligibleSessions);
    } catch (cause: unknown) {
      setError(errorMessage(cause, "Tasks could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  const ensurePlan = async () => {
    const current = plans[0];
    if (current) return current;

    const { data, error: insertError } = await supabase
      .from("focus_plans")
      .insert({ user_id: userId, title: "My tasks" })
      .select("id,title")
      .single();
    if (insertError || !data) throw insertError || new Error("Plan was not created");
    const created = data as TaskPlan;
    setPlans([created]);
    return created;
  };

  const addTask = async () => {
    const text = draft.trim();
    if (!text || busyId) return;
    setBusyId("new");
    setError("");
    try {
      const plan = await ensurePlan();
      const { data, error: insertError } = await supabase
        .from("focus_plan_items")
        .insert({
          user_id: userId,
          plan_id: plan.id,
          text,
          target_date: null,
          session_id: null,
          sort_order: 0,
          completed: false,
        })
        .select(
          "id,plan_id,user_id,text,session_id,completed,created_at,sort_order",
        )
        .single();
      if (insertError || !data) throw insertError || new Error("Task was not created");
      setItems((current) => [data as TaskItem, ...current]);
      setDraft("");
      dispatchTasksUpdated();
    } catch (cause: unknown) {
      setError(errorMessage(cause, "Task could not be created."));
    } finally {
      setBusyId("");
    }
  };

  const assignTask = async (item: TaskItem, nextSessionId: string) => {
    if (busyId) return;
    const nextSession = nextSessionId ? sessionById.get(nextSessionId) : null;
    if (nextSessionId && !nextSession) {
      setError("That session is no longer available for task assignment.");
      return;
    }

    const previousSessionId = String(item.session_id || "");
    setBusyId(item.id);
    setError("");
    setItems((current) =>
      current.map((task) =>
        task.id === item.id
          ? { ...task, session_id: nextSessionId || null }
          : task,
      ),
    );

    try {
      const { error: updateError } = await supabase
        .from("focus_plan_items")
        .update({ session_id: nextSessionId || null })
        .eq("id", item.id)
        .eq("user_id", userId);
      if (updateError) throw updateError;

      if (previousSessionId && previousSessionId !== nextSessionId) {
        await supabase
          .from("intentions")
          .delete()
          .eq("user_id", userId)
          .eq("session_id", previousSessionId)
          .eq("text", item.text);
      }

      if (nextSessionId) {
        const { data: existing, error: existingError } = await supabase
          .from("intentions")
          .select("id")
          .eq("user_id", userId)
          .eq("session_id", nextSessionId)
          .eq("text", item.text)
          .limit(1);
        if (existingError) throw existingError;
        if (!existing?.length) {
          const { error: intentionError } = await supabase
            .from("intentions")
            .insert({
              user_id: userId,
              session_id: nextSessionId,
              text: item.text,
              completed: item.completed,
            });
          if (intentionError) throw intentionError;
        }
      }

      dispatchTasksUpdated(previousSessionId || null);
      dispatchTasksUpdated(nextSessionId || null);
    } catch (cause: unknown) {
      await supabase
        .from("focus_plan_items")
        .update({ session_id: item.session_id || null })
        .eq("id", item.id)
        .eq("user_id", userId);
      setItems((current) =>
        current.map((task) =>
          task.id === item.id ? { ...task, session_id: item.session_id } : task,
        ),
      );
      setError(errorMessage(cause, "Task assignment could not be saved."));
    } finally {
      setBusyId("");
    }
  };

  const toggleTask = async (item: TaskItem) => {
    if (busyId) return;
    const completed = !item.completed;
    setBusyId(item.id);
    setItems((current) =>
      current.map((task) => (task.id === item.id ? { ...task, completed } : task)),
    );
    try {
      const { error: updateError } = await supabase
        .from("focus_plan_items")
        .update({ completed })
        .eq("id", item.id)
        .eq("user_id", userId);
      if (updateError) throw updateError;
      if (item.session_id) {
        await supabase
          .from("intentions")
          .update({ completed })
          .eq("user_id", userId)
          .eq("session_id", item.session_id)
          .eq("text", item.text);
      }
      dispatchTasksUpdated(item.session_id);
    } catch (cause: unknown) {
      setItems((current) =>
        current.map((task) =>
          task.id === item.id ? { ...task, completed: item.completed } : task,
        ),
      );
      setError(errorMessage(cause, "Task could not be updated."));
    } finally {
      setBusyId("");
    }
  };

  const deleteTask = async (item: TaskItem) => {
    if (busyId) return;
    setBusyId(item.id);
    const previous = items;
    setItems((current) => current.filter((task) => task.id !== item.id));
    try {
      const { error: deleteError } = await supabase
        .from("focus_plan_items")
        .delete()
        .eq("id", item.id)
        .eq("user_id", userId);
      if (deleteError) throw deleteError;
      if (item.session_id) {
        await supabase
          .from("intentions")
          .delete()
          .eq("user_id", userId)
          .eq("session_id", item.session_id)
          .eq("text", item.text);
      }
      dispatchTasksUpdated(item.session_id);
    } catch (cause: unknown) {
      setItems(previous);
      setError(errorMessage(cause, "Task could not be deleted."));
    } finally {
      setBusyId("");
    }
  };

  return (
    <div
      className={[
        "fixed inset-0 z-[140]",
        open ? "pointer-events-auto visible" : "pointer-events-none invisible delay-300",
      ].join(" ")}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Close tasks"
        onClick={onClose}
        className={[
          "absolute inset-0 bg-black/20 backdrop-blur-[1px] transition-opacity duration-300 ease-out",
          open ? "opacity-100" : "opacity-0",
        ].join(" ")}
      />

      <aside
        className={[
          "absolute inset-y-0 right-0 flex w-full flex-col bg-[#F7F7F7] text-[#2F2F2F] shadow-[-18px_0_50px_rgba(0,0,0,0.12)] will-change-transform transition-[transform,opacity] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] sm:w-[390px]",
          open ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
        ].join(" ")}
      >
        <header className="flex h-[76px] shrink-0 items-center justify-between px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[#E9E9E9]">
              <ListChecks size={18} />
            </div>
            <div>
              <div className="text-[15px] font-semibold">Tasks</div>
              <div className="text-[11px] text-[#777]">Plan work for your sessions</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[#E9E9E9] transition hover:bg-[#DFDFDF]"
            aria-label="Close tasks"
          >
            <X size={17} />
          </button>
        </header>

        <div className="px-5 pb-4">
          <div className="flex items-center gap-2 rounded-[16px] bg-white p-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addTask();
              }}
              placeholder="New task"
              className="h-10 min-w-0 flex-1 bg-transparent px-2 text-[13px] outline-none placeholder:text-[#999]"
            />
            <button
              type="button"
              onClick={() => void addTask()}
              disabled={!draft.trim() || !!busyId}
              className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-[#2F2F2F] text-white transition hover:bg-[#242424] disabled:opacity-35"
              aria-label="Add task"
            >
              <Plus size={18} />
            </button>
          </div>
          <p className="mt-2 px-1 text-[11px] leading-4 text-[#777]">
            Assign tasks to an infinite room or a future session you booked or host.
          </p>
        </div>

        {error ? (
          <div className="mx-5 mb-3 rounded-[14px] bg-red-50 px-3 py-2 text-[11px] text-red-700">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {loading ? (
            <div className="py-10 text-center text-[12px] text-[#777]">Loading tasks…</div>
          ) : items.length === 0 ? (
            <div className="rounded-[18px] bg-white px-5 py-8 text-center">
              <div className="text-[13px] font-medium">No tasks yet</div>
              <div className="mt-1 text-[11px] text-[#777]">Add one above, then choose its session.</div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[16px] bg-white px-3">
              {items.map((item) => {
                const assigned = item.session_id
                  ? sessionById.get(String(item.session_id))
                  : null;
                const hasUnavailableAssignment = !!item.session_id && !assigned;
                return (
                  <div
                    key={item.id}
                    className="group flex min-h-12 items-center gap-2 border-b border-[#ECECEC] py-1.5 last:border-b-0"
                  >
                      <button
                        type="button"
                        onClick={() => void toggleTask(item)}
                        disabled={busyId === item.id}
                        className={[
                          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] transition",
                          item.completed
                            ? "bg-[#81DB86] text-[#1F4A22]"
                            : "bg-[#ECECEC] text-transparent hover:bg-[#E2E2E2]",
                        ].join(" ")}
                        aria-label={item.completed ? "Mark task active" : "Complete task"}
                      >
                        <Check size={13} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div
                          title={item.text}
                          className={[
                            "truncate text-[12px] leading-5",
                            item.completed ? "text-[#8A8A8A] line-through" : "text-[#2F2F2F]",
                          ].join(" ")}
                        >
                          {item.text}
                        </div>
                      </div>

                    <select
                      value={String(item.session_id || "")}
                      onChange={(event) => void assignTask(item, event.target.value)}
                      disabled={busyId === item.id}
                      className={[
                        "h-8 w-[142px] shrink-0 truncate rounded-[10px] bg-[#F1F1F1] px-2 text-[10px] outline-none transition focus:bg-[#E9E9E9] disabled:opacity-60",
                        hasUnavailableAssignment ? "text-amber-700" : "text-[#555]",
                      ].join(" ")}
                      aria-label={`Session for ${item.text}`}
                    >
                      <option value="">Unscheduled</option>
                      {hasUnavailableAssignment ? (
                        <option value={String(item.session_id)} disabled>
                          Past or unavailable session
                        </option>
                      ) : null}
                      {sessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {isInfiniteTaskSession(session)
                            ? `∞ ${session.title || "Infinite room"}`
                            : `${session.title || "Session"} · ${formatSessionTime(session.start_time)}`}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => void deleteTask(item)}
                      disabled={busyId === item.id}
                      className="flex h-8 w-7 shrink-0 items-center justify-center rounded-[9px] text-[#A0A0A0] opacity-70 transition hover:bg-[#F0F0F0] hover:text-[#F65252] group-hover:opacity-100"
                      aria-label="Delete task"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="shrink-0 px-5 pb-[calc(18px+env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate("/tasks");
            }}
            className="flex h-11 w-full items-center justify-between rounded-[15px] bg-[#E9E9E9] px-4 text-[12px] font-medium transition hover:bg-[#DFDFDF]"
          >
            <span>Open full task plan</span>
            <ChevronRight size={16} />
          </button>
        </footer>
      </aside>
    </div>
  );
}
