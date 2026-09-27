// Real VideoTile + LiveKit BarVisualizer; synthetic audio only, no mic or server.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const harnessId = '\0speaking-indicator-harness';
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalAudioTrack } from 'livekit-client';
import { VideoTile } from '/src/pages/livekit/VideoTileLiveKit.tsx';
import '/src/index.css';
import '@livekit/components-styles';
const h = React.createElement;
// Track the real shared clock's timer without accelerating Web Audio intervals.
const nativeInterval = window.setInterval;
const nativeClear = window.clearInterval;
window.__clockIntervals = new Map();
window.setInterval = (tick, ms, ...args) => {
  const timer = nativeInterval(tick, ms, ...args);
  if (ms === 30000) window.__clockIntervals.set(timer, tick);
  return timer;
};
window.clearInterval = timer => { window.__clockIntervals.delete(timer); nativeClear(timer); };
const NativeContext = window.AudioContext;
window.__audioContexts = [];
window.AudioContext = class extends NativeContext {
  constructor(...args) { super(...args); window.__audioContexts.push(this); }
};
const source = new AudioContext();
const oscillator = source.createOscillator();
oscillator.frequency.value = 3000;
const gain = source.createGain();
gain.gain.value = 0;
oscillator.connect(gain); oscillator.start();
function makeTrack() {
  const destination = source.createMediaStreamDestination();
  gain.connect(destination);
  return new LocalAudioTrack(destination.stream.getAudioTracks()[0]);
}
function Harness() {
  const [track, setTrack] = useState(makeTrack);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [mounted, setMounted] = useState(true);
  window.__indicator = {
    source,
    unmute: () => setMuted(false), mute: () => setMuted(true),
    speak: async () => { await source.resume(); gain.gain.value = 0.7; setSpeaking(true); },
    silence: () => { gain.gain.value = 0; setSpeaking(false); },
    replace: () => { const next = makeTrack(); setTrack(next); track.stop(); },
    removeTrack: () => { setTrack(undefined); track?.stop(); },
    unmount: () => setMounted(false), mount: () => setMounted(true),
  };
  return h('main', { style: { padding: 24 } },
    h('h1', null, 'LiveKit microphone regression — synthetic audio'),
    h('button', { onClick: window.__indicator.speak }, 'Start synthetic speech'),
    h('button', { onClick: window.__indicator.silence }, 'Silence'),
    h('div', { style: { display: 'flex', gap: 16 } }, ['local', 'remote'].map(kind =>
      h('section', { key: kind, id: kind, style: { width: 320, height: 220 } }, mounted &&
        h(VideoTile, { tileId: kind, label: kind === 'local' ? 'You' : 'Participant',
          theme: kind === 'local' ? 'dark' : 'light', isLocal: kind === 'local',
          participantTimeZone: kind === 'local' ? 'Europe/Kyiv' : 'America/New_York',
          audioTrack: track, micMuted: muted, isSpeaking: speaking })))));
}
createRoot(document.getElementById('root')).render(h(Harness));
`;
const server = await createServer({
  root: process.cwd(), configFile: false, envDir: path.join(process.cwd(), 'scripts/fixtures'),
  server: { host: '127.0.0.1', port: 4193, strictPort: true },
  plugins: [{ name: 'isolated-speaking-indicator', enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\\\', '/').endsWith('/VideoTileLiveKitLegacy.tsx')) return;
      // Test-only render counter: prove clock ticks don't rerender media tiles.
      return code.replace('const heldSpeaking = useHeldSpeaking(',
        'window.__tileRenders = (window.__tileRenders || 0) + 1; const heldSpeaking = useHeldSpeaking(');
    },
    resolveId(id) { if (id === 'speaking-indicator-harness') return harnessId; },
    load(id) { if (id === harnessId) return harness; },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/') return next();
        const html = await server.transformIndexHtml('/', '<html><head><title>Speaking indicator test</title></head><body><div id="root"></div><script>window.__consoleErrors=[];window.addEventListener("error",e=>window.__consoleErrors.push(e.message));window.addEventListener("unhandledrejection",e=>window.__consoleErrors.push(String(e.reason)));</script><script type="module" src="/@id/__x00__speaking-indicator-harness"></script></body></html>');
        res.setHeader('Content-Type', 'text/html'); res.end(html);
      });
    },
  }, react()],
});
await server.listen();
console.log('Synthetic LiveKit indicator: http://127.0.0.1:4193');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close().then(() => process.exit(0)); });
