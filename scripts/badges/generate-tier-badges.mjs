// Generates the session-tier badges as standalone SVGs.
//
//   node scripts/badges/generate-tier-badges.mjs
//
// Writes public/badges/tiers/tier-<id>.svg (horizontal pill) and
// tier-<id>-icon.svg (round, for tight spots), plus manifest.json and
// preview.html. Icons are the traced SVGs in scripts/badges/icons; labels are
// outlined from public/fonts/Inter-Bold.woff2, so the SVGs need no font.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWoff2, textPath } from "./woff2-glyphs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "public/badges/tiers");
const font = loadWoff2(path.join(root, "public/fonts/Inter-Bold.woff2"));

// Colors follow the session types in SessionCard (Short sprints green, Deep
// work blue, Custom indigo, Pomodoro red); the top tier is gold.
const TIERS = [
  { id: "beginner", label: "Beginner", min: 1, max: 49, icon: "sprout", from: "#3CCB71", to: "#15803D" },
  { id: "regular", label: "Regular", min: 50, max: 99, icon: "repeat", from: "#5B98FA", to: "#1D5FD8" },
  { id: "experienced", label: "Experienced", min: 100, max: 499, icon: "brain-bolt", from: "#8487F7", to: "#4338CA" },
  { id: "expert", label: "Productivity Expert", min: 500, max: 999, icon: "book-open", from: "#F7735F", to: "#D42F3A" },
  { id: "master", label: "Productivity Master", min: 1000, max: null, icon: "crown", gold: true },
];

// Bronze-gold coin with a dark rim and a white gap, like a minted medal.
const GOLD = {
  rim: "#7A4610",
  stops: [["0", "#F8DC8E"], ["0.4", "#E5AC4C"], ["0.78", "#BD7B22"], ["1", "#965819"]],
  ink: "#FFF6DF",
  outline: "#6A3B0B",
};

function icon(name, { x, y, size, fill, outline = null, outlineWidth = 0 }) {
  const svg = readFileSync(path.join(here, "icons", `${name}.svg`), "utf8");
  const [, , , width] = svg.match(/viewBox="([\d.\s]+)"/)[1].split(/\s+/).map(Number);
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>[\s\S]*$/, "");
  const scale = size / width;
  const transform = `translate(${x} ${y}) scale(${scale.toFixed(5)})`;
  // An optional dark outline is drawn underneath, in screen pixels.
  const under = outline
    ? `<g transform="${transform}" fill="none" stroke="${outline}" stroke-width="${(outlineWidth / scale).toFixed(1)}" stroke-linejoin="round">${inner}</g>`
    : "";
  return `${under}<g transform="${transform}" fill="${fill}">${inner}</g>`;
}

function sparkle(x, y, size, opacity = 1) {
  const k = size * 0.22;
  return `<path d="M${x} ${y - size}Q${x + k} ${y - k} ${x + size} ${y}Q${x + k} ${y + k} ${x} ${y + size}Q${x - k} ${y + k} ${x - size} ${y}Q${x - k} ${y - k} ${x} ${y - size}Z" fill="#FFFFFF" opacity="${opacity}"/>`;
}

function gradients(tier, id, width, height) {
  const stops = tier.gold
    ? GOLD.stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join("")
    : `<stop offset="0" stop-color="${tier.from}"/><stop offset="1" stop-color="${tier.to}"/>`;
  return `<defs>
<linearGradient id="${id}-fill" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">${stops}</linearGradient>
<linearGradient id="${id}-gloss" x1="0" y1="0" x2="0" y2="${height}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF" stop-opacity="${tier.gold ? 0.5 : 0.4}"/><stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
</defs>`;
}

// Gradient body with a glossy top and a diagonal sheen, clipped to `face`.
function face(tier, id, shape, width, height) {
  const sheenX = Math.min(width * 0.62, width - 34);
  return `<clipPath id="${id}-clip">${shape}</clipPath>
<g clip-path="url(#${id}-clip)">
${shape.replace("/>", ` fill="url(#${id}-fill)"/>`)}
<rect width="${width}" height="${height}" fill="url(#${id}-gloss)"/>
<path d="M${sheenX} -2h12l-14 ${height + 4}h-12Z" fill="#FFFFFF" opacity="${tier.gold ? 0.26 : 0.16}"/>
<path d="M${sheenX + 16} -2h4l-14 ${height + 4}h-4Z" fill="#FFFFFF" opacity="${tier.gold ? 0.2 : 0.12}"/>
</g>`;
}

// Text or icon with a dark outline under a light fill (gold tier).
function outlined(d, fill, outline, width) {
  return `<path d="${d}" fill="none" stroke="${outline}" stroke-width="${width}" stroke-linejoin="round"/><path d="${d}" fill="${fill}"/>`;
}

