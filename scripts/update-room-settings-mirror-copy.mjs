import fs from "node:fs";

const path = "src/pages/livekit/RoomSettingsModalLiveKit.tsx";
let source = fs.readFileSync(path, "utf8");

const replacements = [
  ['label="Mirror camera preview"', 'label="Mirror camera"'],
  [
    'description="Flip your local preview horizontally like a typical selfie view."',
    'description="Flip your camera horizontally for you and everyone in the room."',
  ],
];

for (const [from, to] of replacements) {
  const count = source.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`Expected exactly one match for ${from}, found ${count}`);
  }
  source = source.replace(from, to);
}

fs.writeFileSync(path, source);
console.log("Room Settings mirror copy updated.");
