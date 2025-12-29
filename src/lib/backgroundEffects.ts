// src/lib/backgroundEffects.ts
import type { JitsiTrack } from "./jitsiEngine";

export type BackgroundMode =
    | { type: "none" }
    | { type: "blur"; strength?: "low" | "medium" | "high" }
    | { type: "image"; url: string };

type AnyEffect = any;

/**
 * ВАЖНО:
 * - часть билдов Jitsi ожидают sync startEffect()
 * - вендоренный эффект может иметь async startEffect()
 * Мы оборачиваем async в sync, чтобы не помечать как incompatible.
 */
function wrapAsyncStartEffect(effect: AnyEffect): AnyEffect {
    const start = effect?.startEffect;
    if (typeof start !== "function") return effect;

    // самый надёжный быстрый детектор без вызова
    const isAsync =
        start.constructor?.name === "AsyncFunction" ||
        /^\s*async\s+function/.test(Function.prototype.toString.call(start));

    if (!isAsync) return effect;

    effect.startEffect = (...args: any[]) => {
        try {
            // запускаем async, но НЕ возвращаем Promise наружу
            Promise.resolve(start.apply(effect, args)).catch((e: any) => {
                console.warn("[bg] async startEffect failed:", e);
            });
        } catch (e) {
            console.warn("[bg] async startEffect wrapper error:", e);
        }
        // важно: возвращаем void (sync)
        return undefined;
    };

    effect.__wrappedAsyncStartEffect = true;
    return effect;
}

/**
 * Эти опции рассчитаны на то, чтобы улучшить края маски:
 * - немного "съедаем" край (erosion)
 * - делаем feather (maskBlur)
 * - слегка поднимаем порог (foregroundThreshold)
 *
 * Но! Вендор может игнорировать часть опций — это окей.
 */
function getMaskQualityOptions() {
    return {
        // общие названия (в разных реализациях могут отличаться)
        maskBlurRadius: 6,           // feather
        maskBlur: 6,
        edgeBlur: 6,

        maskErosion: 2,              // “поджать” край, убрать ореол
        erosion: 2,
        foregroundThreshold: 0.55,   // чуть выше порог -> меньше фона “просачивается”
        smoothSegmentationMask: true,
    };
}

/**
 * ВАЖНО:
 * Я не знаю точный путь/имя твоего vendored эффекта (как ты его импортируешь).
 * Поэтому я делаю import через один модуль "vendorBg" — поменяй путь под свой.
 *
 * У тебя по логам уже есть вендорный эффект, значит это место у тебя существует.
 */
async function loadVendor() {
    // ✅ ПОДСТАВЬ СВОЙ ПУТЬ, если отличается
    // Примеры: "../vendor/jitsi-bg-effects", "./vendored/jitsiEffects", etc
    return await import("./vendoredBackground");
}

/**
 * Создаём эффект под трек.
 * Возвращаем effect instance, который можно дать в track.setEffect(effect).
 */
export async function buildBackgroundEffect(
    mode: BackgroundMode
): Promise<AnyEffect | null> {
    if (!mode || mode.type === "none") return null;

    const vendor = await loadVendor();

    // Примеры интерфейсов вендора могут отличаться.
    // Я поддержал 2 самых частых паттерна:
    // - vendor.createBlurEffect({ ... })
    // - vendor.createVirtualBackgroundEffect({ backgroundType, ... })
    let effect: AnyEffect | null = null;

    const quality = getMaskQualityOptions();

    if (mode.type === "blur") {
        const strength = mode.strength ?? "medium";
        const blurValue =
            strength === "low" ? 8 : strength === "high" ? 20 : 14;

        if (typeof vendor.createBlurEffect === "function") {
            effect = await vendor.createBlurEffect({
                blur: blurValue,
                ...quality,
            });
        } else if (typeof vendor.createVirtualBackgroundEffect === "function") {
            effect = await vendor.createVirtualBackgroundEffect({
                backgroundType: "blur",
                blur: blurValue,
                ...quality,
            });
        } else {
            throw new Error("No vendor blur effect factory found");
        }
    }

    if (mode.type === "image") {
        if (!mode.url) return null;

        if (typeof vendor.createImageEffect === "function") {
            effect = await vendor.createImageEffect({
                imageUrl: mode.url,
                ...quality,
            });
        } else if (typeof vendor.createVirtualBackgroundEffect === "function") {
            effect = await vendor.createVirtualBackgroundEffect({
                backgroundType: "image",
                imageUrl: mode.url,
                ...quality,
            });
        } else {
            throw new Error("No vendor image effect factory found");
        }
    }

    if (!effect) return null;
    return wrapAsyncStartEffect(effect);
}

/**
 * Применяем effect к треку, с fallback-логикой.
 */
export async function applyBackgroundToTrack(
    track: JitsiTrack,
    mode: BackgroundMode
) {
    if (!track) throw new Error("No track");
    const setEffect = (track as any)?.setEffect;

    console.log("[Jitsi][effects] track.setEffect:", typeof setEffect, "=> supported:", typeof setEffect === "function");

    if (typeof setEffect !== "function") {
        throw new Error("track.setEffect is not available in this build");
    }

    const effect = await buildBackgroundEffect(mode);

    // null -> clear effect
    await setEffect.call(track, effect ?? null);
}
