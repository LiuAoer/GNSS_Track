import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Crosshair, Download, Expand, Globe2, Layers3, Minus, Orbit, Pause, Play, Plus, Radio, RotateCcw, Satellite, Search, Settings2, SlidersHorizontal, TableProperties, X } from 'lucide-react';
import OrbitScene, { GroundMap } from './OrbitScene';
import GroundObserver from './GroundObserver';
import ProductSearch from './ProductSearch';
import LayerTree from './LayerTree';
import { downloadCsv } from './csv';
import { SYSTEMS, REMOTE_MISSIONS, ORBIT_NAMES, BDS_ORBIT_TYPES, isSatelliteVisible, orbitLabel, createCatalog, satelliteState, elementAgeDays, MAX_ELEMENT_AGE_DAYS, COMPACT_ORBIT_SCALE, formatPeriod, formatUtc, remoteMission } from './data';

const ALL_IDS = SYSTEMS.map(system => system.id);
const SPEEDS = [1, 60, 600, 3600];
const COMPACT_ORBIT_PERCENT = Math.round(COMPACT_ORBIT_SCALE * 100);
const formatTime = timestamp => new Date(timestamp).toISOString().slice(11, 19);

function Modal({ title, eyebrow, onClose, children, className = '' }) {
  useEffect(() => {
    const handler = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  return <div className="modal-backdrop" onClick={onClose}><section className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}><button className="icon-button modal-close" onClick={onClose} aria-label="关闭"><X size={19} /></button><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{children}</section></div>;
}

function SystemGlyph({ system }) {
  return <span className="system-glyph" style={{ '--system-color': system.color }}><Orbit size={20} strokeWidth={1.3} /><i /></span>;
}

function OrbitScaleInput({ percent, onChange }) {
  const [draft, setDraft] = useState(String(percent));
  useEffect(() => setDraft(String(percent)), [percent]);
  return <div className="orbit-scale-input">
    <div className="orbit-scale-title"><strong>轨道显示比例</strong><label><input aria-label="轨道比例百分比" type="number" min="20" max="100" step="1" value={draft} onChange={event => { const value = event.target.value; setDraft(value); if (value !== '' && Number(value) >= 20 && Number(value) <= 100) onChange(Number(value)); }} onBlur={() => { const value = draft === '' ? percent : Number(draft); onChange(value); setDraft(String(Math.min(100, Math.max(20, Math.round(value))))); }} />%</label></div>
    <input aria-label="轨道比例" type="range" min="20" max="100" step="1" value={percent} onChange={event => onChange(Number(event.target.value))} />
    <div className="orbit-scale-presets"><button type="button" onClick={() => onChange(36)}>自动紧凑</button><button type="button" onClick={() => onChange(100)}>真实比例</button></div>
    <p>20–100% 地心距离；低轨自动保留地表间距。仅调整显示，实际轨道参数保持真实数值。</p>
  </div>;
}

function launchYear(internationalId = '') {
  const match = /^(\d{2}|\d{4})-\d{3}[A-Z]{1,3}$/i.exec(internationalId);
  if (!match) return '未提供';
  const year = Number(match[1]);
  return `${match[1].length === 4 ? year : year >= 57 ? 1900 + year : 2000 + year}（仅年份）`;
}

export default function App() {
  const [payload, setPayload] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef(null);
  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25000);
    setRefreshing(true);
    try {
      const response = await fetch('/api/ephemeris', { signal: controller.signal, cache: 'no-store' });
      const next = await response.json();
      if (!response.ok || !next.groups?.some(group => group.records?.length)) throw new Error('公开星历暂时不可用，请稍后重试');
      if (!createCatalog(next).length) throw new Error('数据源未返回可解析的轨道要素，请稍后重试');
      setPayload(next); setLoadError('');
    } catch (error) { setLoadError(error.name === 'AbortError' ? '星历请求超时，请检查网络后重试' : error.message); }
    finally { clearTimeout(timeout); request.current = null; setRefreshing(false); }
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5 * 60 * 1000);
    return () => { clearInterval(timer); request.current?.abort(); };
  }, [refresh]);
  const catalog = useMemo(() => payload ? createCatalog(payload) : [], [payload]);
  if (!catalog.length) return <div className="ephemeris-loading"><Orbit size={42} /><span className="eyebrow">ORBIT · LIVE EPHEMERIS</span><h1>{loadError ? '暂时无法读取真实星历' : '正在获取公开卫星轨道'}</h1><p>{loadError || '连接 CelesTrak，读取最新公开轨道要素…'}</p>{loadError && <button onClick={refresh} disabled={refreshing}>{refreshing ? '正在重试…' : '重新获取星历'}</button>}<small>数据不可用时不生成替代卫星或虚构轨道。</small></div>;
  return <Explorer catalog={catalog} payload={payload} loadError={loadError} refreshing={refreshing} refresh={refresh} />;
}

