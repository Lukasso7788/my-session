import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as livekit from 'livekit-server-sdk';

// Run the actual token endpoint with database fixtures and real signed JWTs.
const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const ownerId = '33333333-3333-4333-8333-333333333333';
const env = {
  LIVEKIT_API_KEY: 'test-api-key',
  LIVEKIT_API_SECRET: 'test-secret-for-local-permission-regression-only',
  LIVEKIT_URL: 'wss://livekit.example.test',
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
};
const js = ts.transpileModule(readFileSync('api/livekit/token.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function issueToken({ locked, role = 'host', legacy = false }) {
  const session = {
    id: sessionId,
    host_id: role === 'host' ? userId : ownerId,
    microphone_locked: legacy ? undefined : locked,
    schedule: legacy ? JSON.stringify({ room_policies: { microphone_locked: locked } }) : {},
    assigned_server_id: null,
    max_participants: 16,
  };
  const sb = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from(table) {
      let columns = '';
      const result = () => {
        if (table === 'sessions') {
          if (legacy && columns.includes('microphone_locked')) {
            return { data: null, error: { code: '42703' } };
          }
          return { data: session, error: null };
        }
        const data = {
          session_role_assignments: role === 'moderator' ? [{ id: 'moderator' }] : [],
          infinite_room_host_leases: role === 'temporary-host' ? { user_id: userId } : null,
          session_attendance: [],
          session_bookings: [],
          account_access_controls: null,
          user_bans: null,
        };
        assert.ok(table in data, `Unexpected table ${table}`);
        return { data: data[table], error: null };
      };
      const query = {
        select(value) { columns = value; return this; },
        eq() { return this; }, gt() { return this; }, gte() { return this; },
        lte() { return this; }, is() { return this; }, or() { return this; },
        order() { return this; }, limit() { return this; },
        single: async () => result(), maybeSingle: async () => result(),
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return query;
    },
  };
  const exports = {};
  new Function('require', 'exports', 'process', 'console', js)(
    (id) => {
      if (id === 'livekit-server-sdk') return livekit;
      assert.equal(id, '@supabase/supabase-js');
      return { createClient: () => sb };
    }, exports, { env }, { log() {}, error() {} },
  );
  let status, body;
  await exports.default({
    method: 'POST', headers: { authorization: 'Bearer test-user-session' },
    body: { roomName: `session-${sessionId}`, sessionId, identity: `${userId}--tab` },
  }, {
    setHeader() {}, status(value) { status = value; return this; },
    json(value) { body = value; return this; },
  });
  assert.equal(status, 200, JSON.stringify(body));
  return new livekit.TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(body.token);
}

for (const role of ['host', 'moderator', 'temporary-host', 'participant']) {
  test(`microphone lock allows tab music for ${role} without allowing microphone`, async () => {
    const { video } = await issueToken({ locked: true, role });
    assert.equal(video.canPublish, true);
    assert.deepEqual(video.canPublishSources, ['camera', 'screen_share', 'screen_share_audio']);
    assert.equal(video.canPublishSources.includes('microphone'), false);
    assert.equal(Boolean(video.roomAdmin), role !== 'participant');
    assert.equal(video.canSubscribe, true);
    assert.equal(video.canPublishData, true);
  });
}

test('legacy room-policy fallback also permits music while blocking microphone', async () => {
  const { video } = await issueToken({ locked: true, legacy: true });
  assert.ok(video.canPublishSources.includes('screen_share_audio'));
  assert.equal(video.canPublishSources.includes('microphone'), false);
});

test('unlocked rooms retain unrestricted publication without granting admin to participants', async () => {
  const { video } = await issueToken({ locked: false, role: 'participant' });
  assert.equal(video.canPublish, true);
  assert.equal(video.canPublishSources, undefined);
  assert.equal(Boolean(video.roomAdmin), false);
});
