// src/lib/backgroundEffect.ts
// MediaPipe selfie-segmentation -> blur/background -> canvas.captureStream()
// Exports: createBackgroundEffect(opts)

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

export type BgOpts = {
    mode: "none" | "blur" | "image";
    imageUrl?: string;
    // optional tuning
    blurPx?: number;      // default 12
    fps?: number;         // default 20
    segWidth?: number;    // default 256
    segHeight?: number;   // default 144
    wasmBaseUrl?: string; // default uses jsdelivr
    modelUrl?: string;    // default uses Google-hosted selfie_segmenter.tflite
};

type Processor = {
    startEffect: (baseStream: MediaStream) => Promise<MediaStream> | MediaStream;
    stopEffect: () => void;
    dispose: () => void;
};

const DEFAULT_WASM =
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm";
const DEFAULT_MODEL =
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

export function createBackgroundEffect(opts: BgOpts): Processor {
    const mode = opts.mode ?? "none";
    const blurPx = Number.isFinite(opts.blurPx as number) ? (opts.blurPx as number) : 12;
    const fps = Number.isFinite(opts.fps as number) ? (opts.fps as number) : 20;

    const segW = Number.isFinite(opts.segWidth as number) ? (opts.segWidth as number) : 256;
    const segH = Number.isFinite(opts.segHeight as number) ? (opts.segHeight as number) : 144;

    const wasmBaseUrl = opts.wasmBaseUrl || DEFAULT_WASM;
    const modelUrl = opts.modelUrl || DEFAULT_MODEL;

    let disposed = false;
    let running = false;
    let rafId: number | null = null;

    let segmenter: ImageSegmenter | null = null;

    // source video (hidden)
    const srcVideo = document.createElement("video");
    srcVideo.autoplay = true;
    srcVideo.muted = true;
    (srcVideo as any).playsInline = true;

    // output canvas
    const outCanvas = document.createElement("canvas");
    const outCtx = outCanvas.getContext("2d", { alpha: false })!;

    // fg canvas (full res)
    const fgCanvas = document.createElement("canvas");
    const fgCtx = fgCanvas.getContext("2d")!;

    // seg input canvas (small res)
    const segCanvas = document.createElement("canvas");
    segCanvas.width = segW;
    segCanvas.height = segH;
    const segCtx = segCanvas.getContext("2d", { willReadFrequently: true })!;

    // mask canvas (small res)
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = segW;
    maskCanvas.height = segH;
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true })!;
    const maskImageData = maskCtx.createImageData(segW, segH);

    // background image (for mode=image)
    let bgImg: HTMLImageElement | null = null;
    let bgReady = false;

    let outStream: MediaStream | null = null;

    async function ensureSegmenter() {
        if (segmenter) return;

        const fileset = await FilesetResolver.forVisionTasks(wasmBaseUrl);
        // runningMode VIDEO + outputCategoryMask=true (маска 0/1) :contentReference[oaicite:1]{index=1}
        segmenter = await ImageSegmenter.createFromOptions(fileset, {
            baseOptions: {
                modelAssetPath: modelUrl, // :contentReference[oaicite:2]{index=2}
                delegate: "GPU",
            },
            runningMode: "VIDEO",
            outputCategoryMask: true,
        });
    }

    async function loadBgImageIfNeeded() {
        bgReady = false;
        bgImg = null;

        if (mode !== "image") return;
        if (!opts.imageUrl) return;

        bgImg = new Image();
        bgImg.crossOrigin = "anonymous";
        bgImg.src = opts.imageUrl;

        await new Promise<void>((resolve) => {
            if (!bgImg) return resolve();
            bgImg.onload = () => resolve();
            bgImg.onerror = () => resolve();
        });

        bgReady = !!bgImg && bgImg.naturalWidth > 0;
    }

    function segmentForVideoAsync(input: HTMLCanvasElement, tsMs: number) {
        return new Promise<any>((resolve) => {
            if (!segmenter) return resolve(null);
            // callback style (как в примерах) :contentReference[oaicite:3]{index=3}
            (segmenter as any).segmentForVideo(input, tsMs, (res: any) => resolve(res));
        });
    }

    function updateMaskFromCategoryMask(result: any) {
        // result.categoryMask.getAsUint8Array() -> 0 background, 1 person (обычно)
        const cm = result?.categoryMask;
        if (!cm || typeof cm.getAsUint8Array !== "function") return false;

        const arr: Uint8Array = cm.getAsUint8Array();
        if (!arr || arr.length !== segW * segH) return false;

        const data = maskImageData.data;
        // RGBA for mask: alpha = foreground
        for (let i = 0; i < arr.length; i++) {
            const a = arr[i] === 1 ? 255 : 0;
            const o = i * 4;
            data[o] = 255;
            data[o + 1] = 255;
            data[o + 2] = 255;
            data[o + 3] = a;
        }
        maskCtx.putImageData(maskImageData, 0, 0);
        return true;
    }

    function drawCompositeFrame() {
        const w = outCanvas.width;
        const h = outCanvas.height;

        // 1) draw background (blurred video OR image)
        outCtx.setTransform(1, 0, 0, 1, 0, 0);
        outCtx.globalCompositeOperation = "source-over";
        outCtx.filter = "none";
        outCtx.clearRect(0, 0, w, h);

        if (mode === "image" && bgReady && bgImg) {
            outCtx.drawImage(bgImg, 0, 0, w, h);
        } else {
            // blur background from the video itself
            outCtx.filter = `blur(${blurPx}px)`;
            outCtx.drawImage(srcVideo, 0, 0, w, h);
            outCtx.filter = "none";
        }

        // 2) draw foreground video into fgCanvas
        fgCtx.setTransform(1, 0, 0, 1, 0, 0);
        fgCtx.globalCompositeOperation = "source-over";
        fgCtx.filter = "none";
        fgCtx.clearRect(0, 0, w, h);
        fgCtx.drawImage(srcVideo, 0, 0, w, h);

        // 3) apply mask to fgCanvas (destination-in)
        fgCtx.globalCompositeOperation = "destination-in";
        fgCtx.filter = "blur(6px)"; // мягкие края
        fgCtx.drawImage(maskCanvas, 0, 0, w, h);
        fgCtx.filter = "none";

        // 4) draw foreground over background
        outCtx.globalCompositeOperation = "source-over";
        outCtx.drawImage(fgCanvas, 0, 0, w, h);
    }

    async function loop() {
        if (disposed || !running) return;

        // wait for srcVideo metadata
        if (!srcVideo.videoWidth || !srcVideo.videoHeight) {
            rafId = requestAnimationFrame(loop);
            return;
        }

        const w = srcVideo.videoWidth;
        const h = srcVideo.videoHeight;

        if (outCanvas.width !== w || outCanvas.height !== h) {
            outCanvas.width = w;
            outCanvas.height = h;
            fgCanvas.width = w;
            fgCanvas.height = h;
        }

        // draw into segCanvas (small)
        segCtx.drawImage(srcVideo, 0, 0, segW, segH);

        const ts = performance.now();
        const result = await segmentForVideoAsync(segCanvas, ts);

        if (result) {
            const ok = updateMaskFromCategoryMask(result);
            if (ok) drawCompositeFrame();
        }

        rafId = requestAnimationFrame(loop);
    }

    return {
        async startEffect(baseStream: MediaStream) {
            disposed = false;
            running = true;

            await loadBgImageIfNeeded();
            await ensureSegmenter();

            // attach base stream to src video
            srcVideo.srcObject = baseStream;

            // ensure it plays
            try {
                await (srcVideo as any).play?.();
            } catch {
                // ignore
            }

            // IMPORTANT: capture stream from canvas
            outStream = outCanvas.captureStream(fps);

            // small delay so first frames appear
            await sleep(30);

            rafId = requestAnimationFrame(loop);
            return outStream!;
        },

        stopEffect() {
            running = false;
            if (rafId != null) cancelAnimationFrame(rafId);
            rafId = null;

            try {
                srcVideo.pause();
            } catch { }

            // stop output tracks (optional; Jitsi will dispose track too)
            try {
                outStream?.getTracks?.().forEach((t) => t.stop());
            } catch { }

            outStream = null;
        },

        dispose() {
            if (disposed) return;
            disposed = true;

            running = false;
            if (rafId != null) cancelAnimationFrame(rafId);
            rafId = null;

            try {
                srcVideo.srcObject = null;
            } catch { }

            try {
                segmenter?.close?.();
            } catch { }
            segmenter = null;

            try {
                outStream?.getTracks?.().forEach((t) => t.stop());
            } catch { }
            outStream = null;

            bgImg = null;
            bgReady = false;
        },
    };
}
