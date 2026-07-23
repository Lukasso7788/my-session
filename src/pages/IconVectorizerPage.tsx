import { ChangeEvent, DragEvent, useCallback, useMemo, useRef, useState } from "react";
import { Download, ImagePlus, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import "./IconVectorizerPage.css";

type Point = { x: number; y: number };
type VectorMode = "icon" | "illustration" | "detailed";
type VectorResult = {
  svg: string;
  palette: string[];
  colors: number;
  paths: number;
  nodes: number;
  width: number;
  height: number;
};

const MODE_CONFIG: Record<VectorMode, { maxSide: number; maxColors: number; defaultColors: number; label: string; hint: string }> = {
  icon: { maxSide: 1200, maxColors: 16, defaultColors: 6, label: "Иконка", hint: "Логотипы и плоская графика" },
  illustration: { maxSide: 820, maxColors: 24, defaultColors: 14, label: "Иллюстрация", hint: "Цветные рисунки и стикеры" },
  detailed: { maxSide: 900, maxColors: 32, defaultColors: 24, label: "Детально", hint: "Сложные изображения" },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function colorDistance(a: number[], b: number[]) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function rgbToHsv(color: number[]) {
  const r = color[0] / 255;
  const g = color[1] / 255;
  const b = color[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { h: hue, s: max ? delta / max : 0, v: max };
}

function isSameFlatTone(a: number[], b: number[], mode: VectorMode) {
  if (mode === "detailed") return false;
  const first = rgbToHsv(a);
  const second = rgbToHsv(b);
  const hueDistance = Math.min(Math.abs(first.h - second.h), 360 - Math.abs(first.h - second.h));
  if (first.v < 0.2 && second.v < 0.2) return true;
  if (first.s < 0.16 && second.s < 0.16) {
    return Math.abs(first.v - second.v) < (mode === "icon" ? 0.32 : 0.18);
  }
  return Math.max(first.s, second.s) > 0.2 && Math.min(first.s, second.s) > 0.035 &&
    hueDistance < (mode === "icon" ? 22 : 14) &&
    Math.abs(first.s - second.s) < 0.72;
}

function quantizePixels(data: Uint8ClampedArray, colorCount: number, mode: VectorMode) {
  const samples: number[][] = [];
  const stride = Math.max(1, Math.floor(data.length / 4 / 16000));
  for (let i = 0; i < data.length; i += 4 * stride) {
    // Semi-transparent edge pixels describe coverage, not extra palette colors.
    if (data[i + 3] >= 160) samples.push([data[i], data[i + 1], data[i + 2]]);
  }
  // Very translucent artwork still needs a palette; use it only as a fallback.
  if (!samples.length) {
    for (let i = 0; i < data.length; i += 4 * stride) {
      if (data[i + 3] > 24) samples.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (!samples.length) return { palette: [] as number[][], labels: new Int16Array(data.length / 4).fill(-1) };

  const minimumSeparation = mode === "icon" ? 20 : mode === "illustration" ? 12 : 5;
  const minimumSeparationSquared = minimumSeparation * minimumSeparation;
  const palette: number[][] = [];
  palette.push(samples[Math.floor(samples.length / 2)]);
  while (palette.length < Math.min(colorCount, samples.length)) {
    let best = samples[0];
    let bestDistance = -1;
    for (let i = 0; i < samples.length; i += Math.max(1, Math.floor(samples.length / 4000))) {
      const distance = Math.min(...palette.map((color) => colorDistance(samples[i], color)));
      if (distance > bestDistance) {
        best = samples[i];
        bestDistance = distance;
      }
    }
    // The slider is a ceiling. Stop when the image has no genuinely new color.
    if (bestDistance < minimumSeparationSquared) break;
    palette.push([...best]);
  }

  for (let pass = 0; pass < 7; pass++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const sample of samples) {
      let label = 0;
      let distance = Infinity;
      palette.forEach((color, index) => {
        const next = colorDistance(sample, color);
        if (next < distance) { distance = next; label = index; }
      });
      sums[label][0] += sample[0];
      sums[label][1] += sample[1];
      sums[label][2] += sample[2];
      sums[label][3]++;
    }
    sums.forEach((sum, index) => {
      if (sum[3]) palette[index] = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
    });
  }

  // K-means can converge two seeds onto virtually the same color. Collapse
  // those duplicates before tracing so a black icon stays one-color even when
  // the maximum is set to 6 or 16.
  const clusterCounts = palette.map(() => 0);
  for (const sample of samples) {
    let closest = 0;
    let closestDistance = Infinity;
    palette.forEach((color, index) => {
      const distance = colorDistance(sample, color);
      if (distance < closestDistance) { closest = index; closestDistance = distance; }
    });
    clusterCounts[closest]++;
  }
  const rankedPalette = palette
    .map((color, index) => ({ color, count: clusterCounts[index] }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
  const totalClusterSamples = rankedPalette.reduce((sum, entry) => sum + entry.count, 0);
  const minimumShare = mode === "icon" ? 0.15 : mode === "illustration" ? 0.035 : 0;
  const compactPalette: number[][] = [];
  for (const { color, count } of rankedPalette) {
    // Tiny clusters in flat artwork are almost always antialiasing fringes.
    // Assigning their pixels to the nearest dominant color keeps edges crisp.
    if (compactPalette.length && count / Math.max(1, totalClusterSamples) < minimumShare) continue;
    if (!compactPalette.some((existing) =>
      colorDistance(existing, color) < minimumSeparationSquared || isSameFlatTone(existing, color, mode)
    )) compactPalette.push(color);
  }

  const labels = new Int16Array(data.length / 4).fill(-1);
  for (let pixel = 0; pixel < labels.length; pixel++) {
    const offset = pixel * 4;
    if (data[offset + 3] <= 24) continue;
    const sample = [data[offset], data[offset + 1], data[offset + 2]];
    let label = 0;
    let distance = Infinity;
    compactPalette.forEach((color, index) => {
      const next = colorDistance(sample, color);
      if (next < distance) { distance = next; label = index; }
    });
    labels[pixel] = label;
  }
  return { palette: compactPalette, labels };
}

function cleanColorNoise(labels: Int16Array, width: number, height: number, passes: number) {
  let current = labels;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Int16Array(current);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        if (current[index] < 0) continue;
        const counts = new Map<number, number>();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const label = current[(y + dy) * width + x + dx];
            if (label >= 0) counts.set(label, (counts.get(label) || 0) + 1);
          }
        }
        let winner = current[index];
        let winnerCount = counts.get(winner) || 0;
        counts.forEach((count, label) => {
          if (count > winnerCount) { winner = label; winnerCount = count; }
        });
        // Only remove isolated color noise; never move a normal boundary.
        if (winner !== current[index] && winnerCount >= 6) next[index] = winner;
      }
    }
    current = next;
  }
  return current;
}

function perpendicularDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy);
}

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 3) return points;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (distance > maxDistance) { maxDistance = distance; index = i; }
  }
  if (maxDistance > tolerance) {
    const left = simplify(points.slice(0, index + 1), tolerance);
    const right = simplify(points.slice(index), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

function traceColor(labels: Int16Array, pixels: Uint8ClampedArray, width: number, height: number, color: number) {
  // Build a soft scalar field rather than outlining square pixels. Marching
  // squares then locates the 50% boundary between samples at sub-pixel positions.
  const fieldWidth = width + 2;
  const fieldHeight = height + 2;
  const field = new Float32Array(fieldWidth * fieldHeight);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (labels[pixel] === color) {
        // Preserve the original anti-aliasing coverage encoded by PNG alpha.
        // This places the vector boundary inside the edge pixel instead of on
        // the outer side of its square cell.
        field[(y + 1) * fieldWidth + x + 1] = pixels[pixel * 4 + 3] / 255;
      }
    }
  }

  type Segment = [Point, Point];
  const segments: Segment[] = [];
  const threshold = 0.5;
  const interpolate = (a: Point, b: Point, va: number, vb: number): Point => {
    const ratio = Math.abs(vb - va) < 0.0001 ? 0.5 : clamp((threshold - va) / (vb - va), 0, 1);
    return { x: a.x + (b.x - a.x) * ratio - 0.5, y: a.y + (b.y - a.y) * ratio - 0.5 };
  };

  for (let y = 0; y < fieldHeight - 1; y++) {
    for (let x = 0; x < fieldWidth - 1; x++) {
      const tl = field[y * fieldWidth + x];
      const tr = field[y * fieldWidth + x + 1];
      const br = field[(y + 1) * fieldWidth + x + 1];
      const bl = field[(y + 1) * fieldWidth + x];
      const state = (tl >= threshold ? 1 : 0) | (tr >= threshold ? 2 : 0) | (br >= threshold ? 4 : 0) | (bl >= threshold ? 8 : 0);
      if (state === 0 || state === 15) continue;
      const top = interpolate({ x, y }, { x: x + 1, y }, tl, tr);
      const right = interpolate({ x: x + 1, y }, { x: x + 1, y: y + 1 }, tr, br);
      const bottom = interpolate({ x: x + 1, y: y + 1 }, { x, y: y + 1 }, br, bl);
      const left = interpolate({ x, y: y + 1 }, { x, y }, bl, tl);
      const add = (a: Point, b: Point) => segments.push([a, b]);
      switch (state) {
        case 1: add(left, top); break;
        case 2: add(top, right); break;
        case 3: add(left, right); break;
        case 4: add(right, bottom); break;
        case 5: add(left, top); add(right, bottom); break;
        case 6: add(top, bottom); break;
        case 7: add(left, bottom); break;
        case 8: add(bottom, left); break;
        case 9: add(bottom, top); break;
        case 10: add(top, right); add(bottom, left); break;
        case 11: add(bottom, right); break;
        case 12: add(right, left); break;
        case 13: add(right, top); break;
        case 14: add(top, left); break;
      }
    }
  }

  const key = (point: Point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
  const adjacency = new Map<string, Array<{ point: Point; segment: number }>>();
  segments.forEach(([a, b], segment) => {
    adjacency.set(key(a), [...(adjacency.get(key(a)) || []), { point: b, segment }]);
    adjacency.set(key(b), [...(adjacency.get(key(b)) || []), { point: a, segment }]);
  });
  const used = new Uint8Array(segments.length);
  const contours: Point[][] = [];
  segments.forEach(([start, firstPoint], segmentIndex) => {
    if (used[segmentIndex]) return;
    const contour = [start, firstPoint];
    let current = firstPoint;
    let currentSegment = segmentIndex;
    used[currentSegment] = 1;
    for (let guard = 0; guard < segments.length + 2; guard++) {
      const candidates = adjacency.get(key(current)) || [];
      const next = candidates.find((candidate) => !used[candidate.segment]);
      if (!next) break;
      current = next.point;
      currentSegment = next.segment;
      used[currentSegment] = 1;
      contour.push(current);
      if (key(current) === key(start)) break;
    }
    if (contour.length > 5 && key(contour[contour.length - 1]) === key(start)) contours.push(contour);
  });
  return contours;
}

function contourToPath(contour: Point[], tolerance: number) {
  const open = contour.slice(0, -1);
  const split = Math.floor(open.length / 2);
  const first = simplify([...open.slice(0, split + 1)], tolerance);
  const second = simplify([...open.slice(split), open[0]], tolerance);
  let points = [...first.slice(0, -1), ...second.slice(0, -1)];
  // Drop the remaining staircase points that carry almost no geometric change.
  // This keeps genuine corners while preventing a curve handle per source pixel.
  points = points.filter((point, index, list) => {
    if (list.length <= 4) return true;
    const previous = list[(index - 1 + list.length) % list.length];
    const next = list[(index + 1) % list.length];
    const cross = Math.abs(
      (point.x - previous.x) * (next.y - point.y) -
      (point.y - previous.y) * (next.x - point.x),
    );
    const span = Math.hypot(next.x - previous.x, next.y - previous.y);
    return cross / Math.max(1, span) > tolerance * 0.16;
  });
  if (points.length < 3) return "";
  const format = (value: number) => Number(value.toFixed(2));
  const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const isSharpCorner = (index: number) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const incoming = { x: current.x - previous.x, y: current.y - previous.y };
    const outgoing = { x: next.x - current.x, y: next.y - current.y };
    const length = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
    if (!length) return false;
    const cosine = clamp((incoming.x * outgoing.x + incoming.y * outgoing.y) / length, -1, 1);
    return Math.acos(cosine) * 180 / Math.PI > 50;
  };

  // Quadratic corner-cutting stays inside each neighbouring point triangle, so
  // it smooths curved runs without the overshoot produced by Catmull–Rom. Sharp
  // typographic corners are emitted as exact line vertices.
  const start = midpoint(points[points.length - 1], points[0]);
  let path = `M${format(start.x)} ${format(start.y)}`;
  points.forEach((current, index) => {
    const next = points[(index + 1) % points.length];
    const end = midpoint(current, next);
    if (isSharpCorner(index)) {
      path += `L${format(current.x)} ${format(current.y)}L${format(end.x)} ${format(end.y)}`;
    } else {
      path += `Q${format(current.x)} ${format(current.y)} ${format(end.x)} ${format(end.y)}`;
    }
  });
  return `${path}Z`;
}

