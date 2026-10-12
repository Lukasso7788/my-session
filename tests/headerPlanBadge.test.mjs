import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";

// Use the app's Vite compiler, not the older root esbuild used by legacy tests.
const { build } = createRequire(createRequire(import.meta.url).resolve("vite/package.json"))("esbuild");

const bundled = await build({ entryPoints: ["src/components/HeaderPlanBadge.tsx"], bundle: true, platform: "node", format: "esm", jsx: "automatic", write: false, logLevel: "silent" });
const { default: HeaderPlanBadge } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const noop = () => {};
const props = { label: "FM Pro", open: true, title: "Founding Member Pro", description: "Free permanent Pro access as a founding member. No subscription or renewal payments.", onBadgeClick: noop, onActionClick: noop, onOpen: noop, onClose: noop };

test("nowrap is restricted to the badge; popover text wraps within a bounded card", () => {
  const html = renderToStaticMarkup(createElement(HeaderPlanBadge, props));
  assert.equal((html.match(/whitespace-nowrap/g) || []).length, 1);
  assert.match(html, /<button[^>]*class="[^"]*whitespace-nowrap/);
  assert.match(html, /w-\[220px\].*max-w-\[calc\(100vw-24px\)\].*whitespace-normal/);
  assert.match(html, /break-words/);
  assert.match(html, /aria-label="Plan details"/);
});

test("badge has the requested small overlap, and closed state has no popover", () => {
  const html = renderToStaticMarkup(createElement(HeaderPlanBadge, { ...props, open: false }));
  assert.match(html, /left-\[calc\(100%-4px\)\]/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Plan details|Manage subscription/);
});

test("membership actions and hover handlers remain owned by the caller", () => {
  const events = [];
  const rendered = HeaderPlanBadge({ ...props, onBadgeClick: () => events.push("badge"), onActionClick: () => events.push("action"), onOpen: () => events.push("open"), onClose: () => events.push("close") });
  rendered.props.onMouseEnter();
  rendered.props.children[0].props.onClick();
  rendered.props.children[1].props.children.props.children[2].props.onClick();
  rendered.props.onMouseLeave();
  assert.deepEqual(events, ["open", "badge", "action", "close"]);
  const free = renderToStaticMarkup(createElement(HeaderPlanBadge, { ...props, label: "Free" }));
  assert.match(free, /Upgrade to Pro/);
  assert.doesNotMatch(free, /Manage subscription/);
});
