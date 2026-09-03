import { createClient } from '@supabase/supabase-js';

// Используем безопасное чтение переменных (без !), чтобы сборка не падала, если переменные не подтянулись
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''; // Вернул _KEY как в твоем исходнике

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // ЭТО ВАЖНО: Supabase сам парсит URL
    storage: localStorage,
    storageKey: "mysession-auth",
  }
});

const RECURRING_TASKS_MATERIALIZED_PREFIX = "mysession_recurring_tasks_materialized_v1";
let recurringMaterializeInFlight: Promise<void> | null = null;

async function materializeRecurringTasksForCurrentUser() {
  if (typeof window === "undefined") return;
  if (recurringMaterializeInFlight) return recurringMaterializeInFlight;

  recurringMaterializeInFlight = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) return;

      const today = new Date().toISOString().slice(0, 10);
      const storageKey = `${RECURRING_TASKS_MATERIALIZED_PREFIX}:${userId}:${today}`;
      if (window.localStorage.getItem(storageKey) === "1") return;

      const { data: generated, error } = await supabase.rpc("materialize_recurring_tasks");
      if (error) return; // Migration may not be deployed yet; fail silently.

      window.localStorage.setItem(storageKey, "1");
      window.dispatchEvent(
        new CustomEvent("mysession:tasks-updated", {
          detail: {
            source: "recurring-tasks",
            generated: Number(generated || 0),
            at: Date.now(),
          },
        }),
      );
    } catch {
      // Recurring tasks must never block auth/app bootstrap.
    } finally {
      recurringMaterializeInFlight = null;
    }
  })();

  return recurringMaterializeInFlight;
}

if (typeof window !== "undefined") {
  // @ts-ignore
  window.supabase = supabase;

  // Materialize due recurring tasks on any app entry, including direct room links.
  window.setTimeout(() => void materializeRecurringTasksForCurrentUser(), 0);

  const materializeWhenActive = () => {
    if (document.visibilityState === "visible") {
      void materializeRecurringTasksForCurrentUser();
    }
  };

  window.addEventListener("focus", materializeWhenActive);
  document.addEventListener("visibilitychange", materializeWhenActive);

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user?.id) return;
    window.setTimeout(() => void materializeRecurringTasksForCurrentUser(), 0);
  });
}
