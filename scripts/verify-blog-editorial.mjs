import { readFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://mysession.club";
const posts = JSON.parse(await readFile(path.resolve("src/data/blog-editorial-manifest.json"), "utf8"));
const coverSources = JSON.parse(await readFile(path.resolve("scripts/editorial-covers/sources.json"), "utf8"));
const coverSourceBySlug = new Map(coverSources.map((source) => [source.slug, source]));
const guideSitemap = await readFile(path.resolve("dist/sitemap-guides.xml"), "utf8");
const runtimeModule = await readFile(path.resolve("src/data/blogEditorial.ts"), "utf8");
const slugs = new Set();
const errors = [];

function jpegDimensions(bytes) {
  if (bytes.length < 8 || bytes.readUInt16BE(0) !== 0xffd8) return null;
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

for (const post of posts) {
  const route = post.route || `/blog/${post.slug}`;
  const url = `${origin}${route}`;
  const imageUrl = `${origin}${post.coverImagePath}`;
  if (slugs.has(post.slug)) errors.push(`${post.slug}: duplicate article slug`);
  slugs.add(post.slug);

  if (!post.seoTitle || post.seoTitle.length >= 60) errors.push(`${post.slug}: title must be under 60 characters`);
  if (!post.metaDescription || post.metaDescription.length >= 60) errors.push(`${post.slug}: description must be under 60 characters`);
  if (!post.focusKeyword || !post.seoTitle.toLowerCase().includes(post.focusKeyword.toLowerCase())) {
    errors.push(`${post.slug}: one primary keyword must appear in the SEO title`);
  }
  const slugTokens = new Set(post.slug.split("-"));
  if (post.focusKeyword.toLowerCase().split(/\s+/).filter((word) => slugTokens.has(word)).length < 2) {
    errors.push(`${post.slug}: descriptive URL does not overlap its primary keyword`);
  }
  if (post.coverImagePath !== `/blog/editorial/${post.slug}-cover.jpg` || !post.coverImageAlt || post.coverImageAlt.length < 40) {
    errors.push(`${post.slug}: missing descriptive cover image or alt text`);
  }
  const image = await readFile(path.resolve("public", post.coverImagePath.slice(1)));
  const dimensions = jpegDimensions(image);
  if (!dimensions || dimensions.width !== 1200 || dimensions.height !== 630) {
    errors.push(`${post.slug}: cover must be a 1200 x 630 JPEG screenshot`);
  }
  if (image.length > 220_000) errors.push(`${post.slug}: cover is larger than 220 KB`);
  const source = coverSourceBySlug.get(post.slug);
  if (!source?.sourcePage?.startsWith("https://www.pexels.com/photo/") || !source.photographer) {
    errors.push(`${post.slug}: missing licensed photo provenance`);
  }
  const composition = await readFile(path.resolve("scripts/editorial-covers/compositions", `${post.slug}.html`), "utf8");
  if (!composition.includes(source?.headline || "<missing headline>")) errors.push(`${post.slug}: composition does not match source metadata`);

  if (!runtimeModule.includes(`"${post.markdownFile}":`) || !runtimeModule.includes(`../content/blog/${post.markdownFile}?raw`)) {
    errors.push(`${post.slug}: markdown is not imported by src/data/blogEditorial.ts`);
  }
  const markdown = await readFile(path.resolve("src/content/blog", post.markdownFile), "utf8");
  const words = markdown.trim().split(/\s+/).length;
  if (words < 400) errors.push(`${post.slug}: article is too thin (${words} words)`);
  if ((markdown.match(/^## /gm) || []).length < 4) errors.push(`${post.slug}: fewer than four sections`);
  if (/<\s*\/?\s*[a-z][^>]*>/i.test(markdown)) errors.push(`${post.slug}: raw HTML is not allowed in bundled markdown`);
  if ((markdown.match(/\]\(\/[^)]+\)/g) || []).length < 2) errors.push(`${post.slug}: fewer than two internal links`);
  if (!/\]\(\/blog\/[^)]+\)/.test(markdown)) errors.push(`${post.slug}: missing contextual related-article link`);
  if (!guideSitemap.includes(`<loc>${url}</loc>`)) errors.push(`${post.slug}: missing from guide sitemap`);

  const html = await readFile(path.resolve("dist", route.slice(1), "index.html"), "utf8");
  if (!html.includes(`<link rel="canonical" href="${url}"`)) errors.push(`${post.slug}: incorrect canonical`);
  if (!html.includes(`<h1>${post.title}</h1>`)) errors.push(`${post.slug}: missing prerendered title`);
  if (!html.includes(`<title>${post.seoTitle}</title>`)) errors.push(`${post.slug}: incorrect HTML title`);
  if (!html.includes(`<meta name="description" content="${post.metaDescription}"`)) errors.push(`${post.slug}: incorrect HTML description`);
  if (!html.includes(`<meta property="og:image" content="${imageUrl}"`)) errors.push(`${post.slug}: missing cover in social metadata`);
  if (!html.includes(`alt="${post.coverImageAlt}"`)) errors.push(`${post.slug}: missing descriptive image alt in HTML`);
  if (source && !html.includes(`Photo by <a href="${source.sourcePage}">${source.photographer}</a>`)) {
    errors.push(`${post.slug}: photo credit missing from prerendered HTML`);
  }
  if (!html.includes('name="viewport"')) errors.push(`${post.slug}: missing mobile viewport`);
  if (!html.includes('"@type":"BlogPosting"')) errors.push(`${post.slug}: missing BlogPosting schema`);
  if (!html.includes('id="seo-prerender-clear"')) errors.push(`${post.slug}: missing React handoff`);
  if (html.includes("MySession – Stay Focused 24/7</title>")) errors.push(`${post.slug}: inherited homepage title`);
  await readFile(path.resolve("dist", post.coverImagePath.slice(1)));
}

if (errors.length) {
  errors.forEach((error) => console.error(`[seo:blog:error] ${error}`));
  process.exitCode = 1;
} else {
  console.log(`[seo:blog] Verified ${posts.length} editorial articles, HTML routes, schema and sitemap entries.`);
}
