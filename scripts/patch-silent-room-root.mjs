import fs from "node:fs";

const path = "src/pages/RoomPageLiveKit.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Patch anchor not found: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Patch anchor is ambiguous: ${label}`);
  }
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
`  // Timeline/stage bar must be driven only by the actual schedule/stages.\n  // Do not auto-hide or stop it based on session title/format/template text like "silent".\n  const isSilentRoom = false;`,
`  const isSilentRoom = useMemo(() => {\n    let schedule: any = session?.schedule;\n    if (typeof schedule === "string") {\n      try {\n        schedule = JSON.parse(schedule);\n      } catch {\n        schedule = null;\n      }\n    }\n\n    const variant = String(schedule?.variant || "").trim().toLowerCase();\n    const scheduleMicLocked = schedule?.room_policies?.microphone_locked === true;\n    const sessionMicLocked = (session as any)?.microphone_locked === true;\n    const slug = String((session as any)?.custom_slug || "").trim().toLowerCase();\n    const title = String(session?.title || "").trim().toLowerCase();\n\n    return (\n      variant === "silent_cameras_on" ||\n      scheduleMicLocked ||\n      sessionMicLocked ||\n      slug === "silentroom" ||\n      title === "🤫 silent room - 24/7" ||\n      title === "silent · cameras on 24/7"\n    );\n  }, [session]);`,
  "silent room detection",
);

replaceOnce(
`  const canEditRoomTimeline = isHost || isTemporaryRoomHost;`,
`  const canEditRoomTimeline = (isHost || isTemporaryRoomHost) && !isSilentRoom;`,
  "timeline edit permission",
);

fs.writeFileSync(path, source);
console.log("Silent room root behavior patch applied.");
