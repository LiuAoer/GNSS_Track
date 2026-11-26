import { randomUUID } from 'node:crypto';

export const PRODUCT_SOURCES = {
  sentinel: { title: 'Sentinel-2 L2A', collection: 'sentinel-2-l2a', api: 'https://earth-search.aws.element84.com/v1', url: 'https://registry.opendata.aws/sentinel-2-l2a-cogs/', cloud: true },
  naip: { title: 'NAIP 航空影像', collection: 'naip', api: 'https://planetarycomputer.microsoft.com/api/stac/v1', url: 'https://planetarycomputer.microsoft.com/dataset/naip', cloud: false },
};
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const TTL = 30 * 60 * 1000;
const positive = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function validateSearch(input) {
  const source = input?.source ?? 'sentinel';
  if (!Object.hasOwn(PRODUCT_SOURCES, source)) throw new Error('请选择支持的公开影像来源');
  const startDate = String(input?.startDate ?? ''), endDate = String(input?.endDate ?? '');
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) throw new Error('请选择有效的影像起止日期');
  const maxCloud = Number(input.maxCloud);
  if (!Number.isFinite(maxCloud) || maxCloud < 0 || maxCloud > 100) throw new Error('云量须在 0–100% 之间');
  const geometry = input?.geometry;
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type) || !Array.isArray(geometry.coordinates)) throw new Error('请上传面状 SHP ZIP 或 GeoJSON');
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let count = 0, minLon = Infinity, maxLon = -Infinity;
  if (!polygons.length) throw new Error('AOI 面为空');
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) throw new Error('AOI 面为空');
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error('每个面环至少需要 4 个坐标');
      count += ring.length;
      if (count > 10000) throw new Error('面要素超过 10000 个坐标点，请先简化边界');
      for (const point of ring) {
        if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('AOI 必须为 WGS84 经度/纬度；SHP ZIP 请附带正确的 .prj');
        minLon = Math.min(minLon, point[0]); maxLon = Math.max(maxLon, point[0]);
      }
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error('AOI 面环必须闭合');
      const area = ring.slice(1).reduce((sum, point, index) => sum + ring[index][0] * point[1] - point[0] * ring[index][1], 0);
      if (Math.abs(area) < 1e-12) throw new Error('AOI 面积为空或边界自相交');
    }
  }
  if (maxLon - minLon > 180) throw new Error('跨日期变更线的 AOI 请分成两块查询');
  return { source, startDate, endDate, maxCloud, geometry };
}

function assetUrl(href, source) {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const allowed = source === 'sentinel' ? url.hostname === 'sentinel-cogs.s3.us-west-2.amazonaws.com' : /^naip[a-z0-9]*\.blob\.core\.windows\.net$/.test(url.hostname);
    return allowed ? url.href : null;
  } catch { return null; }
}

export function normalizeProductFeature(item, source) {
  const info = PRODUCT_SOURCES[source], properties = item.properties ?? {};
  if (item.collection !== info.collection || !item.id) return null;
  const assets = Object.entries(item.assets ?? {}).flatMap(([key, asset]) => {
    const href = assetUrl(asset.href, source);
    if (!href || !asset.roles?.includes('data') || !/tiff/i.test(asset.type ?? '')) return [];
    const gsd = positive(asset.gsd) ?? positive(asset['raster:bands']?.[0]?.spatial_resolution) ?? positive(properties.gsd);
    return [{ key, href, title: key === 'visual' ? '真彩色 RGB' : key === 'image' ? 'RGB + 近红外四波段' : asset.title ?? key, gsd }];
  });
  assets.sort((a, b) => (a.key === 'visual' ? -1 : b.key === 'visual' ? 1 : (a.gsd ?? Infinity) - (b.gsd ?? Infinity)));
  if (!assets.length) return null;
  const resolutions = assets.map(asset => asset.gsd).filter(Boolean);
  const cloudCover = properties['eo:cloud_cover'];
  return { id: item.id, source, collectionTitle: info.title, acquisitionDate: properties.datetime ?? properties.start_datetime, gsd: resolutions.length ? Math.min(...resolutions) : null, cloudCover: cloudCover == null || !Number.isFinite(Number(cloudCover)) ? null : Number(cloudCover), assets, sourceUrl: info.url };
}

