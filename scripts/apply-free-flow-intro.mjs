import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const roomPath = path.join(root, 'src/pages/RoomPageLiveKit.tsx');
const cssPath = path.join(root, 'src/free-flow-intro.css');
const nextCssPath = path.join(root, 'scripts/free-flow-intro.next.css');

let source = fs.readFileSync(roomPath, 'utf8');

if (!source.includes('import FreeFlowIntroModal from "../components/FreeFlowIntroModal";')) {
  const importAnchor = 'import { UserProfileModal } from "../components/UserProfileModal";\n';
  if (!source.includes(importAnchor)) {
    throw new Error('Could not find UserProfileModal import anchor in RoomPageLiveKit.tsx');
  }
  source = source.replace(
    importAnchor,
    `${importAnchor}import FreeFlowIntroModal from "../components/FreeFlowIntroModal";\n`,
  );
}

source = source.replace(/\n\s*FREE_FLOW_TIMELINE_PRESETS,/, '');
source = source.replace(
  /\nimport \{ resolveStageVisual \} from "\.\.\/components\/SessionStageBar";/,
  '',
);

const startMarker = '        {freeFlowIntroOpen && (';
const endMarker = '        {selectedUser && (';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start >= 0 ? start : 0);

const replacement = `        <FreeFlowIntroModal
          open={freeFlowIntroOpen}
          theme={theme}
          onClose={() => setFreeFlowIntroOpen(false)}
          onBuildOwn={() => {
            window.localStorage.setItem(
              \`mysession:free-flow-intro:\${sessionId}:\${authUserId || "host"}\`,
              "seen",
            );
            setFreeFlowIntroOpen(false);
            setTimelineDraftBlocks(makeFreeFlowTimelineBlocks("30-10").slice(0, 1));
            setTimelineEditorOpen(true);
          }}
          onStartPreset={(presetId) => {
            window.localStorage.setItem(
              \`mysession:free-flow-intro:\${sessionId}:\${authUserId || "host"}\`,
              "seen",
            );
            setFreeFlowIntroOpen(false);
            setTimelineDraftBlocks(makeFreeFlowTimelineBlocks(presetId));
            setTimelineEditorOpen(true);
          }}
        />
`;

if (start >= 0 && end > start) {
  source = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
} else if (!source.includes('<FreeFlowIntroModal')) {
  throw new Error('Could not find the legacy Free Flow intro block in RoomPageLiveKit.tsx');
}

if (source.includes('FREE_FLOW_TIMELINE_PRESETS') || source.includes('resolveStageVisual')) {
  throw new Error('Legacy Free Flow picker imports/usages remain after patch');
}

fs.writeFileSync(roomPath, source);
fs.copyFileSync(nextCssPath, cssPath);

console.log('Free Flow modal integration applied.');
