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
  const [draggingId, setDraggingId] = useState("");
  const [dragTargetId, setDragTargetId] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

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

  const persistTaskOrder = async (
    reordered: TaskItem[],
    previous: TaskItem[],
    activeTaskId: string,
  ) => {
    const normalized = reordered.map((task, index) => ({
      ...task,
      sort_order: index,
    }));

    setSettingsMenuId("");
    setBusyId(activeTaskId);
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
    await persistTaskOrder(reordered, previous, item.id);
  };

  const dropTask = async (draggedId: string, targetId: string) => {
    setDraggingId("");
    setDragTargetId("");
    if (!draggedId || !targetId || draggedId === targetId || busyId) return;

    const dragged = items.find((task) => task.id === draggedId);
    const target = items.find((task) => task.id === targetId);
    if (!dragged || !target || dragged.completed !== target.completed) return;

    const previous = items;
    const reordered = [...items];
    const fromIndex = reordered.findIndex((task) => task.id === draggedId);
    const toIndex = reordered.findIndex((task) => task.id === targetId);
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    await persistTaskOrder(reordered, previous, draggedId);
  };

  const openItems = items.filter((task) => !task.completed);
  const doneItems = items.filter((task) => task.completed);
  const progress = items.length ? Math.round((doneItems.length / items.length) * 100) : 0;

  const sessionLabel = (session: TaskSessionOption) =>
    isInfiniteTaskSession(session)
      ? `∞ ${session.title || "Infinite room"}`
      : `${session.title || "Session"} · ${formatSessionTime(session.start_time)}`;

  const renderRow = (item: TaskItem) => {
    const assigned = item.session_id ? sessionById.get(String(item.session_id)) : null;
    const hasUnavailableAssignment = !!item.session_id && !assigned;
    const peers = items.filter((task) => task.completed === item.completed);
    const peerIndex = peers.findIndex((task) => task.id === item.id);
    const menuOpen = assignMenuId === item.id || settingsMenuId === item.id;

    return (
      <div
        key={item.id}
        draggable={!busyId && editingId !== item.id}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.id);
          setDraggingId(item.id);
          setAssignMenuId("");
          setSettingsMenuId("");
        }}
        onDragOver={(event) => {
          const dragged = items.find((task) => task.id === draggingId);
          if (!dragged || dragged.completed !== item.completed) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDragTargetId(item.id);
        }}
        onDragLeave={() => {
          if (dragTargetId === item.id) setDragTargetId("");
        }}
        onDrop={(event) => {
          event.preventDefault();
          void dropTask(event.dataTransfer.getData("text/plain") || draggingId, item.id);
        }}
        onDragEnd={() => {
          setDraggingId("");
          setDragTargetId("");
        }}
        className={[
          "group relative flex cursor-grab items-start gap-3 rounded-[16px] px-3 py-2.5 transition-colors active:cursor-grabbing",
          draggingId === item.id ? "opacity-40" : "opacity-100",
          dragTargetId === item.id && draggingId !== item.id
            ? "bg-[#EEF3FE] ring-1 ring-[#5286F6]/40"
            : menuOpen ? "bg-[#F6F6F6]" : "hover:bg-[#F6F6F6]",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => void toggleTask(item)}
          disabled={busyId === item.id}
          className={[
            "mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition",
            item.completed
              ? "border-[#5286F6] bg-[#5286F6] text-white"
              : "border-[#C9C9C9] bg-white text-transparent hover:border-[#5286F6] hover:text-[#5286F6]",
          ].join(" ")}
          aria-label={item.completed ? "Mark task active" : "Complete task"}
        >
          <Check size={12} strokeWidth={3} />
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
              className="-my-1 h-8 w-full rounded-[10px] border border-[#5286F6] bg-white px-2 text-[13px] outline-none"
            />
          ) : (
            <div
              onDoubleClick={() => {
                setEditingId(item.id);
                setEditingText(item.text);
              }}
              title={item.text}
              className={[
                "line-clamp-2 break-words text-[13px] leading-[19px]",
                item.completed ? "text-[#A3A3A3] line-through" : "text-[#2F2F2F]",
              ].join(" ")}
            >
              {item.text}
            </div>
          )}

          {editingId !== item.id ? (
            assigned || hasUnavailableAssignment ? (
              <button
                type="button"
                onClick={() => {
                  setAssignMenuId((current) => current === item.id ? "" : item.id);
                  setSettingsMenuId("");
                }}
                disabled={busyId === item.id}
                className={[
                  "mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition",
                  assigned
                    ? "bg-[#EEF3FE] text-[#3F6FD8] hover:bg-[#E4ECFD]"
                    : "bg-amber-50 text-amber-700",
                ].join(" ")}
              >
                <CalendarPlus size={12} className="shrink-0" />
                <span className="truncate">{assigned ? sessionLabel(assigned) : "Session no longer available"}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAssignMenuId((current) => current === item.id ? "" : item.id);
                  setSettingsMenuId("");
                }}
                disabled={busyId === item.id}
                className={[
                  "mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#8A8A8A] transition hover:text-[#3F6FD8]",
                  menuOpen ? "" : "sm:hidden sm:group-hover:inline-flex sm:group-focus-within:inline-flex",
                ].join(" ")}
              >
                <CalendarPlus size={12} /> Add to a session
              </button>
            )
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => {
            setSettingsMenuId((current) => current === item.id ? "" : item.id);
            setAssignMenuId("");
          }}
          disabled={busyId === item.id}
          className={[
            "-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#8A8A8A] transition hover:bg-[#EAEAEA] hover:text-[#2F2F2F] disabled:opacity-50",
            menuOpen ? "opacity-100" : "sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
          ].join(" ")}
          aria-label={`Task settings for ${item.text}`}
        >
          <MoreHorizontal size={16} />
        </button>

        {assignMenuId === item.id ? (
          <div className="absolute left-8 right-2 top-full z-30 -mt-1 overflow-hidden rounded-[16px] border border-[#EEEEEE] bg-white p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.14)]">
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-[#8A8A8A]">Add to a session</div>
            <div className="max-h-56 overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  setAssignMenuId("");
                  void assignTask(item, "");
                }}
                className="flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-[12px] hover:bg-[#F6F6F6]"
              >
                <span>Unscheduled</span>
                {!item.session_id ? <Check size={14} className="text-[#5286F6]" /> : null}
              </button>
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => {
                    setAssignMenuId("");
                    void assignTask(item, session.id);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-[10px] px-2.5 py-2 text-left text-[12px] hover:bg-[#F6F6F6]"
                >
                  <span className="min-w-0 truncate">{sessionLabel(session)}</span>
                  {item.session_id === session.id ? <Check className="shrink-0 text-[#5286F6]" size={14} /> : null}
                </button>
              ))}
              {sessions.length === 0 ? (
                <div className="px-2.5 py-2 text-[11px] leading-4 text-[#8A8A8A]">
                  Book a future session or host one to assign tasks to it.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {settingsMenuId === item.id ? (
          <div className="absolute right-2 top-full z-40 -mt-1 w-[170px] rounded-[16px] border border-[#EEEEEE] bg-white p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.14)]">
            <button
              type="button"
              onClick={() => {
                setEditingId(item.id);
                setEditingText(item.text);
                setSettingsMenuId("");
              }}
              className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-[12px] hover:bg-[#F6F6F6]"
            >
              <Pencil size={14} /> Edit
            </button>
            <button
              type="button"
              disabled={peerIndex <= 0}
              onClick={() => void moveTask(item, -1)}
              className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-[12px] hover:bg-[#F6F6F6] disabled:opacity-35"
            >
              <ArrowUp size={14} /> Move up
            </button>
            <button
              type="button"
              disabled={peerIndex < 0 || peerIndex >= peers.length - 1}
              onClick={() => void moveTask(item, 1)}
              className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-[12px] hover:bg-[#F6F6F6] disabled:opacity-35"
            >
              <ArrowDown size={14} /> Move down
            </button>
            <button
              type="button"
              onClick={() => {
                setSettingsMenuId("");
                void deleteTask(item);
              }}
              className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-[12px] text-[#D94B4B] hover:bg-red-50"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        ) : null}
      </div>
    );
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
          "absolute inset-y-0 right-0 flex w-full flex-col bg-white text-[#2F2F2F] shadow-[-18px_0_50px_rgba(0,0,0,0.12)] will-change-transform transition-[transform,opacity] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] sm:w-[400px] sm:rounded-l-[28px]",
          open ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
        ].join(" ")}
      >
        <header className="shrink-0 px-5 pb-4 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF3FE] text-[#5286F6]">
                <ListChecks size={19} />
              </div>
              <div>
                <div className="text-[17px] font-semibold leading-6">Tasks</div>
                <div className="text-[12px] text-[#8A8A8A]">
                  {items.length
                    ? `${openItems.length} to do · ${doneItems.length} done`
                    : "Plan work for your sessions"}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E5E5E5] text-[#606060] transition hover:border-[#A3A3A3] hover:text-[#2F2F2F]"
              aria-label="Close tasks"
            >
              <X size={17} />
            </button>
          </div>

          {items.length ? (
            <div className="mt-4 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF3FE]">
                <div
                  className="h-full rounded-full bg-[#5286F6] transition-[width] duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="shrink-0 text-[12px] font-medium tabular-nums text-[#3F6FD8]">{progress}%</span>
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-2 rounded-full border border-[#E5E5E5] bg-white py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-[#5286F6]">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addTask();
              }}
              placeholder="Add a task and press Enter"
              className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#A3A3A3]"
            />
            <button
              type="button"
              onClick={() => void addTask()}
              disabled={!draft.trim() || !!busyId}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2F2F2F] text-white transition hover:bg-[#1F1F1F] disabled:opacity-30"
              aria-label="Add task"
            >
              <Plus size={18} />
            </button>
          </div>
        </header>

        {error ? (
          <div className="mx-5 mb-3 rounded-[14px] bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-[#F0F0F0] px-3 pb-5 pt-3">
          {loading && !items.length ? (
            <div className="space-y-2 px-2 pt-1" aria-label="Loading tasks">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="h-11 animate-pulse rounded-[16px] bg-[#F6F6F6]" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="mx-2 mt-2 rounded-[22px] border border-dashed border-[#DBD8D8] px-6 py-10 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#EEF3FE] text-[#5286F6]">
                <ListChecks size={20} />
              </div>
              <div className="mt-3 text-[14px] font-medium">No tasks yet</div>
              <div className="mt-1 text-[12px] leading-5 text-[#8A8A8A]">
                Add one above, then attach it to a session you booked or an always-open room.
              </div>
            </div>
          ) : (
            <>
              {openItems.length ? (
                <div className="space-y-0.5">{openItems.map(renderRow)}</div>
              ) : (
                <div className="mx-2 rounded-[16px] bg-[#EEF3FE] px-4 py-3 text-[12px] font-medium text-[#3F6FD8]">
                  Everything is done. Nice work.
                </div>
              )}

              {doneItems.length ? (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setShowCompleted((value) => !value)}
                    className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-[12px] font-medium text-[#8A8A8A] transition hover:text-[#2F2F2F]"
                    aria-expanded={showCompleted}
                  >
                    <ChevronRight size={14} className={`transition-transform ${showCompleted ? "rotate-90" : ""}`} />
                    Completed
                    <span className="rounded-full bg-[#F1F1F1] px-1.5 text-[11px] tabular-nums text-[#606060]">{doneItems.length}</span>
                  </button>
                  {showCompleted ? <div className="space-y-0.5">{doneItems.map(renderRow)}</div> : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer className="shrink-0 border-t border-[#F0F0F0] px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate("/tasks");
            }}
            className="flex h-11 w-full items-center justify-between rounded-full border border-[#E5E5E5] px-5 text-[13px] font-medium transition hover:border-[#2F2F2F]"
          >
            <span>Open full task plan</span>
            <ChevronRight size={16} />
          </button>
        </footer>
      </aside>
    </div>
  );
}