export function createProductService({ fetcher = fetch, now = Date.now } = {}) {
  const pages = new Map(), downloads = new Map();
  function remember(map, value) {
    for (const [id, entry] of map) if (entry.expiresAt <= now()) map.delete(id);
    while (map.size >= 5000) map.delete(map.keys().next().value);
    const id = randomUUID(); map.set(id, { ...value, expiresAt: now() + TTL }); return id;
  }
  async function jsonRequest(url, options = {}) {
    let response;
    try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(25000) }); }
    catch { const error = new Error('公开影像源连接超时或不可达，请稍后重试'); error.statusCode = 502; throw error; }
    if (!response.ok) { const error = new Error(`公开影像源返回 HTTP ${response.status}，请稍后重试或缩小查询范围`); error.statusCode = 502; throw error; }
    try { return await response.json(); } catch { const error = new Error('公开影像源返回了无效数据'); error.statusCode = 502; throw error; }
  }
  async function search(input) {
    let query, requestBody, requestUrl;
    if (input?.cursor) {
      const next = pages.get(input.cursor);
      if (!next || next.expiresAt <= now()) throw new Error('分页已过期，请重新查询');
      ({ query, requestBody, requestUrl } = next);
    } else {
      query = validateSearch(input);
      const info = PRODUCT_SOURCES[query.source];
      requestUrl = `${info.api}/search`;
      requestBody = { collections: [info.collection], intersects: query.geometry, datetime: `${query.startDate}T00:00:00Z/${query.endDate}T23:59:59.999Z`, limit: 30, sortby: [{ field: 'properties.datetime', direction: 'desc' }], ...(info.cloud ? { query: { 'eo:cloud_cover': { lte: query.maxCloud } } } : {}) };
    }
    const info = PRODUCT_SOURCES[query.source];
    const response = await jsonRequest(requestUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/geo+json, application/json' }, body: JSON.stringify(requestBody) });
    if (!Array.isArray(response.features)) { const error = new Error('公开影像源未返回有效场景列表'); error.statusCode = 502; throw error; }
    const normalized = response.features.map(feature => normalizeProductFeature(feature, query.source)).filter(Boolean);
    const results = [...new Map(normalized.filter(item => {
      const acquired = Date.parse(item.acquisitionDate);
      return acquired >= Date.parse(`${query.startDate}T00:00:00Z`) && acquired <= Date.parse(`${query.endDate}T23:59:59.999Z`) && (!info.cloud || (item.cloudCover != null && item.cloudCover <= query.maxCloud));
    }).map(item => [item.id, item])).values()].map(item => ({ ...item, assets: item.assets.map(({ href, ...asset }) => ({ ...asset, downloadUrl: `/api/products/download/${remember(downloads, { href, source: query.source })}` })) }));
    const next = response.links?.find(link => link.rel === 'next');
    let cursor = null;
    if (next?.href) {
      const url = new URL(next.href, requestUrl), base = new URL(info.api);
      // Only a provider's own search route can become a pagination request.
      if (url.origin === base.origin && url.pathname === `${base.pathname}/search`) {
        const body = { ...requestBody, ...(next.body ?? {}) };
        // GET pagination tokens are moved into the next POST; query constraints remain fixed.
        for (const key of ['token', 'next']) if (url.searchParams.has(key)) body[key] = url.searchParams.get(key);
        cursor = remember(pages, { query, requestBody: body, requestUrl: `${info.api}/search` });
      }
    }
    return { source: query.source, sourceTitle: info.title, results, cursor, scanned: response.features.length, excluded: response.features.length - results.length };
  }
  async function downloadUrl(id) {
    const entry = downloads.get(id);
    if (!entry || entry.expiresAt <= now()) throw new Error('下载入口已过期，请重新查询影像');
    if (entry.source === 'sentinel') return entry.href;
    const result = await jsonRequest(`https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=${encodeURIComponent(entry.href)}`);
    const signed = assetUrl(result.href, entry.source);
    if (!signed || new URL(signed).origin !== new URL(entry.href).origin || new URL(signed).pathname !== new URL(entry.href).pathname) throw new Error('公开影像源未返回有效下载地址，请重试');
    return signed;
  }
  return { search, downloadUrl };
}

const service = createProductService();
async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) { const error = new Error('AOI 请求过大，请简化边界'); error.statusCode = 413; throw error; } chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('请求格式无效'); }
}
export async function productsMiddleware(req, res) {
  const path = new URL(req.url, 'http://localhost').pathname;
  const send = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); };
  try {
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { error: '仅接受同源请求' });
    if (req.method === 'POST' && path === '/api/products/search') return send(200, await service.search(await readJson(req)));
    const match = /^\/api\/products\/download\/([\da-f-]{36})$/i.exec(path);
    if (req.method === 'GET' && match) { const href = await service.downloadUrl(match[1]); res.writeHead(302, { Location: href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); return; }
    return send(404, { error: '接口不存在' });
  } catch (error) { return send(error.statusCode ?? 400, { error: error.message ?? '公开影像查询失败' }); }
}
