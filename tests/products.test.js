import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductService, normalizeProductFeature, validateSearch } from '../server/products.js';

const polygon = { type: 'Polygon', coordinates: [[[-1, 50], [0, 50], [0, 51], [-1, 51], [-1, 50]]] };
const query = { geometry: polygon, startDate: '2025-01-01', endDate: '2025-12-31', maxCloud: 30, source: 'sentinel' };
const response = body => ({ ok: true, json: async () => body });
function scene(id = 'S2-test', props = {}) {
  return { id, collection: 'sentinel-2-l2a', properties: { datetime: '2025-06-01T00:00:00Z', 'eo:cloud_cover': 12, ...props }, assets: {
    visual: { href: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/test/TCI.tif', roles: ['data'], type: 'image/tiff', gsd: 10 },
    swir: { href: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/test/B11.tif', roles: ['data'], type: 'image/tiff', gsd: 20 },
    thumbnail: { href: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/test/thumb.jpg', roles: ['thumbnail'], type: 'image/jpeg' },
  } };
}

test('public search uses polygon, date and cloud constraints without credentials; downloads preserve band resolutions', async () => {
  const calls = [];
  const service = createProductService({ fetcher: async (url, options) => { calls.push({ url, options }); return response({ features: [scene(), scene('cloudy', { 'eo:cloud_cover': 80 }), scene('old', { datetime: '2020-01-01T00:00:00Z' }), scene('unknown', { 'eo:cloud_cover': null })] }); } });
  const found = await service.search(query);
  assert.equal(found.results.length, 1); assert.equal(found.excluded, 3);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body).intersects, polygon);
  assert.deepEqual(JSON.parse(calls[0].options.body).query, { 'eo:cloud_cover': { lte: 30 } });
  assert.deepEqual(found.results[0].assets.map(asset => asset.gsd), [10, 20]);
  const id = found.results[0].assets[0].downloadUrl.split('/').at(-1);
  assert.equal(await service.downloadUrl(id), scene().assets.visual.href);
  assert.equal(calls.length, 1);
});

test('pagination preserves the search and expired cursors/download tokens fail clearly', async () => {
  let now = 0; const calls = [];
  const service = createProductService({ now: () => now, fetcher: async (url, options) => {
    calls.push(JSON.parse(options.body));
    return response({ features: [scene(`page-${calls.length}`)], links: calls.length === 1 ? [{ rel: 'next', method: 'POST', href: 'https://earth-search.aws.element84.com/v1/search', body: { next: 'page2' } }] : [] });
  } });
  const first = await service.search(query); const second = await service.search({ cursor: first.cursor });
  assert.equal(second.results[0].id, 'page-2'); assert.equal(calls[1].next, 'page2'); assert.deepEqual(calls[1].intersects, polygon);
  now += 31 * 60000;
  await assert.rejects(service.search({ cursor: first.cursor }), /分页已过期/);
  await assert.rejects(service.downloadUrl(first.results[0].assets[0].downloadUrl.split('/').at(-1)), /下载入口已过期/);
});

test('NAIP has no cloud filter and obtains a fresh anonymous SAS only when downloading', async () => {
  const href = 'https://naipeuwest.blob.core.windows.net/naip/test.tif', calls = [];
  const service = createProductService({ fetcher: async (url, options) => {
    calls.push({ url, options });
    return response(url.includes('/sign?') ? { href: `${href}?sig=public-signature` } : { features: [{ id: 'naip-test', collection: 'naip', properties: { datetime: '2025-06-01T00:00:00Z', gsd: 0.6 }, assets: { image: { href, type: 'image/tiff', roles: ['data'] } } }] });
  } });
  const found = await service.search({ ...query, source: 'naip' });
  assert.equal(JSON.parse(calls[0].options.body).query, undefined);
  assert.equal(found.results[0].gsd, 0.6); assert.equal(found.results[0].cloudCover, null);
  assert.equal(calls.length, 1);
  const url = await service.downloadUrl(found.results[0].assets[0].downloadUrl.split('/').at(-1));
  assert.equal(url, `${href}?sig=public-signature`); assert.equal(calls.length, 2);
});

test('invalid AOIs and unsupported sources are rejected; foreign download hosts and thumbnails are excluded', () => {
  assert.throws(() => validateSearch({ ...query, source: 'unknown' }), /支持/);
  assert.throws(() => validateSearch({ ...query, startDate: '2025-02-30' }), /起止日期/);
  assert.throws(() => validateSearch({ ...query, geometry: { type: 'MultiPolygon', coordinates: [[]] } }), /面为空/);
  assert.throws(() => validateSearch({ ...query, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [2, 1]]] } }), /闭合/);
  assert.throws(() => validateSearch({ ...query, geometry: { type: 'Polygon', coordinates: [[[-179, 0], [179, 0], [179, 1], [-179, 1], [-179, 0]]] } }), /日期变更线/);
  const unsafe = scene(); unsafe.assets.visual.href = 'https://localhost/private'; unsafe.assets.swir.href = 'javascript:alert(1)';
  assert.equal(normalizeProductFeature(unsafe, 'sentinel'), null);
});

test('upstream failures remain errors and external pagination URLs are never followed', async () => {
  const service = createProductService({ fetcher: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(service.search(query), /HTTP 503/);
  const source = createProductService({ fetcher: async () => response({ features: [scene()], links: [{ rel: 'next', href: 'https://example.com/private' }] }) });
  assert.equal((await source.search(query)).cursor, null);
});
