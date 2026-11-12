// Default avatars for people without a photo: their initials in Inter Light on a
// neutral gray. Replaces the external ui-avatars.com images.
//
// The image is drawn on a canvas with the site's own Inter font. If Inter is
// not loaded yet, an SVG with the same design (system font) is returned and
// the next call, once the font is ready, gets the Inter version.

// One neutral look for everyone, in the room's panel grays, per theme.
const PALETTE: Array<[background: string, text: string]> = [
  ["#E6E4E4", "#5C5C5C"],
];
const DARK_PALETTE: Array<[background: string, text: string]> = [
  ["#333333", "#C6CDD5"],
];

const SIZE = 128;
const cache = new Map<string, string>();

// Initials use Inter Light (the thinnest Inter in /public/fonts), loaded here as
// its own family so the site's own Inter weights stay as they are. Loading starts
// as soon as this module is imported, so it is ready by the time avatars render.
const AVATAR_FONT_FAMILY = "InterAvatar";
const AVATAR_FONT_WEIGHT = 300;
const AVATAR_FONT_URL = "/fonts/Inter_18pt-Light.woff2";
let avatarFontReady = false;
if (typeof document !== "undefined" && typeof FontFace !== "undefined") {
  try {
    const face = new FontFace(AVATAR_FONT_FAMILY, `url(${AVATAR_FONT_URL}) format("woff2")`, { weight: String(AVATAR_FONT_WEIGHT) });
    document.fonts.add(face);
    void face.load().then(() => {
      avatarFontReady = true;
      cache.clear();
    }).catch(() => undefined);
  } catch {
    // Fall back to the SVG version below.
  }
}

function hashOf(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

/** "Maya Chen" → "MC", "maya" → "M", "" → "?" */
export function initialsOf(name: string) {
  const words = String(name || "")
    .trim()
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] || "";
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] || "" : "";
  return (first + last).toUpperCase();
}

function svgAvatar(initials: string, background: string, text: string) {
  const fontSize = initials.length > 1 ? 50 : 58;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" fill="${background}"/>` +
    `<text x="50%" y="50%" dy="0.36em" text-anchor="middle" fill="${text}" ` +
    `font-family="Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" ` +
    `font-size="${fontSize}" font-weight="300" letter-spacing="-0.5">${initials.replace(/[<&>]/g, "")}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function canvasAvatar(initials: string, background: string, text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const fontSize = initials.length > 1 ? 50 : 58;
  ctx.font = `${AVATAR_FONT_WEIGHT} ${fontSize}px ${AVATAR_FONT_FAMILY}`;
  ctx.fillStyle = text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Inter's capitals sit a touch high on the middle baseline.
  ctx.fillText(initials, SIZE / 2, SIZE / 2 + fontSize * 0.04);
  return canvas.toDataURL("image/png");
}

/**
 * Image URL for a person's default avatar. `seed` should be stable for the
 * person (their user id); the name is used when there is none.
 */
export function defaultAvatarUrl(name?: string | null, seed?: string | null, theme: "light" | "dark" = "light") {
  const label = String(name || "").trim() || "User";
  const initials = initialsOf(label);
  const palette = theme === "dark" ? DARK_PALETTE : PALETTE;
  const [background, text] = palette[hashOf(String(seed || label).toLowerCase()) % palette.length];
  const key = `${initials}|${background}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const fontReady = avatarFontReady;
  if (fontReady) {
    const url = canvasAvatar(initials, background, text);
    if (url) {
      cache.set(key, url);
      return url;
    }
  }
  return svgAvatar(initials, background, text);
}
