import { APP_BUILD_ID, getPageLoadDiagnostics } from "./pageLifecycle";
import { supabase } from "./supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPEAT_MS = 60_000;
const lastSentAt = new Map<string, number>();

/**
 * Best-effort room_diagnostics row for code outside the room component (for
 * example error boundaries). Rate-limited per event type; never throws.
 */
export async function reportRoomDiagnostic(
  eventType: string,
  sessionId: string | null | undefined,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const now = Date.now();
  if (now - (lastSentAt.get(eventType) || 0) < REPEAT_MS) return;
  lastSentAt.set(eventType, now);

  try {
    const { data } = await supabase.auth.getSession();
    const userId = String(data.session?.user?.id || "").trim();
    if (!userId) return;

    const id = String(sessionId || "").trim();
    await supabase.from("room_diagnostics").insert({
      session_id: UUID_PATTERN.test(id) ? id : null,
      user_id: userId,
      event_type: eventType,
      user_agent: typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "",
      payload: {
        ...payload,
        ...getPageLoadDiagnostics(),
        buildId: APP_BUILD_ID,
        route: typeof window !== "undefined" ? window.location.pathname : "",
      },
    });
  } catch {
    // Diagnostics must never affect the room.
  }
}

/** Short, content-free description of an error for diagnostics. */
export function describeErrorForDiagnostics(error: unknown) {
  const value = error as { name?: unknown; message?: unknown } | null;
  return {
    errorName: String(value?.name || (error instanceof Error ? error.name : typeof error)).slice(0, 80),
    errorMessage: String(value?.message || error || "").slice(0, 300),
  };
}
