// src/lib/backgroundEffect.ts
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

export type BgMode = "none" | "blur" | "image";

export type BackgroundEffectConfig = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number;        // background blur strength
    maskBlurPx?: number;    // feather edge
    fps?: number;           // captureStream fps
};

// Minimal interface that lib-jitsi-meet expects for track.setEffect(effect)
export type JitsiStreamEffect = {
    isEnabled?: () => boolean;
    setEnabled?: (enabled: boolean) => void;
    startEffect: (stream: MediaStream) => Promise<MediaStream>;
    stopEffect: () => Promise<MediaStream>;
    setConfig?: (cfg: Partial<BackgroundEffectConfig>) => void;
    dispose?: () => void;
};

function clampInt(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Math.floor(n)));
}

export function createBackgroundEffect(initial: BackgroundEffectConfig): JitsiStreamEffect {
    let cfg: BackgroundEffectConfig = {
        mode: initial.mode,
        imageUrl: initial.imageUrl,
        blurPx: initial.blurPx ?? 14,
        maskBlurPx: initial.maskBlurPx ?? 6,
        fps: initial.fps ?? 30,
    };

    let enabled = true;

    let originalStream: MediaStream | null = null;
    let outputStream: MediaStream | null = null;

    let inputTrack: MediaStreamTrack | null = null;
    let outputTrack: MediaStreamTrack | null = null;

    let videoEl: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    let bgImg: HTMLImageElement | null = null;

    let seg: SelfieSegmentation | null = null;
    let rafId: number | null = null;

    let running = false;
    let busy = false;

    const ensureBgImage = (url?: string) => {
        if (!url) {
            bgImg = null;
            return;
        }
        if (bgImg && bgImg.src === url) return;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        bgImg = img;
    };

    const stopLoop = () => {
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        running = false;
        busy = false;
    };

    const cleanup = () => {
        stopLoop();

        try {
            seg?.close?.();
        } catch { }
        seg = null;

        try {
            videoEl?.pause?.();
        } catch { }
        if (videoEl) {
            try {
                // @ts-expect-error
                videoEl.srcObject = null;
            } catch { }
        }
        videoEl = null;

        canvas = null;
        ctx = null;

        // IMPORTANT: do NOT stop inputTrack (camera) — lib-jitsi-meet owns it.
        inputTrack = null;

        // outputTrack we created from canvas.captureStream; safe to stop when disposing effect
        try {
            outputTrack?.stop?.();
        } catch { }
        outputTrack = null;

        originalStream = null;
        outputStream = null;
    };

    const initSeg = () => {
        if (seg) return seg;

        const s = new SelfieSegmentation({
            locateFile: (file) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
        });

        s.setOptions({
            modelSelection: 1, // 0 faster, 1 better
            selfieMode: true,
        });

        seg = s;
        return s;
    };

    const drawCover = (
        c: CanvasRenderingContext2D,
        img: CanvasImageSource,
        w: number,
        h: number
    ) => {
        // cover fit
        // @ts-ignore
        const iw = (img as any).videoWidth ?? (img as any).naturalWidth ?? w;
        // @ts-ignore
        const ih = (img as any).videoHeight ?? (img as any).naturalHeight ?? h;

        if (!iw || !ih) {
            c.drawImage(img, 0, 0, w, h);
            return;
        }

        const ir = iw / ih;
        const cr = w / h;

        let dw = w, dh = h, dx = 0, dy = 0;

        if (ir > cr) {
            dh = h;
            dw = h * ir;
            dx = (w - dw) / 2;
        } else {
            dw = w;
            dh = w / ir;
            dy = (h - dh) / 2;
        }

        c.drawImage(img, dx, dy, dw, dh);
    };

    const startLoop = () => {
        if (!videoEl || !canvas || !ctx) return;
        if (running) return;

        running = true;

        const tick = async () => {
            if (!running || !videoEl || !canvas || !ctx) return;

            const vw = videoEl.videoWidth;
            const vh = videoEl.videoHeight;

            if (vw > 0 && vh > 0) {
                if (canvas.width !== vw || canvas.height !== vh) {
                    canvas.width = vw;
                    canvas.height = vh;
                }

                // NONE mode: pass-through (no segmentation cost)
                if (cfg.mode === "none") {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    drawCover(ctx, videoEl, canvas.width, canvas.height);
                    rafId = requestAnimationFrame(tick);
                    return;
                }

                // BLUR / IMAGE: segmentation-based composition
                if (!busy) {
                    busy = true;
                    try {
                        const s = initSeg();

                        s.onResults((results: any) => {
                            if (!ctx || !canvas || !videoEl) return;

                            const w = canvas.width;
                            const h = canvas.height;

                            ctx.clearRect(0, 0, w, h);

                            // 1) Background layer
                            if (cfg.mode === "image" && cfg.imageUrl) {
                                ensureBgImage(cfg.imageUrl);
                                if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
                                    drawCover(ctx, bgImg, w, h);
                                } else {
                                    // fallback while image loads
                                    drawCover(ctx, videoEl, w, h);
                                }
                            } else {
                                // blur background = blurred video
                                const blur = clampInt(cfg.blurPx ?? 14, 0, 40);
                                ctx.filter = `blur(${blur}px)`;
                                drawCover(ctx, videoEl, w, h);
                                ctx.filter = "none";
                            }

                            // 2) Person (mask -> source-in -> original video)
                            // Feather mask a bit
                            const maskBlur = clampInt(cfg.maskBlurPx ?? 6, 0, 20);

                            ctx.save();
                            ctx.filter = maskBlur ? `blur(${maskBlur}px)` : "none";
                            ctx.globalCompositeOperation = "source-over";
                            ctx.drawImage(results.segmentationMask, 0, 0, w, h);
                            ctx.filter = "none";

                            ctx.globalCompositeOperation = "source-in";
                            drawCover(ctx, videoEl, w, h);

                            ctx.restore();
                        });

                        await s.send({ image: videoEl });
                    } catch {
                        // ignore frame errors
                    } finally {
                        busy = false;
                    }
                }
            }

            rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
    };

    return {
        isEnabled: () => enabled,
        setEnabled: (v: boolean) => {
            enabled = v;
        },

        setConfig: (next) => {
            cfg = { ...cfg, ...next };
            if (next.imageUrl !== undefined) ensureBgImage(next.imageUrl);
        },

        startEffect: async (stream: MediaStream) => {
            cleanup();

            originalStream = stream;

            if (!enabled) {
                outputStream = stream;
                return stream;
            }

            const v = stream.getVideoTracks?.()?.[0] ?? null;
            if (!v) {
                outputStream = stream;
                return stream;
            }
            inputTrack = v;

            videoEl = document.createElement("video");
            videoEl.muted = true;
            videoEl.playsInline = true;
            videoEl.autoplay = true;
            // @ts-expect-error
            videoEl.srcObject = new MediaStream([inputTrack]);

            // wait metadata
            await new Promise<void>((resolve) => {
                const done = () => resolve();
                videoEl!.onloadedmetadata = done;
                // fallback
                setTimeout(done, 250);
            });

            try {
                await videoEl.play();
            } catch {
                // ignore autoplay restrictions; frames may still flow after user gesture
            }

            canvas = document.createElement("canvas");
            ctx = canvas.getContext("2d", { alpha: true }) as CanvasRenderingContext2D | null;

            if (!ctx) {
                outputStream = stream;
                return stream;
            }

            ensureBgImage(cfg.imageUrl);

            const fps = clampInt(cfg.fps ?? 30, 10, 60);
            const cap = canvas.captureStream(fps);
            outputTrack = cap.getVideoTracks()[0] || null;

            if (!outputTrack) {
                outputStream = stream;
                return stream;
            }

            outputStream = new MediaStream([outputTrack]);

            startLoop();

            return outputStream;
        },

        stopEffect: async () => {
            stopLoop();
            const out = originalStream || outputStream;
            cleanup();
            return out || new MediaStream();
        },

        dispose: () => {
            cleanup();
        },
    };
}
