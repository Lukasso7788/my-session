import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthNavigationHandler } from './auth-window-navigation.cjs';
import { authWindowDecision } from './oauth-protocol.cjs';
test('Discord authorize and login redirects remain allowed, deceptive domains do not', () => {
  for (const path of ['/oauth2/authorize?client_id=1', '/login?redirect_to=oauth2', '/register', '/login/reset']) {
    assert.equal(authWindowDecision('https://discord.com' + path), 'provider');
  }
  assert.equal(authWindowDecision('https://discord.com.evil.test/login'), 'block');
  assert.equal(authWindowDecision('https://discord.com/channels/@me'), 'block');
});
test('modern event details allow provider submission and forward the callback exactly once', () => {
  const calls = [];
  const handler = createAuthNavigationHandler({finish: url => calls.push(url), blocked: () => calls.push('blocked')});
  let cancelled = 0;
  handler({url: 'https://accounts.google.com/signin/challenge', isMainFrame: true, preventDefault: () => cancelled++});
  assert.equal(cancelled, 0);
  const callback = 'https://mysession.club/auth/callback?code=test-only';
  handler({url: callback, isMainFrame: true, preventDefault: () => cancelled++});
  assert.deepEqual(calls, [callback]);
  assert.equal(cancelled, 1);
});
test('unknown top-level navigation reports a failure without exposing its URL', () => {
  const calls = [];
  const handler = createAuthNavigationHandler({finish: () => assert.fail(), blocked: (...args) => calls.push(args)});
  handler({url: 'https://evil.test/?code=secret', preventDefault: () => calls.push('cancelled')});
  assert.deepEqual(calls, ['cancelled', []]);
  handler({url: 'https://evil.test/', isMainFrame:false, preventDefault: () => assert.fail()});
});
