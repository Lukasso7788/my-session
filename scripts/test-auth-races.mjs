import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Execute the real components with controlled hooks, SDK promises and timers.
// No network, credentials, or duplicate implementation of the auth logic.
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const session = (id = "dory") => ({ user: { id, user_metadata: {} }, access_token: `test-${id}`, refresh_token: "test" });
const response = (value) => ({ data: { session: value }, error: null });

function harness(path, callback = false) {
  const states = [], effects = [], timers = new Map(), reads = [], navigations = [], adopted = [];
  let listener, nextTimer = 0, setSessionCalls = 0;
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useRef: (current) => ({ current }),
    useCallback: (fn) => fn,
    useState: (value) => {
      const index = states.push(value) - 1;
      return [value, (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useEffect: (fn) => effects.push(fn),
  };
  let rendered;
  const jsx = { jsx: (type, props) => {
    if (type === "provider") rendered = props.value;
    return null;
  }, jsxs: () => null };
  const auth = {
    getSession: () => { const read = deferred(); reads.push(read); return read.promise; },
    onAuthStateChange: (fn) => { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    setSession: () => { setSessionCalls++; throw Error("Callback must not replay session tokens"); },
    signOut: async () => ({ error: null }),
  };
  const query = { select() { return this; }, eq() { return this; },
    single: async () => ({ data: null, error: { message: "Profile temporarily unavailable" } }),
    maybeSingle: async () => ({ data: { id: "dory", full_name: "Dory", avatar_url: "avatar" }, error: null }),
  };
  const modules = {
    react,
    "react/jsx-runtime": jsx,
    "react-router-dom": { useNavigate: () => (...args) => navigations.push(args) },
    "../lib/supabase": { supabase: { auth, from: () => query } },
    "../lib/promiseTimeout": { withTimeout: (promise) => promise },
    "../lib/authProfileEvents": { AUTH_PROFILE_READY_EVENT: "profile-ready", notifyAuthProfileReady() {} },
    "../lib/referrals": { attachReferralToNewUser: async () => {} },
    "../context/AuthContext": { useAuth: () => ({ adoptSession: (value) => adopted.push(value) }) },
  };
  const window = {
    location: { pathname: "/auth/callback", search: "?redirect=%2Fsessions" },
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id) => timers.delete(id), addEventListener() {}, removeEventListener() {},
  };
  const source = readFileSync(path, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  new Function("require", "exports", "window", "console", js)(
    (id) => { assert.ok(modules[id], `Unexpected import: ${id}`); return modules[id]; },
    exports, window, { warn() {}, error() {} },
  );
  if (callback) exports.AuthCallback(); else exports.AuthProvider({ children: null });
  let cleanups = effects.map((fn) => fn());
  return {
    states, reads, auth, navigations, adopted, timers,
    get setSessionCalls() { return setSessionCalls; },
    get context() { return rendered; },
    emit: (event, value = null) => listener(event, value),
    tick: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); },
    cleanup: () => cleanups.forEach((fn) => fn?.()),
    replayEffects: () => { cleanups.forEach((fn) => fn?.()); cleanups = effects.map((fn) => fn()); },
  };
}
const provider = () => harness("src/context/AuthContext.tsx");
const callback = () => harness("src/pages/AuthCallback.tsx", true);

test("pending sign-out null read cannot erase a newer SIGNED_IN", async () => {
  const h = provider(); h.emit("SIGNED_OUT"); h.tick();
  h.emit("SIGNED_IN", session()); h.reads[0].resolve(response(null)); await flush();
  assert.equal(h.states[0]?.id, "dory"); assert.equal(h.states[1]?.user.id, "dory");
});
test("stale sign-out timer is cancelled by callback adoption without an extra read", () => {
  const h = provider(); h.emit("SIGNED_OUT"); h.context.adoptSession(session()); h.tick();
  assert.equal(h.reads.length, 0); assert.equal(h.states[0]?.id, "dory");
});
test("old session read cannot replace a newer account or token refresh", async () => {
  const h = provider(); h.emit("SIGNED_OUT"); h.tick();
  h.emit("TOKEN_REFRESHED", session("new-account"));
  h.reads[0].resolve(response(session("old-account"))); await flush();
  assert.equal(h.states[0]?.id, "new-account");
});
test("real SIGNED_OUT clears user, session and profile even after null INITIAL_SESSION", async () => {
  const h = provider(); h.emit("SIGNED_IN", session()); h.emit("SIGNED_OUT");
  h.emit("INITIAL_SESSION"); h.tick(); h.reads[0].resolve(response(null)); await flush();
  assert.deepEqual(h.states.slice(0, 4), [null, null, null, false]);
});
test("unmount cancels queued sign-out work", () => {
  const h = provider(); h.emit("SIGNED_OUT"); h.cleanup(); h.tick();
  assert.equal(h.reads.length, 0);
});
test("failed sign-out read is handled without erasing an existing session", async () => {
  const h = provider(); h.emit("SIGNED_IN", session()); h.emit("SIGNED_OUT"); h.tick();
  h.reads[0].reject(Error("network")); await flush(); assert.equal(h.states[0]?.id, "dory");
});
test("explicit signOut rejects SDK errors instead of pretending success", async () => {
  const h = provider(); h.emit("SIGNED_IN", session());
  h.auth.signOut = async () => ({ error: Error("offline") });
  await assert.rejects(h.context.signOut(), /offline/); assert.equal(h.states[0]?.id, "dory");
});
test("late signOut completion does not clear a newer login", async () => {
  const h = provider(), pending = deferred(); h.auth.signOut = () => pending.promise;
  const action = h.context.signOut(); h.emit("SIGNED_IN", session());
  pending.resolve({ error: null }); await action; assert.equal(h.states[0]?.id, "dory");
});
test("OAuth adopts the already initialized session without setSession or another auth request", async () => {
  const h = callback(); h.reads[0].resolve(response(session())); await flush();
  assert.equal(h.adopted.length, 1); assert.equal(h.setSessionCalls, 0);
  assert.deepEqual(h.navigations, [["/sessions", { replace: true }]]);
  assert.equal(h.timers.size, 0);
});
test("OAuth errors and missing sessions produce actionable error state", async () => {
  for (const result of [response(null), { data: { session: null }, error: Error("blocked") }]) {
    const h = callback(); h.reads[0].resolve(result); await flush();
    assert.match(h.states[0], /couldn't finish/); assert.equal(h.navigations.length, 0);
  }
});
test("StrictMode effect replay ignores obsolete callback completion", async () => {
  const h = callback(); h.replayEffects();
  h.reads[0].resolve(response(session())); await flush(); assert.equal(h.adopted.length, 0);
  h.reads[1].resolve(response(session())); await flush(); assert.equal(h.adopted.length, 1);
});
test("slow OAuth exposes recovery UI and may still finish once SDK succeeds", async () => {
  const h = callback(); h.tick(); assert.match(h.states[0], /couldn't finish/);
  h.reads[0].resolve(response(session())); await flush(); assert.equal(h.navigations.length, 1);
});
