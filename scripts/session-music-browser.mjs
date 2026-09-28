// Isolated actual SessionCard visual fixture; never connects to production data.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const root = process.cwd();
const harnessId = '\0session-music-harness';
const supabaseId = '\0session-music-supabase';
const entitlementsId = '\0session-music-entitlements';
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import SessionCard from '/src/components/SessionCard.tsx';
import '/src/index.css';
const h = React.createElement;
const session = {
  id: '081ef47a-362b-479e-8246-ede214073448',
  title: '📈 Ladder · 10→25 min focus - 24/7',
  host_id: '', host_name: 'Yaroslav',
  description: 'Focus blocks gradually grow from 10 to 25 minutes.',
  session_format_type: 'infinite', duration_minutes: 88,
  start_time: '2026-09-28T12:00:00.000Z', status: 'scheduled',
  live_count: 0, max_participants: 16, session_bookings: [],
};
function Demo() {
  const [playing, setPlaying] = useState(false);
  return h('main', { className: 'mx-auto max-w-[1180px] p-6' },
    h('h1', { className: 'mb-5 text-xl font-bold' }, 'Session music indicator — mock data only'),
    h('button', { type: 'button', onClick: () => setPlaying(value => !value),
      className: 'mb-5 rounded-full bg-[#2F2F2F] px-5 py-2 text-white' },
      playing ? 'Pause shared music' : 'Start shared music'),
    h(SessionCard, {
      session, musicPlaying: playing,
      onBook: () => false, onCancelBooking() {}, onJoin() {}, onDelete() {},
    }));
}
createRoot(document.getElementById('root')).render(h(MemoryRouter, null, h(Demo)));
`;
const server = await createServer({
  root, configFile: false, envDir: path.join(root, 'scripts/fixtures'),
  server: { host: '127.0.0.1', port: 4194, strictPort: true },
  plugins: [{
    name: 'isolated-session-music',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'session-music-harness') return harnessId;
      if (/(?:^|\/)lib\/supabase(?:\.ts)?$/.test(id)) return supabaseId;
      if (/(?:^|\/)lib\/entitlements(?:\.ts)?$/.test(id)) return entitlementsId;
    },
    load(id) {
      if (id === harnessId) return harness;
      if (id === supabaseId) return 'export const supabase = { auth: { getSession: async () => ({ data: { session: null } }) }, from: () => { throw Error("Unexpected database read in card fixture"); } };';
      if (id === entitlementsId) return 'export async function loadEntitlementState() { return null; } export function isPersonalPaywallForced() { return false; }';
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/') return next();
        const html = await server.transformIndexHtml('/', '<html><head><title>Session music verification</title></head><body><div id="root"></div><script>window.__consoleErrors=[];window.addEventListener("error",e=>window.__consoleErrors.push(e.message));window.addEventListener("unhandledrejection",e=>window.__consoleErrors.push(String(e.reason)));</script><script type="module" src="/@id/__x00__session-music-harness"></script></body></html>');
        res.setHeader('Content-Type', 'text/html'); res.end(html);
      });
    },
  }, react()],
});
await server.listen();
console.log('Mock SessionCard: http://127.0.0.1:4194/');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close().then(() => process.exit(0)); });
