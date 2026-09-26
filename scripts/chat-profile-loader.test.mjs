import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatProfileLoader } from '../src/lib/chatProfileLoader.ts';

const profile = (id) => ({ id, full_name: `Name ${id}`, avatar_url: `https://example.test/${id}.png` });

test('overlapping message loads share author queries and wait for real names and avatar URLs', async () => {
    let resolve;
    const calls = [];
    const loader = createChatProfileLoader(async (ids) => {
        calls.push(ids);
        await new Promise((done) => { resolve = done; });
        return ids.map(profile);
    });
    let ready = false;
    const first = loader.ensure(['a', 'b', 'a']).then((profiles) => { ready = true; return profiles; });
    const second = loader.ensure(['a']);
    await Promise.resolve();
    assert.equal(ready, false);
    assert.deepEqual(calls, [['a', 'b']]);
    resolve();
    assert.deepEqual(await first, { a: profile('a'), b: profile('b') });
    assert.deepEqual(await second, { a: profile('a') });
    await loader.ensure(['a', 'b']);
    assert.equal(calls.length, 1);
});

test('a transient profile failure retries once, then returns the actual author', async () => {
    let calls = 0;
    const loader = createChatProfileLoader(async (ids) => {
        if (++calls === 1) throw new Error('Temporary network failure');
        return ids.map(profile);
    });
    assert.deepEqual(await loader.ensure(['a']), { a: profile('a') });
    assert.equal(calls, 2);
});

test('persistent failure is bounded and does not poison the cache; explicit retry recovers', async () => {
    let fails = true, calls = 0;
    const loader = createChatProfileLoader(async (ids) => {
        calls++;
        if (fails) throw new Error('Offline');
        return ids.map(profile);
    });
    await assert.rejects(loader.ensure(['a']), /Offline/);
    assert.equal(calls, 2);
    assert.deepEqual(loader.snapshot(), {});
    fails = false;
    assert.deepEqual(await loader.ensure(['a']), { a: profile('a') });
    assert.equal(calls, 3);
});

test('missing rows are retryable; successfully resolved authors are not read again', async () => {
    const calls = [];
    let missing = true;
    const loader = createChatProfileLoader(async (ids) => {
        calls.push(ids);
        return ids.filter((id) => id !== 'b' || !missing).map(profile);
    });
    await assert.rejects(loader.ensure(['a', 'b']), /unavailable/);
    assert.deepEqual(calls, [['a', 'b'], ['b']]);
    assert.deepEqual(loader.snapshot(), { a: profile('a') });
    missing = false;
    assert.deepEqual(await loader.ensure(['a', 'b']), { a: profile('a'), b: profile('b') });
    assert.deepEqual(calls.at(-1), ['b']);
});

test('only confirmed cache entries are seeded; older view caches cannot replace a newer profile', async () => {
    let calls = 0;
    const loader = createChatProfileLoader(async (ids) => { calls++; return ids.map(profile); });
    await loader.ensure(['a']);
    loader.seed({ a: { id: 'a', full_name: 'Old name', avatar_url: null } });
    assert.deepEqual(await loader.ensure(['a']), { a: profile('a') });
    assert.equal(calls, 1);
    const restored = createChatProfileLoader(async () => { throw new Error('Should use cache'); });
    restored.seed(loader.snapshot());
    assert.deepEqual(await restored.ensure(['a']), { a: profile('a') });
});
