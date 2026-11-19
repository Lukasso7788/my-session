import test from 'node:test';
import assert from 'node:assert/strict';
import { logoutDesktop } from './logout.cjs';
test('logout unloads the renderer before clearing only the desktop partition and returning to login', async () => {
  const events = [];
  const window = { loadURL: async url => events.push(url) };
  const session = { clearStorageData: async options => events.push(options), clearAuthCache: async () => events.push('auth-cleared') };
  await logoutDesktop(window, session, () => events.push('close-auth'));
  assert.equal(events[0], 'close-auth');
  assert.equal(events[1], 'about:blank');
  assert.ok(events[2].storages.includes('localstorage'));
  assert.ok(events[2].storages.includes('cookies'));
  assert.equal(events[3], 'auth-cleared');
  assert.equal(events[4], 'https://mysession.club/login');
});
test('storage failure never claims a completed logout', async () => {
  const urls = [];
  await assert.rejects(logoutDesktop({loadURL: async url => urls.push(url)}, {
    clearStorageData: async () => { throw new Error('disk'); },
  }, () => {}), /disk/);
  assert.deepEqual(urls, ['about:blank']);
});
