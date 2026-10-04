import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("community pages remain routable without appearing in the header", () => {
  const header = readFileSync(new URL("../src/components/Header.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  for (const route of ["hosts", "leaderboard"]) {
    assert.doesNotMatch(header, new RegExp(`(?:navigate|href|to)\\s*[=(]\\s*["']/${route}["']`));
    assert.match(app, new RegExp(`<Route path="/${route}"`));
  }
});
