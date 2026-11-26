import { json2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js';

export const EARTH_RADIUS_KM = 6378.137;
export const EARTH_SCENE_RADIUS = 1.83;
export const KM_TO_SCENE = EARTH_SCENE_RADIUS / EARTH_RADIUS_KM;
export const MAX_ELEMENT_AGE_DAYS = 14;
export const BDS_ORBIT_TYPES = ['GEO', 'IGSO', 'MEO'];
export const COMPACT_ORBIT_SCALE = 0.36;
// Each orbit uses one scale, preserving its ellipse; low perigees clear the globe.
// Rendering only: propagation, observer geometry and ground tracks stay physical.
export function orbitDisplayScale(sat, compact, scale = COMPACT_ORBIT_SCALE) {
  if (!compact || scale >= 1) return 1;
  const requested = Number.isFinite(scale) ? Math.min(1, Math.max(0.2, scale)) : COMPACT_ORBIT_SCALE;
  const perigee = sat ? sat.semiMajorAxis * (1 - sat.eccentricity) * KM_TO_SCENE : Infinity;
  return Math.max(requested, (EARTH_SCENE_RADIUS + 0.18) / perigee);
}
export function displayPosition(position, compact, sat, scale = COMPACT_ORBIT_SCALE) {
  return position?.map(value => value * orbitDisplayScale(sat, compact, scale)) ?? null;
}
export function isSatelliteVisible(sat, active, bdsTypes = BDS_ORBIT_TYPES, missions = null) {
  return active.includes(sat.system.id) && (sat.system.id !== 'beidou' || bdsTypes.includes(sat.type)) && (satelliteCategory(sat) !== 'remote' || !missions || missions.includes(sat.mission ?? remoteMission(sat.name)));
}
export function orbitLabel(sat) { return sat.system.id === 'qzss' && sat.type === 'IGSO' ? 'QZO' : sat.type; }
export const SYSTEMS = [
  { id: 'beidou', name: '北斗', english: 'BEIDOU', country: '中国', color: '#f5a35c', full: '北斗卫星导航系统' },
  { id: 'gps', name: 'GPS', english: 'GPS', country: '美国', color: '#6aa9f5', full: '全球定位系统' },
  { id: 'galileo', name: '伽利略', english: 'GALILEO', country: '欧盟', color: '#a79af5', full: '伽利略卫星导航系统' },
  { id: 'glonass', name: '格洛纳斯', english: 'GLONASS', country: '俄罗斯', color: '#6ec8ad', full: '格洛纳斯全球导航卫星系统' },
  { id: 'qzss', name: '准天顶', english: 'QZSS', country: '日本', color: '#e392b5', full: '准天顶卫星系统' },
  { id: 'css', name: '中国空间站', english: 'CSS', country: '中国', color: '#ff776e', full: '中国空间站 · 天和核心舱', category: 'stations' },
  { id: 'iss', name: '国际空间站', english: 'ISS', country: '国际合作', color: '#f0d47b', full: '国际空间站 · ISS', category: 'stations' },
  { id: 'resource', name: '地球资源', english: 'RESOURCE', country: '全球', color: '#63d4d2', full: '公开地球资源 / 遥感卫星', category: 'remote' },
  { id: 'weather', name: '气象遥感', english: 'WEATHER', country: '全球', color: '#9ccf79', full: '公开气象遥感卫星', category: 'remote' },
];
export const CATEGORIES = [{ id: 'gnss', name: '导航卫星' }, { id: 'stations', name: '空间站' }, { id: 'remote', name: '遥感卫星' }];
export const satelliteCategory = sat => sat.system.category ?? 'gnss';
export const REMOTE_MISSIONS = [
  { id: 'optical', name: '光学测绘与高分辨率成像', terms: [/LANDSAT|SENTINEL[- ]?2|SPOT|PLEIADES|PNEO|KOMPSAT[- ]?[34]|GAOFEN|BEIJING[- ]?[3]|JILIN|WORLDVIEW|QUICKBIRD|GEOEYE|IKONOS|GÖKTÜRK|GOKTURK|PLANETSAT|DOVE/i] },
  { id: 'sar', name: '合成孔径雷达', terms: [/SENTINEL[- ]?1|RADARSAT|TERRASAR|COSMO[- ]?SKYMED|CAPELLA|ICEYE|SAOCOM|ALOS.*PALSAR|KOMPSAT[- ]?5/i] },
  { id: 'ocean', name: '海洋、水色与测高', terms: [/JASON|SENTINEL[- ]?3|SWOT|HY[- ]?2|OCEANSAT|SARAL|CRYOSAT|ALTIKA|TOPEX|SEASAT/i] },
  { id: 'weather', name: '气象与大气观测', terms: [/NOAA|GOES|METOP|HIMAWARI|FENGYUN|FY[- ]?\d|METEOSAT|DMSP|SUOMI|JPSS|TERRA.*CLOUD|AQUA.*MODIS/i] },
  { id: 'climate', name: '环境与气候监测', terms: [/SMAP|SMOS|GRACE|GOSAT|OCO[- ]?\d|CALIPSO|CLOUDSAT|AURA|ICESAT|EARTHCARE|SCISAT|TANSO|TERRA|AQUA|ENVISAT/i] },
  { id: 'other', name: '其他地球观测', terms: [] },
];
export function remoteMission(recordOrName) {
  const name = typeof recordOrName === 'string' ? recordOrName : recordOrName?.OBJECT_NAME ?? recordOrName?.name ?? '';
  return REMOTE_MISSIONS.find(group => group.terms.some(pattern => pattern.test(name)))?.id ?? 'other';
}
export const ORBIT_NAMES = { LEO: '近地轨道', GEO: '近地球静止轨道', IGSO: '倾斜地球同步轨道', QZO: '准天顶轨道', MEO: '中地球轨道', OTHER: '其他轨道' };

export function epochTime(epoch) { return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(epoch) ? epoch : `${epoch}Z`); }
export function classifyOrbit(record) {
  const period = 86400 / Number(record.MEAN_MOTION);
  if (Math.abs(period - 86164.09) < 1800) return Number(record.INCLINATION) < 5 ? 'GEO' : 'IGSO';
  const a = Math.cbrt(398600.4418 * (period / (2 * Math.PI)) ** 2);
  if (a > EARTH_RADIUS_KM && a - EARTH_RADIUS_KM <= 2000) return 'LEO';
  return a - EARTH_RADIUS_KM > 2000 && a - EARTH_RADIUS_KM < 35786 ? 'MEO' : 'OTHER';
}
export function createCatalog(payload) {
  const records = new Map();
  for (const group of payload.groups ?? []) {
    const system = SYSTEMS.find(item => item.id === group.id);
    if (!system) continue;
    for (const omm of group.records ?? []) {
      const epoch = epochTime(omm.EPOCH ?? '');
      if (!Number.isFinite(epoch) || !Number.isFinite(Number(omm.NORAD_CAT_ID)) || !(Number(omm.MEAN_MOTION) > 0) || !(Number(omm.ECCENTRICITY) >= 0 && Number(omm.ECCENTRICITY) < 1)) continue;
      try {
        // satellite.js expects zone-less UTC in OMM; normalize explicit offsets too.
        const satrec = json2satrec({ ...omm, EPOCH: new Date(epoch).toISOString().slice(0, -1) });
        if (satrec.error !== 0 || ![satrec.jdsatepoch, satrec.no, satrec.inclo, satrec.nodeo, satrec.argpo, satrec.mo].every(Number.isFinite)) continue;
        const periodSeconds = 86400 / omm.MEAN_MOTION;
        const semiMajorAxis = Math.cbrt(398600.4418 * (periodSeconds / (2 * Math.PI)) ** 2);
        const sat = { id: String(omm.NORAD_CAT_ID), noradId: omm.NORAD_CAT_ID, name: omm.OBJECT_NAME, internationalId: omm.OBJECT_ID, system, mission: system.category === 'remote' ? remoteMission(omm.OBJECT_NAME) : null, type: classifyOrbit(omm), epoch, fetchedAt: group.fetchedAt, sourceUrl: group.url, omm, satrec, periodSeconds, semiMajorAxis, altitude: semiMajorAxis - EARTH_RADIUS_KM, inclination: omm.INCLINATION, eccentricity: omm.ECCENTRICITY, raan: omm.RA_OF_ASC_NODE, isBds3: /^BEIDOU-3\s/i.test(omm.OBJECT_NAME) };
        const previous = records.get(sat.id);
        if (!previous || previous.epoch < epoch) records.set(sat.id, sat);
      } catch { /* Invalid upstream elements never become fabricated positions. */ }
    }
  }
  return [...records.values()].sort((a, b) => SYSTEMS.indexOf(a.system) - SYSTEMS.indexOf(b.system) || a.noradId - b.noradId);
}
export function temeToScene(position) { return [position.x * KM_TO_SCENE, position.z * KM_TO_SCENE, -position.y * KM_TO_SCENE]; }
export function elementAgeDays(sat, timestamp) { return Math.abs(timestamp - sat.epoch) / 86400000; }
export function satelliteState(sat, timestamp) {
  if (!sat || !Number.isFinite(timestamp) || elementAgeDays(sat, timestamp) > MAX_ELEMENT_AGE_DAYS) return null;
  const date = new Date(timestamp);
  const result = propagate(sat.satrec, date);
  if (!result?.position || !result?.velocity || sat.satrec.error !== 0) return null;
  const { position, velocity } = result;
  if (![position.x, position.y, position.z, velocity.x, velocity.y, velocity.z].every(Number.isFinite)) return null;
  const geodetic = eciToGeodetic(position, gstime(date));
  return { position, velocity, scene: temeToScene(position), latitude: degreesLat(geodetic.latitude), longitude: degreesLong(geodetic.longitude), altitude: geodetic.height, speed: Math.hypot(velocity.x, velocity.y, velocity.z) };
}
export function positionAt(sat, timestamp) { return satelliteState(sat, timestamp)?.scene ?? null; }
export function orbitPath(sat, timestamp, steps = 160) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const position = positionAt(sat, timestamp + (i / steps - 0.5) * sat.periodSeconds * 1000);
    if (!position) return [];
    points.push(position);
  }
  return points;
}
export function groundTrack(sat, timestamp, hours = 24, steps = 288) {
  const segments = [[]];
  for (let i = 0; i <= steps; i++) {
    const state = satelliteState(sat, timestamp + (i / steps - 0.5) * hours * 3600000);
    if (!state) { if (segments.at(-1).length) segments.push([]); continue; }
    const point = [state.longitude, state.latitude];
    const previous = segments.at(-1).at(-1);
    if (previous && Math.abs(previous[0] - point[0]) > 180) segments.push([]);
    segments.at(-1).push(point);
  }
  return segments.filter(segment => segment.length > 1);
}
export function formatPeriod(sat) {
  const minutes = Math.round(sat.periodSeconds / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}
export function formatUtc(timestamp) { return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; }
