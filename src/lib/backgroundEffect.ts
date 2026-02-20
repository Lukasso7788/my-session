// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// Variant: Hidden-mode keepalive 1–2 FPS + NO segmentation (clean + low-risk)
//
// ✅ When visible:
//   - draw at your fps (RAF/VFC)
//   - segmentation runs (throttled) when available
//
// ✅ When hidden:
//   - DO NOT call seg.send()
//   - DO NOT try to be realtime
//   - draw only fallback (blur-whole-frame OR raw video)
//   - tick at 1–2 FPS using setTimeout
//
// ✅ Also adds:
//   - debug logs (opt-in, default on localhost)
//   - segmentation throttling cap (default 10 fps)
//   - safe cleanup + guards against double-scheduling

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30
    maxWidth?: number; // default 1280

    // optional knobs
    hiddenFps?: number; // default 1.5
    segFps?: number; // default 10
    debug?: boolean; // default true on localhost
};

type Processor = {
    startEffect: (input: MediaStream) => Promise<MediaStream> | MediaStream;
    stopEffect: () => Promise<void> | void;
    dispose: () => Promise<void> | void;
};

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n));
}

async function loadImage(url: string): Promise<HTMLImageElement> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = url;
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image: " + url));
    });
    return img;
}

async function tryCreateSelfieSegmentation() {
    try {
        const mod: any = await import("@mediapipe/selfie_segmentation");
        const SelfieSegmentation = mod?.SelfieSegmentation;
        if (!SelfieSegmentation) return null;

        const seg = new SelfieSegmentation({
            locateFile: (file: string) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
        });

        seg.setOptions({
            modelSelection: 1,
        });

        return seg;
    } catch {
        return null;
    }
}

