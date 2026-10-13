import { CriticalTimers } from "livekit-client";
import { backgroundSafeTimersState, installBackgroundSafeLiveKitTimers } from "../../src/lib/backgroundSafeTimers";

// Dev-only check that LiveKit's critical timers move to the worker and still
// behave like setTimeout/setInterval. Open with the tab visible; results are
// printed and stored on window.__timerResults.
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const timers = CriticalTimers as unknown as {
  setTimeout: (fn: () => void, ms: number) => number;
  setInterval: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  clearInterval: (id: number) => void;
};

async function run() {
  const results: Record<string, unknown> = {};
  // A native interval created before the switch must still be clearable.
  let nativeTicks = 0;
  const nativeInterval = timers.setInterval(() => { nativeTicks += 1; }, 20);

  installBackgroundSafeLiveKitTimers();
  for (let i = 0; i < 50 && backgroundSafeTimersState() !== "installed"; i++) await sleep(10);
  results.state = backgroundSafeTimersState();

  timers.clearInterval(nativeInterval);
  const ticksAtClear = nativeTicks;
  await sleep(80);
  results.nativeClearedAfterSwitch = nativeTicks === ticksAtClear;

  let fired = 0;
  const started = performance.now();
  timers.setTimeout(() => { fired += 1; results.timeoutDelayMs = Math.round(performance.now() - started); }, 50);
  const cancelled = timers.setTimeout(() => { fired += 100; }, 50);
  timers.clearTimeout(cancelled);
  let intervalTicks = 0;
  const interval = timers.setInterval(() => { intervalTicks += 1; }, 30);
  await sleep(200);
  timers.clearInterval(interval);
  const ticksAfterClear = intervalTicks;
  await sleep(100);

  results.timeoutFiredOnce = fired === 1;
  results.intervalTicked = intervalTicks >= 4;
  results.intervalStopped = intervalTicks === ticksAfterClear;
  results.workerIds = (timers.setTimeout(() => {}, 1) as number) >= 1_000_000_000;
  (window as unknown as { __timerResults: unknown }).__timerResults = results;
  document.getElementById("out")!.textContent = JSON.stringify(results, null, 2);
}

void run();
