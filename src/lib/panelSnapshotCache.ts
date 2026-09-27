/** Bounded, short-lived in-memory panel snapshots, not persistent data.
 * Sweep on access (including a miss) instead of adding room-wide polling.
 * Warm reopens retain their snapshots; unrelated expired rooms release refs.
 */
export function createPanelSnapshotCache<T>(maxEntries = 4, ttlMs = 5 * 60_000) {
    const entries = new Map<string, { value: T; savedAt: number }>();
    const purgeExpired = (now: number) => {
        for (const [key, entry] of entries) {
            if (now - entry.savedAt >= ttlMs) entries.delete(key);
        }
    };
    return {
        get size() { return entries.size; },
        read(key: string, now = Date.now()): T | undefined {
            purgeExpired(now);
            return key ? entries.get(key)?.value : undefined;
        },
        write(key: string, value: T, now = Date.now()) {
            purgeExpired(now);
            if (!key) return;
            entries.delete(key);
            entries.set(key, { value, savedAt: now });
            while (entries.size > Math.max(0, maxEntries)) {
                entries.delete(entries.keys().next().value!);
            }
        },
    };
}
