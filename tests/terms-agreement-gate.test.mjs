import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const gate = readFileSync(new URL('../src/components/TermsAgreementGate.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

test('new accounts must tick the box before they can continue', () => {
  assert.match(main, /<TermsAgreementGate \/>/);
  assert.match(gate, /disabled=\{!agreed \|\| saving\}/);
  assert.match(gate, /type="checkbox"/);
});

test('the agreement is saved on the account with its time and version', () => {
  assert.match(gate, /supabase\.auth\.updateUser\(\{\s*data: \{ terms_accepted_at: now, terms_version: TERMS_VERSION \},/);
  assert.match(gate, /if \(user\.user_metadata\?\.terms_accepted_at\) return false;/);
});

test('the rules, terms and privacy pages stay readable while the agreement is open', () => {
  assert.match(gate, /terms\|privacy\|rules/);
  for (const href of ['/rules', '/terms', '/privacy']) assert.match(gate, new RegExp(`href="${href}"`));
});
