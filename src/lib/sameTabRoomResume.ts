/**
 * One automatic rejoin after the SAME browser tab reloads a room (a manual
 * refresh, a reload after an error, or a mobile browser restoring a discarded
 * background tab). sessionStorage is scoped to one tab and survives reloads,
 * so a new tab or a fresh room entry still goes through prejoin.
 */

const MARKER_KEY = "mysession_room_same_tab_resume_v1";
export const SAME_TAB_ROOM_RESUME_WINDOW_MS = 10 * 60 * 1000;
// React StrictMode replays layout effects during development; repeat the
// first decision for a moment instead of treating the replay as a new entry.
const DECISION_REPLAY_MS = 2_000;

type ResumeMarker = {
  sessionId: string;
  routeId: string;
  savedAt: number;
};

export type SameTabRoomResumeDecision = {
  routeId: string;
  resumed: boolean;
  markerAgeMs: number | null;
  decidedAt: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function normalizePath(pathname: string) {
  const trimmed = String(pathname || "").replace(/\/+$/, "");
  return trimmed || "/";
}

const initialPathname =
  typeof window !== "undefined" ? normalizePath(window.location.pathname) : "";

let pageLoadDecision: SameTabRoomResumeDecision | null = null;

function readMarker(storage: StorageLike | null): ResumeMarker | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(MARKER_KEY) || "null") as Partial<ResumeMarker> | null;
    const sessionId = String(parsed?.sessionId || "").trim();
    const routeId = String(parsed?.routeId || sessionId).trim();
    const savedAt = Number(parsed?.savedAt || 0);
    if (!sessionId || !Number.isFinite(savedAt) || savedAt <= 0) return null;
    return { sessionId, routeId, savedAt };
  } catch {
    return null;
  }
}

/** Called whenever the room refreshes its recovery lease while joined. */
export function markSameTabRoomResume(
  sessionId: string,
  routeId?: string | null,
  now = Date.now(),
  storage: StorageLike | null = defaultStorage(),
) {
  const id = String(sessionId || "").trim();
  if (!id || !storage) return;
  try {
    storage.setItem(
      MARKER_KEY,
      JSON.stringify({ sessionId: id, routeId: String(routeId || id).trim() || id, savedAt: now }),
    );
  } catch {
    // Storage can be full or blocked; the room then falls back to prejoin.
  }
}

/** Explicit leave, a closed room or a deliberate in-app exit. */
export function clearSameTabRoomResume(
  sessionId?: string | null,
  storage: StorageLike | null = defaultStorage(),
) {
  if (!storage) return;
  const marker = readMarker(storage);
  const id = String(sessionId || "").trim();
  if (id && marker && marker.sessionId !== id && marker.routeId !== id) return;
  try {
    storage.removeItem(MARKER_KEY);
  } catch {
    // ignore
  }
}

/**
 * Decides once per page load whether the room at `routeId` may rejoin
 * automatically. It is only allowed for the room the page was loaded on, when
 * that tab was in the same room within SAME_TAB_ROOM_RESUME_WINDOW_MS. The
 * marker is consumed either way; a successful rejoin writes it again.
 */
export function consumeSameTabRoomResume(
  routeId: string,
  options: {
    now?: number;
    storage?: StorageLike | null;
    pageInitialPathname?: string;
  } = {},
): boolean {
  const id = String(routeId || "").trim();
  const now = options.now ?? Date.now();
  if (!id) return false;

  if (pageLoadDecision) {
    const replay =
      pageLoadDecision.routeId === id && now - pageLoadDecision.decidedAt <= DECISION_REPLAY_MS;
    return replay ? pageLoadDecision.resumed : false;
  }

  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const marker = readMarker(storage);
  const pagePath = normalizePath(options.pageInitialPathname ?? initialPathname);
  const markerAgeMs = marker ? Math.max(0, now - marker.savedAt) : null;
  const resumed =
    !!marker &&
    (marker.routeId === id || marker.sessionId === id) &&
    pagePath === normalizePath(`/room-livekit/${id}`) &&
    markerAgeMs !== null &&
    markerAgeMs <= SAME_TAB_ROOM_RESUME_WINDOW_MS;

  if (marker && storage) {
    try {
      storage.removeItem(MARKER_KEY);
    } catch {
      // ignore
    }
  }

  pageLoadDecision = { routeId: id, resumed, markerAgeMs, decidedAt: now };
  return resumed;
}

export function getSameTabRoomResumeDecision(): SameTabRoomResumeDecision | null {
  return pageLoadDecision;
}

/** Test helper: forget the per-page-load decision. */
export function resetSameTabRoomResumeForTests() {
  pageLoadDecision = null;
}
