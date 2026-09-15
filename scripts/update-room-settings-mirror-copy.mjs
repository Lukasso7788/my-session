import fs from "node:fs";

const path = "src/pages/livekit/RoomSettingsModalLiveKit.tsx";
let source = fs.readFileSync(path, "utf8");

const from = `                                label="Mirror camera preview"\n                                description="Flip your local preview horizontally like a typical selfie view."`;
const to = `                                label="Mirror camera"\n                                description="Flip your camera horizontally for you and everyone in the room."`;

const count = source.split(from).length - 1;
if (count !== 1) {
  throw new Error(`Expected one Room Settings mirror copy block, found ${count}`);
}

source = source.replace(from, to);
fs.writeFileSync(path, source);
console.log("Room Settings mirror copy updated.");
