import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Download, Radio, RotateCcw } from 'lucide-react';
import { CATEGORIES, SYSTEMS, formatUtc } from './data.js';
import { dayStart, validateObserver, visibleSatellites } from './visibility.js';
import { downloadCsv } from './csv.js';

const minuteLabel = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const localDate = (timestamp, offset) => new Date(timestamp + offset * 3600000).toISOString().slice(0, 10);
const localTime = (timestamp, offset) => new Date(timestamp + offset * 3600000).toISOString().slice(11, 19);
const zoneLabel = offset => `UTC${offset >= 0 ? '+' : ''}${offset}`;

function SkyPlot({ rows, minElevation, onSelect }) {
  return <svg className="sky-plot" viewBox="0 0 320 320" role="img" aria-label="可见卫星天空图：北向上，东向右，圆心为天顶">
    {[90, 60, 30].map(angle => <g key={angle}><circle cx="160" cy="160" r={angle / 90 * 126} className="sky-ring" /><text x="164" y={160 - angle / 90 * 126 + 13}>{90 - angle}°</text></g>)}
    <path d="M34 160H286 M160 34V286" className="sky-ring" />
    <circle cx="160" cy="160" r={(90 - minElevation) / 90 * 126} className="sky-mask" />
    <text x="160" y="20" textAnchor="middle">北 N</text><text x="301" y="164" textAnchor="middle">东</text><text x="160" y="309" textAnchor="middle">南 S</text><text x="17" y="164" textAnchor="middle">西</text>
    {rows.map(row => {
      const radius = (90 - row.elevation) / 90 * 126, angle = row.azimuth * Math.PI / 180;
      return <circle key={row.sat.id} cx={160 + Math.sin(angle) * radius} cy={160 - Math.cos(angle) * radius} r="4.5" fill={row.sat.system.color} role="button" tabIndex="0" aria-label={`查看 ${row.sat.name} 轨道`} onClick={() => onSelect(row.sat)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(row.sat); } }}><title>{row.sat.name} · 仰角 {row.elevation.toFixed(1)}° · 方位角 {row.azimuth.toFixed(1)}°</title></circle>;
    })}
  </svg>;
}

function DayChart({ result, minute, onMinute }) {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 620px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)');
    const update = () => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const width = narrow ? 360 : 960, plotWidth = width - 76;
  const max = Math.max(result.peak ?? 0, 1);
  const ticks = max > 1 ? [0, Math.floor(max / 2), max] : [0, 1];
  const x = index => 42 + index / 1439 * plotWidth;
  const y = total => 170 - total / max * 140;
  // Gaps mean unavailable data, not zero visible satellites.
  const path = result.samples.map((sample, i) => sample.available ? `${i && result.samples[i - 1].available ? 'L' : 'M'}${x(i).toFixed(2)},${y(sample.total).toFixed(2)}` : '').join(' ');
  return <div className="day-chart">
    <svg viewBox={`0 0 ${width} 210`} role="img" aria-label={`全天每分钟可见卫星数量，峰值 ${result.peak ?? '无数据'}`}>
      {ticks.map(total => <g key={total}><path d={`M42 ${y(total)}H${width - 34}`} className="chart-grid" /><text x="32" y={y(total) + 4} textAnchor="end">{total}</text></g>)}
      {[0, 4, 8, 12, 16, 20, 24].map(hour => <text key={hour} x={42 + hour / 24 * plotWidth} y="196" textAnchor="middle">{minuteLabel(hour * 60)}</text>)}
      <path d={path} className="chart-line" />
      {minute !== null && <path d={`M${x(minute)} 22V170`} className="chart-cursor" />}
    </svg>
    <label className="day-slider">查看指定时刻 <strong>{minute === null ? '实时' : minuteLabel(minute)}</strong><input aria-label="全天查询时刻" type="range" min="0" max="1439" value={minute ?? 0} onChange={e => onMinute(Number(e.target.value))} /></label>
  </div>;
}

