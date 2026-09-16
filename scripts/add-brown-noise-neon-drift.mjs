import fs from "node:fs";

const path = "src/lib/roomSoundscapes.ts";
let source = fs.readFileSync(path, "utf8");

if (!source.includes('| "brown-noise"')) {
  source = source.replace(
    '  | "fireplace"\n  | "custom";',
    '  | "fireplace"\n  | "brown-noise"\n  | "neon-drift"\n  | "custom";',
  );
}

if (!source.includes('id: "brown-noise"')) {
  const anchor = `  {\n    id: "fireplace",\n    label: "Fireplace",\n    description: "A low fire with natural crackle",\n    file: "/sounds/room-music/fireplace.mp3",\n    icon: "/icons/music-fireplace.svg",\n    artwork: "/images/room-music/campfire.svg",\n    durationSeconds: 30,\n  },\n];`;

  const replacement = `  {\n    id: "fireplace",\n    label: "Fireplace",\n    description: "A low fire with natural crackle",\n    file: "/sounds/room-music/fireplace.mp3",\n    icon: "/icons/music-fireplace.svg",\n    artwork: "/images/room-music/campfire.svg",\n    durationSeconds: 30,\n  },\n  {\n    id: "brown-noise",\n    label: "Brown Noise",\n    description: "Deep low-frequency noise for steady focus",\n    file: "/sounds/room-music/brown-noise.mp3",\n    icon: "/icons/music-brown-noise.svg",\n    artwork: "/images/room-music/flow-relax.svg",\n    durationSeconds: 420,\n  },\n  {\n    id: "neon-drift",\n    label: "Neon Drift",\n    description: "Progressive ambient trance for sustained focus",\n    file: "/sounds/room-music/neon-drift.mp3",\n    icon: "/icons/music-neon-drift.svg",\n    artwork: "/images/room-music/ambient-focus.svg",\n    durationSeconds: 428,\n  },\n];`;

  if (!source.includes(anchor)) {
    throw new Error("Could not find fireplace soundtrack anchor");
  }
  source = source.replace(anchor, replacement);
}

fs.writeFileSync(path, source);
console.log("Brown Noise and Neon Drift added to roomSoundscapes.ts");
