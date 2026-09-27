// Isolated actual-component verification: no real Supabase/API credentials,
// production writes or changes to the normal Vite configuration.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const mockId = '\0room-performance-mock';
const harnessId = '\0room-performance-harness';
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ChatPanel } from '/src/components/ChatPanel.tsx';
import TasksPanel from '/src/components/TasksPanel.tsx';
import { makeFreeFlowTimelineBlocks, timelineBlocksToSchedulePayload } from '/src/lib/roomTimelineModel.ts';
import { control, sessionId, userId, hostId } from 'room-performance-mock';
import '/src/index.css';
const h = React.createElement;
const TimelineEditor = React.lazy(() => import('/src/components/RoomTimelineEditor.tsx'));
const SoundscapePanel = React.lazy(() => import('/src/pages/livekit/RoomSoundscapePanel.tsx'));
const partialHost = { id: hostId, full_name: 'Host', avatar_url: null };
function Harness() {
  const [mounted, setMounted] = useState(true);
  const [panel, setPanel] = useState('chat');
  const [mode, setMode] = useState('general');
  const [tick, setTick] = useState(0);
  const [taskUser, setTaskUser] = useState(userId);
  const [taskRoom, setTaskRoom] = useState(sessionId);
  const [blocks, setBlocks] = useState(() => makeFreeFlowTimelineBlocks('30-10'));
  const [track, setTrack] = useState(null);
  const [playing, setPlaying] = useState(false);
  const button = (text, onClick) => h('button', { onClick, style: { padding: 12, border: '1px solid #ccc' } }, text);
  control.unmount = () => setMounted(false);
  control.mount = () => setMounted(true);
  control.showTasks = () => { setPanel('tasks'); setMounted(true); };
  control.changeTaskScope = (uid, sid) => { setTaskUser(uid); setTaskRoom(sid); };
  control.showTimeline = () => { setPanel('timeline'); setMounted(true); };
  control.showMusic = () => { setPanel('music'); setMounted(true); };
  control.panelActions ||= [];
  const close = () => setMounted(false);
  return h('main', { style: { padding: 24 } },
    h('h1', null, 'Room performance test — mock data only'),
    h('nav', null, button('Chat', () => setPanel('chat')), button('Tasks', () => setPanel('tasks')),
      button('Unmount', () => setMounted(false)), button('Mount', () => setMounted(true)),
      button('Parent rerender', () => setTick(tick + 1)),
      button('General chat', () => setMode('general')), button('Direct chat', () => setMode('host'))),
    h('p', null, 'Render: ' + tick),
    h('section', { style: { width: 480, height: 670, border: '1px solid #ddd', marginTop: 16 } },
      !mounted ? h('p', null, 'Unmounted') : panel === 'chat' ?
        h(ChatPanel, { sessionId, currentUserId: userId, hostUserIdOverride: hostId, hostProfileOverride: partialHost, externalMode: mode }) :
        panel === 'tasks' ? h(TasksPanel, { sessionId: taskRoom, currentUserId: taskUser, timerText: '25:00' }) :
        h(React.Suspense, { fallback: h('p', { role: 'status' }, 'Loading panel…') },
          panel === 'timeline' ? h(TimelineEditor, {
            open: true, theme: 'light', title: 'Test timeline', blocks, onChange: setBlocks,
            onClose: close, onSave: () => { control.savedTimeline = timelineBlocksToSchedulePayload(blocks, { preserveInfinite: true, anchorTs: '2026-09-28T12:00:00.000Z' }); close(); },
            preserveInfinite: true, maxBlocks: 9,
          }) : h(SoundscapePanel, {
            listeningMode: 'personal', activeId: track, playing, currentTime: 0, duration: 120, volume: 50,
            personalMuted: false, canControl: true, canUpload: false, canShareTabMusic: false,
            sharingTabMusic: false, tabMusicShareBusy: false, tabMusicShareError: null,
            customTrackLabel: null, busy: false, uploading: false, error: null,
            onShareTabMusic() {}, onStopTabMusicShare() {}, onListeningModeChange() {},
            onSelect: id => { setTrack(id); control.panelActions.push(['select', id]); },
            onSeek: position => control.panelActions.push(['seek', position]),
            onVolumeChange: volume => control.panelActions.push(['volume', volume]),
            onToggleMute() {}, onUpload() {},
            onStop: () => { setPlaying(value => !value); control.panelActions.push(['toggle']); },
            onClose: close,
          }))));
}
createRoot(document.getElementById('root')).render(h(MemoryRouter, null, h(Harness)));
`;
const server = await createServer({
  root, configFile: false, envDir: path.join(root, 'scripts/fixtures'),
  server: { host: '127.0.0.1', port: 4192, strictPort: true },
  plugins: [{
    name: 'isolated-room-performance-test',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'room-performance-mock' || /(?:^|\/)lib\/supabase(?:\.ts)?$/.test(id)) return mockId;
      if (id === 'room-performance-harness') return harnessId;
      if (/(?:^|\/)lib\/entitlements(?:\.ts)?$/.test(id)) return '\0test-entitlements';
    },
    async load(id) {
      if (id === mockId) return readFile(path.join(root, 'scripts/fixtures/room-performance-mock.mjs'), 'utf8');
      if (id === harnessId) return harness;
      if (id === '\0test-entitlements') return 'export async function getUserEntitlement() { return null; }';
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/') return next();
        const html = await server.transformIndexHtml('/', '<html><head><title>Room performance verification</title></head><body><div id="root"></div><script>window.__consoleErrors=[];window.addEventListener("error",e=>window.__consoleErrors.push(e.message));window.addEventListener("unhandledrejection",e=>window.__consoleErrors.push(String(e.reason)));</script><script type="module" src="/@id/__x00__room-performance-harness"></script></body></html>');
        res.setHeader('Content-Type', 'text/html'); res.end(html);
      });
    },
  }, react()],
});
await server.listen();
console.log('Isolated verification: http://127.0.0.1:4192 (mock API only)');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close().then(() => process.exit(0)); });
