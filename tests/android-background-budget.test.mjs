import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('Android background bounds inference, reuses composed frames and releases cache', async () => {
  let calls = 0;
  let options;
  let clock = 1000;
  class Frame {
    constructor(source, init = {}) { Object.assign(this, { displayWidth: source.displayWidth ?? source.width, displayHeight: source.displayHeight ?? source.height, timestamp: 1 }, init); }
    clone() { return new Frame(this); }
    close() { this.closed = true; }
  }
  class Background {
    constructor(opts) { options = opts; }
    async transform(frame, controller) { calls++; controller.enqueue(frame); }
    async update() {}
    async destroy() {}
  }
  class Wrapper { constructor(transformer) { this.transformer = transformer; } }
  const exports = {};
  const context = { exports, require: (name) => name === '@livekit/track-processors'
    ? { BackgroundTransformer: Background, ProcessorWrapper: Wrapper }
    : { normalizePublishedColorCorrection: x => x, isPublishedColorCorrectionIdentity: () => true },
    navigator: { userAgent: 'Android; wv' }, performance: { now: () => clock }, setTimeout,
    VideoFrame: Frame, OffscreenCanvas: class { constructor(width,height) { this.width=width;this.height=height; } getContext() { return { drawImage() {} }; } } };
  const source = fs.readFileSync(new URL('../src/pages/livekit/PersonColorCorrectionProcessor.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const transformer = new exports.PersonColorBackgroundProcessor({mode:'virtual-background',imagePath:'image'}, {}).transformer;
  const output = [];
  const sink = { enqueue: frame => output.push(frame) };
  const input = new Frame({width:1920,height:1080});
  await transformer.transform(input,sink);
  assert.equal(options.segmenterOptions?.delegate,undefined, 'keep LiveKit GPU default for WebGL texture masks');
  assert.equal(output[0].displayWidth,480);
  assert.equal(input.closed,true);
  clock += 50;
  await transformer.transform(new Frame({width:1920,height:1080},{timestamp:2}),sink);
  assert.equal(calls,1);
  assert.equal(output[1].timestamp,2);
  clock += 200;
  await transformer.transform(new Frame({width:1920,height:1080}),sink);
  assert.equal(calls,2);
  const previousCache = transformer.cachedFrame;
  await transformer.update({ imagePath: 'new-image' });
  assert.equal(previousCache.closed, true);
  assert.equal(transformer.cachedFrame, undefined);
  await transformer.transform(new Frame({width:1920,height:1080}),sink);
  assert.equal(calls,3, 'effect changes immediately produce a fresh composition');
  const cache = transformer.cachedFrame;
  await transformer.destroy();
  assert.equal(cache.closed,true);
});
