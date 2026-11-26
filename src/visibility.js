import { propagate, gstime, eciToEcf, ecfToLookAngles } from 'satellite.js';
import { elementAgeDays, MAX_ELEMENT_AGE_DAYS, satelliteState } from './data.js';

const DEG = Math.PI / 180;
export function validateObserver(input) {
  const limits = { latitude: [-90, 90], longitude: [-180, 180], height: [0, 10000], minElevation: [0, 90] };
  const labels = { latitude: '纬度', longitude: '经度', height: '海拔', minElevation: '最低仰角' };
  const observer = {};
  for (const [key, [min, max]] of Object.entries(limits)) {
    const value = input[key];
    if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) {
      throw new Error(`${labels[key]}须在 ${min}～${max} 之间`);
    }
    observer[key] = Number(value);
  }
  return observer;
}

export function dayStart(date, utcOffset) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(utcOffset) || utcOffset < -12 || utcOffset > 14) throw new Error('请选择有效日期和时区');
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date) throw new Error('日期无效');
  return midnight - utcOffset * 3600000;
}

export function observerGeodetic(observer) {
  return { longitude: observer.longitude * DEG, latitude: observer.latitude * DEG, height: observer.height / 1000 };
}

export function lookAnglesFromEcf(observer, ecf) {
  const result = ecfToLookAngles(observerGeodetic(observer), ecf);
  return { azimuth: (result.azimuth / DEG + 360) % 360, elevation: result.elevation / DEG, range: result.rangeSat };
}

export function visibleSatellites(satellites, observer, timestamp) {
  const gmst = gstime(new Date(timestamp));
  let available = 0;
  const availableBySystem = {};
  const rows = [];
  for (const sat of satellites) {
    const state = satelliteState(sat, timestamp);
    if (!state) continue;
    available++;
    availableBySystem[sat.system.id] = (availableBySystem[sat.system.id] ?? 0) + 1;
    const angles = lookAnglesFromEcf(observer, eciToEcf(state.position, gmst));
    if (angles.elevation >= observer.minElevation) rows.push({ sat, ...angles, altitude: state.altitude, speed: state.speed });
  }
  return { rows: rows.sort((a, b) => b.elevation - a.elevation), available, availableBySystem, unavailable: satellites.length - available };
}

export function summarizeDay(samples, windowMinutes = 30) {
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const values = samples.slice(hour * 60, (hour + 1) * 60);
    const valid = values.filter(value => value.available > 0);
    return { hour, min: valid.length ? Math.min(...valid.map(v => v.total)) : null, max: valid.length ? Math.max(...valid.map(v => v.total)) : null, average: valid.length ? valid.reduce((sum, v) => sum + v.total, 0) / valid.length : null, validMinutes: valid.length };
  });
  const candidates = [];
  for (let start = 0; start + windowMinutes <= samples.length; start++) {
    const window = samples.slice(start, start + windowMinutes);
    if (window.some(s => s.available === 0)) continue;
    const total = window.reduce((sum, s) => sum + s.total, 0);
    if (!total) continue;
    candidates.push({ startMinute: start, endMinute: start + windowMinutes, average: total / windowMinutes, min: Math.min(...window.map(s => s.total)), max: Math.max(...window.map(s => s.total)) });
  }
  candidates.sort((a, b) => b.average - a.average || b.min - a.min || a.startMinute - b.startMinute);
  const best = [];
  for (const candidate of candidates) {
    if (best.every(item => candidate.endMinute <= item.startMinute || candidate.startMinute >= item.endMinute)) best.push(candidate);
    if (best.length === 3) break;
  }
  return { hourly, best, peak: samples.some(s => s.available) ? Math.max(...samples.filter(s => s.available).map(s => s.total)) : null };
}

export function calculateDay(satellites, input, date, utcOffset, onProgress = () => {}) {
  const observer = validateObserver(input);
  const start = dayStart(date, utcOffset);
  const geodetic = observerGeodetic(observer);
  const ids = [...new Set(satellites.map(s => s.system.id))];
  const samples = [];
  for (let minute = 0; minute < 1440; minute++) {
    const timestamp = start + minute * 60000;
    const time = new Date(timestamp), gmst = gstime(time);
    const counts = Object.fromEntries(ids.map(id => [id, 0]));
    const availableBySystem = Object.fromEntries(ids.map(id => [id, 0]));
    let available = 0, total = 0;
    for (const sat of satellites) {
      if (elementAgeDays(sat, timestamp) > MAX_ELEMENT_AGE_DAYS) continue;
      const result = propagate(sat.satrec, time);
      if (!result?.position || sat.satrec.error || !Object.values(result.position).every(Number.isFinite)) continue;
      const { elevation } = ecfToLookAngles(geodetic, eciToEcf(result.position, gmst));
      if (!Number.isFinite(elevation)) continue;
      available++;
      availableBySystem[sat.system.id]++;
      if (elevation / DEG >= observer.minElevation) { counts[sat.system.id]++; total++; }
    }
    samples.push({ timestamp, total, available, availableBySystem, counts });
    if (minute % 60 === 59) onProgress(Math.round((minute + 1) / 1440 * 100));
  }
  return { start, samples, ...summarizeDay(samples) };
}
