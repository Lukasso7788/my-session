import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';

// Check only this performance change, comparing existing diagnostics without
// suppressing errors in new files. Does not edit or restore user files.
const eslint = new ESLint();
const files = ['api/livekit/token.ts', 'src/components/ChatPanel.tsx', 'src/components/TasksPanel.tsx',
  'src/lib/roomSoundscapes.ts', 'src/pages/RoomPageLiveKit.tsx', 'src/pages/livekit/LiveKitBottomBar.tsx',
  'src/pages/livekit/PersonColorCorrectionProcessor.ts', 'src/pages/livekit/VideoTileLiveKit.tsx',
  'src/pages/livekit/VideoTileLiveKitLegacy.tsx', 'src/hooks/useLatestCallback.ts',
  'src/lib/chatMessageWindow.ts', 'src/lib/publishedColorCorrection.ts', 'src/lib/chatProfileLoader.ts', 'src/lib/tasksPanelCache.ts'];
let newErrors = 0, newWarnings = 0, baselineErrors = 0, currentErrors = 0;
for (const file of files) {
  const current = (await eslint.lintFiles([file]))[0];
  let old = '';
  try { old = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* New file: no baseline. */ }
  const baseline = (await eslint.lintText(old, { filePath: file }))[0];
  baselineErrors += baseline.errorCount;
  currentErrors += current.errorCount;
  const counts = new Map();
  for (const message of baseline.messages) {
    const key = message.ruleId + '|' + message.message;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const message of current.messages) {
    const key = message.ruleId + '|' + message.message;
    const left = counts.get(key) || 0;
    if (left) counts.set(key, left - 1);
    else {
      message.severity === 2 ? newErrors++ : newWarnings++;
      console.log(`${file}:${message.line} ${message.ruleId} ${message.message}`);
    }
  }
}
console.log(JSON.stringify({ baselineErrors, currentErrors, newErrors, newWarnings }));
process.exitCode = newErrors || newWarnings ? 1 : 0;
