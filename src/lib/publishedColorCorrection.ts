// Pure utilities stay independent of the lazy media-effect SDK.
export type PublishedColorCorrection = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number(value) || 0));

export function normalizePublishedColorCorrection(
  value: PublishedColorCorrection,
): PublishedColorCorrection {
  return {
    brightness: Math.round(clamp(value?.brightness, 50, 150) || 100),
    contrast: Math.round(clamp(value?.contrast, 50, 150) || 100),
    saturation: Math.round(clamp(value?.saturation, 0, 200)),
    warmth: Math.round(clamp(value?.warmth, -100, 100)),
  };
}

export function isPublishedColorCorrectionIdentity(
  value: PublishedColorCorrection,
) {
  const normalized = normalizePublishedColorCorrection(value);
  return (
    normalized.brightness === 100 &&
    normalized.contrast === 100 &&
    normalized.saturation === 100 &&
    normalized.warmth === 0
  );
}

export function publishedColorCorrectionSignature(
  value: PublishedColorCorrection,
) {
  const normalized = normalizePublishedColorCorrection(value);
  return `${normalized.brightness}:${normalized.contrast}:${normalized.saturation}:${normalized.warmth}`;
}
