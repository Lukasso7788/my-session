import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIST_DIR = path.resolve("dist");
const template = await readFile(path.join(DIST_DIR, "index.html"), "utf8");

const pages = [
  {
    path: "blog",
    title: "MySession Blog | Body Doubling and Focus Guides",
    description:
      "Practical guides to virtual coworking, body doubling, focus sessions, accountability, and building a repeatable work routine.",
    canonical: "https://mysession.club/blog",
    type: "website",
  },
  {
    path: "blog/best-focusmate-alternatives",
    title: "Focusmate Alternative for Group Focus Rooms | MySession",
    description:
      "Looking for a Focusmate alternative? Compare scheduled 1:1 body doubling with MySession group sessions and 24/7 focus rooms.",
    canonical: "https://mysession.club/blog/best-focusmate-alternatives",
    type: "article",
    image:
      "https://mysession.club/blog/focusmate-alternatives/focusmate-alternative-cover.jpg",
    imageAlt:
      "Three colleagues working together around laptops and documents at a shared office desk",
  },
];

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

  return html;
}

for (const page of pages) {
  const outputDirectory = path.join(DIST_DIR, ...page.path.split("/"));
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "index.html"), renderPage(page), "utf8");
}

console.log(`[prerender-blog] Wrote ${pages.length} route-specific HTML files.`);
