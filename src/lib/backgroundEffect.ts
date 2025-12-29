// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30
    maxWidth?: number; // default 1280

    // ✅ Mask quality controls (all optional)
    segFps?: number; // default 15 (throttle MediaPipe calls)
    maskBlurPx?: number; // default 6 (feather edges)
    maskThreshold?: number; // default 0.60 (higher => shrinks person cutout)
    maskSoftness?: number; // default 0.10 (feather width around threshold)
    maskScale?: number; // default 0.5 (process mask at lower res for speed)
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

function smoothstep(edge0: number, edge1: number, x: number) {
    const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
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

function drawCoverImage(
    ctx: CanvasRenderingContext2D,
    img: CanvasImageSource,
    w: number,
    h: number
) {
    // Draw image as "cover" (like CSS background-size: cover)
    const anyImg: any = img as any;
    const iw = Number(anyImg?.naturalWidth || anyImg?.videoWidth || anyImg?.width || 0);
    const ih = Number(anyImg?.naturalHeight || anyImg?.videoHeight || anyImg?.height || 0);

    if (!iw || !ih) {
        ctx.drawImage(img, 0, 0, w, h);
        return;
    }

    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale;
    const sh = h / scale;

    const sx = Math.max(0, (iw - sw) / 2);
    const sy = Math.max(0, (ih - sh) / 2);

    try {
        // @ts-ignore
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    } catch {
        ctx.drawImage(img, 0, 0, w, h);
    }
}

export function createBackgroundEffect(opts: CreateOpts): Processor {
    const mode: BgMode = opts.mode ?? "none";
    const fps = clamp(opts.fps ?? 30, 5, 60);
    const blurPx = clamp(opts.blurPx ?? 10, 0, 40);
    const maxWidth = clamp(opts.maxWidth ?? 1280, 320, 3840);

    // ✅ Mask tuning defaults (good “edge quality” without killing perf)
    const segFps = clamp(opts.segFps ?? 15, 1, 60);
    const maskBlurPx = clamp(opts.maskBlurPx ?? 6, 0, 30);
    const maskThreshold = clamp(opts.maskThreshold ?? 0.6, 0, 1);
    const maskSoftness = clamp(opts.maskSoftness ?? 0.1, 0.001, 0.5);
    const maskScale = clamp(opts.maskScale ?? 0.5, 0.2, 1);

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
    let segReady = false;
    let segBusy = false;

    // ✅ Processed mask (feathered) — smaller canvas for performance
    let maskCanvas: HTMLCanvasElement | null = null;
    let maskCtx: CanvasRenderingContext2D | null = null;

    let segW = 0;
    let segH = 0;

    let lastSegAt = 0; // throttle seg.send()
    let hasMask = false;

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

        maskCanvas = null;
        maskCtx = null;
        segW = 0;
        segH = 0;
        hasMask = false;
    };

    const ensureMaskCanvas = (w: number, h: number) => {
        const mw = Math.max(64, Math.round(w * maskScale));
        const mh = Math.max(64, Math.round(h * maskScale));

        if (!maskCanvas || !maskCtx || mw !== segW || mh !== segH) {
            segW = mw;
            segH = mh;
            maskCanvas = document.createElement("canvas");
            maskCanvas.width = mw;
            maskCanvas.height = mh;
            maskCtx = maskCanvas.getContext("2d", { alpha: true, willReadFrequently: true } as any);
        }
        return !!maskCanvas && !!maskCtx;
    };

    const updateMaskFromSegmentation = (segmentationMask: CanvasImageSource) => {
        if (!canvas || !ctx) return;
        const w = canvas.width;
        const h = canvas.height;

        if (!ensureMaskCanvas(w, h)) return;
        if (!maskCanvas || !maskCtx) return;

        const mw = maskCanvas.width;
        const mh = maskCanvas.height;

        // 1) Draw segmentation mask downscaled
        try {
            maskCtx.clearRect(0, 0, mw, mh);
            maskCtx.save();
            maskCtx.imageSmoothingEnabled = true;
            maskCtx.filter = maskBlurPx > 0 ? `blur(${maskBlurPx}px)` : "none";
            maskCtx.drawImage(segmentationMask, 0, 0, mw, mh);
            maskCtx.restore();
        } catch {
            return;
        }

        // 2) Convert to a nice alpha mask (threshold + feather)
        try {
            const img = maskCtx.getImageData(0, 0, mw, mh);
            const d = img.data;

            // Feather around threshold: [t-soft, t+soft]
            const t0 = clamp(maskThreshold - maskSoftness, 0, 1);
            const t1 = clamp(maskThreshold + maskSoftness, 0, 1);

            for (let i = 0; i < d.length; i += 4) {
                // Use luminance / red channel as mask strength (MediaPipe mask is usually grayscale)
                const v = d[i] / 255; // 0..1
                const a = smoothstep(t0, t1, v); // 0..1
                d[i] = 255;
                d[i + 1] = 255;
                d[i + 2] = 255;
                d[i + 3] = Math.round(a * 255);
            }

            maskCtx.putImageData(img, 0, 0);
            hasMask = true;
        } catch {
            // If pixel ops fail, we still have a (blurred) raw mask drawn.
            hasMask = true;
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
            drawCoverImage(ctx, bgImage, w, h);
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
        if (!running || !videoEl || !canvas || !ctx || !maskCanvas || !hasMask) return;

        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        // 1) Foreground (person) = video clipped by mask
        ctx.save();
        ctx.drawImage(videoEl, 0, 0, w, h);
        ctx.globalCompositeOperation = "destination-in";
        // upscale mask to full canvas
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(maskCanvas, 0, 0, w, h);
        ctx.restore();

        // 2) Background behind person
        ctx.save();
        ctx.globalCompositeOperation = "destination-over";

        if (mode === "image" && bgImage) {
            drawCoverImage(ctx, bgImage, w, h);
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

    const loop = async () => {
        if (!running) return;

        try {
            if (segReady && hasMask) tickDrawWithMask();
            else tickDrawFallback();
        } catch {
            // ignore draw errors
        }

        // segmentation step (async), throttled
        if (seg && segReady && !segBusy && videoEl) {
            const now = performance.now();
            const minDt = 1000 / segFps;
            if (now - lastSegAt >= minDt) {
                lastSegAt = now;
                segBusy = true;
                try {
                    // MediaPipe expects an HTMLVideoElement / HTMLImageElement / Canvas
                    await seg.send({ image: videoEl });
                } catch {
                    // if segmentation fails, fallback (keep rendering)
                } finally {
                    segBusy = false;
                }
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
                    // res.segmentationMask is usually a canvas/image
                    if (res?.segmentationMask) {
                        try {
                            updateMaskFromSegmentation(res.segmentationMask as any);
                        } catch {
                            // ignore mask errors
                        }
                    }
                });
                segReady = true;
            } catch {
                seg = null;
                segReady = false;
            }
        }

        // Ensure mask canvas exists early (so first onResults is fast)
        try {
            ensureMaskCanvas(vw, vh);
        } catch { }

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
        hasMask = false;
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
