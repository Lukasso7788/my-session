const RECOVERY_KEY = "mysession:dynamic-import-recovery";
const RECOVERY_COOLDOWN_MS = 60_000;

/**
 * Fired instead of a reload while a live room defers reloads. `detail.error`
 * carries the import failure.
 */
export const APP_UPDATE_AVAILABLE_EVENT = "mysession:app-update-available";

const reloadDeferrals = new Set<symbol>();

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;

  if (value && typeof value === "object" && "message" in value) {
    return String((value as { message?: unknown }).message || "");
  }

  return "";
}

export function isDynamicImportFailure(value: unknown): boolean {
  const message = errorMessage(value).toLowerCase();
  if (!message) return false;

  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("failed to load module script") ||
    message.includes("chunkloaderror") ||
    message.includes("loading chunk") ||
    message.includes("unable to preload css")
  );
}

/**
 * While the returned release function has not been called, import failures
 * announce APP_UPDATE_AVAILABLE_EVENT instead of reloading the page. A live
 * room uses this so a stale chunk cannot end the call.
 */
export function deferDynamicImportReloads(): () => void {
  const token = Symbol("dynamic-import-reload-deferral");
  reloadDeferrals.add(token);
  return () => {
    reloadDeferrals.delete(token);
  };
}

export function areDynamicImportReloadsDeferred(): boolean {
  return reloadDeferrals.size > 0;
}

function recoveryStorageKey() {
  if (typeof window === "undefined") return RECOVERY_KEY;
  return `${RECOVERY_KEY}:${window.location.pathname}`;
}

function canReloadNow() {
  if (typeof window === "undefined") return false;

  try {
    const previous = Number(window.sessionStorage.getItem(recoveryStorageKey()) || 0);
    return !Number.isFinite(previous) || previous <= 0 || Date.now() - previous > RECOVERY_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markReloadAttempt() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(recoveryStorageKey(), String(Date.now()));
  } catch {
    // sessionStorage can be unavailable in strict privacy modes.
  }
}

function announceAppUpdate(value: unknown) {
  try {
    window.dispatchEvent(new CustomEvent(APP_UPDATE_AVAILABLE_EVENT, { detail: { error: value } }));
  } catch {
    // CustomEvent is available in every supported browser; never throw here.
  }
}

export function recoverFromDynamicImportFailure(value: unknown): boolean {
  if (typeof window === "undefined" || !isDynamicImportFailure(value)) return false;

  if (areDynamicImportReloadsDeferred()) {
    // The caller still receives the original error (for example a panel error
    // boundary), so the import failure is not marked as handled.
    announceAppUpdate(value);
    return false;
  }

  if (!canReloadNow()) return false;

  markReloadAttempt();

  console.warn(
    "[app] A lazy-loaded module belongs to an older deployment. Reloading once to pick up the current build.",
    value,
  );

  // A page can stay open while Vercel promotes a new deployment. Its loaded
  // JS then points at hashed lazy chunks from the previous deployment, which
  // no longer exist on the production domain. A full reload fetches the
  // current index + manifest and keeps the same URL.
  window.location.reload();
  return true;
}

type VitePreloadErrorEvent = Event & {
  payload?: unknown;
};

export function installDynamicImportRecovery() {
  if (typeof window === "undefined") return () => {};

  const onVitePreloadError = (event: Event) => {
    const preloadEvent = event as VitePreloadErrorEvent;
    const failure = preloadEvent.payload || new Error("Failed to fetch dynamically imported module");

    if (!recoverFromDynamicImportFailure(failure)) return;

    // Vite documents this event specifically so apps can recover from stale
    // hashed chunks after a deployment instead of surfacing the import error.
    event.preventDefault();
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (!isDynamicImportFailure(event.reason)) return;
    if (!recoverFromDynamicImportFailure(event.reason)) return;
    event.preventDefault();
  };

  window.addEventListener("vite:preloadError", onVitePreloadError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("vite:preloadError", onVitePreloadError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
