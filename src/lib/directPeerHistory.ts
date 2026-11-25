export const DIRECT_PEER_HISTORY_MS = 24 * 60 * 60 * 1000;

export function mergeDirectPeerActivity(previous: Record<string, number>, incoming: Record<string, number>) {
    const next = { ...previous };
    for (const [id, at] of Object.entries(incoming)) {
        if (id && Number.isFinite(at)) next[id] = Math.max(next[id] ?? -Infinity, at);
    }
    return next;
}

export function recentDirectPeerIds(activity: Record<string, number>, recentOnly: boolean, now = Date.now()) {
    return Object.keys(activity).filter(id => !recentOnly || activity[id] >= now - DIRECT_PEER_HISTORY_MS);
}
