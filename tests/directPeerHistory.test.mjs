import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['src/lib/directPeerHistory.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {DIRECT_PEER_HISTORY_MS,mergeDirectPeerActivity,recentDirectPeerIds}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const now=Date.parse('2026-11-25T18:00:00Z');
test('24-hour history retains a departed recent correspondent and drops older conversations',()=>{
    assert.deepEqual(recentDirectPeerIds({departed:now-3600000,expired:now-DIRECT_PEER_HISTORY_MS-1,boundary:now-DIRECT_PEER_HISTORY_MS},true,now),['departed','boundary']);
});
test('advancing time expires a peer without needing a new message',()=>{
    const activity={peer:now-DIRECT_PEER_HISTORY_MS+1000};
    assert.deepEqual(recentDirectPeerIds(activity,true,now),['peer']);
    assert.deepEqual(recentDirectPeerIds(activity,true,now+1001),[]);
});
test('a realtime message renews a peer, and late historical responses cannot overwrite it',()=>{
    const live=mergeDirectPeerActivity({peer:now-DIRECT_PEER_HISTORY_MS-1},{peer:now});
    const merged=mergeDirectPeerActivity(live,{peer:now-10000,invalid:NaN});
    assert.equal(merged.peer,now);assert.deepEqual(recentDirectPeerIds(merged,true,now),['peer']);
});
test('finite sessions keep the existing complete correspondent history',()=>{
    assert.deepEqual(recentDirectPeerIds({old:0,recent:now},false,now),['old','recent']);
});
