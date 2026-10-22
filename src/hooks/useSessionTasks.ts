import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  loadEligibleTaskSessions,
  type TaskSessionOption,
} from "../lib/taskSessionEligibility";

// Task data for the floating Tasks widget on the Sessions page: the user's
// focus plan items plus the sessions they can be assigned to. Assigning a task
// to a session mirrors it into that session's intentions, which is what the
// room's task panel shows.

type TaskPlan = {
  id: string;
  title: string;
};

export type SessionTask = {
  id: string;
  plan_id: string;
  user_id: string;
  text: string;
  session_id: string | null;
  completed: boolean;
  created_at: string;
  sort_order: number;
};

const ITEM_COLUMNS = "id,plan_id,user_id,text,session_id,completed,created_at,sort_order";

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

export function useSessionTasks(userId: string, active: boolean) {
  const [items, setItems] = useState<SessionTask[]>([]);
  const [plans, setPlans] = useState<TaskPlan[]>([]);
  const [sessions, setSessions] = useState<TaskSessionOption[]>([]);
  const [loaded, setLoaded] = useState(false);
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
          .select(ITEM_COLUMNS)
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
      setItems((itemsResult.data || []) as SessionTask[]);
      setSessions(eligibleSessions);
      setLoaded(true);
    } catch (cause: unknown) {
      setError(errorMessage(cause, "Tasks could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Load once for the collapsed badge, then again each time the widget opens.
  useEffect(() => {
    if (!userId) return;
    if (active || !loaded) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, active]);

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

  const addTask = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busyId) return false;
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
        .select(ITEM_COLUMNS)
        .single();
      if (insertError || !data) throw insertError || new Error("Task was not created");
      setItems((current) => [data as SessionTask, ...current]);
      dispatchTasksUpdated();
      return true;
    } catch (cause: unknown) {
      setError(errorMessage(cause, "Task could not be created."));
      return false;
    } finally {
      setBusyId("");
    }
  };

  const assignTask = async (item: SessionTask, nextSessionId: string) => {
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
        task.id === item.id ? { ...task, session_id: nextSessionId || null } : task,
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
          const { error: intentionError } = await supabase.from("intentions").insert({
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

  const toggleTask = async (item: SessionTask) => {
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

  const deleteTask = async (item: SessionTask) => {
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

  const renameTask = async (item: SessionTask, rawText: string) => {
    const text = rawText.trim();
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

  const moveTask = async (item: SessionTask, direction: -1 | 1) => {
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
    const normalized = reordered.map((task, index) => ({ ...task, sort_order: index }));

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

  return {
    items,
    sessions,
    sessionById,
    loading: loading && !loaded,
    busyId,
    error,
    clearError: () => setError(""),
    addTask,
    assignTask,
    toggleTask,
    deleteTask,
    renameTask,
    moveTask,
  };
}
