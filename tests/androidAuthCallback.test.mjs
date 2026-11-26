import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('public/desktop-auth.js','utf8');
function callback(platform,state='a'.repeat(64),code='single-use-code'){
 const status={},link={},heading={};const location={search:'?'+new URLSearchParams({desktop_state:state,code,...(platform?{platform}:{})}),pathname:'/desktop-auth.html'};
 vm.runInNewContext(source,{URL,URLSearchParams,location,history:{replaceState(){}},document:{getElementById:id=>id==='status'?status:link,querySelector:()=>heading}});
 return {location,link,status};
}
test('Android callback uses Android scheme with state/code only',()=>{
 const {link}=callback('android');const url=new URL(link.href);
 assert.equal(url.protocol,'mysession-android:');assert.equal(url.host,'oauth');assert.equal(url.pathname,'/callback');assert.equal(url.searchParams.get('code'),'single-use-code');assert.equal(url.searchParams.get('state'),'a'.repeat(64));
});
test('Desktop callback remains unchanged',()=>assert.equal(new URL(callback().link.href).protocol,'mysession:'));
test('malformed state never launches app',()=>assert.equal(callback('android','bad').link.href,undefined));
