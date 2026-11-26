import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Orbit } from 'lucide-react';
import { BDS_ORBIT_TYPES, CATEGORIES, REMOTE_MISSIONS, satelliteCategory, satelliteState } from './data.js';

function CheckMark({ checked, mixed = false, label, onChange }) {
  return <button className={`checkbox ${checked ? 'checked' : ''} ${mixed ? 'mixed' : ''}`} onClick={onChange} role="checkbox" aria-checked={mixed ? 'mixed' : checked} aria-label={label}>{checked && !mixed ? <Check size={11} strokeWidth={2.7} /> : mixed ? <i /> : null}</button>;
}
function SatelliteIcon({ color }) { return <span className="system-glyph" style={{ '--system-color': color }}><Orbit size={20} strokeWidth={1.3} /><i /></span>; }

export default function LayerTree({ catalog, visibleSatellites, active, bdsTypes, missions, counts, bdsCounts, onToggleSystem, onToggleBds, onSoloBds, onToggleMission, onSelect, onSoloCategory, onToggleCategory }) {
  const [expanded, setExpanded] = useState({ gnss: true, stations: true, remote: true });
  const [missionExpanded, setMissionExpanded] = useState({});
  const categorized = useMemo(() => Object.fromEntries(REMOTE_MISSIONS.map(mission => [mission.id, catalog.filter(s => s.system.category === 'remote' && s.mission === mission.id)])), [catalog]);
  return <div className="layer-tree" role="tree" aria-label="卫星目录树">
    {CATEGORIES.map(category => {
      const systems = catalog.map(s => s.system).filter((system, i, list) => satelliteCategory({ system }) === category.id && list.findIndex(x => x.id === system.id) === i);
      const systemIds = systems.map(s => s.id), selectedSystems = systemIds.filter(id => active.includes(id));
      const systemCount = visibleSatellites.filter(s => satelliteCategory(s) === category.id).length;
      const missionsComplete = category.id !== 'remote' || missions.length === REMOTE_MISSIONS.length;
      const checked = selectedSystems.length === systemIds.length && missionsComplete;
      const mixed = (selectedSystems.length > 0 || (category.id === 'remote' && missions.length > 0)) && !checked;
      return <section className="tree-category" role="treeitem" aria-expanded={expanded[category.id]} key={category.id}>
        <div className={`tree-row tree-root ${expanded[category.id] ? 'open' : ''}`}>
          <button className="tree-expand" aria-label={`${expanded[category.id] ? '收起' : '展开'}${category.name}`} onClick={() => setExpanded(v => ({ ...v, [category.id]: !v[category.id] }))}>{expanded[category.id] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
          <button className="tree-name" onClick={() => setExpanded(v => ({ ...v, [category.id]: !v[category.id] }))}>{category.name}<small>{systemCount} 颗</small></button>
          <button className="tree-solo" onClick={() => onSoloCategory(systemIds)} aria-label={`仅显示${category.name}`}>仅此类</button>
          <CheckMark checked={checked} mixed={mixed} label={`${category.name}图层`} onChange={() => onToggleCategory(systemIds, checked)} />
        </div>
        {expanded[category.id] && <div className="tree-children" role="group">
          {category.id !== 'remote' && systems.map(system => <section className={`tree-system ${active.includes(system.id) ? 'enabled' : ''}`} key={system.id}>
            <div className="tree-row tree-leaf">
              <SatelliteIcon color={system.color} />
              <button className="tree-name" aria-label={`查看${system.name}卫星`} onClick={() => onSelect(catalog.find(s => s.system.id === system.id && (system.id !== 'beidou' || bdsTypes.includes(s.type))) ?? catalog.find(s => s.system.id === system.id))}>{system.name}<small>{counts[system.id] ?? 0} 颗</small></button>
              <CheckMark checked={active.includes(system.id)} label={`${active.includes(system.id) ? '隐藏' : '显示'}${system.name}`} onChange={() => onToggleSystem(system.id)} />
            </div>
            {system.id === 'beidou' && <div className="bds-orbit-filters" role="group" aria-label="北斗轨道类型">{BDS_ORBIT_TYPES.map(type => <div key={type} className={active.includes('beidou') && bdsTypes.includes(type) ? 'enabled' : ''}><button role="checkbox" aria-checked={active.includes('beidou') && bdsTypes.includes(type)} aria-label={`北斗 ${type}`} onClick={() => onToggleBds(type)}><span className="type-check">{active.includes('beidou') && bdsTypes.includes(type) && <Check size={10} />}</span><strong>{type}</strong><small>{bdsCounts[type]}</small></button><button className="type-solo" aria-label={`仅显示北斗 ${type}`} onClick={() => onSoloBds(type)}>单独</button></div>)}</div>}
          </section>)}
          {category.id === 'remote' && REMOTE_MISSIONS.map(mission => {
            const items = categorized[mission.id], selected = missions.includes(mission.id) && items.some(s => active.includes(s.system.id)), count = items.filter(s => visibleSatellites.includes(s)).length;
            return <section className="tree-mission" role="treeitem" aria-expanded={!!missionExpanded[mission.id]} key={mission.id}>
              <div className={`tree-row tree-mission-row ${selected ? 'enabled' : ''}`}>
                <button className="tree-expand" aria-label={`${missionExpanded[mission.id] ? '收起' : '展开'}${mission.name}`} onClick={() => setMissionExpanded(v => ({ ...v, [mission.id]: !v[mission.id] }))}>{missionExpanded[mission.id] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
                <button className="tree-name" onClick={() => setMissionExpanded(v => ({ ...v, [mission.id]: !v[mission.id] }))}>{mission.name}<small>{count} 颗</small></button>
                <CheckMark checked={selected && active.some(id => ['resource', 'weather'].includes(id))} label={`${selected ? '隐藏' : '显示'}${mission.name}`} onChange={() => onToggleMission(mission.id)} />
              </div>
              {missionExpanded[mission.id] && <div className="tree-satellite-list" role="group">{items.map(sat => <button key={sat.id} onClick={() => onSelect(sat)} title={`NORAD ${sat.noradId} · ${sat.name}`}><i style={{ background: sat.system.color }} /><span>{sat.name}</span><small>{sat.noradId}</small></button>)}</div>}
            </section>;
          })}
        </div>}
      </section>;
    })}
  </div>;
}
