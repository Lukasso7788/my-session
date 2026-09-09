import { readFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://mysession.club";
const routes = [
  ["/", "WebSite"],
  ["/body-doubling", "Article"],
  ["/how-it-works", "HowTo"],
  ["/body-doubling-for-adhd", "WebPage"],
  ["/body-doubling-for-studying", "WebPage"],
];

const sitemapText = (await Promise.all([
  "public/sitemap-pages.xml",
  "public/sitemap-guides.xml",
  "public/sitemap-comparisons.xml",
].map((file) => readFile(path.resolve(file), "utf8")))).join("\n");
const robotsText = await readFile(path.resolve("public/robots.txt"), "utf8");
const results = [];
const errors = [];

function textContent(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttribute(html, pattern, attribute) {
  const tag = html.match(pattern)?.[0] || "";
  return tag.match(new RegExp(`${attribute}=["']([^"']+)["']`, "i"))?.[1] || "";
}

function schemaTypes(html, route) {
  const types = new Set();
  for (const match of html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1]);
      const visit = (item) => {
        if (!item || typeof item !== "object") return;
        if (typeof item["@type"] === "string") types.add(item["@type"]);
        if (Array.isArray(item["@graph"])) item["@graph"].forEach(visit);
      };
      visit(value);
    } catch {
      errors.push(`${route}: invalid JSON-LD`);
    }
  }
  return [...types];
}

const disallowRules = robotsText
  .split(/\r?\n/)
  .map((line) => line.match(/^Disallow:\s*(\S*)/i)?.[1])
  .filter(Boolean);

for (const [route, expectedSchema] of routes) {
  const file = route === "/"
    ? path.resolve("dist/index.html")
    : path.resolve("dist", route.slice(1), "index.html");
  const html = await readFile(file, "utf8");
  const canonical = `${origin}${route}`;
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim() || "";
  const description = getAttribute(html, /<meta\s+name=["']description["'][^>]*>/i, "content");
  const canonicalValue = getAttribute(html, /<link\s+rel=["']canonical["'][^>]*>/i, "href");
  const robots = getAttribute(html, /<meta\s+name=["']robots["'][^>]*>/i, "content");
  const h1Count = [...html.matchAll(/<h1\b/gi)].length;
  const rootHtml = html.match(/<div\s+id=["']root["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
  const words = textContent(rootHtml).split(/\s+/).filter(Boolean).length;
  const links = [...rootHtml.matchAll(/<a\s+[^>]*href=["'](\/[^"']*)["']/gi)].map((match) => match[1]);
  const schemas = schemaTypes(html, route);
  const blockedByRobots = disallowRules.some((rule) => rule === "/" || (route !== "/" && route.startsWith(rule)));

  if (!title) errors.push(`${route}: missing title`);
  if (!description) errors.push(`${route}: missing meta description`);
  if (canonicalValue !== canonical) errors.push(`${route}: canonical is ${canonicalValue || "missing"}`);
  if (h1Count !== 1) errors.push(`${route}: expected 1 H1, found ${h1Count}`);
  if (words < 150) errors.push(`${route}: only ${words} visible raw-HTML words`);
  if (links.length < 4) errors.push(`${route}: only ${links.length} crawlable internal links`);
  if (!schemas.includes(expectedSchema)) errors.push(`${route}: missing ${expectedSchema} structured data`);
  if (/noindex/i.test(robots)) errors.push(`${route}: meta robots contains noindex`);
  if (blockedByRobots) errors.push(`${route}: blocked by robots.txt`);
  if (!sitemapText.includes(`<loc>${canonical}</loc>`)) errors.push(`${route}: missing from sitemap files`);

  results.push({ route, title, description, canonical: canonicalValue, h1Count, words, links: links.length, schemas: schemas.join(", "), robots });
}

for (const field of ["title", "description"]) {
  const values = results.map((result) => result[field]);
  if (new Set(values).size !== values.length) errors.push(`Batch 1 contains duplicate ${field} values`);
}

for (const result of results) {
  console.log(`[seo:batch1] ${result.route} | H1=${result.h1Count} | words=${result.words} | links=${result.links} | schema=${result.schemas}`);
}
if (errors.length) {
  errors.forEach((error) => console.error(`[seo:batch1:error] ${error}`));
  process.exit(1);
}
console.log("[seo:batch1] All five generated HTML routes passed.");
