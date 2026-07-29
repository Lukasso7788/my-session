import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://mysession.club";
const pages = JSON.parse(await readFile(path.resolve("src/data/seo-pages.json"), "utf8"));
const staticPages = [
  ["/", "weekly", 1],
  ["/sessions", "daily", 0.8],
  ["/pricing", "monthly", 0.8],
  ["/how-it-works", "monthly", 0.8],
  ["/faq", "monthly", 0.7],
  ["/blog", "weekly", 0.7],
  ["/updates", "monthly", 0.5],
  ["/affiliate", "monthly", 0.5],
  ["/contact", "yearly", 0.4],
  ["/terms", "yearly", 0.3],
  ["/privacy", "yearly", 0.3],
  ["/refund-policy", "yearly", 0.3],
];

function urlset(items) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items
    .map((item) => `  <url>\n    <loc>${origin}${item.route}</loc>\n    <lastmod>${item.updatedAt || "2026-07-29"}</lastmod>\n    <changefreq>${item.changeFrequency}</changefreq>\n    <priority>${Number(item.sitemapPriority).toFixed(1)}</priority>\n  </url>`)
    .join("\n")}\n</urlset>\n`;
}

const normalizedStatic = staticPages.map(([route, changeFrequency, sitemapPriority]) => ({
  route, changeFrequency, sitemapPriority, updatedAt: "2026-07-29",
}));
const indexable = pages.filter((page) => page.indexable);
const pageEntries = [...normalizedStatic, ...indexable.filter((page) => ["use-case", "session-format"].includes(page.pageType))];
const guideEntries = [
  ...indexable.filter((page) => page.pageType === "guide"),
  { route: "/blog/best-focusmate-alternatives", changeFrequency: "monthly", sitemapPriority: 0.8, updatedAt: "2026-07-29" },
];
const comparisonEntries = indexable.filter((page) => page.pageType === "comparison");

await writeFile("public/sitemap-pages.xml", urlset(pageEntries), "utf8");
await writeFile("public/sitemap-guides.xml", urlset(guideEntries), "utf8");
await writeFile("public/sitemap-comparisons.xml", urlset(comparisonEntries), "utf8");

const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
  "sitemap-pages.xml", "sitemap-guides.xml", "sitemap-comparisons.xml",
].map((name) => `  <sitemap><loc>${origin}/${name}</loc></sitemap>`).join("\n")}\n</sitemapindex>\n`;
await writeFile("public/sitemap.xml", sitemapIndex, "utf8");
console.log(`[seo-assets] Wrote sitemaps for ${pageEntries.length + guideEntries.length + comparisonEntries.length} URLs.`);
