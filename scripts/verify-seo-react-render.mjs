import assert from "node:assert/strict";

// This is an SSR-only regression test, not a server-rendered product route.
// Production React avoids development-only warnings from MemoryRouter/Link.
process.env.NODE_ENV = "production";
const [{ createElement }, { renderToString }, { MemoryRouter }, { createServer }] = await Promise.all([
  import("react"),
  import("react-dom/server"),
  import("react-router-dom"),
  import("vite"),
]);

// Vite loads the same TSX and JSON modules used by the client. This catches
// route-prop contract errors that a successful bundling pass cannot detect.
const vite = await createServer({
  appType: "custom",
  logLevel: "error",
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true },
});

try {
  const [{ default: DataDrivenSeoPage }, { seoPages }] = await Promise.all([
    vite.ssrLoadModule("/src/pages/seo/DataDrivenSeoPage.tsx"),
    vite.ssrLoadModule("/src/data/seoPageRegistry.ts"),
  ]);

  for (const page of seoPages) {
    const html = renderToString(
      createElement(MemoryRouter, { initialEntries: [page.route] },
        createElement(DataDrivenSeoPage, { slug: page.slug })),
    );
    assert.match(html, /<h1\b/, `${page.route} did not render a heading`);
    assert.doesNotMatch(html, /Guide not found/, `${page.route} failed slug lookup`);
    assert.ok(html.length > 1000, `${page.route} rendered an unexpectedly empty page`);
  }

  console.log(`[seo:react-render] Rendered ${seoPages.length} data-driven SEO routes.`);
} finally {
  await vite.close();
}
