// Isolated browser check for the room reliability UI: Leave confirmation,
// side-panel error boundary (stale chunk and render error) and the room crash
// screen. Uses the real components with a mock Supabase client; no
// credentials, LiveKit server or production writes.
// Usage: CHROME_PATH=/path/to/chrome node scripts/room-reliability-browser.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = process.cwd();
const port = 4197;
const outputDir = path.resolve(process.argv[2] || path.join(tmpdir(), 'mysession-room-reliability'));
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mockId = '\0room-reliability-mock';
const harnessId = '\0room-reliability-harness';

const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveKitBottomBar } from '/src/pages/livekit/LiveKitBottomBarLegacy.tsx';
import { RoomPanelErrorBoundary, RoomCrashBoundary } from '/src/components/RoomErrorBoundary.tsx';
import { preloadableLazy } from '/src/lib/preloadableLazy.ts';
import '/src/index.css';
const h = React.createElement;
const noop = () => {};
window.__leaveCalls = 0;
const StalePanel = preloadableLazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/ChatPanel-old.js')));
function BrokenPanel() { throw new Error('render failed'); }
function BrokenRoom() { throw new Error('room render failed'); }
function Harness() {
  const [panelClosed, setPanelClosed] = useState(false);
  const bar = h(LiveKitBottomBar, {
    theme: 'light', isLight: true, bottomBarBg: 'bg-[#F3F1F1]', ctlBtnBase: 'bg-white',
    connected: true, micOn: false, camOn: false, screenShareOn: false,
    onToggleMic: noop, onToggleCam: noop, onToggleScreenShare: noop,
    onLeave: () => { window.__leaveCalls += 1; },
    onOpenParticipants: noop, onOpenChat: noop, onOpenTasks: noop, onOpenSettings: noop,
    onSendReaction: noop, audioInputs: [], videoInputs: [], selectedAudioInputId: '', selectedVideoInputId: '',
    onChangeAudioInput: noop, onChangeVideoInput: noop, videoFxMode: 'off', blurStrength: 10,
    onBlurStrengthChange: noop, backgroundPresets: [], customBackgroundSlots: [], onApplyVideoFx: noop,
  });
  return h('main', { style: { padding: 16 } },
    h('section', { id: 'stale', style: { width: 360, height: 220, border: '1px solid #ddd' } },
      panelClosed ? h('p', { id: 'stale-closed' }, 'closed') : h(RoomPanelErrorBoundary, {
        panel: 'chat', routeId: 'route-1', sessionId: null, isLight: true, onClose: () => setPanelClosed(true),
      }, h(React.Suspense, { fallback: h('p', null, 'Loading chat…') }, h(StalePanel, {})))),
    h('section', { id: 'broken', style: { width: 360, height: 220, border: '1px solid #ddd', marginTop: 12 } },
      h(RoomPanelErrorBoundary, { panel: 'tasks', routeId: 'route-1', sessionId: null, isLight: false }, h(BrokenPanel))),
    h('section', { id: 'crash', style: { marginTop: 12 } }, h(RoomCrashBoundary, { routeId: 'route-1' }, h(BrokenRoom))),
    bar);
}
createRoot(document.getElementById('root')).render(h(Harness));
`;

const server = await createServer({
  root, configFile: false, envDir: path.join(root, 'scripts/fixtures'), logLevel: 'error',
  server: { host: '127.0.0.1', port, strictPort: true },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'lucide-react'] },
  plugins: [{
    name: 'isolated-room-reliability-test',
    enforce: 'pre',
    resolveId(id) {
      if (/(?:^|\/)lib\/supabase(?:\.ts)?$/.test(id)) return mockId;
      if (id === 'room-reliability-harness') return harnessId;
    },
    async load(id) {
      if (id === mockId) return readFile(path.join(root, 'scripts/fixtures/room-performance-mock.mjs'), 'utf8');
      if (id === harnessId) return harness;
    },
    configureServer(viteServer) {
      viteServer.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/') return next();
        const html = await viteServer.transformIndexHtml('/', '<html><head><title>Room reliability check</title></head><body><div id="root"></div><script>window.__errors=[];window.addEventListener("error",e=>window.__errors.push(String(e.message)));</script><script type="module" src="/@id/__x00__room-reliability-harness"></script></body></html>');
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      });
    },
  }, react()],
});
await server.listen();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = await mkdtemp(path.join(tmpdir(), 'mysession-reliability-'));
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const failures = [];
try {
  let devtoolsPort = 0;
  for (let attempt = 0; attempt < 100 && !devtoolsPort; attempt++) {
    try { devtoolsPort = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]); } catch { await sleep(100); }
  }
  const target = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/new?about:blank`, { method: 'PUT' })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++nextId; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const check = (name, ok) => { console.log(`${ok ? 'ok' : 'FAIL'} - ${name}`); if (!ok) failures.push(name); };

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate('!!document.querySelector("[aria-label=\\"Leave room\\"]") && document.body.innerText.includes("The room hit a problem")')) break;
    await sleep(150);
  }

  check('stale chunk shows the update message instead of crashing', await evaluate('document.querySelector("#stale").innerText.includes("MySession was updated") && !![...document.querySelectorAll("#stale button")].find(b => b.innerText === "Refresh")'));
  check('render error shows a retry inside the panel', await evaluate('document.querySelector("#broken").innerText.includes("This panel ran into a problem") && !![...document.querySelectorAll("#broken button")].find(b => b.innerText === "Try again")'));
  check('room crash shows a recovery screen', await evaluate('document.querySelector("#crash").innerText.includes("Rejoin room") && document.querySelector("#crash").innerText.includes("Back to sessions")'));
  check('the rest of the page stays mounted', await evaluate('!!document.querySelector("[aria-label=\\"Leave room\\"]")'));

  await evaluate('document.querySelector("[aria-label=\\"Leave room\\"]").click()');
  await sleep(100);
  check('first Leave tap only asks for confirmation', await evaluate('window.__leaveCalls === 0 && !!document.querySelector("[role=dialog][aria-label=\\"Leave the room?\\"]")'));
  await writeFile(path.join(await mkdir(outputDir, { recursive: true }) || outputDir, 'leave-confirm-mobile.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await evaluate('[...document.querySelectorAll("[role=dialog] button")].find(b => b.innerText === "Stay").click()');
  await sleep(100);
  check('Stay closes the confirmation without leaving', await evaluate('window.__leaveCalls === 0 && !document.querySelector("[role=dialog][aria-label=\\"Leave the room?\\"]")'));
  await evaluate('document.querySelector("[aria-label=\\"Leave room\\"]").click()');
  await sleep(100);
  await evaluate('[...document.querySelectorAll("[role=dialog] button")].find(b => b.innerText === "Leave").click()');
  await sleep(100);
  check('confirming leaves exactly once', await evaluate('window.__leaveCalls === 1'));

  await evaluate('[...document.querySelectorAll("#stale button")].find(b => b.innerText === "Close panel").click()');
  await sleep(100);
  check('a failed panel can be closed', await evaluate('!!document.querySelector("#stale-closed")'));
  await writeFile(path.join(outputDir, 'boundaries-mobile.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).result.data, 'base64'));
  socket.close();
} finally {
  browser.kill();
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
console.log(failures.length ? `${failures.length} check(s) failed` : `All checks passed; screenshots in ${outputDir}`);
process.exitCode = failures.length ? 1 : 0;