function Explorer({ catalog, payload, loadError, refreshing, refresh }) {
  const [bds3Only, setBds3Only] = useState(false);
  const SATELLITES = useMemo(() => catalog.filter(sat => elementAgeDays(sat, Date.now()) <= MAX_ELEMENT_AGE_DAYS && (!bds3Only || sat.system.id !== 'beidou' || sat.isBds3)), [catalog, bds3Only]);
  const [active, setActive] = useState(ALL_IDS);
  const [bdsTypes, setBdsTypes] = useState(BDS_ORBIT_TYPES);
  const [remoteMissions, setRemoteMissions] = useState(() => REMOTE_MISSIONS.map(m => m.id));
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem('orbit:display-percent') !== '100'; } catch { return true; } });
  const [orbitPercent, setOrbitPercent] = useState(() => { try { const value = Number(localStorage.getItem('orbit:display-percent')); return value >= 20 && value < 100 ? value : 36; } catch { return 36; } });
  const displayedPercent = compact ? orbitPercent : 100;
  function changeOrbitPercent(value) {
    if (!Number.isFinite(value)) return;
    const percent = Math.min(100, Math.max(20, Math.round(value)));
    setCompact(percent < 100);
    if (percent < 100) setOrbitPercent(percent);
  }
  useEffect(() => { try { localStorage.setItem('orbit:display-percent', String(displayedPercent)); } catch { /* Storage may be disabled. */ } }, [displayedPercent]);
  const [selected, setSelected] = useState(() => SATELLITES.find(sat => sat.noradId === 43001) ?? SATELLITES[0] ?? catalog[0]);
  const [time, setTime] = useState(Date.now);
  const [live, setLive] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [showOrbits, setShowOrbits] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [view, setView] = useState('3d');
  const [modal, setModal] = useState(null);
  const [observer, setObserver] = useState(null);
  const [query, setQuery] = useState('');
  const [tableQuery, setTableQuery] = useState('');
  const [tableSystem, setTableSystem] = useState('all');
  const [ready, setReady] = useState('loading');
  const [toast, setToast] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const controls = useRef(null);
  const toastTimer = useRef(null);
  const drawable = SATELLITES.filter(sat => satelliteState(sat, time));
  const visibleCount = drawable.filter(s => isSatelliteVisible(s, active, bdsTypes, remoteMissions)).length;
  const counts = Object.fromEntries(SYSTEMS.map(system => [system.id, drawable.filter(sat => sat.system.id === system.id).length]));
  const bdsCounts = Object.fromEntries(BDS_ORBIT_TYPES.map(type => [type, drawable.filter(s => s.system.id === 'beidou' && s.type === type).length]));
  const allShown = active.length === SYSTEMS.length && bdsTypes.length === BDS_ORBIT_TYPES.length && remoteMissions.length === REMOTE_MISSIONS.length;
  const excluded = catalog.filter(sat => elementAgeDays(sat, Date.now()) > MAX_ELEMENT_AGE_DAYS);
  const sourceWarning = loadError || payload.groups.some(group => group.error || group.cache === 'stale' || Date.now() - Date.parse(group.fetchedAt) > 2 * 3600000);
  const liveMode = live && playing && speed === 1;
  const elapsed = (time % 86400000) / 1000;
  useEffect(() => {
    setSelected(previous => SATELLITES.find(sat => sat.id === previous.id && isSatelliteVisible(sat, active, bdsTypes, remoteMissions)) ?? SATELLITES.find(sat => isSatelliteVisible(sat, active, bdsTypes, remoteMissions)) ?? SATELLITES[0] ?? catalog[0]);
  }, [SATELLITES, catalog, active, bdsTypes, remoteMissions]);

  useEffect(() => {
    if (!playing || modal === 'observer') return;
    let frame, previous = performance.now();
    const advance = now => {
      const delta = (now - previous) / 1000;
      if (delta >= 0.05) {
        previous = now;
        setTime(value => live ? Date.now() : value + delta * speed * 1000);
      }
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, live, modal]);

  useEffect(() => {
    const keydown = event => {
      if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || modal) return;
      if (event.code === 'Space') { event.preventDefault(); setLive(false); setPlaying(value => !value); }
      if (event.key.toLowerCase() === 'r') controls.current?.reset();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [modal]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function notify(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }
  function toggleSystem(id) {
    setActive(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  }
  function toggleBdsType(type) {
    if (!active.includes('beidou')) {
      setActive(previous => [...previous, 'beidou']);
      setBdsTypes([type]);
    } else setBdsTypes(previous => previous.includes(type) ? previous.filter(item => item !== type) : [...previous, type]);
  }
  function soloBdsType(type) { setActive(['beidou']); setBdsTypes([type]); }
  function toggleCategory(ids, checked) {
    setActive(previous => checked ? previous.filter(id => !ids.includes(id)) : [...new Set([...previous, ...ids])]);
    if (ids.some(id => SYSTEMS.find(system => system.id === id)?.category === 'remote')) setRemoteMissions(checked ? [] : REMOTE_MISSIONS.map(mission => mission.id));
  }
  function soloCategory(ids) {
    setActive(ids);
    if (ids.includes('beidou')) setBdsTypes(BDS_ORBIT_TYPES);
    if (ids.some(id => SYSTEMS.find(system => system.id === id)?.category === 'remote')) setRemoteMissions(REMOTE_MISSIONS.map(mission => mission.id));
  }
  function toggleMission(id) {
    if (remoteMissions.includes(id)) {
      setRemoteMissions(previous => previous.filter(item => item !== id));
      return;
    }
    setRemoteMissions(previous => [...previous, id]);
    const missionSystems = [...new Set(catalog.filter(sat => sat.system.category === 'remote' && sat.mission === id).map(sat => sat.system.id))];
    setActive(previous => [...new Set([...previous, ...missionSystems])]);
  }
  function selectSatellite(sat) {
    if (!sat) return;
    setSelected(sat);
    if (sat.system.id === 'beidou' && !bdsTypes.includes(sat.type)) setBdsTypes(previous => [...previous, sat.type]);
    if (!active.includes(sat.system.id)) setActive(previous => [...previous, sat.system.id]);
    if (sat.system.category === 'remote') { const mission = sat.mission ?? remoteMission(sat.name); setRemoteMissions(previous => previous.includes(mission) ? previous : [...previous, mission]); }
    setModal(null);
    setSidebarOpen(false);
  }
  function changeSatellite(direction) {
    const sameSystem = SATELLITES.filter(s => s.system.id === selected.system.id && isSatelliteVisible(s, active, bdsTypes, remoteMissions));
    if (!sameSystem.length) return;
    const index = sameSystem.findIndex(s => s.id === selected.id);
    selectSatellite(sameSystem[(index + direction + sameSystem.length) % sameSystem.length]);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { notify('当前浏览器暂不支持全屏显示'); }
  }
  function saveView() {
    const canvas = document.querySelector('.orbit-scene canvas');
    if (!canvas || view === '2d') { notify('请切换至三维视图后保存'); return; }
    try {
      const link = document.createElement('a');
      link.download = `ORBIT-${formatTime(time).replaceAll(':', '')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      notify('轨道视图已保存');
    } catch { notify('视图保存失败，请稍后重试'); }
  }
  const system = selected.system;
  const period = formatPeriod(selected);
  const filteredSatellites = SATELLITES.filter(sat => `${sat.name} ${sat.noradId} ${sat.system.name} ${sat.system.english} ${sat.type} ${orbitLabel(sat)}`.toLowerCase().includes(query.toLowerCase()));
  const tableSatellites = catalog.filter(sat => (tableSystem === 'all' || sat.system.id === tableSystem) && `${sat.name} ${sat.noradId} ${sat.internationalId} ${sat.system.name} ${sat.system.english} ${orbitLabel(sat)}`.toLowerCase().includes(tableQuery.trim().toLowerCase()));
  const tableHeaders = ['卫星类别', '国家/地区', '卫星名称', '轨道类型', 'NORAD编号', '国际代号', '发射年份', '运行状态', '要素历元UTC', '历元龄天', '获取时间UTC', '轨道周期min', '平均运动rev/day', '半长轴km', '平均轨道高度km', '当前高度km', '当前速度km/s', '倾角deg', '偏心率', '升交点赤经deg', '近地点幅角deg', '历元平近点角deg', '历元圈数', '元素集编号', 'BSTAR', '平均运动一阶导', '平均运动二阶导', '星下点纬度deg', '星下点经度deg', '数据来源'];
  const tableRows = (modal === 'table' ? tableSatellites : []).map(sat => {
    const current = satelliteState(sat, time);
    const o = sat.omm;
    return [sat.system.name, sat.system.country, sat.name, orbitLabel(sat), sat.noradId, sat.internationalId, launchYear(sat.internationalId), current ? '可推算' : '历元过期/不可推算', formatUtc(sat.epoch), elementAgeDays(sat, time).toFixed(3), sat.fetchedAt ? formatUtc(Date.parse(sat.fetchedAt)) : '未提供', (sat.periodSeconds / 60).toFixed(4), Number(o.MEAN_MOTION), sat.semiMajorAxis.toFixed(3), sat.altitude.toFixed(3), current?.altitude.toFixed(3) ?? '', current?.speed.toFixed(5) ?? '', Number(o.INCLINATION), Number(o.ECCENTRICITY), Number(o.RA_OF_ASC_NODE), Number(o.ARG_OF_PERICENTER), Number(o.MEAN_ANOMALY), Number(o.REV_AT_EPOCH), Number(o.ELEMENT_SET_NO), Number(o.BSTAR), Number(o.MEAN_MOTION_DOT), Number(o.MEAN_MOTION_DDOT), current?.latitude.toFixed(6) ?? '', current?.longitude.toFixed(6) ?? '', sat.sourceUrl];
  });
  const date = new Date(time).toISOString().slice(0, 10).replaceAll('-', '.');
  const state = satelliteState(selected, time);
  const latitude = state?.latitude;
  const longitude = state?.longitude;
  const latText = Number.isFinite(latitude) ? `${Math.abs(latitude).toFixed(2)}° ${latitude >= 0 ? 'N' : 'S'}` : '—';
  const lonText = Number.isFinite(longitude) ? `${Math.abs(longitude).toFixed(2)}° ${longitude >= 0 ? 'E' : 'W'}` : '—';
  const epochAge = elementAgeDays(selected, time);
  const displayName = selected.system.id === 'beidou' && /\(C\d+\)/.test(selected.name) ? `北斗 ${selected.name.match(/\((C\d+)\)/)[1]}` : selected.name.split(' (')[0];

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#" aria-label="ORBIT 首页"><span className="brand-mark"><Orbit size={27} strokeWidth={1.8} /></span><span>ORBIT<span className="brand-dot">.</span></span><span className="brand-divider" /><span className="brand-description">全球卫星轨道</span></a>
      <nav className="top-nav" aria-label="主导航"><button className="nav-item active" onClick={() => setModal(null)}>轨道探索</button><button className={`nav-item ${modal === 'catalog' ? 'active' : ''}`} onClick={() => { setQuery(''); setModal('catalog'); }}>卫星目录<ArrowUpRight size={12} /></button><button className={`nav-item ${modal === 'products' ? 'active' : ''}`} onClick={() => setModal('products')}>影像产品</button><button className={`nav-item ${modal === 'table' ? 'active' : ''}`} onClick={() => setModal('table')}>参数表</button><button className={`nav-item ${modal === 'observer' ? 'active' : ''}`} onClick={() => setModal('observer')}>地面观测</button><button className="nav-item" onClick={() => setModal('about')}>关于</button></nav>
      <div className="top-right"><button className={`simulation-tag ${sourceWarning ? 'source-warning' : ''}`} onClick={() => setModal('data')}><i />{sourceWarning ? '数据源异常' : liveMode ? '实时推算' : '时间预览'}</button><span className="header-clock">{formatTime(time)}<small>UTC</small></span><button className="icon-button help-button" onClick={() => setModal('help')} aria-label="操作帮助"><CircleHelp size={18} /></button></div>
    </header>

    <div className="app-body">
      {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="关闭星座面板" />}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-heading"><button className="icon-button sidebar-dismiss" onClick={() => setSidebarOpen(false)} aria-label="收起星座面板"><X size={17} /></button><span className="eyebrow">SATELLITE DIRECTORY</span><div><h2>卫星目录</h2><span className="subtle-badge">{String(SYSTEMS.length).padStart(2, '0')}</span></div><p>按导航、空间站与遥感任务浏览。</p></div>
        <div className="fleet-summary"><div><span className="summary-number">{visibleCount}<i>颗</i></span><span>可推算卫星</span></div><span className="summary-divider" /><div><span className="summary-number">{active.length}<i>/ {SYSTEMS.length}</i></span><span>显示类别</span></div><Radio className="summary-radio" size={38} strokeWidth={0.8} /></div>
        <div className="list-heading"><span>卫星与观测任务</span><button onClick={() => { setActive(allShown ? [] : ALL_IDS); setBdsTypes(allShown ? [] : BDS_ORBIT_TYPES); setRemoteMissions(allShown ? [] : REMOTE_MISSIONS.map(m => m.id)); }}>{allShown ? '全部隐藏' : '显示全部'}</button></div>
        <LayerTree catalog={SATELLITES} visibleSatellites={drawable.filter(s => isSatelliteVisible(s, active, bdsTypes, remoteMissions))} active={active} bdsTypes={bdsTypes} missions={remoteMissions} counts={counts} bdsCounts={bdsCounts} onToggleSystem={toggleSystem} onToggleBds={toggleBdsType} onSoloBds={soloBdsType} onToggleMission={toggleMission} onSelect={selectSatellite} onSoloCategory={soloCategory} onToggleCategory={toggleCategory} />
        <label className="bds-filter"><input type="checkbox" checked={bds3Only} onChange={e => setBds3Only(e.target.checked)} />北斗仅显示三号卫星</label><div className="sidebar-bottom"><div className="orbit-guide-heading"><Layers3 size={14} /><span>认识卫星轨道</span><ArrowUpRight size={13} /></div><button className="orbit-guide" onClick={() => setModal('orbits')}><div className="mini-orbit"><span /><span /><i /></div><div><strong>不同高度，同一个地球</strong><p>LEO · MEO · IGSO · GEO</p></div><ChevronRight size={15} /></button><div className="data-notice"><i /><span>{excluded.length ? `已排除 ${excluded.length} 颗过期卫星` : 'CelesTrak · 最新公开轨道要素'}</span><button onClick={() => setModal('data')} aria-label="查看数据说明"><CircleHelp size={12} /></button></div></div>
      </aside>

      <main className="workspace">
        <div className="workspace-heading"><div className="view-switch" aria-label="视图模式"><button className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}><Globe2 size={13} />3D 地球</button><button className={view === '2d' ? 'active' : ''} onClick={() => setView('2d')}>2D 地图</button></div></div>
        <button className="mobile-constellations" onClick={() => setSidebarOpen(!sidebarOpen)}><Layers3 size={16} /> 星座 <ChevronDown size={13} /></button>

        <OrbitScene satellites={SATELLITES} active={active} bdsTypes={bdsTypes} missions={remoteMissions} compact={compact} orbitScale={orbitPercent / 100} timestamp={time} selected={selected} onSelect={selectSatellite} playing={playing} showOrbits={showOrbits} showLabels={showLabels} showGrid={showGrid} view={view} controlsRef={controls} onReady={setReady} observer={observer} suspended={modal !== null} />
        {view === '2d' && <GroundMap satellites={SATELLITES} active={active} bdsTypes={bdsTypes} missions={remoteMissions} timestamp={time} selected={selected} onSelect={selectSatellite} observer={observer} />}
        {ready === 'loading' && <div className="loading-notice"><span />正在构建地球与轨道…</div>}
        {ready === 'error' && <div className="scene-error">三维渲染不可用<button onClick={() => setView('2d')}>查看二维卫星地图</button></div>}
        {ready === 'texture-error' && <div className="texture-notice">地球纹理未能载入，请刷新页面重试</div>}

        <div className="scene-coordinate"><span>EARTH-CENTERED VIEW</span><div><i className="coordinate-dot" />地心视角<span className="coord-divider">/</span><span>{view === '3d' ? '3D ORBITAL SPACE' : 'GROUND TRACK'}</span></div></div>
        <div className="scene-toolbar"><button className="icon-button" onClick={() => setModal('observer')} aria-label="地面观测查询" title="地面观测查询"><Crosshair size={17} /></button><button className="icon-button" onClick={() => setModal('products')} aria-label="遥感影像产品" title="遥感影像产品"><Layers3 size={17} /></button><button className="icon-button" onClick={() => { setQuery(''); setModal('search'); }} aria-label="搜索卫星" title="搜索卫星"><Search size={17} /></button><button className="icon-button" onClick={() => setModal('table')} aria-label="卫星参数表" title="卫星参数表"><TableProperties size={17} /></button><span /><button className="icon-button" onClick={() => setModal('settings')} aria-label="显示设置" title="显示设置"><SlidersHorizontal size={17} /></button><button className="icon-button" onClick={saveView} aria-label="保存视图" title="保存视图"><ArrowDownToLine size={17} /></button><span /><button className="icon-button" onClick={fullscreen} aria-label="切换全屏" title="切换全屏"><Expand size={16} /></button></div>

        <aside className="satellite-panel">
          <div className="panel-caption"><span><span className="tiny-cross">+</span> 卫星详情</span><div><button className="icon-button" onClick={() => changeSatellite(-1)} aria-label="上一颗卫星"><ChevronLeft size={14} /></button><button className="icon-button" onClick={() => changeSatellite(1)} aria-label="下一颗卫星"><ChevronRight size={14} /></button></div></div>
          <div className="selected-satellite-art" style={{ '--system-color': system.color }}><span className="art-orbit one" /><span className="art-orbit two" /><div className="sat-art"><div className="solar-panel left" /><div className="sat-body"><span /><i /></div><div className="solar-panel right" /><div className="sat-antenna" /></div><span className="art-star s1">+</span><span className="art-star s2">+</span><span className="art-small-dot" /></div>
          <div className="selected-heading"><span className="eyebrow" style={{ color: system.color }}>{system.english}</span><h2 title={selected.name}>{displayName}<span className="status-dot" /></h2><p>{system.full}</p></div>
          <div className="sat-tags"><span>{orbitLabel(selected)}</span><span>{ORBIT_NAMES[orbitLabel(selected)]}</span></div>
          <div className="satellite-stats"><div><span>当前高度</span><strong>{state ? Math.round(state.altitude).toLocaleString() : '—'}<small>km</small></strong></div><div><span>轨道倾角</span><strong>{selected.inclination.toFixed(1)}<small>°</small></strong></div><div><span>运行周期</span><strong className="period-value">{period}</strong></div><div><span>运行速度</span><strong>{state ? state.speed.toFixed(2) : '—'}<small>km/s</small></strong></div></div>
          <div className="subpoint"><div><Crosshair size={13} /><span>当前星下点</span><i>{state ? 'SGP4' : '不可用'}</i></div><p><span>{latText}</span><span>{lonText}</span></p></div>
          <button className={`epoch-note ${epochAge > 3 ? 'source-warning' : ''}`} onClick={() => setModal('data')}>{state ? `历元距显示时刻 ${epochAge.toFixed(1)} 天` : '轨道要素过期或无法推算'}</button><button className="detail-button" onClick={() => setModal('satellite')}>查看卫星信息<ArrowUpRight size={14} /></button>
        </aside>

        <div className="earth-caption"><span className="earth-caption-line" /><div><strong>地球 <span>EARTH</span></strong><small>我们的家，也是导航的原点。</small></div></div>
        <div className="zoom-controls"><button className="icon-button" onClick={() => controls.current?.zoom(0.85)} disabled={view === '2d'} aria-label="放大" title="放大"><Plus size={16} /></button><span /><button className="icon-button" onClick={() => controls.current?.zoom(1.18)} disabled={view === '2d'} aria-label="缩小" title="缩小"><Minus size={16} /></button><span /><button className="icon-button" onClick={() => { controls.current?.reset(); notify('已恢复默认视角'); }} disabled={view === '2d'} aria-label="重置视角" title="重置视角 (R)"><Crosshair size={16} /></button></div>
        <div className="scene-footer"><span><span className="mouse-icon" />拖动旋转<span className="footer-separator">·</span>滚轮缩放<span className="footer-separator">·</span>点击卫星查看</span>{view === '2d' ? <span className="scale-indicator">真实星下点</span> : <details className="orbit-scale-popover"><summary aria-label="设置轨道比例" className="scale-indicator">轨道比例 · {displayedPercent}% <Settings2 size={12} /></summary><div className="orbit-scale-panel"><OrbitScaleInput percent={displayedPercent} onChange={changeOrbitPercent} /></div></details>}</div>

        <footer className="timeline"><div className="playback"><button className="play-button" onClick={() => { setLive(false); setPlaying(!playing); }} aria-label={playing ? '暂停播放' : '开始播放'}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button><div className="playback-status"><span>时间控制</span><strong>{liveMode ? '跟随当前时间' : playing ? '时间预览' : '已暂停'}<i className={playing ? '' : 'paused'} /></strong></div><button className="speed-button" onClick={() => { setLive(false); setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]); }} title="切换推算速度">{speed}×<ChevronDown size={12} /></button></div><div className="time-track"><div className="track-top"><span>{date}<small>UTC</small></span><strong>{formatTime(time)}</strong></div><div className="range-wrap"><input aria-label="推算时间" type="range" min="0" max="86399" step="1" value={elapsed} onChange={e => { setTime(Math.floor(time / 86400000) * 86400000 + Number(e.target.value) * 1000); setLive(false); setPlaying(false); }} style={{ '--progress': `${elapsed / 86400 * 100}%` }} /><div className="time-ticks">{['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'].map(t => <span key={t}>{t}</span>)}</div></div></div><button className="reset-time" onClick={() => { setTime(Date.now()); setSpeed(1); setLive(true); setPlaying(true); }} title="回到实时"><RotateCcw size={15} /><span>回到实时</span></button></footer>
      </main>
    </div>

    {(modal === 'search' || modal === 'catalog') && <Modal title={modal === 'search' ? '寻找一颗卫星' : '探索卫星目录'} eyebrow={modal === 'search' ? 'FIND YOUR SATELLITE' : 'CONSTELLATION DIRECTORY'} onClose={() => setModal(null)} className="catalog-modal"><label className="search-field"><Search size={17} /><input autoFocus placeholder="搜索卫星、星座或轨道类型…" value={query} onChange={e => setQuery(e.target.value)} /><span>{filteredSatellites.length}</span></label><div className="catalog-filters"><button className={!query ? 'active' : ''} onClick={() => setQuery('')}>全部</button>{SYSTEMS.map(s => <button key={s.id} onClick={() => setQuery(s.english === 'GLOBAL POSITIONING' ? 'GPS' : s.english)}><i style={{ background: s.color }} />{s.name}</button>)}</div><div className="satellite-results">{filteredSatellites.map(sat => <button key={sat.id} onClick={() => selectSatellite(sat)}><span className="result-icon" style={{ color: sat.system.color }}><Satellite size={19} /></span><span><strong>{sat.name}</strong><small>{sat.system.country} · {orbitLabel(sat)} · NORAD {sat.noradId}</small></span><ArrowUpRight size={15} /></button>)}{filteredSatellites.length === 0 && <p className="no-results">没有找到匹配的卫星，试试“北斗”或“GPS”。</p>}</div><p className="modal-footnote">目录来自公开轨道要素；收录数量不等于健康在役数量。超过 14 天的要素不参与展示。</p></Modal>}

    {modal === 'observer' && <Modal title="地面观测与接收规划" eyebrow="GROUND OBSERVATION" onClose={() => setModal(null)} className="observer-modal"><GroundObserver payload={payload} catalog={catalog} initialObserver={observer} onObserverChange={setObserver} onSelect={(sat, timestamp) => { setTime(timestamp); setLive(false); setPlaying(false); selectSatellite(sat); }} /></Modal>}

    {modal === 'products' && <Modal title="遥感影像产品" eyebrow="SATELLITE IMAGERY" onClose={() => setModal(null)} className="product-modal"><ProductSearch /></Modal>}

    {modal === 'table' && <Modal title="全球卫星参数总表" eyebrow="SATELLITE DATA" onClose={() => setModal(null)} className="table-modal">
      <p className="modal-description">收录 {tableSatellites.length} 颗卫星。轨道参数来自 CelesTrak OMM；当前高度、速度和星下点由 SGP4 按所选 UTC 时刻推算。选择卫星名称可定位到三维轨道。</p>
      <div className="table-tools"><label className="search-field"><Search size={16} /><input aria-label="搜索参数表" placeholder="搜索名称、NORAD、国际代号…" value={tableQuery} onChange={e => setTableQuery(e.target.value)} /><span>{tableSatellites.length}</span></label><label className="table-system-filter"><span>类别</span><select aria-label="筛选卫星类别" value={tableSystem} onChange={e => setTableSystem(e.target.value)}><option value="all">全部类别</option>{SYSTEMS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="refresh-data table-export" onClick={() => downloadCsv(`ORBIT-Satellites-${new Date(time).toISOString().slice(0, 10)}.csv`, tableHeaders, tableRows)}><Download size={15} />导出 CSV</button></div>
      <div className="table-scroll"><table className="satellite-table"><thead><tr>{tableHeaders.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{tableSatellites.map((sat, index) => <tr key={sat.id}>
        <td><button className="table-satellite-name" onClick={() => selectSatellite(sat)} style={{ color: sat.system.color }} title="定位此卫星">{sat.system.name}</button></td>
        <td>{tableRows[index][1]}</td><td><button className="table-satellite-name" onClick={() => selectSatellite(sat)} title="定位此卫星">{sat.name}</button></td>
        {tableRows[index].slice(3).map((value, cellIndex) => <td key={cellIndex}>{value}</td>)}
      </tr>)}</tbody></table>{!tableSatellites.length && <p className="no-results">没有找到匹配的卫星参数。</p>}</div>
      <p className="modal-footnote">国际代号仅编码发射年份与批次，公开 OMM 不含精确发射日期；不以代号推测具体日期。超过 14 天的要素仍列入总表，但标记为不可推算。空值表示来源未提供。CSV 导出当前筛选结果。</p>
    </Modal>}

    {modal === 'settings' && <Modal title="让视野更纯粹" eyebrow="DISPLAY SETTINGS" onClose={() => setModal(null)}><p className="modal-description">调整轨道空间中的信息层次。</p><OrbitScaleInput percent={displayedPercent} onChange={changeOrbitPercent} />{[[compact, setCompact, '紧凑轨道显示', `高轨距离缩至 ${orbitPercent}%，低轨保留地表间距；关闭恢复真实比例`], [showOrbits, setShowOrbits, '轨道线', '显示各类卫星的运行轨道'], [showLabels, setShowLabels, '卫星标注', '显示当前选中卫星的名称与高度'], [showGrid, setShowGrid, '经纬网格', '在地球表面显示经纬参考线']].map(([enabled, setter, title, subtitle]) => <div className="setting-row" key={title}><div><strong>{title}</strong><p>{subtitle}</p></div><button role="switch" aria-checked={enabled} aria-label={title} className={`switch ${enabled ? 'on' : ''}`} onClick={() => setter(!enabled)}><i /></button></div>)}</Modal>}

    {modal === 'about' && <Modal title="从地球，看见连接。" eyebrow="ABOUT ORBIT" onClose={() => setModal(null)}><p className="modal-description">ORBIT 通过 CelesTrak 最新公开 OMM 轨道要素和 SGP4 传播模型，推算导航卫星、空间站及公开遥感卫星在指定 UTC 时刻的位置。保留每颗卫星的实际倾角、偏心率与轨道方向。默认紧凑模式将高轨地心距离缩至 {COMPACT_ORBIT_PERCENT}%，低轨按近地点保留地表间距；每条轨道采用统一缩放以保留椭圆形状；可在底部或显示设置自设 20–100% 的显示比例，也可恢复真实比例。高度、速度和二维星下点始终按真实距离计算。</p><div className="info-box"><Radio size={20} /><div><strong>真实轨道要素，当前时刻推算</strong><p>这是公开通用轨道要素的轨道可视化，并非 GNSS 广播星历、精密星历或卫星实时遥测。数据通常有时间延迟，位置误差会随历元距离增大，不用于导航定位。</p></div></div><p className="modal-description">服务器每小时检查更新，浏览器每五分钟同步。断网时明确标记缓存；要素距显示时刻超过 14 天停止推算。星座目录可能包含备份、试验和增补卫星，不据此判断服务健康状态。</p><p className="modal-footnote">地球纹理：NASA Blue Marble / three-globe 示例资源。照明为展示照明，不表示实时日照。</p></Modal>}

    {modal === 'data' && <Modal title="轨道数据与时效" eyebrow="EPHEMERIS & PROVENANCE" onClose={() => setModal(null)} className="data-modal"><p className="modal-description">CelesTrak OMM → SGP4 → 当前 UTC 位置。公开轨道根数并非 GNSS 广播或精密星历。卫星数量按数据源计算，不强制套用设计星座数量。</p>{loadError && <p className="source-warning">{loadError}；保留上次成功获取的数据。</p>}<div className="source-list">{payload.groups.map(group => { const records = catalog.filter(s => s.system.id === group.id); const epochs = records.map(s => s.epoch); return <article key={group.id}><div><strong>{SYSTEMS.find(s => s.id === group.id)?.name}</strong><span>{records.length} 颗收录 · {counts[group.id]} 颗展示候选</span></div><p>获取：{group.fetchedAt ? formatUtc(Date.parse(group.fetchedAt)) : '尚未获取'}</p><p>历元：{epochs.length ? `${formatUtc(Math.min(...epochs))} ～ ${formatUtc(Math.max(...epochs))}` : '无有效数据'}</p><a href={group.url} target="_blank" rel="noreferrer">查看原始数据 ↗</a>{group.error && <p className="source-warning">{group.error} · {group.cache === 'stale' ? '使用旧缓存' : '未展示该类别'}</p>}</article>; })}</div><div className="info-box"><div><strong>北斗三号基本星座：3 GEO + 3 IGSO + 24 MEO</strong><p>这是基本星座配置。实际目录包含后续增补卫星；全部北斗还包含二号和试验星。使用左侧筛选查看三号卫星。GEO 实际倾角可能偏离 0°，按观测要素显示。</p></div></div><p className="modal-description">已排除 {excluded.length} 颗历元距现在超过 14 天的卫星{excluded.length ? `：${excluded.map(s => s.name).join('、')}` : '。'}。14 天为展示截止阈值，并非精度保证；历元距显示时刻超过 3 天以提示色标记。</p><button className="refresh-data" disabled={refreshing} onClick={refresh}>{refreshing ? '正在同步…' : '同步最新缓存'}</button><p className="modal-footnote">上游每小时刷新；失败后至少等待 5 分钟重试。轨道分类依据实际周期及倾角，同步轨道倾角小于 5° 归为近 GEO。</p></Modal>}

    {modal === 'help' && <Modal title="开始你的轨道探索" eyebrow="A LITTLE GUIDANCE" onClose={() => setModal(null)}><div className="help-rows">{[['拖动 & 滚轮', '旋转地球视角，放大或缩小轨道空间'], ['点击卫星', '在右侧查看轨道参数与推算星下点'], ['卫星图层', '筛选导航卫星、空间站与遥感卫星'], ['地面观测', '输入经纬度，查询可见卫星和全天推荐时段'], ['北斗分类', 'GEO / IGSO / MEO 可多选；点击“单独”仅显示该类北斗卫星'], ['轨道比例', '底部滑块或输入框自设 20–100% 比例，可恢复自动紧凑或真实比例'], ['Space', '暂停或继续时间播放'], ['R', '恢复默认地球视角'], ['时间控制', '拖动时间轴跳转，点击倍率切换推算速度']].map(([key, value]) => <div key={key}><kbd>{key}</kbd><span>{value}</span></div>)}</div></Modal>}

    {modal === 'orbits' && <Modal title="不同高度，同一个地球" eyebrow="UNDERSTANDING ORBITS" onClose={() => setModal(null)}><div className="orbit-explanations"><article><span>LEO</span><h3>近地轨道</h3><p>平均高度不超过 2,000 公里，空间站及多数地球观测卫星位于此类轨道。过境较短，地面观测需结合仰角和具体时刻。紧凑显示为低轨保留地表间距。</p></article><article><span>MEO</span><h3>中地球轨道</h3><p>距离地面约 19,000–23,300 公里，是 GPS、Galileo、GLONASS 和北斗的主要导航轨道，周期约 11–14 小时。伽利略 5 / 6 号保留实际偏心轨道，不强制套用标称圆轨道。</p></article><article><span>IGSO</span><h3>倾斜地球同步轨道</h3><p>周期与地球自转相同，轨道面相对赤道倾斜。北斗利用这类轨道增强区域覆盖。QZSS 的 QZO 属于倾斜同步轨道，偏心率约 0.075、近地点幅角约 270°，使卫星在北半球远地点附近停留更久。QZSS 同时包含近赤道的 GEO 卫星。</p></article><article><span>GEO</span><h3>地球静止轨道</h3><p>位于赤道上空约 35,786 公里，对地面观察者近似静止。北斗的静止轨道卫星持续服务亚太区域。</p></article></div><p className="modal-footnote">参考：<a href="https://qzss.go.jp/en/overview/services/sv01_what.html" target="_blank" rel="noreferrer">日本内阁府 QZSS</a> · <a href="https://gssc.esa.int/navipedia/index.php/GPS_Space_Segment" target="_blank" rel="noreferrer">GPS</a> · <a href="https://gssc.esa.int/navipedia/index.php/Galileo_Space_Segment" target="_blank" rel="noreferrer">Galileo</a> · <a href="https://gssc.esa.int/navipedia/index.php/GLONASS_Space_Segment" target="_blank" rel="noreferrer">GLONASS</a>。参考资料用于核对轨道特征，具体位置始终使用每颗卫星的最新公开要素推算。</p></Modal>}

    {modal === 'satellite' && <Modal title={selected.name} eyebrow="SATELLITE PROFILE" onClose={() => setModal(null)}><div className="profile-system" style={{ color: system.color }}><SystemGlyph system={system} /><span>{system.full}</span></div><dl className="profile-data">{[['NORAD / 国际编号', `${selected.noradId} / ${selected.internationalId}`], ['轨道类型', `${orbitLabel(selected)} · ${ORBIT_NAMES[orbitLabel(selected)]}`], ['当前高度', state ? `${state.altitude.toFixed(1)} km` : '不可推算'], ['轨道倾角', `${selected.inclination.toFixed(4)}°`], ['偏心率', selected.eccentricity.toFixed(7)], ['升交点赤经', `${selected.raan.toFixed(4)}°`], ['近地点幅角', `${Number(selected.omm.ARG_OF_PERICENTER).toFixed(4)}°`], ['历元平近点角', `${Number(selected.omm.MEAN_ANOMALY).toFixed(4)}°`], ['轨道周期', period], ['推算星下点', `${latText} / ${lonText}`], ['要素历元', formatUtc(selected.epoch)], ['获取时间', selected.fetchedAt ? formatUtc(Date.parse(selected.fetchedAt)) : '—']].map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><p className="modal-footnote">位置由该历元的真实轨道根数推算。<a href={selected.sourceUrl} target="_blank" rel="noreferrer">查看 CelesTrak 原始数据 ↗</a></p></Modal>}

    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
  </div>;
}
