import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const header = readFileSync(new URL('../src/components/Header.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/SessionsPage.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261021013302_admin_infinite_room_creation.sql', import.meta.url), 'utf8');
test('header create action is text styled, without hover icon swapping', () => {
  assert.doesNotMatch(header, /hoverCreate|create-session-white/);
  assert.match(header, /hidden md:inline-flex items-center gap-2 py-2 text-base/);
});
test('admin gets a separate Infinite creator and can bypass room availability', () => {
  assert.match(page, /isSuperAdmin \|\| !freeFlowRoomAvailable/);
  assert.match(page, /Create infinite room/);
  assert.match(page, /standardCreatorRooms\.map/);
  assert.match(page, /availableFreeFlowRoom && !isSuperAdmin/);
});
test('database exception uses trusted server role and preserves validation', () => {
  assert.match(migration, /not public\.is_app_admin\(\)/);
  assert.match(migration, /Unexpected Free Flow guard definition/);
  assert.doesNotMatch(migration, /user_metadata|disable trigger|disable row level security/i);
});
