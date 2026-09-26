export function tasksPanelCacheKey(room: string, userId: string | null | undefined) {
    // Never reuse another account's private tasks or an anonymous snapshot.
    return room.trim() && userId ? `${room.trim().toLowerCase()}|${userId}` : "";
}

/** Small in-memory snapshot cache, not a second persistent task database. */
export function createTasksPanelCache<T>(maxEntries = 4, ttlMs = 5 * 60_000) {
    const entries = new Map<string, { value: T; savedAt: number }>();
    return {
        read(key: string, now = Date.now()): T | undefined {
            const entry = key ? entries.get(key) : undefined;
            if (!entry) return undefined;
            if (now - entry.savedAt >= ttlMs) { entries.delete(key); return undefined; }
            return entry.value;
        },
        write(key: string, value: T, now = Date.now()) {
            if (!key) return;
            entries.delete(key);
            entries.set(key, { value, savedAt: now });
            while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
        },
    };
}

/** A background SELECT must not undo task edits/inserts/deletes made meanwhile.
 * Profiles are supplementary: hydrating an avatar is not a task mutation.
 */
export function reconcileTasksSnapshot<T extends { id: string; profiles?: unknown }>(
    snapshot: T[], before: T[], current: T[], limit: number,
): T[] {
    const signature = (row: T) => {
        const fields = { ...row };
        delete fields.profiles;
        return JSON.stringify(fields);
    };
    const previous = new Map(before.map((row) => [row.id, row]));
    const live = new Map(current.map((row) => [row.id, row]));
    const changed = new Set([...previous.keys(), ...live.keys()].filter((id) => {
        const old = previous.get(id), next = live.get(id);
        return !old || !next || signature(old) !== signature(next);
    }));
    const incomingIds = new Set(snapshot.map((row) => row.id));
    const additions = current.filter((row) => changed.has(row.id) && !incomingIds.has(row.id));
    const rows = snapshot.flatMap((row) => {
        if (!changed.has(row.id)) return [{ ...row, profiles: live.get(row.id)?.profiles || row.profiles }];
        const next = live.get(row.id);
        return next ? [next] : [];
    });
    return [...additions, ...rows].slice(0, limit);
}
