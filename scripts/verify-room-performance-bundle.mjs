import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { init, parse } from 'es-module-lexer';

// Verify the actual production import graph, not merely source import syntax.
await init;
const directory = new URL('../dist/assets/', import.meta.url);
const files = await readdir(directory);
const room = files.find((file) => /^RoomPageLiveKit-[^.]+\.js$/.test(file));
const processor = files.find((file) => /^PersonColorCorrectionProcessor-[^.]+\.js$/.test(file));
assert.ok(room && processor, 'Build the application before checking lazy effects');
async function staticGraph(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const code = await readFile(new URL(entry, directory), 'utf8');
  for (const item of parse(code)[0]) {
    if (item.d === -1 && item.n?.startsWith('./') && item.n.endsWith('.js')) {
      await staticGraph(item.n.slice(2), seen);
    }
  }
  return seen;
}
const roomGraph = await staticGraph(room);
assert.equal(roomGraph.has(processor), false, 'Effect processors must not be eagerly loaded with the room');
const deferredPanels = [];
for (const name of ['RoomTimelineEditor', 'RoomSoundscapePanel']) {
  const file = files.find(file => file.startsWith(name + '-') && file.endsWith('.js'));
  assert.ok(file, name + ' must have a lazy build chunk');
  assert.equal(roomGraph.has(file), false, name + ' must not be an eager room dependency');
  const code = await readFile(new URL(file, directory));
  deferredPanels.push({ file, bytes: code.byteLength, gzipBytes: gzipSync(code).byteLength });
}
const effectOnly = [...await staticGraph(processor)].filter((file) => !roomGraph.has(file));
let bytes = 0, gzipBytes = 0;
for (const file of effectOnly) {
  const code = await readFile(new URL(file, directory));
  bytes += code.byteLength;
  gzipBytes += gzipSync(code).byteLength;
}
console.log(JSON.stringify({ room, deferredPanels, lazyEffectFiles: effectOnly, deferredBytes: bytes, deferredGzipBytes: gzipBytes }));
