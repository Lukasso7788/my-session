import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const reloads = [];
const dispatched = [];
const session = new Map();

globalThis.window = {
  location: { pathname: '/room-livekit/abc', reload: () => reloads.push(Date.now()) },
  sessionStorage: {
    getItem: (key) => (session.has(key) ? session.get(key) : null),
    setItem: (key, value) => session.set(key, String(value)),
  },
  dispatchEvent: (event) => {
    dispatched.push(event);
    return true;
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const {
  APP_UPDATE_AVAILABLE_EVENT,
  areDynamicImportReloadsDeferred,
  deferDynamicImportReloads,
  isDynamicImportFailure,
  recoverFromDynamicImportFailure,
} = await import('../src/lib/dynamicImportRecovery.ts');

const staleChunk = new TypeError('Failed to fetch dynamically imported module: https://mysession.club/assets/ChatPanel-old.js');

beforeEach(() => {
  reloads.length = 0;
  dispatched.length = 0;
  session.clear();
});

test('recognizes stale chunk errors from Chromium and Safari', () => {
  assert.equal(isDynamicImportFailure(staleChunk), true);
  assert.equal(isDynamicImportFailure(new TypeError('Importing a module script failed.')), true);
  assert.equal(isDynamicImportFailure(new Error('Network request failed')), false);
});

test('outside a live room a stale chunk reloads once', () => {
  assert.equal(recoverFromDynamicImportFailure(staleChunk), true);
  assert.equal(reloads.length, 1);
  assert.equal(recoverFromDynamicImportFailure(staleChunk), false, 'cooldown prevents a reload loop');
  assert.equal(reloads.length, 1);
});

test('a live room defers the reload and announces the update instead', () => {
  const release = deferDynamicImportReloads();
  assert.equal(areDynamicImportReloadsDeferred(), true);
  assert.equal(recoverFromDynamicImportFailure(staleChunk), false);
  assert.equal(reloads.length, 0);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, APP_UPDATE_AVAILABLE_EVENT);
  release();
  assert.equal(areDynamicImportReloadsDeferred(), false);
  assert.equal(recoverFromDynamicImportFailure(staleChunk), true);
  assert.equal(reloads.length, 1);
});

test('overlapping deferrals keep reloads blocked until all are released', () => {
  const first = deferDynamicImportReloads();
  const second = deferDynamicImportReloads();
  first();
  assert.equal(areDynamicImportReloadsDeferred(), true);
  second();
  assert.equal(areDynamicImportReloadsDeferred(), false);
});
