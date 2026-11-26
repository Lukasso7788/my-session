import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/pages/RoomPageLiveKit.tsx',import.meta.url),'utf8');
test('hidden prejoin cannot create a room recovery lease',()=>{
 const handler=source.slice(source.indexOf('    const markHidden = () => {'),source.indexOf('    const markVisible = () => {'));
 const guard=handler.indexOf('if (prejoinOpenRef.current || (!joinRequestedRef.current && !connectedRef.current)) return;');
 assert.ok(guard>=0);
 assert.ok(guard<handler.indexOf('returningFromBackgroundRef.current = true'));
 assert.ok(guard<handler.indexOf('writeMobileRoomLease('));
});
test('all resume/retry entry points respect the open prejoin gate',()=>{
 for(const signature of ['const markVisible = () => {','const scheduleRecoveryRetry = () => {','const restoreFromLease = (resetBackoff = true) => {']) {
  const start=source.indexOf(signature);assert.ok(start>=0);
  assert.match(source.slice(start,start+230),/if \(prejoinOpenRef.current\) return;/);
 }
 const restore=source.slice(source.indexOf('  const restoreMobileMediaFromBackground = async ('),source.indexOf('  const restoreMobileMediaFromBackground = async (')+240);
 assert.match(restore,/if \(prejoinOpenRef.current\) return;/);
});
