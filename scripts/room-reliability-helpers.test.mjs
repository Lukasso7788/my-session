import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { computeServerClockOffset } from '../src/lib/serverClock.ts';
import { createRoomCountdownStore } from '../src/lib/roomCountdownStore.ts';
import { preloadableLazy } from '../src/lib/preloadableLazy.ts';

test('server clock offset ignores sub-second header noise', () => {
  const started = Date.parse('2026-10-11T05:00:00.000Z');
  assert.equal(computeServerClockOffset('Sun, 11 Oct 2026 05:00:00 GMT', started, started + 200), 0);
});

test('server clock offset corrects a device clock that runs ahead', () => {
  // Device thinks it is 05:05:00 while the server says 05:00:00.
  const started = Date.parse('2026-10-11T05:05:00.000Z');
  const offset = computeServerClockOffset('Sun, 11 Oct 2026 05:00:00 GMT', started, started + 100);
  assert.ok(offset < -299_000 && offset > -301_000, `unexpected offset ${offset}`);
});

test('server clock offset rejects unusable measurements', () => {
  assert.equal(computeServerClockOffset(null, 0, 10), null);
  assert.equal(computeServerClockOffset('not a date', 0, 10), null);
  const started = Date.parse('2026-10-11T05:00:00.000Z');
  assert.equal(computeServerClockOffset('Sun, 11 Oct 2026 05:00:30 GMT', started, started + 30_000), null);
});

test('countdown store notifies only on real changes', () => {
  const store = createRoomCountdownStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  store.set('12:00');
  store.set('12:00');
  store.set('11:59');
  assert.equal(store.getSnapshot(), '11:59');
  assert.equal(calls, 2);
  unsubscribe();
  store.set('11:58');
  assert.equal(calls, 2);
});

test('a preloaded panel renders synchronously without a Suspense fallback', async () => {
  let loads = 0;
  const Panel = preloadableLazy(async () => {
    loads += 1;
    return { default: ({ label }) => createElement('section', null, label) };
  });
  await Panel.preload();
  await Panel.preload();
  assert.equal(loads, 1, 'the chunk is requested once');
  assert.equal(renderToString(createElement(Panel, { label: 'Chat' })), '<section>Chat</section>');
});

test('a failed preload can be retried later', async () => {
  let attempts = 0;
  const Panel = preloadableLazy(async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('Failed to fetch dynamically imported module');
    return { default: () => createElement('div', null, 'ok') };
  });
  await assert.rejects(Panel.preload());
  await Panel.preload();
  assert.equal(attempts, 2);
  assert.equal(renderToString(createElement(Panel, {})), '<div>ok</div>');
});
