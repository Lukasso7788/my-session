import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const pages = JSON.parse(await readFile(path.resolve("src/data/seo-pages.json"), "utf8"));
const dist = path.resolve("dist");
const template = await readFile(path.join(dist, "index.html"), "utf8");

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const safeJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const pageBySlug = new Map(pages.map((page) => [page.slug, page]));

function replaceOrInsert(html, pattern, replacement) {
  return pattern.test(html) ? html.replace(pattern, replacement) : html.replace("</head>", `  ${replacement}\n</head>`);
}

function renderVisibleContent(page) {
  const sections = page.sections.map((section) => `
    <section>
      <h2>${escapeHtml(section.heading)}</h2>
      ${section.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
      ${section.bullets?.length ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>` : ""}
    </section>`).join("");
  const faq = page.faqItems?.length ? `
    <section><h2>Frequently asked questions</h2>
      ${page.faqItems.map((item) => `<h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p>`).join("")}
    </section>` : "";
  const related = (page.relatedPageSlugs || [])
    .map((slug) => pageBySlug.get(slug)).filter(Boolean)
    .map((item) => `<li><a href="${escapeHtml(item.route)}">${escapeHtml(item.h1)}</a></li>`).join("");
  return `<main class="seo-prerender">
    <nav aria-label="Breadcrumb"><a href="/">Home</a> / ${escapeHtml(page.h1)}</nav>
    <header><p>${escapeHtml(page.pageType)}</p><h1>${escapeHtml(page.h1)}</h1><p>${escapeHtml(page.heroDescription)}</p><a href="/sessions">Browse focus sessions</a></header>
    ${sections}${faq}
    <section><h2>Continue exploring</h2><ul>${related}</ul></section>
  </main>`;
}

function render(page) {
  const canonical = `https://mysession.club${page.route}`;
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.metaDescription);
  let html = template.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  html = replaceOrInsert(html, /<meta\s+name="description"[\s\S]*?\/?>/i, `<meta name="description" content="${description}" />`);
  html = replaceOrInsert(html, /<meta\s+name="robots"[\s\S]*?\/?>/i, `<meta name="robots" content="index, follow, max-image-preview:large" />`);
  html = replaceOrInsert(html, /<link\s+rel="canonical"[\s\S]*?\/?>/i, `<link rel="canonical" href="${canonical}" />`);
  html = replaceOrInsert(html, /<meta\s+property="og:title"[\s\S]*?\/?>/i, `<meta property="og:title" content="${title}" />`);
  html = replaceOrInsert(html, /<meta\s+property="og:description"[\s\S]*?\/?>/i, `<meta property="og:description" content="${description}" />`);
  html = replaceOrInsert(html, /<meta\s+property="og:url"[\s\S]*?\/?>/i, `<meta property="og:url" content="${canonical}" />`);
  html = replaceOrInsert(html, /<meta\s+property="og:type"[\s\S]*?\/?>/i, `<meta property="og:type" content="${page.pageType === "guide" ? "article" : "website"}" />`);
  html = replaceOrInsert(html, /<meta\s+name="twitter:title"[\s\S]*?\/?>/i, `<meta name="twitter:title" content="${title}" />`);
  html = replaceOrInsert(html, /<meta\s+name="twitter:description"[\s\S]*?\/?>/i, `<meta name="twitter:description" content="${description}" />`);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": page.pageType === "guide" ? "Article" : "WebPage",
    headline: page.h1,
    name: page.h1,
    description: page.metaDescription,
    url: canonical,
    dateModified: page.updatedAt,
  };
  html = html.replace("</head>", `  <script type="application/ld+json">${safeJson(jsonLd)}</script>\n</head>`);
  return html.replace('<div id="root"></div>', `<div id="root">${renderVisibleContent(page)}</div>`);
}

for (const page of pages.filter((item) => item.indexable)) {
  const output = path.join(dist, ...page.route.slice(1).split("/"));
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "index.html"), render(page), "utf8");
}
console.log(`[prerender-seo] Wrote ${pages.filter((item) => item.indexable).length} route-specific HTML files.`);
