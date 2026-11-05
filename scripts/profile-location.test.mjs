import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { normalizeLocationName, placeFromPhoton } from '../src/lib/placeSearch.ts';
import { formatLocalTimeInZone } from '../src/lib/timezones.ts';

test('a village keeps its district, region and country', () => {
  const place = placeFromPhoton({
    name: 'Lukasheve', osm_value: 'village', county: 'Zaporizhia Raion',
    state: 'Zaporizhia Oblast', country: 'Ukraine',
  });
  assert.equal(place.label, 'Lukasheve, Zaporizhia Raion, Zaporizhia Oblast, Ukraine');
  assert.equal(place.context, 'Zaporizhia Raion, Zaporizhia Oblast, Ukraine');
});

test('a hamlet keeps its parent town and repeated names collapse', () => {
  const place = placeFromPhoton({ name: 'Kyiv', osm_value: 'city', city: 'Kyiv', state: 'Kyiv', country: 'Ukraine' });
  assert.equal(place.label, 'Kyiv, Ukraine');
  assert.equal(placeFromPhoton({ name: 'Plot 4', osm_value: 'plot' }), null);
});

test('typed locations are trimmed, capped and optional', () => {
  assert.equal(normalizeLocationName('   '), null);
  assert.equal(normalizeLocationName('  Village   by  the sea '), 'Village by the sea');
  assert.equal(normalizeLocationName('x'.repeat(400)).length, 160);
});

test('the room shows local time and zone, never a city taken from the timezone', () => {
  const label = formatLocalTimeInZone('Europe/Kyiv', Date.UTC(2026, 0, 15, 12, 0));
  assert.match(label, /GMT\+2$/);
  assert.doesNotMatch(label, /Kyiv/);
  const tile = readFileSync(new URL('../src/pages/livekit/ParticipantTimeLabel.tsx', import.meta.url), 'utf8');
  assert.match(tile, /formatLocalTimeInZone\(timeZone, at\)/);
});
