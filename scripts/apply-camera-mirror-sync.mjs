import fs from "node:fs";

const ROOT = process.cwd();

function read(path) {
  return fs.readFileSync(`${ROOT}/${path}`, "utf8");
}

function write(path, content) {
  fs.writeFileSync(`${ROOT}/${path}`, content);
}

function replaceOnce(content, from, to, label) {
  const first = content.indexOf(from);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  const second = content.indexOf(from, first + from.length);
  if (second >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
  return content.slice(0, first) + to + content.slice(first + from.length);
}

function replaceAllChecked(content, from, to, expectedCount, label) {
  const parts = content.split(from);
  const count = parts.length - 1;
  if (count !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} matches, found ${count}`);
  }
  return parts.join(to);
}

// ---------------------------------------------------------------------------
// RoomPageLiveKit: persist the user's mirror preference, publish it through
// LiveKit participant metadata, and render every participant using their own
// preference. The video track itself remains untouched; this is presentation
// metadata, so changing it is instant and does not restart the camera.
// ---------------------------------------------------------------------------
{
  const path = "src/pages/RoomPageLiveKit.tsx";
  let s = read(path);

  s = replaceOnce(
    s,
    `  isLocal: boolean;\n\n  videoTrack?: Track;`,
    `  isLocal: boolean;\n  mirrorVideo?: boolean;\n\n  videoTrack?: Track;`,
    "TileModel mirrorVideo",
  );

  s = replaceOnce(
    s,
    `      a.isLocal === b.isLocal &&\n      a.videoTrack === b.videoTrack &&`,
    `      a.isLocal === b.isLocal &&\n      a.mirrorVideo === b.mirrorVideo &&\n      a.videoTrack === b.videoTrack &&`,
    "tile equality mirrorVideo",
  );

  s = replaceOnce(
    s,
    `function getStatusFromMetadata(raw: unknown): string | null {\n  const meta = parseParticipantMetadata(raw);\n  if (!meta) return null;\n\n  const status = String(meta.status || \"\").trim();\n  return status || null;\n}\n\nfunction getTimeZoneFromParticipantMetadata(raw: unknown): string {`,
    `function getStatusFromMetadata(raw: unknown): string | null {\n  const meta = parseParticipantMetadata(raw);\n  if (!meta) return null;\n\n  const status = String(meta.status || \"\").trim();\n  return status || null;\n}\n\nfunction getCameraMirroredFromParticipantMetadata(\n  raw: unknown,\n  fallback = false,\n): boolean {\n  const meta = parseParticipantMetadata(raw);\n  if (!meta) return fallback;\n\n  const value = meta.cameraMirrored ?? meta.camera_mirrored;\n  if (typeof value === \"boolean\") return value;\n  if (typeof value === \"string\") {\n    const normalized = value.trim().toLowerCase();\n    if (normalized === \"true\") return true;\n    if (normalized === \"false\") return false;\n  }\n\n  return fallback;\n}\n\nfunction getTimeZoneFromParticipantMetadata(raw: unknown): string {`,
    "participant mirror metadata helper",
  );

  s = replaceOnce(
    s,
    `      status: localParticipantStatus,\n      isLocal: true,\n      videoTrack: localCamTrack,`,
    `      status: localParticipantStatus,\n      isLocal: true,\n      mirrorVideo: getCameraMirroredFromParticipantMetadata(\n        (lp as any)?.metadata,\n        previewMirrored,\n      ),\n      videoTrack: localCamTrack,`,
    "local tile mirror",
  );

  s = replaceOnce(
    s,
    `        status: participantStatus,\n        isLocal: false,\n        videoTrack: vt,`,
    `        status: participantStatus,\n        isLocal: false,\n        mirrorVideo: getCameraMirroredFromParticipantMetadata(\n          (rp as any)?.metadata,\n          false,\n        ),\n        videoTrack: vt,`,
    "remote tile mirror",
  );

  s = replaceAllChecked(
    s,
    `mirrorVideo={t.isLocal ? previewMirrored : false}`,
    `mirrorVideo={!!t.mirrorVideo}`,
    2,
    "main/PiP tile mirror render",
  );

  s = replaceAllChecked(
    s,
    `mirrorVideo={tile.isLocal}`,
    `mirrorVideo={!!tile.mirrorVideo}`,
    1,
    "accountability tile mirror render",
  );

  s = replaceOnce(
    s,
    `  useEffect(() => {\n    if (!connected) return;\n\n    const room = roomRef.current;\n    const profileTimeZone = String(\n      localProfileTimeZone || localProfileTimeZoneRef.current || \"\",\n    ).trim();`,
    `  useEffect(() => {\n    if (!connected) return;\n\n    const room = roomRef.current;\n    if (!room?.localParticipant) return;\n\n    let cancelled = false;\n\n    const publishCameraMirrorPreference = async () => {\n      // Other room metadata (timezone/status/tasks) can be written immediately\n      // after connect. Re-read metadata after a short yield so this merge does\n      // not overwrite another just-published field.\n      await delay(80);\n      if (cancelled) return;\n\n      try {\n        const currentMetadata =\n          parseParticipantMetadata(room.localParticipant.metadata) || {};\n        const currentRaw =\n          currentMetadata.cameraMirrored ?? currentMetadata.camera_mirrored;\n        const hasExplicitMirror =\n          typeof currentRaw === \"boolean\" ||\n          (typeof currentRaw === \"string\" &&\n            [\"true\", \"false\"].includes(currentRaw.trim().toLowerCase()));\n        const currentMirror = getCameraMirroredFromParticipantMetadata(\n          room.localParticipant.metadata,\n          previewMirrored,\n        );\n\n        if (hasExplicitMirror && currentMirror === previewMirrored) {\n          scheduleRebuildTiles();\n          return;\n        }\n\n        await room.localParticipant.setMetadata(\n          JSON.stringify({\n            ...currentMetadata,\n            cameraMirrored: previewMirrored,\n          }),\n        );\n\n        if (!cancelled) {\n          scheduleRebuildTiles();\n          window.setTimeout(() => scheduleRebuildTiles(), 80);\n          window.setTimeout(() => scheduleRebuildTiles(), 220);\n        }\n      } catch (error) {\n        console.warn(\"[room] camera mirror metadata sync failed\", error);\n      }\n    };\n\n    void publishCameraMirrorPreference();\n\n    return () => {\n      cancelled = true;\n    };\n  }, [connected, previewMirrored]);\n\n  useEffect(() => {\n    if (!connected) return;\n\n    const room = roomRef.current;\n    const profileTimeZone = String(\n      localProfileTimeZone || localProfileTimeZoneRef.current || \"\",\n    ).trim();`,
    "publish camera mirror metadata",
  );

  s = replaceOnce(
    s,
    `          }}\n          videoFxMode={videoFxMode}\n          blurStrength={blurStrength}\n          onBlurStrengthChange={setBlurStrength}\n          backgroundPresets={FX_BG_PRESETS}`,
    `          }}\n          cameraMirrored={previewMirrored}\n          onToggleCameraMirrored={setPreviewMirrored}\n          videoFxMode={videoFxMode}\n          blurStrength={blurStrength}\n          onBlurStrengthChange={setBlurStrength}\n          backgroundPresets={FX_BG_PRESETS}`,
    "bottom bar mirror props",
  );

  write(path, s);
}

// ---------------------------------------------------------------------------
// Video tile: mirror is a participant preference, not a local-only rule.
// Screen-share tiles never set mirrorVideo and therefore remain unmirrored.
// ---------------------------------------------------------------------------
{
  const path = "src/pages/livekit/VideoTileLiveKitLegacy.tsx";
  let s = read(path);

  s = replaceOnce(
    s,
    `    mirrorVideo = true,`,
    `    mirrorVideo = false,`,
    "safe mirror default",
  );

  s = replaceOnce(
    s,
    `            el.style.transform = isLocal\n                ? mirrorVideo\n                    ? \"translateZ(0) scaleX(-1)\"\n                    : \"translateZ(0) scaleX(1)\"\n                : \"translateZ(0)\";`,
    `            el.style.transform = mirrorVideo\n                ? \"translateZ(0) scaleX(-1)\"\n                : \"translateZ(0) scaleX(1)\";`,
    "shared mirror transform",
  );

  write(path, s);
}

// ---------------------------------------------------------------------------
// Camera dropdown (camera on): expose Mirror camera next to camera/background.
// ---------------------------------------------------------------------------
{
  const path = "src/pages/livekit/LiveKitBottomBarLegacy.tsx";
  let s = read(path);

  s = replaceOnce(
    s,
    `    onChangeVideoInput?: (deviceId: string) => void | Promise<void>;\n    videoFxMode?: \"off\" | \"blur\" | \"bg\";`,
    `    onChangeVideoInput?: (deviceId: string) => void | Promise<void>;\n    cameraMirrored?: boolean;\n    onToggleCameraMirrored?: (mirrored: boolean) => void;\n    videoFxMode?: \"off\" | \"blur\" | \"bg\";`,
    "bottom bar mirror prop types",
  );

  s = replaceOnce(
    s,
    `        onChangeVideoInput,\n        videoFxMode = \"off\",`,
    `        onChangeVideoInput,\n        cameraMirrored = true,\n        onToggleCameraMirrored,\n        videoFxMode = \"off\",`,
    "bottom bar mirror prop destructure",
  );

  s = replaceOnce(
    s,
    `                                    </div>\n                                    {!backgroundFxDisabled && onApplyVideoFx ? (`,
    `                                    </div>\n                                    {onToggleCameraMirrored ? (\n                                        <>\n                                            <div className={\`mx-2 my-2 h-px \${isLight ? \"bg-black/10\" : \"bg-white/10\"}\`} />\n                                            <button\n                                                type=\"button\"\n                                                onClick={() => onToggleCameraMirrored(!cameraMirrored)}\n                                                className={\`flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[12px] transition \${menuItem}\`}\n                                                aria-pressed={cameraMirrored}\n                                                title=\"Flip your camera horizontally for you and everyone in the room\"\n                                            >\n                                                <span>Mirror camera</span>\n                                                <span\n                                                    className={\`relative inline-flex h-5 w-9 shrink-0 rounded-full transition \${cameraMirrored ? \"bg-[#5286F6]\" : isLight ? \"bg-black/15\" : \"bg-white/20\"}\`}\n                                                    aria-hidden=\"true\"\n                                                >\n                                                    <span\n                                                        className={\`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform \${cameraMirrored ? \"translate-x-[18px]\" : \"translate-x-0.5\"}\`}\n                                                    />\n                                                </span>\n                                            </button>\n                                        </>\n                                    ) : null}\n                                    {!backgroundFxDisabled && onApplyVideoFx ? (`,
    "camera menu mirror toggle",
  );

  write(path, s);
}

// ---------------------------------------------------------------------------
// Private camera preview (camera off): the same setting must be visible and
// editable here too, and the preview must immediately reflect the choice.
// ---------------------------------------------------------------------------
{
  const path = "src/pages/livekit/LiveKitBottomBar.tsx";
  let s = read(path);

  s = replaceOnce(
    s,
    `export function LiveKitBottomBar(props: LegacyProps) {\n    const initialBlur = Number(props.blurStrength || 12);`,
    `export function LiveKitBottomBar(props: LegacyProps) {\n    const initialBlur = Number(props.blurStrength || 12);\n    const cameraMirrored = props.cameraMirrored ?? true;`,
    "private preview mirror state",
  );

  s = replaceOnce(
    s,
    `                            className=\"h-full w-full scale-x-[-1] object-cover\"\n                        />`,
    `                            className=\"h-full w-full object-cover\"\n                            style={{\n                                transform: cameraMirrored ? \"scaleX(-1)\" : \"scaleX(1)\",\n                            }}\n                        />`,
    "private preview transform",
  );

  s = replaceOnce(
    s,
    `                    </div>\n\n                    {!props.backgroundFxDisabled && props.onApplyVideoFx ? (`,
    `                    </div>\n\n                    {props.onToggleCameraMirrored ? (\n                        <button\n                            type=\"button\"\n                            onClick={() => props.onToggleCameraMirrored?.(!cameraMirrored)}\n                            className={\`mt-2.5 flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[11px] font-medium transition \${props.isLight ? \"bg-black/[0.035] hover:bg-black/[0.07]\" : \"bg-white/[0.055] hover:bg-white/[0.09]\"}\`}\n                            aria-pressed={cameraMirrored}\n                        >\n                            <span>\n                                <span className=\"block font-semibold\">Mirror camera</span>\n                                <span className={\`mt-0.5 block text-[9px] font-normal \${previewSubtle}\`}>\n                                    This orientation is shown to everyone when your camera is on.\n                                </span>\n                            </span>\n                            <span\n                                className={\`relative inline-flex h-5 w-9 shrink-0 rounded-full transition \${cameraMirrored ? \"bg-[#5286F6]\" : props.isLight ? \"bg-black/15\" : \"bg-white/20\"}\`}\n                                aria-hidden=\"true\"\n                            >\n                                <span\n                                    className={\`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform \${cameraMirrored ? \"translate-x-[18px]\" : \"translate-x-0.5\"}\`}\n                                />\n                            </span>\n                        </button>\n                    ) : null}\n\n                    {!props.backgroundFxDisabled && props.onApplyVideoFx ? (`,
    "private preview mirror control",
  );

  write(path, s);
}

// ---------------------------------------------------------------------------
// Full Room Settings: this setting is no longer merely a local preview option.
// ---------------------------------------------------------------------------
{
  const path = "src/pages/livekit/RoomSettingsModalLiveKit.tsx";
  let s = read(path);

  s = replaceOnce(
    s,
    `                                label=\"Mirror camera preview\"\n                                description=\"Flip your local preview horizontally like a typical selfie view.\"`,
    `                                label=\"Mirror camera\"\n                                description=\"Flip your camera horizontally for you and everyone in the room.\"`,
    "room settings mirror copy",
  );

  write(path, s);
}

console.log("Camera mirror sync patch applied successfully.");
