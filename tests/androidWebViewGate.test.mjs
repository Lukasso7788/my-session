import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url);
const {transformSync}=createRequire(require.resolve('vite/package.json'))('esbuild');
const source=readFileSync('src/components/InAppBrowserMediaGate.tsx','utf8');
const js=transformSync(source+'\nexport {detectEmbeddedBrowser};',{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
function detect(bridge,hostname='mysession.club'){
 const module={exports:{}};
 runInNewContext(js,{module,exports:module.exports,require,window:{MySessionNative:bridge},navigator:{userAgent:'Mozilla/5.0 (Linux; Android 14; Phone; wv) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'},location:{protocol:'https:',hostname}});
 return module.exports.detectEmbeddedBrowser();
}
test('our native bridge on our HTTPS origin is permitted',()=>assert.equal(detect({postMessage(){}}),null));
test('ordinary Android embedded WebView remains blocked',()=>assert.equal(detect(undefined).name,'this app'));
test('marker without callable bridge or on foreign origin is not exempt',()=>{
 assert.equal(detect({postMessage:true}).name,'this app');
 assert.equal(detect({postMessage(){}},'example.com').name,'this app');
});

