import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(await readFile(path.join(directory, "sources.json"), "utf8"));
const output = path.join(directory, "photos");
const refreshSlug = process.argv[2] || null;
if (refreshSlug && !sources.some((source) => source.slug === refreshSlug)) {
  throw new Error(`Unknown cover slug: ${refreshSlug}`);
}
await mkdir(output, { recursive: true });

for (const source of sources) {
  const filename = path.join(output, `${source.slug}.jpg`);
  const existing = await stat(filename).catch(() => null);
  if (existing?.size > 20_000 && source.slug !== refreshSlug) {
    console.log(`[covers:photos] ${source.slug}: already present`);
    continue;
  }
  const url = `https://images.pexels.com/photos/${source.photoId}/pexels-photo-${source.photoId}.jpeg?auto=compress&cs=tinysrgb&w=1800&q=86`;
  const response = await fetch(url, { headers: { "User-Agent": "MySession editorial cover builder" } });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
    throw new Error(`Could not download licensed photo ${source.photoId}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 20_000 || bytes.length > 5_000_000) throw new Error(`Unexpected photo size: ${source.photoId}`);
  await writeFile(filename, bytes);
  console.log(`[covers:photos] ${source.slug}: ${Math.round(bytes.length / 1024)} KB`);
}
