import { CriticalTimers } from "livekit-client";

// LiveKit keeps its signalling connection alive with a ping timer that runs
// through CriticalTimers (a hook the SDK exposes for exactly this). In a
// hidden tab Chrome slows main-thread timers down to about once a minute after
// five minutes, so pings stop going out, the server drops the participant,
// and everyone else sees them leave and join again when they come back.
// Timers inside a dedicated worker are not throttled that way, so the SDK's
// critical timers are scheduled there instead; callbacks still run on the
// main thread.
//
// The worker is switched in only after it has answered once. If it cannot be
// created (old browser, blocked blob: workers) the SDK keeps its default
// timers, exactly as before.

const WORKER_SOURCE = `
const timers = new Map();
self.onmessage = (event) => {
  const { type, id, delay } = event.data || {};
  if (type === "ping") { self.postMessage({ pong: true }); return; }
  if (type === "clear") {
    const timer = timers.get(id);
    if (timer) { (timer.repeat ? clearInterval : clearTimeout)(timer.handle); timers.delete(id); }
    return;
  }
  const repeat = type === "interval";
  const handle = (repeat ? setInterval : setTimeout)(() => {
    if (!repeat) timers.delete(id);
    self.postMessage({ id });
  }, Math.max(0, Number(delay) || 0));
  timers.set(id, { handle, repeat });
};
`;

// Worker timer ids live far above browser timer ids, so a clear call can tell
// which kind it received (timers started before the switch stay native).
const FIRST_WORKER_TIMER_ID = 1_000_000_000;

type TimerCallback = (...args: unknown[]) => void;

let installState: "idle" | "pending" | "installed" | "unavailable" = "idle";

export function installBackgroundSafeLiveKitTimers(): void {
  if (installState !== "idle") return;
  if (typeof window === "undefined" || typeof Worker === "undefined" || typeof Blob === "undefined") {
    installState = "unavailable";
    return;
  }

  let worker: Worker;
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
  } catch {
    installState = "unavailable";
    return;
  }

  installState = "pending";
  let nextId = FIRST_WORKER_TIMER_ID;
  const callbacks = new Map<number, { fn: TimerCallback; args: unknown[]; repeat: boolean }>();

  worker.onmessage = (event: MessageEvent<{ id?: number; pong?: boolean }>) => {
    if (event.data?.pong) {
      if (installState === "pending") switchSdkTimers();
      return;
    }
    const id = Number(event.data?.id);
    const entry = callbacks.get(id);
    if (!entry) return;
    if (!entry.repeat) callbacks.delete(id);
    entry.fn(...entry.args);
  };
  worker.onerror = () => {
    // Never switched, or failing later: hand everything back to the browser.
    if (installState !== "installed") installState = "unavailable";
  };

  const schedule = (repeat: boolean) => (handler: unknown, delay?: number, ...args: unknown[]) => {
    if (typeof handler !== "function") return 0;
    const id = nextId++;
    callbacks.set(id, { fn: handler as TimerCallback, args, repeat });
    worker.postMessage({ type: repeat ? "interval" : "timeout", id, delay: Number(delay) || 0 });
    return id;
  };

  const clear = (native: (id?: number) => void) => (id?: unknown) => {
    const numeric = Number(id);
    if (Number.isFinite(numeric) && numeric >= FIRST_WORKER_TIMER_ID) {
      callbacks.delete(numeric);
      worker.postMessage({ type: "clear", id: numeric });
      return;
    }
    native(id as number | undefined);
  };

  function switchSdkTimers() {
    const timers = CriticalTimers as unknown as Record<string, unknown>;
    timers.setTimeout = schedule(false);
    timers.setInterval = schedule(true);
    timers.clearTimeout = clear((id) => window.clearTimeout(id));
    timers.clearInterval = clear((id) => window.clearInterval(id));
    installState = "installed";
  }

  worker.postMessage({ type: "ping" });
}

export function backgroundSafeTimersState() {
  return installState;
}
