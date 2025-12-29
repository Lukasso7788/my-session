// src/lib/backgroundEffect.ts
// Минимальный рабочий processor для replaceTrack pipeline.
// Делает "фейковый blur" всего кадра через canvas (для smoke-test).
// Потом заменишь на MediaPipe/segmentation.

type BgOpts = {
    mode: "none" | "blur" | "image";
    imageUrl?: string;
};

export function createBackgroundEffect(opts: BgOpts) {
    let video: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let rafId: number | null = null;
    let outStream: MediaStream | null = null;

    const stopLoop = () => {
        if (rafId != null) cancelAnimationFrame(rafId);
        rafId = null;
    };

    const cleanup = () => {
        stopLoop();
        try {
            if (video) {
                video.pause();
                (video as any).srcObject = null;
            }
        } catch { }
        video = null;
        canvas = null;
        ctx = null;
        outStream = null;
    };

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        if (!input || typeof input.getTracks !== "function") {
            throw new Error("[backgroundEffect] input is not a MediaStream");
        }

        // Создаём video, чтобы “проигрывать” входной stream
        video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        (video as any).srcObject = input;

        // canvas куда рисуем кадры
        canvas = document.createElement("canvas");
        ctx = canvas.getContext("2d");

        // ждём метаданные, чтобы знать размеры
        await new Promise<void>((resolve) => {
            if (!video) return resolve();
            video.onloadedmetadata = () => resolve();
            // если вдруг уже готово
            if (video.readyState >= 1) resolve();
        });

        const w = Math.max(1, video.videoWidth || 1280);
        const h = Math.max(1, video.videoHeight || 720);

        canvas.width = w;
        canvas.height = h;

        // стартуем воспроизведение
        try { await video.play(); } catch { }

        // выходной стрим
        outStream = canvas.captureStream(30);

        const loop = () => {
            if (!video || !canvas || !ctx) return;

            // "blur" всего кадра (smoke test)
            if (opts.mode === "blur") {
                (ctx as any).filter = "blur(10px)";
            } else {
                (ctx as any).filter = "none";
            }

            try {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            } catch { }

            rafId = requestAnimationFrame(loop);
        };

        loop();
        return outStream;
    };

    const stopEffect = async () => {
        cleanup();
    };

    const dispose = async () => {
        cleanup();
    };

    return { startEffect, stopEffect, dispose };
}

export default createBackgroundEffect;
