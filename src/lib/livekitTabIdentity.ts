/**
 * The LiveKit identity of a room tab is `<userId>--<tabId>`. A reload of the
 * same tab must reuse its tabId: LiveKit then replaces the old connection the
 * moment the new one joins. With a fresh id the dead connection stays in the
 * room as a second tile until the server times it out.
 *
 * The id is parked in sessionStorage only while the page is going away
 * (pagehide / freeze) and taken out again when the page loads or comes back.
 * A duplicated tab copies sessionStorage while the original is still alive,
 * finds nothing parked, and gets an id of its own.
 */

const PARKED_KEY = "mysession_livekit_tab_id_v1";
const VALID_ID = /^[a-z0-9]{8,16}$/i;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

// One id per page load, so React StrictMode replays and remounts of the room
// within the same page keep it.
let pageTabId = "";

export function claimLiveKitTabId(
  makeId: () => string,
  storage: StorageLike | null = defaultStorage(),
): string {
  if (pageTabId) return pageTabId;
  let parked = "";
  try {
    parked = String(storage?.getItem(PARKED_KEY) || "");
    storage?.removeItem(PARKED_KEY);
  } catch {
    // Blocked storage: every load gets a new id, as before.
  }
  pageTabId = VALID_ID.test(parked) ? parked : makeId();
  return pageTabId;
}

/** The page is unloading or being frozen: a reload of this tab may reuse the id. */
export function parkLiveKitTabId(tabId: string, storage: StorageLike | null = defaultStorage()) {
  if (!VALID_ID.test(tabId)) return;
  try {
    storage?.setItem(PARKED_KEY, tabId);
  } catch {
    // ignore
  }
}

/** The page is alive again (bfcache restore, resume, visible): nobody else may take the id. */
export function unparkLiveKitTabId(tabId: string, storage: StorageLike | null = defaultStorage()) {
  try {
    if (storage?.getItem(PARKED_KEY) === tabId) storage.removeItem(PARKED_KEY);
  } catch {
    // ignore
  }
}

/** Test helper: forget the per-page-load id. */
export function resetLiveKitTabIdForTests() {
  pageTabId = "";
}
