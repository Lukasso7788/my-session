import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  Check,
  ChevronRight,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
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
  const [assignMenuId, setAssignMenuId] = useState("");
  const [settingsMenuId, setSettingsMenuId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingText, setEditingText] = useState("");

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

  useEffect(() => {
    if (open) return;
    setAssignMenuId("");
    setSettingsMenuId("");
    setEditingId("");
  }, [open]);

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

  const saveTaskText = async (item: TaskItem) => {
    const text = editingText.trim();
    setEditingId("");
    if (!text || text === item.text || busyId) return;

    const previousText = item.text;
    setBusyId(item.id);
    setItems((current) =>
      current.map((task) => (task.id === item.id ? { ...task, text } : task)),
    );
    try {
      const { error: updateError } = await supabase
        .from("focus_plan_items")
        .update({ text })
        .eq("id", item.id)
        .eq("user_id", userId);
      if (updateError) throw updateError;

      if (item.session_id) {
        const { error: intentionError } = await supabase
          .from("intentions")
          .update({ text })
          .eq("user_id", userId)
          .eq("session_id", item.session_id)
          .eq("text", previousText);
        if (intentionError) throw intentionError;
      }
      dispatchTasksUpdated(item.session_id);
    } catch (cause: unknown) {
      await supabase
        .from("focus_plan_items")
        .update({ text: previousText })
        .eq("id", item.id)
        .eq("user_id", userId);
      setItems((current) =>
        current.map((task) =>
          task.id === item.id ? { ...task, text: previousText } : task,
        ),
      );
      setError(errorMessage(cause, "Task name could not be saved."));
    } finally {
      setBusyId("");
    }
  };

  const moveTask = async (item: TaskItem, direction: -1 | 1) => {
    if (busyId) return;
    const peers = items.filter((task) => task.completed === item.completed);
    const peerIndex = peers.findIndex((task) => task.id === item.id);
    const target = peers[peerIndex + direction];
    if (!target) return;

    const previous = items;
    const currentIndex = items.findIndex((task) => task.id === item.id);
    const targetIndex = items.findIndex((task) => task.id === target.id);
    const reordered = [...items];
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex],
    ];
    const normalized = reordered.map((task, index) => ({
      ...task,
      sort_order: index,
    }));

    setSettingsMenuId("");
    setBusyId(item.id);
    setItems(normalized);
    try {
      const results = await Promise.all(
        normalized.map((task) =>
          supabase
            .from("focus_plan_items")
            .update({ sort_order: task.sort_order })
            .eq("id", task.id)
            .eq("user_id", userId),
        ),
      );
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
    } catch (cause: unknown) {
      await Promise.all(
        previous.map((task) =>
          supabase
            .from("focus_plan_items")
            .update({ sort_order: task.sort_order })
            .eq("id", task.id)
            .eq("user_id", userId),
        ),
      );
      setItems(previous);
      setError(errorMessage(cause, "Task order could not be saved."));
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
            <div className="rounded-[16px] bg-white px-3">
              {items.map((item) => {
                const assigned = item.session_id
                  ? sessionById.get(String(item.session_id))
                  : null;
                const hasUnavailableAssignment = !!item.session_id && !assigned;
                const peers = items.filter((task) => task.completed === item.completed);
                const peerIndex = peers.findIndex((task) => task.id === item.id);
                return (
                  <div
                    key={item.id}
                    className="group relative flex min-h-12 items-center gap-2 border-b border-[#ECECEC] py-1.5 last:border-b-0"
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
                      {editingId === item.id ? (
                        <input
                          autoFocus
                          value={editingText}
                          onChange={(event) => setEditingText(event.target.value)}
                          onBlur={() => void saveTaskText(item)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveTaskText(item);
                            if (event.key === "Escape") setEditingId("");
                          }}
                          className="h-8 w-full rounded-[8px] bg-[#F1F1F1] px-2 text-[12px] outline-none focus:bg-[#EAEAEA]"
                        />
                      ) : (
                        <div
                          title={item.text}
                          className={[
                            "truncate text-[12px] leading-5",
                            item.completed ? "text-[#8A8A8A] line-through" : "text-[#2F2F2F]",
                          ].join(" ")}
                        >
                          {item.text}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setAssignMenuId((current) => current === item.id ? "" : item.id);
                        setSettingsMenuId("");
                      }}
                      disabled={busyId === item.id}
                      title={assigned ? `Assigned to ${assigned.title}` : "Assign task to session"}
                      className={[
                        "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition disabled:opacity-50",
                        assigned
                          ? "bg-[#E6F7E8] text-[#3FAE49] hover:bg-[#DDF2DF]"
                          : hasUnavailableAssignment
                            ? "bg-amber-50 text-amber-700"
                            : "bg-[#EEEEEE] text-[#555] hover:bg-[#E4E4E4]",
                      ].join(" ")}
                      aria-label={`Assign ${item.text} to a session`}
                    >
                      <CalendarPlus size={15} strokeWidth={2} />
                      {assigned ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#55C95F]" /> : null}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSettingsMenuId((current) => current === item.id ? "" : item.id);
                        setAssignMenuId("");
                      }}
                      disabled={busyId === item.id}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[#EEEEEE] text-[#555] transition hover:bg-[#E4E4E4] disabled:opacity-50"
                      aria-label={`Task settings for ${item.text}`}
                    >
                      <MoreHorizontal size={16} />
                    </button>

                    {assignMenuId === item.id ? (
                      <div className="absolute right-10 top-11 z-30 w-[270px] overflow-hidden rounded-[14px] bg-white p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.16)]">
                        <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#999]">Assign to session</div>
                        <div className="max-h-56 overflow-y-auto">
                          <button
                            type="button"
                            onClick={() => {
                              setAssignMenuId("");
                              void assignTask(item, "");
                            }}
                            className="flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-[11px] hover:bg-[#F1F1F1]"
                          >
                            <span>Unscheduled</span>
                            {!item.session_id ? <Check size={14} /> : null}
                          </button>
                          {sessions.map((session) => (
                            <button
                              key={session.id}
                              type="button"
                              onClick={() => {
                                setAssignMenuId("");
                                void assignTask(item, session.id);
                              }}
                              className="flex w-full items-center justify-between gap-3 rounded-[10px] px-2.5 py-2 text-left text-[11px] hover:bg-[#F1F1F1]"
                            >
                              <span className="min-w-0 truncate">
                                {isInfiniteTaskSession(session)
                                  ? `∞ ${session.title || "Infinite room"}`
                                  : `${session.title || "Session"} · ${formatSessionTime(session.start_time)}`}
                              </span>
                              {item.session_id === session.id ? <Check className="shrink-0" size={14} /> : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {settingsMenuId === item.id ? (
                      <div className="absolute right-0 top-11 z-40 w-[170px] rounded-[14px] bg-white p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.16)]">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(item.id);
                            setEditingText(item.text);
                            setSettingsMenuId("");
                          }}
                          className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-[11px] hover:bg-[#F1F1F1]"
                        >
                          <Pencil size={14} /> Edit
                        </button>
                        <button
                          type="button"
                          disabled={peerIndex <= 0}
                          onClick={() => void moveTask(item, -1)}
                          className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-[11px] hover:bg-[#F1F1F1] disabled:opacity-35"
                        >
                          <ArrowUp size={14} /> Move up
                        </button>
                        <button
                          type="button"
                          disabled={peerIndex < 0 || peerIndex >= peers.length - 1}
                          onClick={() => void moveTask(item, 1)}
                          className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-[11px] hover:bg-[#F1F1F1] disabled:opacity-35"
                        >
                          <ArrowDown size={14} /> Move down
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSettingsMenuId("");
                            void deleteTask(item);
                          }}
                          className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-[11px] text-[#D94B4B] hover:bg-red-50"
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    ) : null}
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
