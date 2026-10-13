import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";

const { build } = createRequire(createRequire(import.meta.url).resolve("vite/package.json"))("esbuild");
const source = readFileSync("src/components/RoomJoiningIndicator.tsx", "utf8");
const bundled = await build({ stdin: { contents: source.replace('import "./room-joining-indicator.css";', ""), loader: "tsx", resolveDir: process.cwd() }, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", write: false, logLevel: "silent" });
const compiled = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const Indicator = compiled.exports.default;
const css = readFileSync("src/components/room-joining-indicator.css", "utf8");
const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");

test("joining status is announced to screen readers while the dots are decorative", () => {
  const html = renderToStaticMarkup(createElement(Indicator, { theme: "dark" }));
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /ms-room-joining-accessible">Joining room…/);
  assert.match(html, /<svg class="ms-room-joining-dots"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /progressbar|aria-valuenow/);
});
test("both themes and custom status text are supported", () => {
  const html = renderToStaticMarkup(createElement(Indicator, { theme: "light", label: "Preparing your room" }));
  assert.match(html, /data-theme="light"/);
  assert.match(html, /Preparing your room/);
  assert.match(css, /--joining-ink: #ffffff/);
  assert.match(css, /--joining-ink: #2f2f2f/);
});
test("two dots swap places every 0.5s, back one shrinking and dimming, flat colours", () => {
  const html = renderToStaticMarkup(createElement(Indicator, { theme: "dark" }));
  assert.equal((html.match(/attributeName="cx"/g) || []).length, 3);
  assert.equal((html.match(/attributeName="r"/g) || []).length, 1);
  assert.equal((html.match(/attributeName="opacity"/g) || []).length, 1);
  assert.equal((html.match(/dur="0.5s"/g) || []).length, 5);
  assert.match(css, /ms-room-joining-dots,\s*\.ms-room-joining-still \{[^}]*width: 20px; height: 10px/);
  assert.match(css, /ms-room-joining-word \{ font-size: 16px;/);
  assert.match(css, /\.ms-room-joining circle \{ fill: var\(--joining-ink\); \}/);
  assert.doesNotMatch(source + css, /gradient|drop-shadow|box-shadow/i);
});
test("visible 'Loading' word animates letter by letter and is hidden from screen readers", () => {
  const html = renderToStaticMarkup(createElement(Indicator, { theme: "dark" }));
  assert.match(html, /<span class="ms-room-joining-word" aria-hidden="true">/);
  const visible = html.replace(/<span class="ms-room-joining-accessible">[^<]*<\/span>/, "").replace(/<[^>]+>/g, "");
  assert.equal(visible.trim(), "Loading");
  assert.equal((html.match(/animation-delay:/g) || []).length, 7);
  assert.match(css, /ms-room-joining-letter 1\.4s ease-in-out infinite/);
});
test("tracks have one value per reference frame, loop seamlessly, and reduced motion shows still dots", () => {
  const list = (name) => source.match(new RegExp(`const ${name} = "([^"]+)"`))[1].split(";").map(Number);
  for (const name of ["FRONT_X", "BACK_X", "BACK_R", "BACK_OPACITY", "MIDDLE_X"]) assert.equal(list(name).length, 16, name);
  // The front dot ends where the back dot starts (and vice versa), so the swap is invisible at the loop.
  assert.equal(list("FRONT_X").at(-1), list("BACK_X")[0]);
  assert.equal(list("BACK_X").at(-1), list("FRONT_X")[0]);
  assert.equal(list("BACK_R")[0], list("BACK_R").at(-1));
  assert.equal(list("MIDDLE_X")[0], list("MIDDLE_X").at(-1));
  assert.ok(Math.min(...list("BACK_OPACITY")) < 0.8, "back dot dims while it passes behind");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*ms-room-joining-dots \{ display: none; \}[\s\S]*ms-room-joining-still \{ display: block; \}/);
  assert.doesNotMatch(source, /useEffect|setTimeout|fetch\(|Math\.random/);
});
test("real room integration retains the existing joining condition and error surface", () => {
  assert.match(room, /const roomReadyText = connected\s*\? ""\s*: prejoinOpen\s*\? ""\s*: joinRequested\s*\?[\s\S]*?"Joining room…"\s*: ""/);
  assert.match(room, /\{roomReadyText \? \([\s\S]*?<RoomJoiningIndicator theme=\{theme\} label=\{roomReadyText\}/);
  // A slow-connection retry stays visible under the loader.
  assert.match(room, /connectRetryAttempt > 1 \? <p className="text-\[13px\]" aria-hidden="true">\{roomReadyText\}<\/p> : null/);
  assert.match(room, /\{lastErr && \(/);
});
