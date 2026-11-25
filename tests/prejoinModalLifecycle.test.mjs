import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const source = readFileSync("src/pages/livekit/PreJoinModalLiveKit.tsx", "utf8");
const bundled = await build({
  stdin: { contents: source, loader: "tsx", resolveDir: process.cwd() },
  bundle: true,
  packages: "external",
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  write: false,
  logLevel: "silent",
  plugins: [{
    name: "isolate-prejoin-lifecycle",
    setup(build) {
      build.onResolve({ filter: /^\.\/(PreJoinMenus|LiveKitUI|prejoin-compact\.css)$/ },
        ({ path }) => ({ path, namespace: "presenter-stub" }));
      build.onLoad({ filter: /.*/, namespace: "presenter-stub" }, () => ({
        contents: "export const Icon = () => null; export const PreJoinDeviceSelect = () => null; export const PreJoinDisclosure = () => null;",
      }));
    },
  }],
});

test("closed prejoin effects run safely while room authentication loads", () => {
  const effects = [];
  const reactWithEffects = { ...React, useEffect: (effect) => effects.push(effect) };
  const compiled = { exports: {} };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(
    (name) => name === "react" ? reactWithEffects : require(name),
    compiled, compiled.exports,
  );

  const html = renderToStaticMarkup(React.createElement(compiled.exports.PreJoinModal, {
    open: false,
    theme: "light",
    devices: [],
    value: { videoEnabled: false },
    videoFxMode: "off",
    blurStrength: 10,
    fxBgPresets: [],
  }));

  assert.equal(html, "");
  assert.ok(effects.length > 0, "Exercise lifecycle effects as well as rendering");
  for (const effect of effects) assert.doesNotThrow(effect);
});
