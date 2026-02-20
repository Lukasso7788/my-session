// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// ✅ Key perf changes vs old version:
// - Split loops: DRAW can run smooth (fps), SEG runs slower (cheap CPU win)
// - Hidden-tab behavior: keep stream alive by drawing last composite frame at low FPS
// - Aggressive downscale for segmentation (segMaxWidth) while keeping output canvas higher
// - Never overlap seg.send() calls (hard gate)
// - Works even if @mediapipe/selfie_segmentation is missing (fallback draw only)

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;

    blurPx?: number; // default 10
    fps?: number; // default 30

    // Output canvas max width (what you actually stream to Jitsi)
    maxWidth?: number; // default 1280

    // Optional extras (safe to ignore in callers)
    segFps?: number; // default: auto (lowPower friendly)
    segMaxWidth?: number; // default: auto (lower than maxWidth)
    keepAliveFpsHidden?: number; // default 2
    freezeOnHidden?: boolean; // default true
    lowPower?: boolean; // hint from engine (mobile/weak)
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

    // draw fps (how often we paint to output canvas)
    const drawFps = clamp(opts.fps ?? 30, 5, 60);

    // quality knobs
    const blurPx = clamp(opts.blurPx ?? 10, 0, 40);
    const maxWidth = clamp(opts.maxWidth ?? 1280, 320, 3840);

    // hints
    const lowPower = !!opts.lowPower;

    // segmentation fps (how often we update mask)
    // ✅ default: slower than drawFps
    const defaultSegFps = lowPower ? 5 : 7;
    const segFps = clamp(opts.segFps ?? Math.min(defaultSegFps, Math.max(3, Math.floor(drawFps / 4))), 1, 15);

    // segmentation resolution (downscaled)
    // ✅ default: much smaller than output
    const defaultSegMaxW = lowPower ? 360 : 480;
    const segMaxWidth = clamp(opts.segMaxWidth ?? Math.min(defaultSegMaxW, maxWidth), 160, 1280);

    // hidden keep-alive
    const keepAliveFpsHidden = clamp(opts.keepAliveFpsHidden ?? 2, 1, 15);
    const freezeOnHidden = typeof opts.freezeOnHidden === "boolean" ? opts.freezeOnHidden : true;

    // --------------------------------------------------------------------------
    // State
    // --------------------------------------------------------------------------
    let running = false;

    // DOM/Canvas
    let videoEl: HTMLVideoElement | null = null;

    // output (streamed) canvas
    let outCanvas: HTMLCanvasElement | null = null;
    let outCtx: CanvasRenderingContext2D | null = null;

    // seg input canvas (small)
    let segCanvas: HTMLCanvasElement | null = null;
    let segCtx: CanvasRenderingContext2D | null = null;

    // cached background image
    let bgImage: HTMLImageElement | null = null;

    // streams
    let outStream: MediaStream | null = null;
    let inputStream: MediaStream | null = null;

    // loops
    let drawRafId: number | null = null;
    let drawTimerId: number | null = null;
    let drawVfcId: number | null = null;

    let segTimerId: number | null = null;
    let segBusy = false;

    // segmentation instance + mask
    let seg: any | null = null;
    let segReady = false;

    // last mask (usually a canvas from MediaPipe)
    let lastMask: CanvasImageSource | null = null;

    // freeze frame cache (for hidden)
    let frozenFrame: ImageBitmap | null = null;

    // resize / dimensions
    let outW = 640;
    let outH = 360;

    let segW = 320;
    let segH = 180;

    const stopTracks = (s: MediaStream | null) => {
        try {
            s?.getTracks?.()?.forEach((t) => {
                try {
                    t.stop();
                } catch { }
            });
        } catch { }
    };

    const clearDrawScheduled = () => {
        try {
            if (drawRafId != null) cancelAnimationFrame(drawRafId);
        } catch { }
        drawRafId = null;

        try {
            if (drawTimerId != null) clearTimeout(drawTimerId);
        } catch { }
        drawTimerId = null;

        try {
            if (drawVfcId != null && videoEl && typeof (videoEl as any).cancelVideoFrameCallback === "function") {
                (videoEl as any).cancelVideoFrameCallback(drawVfcId);
            }
        } catch { }
        drawVfcId = null;
    };

    const clearSegScheduled = () => {
        try {
            if (segTimerId != null) clearTimeout(segTimerId);
        } catch { }
        segTimerId = null;
    };

    const cleanupDom = () => {
        try {
            if (videoEl) {
                videoEl.pause?.();
                (videoEl as any).srcObject = null;
            }
        } catch { }

        videoEl = null;

        outCanvas = null;
        outCtx = null;

        segCanvas = null;
        segCtx = null;
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
            return isVisible() && !!videoEl && typeof (videoEl as any).requestVideoFrameCallback === "function";
        } catch {
            return false;
        }
    };

    // --------------------------------------------------------------------------
    // Drawing
    // --------------------------------------------------------------------------
    const drawFallbackNoMask = () => {
        if (!running || !outCtx || !outCanvas) return;

        const ctx = outCtx;
        const w = outCanvas.width;
        const h = outCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // If hidden and freeze enabled: draw frozen bitmap if we have it
        if (!isVisible() && freezeOnHidden && frozenFrame) {
            ctx.drawImage(frozenFrame, 0, 0, w, h);
            return;
        }

        if (!videoEl) return;

        if (mode === "blur") {
            ctx.filter = `blur(${blurPx}px)`;
            ctx.drawImage(videoEl, 0, 0, w, h);
            ctx.filter = "none";
            return;
        }

        // image/none without mask -> raw frame
        ctx.drawImage(videoEl, 0, 0, w, h);
    };

    const drawWithMask = () => {
        if (!running || !outCtx || !outCanvas) return;

        const ctx = outCtx;
        const w = outCanvas.width;
        const h = outCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // If hidden + freeze enabled: draw frozen bitmap if present
        if (!isVisible() && freezeOnHidden && frozenFrame) {
            ctx.drawImage(frozenFrame, 0, 0, w, h);
            return;
        }

        if (!videoEl) return;

        // 1) Foreground (person) using mask
        ctx.save();
        ctx.drawImage(videoEl, 0, 0, w, h);
        ctx.globalCompositeOperation = "destination-in";
        if (lastMask) ctx.drawImage(lastMask, 0, 0, w, h);
        ctx.restore();

        // 2) Background behind person
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

    const maybeUpdateFrozenFrame = async () => {
        if (!freezeOnHidden) return;
        if (!outCanvas) return;

        // only capture when transitioning to hidden (or if we don't have one yet)
        if (frozenFrame) return;

        try {
            if (typeof createImageBitmap === "function") {
                frozenFrame = await createImageBitmap(outCanvas);
            }
        } catch {
            // ignore
        }
    };

    const clearFrozenFrame = () => {
        try {
            frozenFrame?.close?.();
        } catch { }
        frozenFrame = null;
    };

    // Draw tick (cheap)
    const drawTick = () => {
        if (!running) return;

        // If mode none, still pass through (raw)
        const haveMask = !!(segReady && lastMask);
        try {
            if (haveMask) drawWithMask();
            else drawFallbackNoMask();
        } catch {
            // ignore draw errors
        }
    };

    const scheduleNextDraw = () => {
        if (!running) return;
        clearDrawScheduled();

        const visible = isVisible();
        const fps = visible ? drawFps : keepAliveFpsHidden;
        const ms = Math.max(33, Math.round(1000 / fps));

        // Hidden => timer (RAF/VFC may stop)
        if (!visible) {
            drawTimerId = window.setTimeout(() => {
                drawTimerId = null;
                drawTick();
                scheduleNextDraw();
            }, ms) as any;
            return;
        }

        // Visible => prefer VFC, fallback RAF, but keep fps cap via timer if needed
        if (shouldUseVFC()) {
            try {
                drawVfcId = (videoEl as any).requestVideoFrameCallback(() => {
                    drawVfcId = null;
                    drawTick();
                    scheduleNextDraw();
                });
                return;
            } catch {
                // fall through
            }
        }

        // RAF is fine; our drawFps is typically <= 30 so this can be “too fast”.
        // We cap by using a timer gate if drawFps < 50.
        if (drawFps < 50) {
            drawTimerId = window.setTimeout(() => {
                drawTimerId = null;
                drawRafId = requestAnimationFrame(() => {
                    drawRafId = null;
                    drawTick();
                    scheduleNextDraw();
                });
            }, ms) as any;
            return;
        }

        drawRafId = requestAnimationFrame(() => {
            drawRafId = null;
            drawTick();
            scheduleNextDraw();
        });
    };

    // --------------------------------------------------------------------------
    // Segmentation (expensive) — separate loop
    // --------------------------------------------------------------------------
    const scheduleNextSeg = () => {
        if (!running) return;
        clearSegScheduled();

        // ✅ When hidden: we DO NOT keep segmenting (huge CPU win)
        // Mask can “lag behind” but frozen frame keeps UX consistent.
        if (!isVisible()) {
            segTimerId = window.setTimeout(() => {
                segTimerId = null;
                // still reschedule to re-check visibility
                scheduleNextSeg();
            }, 700) as any;
            return;
        }

        const intervalMs = Math.max(80, Math.round(1000 / segFps));

        segTimerId = window.setTimeout(async () => {
            segTimerId = null;
            if (!running) return;
            await segTick();
            scheduleNextSeg();
        }, intervalMs) as any;
    };

    const segTick = async () => {
        if (!running) return;
        if (!seg || !segReady) return;
        if (!videoEl || !segCanvas || !segCtx) return;
        if (segBusy) return;

        // For MediaPipe, it helps to feed smaller images
        try {
            const vw = videoEl.videoWidth || 0;
            const vh = videoEl.videoHeight || 0;
            if (vw <= 0 || vh <= 0) return;

            // draw current frame into seg canvas (downscaled)
            segCtx.clearRect(0, 0, segW, segH);
            segCtx.drawImage(videoEl, 0, 0, segW, segH);

            segBusy = true;
            try {
                // send the segCanvas (small) instead of the full videoEl
                await seg.send({ image: segCanvas });
            } catch {
                // ignore
            } finally {
                segBusy = false;
            }
        } catch {
            segBusy = false;
        }
    };

    // --------------------------------------------------------------------------
    // Visibility handling
    // --------------------------------------------------------------------------
    const onVisibility = () => {
        if (!running) return;

        if (!isVisible()) {
            // entering hidden:
            // - cache a frozen composite frame once
            // - draw continues at low fps (keepAliveFpsHidden)
            void maybeUpdateFrozenFrame();
        } else {
            // back visible:
            // - discard freeze frame
            clearFrozenFrame();
        }

        // reschedule both loops immediately to avoid being stuck in wrong mode
        scheduleNextDraw();
        scheduleNextSeg();
    };

    // --------------------------------------------------------------------------
    // Start / Stop
    // --------------------------------------------------------------------------
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

        // wait for metadata
        const t0 = Date.now();
        while (Date.now() - t0 < 1200) {
            const vw = videoEl.videoWidth || 0;
            const vh = videoEl.videoHeight || 0;
            if (vw > 0 && vh > 0) break;
            await sleep(50);
        }

        const vw0 = videoEl.videoWidth || 640;
        const vh0 = videoEl.videoHeight || 360;

        // output size (streamed)
        const outScale = vw0 > maxWidth ? maxWidth / vw0 : 1;
        outW = Math.round(vw0 * outScale);
        outH = Math.round(vh0 * outScale);

        outCanvas = document.createElement("canvas");
        outCanvas.width = outW;
        outCanvas.height = outH;

        outCtx = outCanvas.getContext("2d", { alpha: true });
        if (!outCtx) throw new Error("Canvas 2D context not available");

        // segmentation size (smaller)
        const segScale = vw0 > segMaxWidth ? segMaxWidth / vw0 : 1;
        segW = Math.max(160, Math.round(vw0 * segScale));
        segH = Math.max(120, Math.round(vh0 * segScale));

        segCanvas = document.createElement("canvas");
        segCanvas.width = segW;
        segCanvas.height = segH;
        segCtx = segCanvas.getContext("2d", { alpha: false });
        // if segCtx fails, we still run without segmentation
        if (!segCtx) {
            segCanvas = null;
            segCtx = null;
        }

        // Output stream (this is what Jitsi will encode)
        outStream = outCanvas.captureStream(drawFps);

        // background image if needed
        bgImage = null;
        if (mode === "image" && opts.imageUrl) {
            try {
                bgImage = await loadImage(opts.imageUrl);
            } catch {
                bgImage = null;
            }
        }

        // init segmentation if possible
        seg = await tryCreateSelfieSegmentation();
        if (seg) {
            try {
                seg.onResults((res: any) => {
                    // MediaPipe returns a mask (usually canvas). We'll use it scaled to output size.
                    if (res?.segmentationMask) lastMask = res.segmentationMask as any;
                });
                segReady = true;
            } catch {
                seg = null;
                segReady = false;
            }
        }

        running = true;
        segBusy = false;
        lastMask = null;
        clearFrozenFrame();

        try {
            document.addEventListener("visibilitychange", onVisibility);
        } catch { }

        // If we start already hidden, cache a frozen frame after first draw
        if (!isVisible()) {
            // do one draw so outCanvas has pixels, then freeze
            drawTick();
            await maybeUpdateFrozenFrame();
        }

        scheduleNextDraw();
        scheduleNextSeg();

        return outStream!;
    };

    const stopEffect = async () => {
        running = false;

        clearDrawScheduled();
        clearSegScheduled();

        try {
            document.removeEventListener("visibilitychange", onVisibility);
        } catch { }

        // stop segmentation
        try {
            await seg?.close?.();
        } catch { }
        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;

        // stop output tracks (canvas stream)
        stopTracks(outStream);
        outStream = null;

        clearFrozenFrame();
        cleanupDom();
    };

    const dispose = async () => {
        await stopEffect();
        bgImage = null;
        inputStream = null;
    };

    return { startEffect, stopEffect, dispose };
}