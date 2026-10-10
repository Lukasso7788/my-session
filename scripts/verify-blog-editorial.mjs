import { readFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://mysession.club";
const posts = JSON.parse(await readFile(path.resolve("src/data/blog-editorial-manifest.json"), "utf8"));
const guideSitemap = await readFile(path.resolve("dist/sitemap-guides.xml"), "utf8");
const slugs = new Set();
const errors = [];

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
  if (!post.coverImagePath?.startsWith("/blog/editorial/") || !post.coverImageAlt || post.coverImageAlt.length < 40) {
    errors.push(`${post.slug}: missing descriptive cover image or alt text`);
  }
  const image = await readFile(path.resolve("public", post.coverImagePath.slice(1)), "utf8");
  if (!image.includes('width="1200" height="630"')) errors.push(`${post.slug}: missing intrinsic cover dimensions`);
  if (Buffer.byteLength(image) > 16_000) errors.push(`${post.slug}: cover is larger than 16 KB`);

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