function pill(tier) {
  const height = 40;
  const textX = 47;
  const measured = textPath(font, tier.label, { fontSize: 15, cx: 0, baseline: 0, tracking: 0.005 });
  const width = Math.round(textX + measured.width + 19);
  const id = `msb-${tier.id}`;
  const rect = (inset) => `<rect x="${inset}" y="${inset}" width="${width - 2 * inset}" height="${height - 2 * inset}" rx="${(height - 2 * inset) / 2}"/>`;
  const label = textPath(font, tier.label, { fontSize: 15, cx: textX + measured.width / 2, baseline: 25.4, tracking: 0.005 });
  let body = gradients(tier, id, width, height);
  if (tier.gold) {
    body += rect(0).replace("/>", ` fill="${GOLD.rim}"/>`);
    body += rect(2.25).replace("/>", ` fill="#FFFFFF"/>`);
    body += face(tier, id, rect(3.75), width, height);
    body += `<circle cx="21" cy="20" r="12.5" fill="${GOLD.outline}" fill-opacity="0.24"/>`;
    body += icon(tier.icon, { x: 13, y: 12, size: 16, fill: GOLD.ink, outline: GOLD.outline, outlineWidth: 2.4 });
    body += outlined(label.d, GOLD.ink, GOLD.outline, 3);
    body += sparkle(width - 12, 11.5, 3.2) + sparkle(width - 7.5, 19, 1.6, 0.9);
  } else {
    body += face(tier, id, rect(0.5), width, height);
    body += rect(0.5).replace("/>", ` fill="none" stroke="#FFFFFF" stroke-opacity="0.32" stroke-width="1"/>`);
    body += `<circle cx="20" cy="20" r="14" fill="#FFFFFF" fill-opacity="0.22"/><circle cx="20" cy="20" r="13.5" fill="none" stroke="#FFFFFF" stroke-opacity="0.35"/>`;
    body += icon(tier.icon, { x: 12, y: 12, size: 16, fill: "#FFFFFF" });
    body += `<path d="${label.d}" fill="#FFFFFF"/>`;
  }
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${tier.label}">\n${body}\n</svg>\n`,
  };
}

function round(tier) {
  const size = 40;
  const id = `msb-${tier.id}-icon`;
  const circle = (r) => `<circle cx="20" cy="20" r="${r}"/>`;
  let body = gradients(tier, id, size, size);
  if (tier.gold) {
    body += circle(20).replace("/>", ` fill="${GOLD.rim}"/>`);
    body += circle(17.75).replace("/>", ` fill="#FFFFFF"/>`);
    body += face(tier, id, circle(16.25), size, size);
    body += icon(tier.icon, { x: 11, y: 11, size: 18, fill: GOLD.ink, outline: GOLD.outline, outlineWidth: 2.4 });
    body += sparkle(30.5, 10.5, 3);
  } else {
    body += face(tier, id, circle(19.5), size, size);
    body += circle(19.5).replace("/>", ` fill="none" stroke="#FFFFFF" stroke-opacity="0.32" stroke-width="1"/>`);
    body += icon(tier.icon, { x: 10.5, y: 10.5, size: 19, fill: "#FFFFFF" });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${tier.label}">\n${body}\n</svg>\n`;
}

function range(tier) {
  return tier.max == null ? `${tier.min.toLocaleString("en-US")}+ sessions` : `${tier.min}–${tier.max} sessions`;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const manifest = TIERS.map((tier) => {
  const badge = pill(tier);
  writeFileSync(path.join(outDir, `tier-${tier.id}.svg`), badge.svg);
  writeFileSync(path.join(outDir, `tier-${tier.id}-icon.svg`), round(tier));
  return {
    id: tier.id, label: tier.label, minSessions: tier.min, maxSessions: tier.max,
    pill: `tier-${tier.id}.svg`, round: `tier-${tier.id}-icon.svg`, width: badge.width, height: badge.height,
  };
});
writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

writeFileSync(
  path.join(outDir, "preview.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Session tiers</title><style>
body{margin:0;padding:40px;font-family:Inter,system-ui,sans-serif;color:#2F2F2F;background:#fff}
h1{font-size:28px;font-weight:600;margin:0 0 6px}p{margin:0 0 28px;color:#606060;font-size:14px}
.row{display:flex;align-items:center;gap:20px;padding:14px 0;border-top:1px solid #EEEEEE}
.range{width:130px;flex:none;font-size:13px;color:#606060}.big{margin-left:auto}
</style></head><body><h1>Session tiers</h1><p>One badge per tier, by sessions joined.</p>
${manifest.map((tier, index) => `<div class="row"><div class="range">${range(TIERS[index])}</div><img src="${tier.pill}" width="${tier.width}" height="${tier.height}" alt="${tier.label}"><img src="${tier.round}" width="40" height="40" alt=""><img class="big" src="${tier.pill}" width="${tier.width * 1.6}" height="${tier.height * 1.6}" alt=""></div>`).join("\n")}
</body></html>
`
);

console.log(`[badges] wrote ${TIERS.length} tier badges (pill + round) and preview to ${path.relative(root, outDir)}`);
