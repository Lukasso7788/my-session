import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync('api/desktop-auth-config.ts','utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};
new Function('exports','require','module',compiled)(mod.exports,require,mod);
const handler=mod.exports.default;
test('desktop config returns only a public anon key, never a server key',()=>{
  const previousUrl=process.env.VITE_SUPABASE_URL, previousKey=process.env.VITE_SUPABASE_ANON_KEY;
  try {
    process.env.VITE_SUPABASE_URL='https://cxqgzcjsjyszcbcbdusp.supabase.co';
    for(const role of ['anon','service_role']) {
      process.env.VITE_SUPABASE_ANON_KEY='test.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.test';
      const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
      handler({method:'GET'},res);
      assert.equal(res.code,role==='anon'?200:503);
      if(role!=='anon') assert.equal(res.body.anonKey,undefined);
    }
  } finally {
    if(previousUrl===undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL=previousUrl;
    if(previousKey===undefined) delete process.env.VITE_SUPABASE_ANON_KEY; else process.env.VITE_SUPABASE_ANON_KEY=previousKey;
  }
});
