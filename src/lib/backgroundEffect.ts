// ============================================================================
// src/lib/backgroundEffect.ts — Canvas + MediaPipe SelfieSegmentation
// Notes:
// - Waits for video metadata so canvas sizes correctly
// - Throttles segmentation to `fps` (default 20)
// - Guards against overlapping `segmentation.send()` calls (inFlight)
// - Cancels RAF on stop/dispose
// - Safe cleanup even if Jitsi calls dispose multiple times
// ============================================================================

import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

export type BgMode = "none" | "blur" | "image";
export type JitsiStreamEffect = any;

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurValue?: number; // like 8/25 in Jitsi
    fps?: number; // throttle segmentation loop; default 20
};

class CanvasVirtualBgEffect {
    private mode: BgMode;
    private imageUrl?: string;
    private blurValue: number;
    private fps: number;

    private videoEl?: HTMLVideoElement;
    private canvas?: HTMLCanvasElement;
    private ctx?: CanvasRenderingContext2D | null;

    private segmentation?: SelfieSegmentation;
    private running = false;

    private bgImg?: HTMLImageElement;

    private rafId: number | null = null;
    private inFlight = false;
    private lastSentAt = 0;

    constructor(opts: CreateOpts) {
        this.mode = opts.mode;
        this.imageUrl = opts.imageUrl;
        this.blurValue = opts.blurValue ?? 25;
        this.fps = Math.max(5, Math.min(30, opts.fps ?? 20));
    }

    isEnabled() {
        return this.mode !== "none";
    }

    // IMPORTANT: engine calls dispose() sometimes; make it available.
    async dispose() {
        await this.stopEffect();
    }

    private async waitVideoReady(v: HTMLVideoElement): Promise<void> {
        // If video already has metadata
        if ((v.videoWidth || 0) > 0 && (v.videoHeight || 0) > 0) return;

        await new Promise<void>((resolve) => {
            const done = () => {
                v.removeEventListener("loadedmetadata", done);
                v.removeEventListener("loadeddata", done);
                resolve();
            };
            v.addEventListener("loadedmetadata", done, { once: true });
            v.addEventListener("loadeddata", done, { once: true });

            // Safety: sometimes metadata event already fired but sizes still 0 for a tick
            setTimeout(done, 250);
        });
    }

    private async preloadBgImage(url: string): Promise<HTMLImageElement> {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;

        await new Promise<void>((res, rej) => {
            img.onload = () => res();
            img.onerror = () => rej(new Error("Failed to load background image"));
        });

        return img;
    }

    async startEffect(stream: MediaStream): Promise<MediaStream> {
        // create hidden video
        const v = document.createElement("video");
        v.autoplay = true;
        v.muted = true;
        v.playsInline = true;
        v.srcObject = stream;

        // In most cases this works because stream comes from getUserMedia
        try {
            await v.play();
        } catch {
            // ignore; metadata may still load and frames may still render
        }

        await this.waitVideoReady(v);

        const c = document.createElement("canvas");
        c.width = v.videoWidth || 1280;
        c.height = v.videoHeight || 720;

        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("2d canvas context not available");

        this.videoEl = v;
        this.canvas = c;
        this.ctx = ctx;

        // preload bg image if needed
        if (this.mode === "image" && this.imageUrl) {
            try {
                this.bgImg = await this.preloadBgImage(this.imageUrl);
            } catch {
                // If image fails, fall back to original background
                this.bgImg = undefined;
            }
        }

        // init MediaPipe
        const seg = new SelfieSegmentation({
            locateFile: (file) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
        });

        // modelSelection: 0 (general) / 1 (landscape)
        seg.setOptions({ modelSelection: 1 });

        seg.onResults((results: any) => {
            if (!this.running || !this.ctx || !this.canvas) return;

            const w = this.canvas.width;
            const h = this.canvas.height;
            const canvasCtx = this.ctx;

            canvasCtx.save();
            canvasCtx.clearRect(0, 0, w, h);

            // 1) draw mask
            canvasCtx.drawImage(results.segmentationMask, 0, 0, w, h);

            // 2) draw person (source-in keeps only where mask is)
            canvasCtx.globalCompositeOperation = "source-in";
            canvasCtx.drawImage(results.image, 0, 0, w, h);

            // 3) draw background behind person
            canvasCtx.globalCompositeOperation = "destination-atop";

            if (this.mode === "blur") {
                // map blurValue -> px (rough)
                const blurPx = Math.max(1, Math.round(this.blurValue / 2));
                canvasCtx.filter = `blur(${blurPx}px)`;
                canvasCtx.drawImage(results.image, 0, 0, w, h);
                canvasCtx.filter = "none";
            } else if (this.mode === "image" && this.bgImg) {
                canvasCtx.drawImage(this.bgImg, 0, 0, w, h);
            } else {
                // fallback: just original
                canvasCtx.drawImage(results.image, 0, 0, w, h);
            }

            canvasCtx.restore();
        });

        this.segmentation = seg;
        this.running = true;
        this.inFlight = false;
        this.lastSentAt = 0;

        const frameIntervalMs = Math.max(1, Math.round(1000 / this.fps));

        // pump frames
        const loop = async (ts: number) => {
            if (!this.running || !this.videoEl || !this.segmentation) return;

            this.rafId = requestAnimationFrame(loop);

            // throttle
            if (ts - this.lastSentAt < frameIntervalMs) return;
            this.lastSentAt = ts;

            // keep canvas size synced
            const vw = this.videoEl.videoWidth || 1280;
            const vh = this.videoEl.videoHeight || 720;
            if (this.canvas && (this.canvas.width !== vw || this.canvas.height !== vh)) {
                this.canvas.width = vw;
                this.canvas.height = vh;
            }

            if (this.inFlight) return;
            this.inFlight = true;

            try {
                await this.segmentation.send({ image: this.videoEl });
            } catch {
                // ignore frame errors
            } finally {
                this.inFlight = false;
            }
        };

        this.rafId = requestAnimationFrame(loop);

        // output stream
        return c.captureStream(30);
    }

    async stopEffect() {
        this.running = false;

        try {
            if (this.rafId != null) cancelAnimationFrame(this.rafId);
        } catch {
            // ignore
        }
        this.rafId = null;
        this.inFlight = false;

        try {
            this.segmentation?.close?.();
        } catch {
            // ignore
        }
        this.segmentation = undefined;

        try {
            if (this.videoEl) {
                try {
                    this.videoEl.pause();
                } catch {
                    // ignore
                }
                try {
                    (this.videoEl.srcObject as any) = null;
                } catch {
                    // ignore
                }
            }
        } catch {
            // ignore
        }

        this.videoEl = undefined;
        this.canvas = undefined;
        this.ctx = undefined;
        this.bgImg = undefined;
    }
}

export async function createBackgroundEffect(
    opts: CreateOpts
): Promise<JitsiStreamEffect | undefined> {
    if (opts.mode === "none") return undefined;
    if (opts.mode === "image" && !opts.imageUrl) return undefined;

    return new CanvasVirtualBgEffect(opts);
}
