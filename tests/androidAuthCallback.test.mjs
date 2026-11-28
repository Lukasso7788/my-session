import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('public/desktop-auth.js','utf8');
function callback(platform,state='a'.repeat(64),code='single-use-code',userAgent='Chrome/140.0.0.0'){
 const status={},link={},heading={};const location={search:'?'+new URLSearchParams({desktop_state:state,code,...(platform?{platform}:{})}),pathname:'/desktop-auth.html'};
 vm.runInNewContext(source,{URL,URLSearchParams,location,navigator:{userAgent},history:{replaceState(){}},document:{getElementById:id=>id==='status'?status:link,querySelector:()=>heading}});
 return {location,link,status};
}
test('Android Chrome callback opens the normal APK on a tap with state and code',()=>{
 const {link,location}=callback('android');const url=new URL(link.href);
 assert.equal(url.protocol,'intent:');assert.equal(url.host,'oauth');assert.equal(url.pathname,'/callback');assert.equal(url.searchParams.get('code'),'single-use-code');assert.equal(url.searchParams.get('state'),'a'.repeat(64));
 assert.equal(url.hash,'#Intent;scheme=mysession-android;package=club.mysession.nativeapp;end');
 assert.equal(location.href,undefined);
});
test('Android without Chrome uses the app scheme',()=>assert.equal(new URL(callback('android',undefined,undefined,'Firefox/140').link.href).protocol,'mysession-android:'));
test('Desktop callback remains unchanged',()=>assert.equal(new URL(callback().link.href).protocol,'mysession:'));
test('malformed state never launches app',()=>assert.equal(callback('android','bad').link.href,undefined));
