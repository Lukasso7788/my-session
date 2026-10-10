import { readFile } from "node:fs/promises";
import path from "node:path";

const routes = [
  { route: "/sessions", minWords: 100 },
  { route: "/pricing", minWords: 15 },
  { route: "/faq", minWords: 15 },
  { route: "/updates", minWords: 15 },
  { route: "/blog/best-focusmate-alternatives", minWords: 500 },
  { route: "/caveday-alternative", minWords: 400 },
];
const errors = [];
const sitemap = await readFile(path.resolve("dist/sitemap-comparisons.xml"), "utf8");
const manifest = JSON.parse(await readFile(path.resolve("src/data/seo-route-manifest.json"), "utf8"));

for (const { route, minWords } of routes) {
  const html = await readFile(path.resolve("dist", route.slice(1), "index.html"), "utf8");
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] || "";
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i)?.[1];
  const root = html.match(/<div id="root">([\s\S]*?)<\/div>/i)?.[1] || "";
  const text = root.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z0-9#]+;/gi, " ");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const h1Count = (root.match(/<h1\b/gi) || []).length;
  if (!title || title.includes("Stay Focused 24/7")) errors.push(`${route}: inherited or missing title`);
  if (canonical !== `https://mysession.club${route}`) errors.push(`${route}: wrong canonical (${canonical})`);
  if (h1Count !== 1) errors.push(`${route}: expected one H1, found ${h1Count}`);
  if (words < minWords) errors.push(`${route}: only ${words} raw HTML words; expected ${minWords}`);
  if (!html.includes('id="seo-prerender-clear"')) errors.push(`${route}: missing React handoff`);
  console.log(`[seo:public] ${route} | words=${words} | H1=${h1Count}`);
}

if (!manifest.some((page) => page.route === "/caveday-alternative")) errors.push("Caveday route missing from React manifest");
if (!sitemap.includes("<loc>https://mysession.club/caveday-alternative</loc>")) errors.push("Caveday route missing from comparison sitemap");

if (errors.length) {
  errors.forEach((error) => console.error(`[seo:public:error] ${error}`));
  process.exitCode = 1;
} else {
  console.log("[seo:public] Public route HTML and sitemap checks passed.");
}
