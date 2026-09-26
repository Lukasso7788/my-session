export type ChatProfile = {
    id: string;
    full_name?: string | null;
    avatar_url?: string | null;
};

/** Cache only database-confirmed profiles, never UI placeholders/host overrides.
 * Share in-flight reads per author and retry a transient failure once. There is
 * no polling: later failures are retried by an explicit user action/new load.
 */
export function createChatProfileLoader(fetchProfiles: (ids: string[]) => Promise<ChatProfile[]>) {
    const confirmed = new Map<string, ChatProfile>();
    const pending = new Map<string, Promise<void>>();
    const snapshot = () => Object.fromEntries(confirmed);
    const seed = (profiles: Record<string, ChatProfile>) => {
        for (const profile of Object.values(profiles)) {
            if (!confirmed.has(profile.id)) confirmed.set(profile.id, profile);
        }
    };
    const ensure = async (ids: string[]) => {
        const unique = [...new Set(ids.filter(Boolean))];
        const missing = unique.filter((id) => !confirmed.has(id) && !pending.has(id));
        if (missing.length) {
            // Register the promise before starting the query, so concurrent
            // realtime/bootstrap loads cannot issue another read for this author.
            const batch = Promise.resolve().then(async () => {
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        const unresolved = missing.filter((id) => !confirmed.has(id));
                        seed(Object.fromEntries((await fetchProfiles(unresolved)).map((p) => [p.id, p])));
                        if (missing.some((id) => !confirmed.has(id))) throw new Error("Chat profiles unavailable");
                        return;
                    } catch (error) {
                        if (attempt === 1) throw error;
                    }
                }
            });
            const tracked = batch.finally(() => {
                for (const id of missing) if (pending.get(id) === tracked) pending.delete(id);
            });
            for (const id of missing) pending.set(id, tracked);
        }
        await Promise.all([...new Set(unique.map((id) => pending.get(id)).filter(Boolean))]);
        return Object.fromEntries(unique.filter((id) => confirmed.has(id)).map((id) => [id, confirmed.get(id)!]));
    };
    return { ensure, snapshot, seed };
}
