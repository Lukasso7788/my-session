import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const header = readFileSync(new URL('../src/components/Header.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/SessionsPage.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261021013302_admin_infinite_room_creation.sql', import.meta.url), 'utf8');
test('header create action keeps the outlined pill', () => {
  assert.match(header, /hidden md:inline-flex items-center gap-2 px-6 py-3 rounded-full/);
  assert.match(header, /border-\[#2F2F2F\]/);
  assert.doesNotMatch(header, /mysession:open-infinite-room-creator/);
});
test('admins switch between a group session and a 24/7 room', () => {
  const modal = readFileSync(new URL('../src/components/CreateSessionModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /isAppAdmin \? \(\s*<CreateKindSwitch\s+value="group"/);
  assert.match(page, /<CreateKindSwitch\s+value="infinite"/);
  assert.match(page, /takePendingInfiniteRoomCreator\(\)/);
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
