// Minimal WOFF2 reader that turns glyphs into SVG path data, so badge numbers
// are real outlines of the project's own Inter files (no font needed to view
// the SVGs). Supports TrueType-flavored WOFF2 with the standard glyf/loca
// transform, which is what public/fonts/Inter-*.woff2 use.
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ",
  "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS",
  "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc",
  "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
  "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

class Reader {
  constructor(buffer, offset = 0) { this.b = buffer; this.o = offset; }
  u8() { return this.b[this.o++]; }
  u16() { const v = this.b.readUInt16BE(this.o); this.o += 2; return v; }
  i16() { const v = this.b.readInt16BE(this.o); this.o += 2; return v; }
  u32() { const v = this.b.readUInt32BE(this.o); this.o += 4; return v; }
  base128() {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
      const byte = this.u8();
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error("bad UIntBase128");
  }
  u255() {
    const code = this.u8();
    if (code === 253) return this.u16();
    if (code === 255) return this.u8() + 253;
    if (code === 254) return this.u8() + 506;
    return code;
  }
}

function withSign(flag, value) { return flag & 1 ? value : -value; }

export function loadWoff2(path) {
  const file = readFileSync(path);
  const r = new Reader(file);
  if (r.u32() !== 0x774f4632) throw new Error("not WOFF2");
  r.u32(); r.u32();
  const numTables = r.u16(); r.u16(); r.u32();
  const totalCompressedSize = r.u32();
  r.o += 24; // versions, meta and private block fields
  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = r.u8();
    const index = flags & 0x3f;
    const tag = index === 63 ? file.toString("latin1", r.o, (r.o += 4)) : KNOWN_TAGS[index];
    const version = flags >> 6;
    const origLength = r.base128();
    const transformed = (tag === "glyf" || tag === "loca") ? version === 0 : version !== 0;
    const length = transformed ? r.base128() : origLength;
    tables.push({ tag, transformed, length });
  }
  const data = brotliDecompressSync(file.subarray(r.o, r.o + totalCompressedSize));
  let offset = 0;
  const byTag = {};
  for (const table of tables) {
    byTag[table.tag] = { ...table, data: data.subarray(offset, offset + table.length) };
    offset += table.length;
  }
  return parseFont(byTag);
}

function parseCmap(data) {
  const r = new Reader(data);
  r.u16();
  const count = r.u16();
  let best = null;
  for (let i = 0; i < count; i += 1) {
    const platform = r.u16(); const encoding = r.u16(); const offset = r.u32();
    const format = data.readUInt16BE(offset);
    if (platform === 3 && (encoding === 1 || encoding === 10) && (format === 4 || format === 12)) {
      if (!best || format === 12) best = { offset, format };
    }
  }
  if (!best) throw new Error("no unicode cmap");
  const map = new Map();
  const t = new Reader(data, best.offset);
  if (best.format === 12) {
    t.u16(); t.u16(); t.u32(); t.u32();
    const groups = t.u32();
    for (let i = 0; i < groups; i += 1) {
      const start = t.u32(); const end = t.u32(); const glyph = t.u32();
      for (let c = start; c <= end && c < 0x10000; c += 1) map.set(c, glyph + (c - start));
    }
    return map;
  }
  t.u16(); t.u16(); t.u16();
  const segX2 = t.u16(); t.o += 6;
  const base = t.o;
  const seg = segX2 / 2;
  const at = (k, i) => data.readUInt16BE(base + k * segX2 + (k > 0 ? 2 : 0) + i * 2);
  for (let i = 0; i < seg; i += 1) {
    const end = at(0, i); const start = at(1, i);
    const delta = data.readInt16BE(base + 2 * segX2 + 2 + i * 2);
    const rangeOffsetPos = base + 3 * segX2 + 2 + i * 2;
    const rangeOffset = data.readUInt16BE(rangeOffsetPos);
    for (let c = start; c <= end && c !== 0xffff; c += 1) {
      let glyph;
      if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
      else {
        const g = data.readUInt16BE(rangeOffsetPos + rangeOffset + (c - start) * 2);
        glyph = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (glyph) map.set(c, glyph);
    }
  }
  return map;
}

function parseGlyf(table) {
  if (!table.transformed) throw new Error("expected transformed glyf");
  const r = new Reader(table.data);
  r.u16(); r.u16();
  const numGlyphs = r.u16(); r.u16();
  const sizes = Array.from({ length: 7 }, () => r.u32());
  const streams = [];
  let offset = r.o;
  for (const size of sizes) { streams.push(new Reader(table.data, offset)); offset += size; }
  const [nContour, nPoints, flagS, glyphS, compositeS] = streams;

  const glyphs = new Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g += 1) {
    const contours = nContour.i16();
    if (contours === 0) { glyphs[g] = { contours: [] }; continue; }
    if (contours > 0) {
      const ends = [];
      let total = 0;
      for (let c = 0; c < contours; c += 1) { total += nPoints.u255(); ends.push(total); }
      const points = [];
      let x = 0; let y = 0;
      for (let p = 0; p < total; p += 1) {
        let flag = flagS.u8();
        const onCurve = !(flag >> 7);
        flag &= 0x7f;
        const bytes = flag < 84 ? 1 : flag < 120 ? 2 : flag < 124 ? 3 : 4;
        const d = Array.from({ length: bytes }, () => glyphS.u8());
        let dx; let dy;
        if (flag < 10) { dx = 0; dy = withSign(flag, ((flag & 14) << 7) + d[0]); }
        else if (flag < 20) { dx = withSign(flag, (((flag - 10) & 14) << 7) + d[0]); dy = 0; }
        else if (flag < 84) {
          const b0 = flag - 20;
          dx = withSign(flag, 1 + (b0 & 0x30) + (d[0] >> 4));
          dy = withSign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (d[0] & 0x0f));
        } else if (flag < 120) {
          const b0 = flag - 84;
          dx = withSign(flag, 1 + (Math.floor(b0 / 12) << 8) + d[0]);
          dy = withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + d[1]);
        } else if (flag < 124) {
          dx = withSign(flag, (d[0] << 4) + (d[1] >> 4));
          dy = withSign(flag >> 1, ((d[1] & 0x0f) << 8) + d[2]);
        } else {
          dx = withSign(flag, (d[0] << 8) + d[1]);
          dy = withSign(flag >> 1, (d[2] << 8) + d[3]);
        }
        x += dx; y += dy;
        points.push({ x, y, onCurve });
      }
      glyphS.u255(); // instruction length; instructions live in their own stream
      const list = [];
      let start = 0;
      for (const end of ends) { list.push(points.slice(start, end)); start = end; }
      glyphs[g] = { contours: list };
      continue;
    }
    // Composite glyph.
    const components = [];
    let flags;
    let instructions = false;
    do {
      flags = compositeS.u16();
      const glyphIndex = compositeS.u16();
      let dx; let dy;
      if (flags & 0x1) { dx = compositeS.i16(); dy = compositeS.i16(); }
      else { dx = (compositeS.u8() << 24) >> 24; dy = (compositeS.u8() << 24) >> 24; }
      let a = 1; let b = 0; let c = 0; let d = 1;
      const f2 = () => compositeS.i16() / 16384;
      if (flags & 0x8) { a = d = f2(); }
      else if (flags & 0x40) { a = f2(); d = f2(); }
      else if (flags & 0x80) { a = f2(); b = f2(); c = f2(); d = f2(); }
      if (flags & 0x100) instructions = true;
      components.push({ glyphIndex, dx, dy, a, b, c, d });
    } while (flags & 0x20);
    if (instructions) glyphS.u255();
    glyphs[g] = { components };
  }
  const resolve = (g) => {
    const glyph = glyphs[g];
    if (!glyph.components) return glyph.contours;
    return glyph.components.flatMap((part) =>
      resolve(part.glyphIndex).map((contour) =>
        contour.map((p) => ({ x: p.x * part.a + p.y * part.c + part.dx, y: p.x * part.b + p.y * part.d + part.dy, onCurve: p.onCurve }))
      )
    );
  };
  return { numGlyphs, outline: resolve };
}

