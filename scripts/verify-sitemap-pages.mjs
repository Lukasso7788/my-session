import { readFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://mysession.club";
const dist = path.resolve("dist");
const sectionFiles = ["sitemap-pages.xml", "sitemap-guides.xml", "sitemap-comparisons.xml"];
const sitemap = await readFile(path.join(dist, "sitemap.xml"), "utf8");
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const errors = [];
const pageUrls = new Set();
const homeTitle = (await readFile(path.join(dist, "index.html"), "utf8"))
  .match(/<title>([^<]+)<\/title>/i)?.[1];

if (!sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) errors.push("sitemap.xml must start with the XML declaration");
if (!sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')) {
  errors.push("sitemap.xml must be a flat <urlset>, not a sitemap index");
}
if (/<script\b|<sitemapindex\b/i.test(sitemap)) errors.push("sitemap.xml contains unexpected markup");

for (const url of locs(sitemap)) {
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

const sectionUrls = new Set();
for (const name of sectionFiles) {
  const xml = await readFile(path.join(dist, name), "utf8");
  if (!xml.includes("<urlset")) errors.push(`${name}: not a URL sitemap`);
  for (const url of locs(xml)) {
    sectionUrls.add(url);
    if (!pageUrls.has(url)) errors.push(`${name}: ${url} is missing from sitemap.xml`);
  }
}
if (sectionUrls.size !== pageUrls.size) {
  errors.push(`sitemap.xml has ${pageUrls.size} URLs but section sitemaps have ${sectionUrls.size}`);
}

const robotsTxt = await readFile(path.join(dist, "robots.txt"), "utf8");
if (!robotsTxt.includes(`Sitemap: ${origin}/sitemap.xml`)) errors.push("robots.txt does not reference sitemap.xml");

if (!pageUrls.size) errors.push("sitemap.xml contains no pages");
if (errors.length) {
  errors.forEach((error) => console.error(`[seo:sitemap:error] ${error}`));
  process.exitCode = 1;
} else {
  console.log(`[seo:sitemap] Verified ${pageUrls.size} pages in flat sitemap.xml (section sitemaps match).`);
}
