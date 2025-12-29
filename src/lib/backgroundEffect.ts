// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number;        // default 10
    fps?: number;           // default 30
    maxWidth?: number;      // default 1280

    // ✅ NEW: make mask edges sharper (0..1). 0 = original softness, 0.15-0.25 = slightly sharper.
    maskEdgeBoost?: number; // default 0.18 (~18% sharper)
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

    // ✅ 0..1 contrast boost around 0.5 => sharper mask edge, without “inflating” the person region
    const maskEdgeBoost = clamp(opts.maskEdgeBoost ?? 0.18, 0, 1);

    let running = false;
    let rafId: number | null = null;

    let videoEl: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    let outStream: MediaStream | null = null;
    let inputStream: MediaStream | null = null;

    let bgImage: HTMLImageElement | null = null;

    // MediaPipe
    let seg: any | null = null;

    // We will keep lastMask as a CanvasImageSource.
    // If we apply sharpening, we store it into an offscreen canvas and use that canvas as lastMask.
    let lastMask: CanvasImageSource | null = null;
    let segReady = false;
    let segBusy = false;

    // offscreen mask processor (same size as output canvas)
    let maskCanvas: HTMLCanvasElement | null = null;
    let maskCtx: CanvasRenderingContext2D | null = null;

    const stopTracks = (s: MediaStream | null) => {
        try {
            s?.getTracks?.()?.forEach((t) => {
                try { t.stop(); } catch { }
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

        maskCanvas = null;
        maskCtx = null;

        lastMask = null;
    };

    const ensureMaskCanvas = () => {
        if (!canvas) return false;
        const w = canvas.width;
        const h = canvas.height;
        if (!w || !h) return false;

        if (!maskCanvas || maskCanvas.width !== w || maskCanvas.height !== h) {
            maskCanvas = document.createElement("canvas");
            maskCanvas.width = w;
            maskCanvas.height = h;
            maskCtx = maskCanvas.getContext("2d", { alpha: true, willReadFrequently: true } as any);
        }
        return !!maskCanvas && !!maskCtx;
    };

    // ✅ Make edges slightly sharper by boosting mask contrast around 0.5
    // v in [0..1] => v' = clamp((v - 0.5) * (1 + k) + 0.5, 0..1)
    const sharpenMaskIntoOffscreen = (srcMask: CanvasImageSource) => {
        if (!maskEdgeBoost) {
            lastMask = srcMask;
            return;
        }

        if (!ensureMaskCanvas() || !maskCanvas || !maskCtx) {
            lastMask = srcMask;
            return;
        }

        const w = maskCanvas.width;
        const h = maskCanvas.height;

        try {
            maskCtx.clearRect(0, 0, w, h);
            maskCtx.imageSmoothingEnabled = true;
            maskCtx.filter = "none";
            maskCtx.drawImage(srcMask, 0, 0, w, h);

            // Read pixels and convert to alpha mask with a small contrast boost.
            const img = maskCtx.getImageData(0, 0, w, h);
            const d = img.data;

            const k = maskEdgeBoost;          // 0.18 -> about 18% sharper
            const c = 1 + k;                  // contrast multiplier
            // Small safety: don’t overdo it
            const contrast = clamp(c, 1, 2);

            for (let i = 0; i < d.length; i += 4) {
                // MediaPipe mask is usually grayscale; use red channel.
                const v = d[i] / 255; // 0..1
                const v2 = clamp((v - 0.5) * contrast + 0.5, 0, 1);

                // Store as white with alpha = v2
                d[i] = 255;
                d[i + 1] = 255;
                d[i + 2] = 255;
                d[i + 3] = Math.round(v2 * 255);
            }

            maskCtx.putImageData(img, 0, 0);
            lastMask = maskCanvas;
        } catch {
            // fallback: use original mask if anything fails
            lastMask = srcMask;
        }
    };

    const tickDrawFallback = () => {
        if (!running || !videoEl || !canvas || !ctx) return;

        // Fallback: no segmentation available yet
        // - blur: blur whole frame
        // - image: draw image behind + draw video normal on top (no cutout)
        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        if (mode === "image" && bgImage) {
            ctx.drawImage(bgImage, 0, 0, w, h);
            ctx.globalAlpha = 1;
            ctx.drawImage(videoEl, 0, 0, w, h);
        } else if (mode === "blur") {
            ctx.filter = `blur(${blurPx}px)`;
            ctx.drawImage(videoEl, 0, 0, w, h);
            ctx.filter = "none";
        } else {
            ctx.drawImage(videoEl, 0, 0, w, h);
        }
    };

    const tickDrawWithMask = () => {
        if (!running || !videoEl || !canvas || !ctx) return;
        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        // 1) Draw person (foreground) using mask
        ctx.save();
        ctx.drawImage(videoEl, 0, 0, w, h);
        ctx.globalCompositeOperation = "destination-in";
        if (lastMask) {
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(lastMask, 0, 0, w, h);
        }
        ctx.restore();

        // 2) Draw background behind person
        ctx.save();
        ctx.globalCompositeOperation = "destination-over";

        if (mode === "image" && bgImage) {
            ctx.drawImage(bgImage, 0, 0, w, h);
        } else if (mode === "blur") {
            ctx.filter = `blur(${blurPx}px)`;
            ctx.drawImage(videoEl, 0, 0, w, h);
            ctx.filter = "none";
        } else {
            // none -> just original background (but if mode none, we should not be here)
            ctx.drawImage(videoEl, 0, 0, w, h);
        }

        ctx.restore();
        ctx.globalCompositeOperation = "source-over";
    };

    const loop = async () => {
        if (!running) return;

        try {
            if (segReady && lastMask) tickDrawWithMask();
            else tickDrawFallback();
        } catch {
            // ignore draw errors
        }

        // segmentation step (async)
        if (seg && segReady && !segBusy && videoEl) {
            segBusy = true;
            try {
                // MediaPipe expects an HTMLVideoElement / HTMLImageElement / Canvas
                await seg.send({ image: videoEl });
            } catch {
                // if segmentation fails, fallback
            } finally {
                segBusy = false;
            }
        }

        rafId = requestAnimationFrame(loop as any);
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
        const vw = Math.round(vw0 * scale);
        const vh = Math.round(vh0 * scale);

        canvas = document.createElement("canvas");
        canvas.width = vw;
        canvas.height = vh;
        ctx = canvas.getContext("2d", { alpha: true });

        if (!ctx) throw new Error("Canvas 2D context not available");

        // Output stream
        outStream = canvas.captureStream(fps);

        // Create offscreen mask canvas now (same size)
        ensureMaskCanvas();

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
                    if (res?.segmentationMask) {
                        // ✅ ONLY change: make edges a bit sharper (no “area enlargement”)
                        sharpenMaskIntoOffscreen(res.segmentationMask as any);
                    }
                });
                segReady = true;
            } catch {
                seg = null;
                segReady = false;
            }
        }

        running = true;
        rafId = requestAnimationFrame(loop as any);

        return outStream;
    };

    const stopEffect = async () => {
        running = false;
        if (rafId != null) cancelAnimationFrame(rafId);
        rafId = null;

        // Stop segmentation
        try {
            await seg?.close?.();
        } catch { }
        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;

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
