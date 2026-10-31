import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/pages/RoomPageLiveKit.tsx', import.meta.url), 'utf8');
const transpile = (text) => ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test('guest volume changes only the local engine, including zero and bounds', () => {
  const body = source.slice(source.indexOf('  const adjustRoomSoundtrackVolume ='), source.indexOf('  const togglePersonalSoundtrack ='));
  const levels = [];
  const state = [];
  const context = {
    canControlRoomSoundtrack: false,
    roomSoundscapeVolumeRef: { current: 35 },
    setRoomSoundscapeVolume: value => state.push(value),
    soundscapeEngineRef: { current: { setVolume: value => levels.push(value) } },
    publishSoundtrackPacket: () => assert.fail('Personal volume must not be broadcast'),
  };
  vm.runInNewContext(transpile(body + '\n[82, 0, 150, -10, NaN].forEach(adjustRoomSoundtrackVolume);'), context);
  assert.deepEqual(state, [82, 0, 100, 0]);
  assert.deepEqual(levels, [0.82, 0, 1, 0]);
});

test('host track updates cannot replace a listener volume', () => {
  const body = source.slice(source.indexOf('    const applyRemoteState ='), source.indexOf('    const onSoundtrackData ='));
  const played = [];
  const context = {
    ROOM_SOUNDSCAPE_OPTIONS: [{ id: 'rain', durationSeconds: 14 }],
    soundscapeStateRef: { current: null },
    setRoomSoundscapeVolume: () => assert.fail('Host must not change personal volume'),
    soundscapeEngineRef: { current: { setVolume: () => assert.fail('Host volume applied') } },
    playSoundscapeLocally: (...args) => { played.push(args); return Promise.resolve(); },
  };
  for (const name of ['setActiveSoundscapeId', 'setCustomSoundscapeLabel', 'setSoundscapePlaying', 'setSoundscapePosition', 'setSoundscapeDuration', 'setSoundscapeError']) context[name] = () => {};
  vm.runInNewContext(transpile(body + '\napplyRemoteState({trackId:"rain", volume:0, updatedAt:Date.now(), position:0, playing:true});'), context);
  assert.equal(played.length, 1);
  assert.equal(played[0].length, 3, 'Playback must not receive the host volume');
});

test('guest music panel enables volume but keeps host playback controls disabled', () => {
  const panel = readFileSync(new URL('../src/pages/livekit/RoomSoundscapePanel.tsx', import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(transpile(panel), {
    exports,
    require: name => name.includes('roomSoundscapes') ? { ROOM_SOUNDSCAPE_OPTIONS: [] } : require(name),
  });
  const html = renderToStaticMarkup(React.createElement(exports.RoomSoundscapePanel, {
    listeningMode: 'room', activeId: 'rain', playing: true, duration: 14,
    currentTime: 0, volume: 82, canControl: false,
  }));
  const volume = html.match(/<input[^>]*aria-label="Your music volume"[^>]*>/)?.[0];
  assert.ok(volume);
  assert.doesNotMatch(volume, /disabled="/);
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Pause"/);
  assert.match(html, /Volume for you/);
});
