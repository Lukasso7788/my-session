import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../src/components/ChatPanel.tsx', import.meta.url), 'utf8');

test('read receipts are kept in localStorage, not only for the tab', () => {
  assert.match(chat, /window\.localStorage\.setItem\(readReceiptStorageKey/);
  assert.doesNotMatch(chat, /sessionStorage\.setItem\(\s*readReceiptStorageKey/);
});

test('read receipts are not pruned to the messages currently on screen', () => {
  assert.doesNotMatch(chat, /setReadersByMessage\(prune\)/);
  assert.match(chat, /CHAT_READ_RECEIPT_MAX_MESSAGES/);
});

test('opening a chat view asks the room to resend receipts for my messages', () => {
  assert.match(chat, /event: CHAT_READ_RECEIPT_REQUEST_EVENT,\s*payload: \{ requesterUserId: userId/);
  assert.match(chat, /message\.user_id === requesterUserId &&\s*reportedReadIdsRef\.current\.has\(message\.id\)/);
});
