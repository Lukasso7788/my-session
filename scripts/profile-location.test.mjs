import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { formatTimeZoneWithPlace, normalizeLocationName, placeFromPhoton, shortPlaceName } from '../src/lib/placeSearch.ts';
import { formatLocalTime } from '../src/lib/timezones.ts';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('a chosen village is saved as settlement and country', () => {
  const place = placeFromPhoton({
    name: 'Lukasheve', osm_value: 'village', county: 'Zaporizhia Raion',
    state: 'Zaporizhia Oblast', country: 'Ukraine',
  });
  assert.equal(place.label, 'Lukasheve, Ukraine');
  // District and region still tell villages with the same name apart in the list.
  assert.equal(place.context, 'Zaporizhia Raion, Zaporizhia Oblast, Ukraine');
});

test('repeated names collapse and non-settlements are skipped', () => {
  assert.equal(placeFromPhoton({ name: 'Ukraine', osm_value: 'country', country: 'Ukraine' }).label, 'Ukraine');
  assert.equal(placeFromPhoton({ name: 'Plot 4', osm_value: 'plot' }), null);
});

test('rooms show only the settlement', () => {
  assert.equal(shortPlaceName('Lukasheve, Ukraine'), 'Lukasheve');
  assert.equal(shortPlaceName('  my  village '), 'my village');
  assert.equal(shortPlaceName(null), '');
});

test('the profile keeps the timezone and adds the settlement only when chosen', () => {
  assert.equal(formatTimeZoneWithPlace('Europe/Kyiv', null), 'Europe/Kyiv');
  assert.equal(formatTimeZoneWithPlace('Europe/Kyiv', 'Lukasheve, Ukraine'), 'Europe/Kyiv · Lukasheve');
  assert.equal(formatTimeZoneWithPlace('America/New_York', ''), 'America/New York');
  for (const page of ['src/pages/ProfilePage.tsx', 'src/pages/PublicProfilePage.tsx']) {
    assert.match(read(page), /formatTimeZoneWithPlace\(timeZone, /, page);
    assert.doesNotMatch(read(page), /MapPin|local time/, page);
  }
});

test('typed locations are trimmed, capped and optional', () => {
  assert.equal(normalizeLocationName('   '), null);
  assert.equal(normalizeLocationName('  Village   by  the sea '), 'Village by the sea');
  assert.equal(normalizeLocationName('x'.repeat(400)).length, 160);
});

test('the room shows the chosen settlement and the local time only', () => {
  const time = formatLocalTime('Europe/Kyiv', Date.UTC(2026, 0, 15, 12, 0));
  assert.match(time, /\d/);
  assert.doesNotMatch(time, /GMT|Kyiv/);
  const label = read('src/pages/livekit/ParticipantTimeLabel.tsx');
  assert.match(label, /formatLocalTime\(timeZone, at\)/);
  assert.match(label, /shortPlaceName\(location\)/);
  const tile = read('src/pages/livekit/VideoTileLiveKitLegacy.tsx');
  assert.equal((tile.match(/userId=\{participantUserId\}/g) || []).length, 2);
  const room = read('src/pages/RoomPageLiveKit.tsx');
  assert.equal((room.match(/participantUserId=\{(t|tile)\.participantUserId \|\| null\}/g) || []).length, 3);
});
