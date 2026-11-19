import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAuth } from './browser-auth.cjs';
function harness() {
  const opened = [], adopted = [], failures = [];
  let exchanges = 0, clock = 1000;
  const flow = createBrowserAuth({
    fetchConfig: async () => ({url:'https://cxqgzcjsjyszcbcbdusp.supabase.co',anonKey:'public-test'}),
    openExternal: async url => opened.push(new URL(url)),
    exchange: async (_config, code, verifier) => {
      exchanges++; assert.equal(code, 'test-code'); assert.ok(verifier.length >= 43);
      return {access_token:'test-access',refresh_token:'test-refresh'};
    }, adopt: async tokens => adopted.push(tokens), failed: error => failures.push(error), now: () => clock,
  });
  const callback = () => 'mysession://oauth/callback?code=test-code&state=' + new URL(opened.at(-1).searchParams.get('redirect_to')).searchParams.get('desktop_state');
  return {flow,opened,adopted,failures,callback,exchanges:()=>exchanges,expire:()=>{clock+=300001;}};
}
test('Google uses browser PKCE, adopts once and rejects a replay',async()=>{
  const h=harness(); await h.flow.start();
  assert.equal(h.opened[0].searchParams.get('code_challenge_method'),'s256');
  assert.ok(!h.opened[0].href.includes('test-access'));
  assert.equal(await h.flow.receive(h.callback()),true);
  assert.equal(await h.flow.receive(h.callback()),false);
  assert.equal(h.exchanges(),1); assert.equal(h.adopted.length,1);
});
test('forged state, wrong host, expired, cancelled and previous attempts cannot sign in',async()=>{
  const h=harness(); await h.flow.start(); const old=h.callback();
  assert.equal(await h.flow.receive(old.replace('state=','state=wrong')),false);
  assert.equal(await h.flow.receive(old.replace('//oauth/','//evil/')),false);
  await h.flow.start(); assert.equal(await h.flow.receive(old),false);
  h.expire(); assert.equal(await h.flow.receive(h.callback()),false);
  await h.flow.start(); h.flow.cancel(); assert.equal(await h.flow.receive(h.callback()),false);
  assert.equal(h.exchanges(),0);
});
test('exchange failure reports generic error without exposing callback data',async()=>{
  const failures=[]; let target;
  const flow=createBrowserAuth({fetchConfig:async()=>({url:'https://cxqgzcjsjyszcbcbdusp.supabase.co',anonKey:'public'}),openExternal:async url=>{target=new URL(url)},exchange:async()=>{throw Error('secret')},adopt:()=>assert.fail(),failed:x=>failures.push(x)});
  await flow.start(); const state=new URL(target.searchParams.get('redirect_to')).searchParams.get('desktop_state');
  await flow.receive('mysession://oauth/callback?code=test&state='+state);
  assert.equal(failures.length,1); assert.ok(!failures[0].includes('secret'));
});

test('logout while public configuration is loading cancels the browser attempt', async () => {
  let resolveConfig;
  const opened=[];
  const flow=createBrowserAuth({fetchConfig:()=>new Promise(resolve=>{resolveConfig=resolve}),openExternal:async value=>opened.push(value),exchange:()=>assert.fail(),adopt:()=>assert.fail(),failed:()=>assert.fail()});
  const starting=flow.start();
  flow.cancel();
  resolveConfig({url:'https://cxqgzcjsjyszcbcbdusp.supabase.co',anonKey:'public'});
  await starting;
  assert.deepEqual(opened,[]);
});

test('logout during token exchange prevents a late response from signing back in',async()=>{
  let finishExchange,target;
  const adopted=[];
  const flow=createBrowserAuth({fetchConfig:async()=>({url:'https://cxqgzcjsjyszcbcbdusp.supabase.co',anonKey:'public'}),openExternal:async url=>{target=new URL(url)},exchange:()=>new Promise(resolve=>{finishExchange=resolve}),adopt:async tokens=>adopted.push(tokens),failed:()=>assert.fail()});
  await flow.start();
  const state=new URL(target.searchParams.get('redirect_to')).searchParams.get('desktop_state');
  const receiving=flow.receive('mysession://oauth/callback?code=test&state='+state);
  flow.cancel(); finishExchange({access_token:'test',refresh_token:'test'});
  await receiving;
  assert.deepEqual(adopted,[]);
});
