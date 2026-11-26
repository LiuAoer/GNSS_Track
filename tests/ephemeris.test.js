import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEphemerisService, SOURCES, REFRESH_MS } from '../server/ephemeris.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/extended-ephemeris.json', import.meta.url)));
const requestCount = new Set(SOURCES.map(s => s.group)).size;
function mockSource() {
  let calls = 0, failed = false;
  return {
    get calls() { return calls; },
    fail() { failed = true; },
    async fetcher(url) {
      calls++;
      if (failed) throw new Error('offline');
      const group = new URL(url).searchParams.get('GROUP');
      const id = SOURCES.find(s => s.group === group).id;
      const records = group === 'stations' ? fixture.groups.filter(g => ['css', 'iss'].includes(g.id)).flatMap(g => g.records) : fixture.groups.find(g => g.id === id).records;
      return { ok: true, json: async () => id === 'qzss' ? [...records, fixture.groups[0].records[0]] : records };
    },
  };
}
test('navigation, stations and remote sources share requests, filter and cache hourly', async () => {
  const source = mockSource(); let clock = Date.parse('2026-10-19T09:00Z');
  const service = createEphemerisService({ fetcher: source.fetcher, now: () => clock, cacheFile: null });
  const [a, b] = await Promise.all([service.get(), service.get()]);
  assert.deepEqual(a, b);
  assert.equal(source.calls, requestCount);
  assert.equal(a.groups.find(g => g.id === 'qzss').records.length, 5);
  assert.deepEqual(a.groups.find(g => g.id === 'css').records.map(r => r.NORAD_CAT_ID), [48274]);
  assert.deepEqual(a.groups.find(g => g.id === 'iss').records.map(r => r.NORAD_CAT_ID), [25544]);
  assert.ok(a.groups.find(g => g.id === 'resource').records.some(r => r.OBJECT_NAME === 'LANDSAT 8'));
  await service.get(); assert.equal(source.calls, requestCount);
  clock += REFRESH_MS + 1;
  await service.get(); assert.equal(source.calls, requestCount * 2);
});
test('failed refresh retains real cache with stale flag and throttles retries', async () => {
  const source = mockSource(); let clock = Date.parse('2026-10-19T09:00Z');
  const service = createEphemerisService({ fetcher: source.fetcher, now: () => clock, cacheFile: null });
  const good = await service.get(); source.fail(); clock += REFRESH_MS + 1;
  const stale = await service.get();
  stale.groups.forEach((g, i) => { assert.equal(g.cache, 'stale'); assert.equal(g.error, 'offline'); assert.deepEqual(g.records, good.groups[i].records); assert.equal(g.fetchedAt, good.groups[i].fetchedAt); });
  await service.get(); assert.equal(source.calls, requestCount * 2);
});
test('cold start upstream failure yields no synthetic records', async () => {
  const service = createEphemerisService({ fetcher: async () => { throw new Error('offline'); }, cacheFile: null });
  const data = await service.get();
  assert.equal(data.groups.length, SOURCES.length);
  assert.ok(data.groups.every(g => g.cache === 'missing' && g.records.length === 0));
});
test('partial source failure retains working constellations', async () => {
  const source = mockSource();
  const service = createEphemerisService({ fetcher: async url => url.includes('GROUP=beidou') ? { ok: false, status: 503 } : source.fetcher(url), cacheFile: null });
  const data = await service.get();
  assert.equal(data.groups[0].records.length, 0);
  assert.ok(data.groups.slice(1).every(g => g.records.length > 0));
});
