import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

const DIST_DIR = path.resolve("dist");
const template = await readFile(path.join(DIST_DIR, "index.html"), "utf8");
const editorialManifest = JSON.parse(await readFile(path.resolve("src/data/blog-editorial-manifest.json"), "utf8"));

const pages = [
  {
    path: "blog",
    title: "MySession Blog | Body Doubling and Focus Guides",
    description: "Body doubling and focus guides you can use today.",
    canonical: "https://mysession.club/blog",
    type: "website",
  },
  {
    path: "blog/best-focusmate-alternatives",
    title: "Focusmate Alternative for Group Focus Rooms | MySession",
    description: "Compare Focusmate with MySession's group focus rooms.",
    canonical: "https://mysession.club/blog/best-focusmate-alternatives",
    type: "article",
    image:
      "https://mysession.club/blog/focusmate-alternatives/focusmate-alternative-cover.jpg",
    imageAlt:
      "Three colleagues working together around laptops and documents at a shared office desk",
  },
];

for (const post of editorialManifest) {
  const markdown = await readFile(path.resolve("src/content/blog", post.markdownFile), "utf8");
  if (!markdown.includes("## ")) throw new Error(`Editorial article ${post.slug} has no sections`);
  const route = post.route || `/blog/${post.slug}`;
  pages.push({
    path: route.slice(1),
    title: post.seoTitle,
    description: post.metaDescription,
    canonical: `https://mysession.club${route}`,
    type: "article",
    headline: post.title,
    publishedAt: post.publishedAt,
    markdown,
    image: `https://mysession.club${post.coverImagePath}`,
    imageAlt: post.coverImageAlt,
    breadcrumb: route.startsWith("/guides/")
      ? { name: "Body doubling", path: "/body-doubling" }
      : { name: "Blog", path: "/blog" },
  });
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function replaceMeta(html, selector, replacement) {
  const patterns = {
    description: /<meta\s+name="description"[\s\S]*?\/?>/i,
    ogTitle: /<meta\s+property="og:title"[\s\S]*?\/?>/i,
    ogDescription: /<meta\s+property="og:description"[\s\S]*?\/?>/i,
    ogType: /<meta\s+property="og:type"[\s\S]*?\/?>/i,
    ogUrl: /<meta\s+property="og:url"[\s\S]*?\/?>/i,
    twitterCard: /<meta\s+name="twitter:card"[\s\S]*?\/?>/i,
    twitterTitle: /<meta\s+name="twitter:title"[\s\S]*?\/?>/i,
    twitterDescription: /<meta\s+name="twitter:description"[\s\S]*?\/?>/i,
    canonical: /<link\s+rel="canonical"[\s\S]*?\/?>/i,
  };
  return html.replace(patterns[selector], replacement);
}

function renderPage(page) {
  const title = escapeAttribute(page.title);
  const description = escapeAttribute(page.description);
  const canonical = escapeAttribute(page.canonical);
  let html = template.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  html = replaceMeta(html, "description", `<meta name="description" content="${description}" />`);
  html = replaceMeta(html, "ogTitle", `<meta property="og:title" content="${title}" />`);
  html = replaceMeta(html, "ogDescription", `<meta property="og:description" content="${description}" />`);
  html = replaceMeta(html, "ogType", `<meta property="og:type" content="${page.type}" />`);
  html = replaceMeta(html, "ogUrl", `<meta property="og:url" content="${canonical}" />`);
  html = replaceMeta(
    html,
    "twitterCard",
    `<meta name="twitter:card" content="${page.image ? "summary_large_image" : "summary"}" />`,
  );
  html = replaceMeta(html, "twitterTitle", `<meta name="twitter:title" content="${title}" />`);
  html = replaceMeta(
    html,
    "twitterDescription",
    `<meta name="twitter:description" content="${description}" />`,
  );
  html = replaceMeta(html, "canonical", `<link rel="canonical" href="${canonical}" />`);

  if (page.image) {
    const image = escapeAttribute(page.image);
    const imageAlt = escapeAttribute(page.imageAlt || page.title);
    html = html.replace(
      "</head>",
      `    <meta property="og:image" content="${image}" />\n` +
        `    <meta property="og:image:alt" content="${imageAlt}" />\n` +
        `    <meta property="og:image:width" content="1200" />\n` +
        `    <meta property="og:image:height" content="630" />\n` +
        `    <meta name="twitter:image" content="${image}" />\n` +
        `    <meta name="twitter:image:alt" content="${imageAlt}" />\n  </head>`,
    );
  }

  if (page.markdown) {
    const articleHtml = marked.parse(page.markdown, { async: false, gfm: true });
    const coverHtml = page.image
      ? `<img src="${escapeAttribute(page.image)}" alt="${escapeAttribute(page.imageAlt)}" width="1200" height="630" decoding="async" />`
      : "";
    const breadcrumb = page.breadcrumb || { name: "Blog", path: "/blog" };
    const visibleContent = `<main class="seo-prerender"><nav aria-label="Breadcrumb"><a href="/">Home</a> / <a href="${escapeAttribute(breadcrumb.path)}">${escapeAttribute(breadcrumb.name)}</a></nav><article><h1>${escapeAttribute(page.headline)}</h1>${coverHtml}${articleHtml}</article></main>`;
    const prerenderStyles = `<style>.seo-prerender{box-sizing:border-box;max-width:860px;margin:auto;padding:24px 16px;font:16px/1.6 Arial,sans-serif;color:#2f2f2f;overflow-wrap:anywhere}.seo-prerender img{display:block;width:100%;height:auto;max-width:100%}.seo-prerender table{display:block;max-width:100%;overflow-x:auto}.seo-prerender a{color:#245c29}</style>`;
    html = html.replace("</head>", `${prerenderStyles}</head>`);
    const clearBeforePaint = '<script id="seo-prerender-clear">(function(){var root=document.getElementById("root");if(root)root.innerHTML="";})();</script>';
    html = html.replace('<div id="root"></div>', `<div id="root">${visibleContent}</div>${clearBeforePaint}`);
    const structuredData = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: page.headline,
      description: page.description,
      mainEntityOfPage: page.canonical,
      image: page.image,
      datePublished: page.publishedAt,
      author: { "@type": "Organization", name: "MySession Editorial" },
      publisher: { "@type": "Organization", name: "MySession", url: "https://mysession.club" },
    }).replaceAll("<", "\\u003c");
    html = html.replace("</head>", `    <script type="application/ld+json">${structuredData}</script>\n  </head>`);
  }

  return html;
}

for (const page of pages) {
  const outputDirectory = path.join(DIST_DIR, ...page.path.split("/"));
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "index.html"), renderPage(page), "utf8");
}

console.log(`[prerender-blog] Wrote ${pages.length} route-specific HTML files.`);
