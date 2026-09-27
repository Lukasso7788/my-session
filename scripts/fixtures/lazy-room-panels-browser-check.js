(async () => {
    const c = window.__roomPerf, checks = [];
    if (!c) throw new Error('Use the isolated room fixture only');
    const assert = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
    const wait = async predicate => {
        const end = Date.now() + 6000;
        while (!predicate()) {
            if (Date.now() > end) throw new Error('Timed out waiting for panel');
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    };
    const resources = name => performance.getEntriesByType('resource').filter(r => r.name.includes(name)).length;
    const button = label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label);
    const named = name => document.querySelector('button[aria-label="' + name + '"]');
    assert(resources('RoomTimelineEditor') === 0 && resources('RoomSoundscapePanel') === 0,
        'optional panel UI modules are not fetched before opening');
    c.showTimeline(); await wait(() => button('Save timeline'));
    assert(resources('RoomTimelineEditor') > 0, 'timeline UI loads on demand');
    assert(!!document.querySelector('h1'), 'room fixture shell remains mounted during lazy loading');
    await wait(() => c.channels.length === 0);
    assert(c.channels.length === 0, 'previous panel channels are removed when editor opens');
    const duration = () => document.querySelector('input[type="number"]').value;
    assert(duration() === '2', 'existing template goal-setting duration preserved');
    named('Increase block duration').click(); await wait(() => duration() === '3');
    assert(duration() === '3', 'actual timeline controls still update the draft');
    button('Save timeline').click(); await wait(() => c.savedTimeline);
    assert(c.savedTimeline.timer.phases[0].minutes === 3, 'save callback receives edited timeline');
    assert(c.savedTimeline.anchor_ts === '2026-09-28T12:00:00.000Z', 'infinite anchor retained');
    const loadedEditor = resources('RoomTimelineEditor');
    c.showTimeline(); await wait(() => button('Save timeline'));
    assert(duration() === '3', 'reopening editor keeps parent-owned draft');
    assert(resources('RoomTimelineEditor') === loadedEditor, 'editor module is not fetched again on reopen');
    button('Cancel').click(); await wait(() => !button('Save timeline'));
    assert(!button('Save timeline'), 'editor cancel closes normally');
    c.showMusic(); await wait(() => named('Play'));
    assert(resources('RoomSoundscapePanel') > 0, 'music UI loads on demand');
    assert(named('Play').disabled, 'Play stays disabled until a track is selected');
    named('Next track').click(); await wait(() => !named('Play').disabled);
    assert(c.panelActions.some(action => action[0] === 'select'), 'track selection callback works');
    named('Play').click(); await wait(() => named('Pause'));
    assert(c.panelActions.some(action => action[0] === 'toggle'), 'Play callback works');
    const loadedMusic = resources('RoomSoundscapePanel');
    named('Close music panel').click(); await wait(() => !named('Pause'));
    c.showMusic(); await wait(() => named('Pause'));
    assert(resources('RoomSoundscapePanel') === loadedMusic, 'music module is reused on reopen');
    assert(!named('Pause').disabled, 'music state survives panel close/reopen');
    named('Pause').click(); await wait(() => named('Play'));
    assert(c.panelActions.filter(action => action[0] === 'toggle').length === 2, 'Pause dispatches exactly once');
    named('Close music panel').click(); await wait(() => !named('Play'));
    assert(window.__consoleErrors.length === 0, 'lazy panel flows have no uncaught errors');
    assert(c.channels.length === 0, 'no realtime channels retained by optional controls');
    window.__lazyPanelResults = checks;
    return checks;
})()
