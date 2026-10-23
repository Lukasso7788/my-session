import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = readFileSync(new URL('../src/components/SessionCard.tsx', import.meta.url), 'utf8');
const inline = readFileSync(new URL('../src/components/SessionInlineEdit.tsx', import.meta.url), 'utf8');

test('hosts edit the title and start time in place on the card', () => {
  assert.match(card, /<InlineEditableTitle[\s\S]{0,200}canEdit=\{canEdit\}[\s\S]{0,120}onEditSession\?\.\(session\.id, \{ title \}\)/);
  assert.match(card, /<InlineEditableStart[\s\S]{0,260}canEdit=\{canEdit\}[\s\S]{0,120}onEditSession\?\.\(session\.id, \{ start_time \}\)/);
});

test('a click on an editable title waits so a double-click does not open the details', () => {
  assert.match(card, /canEdit && target\.closest\("\[data-inline-edit\]"\)/);
  assert.match(card, /onDoubleClick=\{\(\) => window\.clearTimeout\(pendingDetailsOpenRef\.current\)\}/);
});

test('inline editing starts on double-click and refuses past start times', () => {
  assert.equal((inline.match(/onDoubleClick=/g) || []).length, 2);
  assert.match(inline, /Pick a time in the future/);
  assert.match(inline, /event\.key === "Escape"/);
});