function parseFont(t) {
  const unitsPerEm = t.head.data.readUInt16BE(18);
  const numberOfHMetrics = t.hhea.data.readUInt16BE(34);
  const cmap = parseCmap(t.cmap.data);
  const glyf = parseGlyf(t.glyf);
  const advances = [];
  const h = new Reader(t.hmtx.data);
  if (t.hmtx.transformed) {
    h.u8();
    for (let i = 0; i < numberOfHMetrics; i += 1) advances.push(h.u16());
  } else {
    for (let i = 0; i < numberOfHMetrics; i += 1) { advances.push(h.u16()); h.i16(); }
  }
  const advanceOf = (g) => advances[Math.min(g, advances.length - 1)];
  return { unitsPerEm, cmap, glyf, advanceOf };
}

function contourPath(points, sx, ox, oy) {
  if (!points.length) return "";
  const P = (p) => [ox + p.x * sx, oy - p.y * sx];
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, onCurve: true });
  // Start on an on-curve point (or the midpoint of two off-curve ones).
  let start = points.findIndex((p) => p.onCurve);
  let pts;
  if (start === -1) { pts = [mid(points[points.length - 1], points[0]), ...points]; start = 0; }
  else pts = [...points.slice(start), ...points.slice(0, start)];
  const f = (n) => Number(n.toFixed(2));
  const [x0, y0] = P(pts[0]);
  let d = `M${f(x0)} ${f(y0)}`;
  for (let i = 1; i <= pts.length; i += 1) {
    const cur = pts[i % pts.length];
    if (cur.onCurve) { const [x, y] = P(cur); d += `L${f(x)} ${f(y)}`; continue; }
    let next = pts[(i + 1) % pts.length];
    let end = next;
    if (!next.onCurve) end = mid(cur, next); else i += 1;
    const [cx, cy] = P(cur); const [ex, ey] = P(end);
    d += `Q${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`;
  }
  return `${d}Z`;
}

// Lays out `text` at fontSize with letter spacing (em), centered on cx with
// the baseline at `baseline`. Returns { d, width }.
export function textPath(font, text, { fontSize, cx, baseline, tracking = 0 }) {
  const scale = fontSize / font.unitsPerEm;
  const glyphs = [...text].map((ch) => {
    const g = font.cmap.get(ch.codePointAt(0));
    if (g == null) throw new Error(`no glyph for ${ch}`);
    return g;
  });
  const gap = tracking * font.unitsPerEm;
  const widthUnits = glyphs.reduce((sum, g, i) => sum + font.advanceOf(g) + (i < glyphs.length - 1 ? gap : 0), 0);
  let pen = cx - (widthUnits * scale) / 2;
  let d = "";
  for (const g of glyphs) {
    for (const contour of font.glyf.outline(g)) d += contourPath(contour, scale, pen, baseline);
    pen += (font.advanceOf(g) + gap) * scale;
  }
  return { d, width: widthUnits * scale };
}
