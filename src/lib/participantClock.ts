type Scheduler = {
    now: () => number;
    start: (tick: () => void) => ReturnType<typeof setInterval>;
    stop: (timer: ReturnType<typeof setInterval>) => void;
};

/** One coarse timer shared by clock labels, never by the room/media tile state. */
export function createParticipantClock(scheduler: Scheduler = {
    now: () => Date.now(),
    start: tick => setInterval(tick, 30_000),
    stop: timer => clearInterval(timer),
}) {
    const listeners = new Set<() => void>();
    let snapshot = scheduler.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
        snapshot = scheduler.now();
        for (const listener of listeners) listener();
    };
    return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) {
            listeners.add(listener);
            if (timer === null) {
                snapshot = scheduler.now();
                timer = scheduler.start(tick);
            }
            return () => {
                listeners.delete(listener);
                if (!listeners.size && timer !== null) {
                    scheduler.stop(timer);
                    timer = null;
                }
            };
        },
    };
}

export const participantClock = createParticipantClock();
