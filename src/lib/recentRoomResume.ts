/**
 * Automatic rejoin for someone who comes back to a room they were in a moment
 * ago without pressing Leave: the phone dropped the tab while they were in
 * another app, they reloaded, went back and forward, or opened the room again
 * from a link or the sessions list (any tab, any route to the room).
 *
 * The record lives in localStorage per room. The room refreshes it whenever it
 * writes its recovery lease (hidden, page leaving, connection lost, in-app
 * exit); Leave, a kick, a policy removal, a closed room and a ban revoke it.
 */

const KEY_PREFIX = "mysession_room_recent_v1:";
export const RECENT_ROOM_RESUME_WINDOW_MS = 20 * 60 * 1000;
// React StrictMode replays layout effects during development; repeat the
// decision for a moment instead of treating the replay as a new entry.
const DECISION_REPLAY_MS = 2_000;

export type RecentRoomResumeDecision = {
  sessionId: string;
  resumed: boolean;
  markerAgeMs: number | null;
  decidedAt: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

let lastDecision: RecentRoomResumeDecision | null = null;

function readSavedAt(storage: StorageLike | null, id: string): number | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(KEY_PREFIX + id) || "null") as { savedAt?: unknown } | null;
    const savedAt = Number(parsed?.savedAt || 0);
    return Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null;
  } catch {
    return null;
  }
}

/** The person is (or just was) in this room. */
export function markRecentRoom(
  sessionId: string,
  now = Date.now(),
  storage: StorageLike | null = defaultStorage(),
) {
  const id = String(sessionId || "").trim();
  if (!id || !storage) return;
  try {
    storage.setItem(KEY_PREFIX + id, JSON.stringify({ savedAt: now }));
  } catch {
    // Storage can be full or blocked; the room then falls back to prejoin.
  }
}

/** Leave, kick, removal, closed room or ban: the next entry shows prejoin. */
export function clearRecentRoom(
  sessionId: string,
  storage: StorageLike | null = defaultStorage(),
) {
  const id = String(sessionId || "").trim();
  if (!id || !storage) return;
  try {
    storage.removeItem(KEY_PREFIX + id);
  } catch {
    // ignore
  }
}

/**
 * Decides on each room entry whether it may rejoin automatically: only when
 * this room was marked within RECENT_ROOM_RESUME_WINDOW_MS. The record is
 * consumed either way; the rejoined room marks it again.
 */
export function consumeRecentRoomResume(
  sessionId: string,
  options: { now?: number; storage?: StorageLike | null } = {},
): boolean {
  const id = String(sessionId || "").trim();
  const now = options.now ?? Date.now();
  if (!id) return false;

  if (lastDecision && lastDecision.sessionId === id && now - lastDecision.decidedAt <= DECISION_REPLAY_MS) {
    return lastDecision.resumed;
  }

  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const savedAt = readSavedAt(storage, id);
  const markerAgeMs = savedAt === null ? null : Math.max(0, now - savedAt);
  const resumed = markerAgeMs !== null && markerAgeMs <= RECENT_ROOM_RESUME_WINDOW_MS;
  if (savedAt !== null) clearRecentRoom(id, storage);

  lastDecision = { sessionId: id, resumed, markerAgeMs, decidedAt: now };
  return resumed;
}

export function getRecentRoomResumeDecision(sessionId?: string | null): RecentRoomResumeDecision | null {
  const id = String(sessionId || "").trim();
  if (id && lastDecision?.sessionId !== id) return null;
  return lastDecision;
}

// How the previous page or room instance left this room. A page that is
// going away cannot reliably send a request, so the next room_join reports it.
const EXIT_KEY_PREFIX = "mysession_room_last_exit_v1:";

export type RoomExitRecord = {
  kind: string;
  at: number;
  connected: boolean;
  visibility: string;
};

export function recordRoomExit(
  sessionId: string,
  exit: Omit<RoomExitRecord, "at"> & { at?: number },
  storage: StorageLike | null = defaultStorage(),
) {
  const id = String(sessionId || "").trim();
  if (!id || !storage) return;
  try {
    storage.setItem(EXIT_KEY_PREFIX + id, JSON.stringify({ ...exit, at: exit.at ?? Date.now() }));
  } catch {
    // ignore
  }
}

/** Reads and forgets the previous exit from this room. */
export function readRoomExit(
  sessionId: string,
  storage: StorageLike | null = defaultStorage(),
): RoomExitRecord | null {
  const id = String(sessionId || "").trim();
  if (!id || !storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(EXIT_KEY_PREFIX + id) || "null") as Partial<RoomExitRecord> | null;
    storage.removeItem(EXIT_KEY_PREFIX + id);
    const at = Number(parsed?.at || 0);
    if (!parsed?.kind || !Number.isFinite(at) || at <= 0) return null;
    return {
      kind: String(parsed.kind),
      at,
      connected: parsed.connected === true,
      visibility: String(parsed.visibility || ""),
    };
  } catch {
    return null;
  }
}

/** Test helper: forget the last entry decision. */
export function resetRecentRoomResumeForTests() {
  lastDecision = null;
}
