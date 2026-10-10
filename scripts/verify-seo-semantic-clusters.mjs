import { readFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://mysession.club";
const pages = JSON.parse(await readFile("src/data/seo-pages.json", "utf8"));
const routes = JSON.parse(await readFile("src/data/seo-route-manifest.json", "utf8"));
const sources = JSON.parse(await readFile("scripts/editorial-covers/sources.json", "utf8"));
const sitemap = await readFile("dist/sitemap-pages.xml", "utf8");
const guideSitemap = await readFile("dist/sitemap-guides.xml", "utf8");
const checks = [
  ["body-doubling-app", "body doubling app", "WebApplication", "sitemap-pages.xml"],
  ["virtual-coworking", "virtual coworking rooms", "Article", "sitemap-guides.xml"],
  ["virtual-coworking-for-remote-workers", "virtual coworking for remote workers", "WebPage", "sitemap-pages.xml"],
];
const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function imageDimensions(bytes) {
  if (bytes.readUInt16BE(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    let marker = bytes[offset++];
    while (marker === 0xff) marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

for (const [slug, keyword, schemaType, sitemapFile] of checks) {
  const page = pages.find((entry) => entry.slug === slug);
  assert(page, `${slug}: missing SEO definition`);
  if (!page) continue;
  const html = await readFile(path.join("dist", slug, "index.html"), "utf8");
  const image = await readFile(path.join("dist", page.imagePath.slice(1)));
  const dimensions = imageDimensions(image);
  const source = sources.find((entry) => entry.slug === slug);
  const url = `${origin}${page.route}`;
  const imageUrl = `${origin}${page.imagePath}`;
  const visible = html.match(/<div id="root">([\s\S]*?)<\/div>/)?.[1] || "";
  const wordCount = visible.replace(/<[^>]+>/g, " ").replace(/&[a-z0-9#]+;/gi, " ").trim().split(/\s+/).length;

  assert(page.primaryKeyword === keyword, `${slug}: wrong primary keyword`);
  assert(page.title.length < 60, `${slug}: title is not concise`);
  assert(page.title.toLowerCase().includes(keyword.split(" ").slice(0, 2).join(" ")), `${slug}: title misses topic`);
  assert(page.imageAlt?.length >= 55, `${slug}: image alt should describe the composition`);
  assert(routes.some((entry) => entry.slug === slug && entry.route === page.route), `${slug}: route manifest missing`);
  assert(html.includes(`<title>${page.title}</title>`), `${slug}: incorrect HTML title`);
  assert(html.includes(`content="${page.metaDescription}"`), `${slug}: incorrect meta description`);
  assert(html.includes(`<link rel="canonical" href="${url}"`), `${slug}: incorrect canonical`);
  assert((html.match(/<h1\b/g) || []).length === 1, `${slug}: expected one H1`);
  assert(html.includes(`<h1>${page.h1}</h1>`), `${slug}: prerendered H1 mismatch`);
  assert(wordCount >= 200, `${slug}: thin prerendered content (${wordCount} words)`);
  assert(html.includes(`"@type":"${schemaType}"`), `${slug}: incorrect schema type`);
  assert(html.includes(`content="${imageUrl}"`), `${slug}: missing social image`);
  assert(html.includes(`content="${page.imageAlt}"`), `${slug}: missing social image alt`);
  assert(html.includes(`src="${page.imagePath}" alt="${page.imageAlt}"`), `${slug}: missing visible image alt`);
  assert((sitemapFile === "sitemap-pages.xml" ? sitemap : guideSitemap).includes(`<loc>${url}</loc>`), `${slug}: missing sitemap URL`);
  assert(dimensions?.width === 1200 && dimensions?.height === 630, `${slug}: wrong JPEG dimensions`);
  assert(image.length < 220_000, `${slug}: image too large (${image.length} bytes)`);
  assert(source?.sourcePage?.startsWith("https://www.pexels.com/photo/") && source?.photographer, `${slug}: missing photo provenance`);
  console.log(`[seo:clusters] ${page.route}: ${wordCount} words, image ${Math.round(image.length / 1024)} KB`);
}

const hub = await readFile("dist/body-doubling/index.html", "utf8");
assert(hub.includes('href="/body-doubling-app"'), "body-doubling hub: missing app link");
for (const [route, slug, alt] of [
  ["guides/what-is-body-doubling", "body-doubling-shared-start", "Two people work on separate laptops at home beside the words A shared start"],
  ["blog/remote-work-accountability-without-meetings", "remote-work-protected-block", "Woman wearing headphones works at a laptop by a window beside the words Protect the work block"],
]) {
  const html = await readFile(path.join("dist", route, "index.html"), "utf8");
  assert(html.includes(`src="/blog/editorial/${slug}-cover.jpg" alt="${alt}"`), `${route}: missing inline illustration or descriptive alt`);
  const image = await readFile(path.join("dist/blog/editorial", `${slug}-cover.jpg`));
  assert(imageDimensions(image)?.width === 1200, `${slug}: invalid inline illustration`);
  assert(sources.some((source) => source.slug === slug && source.photographer && source.sourcePage), `${slug}: missing photo provenance`);
}

const relevant = pages.filter((page) => page.indexable);
for (const key of ["title", "metaDescription", "route"]) {
  const values = relevant.map((page) => page[key]);
  assert(new Set(values).size === values.length, `duplicate ${key} among indexable SEO pages`);
}

if (errors.length) {
  errors.forEach((error) => console.error(`[seo:clusters:error] ${error}`));
  process.exitCode = 1;
} else {
  console.log("[seo:clusters] Target routes, metadata, content, imagery, links and sitemap passed.");
}