export function createBackgroundEffect(opts: CreateOpts): Processor {
    const mode: BgMode = opts.mode ?? "none";
    const fps = clamp(opts.fps ?? 30, 5, 60);
    const hiddenFps = clamp(opts.hiddenFps ?? 1.5, 0.2, 5); // 1–2 fps sweet spot
    const blurPx = clamp(opts.blurPx ?? 10, 0, 40);
    const maxWidth = clamp(opts.maxWidth ?? 1280, 320, 3840);
    const segFps = clamp(opts.segFps ?? 10, 0, 30);

    const debugDefault = (() => {
        try {
            const host = String((window as any)?.location?.hostname ?? "");
            return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
        } catch {
            return true;
        }
    })();
    const debug = opts.debug ?? debugDefault;

    const log = (...args: any[]) => {
        if (!debug) return;
        try {
            // eslint-disable-next-line no-console
            console.debug("[bgEffect]", ...args);
        } catch { }
    };

    let running = false;

    let rafId: number | null = null;
    let timerId: number | null = null;
    let vfcId: number | null = null;

    let tickInFlight = false;

    let videoEl: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    let outStream: MediaStream | null = null;

    let bgImage: HTMLImageElement | null = null;

    // MediaPipe
    let seg: any | null = null;
    let lastMask: CanvasImageSource | null = null;
    let segReady = false;
    let segBusy = false;
    let lastSegAt = 0;

    const stopTracks = (s: MediaStream | null) => {
        try {
            s?.getTracks?.()?.forEach((t) => {
                try {
                    t.stop();
                } catch { }
            });
        } catch { }
    };

    const cleanupDom = () => {
        try {
            if (videoEl) {
                videoEl.pause?.();
                (videoEl as any).srcObject = null;
            }
        } catch { }
        videoEl = null;
        canvas = null;
        ctx = null;
    };

    const clearScheduled = () => {
        try {
            if (rafId != null) cancelAnimationFrame(rafId);
        } catch { }
        rafId = null;

        try {
            if (timerId != null) clearTimeout(timerId);
        } catch { }
        timerId = null;

        try {
            if (
                vfcId != null &&
                videoEl &&
                typeof (videoEl as any).cancelVideoFrameCallback === "function"
            ) {
                (videoEl as any).cancelVideoFrameCallback(vfcId);
            }
        } catch { }
        vfcId = null;
    };

    const isVisible = () => {
        try {
            return document.visibilityState === "visible";
        } catch {
            return true;
        }
    };

    const shouldUseVFC = () => {
        try {
            return (
                isVisible() &&
                !!videoEl &&
                typeof (videoEl as any).requestVideoFrameCallback === "function"
            );
        } catch {
            return false;
        }
    };

    const tickDrawFallback = () => {
        if (!running || !videoEl || !canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        try {
            ctx.clearRect(0, 0, w, h);

            if (mode === "blur") {
                ctx.filter = `blur(${blurPx}px)`;
                ctx.drawImage(videoEl, 0, 0, w, h);
                ctx.filter = "none";
                return;
            }

            ctx.drawImage(videoEl, 0, 0, w, h);
        } catch {
            // ignore draw errors
        }
    };

    const tickDrawWithMask = () => {
        if (!running || !videoEl || !canvas || !ctx) return;
        const w = canvas.width;
        const h = canvas.height;

        try {
            ctx.clearRect(0, 0, w, h);

            // 1) foreground
            ctx.save();
            ctx.drawImage(videoEl, 0, 0, w, h);
            ctx.globalCompositeOperation = "destination-in";
            if (lastMask) ctx.drawImage(lastMask, 0, 0, w, h);
            ctx.restore();

            // 2) background
            ctx.save();
            ctx.globalCompositeOperation = "destination-over";

            if (mode === "image" && bgImage) {
                ctx.drawImage(bgImage, 0, 0, w, h);
            } else if (mode === "blur") {
                ctx.filter = `blur(${blurPx}px)`;
                ctx.drawImage(videoEl, 0, 0, w, h);
                ctx.filter = "none";
            } else {
                ctx.drawImage(videoEl, 0, 0, w, h);
            }

            ctx.restore();
            ctx.globalCompositeOperation = "source-over";
        } catch {
            // ignore draw errors
        }
    };

    const scheduleNext = () => {
        if (!running) return;

        // IMPORTANT: prevent duplicates
        clearScheduled();

        // Hidden => 1–2 fps timer keepalive
        if (!isVisible()) {
            const ms = Math.max(200, Math.round(1000 / hiddenFps));
            timerId = window.setTimeout(() => {
                timerId = null;
                void tickAndReschedule();
            }, ms) as any;
            return;
        }

        // Visible => prefer VFC, else RAF
        if (shouldUseVFC()) {
            try {
                vfcId = (videoEl as any).requestVideoFrameCallback(() => {
                    vfcId = null;
                    void tickAndReschedule();
                });
                return;
            } catch {
                // fall through
            }
        }

        rafId = requestAnimationFrame(() => {
            rafId = null;
            void tickAndReschedule();
        });
    };

    const tickAndReschedule = async () => {
        if (!running) return;

        if (tickInFlight) {
            scheduleNext();
            return;
        }

        tickInFlight = true;
        try {
            const visible = isVisible();

            // ✅ Hidden mode: NO segmentation, fallback only
            if (!visible) {
                tickDrawFallback();
                return;
            }

            // ✅ Visible: draw (with mask if we have it)
            if (segReady && lastMask) tickDrawWithMask();
            else tickDrawFallback();

            // ✅ Visible: segmentation (throttled) — optional
            if (seg && segReady && !segBusy && videoEl && segFps > 0) {
                const now = performance.now();
                const interval = 1000 / segFps;
                if (now - lastSegAt >= interval) {
                    lastSegAt = now;
                    segBusy = true;
                    try {
                        await seg.send({ image: videoEl });
                    } catch {
                        // ignore
                    } finally {
                        segBusy = false;
                    }
                }
            }
        } finally {
            tickInFlight = false;
            scheduleNext();
        }
    };

    const onVisibility = () => {
        if (!running) return;

        // On flip, just reschedule (switches timer<->RAF/VFC)
        log("visibilitychange ->", isVisible() ? "visible" : "hidden");

        // When returning visible, we want a "kick" so we don't stay on a stale frame
        if (isVisible()) {
            lastSegAt = 0; // allow seg immediately
        }

        scheduleNext();
    };

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        log("startEffect()", { mode, fps, hiddenFps, segFps, blurPx, maxWidth });

        // Prepare video element
        videoEl = document.createElement("video");
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.autoplay = true;
        (videoEl as any).srcObject = input;

        // Try play (muted+autoplay should pass)
        try {
            await videoEl.play().catch((e) => log("videoEl.play fail:", e));
        } catch (e) {
            log("videoEl.play throw:", e);
        }

        // Wait for metadata/dimensions
        const t0 = Date.now();
        while (Date.now() - t0 < 1500) {
            const vw = videoEl.videoWidth || 0;
            const vh = videoEl.videoHeight || 0;
            if (vw > 0 && vh > 0) break;
            await sleep(50);
        }

        const vw0 = videoEl.videoWidth || 640;
        const vh0 = videoEl.videoHeight || 360;

        const scale = vw0 > maxWidth ? maxWidth / vw0 : 1;
        const vw = Math.max(2, Math.round(vw0 * scale));
        const vh = Math.max(2, Math.round(vh0 * scale));

        canvas = document.createElement("canvas");
        canvas.width = vw;
        canvas.height = vh;
        ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) throw new Error("Canvas 2D context not available");

        // Output stream
        outStream = canvas.captureStream(fps);

        // Background image
        if (mode === "image" && opts.imageUrl) {
            try {
                bgImage = await loadImage(opts.imageUrl);
            } catch (e) {
                log("bgImage load fail:", e);
                bgImage = null;
            }
        }

        // MediaPipe init (optional)
        seg = await tryCreateSelfieSegmentation();
        if (seg) {
            try {
                seg.onResults((res: any) => {
                    if (res?.segmentationMask) lastMask = res.segmentationMask as any;
                });
                segReady = true;
                log("MediaPipe ready");
            } catch (e) {
                log("MediaPipe onResults fail:", e);
                seg = null;
                segReady = false;
            }
        } else {
            log("MediaPipe not available (fallback only)");
        }

        running = true;
        tickInFlight = false;
        lastSegAt = 0;

        try {
            document.addEventListener("visibilitychange", onVisibility);
        } catch { }

        // Draw once immediately so user sees effect instantly
        try {
            tickDrawFallback();
        } catch { }

        scheduleNext();

        return outStream;
    };

    const stopEffect = async () => {
        if (!running) return;
        log("stopEffect()");

        running = false;
        clearScheduled();

        try {
            document.removeEventListener("visibilitychange", onVisibility);
        } catch { }

        try {
            await seg?.close?.();
        } catch { }
        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;
        lastSegAt = 0;

        // Stop output tracks (canvas stream)
        stopTracks(outStream);
        outStream = null;

        bgImage = null;

        cleanupDom();
    };

    const dispose = async () => {
        log("dispose()");
        await stopEffect();
    };

    return { startEffect, stopEffect, dispose };
}