import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTasksPanelCache, tasksPanelCacheKey, reconcileTasksSnapshot } from '../src/lib/tasksPanelCache.ts';

const task = (id, text = id) => ({ id, text, completed: false });
test('task snapshots are isolated by room and account, never anonymous', () => {
    const cache = createTasksPanelCache();
    cache.write(tasksPanelCacheKey('Room', 'alice'), { tasks: [task('a')] }, 0);
    assert.equal(cache.read(tasksPanelCacheKey('room', 'bob'), 0), undefined);
    assert.equal(cache.read(tasksPanelCacheKey('another', 'alice'), 0), undefined);
    assert.deepEqual(cache.read(tasksPanelCacheKey('room', 'alice'), 0).tasks, [task('a')]);
    assert.equal(tasksPanelCacheKey('room', null), '');
    cache.write('', { tasks: [task('secret')] }, 0);
    assert.equal(cache.read('', 0), undefined);
});
test('cache is bounded and expires, including an authoritative empty task set', () => {
    const cache = createTasksPanelCache(2, 100);
    cache.write('a', { tasks: [] }, 0);
    assert.deepEqual(cache.read('a', 50), { tasks: [] });
    cache.write('b', { tasks: [task('b')] }, 20);
    cache.write('c', { tasks: [task('c')] }, 30);
    assert.equal(cache.read('a', 50), undefined);
    assert.equal(cache.read('b', 120), undefined);
    assert.deepEqual(cache.read('c', 129), { tasks: [task('c')] });
    assert.equal(cache.read('c', 130), undefined);
});
test('updating one room snapshot does not retain unlimited copies', () => {
    const cache = createTasksPanelCache(2);
    cache.write('a', 1, 0); cache.write('b', 2, 0); cache.write('a', 3, 0); cache.write('c', 4, 0);
    assert.equal(cache.read('b', 0), undefined);
    assert.equal(cache.read('a', 0), 3);
});
test('stale task SELECT cannot undo concurrent insertion, editing or deletion', () => {
    const before = [task('a'), task('b')];
    const current = [task('new'), task('a', 'edited')];
    const rows = reconcileTasksSnapshot([task('a'), task('b')], before, current, 120);
    assert.deepEqual(rows.map(r => r.id), ['new', 'a']);
    assert.equal(rows[1].text, 'edited');
});
test('unchanged tasks adopt backend changes but preserve already loaded avatars', () => {
    const before = [{ ...task('a'), profiles: { full_name: 'Anna', avatar_url: 'avatar.png' } }];
    const rows = reconcileTasksSnapshot([task('a', 'updated on another device')], before, before, 80);
    assert.equal(rows[0].text, 'updated on another device');
    assert.deepEqual(rows[0].profiles, before[0].profiles);
});
test('avatar hydration is not an edit and cannot mask a fresh task update', () => {
    const before = [task('a')], current = [{ ...task('a'), profiles: { full_name: 'Anna' } }];
    assert.equal(reconcileTasksSnapshot([task('a', 'new text')], before, current, 80)[0].text, 'new text');
});
test('authoritative empty SELECT removes unchanged cached tasks and respects row limits', () => {
    const before = [task('a')];
    assert.deepEqual(reconcileTasksSnapshot([], before, before, 80), []);
    assert.deepEqual(reconcileTasksSnapshot([], before, [task('new'), task('a')], 80), [task('new')]);
    assert.equal(reconcileTasksSnapshot([task('a'), task('b')], [], [], 1).length, 1);
});
