import test from 'node:test';
import assert from 'node:assert/strict';
import { publicDesktopAuthConfig } from '../scripts/desktop-auth-config.mjs';
test('public desktop config cannot publish service-role, secret or wrong-project keys',()=>{
 const url='https://cxqgzcjsjyszcbcbdusp.supabase.co';
 for(const role of ['anon','service_role']) {
  const key='test.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.test';
  const result=publicDesktopAuthConfig({VITE_SUPABASE_URL:url,VITE_SUPABASE_ANON_KEY:key});
  assert.equal(result.anonKey,role==='anon'?key:undefined);
 }
 assert.equal(publicDesktopAuthConfig({VITE_SUPABASE_URL:url,VITE_SUPABASE_ANON_KEY:'sb_secret_test'}).anonKey,undefined);
 assert.equal(publicDesktopAuthConfig({VITE_SUPABASE_URL:'https://wrong.test',VITE_SUPABASE_ANON_KEY:'sb_publishable_test'}).anonKey,undefined);
});
