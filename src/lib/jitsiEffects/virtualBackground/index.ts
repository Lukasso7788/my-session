import JitsiStreamBackgroundEffect, { IBackgroundEffectOptions } from "./JitsiStreamBackgroundEffect";

// vendor tflite modules (emscripten factories)
import createTFLiteModule from "./vendor/tflite/tflite.js";
import createTFLiteSIMDModule from "./vendor/tflite/tflite-simd.js";

let tflite: any;
let modelPromise: Promise<void> | null = null;

const MODEL_URL = "/libs/selfie_segmentation_landscape.tflite";

async function loadModelOnce(tfl: any) {
    if (modelPromise) return modelPromise;

    modelPromise = (async () => {
        const res = await fetch(MODEL_URL);
        if (!res.ok) throw new Error(`Failed to fetch model: ${res.status} ${res.statusText}`);

        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);

        const size = bytes.length;
        const ptr = tfl._malloc(size);
        tfl.HEAPU8.set(bytes, ptr);

        if (typeof tfl._loadModel !== "function") {
            throw new Error("tflite._loadModel is not a function — check vendor tflite.js version");
        }

        tfl._loadModel(ptr, size);
        tfl._free(ptr);
    })();

    return modelPromise;
}

async function initTfliteOnce() {
    if (tflite) return tflite;

    // пробуем SIMD, если не выйдет — fallback
    try {
        tflite = await createTFLiteSIMDModule({
            locateFile: (p: string) => `/libs/${p}`,
        });
    } catch {
        tflite = await createTFLiteModule({
            locateFile: (p: string) => `/libs/${p}`,
        });
    }

    await loadModelOnce(tflite);
    return tflite;
}

export async function createVirtualBackgroundEffect(
    virtualBackground: IBackgroundEffectOptions["virtualBackground"]
) {
    if (!JitsiStreamBackgroundEffect.isSupported()) {
        throw new Error("JitsiStreamBackgroundEffect not supported!");
    }

    const tfl = await initTfliteOnce();

    const options: IBackgroundEffectOptions = {
        virtualBackground,
    };

    return new JitsiStreamBackgroundEffect(tfl, options);
}
