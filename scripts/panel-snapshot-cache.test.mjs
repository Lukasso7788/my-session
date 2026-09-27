import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPanelSnapshotCache } from '../src/lib/panelSnapshotCache.ts';

test('a cache miss sweeps all expired rooms, not just the requested key', () => {
    const cache = createPanelSnapshotCache(4, 100);
    cache.write('old-room|alice', { messages: ['old'] }, 0);
    cache.write('warm-room|alice', { messages: ['warm'] }, 50);
    assert.equal(cache.size, 2);
    assert.equal(cache.read('another-room|alice', 100), undefined);
    assert.equal(cache.size, 1);
    assert.deepEqual(cache.read('warm-room|alice', 100), { messages: ['warm'] });
});

test('writing a snapshot releases expired references in unrelated rooms', () => {
    const cache = createPanelSnapshotCache(4, 100);
    cache.write('old', { profiles: { anna: { full_name: 'Anna' } } }, 0);
    cache.write('new', {}, 100);
    assert.equal(cache.size, 1);
    assert.equal(cache.read('old', 100), undefined);
});

test('warm snapshots preserve names, avatars, reactions and empty results by reference', () => {
    const cache = createPanelSnapshotCache(4, 100);
    const snapshot = { messages: [], profiles: { anna: { full_name: 'Anna', avatar_url: 'anna.png' } }, reactions: {} };
    cache.write('room|alice|general', snapshot, 0);
    assert.equal(cache.read('room|alice|general', 99), snapshot);
    assert.equal(cache.read('room|bob|general', 99), undefined);
    assert.equal(cache.read('room|alice|direct', 99), undefined);
    assert.equal(cache.read('room|alice|general', 100), undefined);
    assert.equal(cache.size, 0);
});

test('reads do not extend TTL and updated snapshots are evicted last', () => {
    const cache = createPanelSnapshotCache(2, 100);
    cache.write('a', 1, 0); cache.write('b', 2, 10);
    cache.read('a', 20); cache.write('a', 3, 30); cache.write('c', 4, 40);
    assert.equal(cache.read('b', 40), undefined);
    assert.equal(cache.read('a', 129), 3);
    assert.equal(cache.read('a', 130), undefined);
});

test('empty scope cannot retain private data and zero capacity retains no snapshots', () => {
    const cache = createPanelSnapshotCache(0);
    cache.write('', { secret: true }, 0); cache.write('a', {}, 0);
    assert.equal(cache.size, 0);
    assert.equal(cache.read('a', 0), undefined);
});
