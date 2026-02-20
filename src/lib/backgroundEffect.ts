// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// PATCH (Feb 2026):
// ✅ Pre-blur cache (two-stage render) to avoid doing expensive blur every frame.
// - We render a blurred background frame into a dedicated offscreen canvas at a lower cadence
// - Foreground compositing uses the cached blurred canvas (cheap)
// - Greatly reduces GPU/CPU churn, especially on laptops + when tab is throttled

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30
    maxWidth?: number; // default 1280

    // optional perf knobs (safe defaults)
    blurCacheFps?: number; // default: min(fps, 12)
    maskFps?: number; // default: min(fps, 12)  (segmentation cadence; not draw cadence)
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
    // NOTE: For this to truly be "optional" at runtime, your bundler must be able to resolve this import.
    // The simplest path: install the package:
    //   npm i @mediapipe/selfie_segmentation
    try {
        const mod: any = await import("@mediapipe/selfie_segmentation");
        const SelfieSegmentation = mod?.SelfieSegmentation;
        if (!SelfieSegmentation) return null;

        const seg = new SelfieSegmentation({
            locateFile: (file: string) =>
                // CDN fallback is common; adjust if you host locally.
                `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
        });

        seg.setOptions({
            modelSelection: 1, // 0 = general, 1 = landscape (usually better)
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

    // ✅ blur cache cadence (separate from draw cadence)
    const blurCacheFps = clamp(opts.blurCacheFps ?? Math.min(fps, 12), 1, 30);

    // ✅ segmentation cadence (separate from draw cadence)
    const maskFps = clamp(opts.maskFps ?? Math.min(fps, 12), 1, 30);

    // IMPORTANT:
    // We intentionally do NOT rely purely on requestAnimationFrame.
    // When the tab is hidden, RAF can effectively stop. That can freeze the outgoing canvas stream.
    // Instead we use a hybrid scheduler:
    // - visible: prefer requestVideoFrameCallback (best), else RAF
    // - hidden: use setTimeout (timers get throttled, but they still tick -> stream stays alive)
    let running = false;

    let rafId: number | null = null;
    let timerId: number | null = null;
    let vfcId: number | null = null;

    let tickInFlight = false;

    let videoEl: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    // ✅ Pre-blur cache canvas
    let blurCanvas: HTMLCanvasElement | null = null;
    let blurCtx: CanvasRenderingContext2D | null = null;
    let lastBlurAt = 0;
    let lastBlurVideoTime = -1;

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

        blurCanvas = null;
        blurCtx = null;

        lastBlurAt = 0;
        lastBlurVideoTime = -1;
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
            if (vfcId != null && videoEl && typeof (videoEl as any).cancelVideoFrameCallback === "function") {
                (videoEl as any).cancelVideoFrameCallback(vfcId);
            }
        } catch { }
        vfcId = null;
    };

    const safeNowMs = () => {
        try {
            return typeof performance !== "undefined" ? performance.now() : Date.now();
        } catch {
            return Date.now();
        }
    };

    // ✅ Update blurred background cache at a lower cadence
    const maybeUpdateBlurCache = () => {
        if (!running) return;
        if (mode !== "blur") return;
        if (!videoEl || !blurCanvas || !blurCtx || !canvas) return;

        const now = safeNowMs();
        const interval = 1000 / blurCacheFps;

        // Avoid re-blurring if:
        // - called too soon
        // - or video hasn't advanced (common when throttled / hidden)
        const vt = Number(videoEl.currentTime || 0);
        if (now - lastBlurAt < interval && vt === lastBlurVideoTime) return;

        lastBlurAt = now;
        lastBlurVideoTime = vt;

        const w = blurCanvas.width;
        const h = blurCanvas.height;

        try {
            blurCtx.clearRect(0, 0, w, h);
            blurCtx.filter = `blur(${blurPx}px)`;
            blurCtx.drawImage(videoEl, 0, 0, w, h);
        } catch {
            // ignore
        } finally {
            // always reset filter
            try {
                blurCtx.filter = "none";
            } catch { }
        }
    };

    const drawRawVideo = () => {
        if (!videoEl || !canvas || !ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        try {
            ctx.drawImage(videoEl, 0, 0, w, h);
        } catch {
            // ignore
        }
    };

    const drawBlurredBackground = () => {
        if (!canvas || !ctx) return;

        // Ensure cache up-to-date-ish
        maybeUpdateBlurCache();

        const w = canvas.width;
        const h = canvas.height;

        if (blurCanvas) {
            try {
                ctx.drawImage(blurCanvas, 0, 0, w, h);
                return;
            } catch {
                // fallthrough
            }
        }

        // Absolute fallback: do blur directly (should be rare)
        if (videoEl) {
            try {
                ctx.filter = `blur(${blurPx}px)`;
                ctx.drawImage(videoEl, 0, 0, w, h);
            } catch {
                // ignore
            } finally {
                try {
                    ctx.filter = "none";
                } catch { }
            }
        }
    };

    const tickDrawFallback = () => {
        if (!running || !videoEl || !canvas || !ctx) return;

        // Fallback: no segmentation available yet
        // - blur: use cached blurred background (cheap) OR direct blur fallback
        // - image: without mask it cannot be composited meaningfully -> draw raw video frame
        const w = canvas.width;
        const h = canvas.height;

        try {
            ctx.clearRect(0, 0, w, h);
        } catch { }

        if (mode === "blur") {
            drawBlurredBackground();
            return;
        }

        // mode === "image" or "none" but no segmentation -> just draw the raw frame
        drawRawVideo();
    };

    const tickDrawWithMask = () => {
        if (!running || !videoEl || !canvas || !ctx) return;
        const w = canvas.width;
        const h = canvas.height;

        try {
            ctx.clearRect(0, 0, w, h);
        } catch { }

        // 1) Draw person (foreground) using mask
        // NOTE: We draw the raw video once for foreground only.
        try {
            ctx.save();
            drawRawVideo();
            ctx.globalCompositeOperation = "destination-in";
            if (lastMask) ctx.drawImage(lastMask, 0, 0, w, h);
            ctx.restore();
        } catch {
            try {
                ctx.globalCompositeOperation = "source-over";
            } catch { }
        }

        // 2) Draw background behind person
        try {
            ctx.save();
            ctx.globalCompositeOperation = "destination-over";

            if (mode === "image" && bgImage) {
                ctx.drawImage(bgImage, 0, 0, w, h);
            } else if (mode === "blur") {
                // ✅ cached pre-blur background
                drawBlurredBackground();
            } else {
                drawRawVideo();
            }

            ctx.restore();
            ctx.globalCompositeOperation = "source-over";
        } catch {
            try {
                ctx.globalCompositeOperation = "source-over";
            } catch { }
        }
    };

    const shouldUseVFC = () => {
        // Prefer requestVideoFrameCallback when visible (better pacing than RAF).
        // Some browsers may not support it.
        try {
            return (
                document.visibilityState === "visible" &&
                !!videoEl &&
                typeof (videoEl as any).requestVideoFrameCallback === "function"
            );
        } catch {
            return false;
        }
    };

    const scheduleNext = () => {
        if (!running) return;

        // Cancel any existing scheduled callback before scheduling a new one
        // (prevents duplicates on visibility flips)
        clearScheduled();

        // Hidden => timers (RAF can stop entirely)
        if (document.visibilityState !== "visible") {
            const ms = Math.max(33, Math.round(1000 / fps));
            timerId = window.setTimeout(() => {
                timerId = null;
                void tickAndReschedule();
            }, ms) as any;
            return;
        }

        // Visible => prefer VFC, fallback RAF
        if (shouldUseVFC()) {
            try {
                vfcId = (videoEl as any).requestVideoFrameCallback(() => {
                    vfcId = null;
                    void tickAndReschedule();
                });
                return;
            } catch {
                // fall through to RAF
            }
        }

        rafId = requestAnimationFrame(() => {
            rafId = null;
            void tickAndReschedule();
        });
    };

    const tickAndReschedule = async () => {
        if (!running) return;

        // Prevent overlapping ticks (especially important because seg.send is async)
        if (tickInFlight) {
            scheduleNext();
            return;
        }

        tickInFlight = true;
        try {
            // ✅ keep blur cache warm (even if mask not ready yet)
            if (mode === "blur") {
                try {
                    maybeUpdateBlurCache();
                } catch { }
            }

            // draw
            try {
                if (segReady && lastMask) tickDrawWithMask();
                else tickDrawFallback();
            } catch {
                // ignore draw errors
            }

            // segmentation step (async) — throttle to maskFps (NOT full draw fps)
            if (seg && segReady && !segBusy && videoEl) {
                const now = safeNowMs();
                const interval = 1000 / maskFps;

                if (now - lastSegAt >= interval) {
                    lastSegAt = now;

                    segBusy = true;
                    try {
                        // MediaPipe expects an HTMLVideoElement / HTMLImageElement / Canvas
                        await seg.send({ image: videoEl });
                    } catch {
                        // ignore segmentation errors, keep fallback drawing
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
        // We reschedule immediately on visibility flips so we don't get stuck
        // in a paused RAF when tab becomes hidden, or in a throttled timer when visible again.
        scheduleNext();
    };

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        inputStream = input;

        // Prepare video element
        videoEl = document.createElement("video");
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.autoplay = true;
        (videoEl as any).srcObject = input;

        // Wait for metadata so we know dimensions
        try {
            await videoEl.play().catch(() => { });
        } catch { }

        // if metadata not ready, wait a bit
        const t0 = Date.now();
        while (Date.now() - t0 < 1200) {
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

        // ✅ blur cache canvas same size as output canvas
        if (mode === "blur") {
            blurCanvas = document.createElement("canvas");
            blurCanvas.width = vw;
            blurCanvas.height = vh;
            blurCtx = blurCanvas.getContext("2d", { alpha: false });
            lastBlurAt = 0;
            lastBlurVideoTime = -1;
        } else {
            blurCanvas = null;
            blurCtx = null;
        }

        // Output stream
        outStream = canvas.captureStream(fps);

        // Load background image if needed
        if (mode === "image" && opts.imageUrl) {
            try {
                bgImage = await loadImage(opts.imageUrl);
            } catch {
                bgImage = null;
            }
        }

        // Try init MediaPipe segmentation
        seg = await tryCreateSelfieSegmentation();
        if (seg) {
            try {
                seg.onResults((res: any) => {
                    // res.segmentationMask is usually a canvas
                    if (res?.segmentationMask) lastMask = res.segmentationMask as any;
                });
                segReady = true;
            } catch {
                seg = null;
                segReady = false;
            }
        }

        running = true;
        tickInFlight = false;
        lastSegAt = 0;

        // Warm blur cache ASAP (so first frames are not "raw")
        if (mode === "blur") {
            try {
                maybeUpdateBlurCache();
            } catch { }
        }

        // Listen to visibility so we can swap scheduler mode instantly.
        try {
            document.addEventListener("visibilitychange", onVisibility);
        } catch { }

        // Kick scheduler
        scheduleNext();

        return outStream;
    };

    const stopEffect = async () => {
        running = false;

        // Stop scheduler
        clearScheduled();

        // Remove visibility listener
        try {
            document.removeEventListener("visibilitychange", onVisibility);
        } catch { }

        // Stop segmentation
        try {
            await seg?.close?.();
        } catch { }
        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;
        lastSegAt = 0;

        // Don’t stop input tracks here (camera owned by Jitsi base track)
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