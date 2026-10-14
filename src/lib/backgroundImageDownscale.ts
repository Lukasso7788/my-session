// Phones and tablets: keep virtual-background images small.
//
// The camera there publishes about 320x180, but a photo picked from the
// gallery is often 12 MP. Holding it as a full-size data URL (and decoding it
// for every background switch) costs tens of MB of memory, which is what gets
// Safari tabs reloaded mid-session. 1280 px on the long side is still sharper
// than anything the effect can show.

export const MOBILE_BACKGROUND_MAX_SIDE = 1280;
const JPEG_QUALITY = 0.82;
// Data URLs below this size are already small enough to leave alone.
const SMALL_DATA_URL_CHARS = 450_000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("background_image_decode_failed"));
    image.src = src;
  });
}

/** Returns a JPEG data URL no larger than maxSide on its long side. */
export async function downscaleImageSrc(src: string, maxSide = MOBILE_BACKGROUND_MAX_SIDE): Promise<string> {
  const image = await loadImage(src);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error("background_image_has_no_size");

  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("background_canvas_unavailable");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  // Release the decoded bitmap right away instead of waiting for GC.
  canvas.width = 0;
  canvas.height = 0;
  image.src = "";
  return result;
}

export async function downscaleImageFile(file: File, maxSide = MOBILE_BACKGROUND_MAX_SIDE): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    return await downscaleImageSrc(url, maxSide);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** True when a stored data URL is big enough to be worth shrinking. */
export function isLargeDataUrl(dataUrl: string | null | undefined): boolean {
  return typeof dataUrl === "string" && dataUrl.startsWith("data:image/") && dataUrl.length > SMALL_DATA_URL_CHARS;
}
