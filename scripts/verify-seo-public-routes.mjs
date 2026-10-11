import { readFile } from "node:fs/promises";
import path from "node:path";

const routes = [
  { route: "/sessions", minWords: 200 },
  { route: "/pricing", minWords: 200 },
  { route: "/faq", minWords: 800 },
  { route: "/updates", minWords: 50 },
  { route: "/blog/best-focusmate-alternatives", minWords: 1000 },
  { route: "/caveday-alternative", minWords: 600, table: true },
  { route: "/focusmate-alternative", minWords: 600, table: true },
  { route: "/flow-club-alternative", minWords: 600, table: true },
  { route: "/flown-alternative", minWords: 600, table: true },
];
const errors = [];
const sitemap = await readFile(path.resolve("dist/sitemap-comparisons.xml"), "utf8");
const manifest = JSON.parse(await readFile(path.resolve("src/data/seo-route-manifest.json"), "utf8"));
const normalize = (value) => value.replace(/\s+/g, " ").trim();
const decode = (value) => value.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const htmlByRoute = new Map();

for (const { route, minWords, table } of routes) {
  const html = await readFile(path.resolve("dist", route.slice(1), "index.html"), "utf8");
  htmlByRoute.set(route, html);
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
  if (table && !/<table>[\s\S]*<th scope="row">[\s\S]*<\/table>/.test(root)) errors.push(`${route}: missing comparison table`);
  if (/FLown/.test(root)) errors.push(`${route}: FLOWN is misspelled`);
  console.log(`[seo:public] ${route} | words=${words} | H1=${h1Count}`);
}

const pricingSource = normalize(await readFile(path.resolve("src/pages/PricingPage.tsx"), "utf8"));
const pricingRoot = htmlByRoute.get("/pricing").match(/<div id="root">([\s\S]*?)<\/div>/i)?.[1] || "";
const pricingClaims = [
  ...[...pricingRoot.matchAll(/<li>([^<]+)<\/li>/g)].map((match) => decode(match[1])),
  ...[...pricingRoot.matchAll(/<h3>[^<]+<\/h3><p>([^<]+)<\/p>/g)].map((match) => decode(match[1])),
  "$10", "$96", "$300", "₹958/month", "Pay $96/year instead of $120",
];
for (const claim of pricingClaims) {
  if (!pricingSource.includes(normalize(claim))) errors.push(`/pricing: prerendered claim no longer on the pricing page: "${claim}"`);
  if (!decode(pricingRoot).includes(claim)) errors.push(`/pricing: prerendered HTML is missing "${claim}"`);
}

const listicleTitle = htmlByRoute.get("/blog/best-focusmate-alternatives").match(/<title>([^<]+)<\/title>/i)?.[1];
const landingTitle = htmlByRoute.get("/focusmate-alternative").match(/<title>([^<]+)<\/title>/i)?.[1];
if (listicleTitle === landingTitle) errors.push("Focusmate roundup and landing page share a title");

if (!manifest.some((page) => page.route === "/caveday-alternative")) errors.push("Caveday route missing from React manifest");
if (!sitemap.includes("<loc>https://mysession.club/caveday-alternative</loc>")) errors.push("Caveday route missing from comparison sitemap");

if (errors.length) {
  errors.forEach((error) => console.error(`[seo:public:error] ${error}`));
  process.exitCode = 1;
} else {
  console.log("[seo:public] Public route HTML, pricing parity and sitemap checks passed.");
}
