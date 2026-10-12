import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";

const { build } = createRequire(createRequire(import.meta.url).resolve("vite/package.json"))("esbuild");
// Compile the isolated presenter from stdin: the repository has a pre-existing
// empty src/pages/package.json that esbuild's entrypoint discovery rejects.
const menuSource = readFileSync("src/pages/livekit/PreJoinMenus.tsx", "utf8");
const bundled = await build({ stdin: { contents: menuSource.replace('import "./prejoin-menus.css";', ""), loader: "tsx", resolveDir: process.cwd() }, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", write: false, logLevel: "silent" });
const compiled = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { PreJoinDeviceSelect, PreJoinDisclosure } = compiled.exports;
const modal = readFileSync("src/pages/livekit/PreJoinModalLiveKit.tsx", "utf8");
const css = readFileSync("src/pages/livekit/prejoin-menus.css", "utf8");

test("device dropdown keeps the selected label, accessible name and closed semantics", () => {
  const html = renderToStaticMarkup(createElement(PreJoinDeviceSelect, { id: "camera", label: "Camera", theme: "dark", value: "obs", options: [{ value: "", label: "Default" }, { value: "obs", label: "OBS Virtual Camera" }], onChange: () => {} }));
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-label="Camera"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /OBS Virtual Camera/);
  assert.match(html, /aria-hidden="true"/);
});
test("empty devices have a default fallback", () => {
  const html = renderToStaticMarkup(createElement(PreJoinDeviceSelect, { id: "mic", label: "Microphone", theme: "light", value: "gone", options: [], onChange: () => {} }));
  assert.match(html, /Default/);
  assert.match(html, /data-theme="light"/);
});
test("closed disclosures retain content for exit animation with hidden semantics", () => {
  const html = renderToStaticMarkup(createElement(PreJoinDisclosure, { open: false, id: "audio" }, "Echo cancellation"));
  assert.match(html, /data-open="false" aria-hidden="true"/);
  assert.match(html, /Echo cancellation/);
});
test("arrows have 16px inset and menus/disclosures animate with reduced-motion override", () => {
  assert.match(css, /padding: 0 16px/);
  assert.match(css, /rotate\(180deg\)/);
  assert.match(css, /opacity 160ms ease/);
  assert.match(css, /grid-template-rows 220ms ease/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
test("all three device selectors preserve parent state update contracts; Escape respects consumed events", () => {
  for (const field of ["audioInputId", "videoInputId", "audioOutputId"]) assert.ok(modal.includes(`onChange={(${field}) => onChange({ ...value, ${field} })}`));
  assert.equal((modal.match(/<PreJoinDeviceSelect /g) || []).length, 3);
  assert.match(modal, /e.key === "Escape" && !e.defaultPrevented/);
  assert.match(modal, /aria-controls="prejoin-audio-processing"/);
  assert.match(modal, /renderedBackgroundChoice === "custom"/);
});
