import { readFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://mysession.club";
const posts = JSON.parse(await readFile(path.resolve("src/data/blog-editorial-manifest.json"), "utf8"));
const guideSitemap = await readFile(path.resolve("dist/sitemap-guides.xml"), "utf8");
const slugs = new Set();
const errors = [];

for (const post of posts) {
  const url = `${origin}/blog/${post.slug}`;
  if (slugs.has(post.slug)) errors.push(`${post.slug}: duplicate article slug`);
  slugs.add(post.slug);

  const markdown = await readFile(path.resolve("src/content/blog", post.markdownFile), "utf8");
  const words = markdown.trim().split(/\s+/).length;
  if (words < 400) errors.push(`${post.slug}: article is too thin (${words} words)`);
  if ((markdown.match(/^## /gm) || []).length < 4) errors.push(`${post.slug}: fewer than four sections`);
  if (/<\s*\/?\s*[a-z][^>]*>/i.test(markdown)) errors.push(`${post.slug}: raw HTML is not allowed in bundled markdown`);
  if (!guideSitemap.includes(`<loc>${url}</loc>`)) errors.push(`${post.slug}: missing from guide sitemap`);

  const html = await readFile(path.resolve("dist/blog", post.slug, "index.html"), "utf8");
  if (!html.includes(`<link rel="canonical" href="${url}"`)) errors.push(`${post.slug}: incorrect canonical`);
  if (!html.includes(`<h1>${post.title}</h1>`)) errors.push(`${post.slug}: missing prerendered title`);
  if (!html.includes('"@type":"BlogPosting"')) errors.push(`${post.slug}: missing BlogPosting schema`);
  if (!html.includes('id="seo-prerender-clear"')) errors.push(`${post.slug}: missing React handoff`);
  if (html.includes("MySession – Stay Focused 24/7</title>")) errors.push(`${post.slug}: inherited homepage title`);
}

if (errors.length) {
  errors.forEach((error) => console.error(`[seo:blog:error] ${error}`));
  process.exitCode = 1;
} else {
  console.log(`[seo:blog] Verified ${posts.length} editorial articles, HTML routes, schema and sitemap entries.`);
}
