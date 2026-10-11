import { useSyncExternalStore } from "react";

/**
 * The stage countdown text ("12:34") changes every second. Keeping it outside
 * React state lets only the labels that show it re-render, not the whole room.
 */
export type RoomCountdownStore = {
    getSnapshot: () => string;
    set: (next: string) => void;
    subscribe: (listener: () => void) => () => void;
};

export function createRoomCountdownStore(initial = ""): RoomCountdownStore {
    const listeners = new Set<() => void>();
    let snapshot = initial;
    return {
        getSnapshot: () => snapshot,
        set(next: string) {
            if (next === snapshot) return;
            snapshot = next;
            for (const listener of listeners) listener();
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export function useRoomCountdown(store: RoomCountdownStore): string {
    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
