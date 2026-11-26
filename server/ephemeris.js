import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { productsMiddleware } from './products.js';

export const SOURCES = [
  { id: 'beidou', group: 'beidou' }, { id: 'gps', group: 'gps-ops' },
  { id: 'galileo', group: 'galileo' }, { id: 'glonass', group: 'glo-ops' },
  { id: 'qzss', group: 'gnss', filter: record => /^(QZS|QZSS|MICHIBIKI)[-\s]/i.test(record.OBJECT_NAME) },
  { id: 'css', group: 'stations', filter: record => Number(record.NORAD_CAT_ID) === 48274 },
  { id: 'iss', group: 'stations', filter: record => Number(record.NORAD_CAT_ID) === 25544 },
  { id: 'resource', group: 'resource' },
  { id: 'weather', group: 'weather' },
];
export const REFRESH_MS = 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const defaultCache = fileURLToPath(new URL('../.cache/ephemeris.json', import.meta.url));
export function validRecord(record) {
  const epoch = typeof record?.EPOCH === 'string' ? record.EPOCH : '';
  const utcEpoch = /[zZ]|[+-]\d\d:\d\d$/.test(epoch) ? epoch : `${epoch}Z`;
  return typeof record?.OBJECT_NAME === 'string' && Number.isInteger(Number(record.NORAD_CAT_ID)) && Number(record.NORAD_CAT_ID) > 0 && Number.isFinite(Date.parse(utcEpoch)) && Number(record.MEAN_MOTION) > 0 && Number(record.ECCENTRICITY) >= 0 && Number(record.ECCENTRICITY) < 1 && Number(record.INCLINATION) >= 0 && Number(record.INCLINATION) <= 180 && ['RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'].every(key => record[key] != null && Number.isFinite(Number(record[key])));
}
export function createEphemerisService({ fetcher = fetch, now = Date.now, cacheFile = defaultCache } = {}) {
  const cached = new Map(), attempts = new Map();
  let initialized = false, pending = null;
  async function loadCache() {
    if (initialized) return;
    initialized = true;
    if (!cacheFile) return;
    try {
      const saved = JSON.parse(await readFile(cacheFile, 'utf8'));
      for (const group of saved.groups ?? []) if (SOURCES.some(source => source.id === group.id) && group.records?.length && group.records.every(validRecord) && Number.isFinite(Date.parse(group.fetchedAt))) cached.set(group.id, group);
    } catch { /* A missing cache is a normal cold start. */ }
  }
  async function update() {
    await loadCache();
    const requests = new Map();
    function request(url) {
      if (!requests.has(url)) requests.set(url, (async () => {
        const response = await fetcher(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', 'User-Agent': 'ORBIT-Satellite-Explorer/3.0' } });
        if (!response.ok) throw new Error(`数据源返回 HTTP ${response.status}`);
        const body = await response.json();
        if (!Array.isArray(body) || !body.length || !body.every(validRecord)) throw new Error('数据源未返回有效的 OMM 轨道要素');
        return body;
      })());
      return requests.get(url);
    }
    const groups = await Promise.all(SOURCES.map(async source => {
      const old = cached.get(source.id);
      const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${source.group}&FORMAT=json`;
      if (old && now() - Date.parse(old.fetchedAt) < REFRESH_MS) return { ...old, cache: 'cached', error: null };
      const last = attempts.get(source.id);
      if (last && now() - last.at < RETRY_MS) return { ...(old ?? { id: source.id, url, records: [], fetchedAt: null }), cache: old ? 'stale' : 'missing', error: last.error };
      try {
        const body = await request(url);
        const records = source.filter ? body.filter(source.filter) : body;
        if (!records.length) throw new Error('数据源未包含该类别的有效卫星');
        const group = { id: source.id, url, fetchedAt: new Date(now()).toISOString(), records };
        cached.set(source.id, group); attempts.set(source.id, { at: now(), error: null });
        return { ...group, cache: 'fresh', error: null };
      } catch (error) {
        const message = error.name === 'TimeoutError' ? '数据源连接超时' : error.message;
        attempts.set(source.id, { at: now(), error: message });
        return { ...(old ?? { id: source.id, url, records: [], fetchedAt: null }), cache: old ? 'stale' : 'missing', error: message };
      }
    }));
    if (cacheFile && cached.size) {
      try {
        await mkdir(resolve(cacheFile, '..'), { recursive: true });
        await writeFile(`${cacheFile}.tmp`, JSON.stringify({ groups: [...cached.values()] }));
        await rename(`${cacheFile}.tmp`, cacheFile);
      } catch (error) { console.error('星历缓存写入失败:', error.message); }
    }
    return { provider: 'CelesTrak', format: 'OMM JSON / SGP4', requestedAt: new Date(now()).toISOString(), refreshIntervalSeconds: REFRESH_MS / 1000, groups };
  }
  return { get: () => { if (!pending) pending = update().finally(() => { pending = null; }); return pending; } };
}
const service = createEphemerisService();
export async function ephemerisMiddleware(req, res) {
  if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return; }
  try {
    const payload = await service.get();
    res.writeHead(payload.groups.some(group => group.records.length) ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload));
  } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '无法载入星历数据' })); }
}
export function ephemerisPlugin() {
  const productRoutes = (req, res, next) => new URL(req.url, 'http://localhost').pathname.startsWith('/api/products/') ? productsMiddleware(req, res) : next();
  return { name: 'orbit-real-ephemeris', configureServer(server) { server.middlewares.use(productRoutes); server.middlewares.use('/api/ephemeris', ephemerisMiddleware); }, configurePreviewServer(server) { server.middlewares.use(productRoutes); server.middlewares.use('/api/ephemeris', ephemerisMiddleware); } };
}
