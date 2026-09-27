import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { updateTileSpeakingState } from '../src/lib/roomSpeakingState.ts';
import { createPiPAvatarCache } from '../src/lib/pipAvatarCache.ts';
import { createParticipantClock } from '../src/lib/participantClock.ts';

test('speaking updates preserve all unchanged tiles and track references', () => {
    const track = {};
    const tiles = [{ id: 'local', videoTrack: track }, { id: 'remote', isSpeaking: false },
        { id: 'muted', micMuted: true }, { id: 'screen', kind: 'screen' }];
    const next = updateTileSpeakingState(tiles, new Set(['local', 'muted', 'screen']));
    assert.equal(next[0].isSpeaking, true);
    assert.equal(next[0].videoTrack, track);
    assert.equal(next[1], tiles[1]); assert.equal(next[2], tiles[2]); assert.equal(next[3], tiles[3]);
    assert.equal(updateTileSpeakingState(next, new Set(['local'])), next);
    const silent = updateTileSpeakingState(next, new Set());
    assert.equal(silent[0].isSpeaking, false);
    assert.equal(silent[1], next[1]);
    assert.equal(updateTileSpeakingState([], new Set(['missing'])).length, 0);
});

test('actual room speaker listener guards obsolete rooms and pending updater execution', () => {
    const source = readFileSync(new URL('../src/pages/RoomPageLiveKit.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('room.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let call;
    function visit(node) {
        if (ts.isCallExpression(node) && node.arguments[0]?.getText(ast) === 'RoomEvent.ActiveSpeakersChanged') call = node;
        ts.forEachChild(node, visit);
    }
    visit(ast); assert.ok(call);
    const code = ts.transpile(call.getText(ast), { target: ts.ScriptTarget.ES2022 });
    const localParticipant = { sid: 'local-sid' };
    const room = { localParticipant, activeSpeakers: [localParticipant, { sid: 'remote' }],
        on(event, listener) { this.listener = listener; } };
    const roomRef = { current: room }, attemptRef = { current: 1 }, pending = [];
    new Function('r', 'roomRef', 'connectAttemptIdRef', 'attemptId', 'setTiles', 'updateTileSpeakingState', 'RoomEvent', code)(
        room, roomRef, attemptRef, 1, updater => pending.push(updater), updateTileSpeakingState, { ActiveSpeakersChanged: 'speaker' });
    room.listener();
    const current = [{ id: 'local' }, { id: 'remote', micMuted: true }];
    assert.equal(pending[0](current)[0].isSpeaking, true);
    assert.equal(pending[0](current)[1], current[1]);
    attemptRef.current = 2;
    assert.equal(pending[0](current), current);
    room.listener(); assert.equal(pending.length, 1);
    attemptRef.current = 1; roomRef.current = {};
    assert.equal(pending[0](current), current);
    room.listener(); assert.equal(pending.length, 1);
    // A speaking event cannot mutate screen models, subscriptions or audio volume:
    // the tested closure has no full rebuild/media side effects.
    assert.doesNotMatch(code, /refresh\(|rebuild|setVolume|setSubscribed|setScreenShareTiles/);
});

class FakeImage {
    complete = false; naturalWidth = 0; src = ''; onerror = null; onload = null;
    removeAttribute(name) { if (name === 'src') this.src = ''; }
}
function fixture(capacity = 2) {
    const images = [];
    return { images, cache: createPiPAvatarCache(() => { const image = new FakeImage(); images.push(image); return image; }, capacity) };
}
test('PiP cache shares loading requests and keeps actual ready avatars', () => {
    const { images, cache } = fixture();
    assert.equal(cache.get(''), null); assert.equal(images.length, 0);
    assert.equal(cache.get('a'), null); assert.equal(cache.get('a'), null); assert.equal(images.length, 1);
    images[0].complete = true; images[0].naturalWidth = 100;
    assert.equal(cache.get('a'), images[0]); assert.equal(images[0].crossOrigin, 'anonymous');
});
test('PiP LRU eviction releases sources and late failure cannot evict a new entry', () => {
    const { images, cache } = fixture();
    cache.get('a'); const lateError = images[0].onerror;
    cache.get('b'); cache.get('a'); cache.get('c');
    assert.equal(images[1].src, ''); assert.equal(images[0].src, 'a');
    cache.get('b'); cache.get('a');
    const latest = images.at(-1); latest.complete = true; latest.naturalWidth = 100;
    lateError(); assert.equal(cache.get('a'), latest);
    cache.clear(); assert.equal(cache.size, 0);
    assert.ok(images.every(image => image.src === '' && image.onerror === null));
});
test('PiP cache remains bounded over long visits and failure/rejoin', () => {
    const { images, cache } = fixture(64);
    for (let index = 0; index < 1000; index++) cache.get(String(index));
    assert.equal(cache.size, 64); assert.equal(images.filter(image => image.src !== '').length, 64);
    images.at(-1).onerror(); assert.equal(cache.get('999'), null);
    const count = images.length; cache.get('999'); assert.equal(images.length, count);
    cache.clear(); cache.get('999'); assert.equal(images.length, count + 1);
});
test('participant clocks share one timer, stop at last unsubscribe and restart fresh', () => {
    let now = 10, started = 0, stopped = 0, tick;
    const clock = createParticipantClock({ now: () => now,
        start(fn) { tick = fn; return ++started; }, stop() { stopped++; } });
    let calls = 0;
    const unsubscribes = Array.from({ length: 100 }, () => clock.subscribe(() => calls++));
    assert.equal(started, 1);
    now = 60_010; tick(); assert.equal(calls, 100); assert.equal(clock.getSnapshot(), now);
    unsubscribes.slice(0, 99).forEach(unsubscribe => unsubscribe()); assert.equal(stopped, 0);
    unsubscribes[99](); assert.equal(stopped, 1);
    now = 120_010; const unsubscribe = clock.subscribe(() => {});
    assert.equal(started, 2); assert.equal(clock.getSnapshot(), now);
    unsubscribe(); assert.equal(stopped, 2);
});
