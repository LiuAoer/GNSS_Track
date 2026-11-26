import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geodeticToEcf } from 'satellite.js';
import { createCatalog, satelliteState, orbitPath, displayPosition, orbitDisplayScale, EARTH_SCENE_RADIUS } from '../src/data.js';
import { validateObserver, dayStart, lookAnglesFromEcf, visibleSatellites, calculateDay, summarizeDay } from '../src/visibility.js';

const payload = JSON.parse(readFileSync(new URL('./fixtures/extended-ephemeris.json', import.meta.url)));
const catalog = createCatalog(payload), instant = Date.parse('2026-11-23T05:00:00Z');
const observer = { longitude: 116.3974, latitude: 39.9093, height: 0, minElevation: 10 };

test('look angles agree with independent zenith, east horizon and opposite-side geometry', () => {
  const site = { longitude: 0, latitude: 0, height: 0, minElevation: 0 };
  const base = geodeticToEcf({ longitude: 0, latitude: 0, height: 0 });
  const zenith = lookAnglesFromEcf(site, { x: base.x + 400, y: 0, z: 0 });
  assert.ok(Math.abs(zenith.elevation - 90) < 1e-9);
  assert.ok(Math.abs(zenith.range - 400) < 1e-9);
  const east = lookAnglesFromEcf(site, { x: base.x, y: 1000, z: 0 });
  assert.ok(Math.abs(east.elevation) < 1e-9);
  assert.ok(Math.abs(east.azimuth - 90) < 1e-9);
  assert.ok(lookAnglesFromEcf(site, { x: -base.x - 400, y: 0, z: 0 }).elevation < -89.9);
  const elevated = lookAnglesFromEcf({ ...site, height: 1000 }, { x: base.x + 400, y: 0, z: 0 });
  assert.ok(Math.abs(elevated.range - 399) < 1e-9, 'observer height is converted from meters to km');
});

test('observer input and local-day UTC boundaries are validated without implicit timezones', () => {
  assert.equal(dayStart('2026-11-23', 8), Date.parse('2026-11-22T16:00:00Z'));
  assert.equal(dayStart('2026-11-23', -5), Date.parse('2026-11-23T05:00:00Z'));
  for (const change of [{ latitude: 91 }, { longitude: -181 }, { longitude: '' }, { height: -1 }, { minElevation: 'NaN' }, { latitude: null }]) assert.throws(() => validateObserver({ ...observer, ...change }));
  assert.throws(() => dayStart('2026-02-30', 8));
  assert.deepEqual(validateObserver({ ...observer, longitude: '-180', latitude: '90' }), { ...observer, longitude: -180, latitude: 90 });
});

test('both stations and public remote satellites use distinct identities, LEO orbits and safe display scales', () => {
  assert.equal(catalog.filter(s => s.noradId === 41335).length, 1, 'shared Sentinel entry is deduplicated');
  for (const id of [25544, 48274]) {
    const sat = catalog.find(s => s.noradId === id);
    assert.equal(sat.type, 'LEO');
    const state = satelliteState(sat, instant);
    assert.ok(state.altitude > 300 && state.altitude < 500);
    const scale = orbitDisplayScale(sat, true);
    for (const point of orbitPath(sat, instant)) {
      const display = displayPosition(point, true, sat);
      assert.ok(Math.hypot(...display) > EARTH_SCENE_RADIUS + .1);
      assert.ok(Math.abs(Math.hypot(...display) / Math.hypot(...point) - scale) < 1e-12);
      assert.deepEqual(displayPosition(point, false, sat), point);
    }
    const directlyBelow = { latitude: state.latitude, longitude: state.longitude, height: 0, minElevation: 10 };
    const visible = visibleSatellites([sat], directlyBelow, instant);
    assert.equal(visible.rows.length, 1);
    assert.ok(visible.rows[0].elevation > 89.9);
    assert.ok(Math.abs(visible.rows[0].range - state.altitude) < .01);
  }
  assert.ok(catalog.some(s => s.name === 'LANDSAT 8' && s.system.category === 'remote'));
});

test('daily minute samples match instantaneous visibility and respect masks, expiration and local date', () => {
  const sats = catalog.filter(s => ['iss', 'css', 'gps'].includes(s.system.id));
  const result = calculateDay(sats, observer, '2026-11-23', 8);
  assert.equal(result.samples.length, 1440);
  assert.equal(result.hourly.length, 24);
  assert.equal(result.samples[0].timestamp, Date.parse('2026-11-22T16:00:00Z'));
  assert.equal(result.samples.at(-1).timestamp, Date.parse('2026-11-23T15:59:00Z'));
  for (const i of [0, 400, 780, 1439]) {
    const sample = result.samples[i];
    assert.equal(sample.total, visibleSatellites(sats, observer, sample.timestamp).rows.length);
    assert.equal(sample.total, Object.values(sample.counts).reduce((a, b) => a + b, 0));
    assert.equal(sample.available, Object.values(sample.availableBySystem).reduce((a, b) => a + b, 0));
  }
  const lowMask = visibleSatellites(sats, { ...observer, minElevation: 0 }, instant);
  const highMask = visibleSatellites(sats, { ...observer, minElevation: 40 }, instant);
  assert.ok(highMask.rows.every(row => lowMask.rows.some(other => row.sat.id === other.sat.id)));
  const expired = calculateDay(sats, observer, '2027-01-01', 8);
  assert.equal(expired.peak, null);
  assert.deepEqual(expired.best, []);
  assert.ok(expired.hourly.every(hour => hour.average === null));
});

test('best windows rank contiguous half-hours, do not overlap or bridge missing data', () => {
  const samples = Array.from({ length: 1440 }, (_, i) => ({ total: i >= 600 && i < 630 ? 20 : 5, available: i < 60 ? 0 : 30 }));
  const result = summarizeDay(samples);
  assert.equal(result.best[0].startMinute, 600);
  assert.equal(result.best[0].endMinute, 630);
  assert.equal(result.best[0].average, 20);
  assert.equal(result.hourly[0].average, null);
  for (const window of result.best) assert.ok(window.startMinute >= 60);
  for (let i = 0; i < result.best.length; i++) for (let j = i + 1; j < result.best.length; j++) {
    const a = result.best[i], b = result.best[j];
    assert.ok(a.endMinute <= b.startMinute || b.endMinute <= a.startMinute);
  }
  assert.deepEqual(summarizeDay(samples.map(s => ({ ...s, total: 0 }))).best, []);
});
