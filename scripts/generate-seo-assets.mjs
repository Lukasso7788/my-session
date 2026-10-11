import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://mysession.club";
const pages = JSON.parse(await readFile(path.resolve("src/data/seo-pages.json"), "utf8"));
const editorialPosts = JSON.parse(await readFile(path.resolve("src/data/blog-editorial-manifest.json"), "utf8"));
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

// Google ignores changefreq/priority, so entries carry only loc and lastmod.
function urlset(items) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items
    .map((item) => `  <url>\n    <loc>${origin}${item.route}</loc>\n    <lastmod>${item.updatedAt || "2026-07-29"}</lastmod>\n  </url>`)
    .join("\n")}\n</urlset>\n`;
}

const normalizedStatic = staticPages.map(([route, changeFrequency, sitemapPriority]) => ({
  route, changeFrequency, sitemapPriority, updatedAt: "2026-07-29",
}));
const indexable = pages.filter((page) => page.indexable);
const pageEntries = [...normalizedStatic, ...indexable.filter((page) => ["topic-hub", "use-case", "session-format"].includes(page.pageType))];
const guideEntries = [
  ...indexable.filter((page) => page.pageType === "guide"),
  { route: "/blog/best-focusmate-alternatives", changeFrequency: "monthly", sitemapPriority: 0.8, updatedAt: "2026-07-29" },
  ...editorialPosts.map((post) => ({
    route: post.route || `/blog/${post.slug}`,
    changeFrequency: "monthly",
    sitemapPriority: 0.7,
    updatedAt: post.publishedAt.slice(0, 10),
  })),
];
const comparisonEntries = indexable.filter((page) => page.pageType === "comparison");

await writeFile("public/sitemap-pages.xml", urlset(pageEntries), "utf8");
await writeFile("public/sitemap-guides.xml", urlset(guideEntries), "utf8");
await writeFile("public/sitemap-comparisons.xml", urlset(comparisonEntries), "utf8");

// sitemap.xml is the single submitted sitemap and lists every URL directly.
// The section files stay published for anyone who submitted them separately.
const allEntries = [...pageEntries, ...guideEntries, ...comparisonEntries];
await writeFile("public/sitemap.xml", urlset(allEntries), "utf8");
console.log(`[seo-assets] Wrote sitemap.xml with ${allEntries.length} URLs plus three section sitemaps.`);
