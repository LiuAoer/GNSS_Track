import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, ExternalLink, FileArchive, Search, X } from 'lucide-react';
import shp from 'shpjs';

const SOURCES = {
  sentinel: { name: 'Sentinel-2 · 全球卫星影像', note: '全球陆地区域 · 主要波段 10 m，部分波段 20 / 60 m · 免费下载', cloud: true },
  naip: { name: 'NAIP · 美国高清航空影像', note: '仅美国 · 通常 0.6–1 m，按场景标注 · 航空摄影 · 免费下载', cloud: false },
};
const dateString = date => date.toISOString().slice(0, 10);
function collectPolygons(value, output = []) {
  if (Array.isArray(value)) value.forEach(item => collectPolygons(item, output));
  else if (value?.type === 'FeatureCollection') value.features?.forEach(item => collectPolygons(item, output));
  else if (value?.type === 'Feature') collectPolygons(value.geometry, output);
  else if (value?.type === 'Polygon') output.push(value.coordinates);
  else if (value?.type === 'MultiPolygon') output.push(...value.coordinates);
  return output;
}

function ProductRow({ item }) {
  const [assetKey, setAssetKey] = useState(item.assets[0].key);
  const asset = item.assets.find(value => value.key === assetKey) ?? item.assets[0];
  return <article className="product-result-row">
    <div className="product-result-copy"><strong title={item.id}>{item.id}</strong><small>{item.collectionTitle} · {new Date(item.acquisitionDate).toISOString().slice(0, 10)} UTC</small></div>
    <div className="product-specs"><strong>{asset.gsd == null ? '未标注' : `${asset.gsd} m`}</strong><small>{item.source === 'naip' ? '航空影像' : `整景云量 ${item.cloudCover == null ? '未提供' : `${item.cloudCover.toFixed(1)}%`}`}</small></div>
    <label className="product-option"><span>下载内容 · GeoTIFF</span><select aria-label={`${item.id}下载波段`} value={assetKey} onChange={event => setAssetKey(event.target.value)}>{item.assets.map(value => <option key={value.key} value={value.key}>{value.title}{value.gsd == null ? '' : ` · ${value.gsd} m`}</option>)}</select></label>
    <a className="product-order-button" href={asset.downloadUrl} target="_blank" rel="noreferrer" aria-label={`下载 ${item.id}`}><Download size={13} />下载影像</a>
  </article>;
}

