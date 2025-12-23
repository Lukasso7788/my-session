// src/lib/backgroundEffect.ts
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

export type BgMode = "none" | "blur" | "image";
export type JitsiStreamEffect = any;

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurValue?: number; // like 8/25 in Jitsi
};

class CanvasVirtualBgEffect {
    private mode: BgMode;
    private imageUrl?: string;
    private blurValue: number;

    private videoEl?: HTMLVideoElement;
    private canvas?: HTMLCanvasElement;
    private ctx?: CanvasRenderingContext2D | null;

    private segmentation?: SelfieSegmentation;
    private running = false;

    private bgImg?: HTMLImageElement;

    constructor(opts: CreateOpts) {
        this.mode = opts.mode;
        this.imageUrl = opts.imageUrl;
        this.blurValue = opts.blurValue ?? 25;
    }

    isEnabled() {
        return this.mode !== "none";
    }

    async startEffect(stream: MediaStream): Promise<MediaStream> {
        // create hidden video
        const v = document.createElement("video");
        v.autoplay = true;
        v.muted = true;
        v.playsInline = true;
        v.srcObject = stream;
        await v.play();

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
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = this.imageUrl;
            await new Promise<void>((res, rej) => {
                img.onload = () => res();
                img.onerror = () => rej(new Error("Failed to load background image"));
            });
            this.bgImg = img;
        }

        // init MediaPipe
        const seg = new SelfieSegmentation({
            locateFile: (file) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
        });

        // modelSelection: 0 (general) / 1 (landscape) — попробуй 1 для “как в Jitsi”
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

        // pump frames
        const loop = async () => {
            if (!this.running || !this.videoEl || !this.segmentation) return;

            // keep canvas size synced
            const vw = this.videoEl.videoWidth || 1280;
            const vh = this.videoEl.videoHeight || 720;
            if (this.canvas && (this.canvas.width !== vw || this.canvas.height !== vh)) {
                this.canvas.width = vw;
                this.canvas.height = vh;
            }

            try {
                await this.segmentation.send({ image: this.videoEl });
            } catch {
                // ignore frame errors
            }

            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);

        // output stream
        return c.captureStream(30);
    }

    async stopEffect() {
        this.running = false;

        try { this.segmentation?.close?.(); } catch { }
        this.segmentation = undefined;

        try {
            if (this.videoEl) {
                this.videoEl.pause();
                (this.videoEl.srcObject as any) = null;
            }
        } catch { }

        this.videoEl = undefined;
        this.canvas = undefined;
        this.ctx = undefined;
        this.bgImg = undefined;
    }
}

export async function createBackgroundEffect(opts: CreateOpts): Promise<JitsiStreamEffect | undefined> {
    if (opts.mode === "none") return undefined;
    if (opts.mode === "image" && !opts.imageUrl) return undefined;

    return new CanvasVirtualBgEffect(opts);
}
