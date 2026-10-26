import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const gate = readFileSync(new URL('../src/components/TermsAgreementGate.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

test('every account must tick the box before it can continue', () => {
  assert.match(main, /<TermsAgreementGate \/>/);
  assert.match(gate, /disabled=\{!agreed \|\| saving\}/);
  assert.match(gate, /type="checkbox"/);
  // No exemption for older accounts.
  assert.doesNotMatch(gate, /TERMS_GATE_SINCE|created_at/);
});

test('the agreement is saved on the account with its time and version, and a new version asks again', () => {
  assert.match(gate, /supabase\.auth\.updateUser\(\{\s*data: \{ terms_accepted_at: now, terms_version: TERMS_VERSION \},/);
  assert.match(gate, /return !metadata\.terms_accepted_at \|\| metadata\.terms_version !== TERMS_VERSION;/);
});

test('the rules, terms and privacy pages stay readable while the agreement is open', () => {
  assert.match(gate, /terms\|privacy\|rules/);
  for (const href of ['/rules', '/terms', '/privacy']) assert.match(gate, new RegExp(`href: "${href}"`));
  assert.match(gate, /target="_blank"/);
});
