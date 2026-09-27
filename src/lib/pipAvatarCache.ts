/** Bounded LRU of decoded PiP images. Late events cannot resurrect evicted entries. */
export function createPiPAvatarCache(makeImage: () => HTMLImageElement, maxEntries = 64) {
    const entries = new Map<string, { image: HTMLImageElement | null }>();
    const release = (entry: { image: HTMLImageElement | null }) => {
        if (!entry.image) return;
        entry.image.onload = null;
        entry.image.onerror = null;
        entry.image.removeAttribute("src");
        entry.image = null;
    };
    return {
        get(url: string): HTMLImageElement | null {
            if (!url) return null;
            let entry = entries.get(url);
            if (entry) {
                entries.delete(url);
                entries.set(url, entry);
                return entry.image?.complete && entry.image.naturalWidth > 0 ? entry.image : null;
            }
            const image = makeImage();
            image.crossOrigin = "anonymous";
            image.referrerPolicy = "no-referrer";
            entry = { image };
            const current = entry;
            image.onerror = () => {
                if (entries.get(url) === current) release(current);
            };
            entries.set(url, entry);
            while (entries.size > Math.max(1, maxEntries)) {
                const oldest = entries.keys().next().value!;
                release(entries.get(oldest)!);
                entries.delete(oldest);
            }
            image.src = url;
            return null;
        },
        clear() {
            for (const entry of entries.values()) release(entry);
            entries.clear();
        },
        get size() { return entries.size; },
    };
}
