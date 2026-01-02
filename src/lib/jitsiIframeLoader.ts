let loaderPromise: Promise<void> | null = null;

export function loadJitsiExternalAPI(domain: string): Promise<void> {
    if (typeof window === "undefined") throw new Error("Browser only");

    const w = window as any;
    if (w.JitsiMeetExternalAPI) return Promise.resolve();
    if (loaderPromise) return loaderPromise;

    loaderPromise = new Promise<void>((resolve, reject) => {
        const src = `https://${domain}/external_api.js`;

        // already added?
        const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
        if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Failed to load " + src)), { once: true });
            return;
        }

        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load " + src));
        document.head.appendChild(s);
    });

    return loaderPromise;
}
