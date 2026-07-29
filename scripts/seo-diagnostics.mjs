import { readFile } from "node:fs/promises";
import path from "node:path";

const pages = JSON.parse(await readFile(path.resolve("src/data/seo-pages.json"), "utf8"));
const sitemapFiles = ["public/sitemap-pages.xml", "public/sitemap-guides.xml", "public/sitemap-comparisons.xml"];
const sitemapText = (await Promise.all(sitemapFiles.map((file) => readFile(path.resolve(file), "utf8")))).join("\n");
const errors = [];
const warnings = [];
const required = ["slug", "route", "pageType", "title", "metaDescription", "h1", "primaryKeyword", "searchIntent", "canonicalUrl"];

const duplicates = (field) => {
  const seen = new Map();
  for (const page of pages) {
    const value = field === "canonicalUrl" ? `https://mysession.club${page.route}` : page[field];
    if (seen.has(value)) errors.push(`Duplicate ${field}: ${value} (${seen.get(value)}, ${page.slug})`);
    seen.set(value, page.slug);
  }
};

for (const field of ["slug", "route", "title", "metaDescription", "h1", "canonicalUrl"]) duplicates(field);
const slugs = new Set(pages.map((page) => page.slug));
for (const page of pages) {
  for (const field of required.filter((item) => item !== "canonicalUrl")) {
    if (!page[field] || (typeof page[field] === "string" && !page[field].trim())) errors.push(`${page.slug}: missing ${field}`);
  }
  if (page.title.length > 65) warnings.push(`${page.slug}: title is ${page.title.length} characters`);
  if (page.metaDescription.length < 120 || page.metaDescription.length > 165) warnings.push(`${page.slug}: description is ${page.metaDescription.length} characters`);
  if (!page.route.startsWith("/") || page.route.endsWith("/")) errors.push(`${page.slug}: invalid canonical route ${page.route}`);
  if (!page.sections?.length) errors.push(`${page.slug}: no visible content sections`);
  if (!page.relatedPageSlugs?.length) errors.push(`${page.slug}: missing related links`);
  for (const related of page.relatedPageSlugs || []) if (!slugs.has(related)) errors.push(`${page.slug}: broken related slug ${related}`);
  const words = [page.heroDescription, ...(page.sections || []).flatMap((section) => [...section.body, ...(section.bullets || [])])].join(" ").split(/\s+/).length;
  if (words < 100) warnings.push(`${page.slug}: only ${words} registry words`);
  const canonical = `https://mysession.club${page.route}`;
  if (page.indexable && !sitemapText.includes(`<loc>${canonical}</loc>`)) errors.push(`${page.slug}: indexable page missing from sitemap`);
  if (!page.indexable && sitemapText.includes(`<loc>${canonical}</loc>`)) errors.push(`${page.slug}: noindex page included in sitemap`);
}

for (const warning of warnings) console.warn(`[seo:warning] ${warning}`);
for (const error of errors) console.error(`[seo:error] ${error}`);
console.log(`[seo] Checked ${pages.length} pages: ${errors.length} errors, ${warnings.length} warnings.`);
if (errors.length) process.exit(1);
