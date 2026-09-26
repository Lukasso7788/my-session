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
import { control, sessionId, userId, hostId } from 'room-performance-mock';
import '/src/index.css';
const h = React.createElement;
const partialHost = { id: hostId, full_name: 'Host', avatar_url: null };
function Harness() {
  const [mounted, setMounted] = useState(true);
  const [panel, setPanel] = useState('chat');
  const [mode, setMode] = useState('general');
  const [tick, setTick] = useState(0);
  const button = (text, onClick) => h('button', { onClick, style: { padding: 12, border: '1px solid #ccc' } }, text);
  control.unmount = () => setMounted(false);
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
        h(TasksPanel, { sessionId, currentUserId: userId, timerText: '25:00' })));
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
