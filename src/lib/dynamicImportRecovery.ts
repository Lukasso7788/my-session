const RECOVERY_KEY = "mysession:dynamic-import-recovery";
const RECOVERY_COOLDOWN_MS = 60_000;

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

export function recoverFromDynamicImportFailure(value: unknown): boolean {
  if (typeof window === "undefined" || !isDynamicImportFailure(value) || !canReloadNow()) {
    return false;
  }

  markReloadAttempt();

  console.warn(
    "[app] A lazy-loaded module belongs to an older deployment. Reloading once to pick up the current build.",
    value,
  );

  // A long-lived MySession room can stay open while Vercel promotes a new
  // deployment. Its already-loaded JS then points at hashed lazy chunks from
  // the previous deployment, which no longer exist on the production domain.
  // A full reload fetches the current index + manifest and keeps the same URL.
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
