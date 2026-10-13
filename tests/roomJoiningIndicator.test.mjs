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
test("outer dots close in on the middle dot every 0.5s, flat colours", () => {
  const html = renderToStaticMarkup(createElement(Indicator, { theme: "dark" }));
  assert.equal((html.match(/attributeName="cx"/g) || []).length, 2);
  assert.equal((html.match(/attributeName="r"/g) || []).length, 1);
  assert.equal((html.match(/dur="0.5s"/g) || []).length, 3);
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
test("keyframe lists line up, stay symmetric, and reduced motion shows still dots", () => {
  const list = (name) => source.match(new RegExp(`const ${name} = "([^"]+)"`))[1].split(";");
  const times = list("KEY_TIMES").map(Number);
  for (const name of ["LEFT_X", "RIGHT_X", "MIDDLE_R"]) assert.equal(list(name).length, times.length, name);
  assert.deepEqual(list("LEFT_X").map((x) => -Number(x)), list("RIGHT_X").map(Number));
  assert.deepEqual([...times].sort((a, b) => a - b), times);
  assert.equal(times[0], 0);
  assert.equal(times.at(-1), 1);
  assert.equal(list("LEFT_X")[0], list("LEFT_X").at(-1));
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
