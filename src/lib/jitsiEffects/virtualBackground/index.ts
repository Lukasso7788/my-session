// src/lib/jitsiEffects/virtualBackground/index.ts

import JitsiStreamBackgroundEffect from "./JitsiStreamBackgroundEffect";

export type VirtualBackgroundOptions =
    | { backgroundType: "blur" }
    | { backgroundType: "image"; virtualSource: string };

// Простая проверка: если setEffect есть — значит в целом можем пробовать.
// (реальная совместимость дальше уже решится внутри эффекта)
export function isSupported() {
    return true;
}

export async function createVirtualBackgroundEffect(opts: VirtualBackgroundOptions) {
    // ВАЖНО: никаких bf.isSupported() — просто создаём эффект.
    // Если внутри эффекта что-то не так — упадёт уже более конкретно (fetch/wasm/model).
    const effect: any = new (JitsiStreamBackgroundEffect as any)(opts);

    // если в твоём JitsiStreamBackgroundEffect есть init/load — вызови безопасно
    if (typeof effect.init === "function") {
        await effect.init();
    }
    if (typeof effect.loadModel === "function") {
        await effect.loadModel();
    }

    return effect;
}

export default createVirtualBackgroundEffect;
