// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// ✅ Variant: "frame pacing / timestamps" fix
// ------------------------------------------
// Goal: reduce WebRTC encoder jitter by providing a steadier frame cadence.
//
// Changes vs your current version:
// 1) ✅ captureStream(): DO NOT pass fps (browser picks best, avoids some jitter bugs)
// 2) ✅ strict pacer loop with drift-corrected setTimeout (stable cadence)
//    - we do NOT rely on RAF / requestVideoFrameCallback for scheduling
// 3) ✅ visibilitychange does NOT reschedule (no “reacting” on tab flips)
//    - browser may still throttle timers in background, but we avoid our own mode switches
// 4) ✅ segmentation throttled independently (defaults to min(fps, 10)) so it can’t stall pacing
//
// Notes:
// - You cannot fully “block” background throttling in browsers (by design).
// - But you *can* avoid your own visibility-driven behavior that makes pacing worse.
// - If you want even more stable pacing: move to WebCodecs generator pipeline.
//   (This file keeps it simple and drop-in.)

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30 (pacer target)
    maxWidth?: number; // default 1280

    // Optional knobs:
    segFps?: number; // default min(fps, 10); set 0 to disable segmentation even if available
    strictFps?: boolean; // default true: use drift-corrected pacer
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
    // Optional dependency. If missing — return null, we will fallback.
    try {
        const mod: any = await import("@mediapipe/selfie_segmentation");
        const SelfieSegmentation = mod?.SelfieSegmentation;
        if (!SelfieSegmentation) return null;

        const seg = new SelfieSegmentation({
            locateFile: (file: string) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
        });

        seg.setOptions({
            modelSelection: 1, // 0 = general, 1 = landscape
        });

        return seg;
    } catch {
        return null;
    }
}

export function createBackgroundEffect(opts: CreateOpts): Processor {
    const mode: BgMode = opts.mode ?? "none";
    const fps = clamp(opts.fps ?? 30, 5, 60);
    const blurPx = clamp(opts.blurPx ?? 10, 0, 40);
    const maxWidth = clamp(opts.maxWidth ?? 1280, 320, 3840);

    const strictFps = opts.strictFps ?? true;
    const segFps = clamp(
        opts.segFps ?? Math.min(fps, 10),
        0,
        30
    );

    let running = false;

    // Scheduler state (single pacer)
    let timerId: number | null = null;
    let nextDue = 0; // performance.now() timestamp for the next scheduled tick
    const frameInterval = 1000 / fps;

    let tickInFlight = false;

    let videoEl: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    let outStream: MediaStream | null = null;
    let inputStream: MediaStream | null = null;

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
            if (timerId != null) clearTimeout(timerId);
        } catch { }
        timerId = null;
    };

    const tickDrawFallback = () => {
        if (!running || !videoEl || !canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        if (mode === "blur") {
            ctx.filter = `blur(${blurPx}px)`;
            ctx.drawImage(videoEl, 0, 0, w, h);
            ctx.filter = "none";
            return;
        }

        ctx.drawImage(videoEl, 0, 0, w, h);
    };

    const tickDrawWithMask = () => {
        if (!running || !videoEl || !canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        // 1) foreground (person)
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
    };

    const scheduleNext = () => {
        if (!running) return;

        clearScheduled();

        const now = performance.now();

        if (!strictFps) {
            // basic pacing: schedule roughly at fps (no drift correction)
            const ms = Math.max(5, Math.round(frameInterval));
            timerId = window.setTimeout(() => {
                timerId = null;
                void tickAndReschedule();
            }, ms) as any;
            return;
        }

        // drift-corrected pacing
        if (!nextDue || nextDue < now - 5 * frameInterval) {
            // if we fell behind a lot (tab throttled), reset baseline
            nextDue = now + frameInterval;
        } else {
            // normal: keep stepping by fixed interval
            nextDue += frameInterval;
            // if nextDue is still in the past, catch up (skip frames)
            if (nextDue < now) {
                const behind = now - nextDue;
                const skip = Math.floor(behind / frameInterval) + 1;
                nextDue += skip * frameInterval;
            }
        }

        const delay = Math.max(0, nextDue - now);
        timerId = window.setTimeout(() => {
            timerId = null;
            void tickAndReschedule();
        }, delay) as any;
    };

    const tickAndReschedule = async () => {
        if (!running) return;

        if (tickInFlight) {
            // If previous tick is still running, don't stack. Just schedule next.
            scheduleNext();
            return;
        }

        tickInFlight = true;
        try {
            // Draw
            try {
                if (segReady && lastMask && segFps > 0) tickDrawWithMask();
                else tickDrawFallback();
            } catch {
                // ignore draw errors
            }

            // Segmentation (optional) throttled by segFps, and guarded so it can’t stall pacing too hard
            if (seg && segReady && !segBusy && videoEl && segFps > 0) {
                const now = performance.now();
                const interval = 1000 / Math.max(1, segFps);

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

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        inputStream = input;

        // Prepare video element
        videoEl = document.createElement("video");
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.autoplay = true;
        (videoEl as any).srcObject = input;

        try {
            await videoEl.play().catch(() => { });
        } catch { }

        // Wait for dimensions
        const t0 = Date.now();
        while (Date.now() - t0 < 1500) {
            const vw = videoEl.videoWidth || 0;
            const vh = videoEl.videoHeight || 0;
            if (vw > 0 && vh > 0) break;
            await sleep(50);
        }

        const vw0 = videoEl.videoWidth || 640;
        const vh0 = videoEl.videoHeight || 360;

        // scale down if huge
        const scale = vw0 > maxWidth ? maxWidth / vw0 : 1;
        const vw = Math.max(2, Math.round(vw0 * scale));
        const vh = Math.max(2, Math.round(vh0 * scale));

        canvas = document.createElement("canvas");
        canvas.width = vw;
        canvas.height = vh;
        ctx = canvas.getContext("2d", { alpha: true });

        if (!ctx) throw new Error("Canvas 2D context not available");

        // ✅ IMPORTANT: do NOT pass fps to captureStream (timestamp/pacing stability)
        outStream = canvas.captureStream();

        // Background image
        if (mode === "image" && opts.imageUrl) {
            try {
                bgImage = await loadImage(opts.imageUrl);
            } catch {
                bgImage = null;
            }
        } else {
            bgImage = null;
        }

        // MediaPipe init (optional)
        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;
        lastSegAt = 0;

        if (segFps > 0) {
            seg = await tryCreateSelfieSegmentation();
            if (seg) {
                try {
                    seg.onResults((res: any) => {
                        if (res?.segmentationMask) lastMask = res.segmentationMask as any;
                    });
                    segReady = true;
                } catch {
                    seg = null;
                    segReady = false;
                }
            }
        }

        running = true;
        tickInFlight = false;

        // prime pacer baseline
        nextDue = performance.now();

        // Draw 1st frame immediately so stream starts “hot”
        try {
            tickDrawFallback();
        } catch { }

        scheduleNext();

        return outStream;
    };

    const stopEffect = async () => {
        running = false;

        clearScheduled();

        try {
            await seg?.close?.();
        } catch { }
        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;
        lastSegAt = 0;

        // Only stop output tracks (canvas stream)
        stopTracks(outStream);
        outStream = null;

        cleanupDom();
    };

    const dispose = async () => {
        await stopEffect();
        bgImage = null;
        inputStream = null;
    };

    return { startEffect, stopEffect, dispose };
}