export default function ProductSearch() {
  const [geometry, setGeometry] = useState(null);
  const [zipName, setZipName] = useState('');
  const [featureCount, setFeatureCount] = useState(0);
  const [fileBusy, setFileBusy] = useState(false);
  const [query, setQuery] = useState(() => ({ source: 'sentinel', startDate: dateString(new Date(Date.now() - 365 * 86400000)), endDate: dateString(new Date()), maxCloud: '30' }));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const controller = useRef(null), fileVersion = useRef(0);
  useEffect(() => () => { controller.current?.abort(); fileVersion.current++; }, []);
  function invalidate() { controller.current?.abort(); controller.current = null; setBusy(false); setResult(null); setError(''); }
  function changeQuery(name, value) { invalidate(); setQuery(previous => ({ ...previous, [name]: value, ...(name === 'source' ? { startDate: value === 'naip' ? '2010-01-01' : dateString(new Date(Date.now() - 365 * 86400000)) } : {}) })); }
  async function selectFile(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    const version = ++fileVersion.current;
    invalidate(); setGeometry(null); setZipName(''); setFeatureCount(0); setFileBusy(false);
    if (!file) return;
    if (!/\.(zip|geojson|json)$/i.test(file.name)) { setError('请上传完整 SHP 文件组成的 ZIP，或 WGS84 GeoJSON 面文件。'); return; }
    if (file.size > 25 * 1024 * 1024) { setError('文件最大支持 25 MB，请简化面边界。'); return; }
    setFileBusy(true);
    try {
      const decoded = /\.zip$/i.test(file.name) ? await shp(await file.arrayBuffer()) : JSON.parse(await file.text());
      const polygons = collectPolygons(decoded);
      if (!polygons.length) throw new Error('文件中没有 Polygon 或 MultiPolygon 面要素');
      if (polygons.flat(2).length > 10000) throw new Error('面边界超过 10000 个坐标点，请先简化');
      if (version === fileVersion.current) { setGeometry({ type: 'MultiPolygon', coordinates: polygons }); setFeatureCount(polygons.length); setZipName(file.name); }
    } catch (failure) { if (version === fileVersion.current) setError(`区域解析失败：${failure.message}`); }
    finally { if (version === fileVersion.current) setFileBusy(false); }
  }
  async function search(event, cursor = null) {
    event?.preventDefault();
    if (!geometry || busy) return;
    setError(''); setBusy(true);
    if (!cursor) setResult(null);
    const current = new AbortController(); controller.current = current;
    const timeout = setTimeout(() => current.abort(), 35000);
    try {
      const response = await fetch('/api/products/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cursor ? { cursor } : { ...query, geometry }), signal: current.signal });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error ?? '影像查询失败');
      if (controller.current === current) setResult(previous => cursor && previous ? { ...next, results: [...new Map([...previous.results, ...next.results].map(item => [item.id, item])).values()], scanned: previous.scanned + next.scanned, excluded: previous.excluded + next.excluded } : next);
    } catch (failure) { if (controller.current === current) setError(failure.name === 'AbortError' ? '公开影像查询超时，请重试' : failure.message); }
    finally { clearTimeout(timeout); if (controller.current === current) { controller.current = null; setBusy(false); } }
  }
  return <div className="product-content">
    <p className="modal-description">按研究区查询公开影像，无需注册或购买。选择来源后上传面边界，即可检索并下载原始影像文件。</p>
    <form onSubmit={search} className="product-search-form">
      <label className="public-source">影像来源<select aria-label="影像来源" value={query.source} onChange={event => changeQuery('source', event.target.value)}>{Object.entries(SOURCES).map(([id, source]) => <option key={id} value={id}>{source.name}</option>)}</select></label>
      <p className="source-coverage">{SOURCES[query.source].note}</p>
      <div className={`shape-upload ${geometry ? 'loaded' : ''}`}>
        <label className="shape-upload-target"><input type="file" accept=".zip,.geojson,.json" aria-label="上传 ZIP Shapefile 或 GeoJSON" onChange={selectFile} /><span className={`shape-icon ${fileBusy ? 'busy' : geometry ? 'loaded' : ''}`}><FileArchive size={18} /></span><span><strong>{fileBusy ? '正在读取区域…' : zipName || '上传研究区边界'}</strong><small>{geometry ? `${featureCount} 个面 · 仅用于空间检索` : 'SHP ZIP（包含 .prj）或 WGS84 GeoJSON · 最大 25 MB'}</small></span></label>
        {geometry && <button type="button" className="remove-shape" aria-label="移除 AOI 文件" onClick={() => { fileVersion.current++; invalidate(); setGeometry(null); setZipName(''); setFeatureCount(0); }}><X size={16} /></button>}
      </div>
      <div className="product-fields public-product-fields"><label>开始日期<input aria-label="影像开始日期" type="date" required value={query.startDate} onChange={event => changeQuery('startDate', event.target.value)} /></label><label>结束日期<input aria-label="影像结束日期" type="date" required min={query.startDate} value={query.endDate} onChange={event => changeQuery('endDate', event.target.value)} /></label><label>最大整景云量<select aria-label="最大云量" disabled={!SOURCES[query.source].cloud} value={query.maxCloud} onChange={event => changeQuery('maxCloud', event.target.value)}>{SOURCES[query.source].cloud ? ['10', '20', '30', '50', '80', '100'].map(value => <option key={value} value={value}>{value}%</option>) : <option value={query.maxCloud}>该来源不提供云量</option>}</select></label></div>
      <div className="product-search-actions"><button className="product-primary" disabled={!geometry || fileBusy || busy}><Search size={15} />{busy ? '正在查询…' : '查找影像'}</button><span>{geometry ? '按面边界相交检索，单景可能只覆盖部分区域' : '请先上传研究区边界'}</span></div>
    </form>
    {error && <p className="product-error" role="alert"><AlertCircle size={15} />{error}</p>}
    {result && <section className="product-results" aria-live="polite"><div className="product-results-heading"><div><span className="eyebrow">OPEN IMAGERY</span><h3>匹配影像 <strong>{result.results.length}</strong></h3><small>{result.sourceTitle} · 已检查 {result.scanned} 个场景{result.cursor ? ' · 还有更多结果' : ''}</small></div></div>
      {result.excluded > 0 && <p className="product-result-note">{result.excluded} 条记录因缺少可下载影像或不满足日期、云量条件未列出。</p>}
      {!result.results.length ? <div className="product-no-results"><Search size={21} /><strong>当前条件下没有可下载影像</strong><span>{query.source === 'naip' ? 'NAIP 仅覆盖美国，建议扩大日期范围；其他地区可切换 Sentinel-2。' : '请扩大日期范围或放宽云量条件，数据源可能有收录延迟。'}</span></div> : <div className="product-result-list">{result.results.map(item => <ProductRow key={item.id} item={item} />)}</div>}
      {result.cursor && <button className="product-secondary product-more" disabled={busy} onClick={event => search(event, result.cursor)}>{busy ? '正在加载…' : '加载更多影像'}</button>}
      <p className="product-disclaimer">下载为与区域相交的完整影像瓦片，未按 SHP 裁剪。GeoTIFF 文件可能有数百 MB；可用 QGIS 按研究区裁剪。下载入口保留 30 分钟，失效后重新查询。</p>
    </section>}
    <div className="product-sources"><span>公开数据：</span><a href="https://registry.opendata.aws/sentinel-2-l2a-cogs/" target="_blank" rel="noreferrer">Sentinel-2 <ExternalLink size={10} /></a><a href="https://planetarycomputer.microsoft.com/dataset/naip" target="_blank" rel="noreferrer">NAIP <ExternalLink size={10} /></a></div>
    <p className="product-privacy">文件在浏览器本地解析，仅将区域边界和筛选条件发送至对应公开目录。空间分辨率按每个下载波段标注。</p>
  </div>;
}
