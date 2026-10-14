// Start downloading the background-effect runtime early on phones/tablets.
//
// Blur and virtual backgrounds need MediaPipe's segmenter: a ~9 MB wasm file
// plus a small model, fetched from CDNs the first time the effect is applied.
// On a mobile connection that is several seconds during which the effect is
// not there yet. Fetching the same URLs as soon as the room opens (only when
// the person's saved effect is blur or background) puts them in the HTTP cache,
// so the segmenter starts from cache when the effect is applied.
//
// The URLs must match what @livekit/track-processors loads by default
// (its bundled @mediapipe/tasks-vision version).
export const TASKS_VISION_VERSION = "0.10.14";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
export const SEGMENTER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

let started = false;

// Same check MediaPipe uses to pick the SIMD build (wasm-feature-detect).
function supportsWasmSimd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch {
    return false;
  }
}

export function backgroundFxAssetUrls(simd = supportsWasmSimd()): string[] {
  const name = simd ? "vision_wasm_internal" : "vision_wasm_nosimd_internal";
  return [`${WASM_BASE}/${name}.js`, `${WASM_BASE}/${name}.wasm`, SEGMENTER_MODEL_URL];
}

export function prefetchBackgroundFxAssets(): void {
  if (started || typeof fetch === "undefined" || typeof WebAssembly === "undefined") return;
  started = true;
  for (const url of backgroundFxAssetUrls()) {
    // Low priority so it never competes with joining the room.
    fetch(url, { mode: "cors", credentials: "omit", priority: "low" } as RequestInit)
      .then((response) => response.arrayBuffer())
      .catch(() => {
        // Best effort: the effect still loads normally if this fails.
      });
  }
}
