import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { twoline2satrec, sgp4 } from 'satellite.js';
import { createCatalog, satelliteState, groundTrack, epochTime, elementAgeDays, EARTH_SCENE_RADIUS, EARTH_RADIUS_KM, temeToScene, displayPosition, COMPACT_ORBIT_SCALE, orbitLabel, orbitPath } from '../src/data.js';
const payload = JSON.parse(readFileSync(new URL('./fixtures/ephemeris.json', import.meta.url)));
const catalog = createCatalog(payload);
const time = Date.parse('2026-10-19T08:45:00Z');
const sat = id => catalog.find(s => s.noradId === id);

test('SGP4 matches Vallado verification case 00005 at epoch, with correct scene axes', () => {
  const rec = twoline2satrec('1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753', '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667');
  const { position } = sgp4(rec, 0);
  const expected = [7022.46529266, -1400.08296755, 0.03995155];
  Object.values(position).forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 0.0001));
  const scene = temeToScene(position);
  assert.ok(Math.abs(scene[1] - position.z * EARTH_SCENE_RADIUS / EARTH_RADIUS_KM) < 1e-12);
  assert.ok(scene[2] > 0);
});
test('OMM epochs are UTC, catalog uses actual NORAD and excludes expired propagation', () => {
  assert.equal(epochTime('2026-10-19T08:45:00'), time);
  assert.equal(epochTime('2026-10-19T08:45:00Z'), time);
  assert.equal(catalog.length, 151);
  assert.equal(sat(43001).inclination, 56.8026);
  assert.equal(satelliteState(sat(44542), time), null);
  assert.ok(elementAgeDays(sat(44542), time) > 14);
  assert.equal(satelliteState(sat(43001), time + 30 * 86400000), null);
  assert.equal(catalog.filter(s => s.isBds3).length, 35);
});
test('actual near GEO stays near its ground longitude; inclination is not forced to zero', () => {
  const s = sat(43683), points = groundTrack(s, time).flat();
  assert.equal(s.type, 'GEO');
  assert.ok(s.inclination > 2);
  const lons = points.map(p => p[0]);
  assert.ok(Math.max(...lons) - Math.min(...lons) < 0.2);
  assert.ok(Math.abs(satelliteState(s, time).altitude - 35786) < 100);
});
test('IGSO ground track returns daily and crosses near the same central longitude twice', () => {
  const s = sat(44204), points = groundTrack(s, time).flat();
  assert.equal(s.type, 'IGSO');
  assert.ok(Math.max(...points.map(p => p[1])) > 55);
  assert.ok(Math.min(...points.map(p => p[1])) < -55);
  const crossings = points.filter(p => Math.abs(p[1]) < 1.5).map(p => p[0]);
  assert.ok(crossings.length >= 2);
  assert.ok(Math.max(...crossings) - Math.min(...crossings) < 3);
});
test('QZSS retains elliptical orbit with over 6000 km radial variation', () => {
  const s = sat(42738);
  assert.ok(s.eccentricity > 0.07);
  const radii = Array.from({ length: 97 }, (_, i) => {
    const p = satelliteState(s, time + i / 96 * 86400000).position;
    return Math.hypot(p.x, p.y, p.z);
  });
  assert.ok(Math.max(...radii) - Math.min(...radii) > 6000);
  assert.equal(sat(42917).type, 'GEO');
});
test('Earth and MEO use the same distance scale and ground tracks split at the dateline', () => {
  const s = sat(43001), state = satelliteState(s, time);
  const ratio = Math.hypot(...state.scene) / EARTH_SCENE_RADIUS;
  assert.ok(ratio > 4.3 && ratio < 4.5);
  assert.ok(Math.abs(state.latitude) <= s.inclination + 0.1);
  const segments = groundTrack(s, time);
  assert.ok(segments.length > 1);
  for (const segment of segments) for (let i = 1; i < segment.length; i++) assert.ok(Math.abs(segment[i][0] - segment[i - 1][0]) <= 180);
});

test('OMM with explicit UTC suffix produces the same orbit and malformed fields are rejected', () => {
  const original = payload.groups[0].records[0];
  const withZone = { ...original, EPOCH: original.EPOCH + 'Z' };
  const get = record => createCatalog({ groups: [{ id: 'beidou', records: [record] }] });
  const a = satelliteState(get(original)[0], time);
  const b = satelliteState(get(withZone)[0], time);
  assert.deepEqual(a.position, b.position);
  assert.equal(get({ ...original, INCLINATION: 'invalid' }).length, 0);
});


