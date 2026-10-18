// Render the actual public components so raw HTML matches the visible page.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'production';
const [{ createElement }, { renderToString }, { MemoryRouter }, { createServer }] = await Promise.all([
  import('react'), import('react-dom/server'), import('react-router-dom'), import('vite'),
]);
const vite = await createServer({ appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true } });
const entries = [
  ['/contact', 'ContactPage', 'Contact Information | MySession', 'Contact MySession support and find seller details.'],
  ['/rules', 'RulesPage', 'Community Rules | MySession', 'Read the community rules for MySession focus rooms.'],
  ['/terms', 'Terms', 'Terms and Conditions | MySession', 'Read the terms and conditions for using MySession.'],
  ['/privacy', 'PrivacyPage', 'Privacy Policy | MySession', 'Read how MySession collects, uses, and protects information.'],
  ['/refund-policy', 'RefundPolicyPage', 'Refund Policy | MySession', 'Read the MySession refund policy for purchases and refund requests.'],
  ['/group-focus-sessions', 'seo/GroupFocusSessionsPage'],
  ['/silent-coworking', 'seo/SilentCoworkingPage'],
  ['/adhd-productivity', 'seo/AdhdProductivityPage'],
];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const template = await readFile('dist/index.html', 'utf8');
try {
  for (const [route, component, explicitTitle, explicitDescription] of entries) {
    const { default: Page } = await vite.ssrLoadModule(`/src/pages/${component}.tsx`);
    // SEO wrappers are pure components returning SeoPageTemplate; use their existing copy.
    const props = component.startsWith('seo/') ? Page().props : {};
    const title = explicitTitle || `${props.pageTitle} | MySession`;
    const description = explicitDescription || props.metaDescription;
    const canonical = `https://mysession.club${route}`;
    const content = renderToString(createElement(MemoryRouter, { initialEntries: [route] }, createElement(Page)));
    assert.equal((content.match(/<h1\b/g) || []).length, 1, `${route}: expected one H1`);
    assert.ok(content.length > 1000, `${route}: unexpectedly empty HTML`);
    let html = template
      .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escape(title)}</title>`)
      .replace(/<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${escape(description)}">`)
      .replace(/<link\s+rel="canonical"[^>]*>/i, `<link rel="canonical" href="${canonical}">`)
      .replace(/<meta\s+property="og:title"[^>]*>/i, `<meta property="og:title" content="${escape(title)}">`)
      .replace(/<meta\s+property="og:description"[^>]*>/i, `<meta property="og:description" content="${escape(description)}">`)
      .replace(/<meta\s+property="og:url"[^>]*>/i, `<meta property="og:url" content="${canonical}">`)
      .replace(/<meta\s+name="twitter:title"[^>]*>/i, `<meta name="twitter:title" content="${escape(title)}">`)
      .replace(/<meta\s+name="twitter:description"[^>]*>/i, `<meta name="twitter:description" content="${escape(description)}">`)
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
    // The homepage is already prerendered; replace its whole root up to its handoff script.
    html = html.replace(/<div id="root">[\s\S]*?(?=<script id="seo-prerender-clear">)/, `<div id="root">${content}</div>`);
    assert.ok(html.includes(content), `${route}: failed to replace root`);
    assert.ok(html.includes(`href="${canonical}"`));
    const output = path.join('dist', route.slice(1));
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'index.html'), html);
    console.log(`[seo:existing] ${route}: actual component content, one H1, self-canonical`);
  }
} finally { await vite.close(); }
