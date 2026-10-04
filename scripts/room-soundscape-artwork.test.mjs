import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ROOM_SOUNDSCAPE_OPTIONS } from "../src/lib/roomSoundscapes.ts";

test("built-in soundscapes have distinct, available vector artwork", () => {
  const artworkPaths = ROOM_SOUNDSCAPE_OPTIONS.map((option) => option.artwork);
  assert.equal(new Set(artworkPaths).size, artworkPaths.length);

  for (const option of ROOM_SOUNDSCAPE_OPTIONS) {
    assert.match(option.artwork, /^\/images\/room-music\/[\w-]+\.svg$/);
    const svg = readFileSync(new URL(`../public${option.artwork}`, import.meta.url), "utf8");
    assert.match(svg, /viewBox="0 0 480 150"/);
  }

  assert.equal(
    ROOM_SOUNDSCAPE_OPTIONS.find((option) => option.id === "brown-noise")?.artwork,
    "/images/room-music/brown-noise.svg",
  );
  assert.equal(
    ROOM_SOUNDSCAPE_OPTIONS.find((option) => option.id === "downtown-flow")?.artwork,
    "/images/room-music/downtown-flow.svg",
  );
});