test('all five constellations retain measured orientation and phase, including non-nominal Galileo orbits', () => {
  for (const s of catalog) {
    for (const [key, field] of [['inclo', 'INCLINATION'], ['nodeo', 'RA_OF_ASC_NODE'], ['argpo', 'ARG_OF_PERICENTER'], ['mo', 'MEAN_ANOMALY']]) {
      assert.ok(Math.abs(s.satrec[key] - Number(s.omm[field]) * Math.PI / 180) < 1e-12, `${s.name}: ${field}`);
    }
    assert.equal(s.satrec.ecco, Number(s.omm.ECCENTRICITY));
  }
  const valid = catalog.filter(s => satelliteState(s, time));
  for (const [system, altitude, inclination, hours] of [['gps', [20100, 20300], [53, 58], [11.9, 12]], ['glonass', [19000, 19200], [63, 66], [11.2, 11.3]]]) {
    for (const s of valid.filter(s => s.system.id === system)) {
      assert.ok(s.altitude > altitude[0] && s.altitude < altitude[1]);
      assert.ok(s.inclination > inclination[0] && s.inclination < inclination[1]);
      assert.ok(s.periodSeconds / 3600 > hours[0] && s.periodSeconds / 3600 < hours[1]);
    }
  }
  const galileo = valid.filter(s => s.system.id === 'galileo');
  const eccentric = galileo.filter(s => s.eccentricity > .1);
  assert.equal(eccentric.length, 2);
  assert.ok(eccentric.every(s => /GSAT020[12]/.test(s.name) && s.inclination > 48 && s.inclination < 50));
  assert.ok(galileo.filter(s => s.eccentricity < .1).every(s => Math.abs(s.altitude - 23222) < 20 && s.periodSeconds / 3600 > 14 && s.periodSeconds / 3600 < 14.1));
});

test('QZSS QZO has northern apogee, longer northern dwell and Asian ground tracks; GEO remains distinct', () => {
  const qzss = catalog.filter(s => s.system.id === 'qzss' && satelliteState(s, time));
  assert.equal(qzss.filter(s => orbitLabel(s) === 'QZO').length, 3);
  assert.equal(qzss.filter(s => orbitLabel(s) === 'GEO').length, 2);
  for (const s of qzss.filter(s => orbitLabel(s) === 'QZO')) {
    const states = Array.from({ length: 360 }, (_, i) => satelliteState(s, time + i / 360 * s.periodSeconds * 1000));
    const radius = p => Math.hypot(p.position.x, p.position.y, p.position.z);
    const sorted = [...states].sort((a, b) => radius(a) - radius(b));
    assert.ok(sorted[0].latitude < -35 && sorted.at(-1).latitude > 35);
    assert.ok(states.filter(p => p.latitude > 0).length / states.length > .54);
    assert.ok(states.every(p => p.longitude > 120 && p.longitude < 155));
    assert.ok(s.inclination > 37 && s.inclination < 42 && Math.abs(s.omm.ARG_OF_PERICENTER - 270) < 2);
  }
});

test('compact rendering uniformly scales real ellipses without altering physical state or ground tracks', () => {
  for (const s of [sat(43001), sat(42738), sat(42917), ...catalog.filter(s => s.system.id === 'galileo' && s.eccentricity > .1)]) {
    const before = satelliteState(s, time), track = groundTrack(s, time);
    const points = orbitPath(s, time), compact = points.map(p => displayPosition(p, true));
    points.forEach((p, i) => {
      assert.deepEqual(displayPosition(p, false), p);
      assert.ok(Math.hypot(...compact[i]) > EARTH_SCENE_RADIUS + 0.2, `${s.name}: compact orbit clears Earth`);
      assert.ok(Math.abs(Math.hypot(...compact[i]) / Math.hypot(...p) - COMPACT_ORBIT_SCALE) < 1e-12);
      p.forEach((v, axis) => assert.ok(Math.abs(compact[i][axis] - v * COMPACT_ORBIT_SCALE) < 1e-12));
    });
    const radii = points.map(p => Math.hypot(...p)), reduced = compact.map(p => Math.hypot(...p));
    const e = rs => (Math.max(...rs) - Math.min(...rs)) / (Math.max(...rs) + Math.min(...rs));
    assert.ok(Math.abs(e(radii) - e(reduced)) < 1e-12);
    assert.deepEqual(satelliteState(s, time), before);
    assert.deepEqual(groundTrack(s, time), track);
  }
});
