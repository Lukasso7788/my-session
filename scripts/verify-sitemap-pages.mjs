import { readFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://mysession.club";
const dist = path.resolve("dist");
const sitemapIndex = await readFile(path.join(dist, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemapIndex.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const errors = [];
const pageUrls = new Set();
const homeTitle = (await readFile(path.join(dist, "index.html"), "utf8"))
  .match(/<title>([^<]+)<\/title>/i)?.[1];

if (!sitemapIndex.includes("<sitemapindex")) errors.push("sitemap.xml is not a sitemap index");

for (const sitemapUrl of sitemapUrls) {
  const sitemap = new URL(sitemapUrl);
  if (sitemap.origin !== origin) {
    errors.push(`${sitemapUrl}: sitemap is not on the canonical origin`);
    continue;
  }

  const xml = await readFile(path.join(dist, sitemap.pathname.slice(1)), "utf8");
  if (!xml.includes("<urlset")) errors.push(`${sitemapUrl}: not a URL sitemap`);

  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const url = match[1];
    const page = new URL(url);
    if (page.origin !== origin || page.search || page.hash) {
      errors.push(`${url}: non-canonical origin or URL suffix`);
      continue;
    }
    if (pageUrls.has(url)) errors.push(`${url}: duplicate sitemap URL`);
    pageUrls.add(url);

    const route = page.pathname;
    const file = route === "/"
      ? path.join(dist, "index.html")
      : path.join(dist, ...route.slice(1).split("/"), "index.html");
    let html;
    try {
      html = await readFile(file, "utf8");
    } catch {
      errors.push(`${url}: no route-specific HTML file`);
      continue;
    }

    const canonicalTags = [...html.matchAll(/<link\b[^>]*>/gi)]
      .map((tag) => tag[0])
      .filter((tag) => /\brel=["']canonical["']/i.test(tag));
    const canonical = canonicalTags[0]?.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
    const robots = html.match(/<meta\s+name=["']robots["'][^>]*\bcontent=["']([^"']+)["']/i)?.[1] || "";

    if (canonicalTags.length !== 1 || canonical !== url) {
      errors.push(`${url}: expected one self-canonical, found ${canonical || "none"}`);
    }
    if (!title || (route !== "/" && title === homeTitle)) {
      errors.push(`${url}: missing or inherited homepage title`);
    }
    if (/\bnoindex\b/i.test(robots)) errors.push(`${url}: noindex in sitemap`);
  }
}

if (!sitemapUrls.length || !pageUrls.size) errors.push("sitemap index contains no pages");
if (errors.length) {
  errors.forEach((error) => console.error(`[seo:sitemap:error] ${error}`));
  process.exitCode = 1;
} else {
  console.log(`[seo:sitemap] Verified ${pageUrls.size} pages across ${sitemapUrls.length} sitemaps.`);
}
