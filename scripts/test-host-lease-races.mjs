import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");
const block = source.slice(source.indexOf("  const loadActiveRoomHostLease ="), source.indexOf("  const activeOperationalHostProfile ="));
const js = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const lease = (user_id) => ({ user_id, session_id: "room", expires_at: "2099-01-01", active_host_profile: null });

function harness() {
  const effects = [];
  const reads = [];
  const mutations = [];
  const state = { lease: null, busy: false, error: "", invalidations: 0 };
  let realtime;
  const channel = { on: (...args) => { realtime = args.at(-1); return channel; }, subscribe: () => channel };
  const query = { select: () => query, eq: () => query, maybeSingle: () => { const d = deferred(); reads.push(d); return d.promise; } };
  const env = {
    useCallback: (fn) => fn, useRef: (current) => ({ current }), useEffect: (fn) => effects.push(fn),
    activeRoomHostActionRef: { current: false }, activeRoomHostEpochRef: { current: 0 },
    activeRoomHostReadRef: { current: 0 }, activeRoomHostDirtyRef: { current: false },
    isInfiniteRoom: true, sessionId: "room", authUserId: "me", connected: true,
    isTemporaryRoomHost: false, sessionOwnerIsPresent: false, hasValidActiveRoomHostLease: false,
    setActiveRoomHostLease: (value) => { state.lease = value; },
    setActiveRoomHostBusy: (value) => { state.busy = value; },
    setActiveRoomHostError: (value) => { state.error = value; },
    setActiveRoomHostClock: () => {},
    invalidateHostLeaseCache: () => { state.invalidations++; },
    supabase: {
      from: () => query, channel: () => channel, removeChannel: () => {},
      rpc: (name) => { const d = deferred(); mutations.push({ ...d, name }); return d.promise; },
    },
  };
  const actions = new Function(...Object.keys(env), js + "\nreturn { claimActiveRoomHost, releaseActiveRoomHost, loadActiveRoomHostLease };")(...Object.values(env));
  return { ...actions, state, reads, mutations, effects, realtime: () => realtime() };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("first claim uses confirmed fresh read and rejects pre-mutation read; double click makes one RPC", async () => {
  const h = harness();
  const old = h.loadActiveRoomHostLease();
  const claim = h.claimActiveRoomHost();
  await h.claimActiveRoomHost();
  assert.equal(h.mutations.length, 1);
  assert.equal(h.state.busy, true);
  h.mutations[0].resolve({ data: true, error: null });
  await tick();
  h.reads[1].resolve({ data: lease("me"), error: null });
  assert.equal(await claim, true);
  h.reads[0].resolve({ data: null, error: null });
  await old;
  assert.equal(h.state.lease.user_id, "me");
  assert.equal(h.state.busy, false);
});

test("first release clears host and old SELECT cannot resurrect it", async () => {
  const h = harness();
  h.state.lease = lease("me");
  const old = h.loadActiveRoomHostLease();
  const release = h.releaseActiveRoomHost();
  await h.releaseActiveRoomHost();
  assert.equal(h.mutations.length, 1);
  h.mutations[0].resolve({ data: true, error: null });
  await tick();
  assert.equal(h.state.lease, null);
  h.reads[1].resolve({ data: null, error: null });
  await release;
  h.reads[0].resolve({ data: lease("me"), error: null });
  await old;
  assert.equal(h.state.lease, null);
});

test("failed release retains confirmed host and reports error", async () => {
  const h = harness();
  h.state.lease = lease("me");
  const release = h.releaseActiveRoomHost();
  h.mutations[0].resolve({ error: { message: "network failure" } });
  await release;
  assert.equal(h.state.lease.user_id, "me");
  assert.match(h.state.error, /Could not step down/);
  assert.equal(h.state.busy, false);
});

test("failed claim does not invent a lease", async () => {
  const h = harness();
  const claim = h.claimActiveRoomHost();
  h.mutations[0].resolve({ error: { message: "active_host_already_claimed" } });
  await tick();
  h.reads[0].resolve({ data: lease("other"), error: null });
  assert.equal(await claim, false);
  assert.equal(h.state.lease.user_id, "other");
  assert.match(h.state.error, /Someone else/);
});

test("realtime during mutation reconciliation is replayed; latest read wins", async () => {
  const h = harness();
  h.effects[1]();
  h.reads[0].resolve({ data: null, error: null });
  await tick();
  const claim = h.claimActiveRoomHost();
  h.mutations[0].resolve({ data: true, error: null });
  await tick();
  h.realtime();
  h.reads[1].resolve({ data: lease("me"), error: null });
  await claim;
  assert.equal(h.reads.length, 3);
  h.reads[2].resolve({ data: lease("other"), error: null });
  await tick();
  assert.equal(h.state.lease.user_id, "other");
});

test("cache invalidation detaches in-flight reads and prevents stale cache repopulation", async () => {
  const optimizer = ts.transpileModule(readFileSync("src/lib/supabaseFetchOptimizer.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const { optimizedSupabaseFetch, invalidateHostLeaseCache } = await import("data:text/javascript;base64," + Buffer.from(optimizer).toString("base64"));
  const originalFetch = globalThis.fetch;
  const pending = [];
  globalThis.fetch = () => { const d = deferred(); pending.push(d); return d.promise; };
  try {
    const url = "https://example.supabase.co/rest/v1/infinite_room_host_leases?session_id=eq.room";
    const old = optimizedSupabaseFetch(url);
    await tick();
    invalidateHostLeaseCache();
    const fresh = optimizedSupabaseFetch(url);
    await tick();
    assert.equal(pending.length, 2);
    pending[1].resolve(Response.json(lease("me")));
    assert.equal((await (await fresh).json()).user_id, "me");
    pending[0].resolve(Response.json(null));
    await old;
    assert.equal((await (await optimizedSupabaseFetch(url)).json()).user_id, "me");
    assert.equal(pending.length, 2, "ordinary reads still reuse the cache");
    invalidateHostLeaseCache();
    const released = optimizedSupabaseFetch(url);
    await tick();
    pending[2].resolve(Response.json(null));
    assert.equal(await (await released).json(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
