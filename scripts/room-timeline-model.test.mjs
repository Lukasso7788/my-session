import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    FREE_FLOW_TIMELINE_PRESETS, makeDefaultTimelineBlocks, makeFreeFlowTimelineBlocks,
    getTimelineTotalMinutes, timelineBlocksFromSchedule, timelineBlocksToSchedulePayload,
} from '../src/lib/roomTimelineModel.ts';

test('all Free Flow names, durations and fallback remain unchanged', () => {
    const names = [
        '📈 Ladder · 10→25 min focus - 24/7',
        '⏱️ 30/10 · Focus / Break - 24/7',
        '⚡ 75/15 · Deep Focus / Break - 24/7',
        '🚀 Sprint Stack · 2×25 min focus - 24/7',
        '🌊 Deep Arc · 45→60 min focus - 24/7',
    ];
    assert.deepEqual(FREE_FLOW_TIMELINE_PRESETS.map(p => p.sessionTitle), names);
    assert.deepEqual(FREE_FLOW_TIMELINE_PRESETS.map(p => getTimelineTotalMinutes(makeFreeFlowTimelineBlocks(p.id))), [88, 42, 92, 62, 125]);
    for (const preset of FREE_FLOW_TIMELINE_PRESETS) {
        const blocks = makeFreeFlowTimelineBlocks(preset.id);
        assert.deepEqual(blocks.map(({ id, ...block }) => block), preset.blocks.map(b => ({ ...b, note: b.note || '' })));
        assert.equal(new Set(blocks.map(b => b.id)).size, blocks.length);
        assert.notEqual(blocks[0].id, makeFreeFlowTimelineBlocks(preset.id)[0].id);
    }
    assert.equal(getTimelineTotalMinutes(makeFreeFlowTimelineBlocks('missing')), 88);
});

test('scheduled defaults and legacy durations remain valid', () => {
    assert.equal(getTimelineTotalMinutes(makeDefaultTimelineBlocks()), 126);
    for (const value of ['50/10/5', '50-10-5']) {
        assert.deepEqual(timelineBlocksFromSchedule(value).map(b => [b.kind, b.minutes]),
            [['focus', 50], ['break', 10], ['intentions', 5]]);
    }
    for (const value of [null, '', 'invalid', 'null', {}]) {
        assert.deepEqual(timelineBlocksFromSchedule(value), []);
    }
});

test('array and wrapped schedules preserve titles, minutes, notes and colors', () => {
    const source = [{ title: 'Deep work', duration_seconds: 1500, color: '#123ABC', description: 'Goal' },
        { kind: 'break', minutes: 10, color: 'invalid' }];
    for (const value of [source, JSON.stringify({ data: { blocks: source } })]) {
        const blocks = timelineBlocksFromSchedule(value);
        assert.deepEqual(blocks.map(b => [b.kind, b.title, b.minutes, b.note, b.color]),
            [['focus', 'Deep work', 25, 'Goal', '#123ABC'], ['break', 'Break', 10, undefined, '#FDA4AF']]);
    }
});

test('infinite payload round trip retains the existing anchor and phase semantics', () => {
    const blocks = makeFreeFlowTimelineBlocks('sprint-stack');
    blocks[1].color = '#123ABC';
    const anchor = '2026-09-28T12:00:00.000Z';
    const payload = timelineBlocksToSchedulePayload(blocks, { preserveInfinite: true, anchorTs: anchor });
    assert.equal(payload.kind, 'infinite_room'); assert.equal(payload.anchor_ts, anchor);
    const restored = timelineBlocksFromSchedule(payload);
    assert.deepEqual(restored.map(b => [b.kind, b.title, b.minutes, b.note]), blocks.map(b => [b.kind, b.title, b.minutes, b.note]));
    assert.equal(restored[1].color, '#123ABC');
    assert.equal(getTimelineTotalMinutes(restored), 62);
    assert.ok(Array.isArray(timelineBlocksToSchedulePayload(blocks)));
});

test('renaming a typed block changes only its display title', () => {
    for (const preserveInfinite of [false, true]) {
        const blocks = [
            { id: 'check', kind: 'checkin', title: 'Share your progress', minutes: 2 },
            { id: 'break', kind: 'break', title: 'Get some water', minutes: 10 },
            { id: 'focus', kind: 'focus', title: 'Chapter three', minutes: 25 },
        ];
        const payload = timelineBlocksToSchedulePayload(blocks, { preserveInfinite });
        const saved = preserveInfinite ? payload.timer.phases : payload;
        assert.deepEqual(saved.map(block => [block.kind, block.type, block.name]), [
            ['checkin', 'checkin', 'Share your progress'],
            ['break', 'break', 'Get some water'],
            ['focus', 'focus', 'Chapter three'],
        ]);
        const restored = timelineBlocksFromSchedule(payload);
        assert.deepEqual(restored.map(block => [block.kind, block.title]), blocks.map(block => [block.kind, block.title]));
    }
});