export default function GroundObserver({ payload, catalog, initialObserver, onObserverChange, onSelect }) {
  const [form, setForm] = useState(() => ({ latitude: initialObserver?.latitude ?? 39.9093, longitude: initialObserver?.longitude ?? 116.3974, height: initialObserver?.height ?? 0, minElevation: initialObserver?.minElevation ?? 10, date: localDate(Date.now(), 8), utcOffset: 8 }));
  const [systemIds, setSystemIds] = useState(() => SYSTEMS.filter(s => !s.category).map(s => s.id));
  const [query, setQuery] = useState(null);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [workerError, setWorkerError] = useState('');
  const [clock, setClock] = useState(Date.now);
  const [minute, setMinute] = useState(null);
  const daySection = useRef(null);
  const nowSection = useRef(null);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 10000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!query) return;
    setResult(null); setProgress(0); setWorkerError(''); setMinute(null);
    let worker;
    try {
      worker = new Worker(new URL('./visibility.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (data.error) setWorkerError(data.error);
        if (data.progress != null) setProgress(data.progress);
        if (data.result) setResult(data.result);
      };
      worker.onerror = () => setWorkerError('全天推算未完成，请重新查询');
      worker.postMessage({ payload, query });
    } catch { setWorkerError('无法启动全天推算，请重新查询'); }
    return () => worker?.terminate();
  }, [query, payload]);
  const satellites = useMemo(() => query ? catalog.filter(s => query.systemIds.includes(s.system.id)) : [], [catalog, query]);
  const timestamp = query && minute !== null ? dayStart(query.date, query.utcOffset) + minute * 60000 : clock;
  const current = useMemo(() => query ? visibleSatellites(satellites, query.observer, timestamp) : null, [satellites, query, timestamp]);
  const problems = query ? query.systemIds.flatMap(id => {
    const group = payload.groups.find(g => g.id === id), name = SYSTEMS.find(s => s.id === id).name;
    if (!group?.records?.length) return [`${name}无数据`];
    if (group.error || group.cache === 'stale' || !group.fetchedAt || clock - Date.parse(group.fetchedAt) > 7200000) return [`${name}使用旧缓存`];
    return [];
  }) : [];
  const oldElements = satellites.filter(s => Math.abs(timestamp - s.epoch) > 3 * 86400000).length;
  const updateField = e => setForm(previous => ({ ...previous, [e.target.name]: e.target.value }));
  function submit(e) {
    e.preventDefault();
    try {
      const observer = validateObserver(form), utcOffset = Number(form.utcOffset);
      dayStart(form.date, utcOffset);
      if (!systemIds.length) throw new Error('请至少选择一类卫星');
      setError(''); setClock(Date.now());
      setQuery({ observer, utcOffset, date: form.date, systemIds: [...systemIds] });
      onObserverChange(observer);
    } catch (failure) { setError(failure.message); }
  }
  function exportDay() {
    downloadCsv(`ORBIT-Visibility-${query.date}.csv`, ['时刻UTC', `当地时刻 ${zoneLabel(query.utcOffset)}`, '纬度deg', '经度deg', '海拔m', '最低仰角deg', '可见总数', '可推算数量', ...query.systemIds.map(id => SYSTEMS.find(s => s.id === id).name)], result.samples.map(s => [formatUtc(s.timestamp), `${query.date} ${localTime(s.timestamp, query.utcOffset)}`, query.observer.latitude, query.observer.longitude, query.observer.height, query.observer.minElevation, s.available ? s.total : '', s.available, ...query.systemIds.map(id => s.availableBySystem[id] ? s.counts[id] : '')]));
  }
  const select = sat => onSelect(sat, timestamp);
  return <div className="observer-content">
    <p className="modal-description">输入地面观测点，查看地平线以上的卫星、天空分布与全天数量。默认北京坐标，可修改为任意地点。</p>
    <form onSubmit={submit} noValidate className="observer-form">
      <div className="observer-fields">
        {[['longitude', '经度（°，东正西负）', -180, 180], ['latitude', '纬度（°，北正南负）', -90, 90], ['height', '海拔（m）', 0, 10000], ['minElevation', '最低仰角（°）', 0, 90]].map(([name, label, min, max]) => <label key={name}>{label}<input name={name} aria-label={label} type="number" min={min} max={max} step="any" value={form[name]} onChange={updateField} required /></label>)}
        <label>查询日期<input name="date" aria-label="查询日期" type="date" value={form.date} onChange={updateField} required /></label>
        <label>统计时区<select name="utcOffset" aria-label="统计时区" value={form.utcOffset} onChange={updateField}>{Array.from({ length: 27 }, (_, i) => i - 12).map(offset => <option key={offset} value={offset}>{offset === 8 ? '北京时间 UTC+8' : zoneLabel(offset)}</option>)}</select></label>
      </div>
      <div className="observer-systems">{CATEGORIES.map(category => <fieldset key={category.id}><legend>{category.name}</legend>{SYSTEMS.filter(s => (s.category ?? 'gnss') === category.id).map(s => <label key={s.id} style={{ '--system-color': s.color }}><input type="checkbox" checked={systemIds.includes(s.id)} onChange={e => setSystemIds(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} />{s.name}</label>)}</fieldset>)}</div>
      <div className="observer-submit"><button type="submit" className="refresh-data"><Crosshair size={15} />查询可见卫星</button><span>独立于主视图筛选；修改条件后重新查询。</span>{error && <p role="alert" className="source-warning">{error}</p>}</div>
    </form>
    <p className="observer-note">几何可见 ≠ 确认可接收。未计地形、建筑遮挡、大气折射、频段兼容性及卫星健康状态；空间站和遥感卫星可见也不代表可用 GNSS 接收机接收。</p>
    {query && <>
      <div className="observer-query">本次查询：{query.observer.latitude}° 纬度 / {query.observer.longitude}° 经度 · 海拔 {query.observer.height} m · 仰角 ≥ {query.observer.minElevation}° · {query.date} · {zoneLabel(query.utcOffset)}</div>
      {(problems.length > 0 || current.unavailable > 0 || oldElements > 0) && <p className="observer-warning" role="status">{problems.join('；')}{problems.length ? '。' : ''}{current.unavailable > 0 ? `${current.unavailable} 颗过期或无法推算，已排除。` : ''}{oldElements > 0 ? `${oldElements} 颗要素距查询时刻超过 3 天，预测可能偏差较大。` : ''}结果仅覆盖当前可用公开数据。</p>}
      <div className="observer-jumps"><button onClick={() => nowSection.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>查看可见卫星 ↓</button><button onClick={() => daySection.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>查看全天规划 ↓</button></div>
      <section className="observer-now" ref={nowSection}>
        <div className="observer-sky"><SkyPlot rows={current.rows} minElevation={query.observer.minElevation} onSelect={select} /><p>北向上 · 东向右 · 圆心为天顶<br />点击卫星查看轨道</p></div>
        <div className="observer-current">
          <div className="observer-section-heading"><div><span className="eyebrow">{minute === null ? 'LIVE VISIBILITY' : 'TIME PREVIEW'}</span><h3>{minute === null ? '当前可见卫星' : '所选时刻可见卫星'} <strong className="visible-total">{current.available ? current.rows.length : '—'}</strong></h3></div><button type="button" className="refresh-data" onClick={() => { setMinute(null); setClock(Date.now()); }}><RotateCcw size={13} />当前时刻</button></div>
          <p className="observer-time">{localDate(timestamp, query.utcOffset)} {localTime(timestamp, query.utcOffset)} {zoneLabel(query.utcOffset)}{minute === null ? ' · 每 10 秒更新' : ' · 时间预览'}</p>
          <div className="observer-counts">{query.systemIds.map(id => <span key={id} style={{ color: SYSTEMS.find(s => s.id === id).color }}>{SYSTEMS.find(s => s.id === id).name} <b>{current.availableBySystem[id] ? current.rows.filter(r => r.sat.system.id === id).length : '不可用'}</b></span>)}</div>
          <div className="observer-table-scroll"><table className="satellite-table observer-table"><thead><tr>{['卫星 / NORAD', '类别', '仰角', '方位角', '斜距 km', '高度 km', '要素历元 UTC'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{current.rows.map(row => <tr key={row.sat.id}><td><button className="table-satellite-name" style={{ color: row.sat.system.color }} onClick={() => select(row.sat)}>{row.sat.name}</button><small>{row.sat.noradId}</small></td><td>{row.sat.system.name}</td><td>{row.elevation.toFixed(1)}°</td><td>{row.azimuth.toFixed(1)}°</td><td>{row.range.toFixed(0)}</td><td>{row.altitude.toFixed(0)}</td><td>{formatUtc(row.sat.epoch)}</td></tr>)}</tbody></table>{!current.rows.length && <p className="no-results">{current.available ? '此时没有达到最低仰角的卫星。' : '所选类别暂无可推算数据，无法确定可见数量。'}</p>}</div>
        </div>
      </section>
      <section className="observer-day" ref={daySection}>
        <div className="observer-section-heading"><div><span className="eyebrow">DAILY COVERAGE</span><h3>全天数量与推荐时段</h3></div><button className="refresh-data" disabled={!result} onClick={exportDay}><Download size={14} />导出全天 CSV</button></div>
        <p className="observer-note">{query.date} 00:00–24:00（{zoneLabel(query.utcOffset)}），每分钟采样。推荐按连续 30 分钟的平均可见数量排序，不代表定位精度或信号质量；短于一分钟的低轨过境可能漏采。</p>
        {workerError ? <p role="alert" className="source-warning">{workerError}</p> : !result ? <div className="observer-progress" role="status"><Radio size={18} />正在推算全天轨道… {progress}%<progress max="100" value={progress} /></div> : <>
          <div className="best-windows">{result.best.length ? result.best.map((item, index) => <button key={item.startMinute} onClick={() => setMinute(item.startMinute)}><span>推荐 {index + 1} · 连续 30 分钟</span><strong>{minuteLabel(item.startMinute)}–{minuteLabel(item.endMinute)}</strong><small>平均 {item.average.toFixed(1)} 颗 · 最少 {item.min} · 最多 {item.max}</small></button>) : <p className="no-results">{result.peak === null ? '全天无可用轨道数据，无法推荐时段。' : '全天没有满足条件的可见卫星时段。'}</p>}</div>
          {result.samples.some(s => s.available < satellites.length) && <p className="observer-warning">部分时刻存在过期或不可推算卫星，数量可能低估。无可用数据的时段在图表中留空。</p>}
          <DayChart result={result} minute={minute} onMinute={setMinute} />
          {minute !== null && <button className="observer-time-link" onClick={() => nowSection.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>查看 {minuteLabel(minute)} 的卫星明细与天空图 ↑</button>}
          <div className="hourly-counts">{result.hourly.map(hour => <button key={hour.hour} onClick={() => setMinute(hour.hour * 60)} aria-label={`查看 ${minuteLabel(hour.hour * 60)} 可见卫星`}><span>{minuteLabel(hour.hour * 60)}–{minuteLabel((hour.hour + 1) * 60)}</span><strong>{hour.average === null ? '无数据' : `${hour.min}–${hour.max} 颗`}</strong><small>{hour.average === null ? '无法推算' : `平均 ${hour.average.toFixed(1)}${hour.validMinutes < 60 ? ' · 数据不全' : ''}`}</small></button>)}</div>
        </>}
      </section>
    </>}
    {!query && <div className="observer-empty"><Crosshair size={28} /><h3>为地面观测找到合适的时间</h3><p>选择地点与卫星类别后查询，生成天空图、24 小时数量曲线和可见卫星明细。</p></div>}
  </div>;
}
