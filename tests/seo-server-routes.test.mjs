import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { routes } = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url)));
const redirects = routes.filter(r => r.status === 308);
const ruleFor = p => routes.find(r => r.src && new RegExp(`^(?:${r.src})$`).test(p));
test('legacy paths use permanent redirects before SPA fallback, preserving real destinations', async () => {
  for (const r of redirects) {
    assert.ok(routes.indexOf(r) < routes.findIndex(r => r.handle === 'filesystem'));
    const target = r.headers.Location;
    assert.notEqual(target, '/');
    assert.equal(ruleFor(target)?.status, undefined, `redirect chain to ${target}`);
    const html = await readFile(new URL(`../dist${target}/index.html`, import.meta.url), 'utf8');
    assert.ok(html.includes(`href="https://mysession.club${target}"`));
    assert.match(html, /<h1\b/);
  }
});
test('retired status URL returns 404 while application paths retain SPA routing', async () => {
  assert.equal(ruleFor('/status').status, 404);
  assert.equal(ruleFor('/status/').status, 404);
  assert.equal(ruleFor('/room-livekit/example').dest, '/index.html');
  assert.equal(ruleFor('/auth/callback').dest, '/index.html');
  assert.equal(ruleFor('/sessions').dest, '/index.html');
  const html = await readFile(new URL('../dist/404.html', import.meta.url), 'utf8');
  assert.match(html, /noindex,follow/);
  assert.doesNotMatch(html, /rel="canonical"/);
});