async function vectorize(file: File, mode: VectorMode, colorCount: number, detail: number, smooth: number): Promise<VectorResult> {
  const bitmap = await createImageBitmap(file);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = originalWidth;
  sourceCanvas.height = originalHeight;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Canvas is unavailable");
  sourceContext.drawImage(bitmap, 0, 0);
  const sourcePixels = sourceContext.getImageData(0, 0, originalWidth, originalHeight).data;
  let minX = originalWidth;
  let minY = originalHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < originalHeight; y++) {
    for (let x = 0; x < originalWidth; x++) {
      if (sourcePixels[(y * originalWidth + x) * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error("Empty image");
  const padding = 2;
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropRight = Math.min(originalWidth - 1, maxX + padding);
  const cropBottom = Math.min(originalHeight - 1, maxY + padding);
  const cropWidth = cropRight - cropX + 1;
  const cropHeight = cropBottom - cropY + 1;
  const contentMaxSide = Math.max(cropWidth, cropHeight);
  // Scale the visible artwork, not the transparent canvas surrounding it.
  const targetSize = mode === "icon" ? 720 : mode === "illustration" ? 640 : contentMaxSide;
  const preferredScale = Math.max(1, Math.min(6, targetSize / contentMaxSide));
  const scale = Math.min(preferredScale, MODE_CONFIG[mode].maxSide / contentMaxSide);
  const width = Math.max(1, Math.round(cropWidth * scale));
  const height = Math.max(1, Math.round(cropHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(bitmap, cropX, cropY, cropWidth, cropHeight, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  const quantized = quantizePixels(pixels, colorCount, mode);
  const palette = quantized.palette;
  const labels = cleanColorNoise(quantized.labels, width, height, mode === "detailed" ? 0 : 1);
  // At the default setting this removes sub-pixel raster noise but retains the
  // silhouette of small icon details. Higher detail tightens the fit.
  const baseTolerance = mode === "icon"
    ? 0.12 + (100 - detail) * 0.04
    : mode === "illustration"
      ? 0.3 + (100 - detail) * 0.045
      : 0.45 + (100 - detail) * 0.055;
  // Edge cleanup now only removes redundant nodes. It never blurs pixels,
  // changes alpha coverage, or introduces extra colors.
  const tolerance = (baseTolerance + smooth * 0.003) * Math.sqrt(Math.max(1, scale));
  let totalPaths = 0;
  let totalNodes = 0;
  const shapes: string[] = [];
  palette.forEach((color, index) => {
    const contours = traceColor(labels, pixels, width, height, index)
      .filter((contour) => contour.length >= 6)
      .map((contour) => contourToPath(contour, tolerance))
      .filter(Boolean);
    if (!contours.length) return;
    totalPaths += contours.length;
    totalNodes += contours.reduce((sum, path) => sum + (path.match(/[LCQ]/g)?.length || 0), 0);
    shapes.push(`<path fill="${rgbToHex(color[0], color[1], color[2])}" fill-rule="evenodd" d="${contours.join("")}"/>`);
  });
  const inverseScale = Number((1 / scale).toFixed(8));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${originalWidth} ${originalHeight}" width="${originalWidth}" height="${originalHeight}" shape-rendering="geometricPrecision"><g transform="translate(${cropX} ${cropY}) scale(${inverseScale})">${shapes.join("")}</g></svg>`;
  return { svg, palette: palette.map((color) => rgbToHex(color[0], color[1], color[2])), colors: palette.length, paths: totalPaths, nodes: totalNodes, width, height };
}

export default function IconVectorizerPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [result, setResult] = useState<VectorResult | null>(null);
  const [mode, setMode] = useState<VectorMode>("icon");
  const [colors, setColors] = useState(MODE_CONFIG.icon.defaultColors);
  const [detail, setDetail] = useState(62);
  const [smooth, setSmooth] = useState(18);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const svgUrl = useMemo(() => result ? URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" })) : "", [result]);

  const chooseFile = useCallback((next: File) => {
    if (!next.type.startsWith("image/")) { setError("Выберите PNG, JPG или WebP."); return; }
    if (next.size > 12 * 1024 * 1024) { setError("Файл должен быть меньше 12 МБ."); return; }
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setFile(next);
    setSourceUrl(URL.createObjectURL(next));
    setResult(null);
    setError("");
  }, [sourceUrl]);

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0];
    if (next) chooseFile(next);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const next = event.dataTransfer.files?.[0];
    if (next) chooseFile(next);
  };

  const run = async () => {
    if (!file) return inputRef.current?.click();
    setBusy(true);
    setError("");
    try { setResult(await vectorize(file, mode, colors, detail, smooth)); }
    catch { setError("Не удалось обработать изображение. Попробуйте другой файл."); }
    finally { setBusy(false); }
  };

  const download = () => {
    if (!svgUrl) return;
    const anchor = document.createElement("a");
    anchor.href = svgUrl;
    anchor.download = `${file?.name.replace(/\.[^.]+$/, "") || "vector"}.svg`;
    anchor.click();
  };

  const reset = () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setFile(null); setSourceUrl(""); setResult(null); setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const selectMode = (nextMode: VectorMode) => {
    setMode(nextMode);
    setColors(MODE_CONFIG[nextMode].defaultColors);
    setDetail(nextMode === "icon" ? 92 : nextMode === "illustration" ? 80 : 72);
    setSmooth(nextMode === "icon" ? 0 : nextMode === "illustration" ? 12 : 6);
    setResult(null);
  };

  return (
    <main className="vectorizer-shell">
      <header className="vectorizer-nav">
        <a className="vectorizer-brand" href="/vectorizer" aria-label="Vectory home"><span>V</span> Vectory</a>
        <div className="vectorizer-status"><i /> Обработка на вашем устройстве</div>
      </header>

      <section className="vectorizer-intro">
        <div className="vectorizer-kicker"><Sparkles size={14} /> PNG → SVG без потери масштаба</div>
        <h1>Превратите изображение<br />в <em>чистый вектор</em></h1>
        <p>Загрузите иконку или цветную иллюстрацию — мы соберём палитру, выделим области и подготовим редактируемый SVG.</p>
      </section>

      <section className="vectorizer-workspace">
        {!file ? (
          <button className={`vectorizer-dropzone ${dragging ? "is-dragging" : ""}`} onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <span className="vectorizer-upload-icon"><Upload size={30} /></span>
            <strong>Перетащите изображение сюда</strong>
            <small>или нажмите, чтобы выбрать файл</small>
            <span className="vectorizer-formats">PNG · JPG · WEBP &nbsp;до 12 МБ</span>
          </button>
        ) : (
          <div className="vectorizer-grid">
            <div className="vectorizer-preview-card">
              <div className="vectorizer-card-head"><span>Оригинал</span><button onClick={reset} aria-label="Удалить изображение"><X size={17} /></button></div>
              <div className="vectorizer-canvas"><img src={sourceUrl} alt="Загруженный оригинал" /></div>
              <div className="vectorizer-file-row"><ImagePlus size={16} /><span>{file.name}</span><small>{(file.size / 1024).toFixed(0)} КБ</small></div>
            </div>
            <div className="vectorizer-preview-card">
              <div className="vectorizer-card-head"><span>Вектор</span>{result && <b>SVG</b>}</div>
              <div className={`vectorizer-canvas ${!result ? "is-empty" : ""}`}>
                {busy ? <div className="vectorizer-processing"><RefreshCw size={28} /><span>Строим контуры…</span></div> : result ? <img src={svgUrl} alt="Векторный результат" /> : <><Sparkles size={28} /><span>Результат появится здесь</span></>}
              </div>
              <div className="vectorizer-file-row vectorizer-stats">{result ? <><span className="vectorizer-palette" aria-label="Палитра">{result.palette.slice(0, 12).map((color, index) => <i key={`${color}-${index}`} style={{ background: color }} />)}</span><span>{result.colors} цветов</span><span>{result.paths} контуров</span><span>{result.nodes} узлов</span></> : <span>Настройте параметры и запустите обработку</span>}</div>
            </div>
          </div>
        )}
        <input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={onInput} />

        <div className="vectorizer-modes" aria-label="Тип изображения">
          {(Object.keys(MODE_CONFIG) as VectorMode[]).map((item) => (
            <button key={item} className={mode === item ? "is-active" : ""} onClick={() => selectMode(item)}>
              <b>{MODE_CONFIG[item].label}</b><small>{MODE_CONFIG[item].hint}</small>
            </button>
          ))}
        </div>

        <div className="vectorizer-controls">
          <label><span><b>Макс. цветов</b><output>{colors}</output></span><input type="range" min="1" max={MODE_CONFIG[mode].maxColors} value={colors} onChange={(e) => setColors(Number(e.target.value))} /></label>
          <label><span><b>Детализация</b><output>{detail}%</output></span><input type="range" min="20" max="95" value={detail} onChange={(e) => setDetail(Number(e.target.value))} /></label>
          <label><span><b>Очистка узлов</b><output>{smooth}%</output></span><input type="range" min="0" max="60" value={smooth} onChange={(e) => setSmooth(Number(e.target.value))} /></label>
          <button className="vectorizer-primary" disabled={busy} onClick={result ? download : run}>{result ? <><Download size={18} /> Скачать SVG</> : busy ? <><RefreshCw className="spin" size={18} /> Векторизация…</> : <><Sparkles size={18} /> Векторизировать</>}</button>
          {result && <button className="vectorizer-secondary" disabled={busy} onClick={run}><RefreshCw size={17} /> Пересобрать</button>}
        </div>
        {error && <p className="vectorizer-error">{error}</p>}
      </section>

      <footer className="vectorizer-footer"><span>Изображения не покидают ваш браузер</span><span>Иконки · иллюстрации · цветная графика</span></footer>
    </main>
  );
}
