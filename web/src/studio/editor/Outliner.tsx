// Outliner: the scene tree (Scene > shot cameras, sun, lights, people, props, original photo), as in Figma frame 26:12.
import { useState } from 'react';
import type { SceneObject } from '../../module_bindings/types.ts';
import { parseParams, num } from '../scene/objects.ts';
import { Ico, type IconName } from './ui.tsx';

export type WorldMode = 'splat' | 'clayPhoto' | 'clay' | 'tiles' | 'off';
export const WORLD_LABEL: Record<WorldMode, string> = { splat: 'Splat', clayPhoto: 'Clay + photo', clay: 'Clay', tiles: '3D Tiles', off: 'Hidden' };

interface Props {
  rows: SceneObject[];
  selected: bigint | null;
  shotId: bigint | null;
  camLabel: (r: SceneObject) => { name: string; sub: string };
  lockOwner: (r: SceneObject) => { name: string; color: string } | null;
  onSelect: (id: bigint) => void;
  onToggle: (r: SceneObject) => void;
  spotLabel: string;
  world: WorldMode; worlds: WorldMode[]; onWorld: (w: WorldMode) => void;
  sunTime: string;
  photo?: { width: number; height: number };
  onAdd: () => void;
  addOpen: boolean;
}

const lightLine = (r: SceneObject) => {
  const p = parseParams(r.params), k = num(p, 'k', 5500), size = num(p, 'size', 0.3);
  const t = { area: `area light ${size.toFixed(1)} m`, spot: 'spot', point: 'bulb', sun: 'directional' }[r.lightType] ?? r.lightType;
  return `${r.name} · ${t} ${k} K`;
};
const personLine = (r: SceneObject) => {
  const p = parseParams(r.params);
  const pose = p.pose ?? 'stand';
  const verb: Record<string, string> = { stand: 'standing', walk: 'walking', sit: 'sitting', lean: 'leaning', point: 'pointing', jump: 'jumping', talk: 'talking', crouch: 'crouching', push: 'pushing' };
  return `${r.name.replace(/ \(.*\)$/, '')}, ${verb[pose] ?? pose}`;
};
const propIcon = (r: SceneObject): IconName => {
  const p = parseParams(r.params);
  if (p.type === 'image') return 'image';
  if (/bike|bicycle/i.test(r.assetId + r.name)) return 'bike';
  if (/car|taxi|suv/i.test(r.assetId)) return 'car';
  if (/parasol|umbrella/i.test(r.assetId + r.name)) return 'umbrella';
  return 'cube';
};

export default function Outliner(p: Props) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (g: string) => setClosed(s => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const Row = ({ r, depth, icon, name, sub, meta }: { r: SceneObject; depth: number; icon: IconName; name: string; sub?: string; meta?: React.ReactNode }) => {
    const lock = p.lockOwner(r);
    const sel = r.id === p.selected;
    return (
      <li role="treeitem" aria-selected={sel}>
        <div className="st-ol-row" aria-selected={sel} data-hidden={!r.visible} style={{ ['--d' as string]: depth, minHeight: sub ? 44 : undefined }}>
          <span className="chev" />
          <button style={{ display: 'contents' }} onClick={() => p.onSelect(r.id)} aria-label={`Select ${name}`}>
            <Ico n={icon} />
            <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="name">{name}</span>
              {sub && <span className="sub">{sub}</span>}
            </span>
          </button>
          <span className="spacer" />
          {lock && <span className="st-who" style={{ ['--c' as string]: lock.color }} title={`${lock.name} is moving this`}>{lock.name.slice(0, 1).toUpperCase()}</span>}
          {meta}
          {!r.visible && <span className="st-meta">hidden</span>}
          {(
            <button className="st-eye" aria-pressed={r.visible} onClick={() => p.onToggle(r)} aria-label={`${r.visible ? 'Hide' : 'Show'} ${name}`}>
              <Ico n={r.visible ? 'eye' : 'eye-slash'} />
            </button>
          )}
        </div>
      </li>
    );
  };
  const Group = ({ id, icon, label, rows, children }: { id: string; icon: IconName; label: string; rows: SceneObject[]; children: React.ReactNode }) => {
    if (!rows.length) return null;
    const open = !closed.has(id);
    return (
      <li role="treeitem" aria-expanded={open} aria-selected={false}>
        <button className="st-ol-row" style={{ ['--d' as string]: 0 }} onClick={() => toggle(id)}>
          <Ico n="down" s={10} style={{ rotate: open ? '0deg' : '-90deg' }} />
          <Ico n={icon} />
          <span className="name group">{label}</span>
          <span className="spacer" />
          <span className="st-meta">{rows.length}</span>
        </button>
        {open && <ul className="st-ol" role="group">{children}</ul>}
      </li>
    );
  };
  const cams = p.rows.filter(r => r.kind === 'camera');
  const lights = p.rows.filter(r => r.kind === 'light');
  const people = p.rows.filter(r => r.kind === 'person');
  const props = p.rows.filter(r => r.kind === 'model' || r.kind === 'prop_generated' || r.kind === 'text');
  const nextWorld = p.worlds[(p.worlds.indexOf(p.world) + 1) % p.worlds.length];

  return (
    <>
      <div className="st-panel-head">
        <h2>Scene</h2>
        <button className="st-meta" onClick={() => p.onWorld(nextWorld)} title={`World: ${WORLD_LABEL[p.world]}. Click for ${WORLD_LABEL[nextWorld]}.`}>{WORLD_LABEL[p.world]}</button>
        <button className="st-icon-btn" onClick={p.onAdd} aria-expanded={p.addOpen} aria-label="Add people, props and lights (Shift+A)" title="Add (Shift+A)">
          <span aria-hidden="true" style={{ font: '400 20px/1 var(--sans)', marginTop: -2 }}>+</span>
        </button>
      </div>
      <nav className="st-outliner" aria-label="Scene">
        <ul className="st-ol" role="tree">
          {cams.map(r => {
            const l = p.camLabel(r);
            return <Row key={String(r.id)} r={r} depth={0} icon="camera" name={l.name} sub={l.sub}
              meta={r.id === p.shotId ? <span className="st-tag">shot</span> : undefined} />;
          })}
          <li role="treeitem" aria-selected={false}>
            <div className="st-ol-row" style={{ ['--d' as string]: 0 }}>
              <span className="chev" /><Ico n="sun" /><span className="name">Sun</span><span className="spacer" /><span className="st-meta">{p.sunTime}</span>
            </div>
          </li>
          <Group id="people" icon="walk" label="People" rows={people}>
            {people.map(r => <Row key={String(r.id)} r={r} depth={1} icon="walk" name={personLine(r)} />)}
          </Group>
          <Group id="props" icon="cube" label="Props" rows={props}>
            {props.map(r => {
              const prm = parseParams(r.params);
              const tag = r.kind === 'prop_generated' ? <span className="st-tag">{prm.type === 'image' ? 'image' : 'generated'}</span> : undefined;
              return <Row key={String(r.id)} r={r} depth={1} icon={propIcon(r)} name={r.name} meta={tag} />;
            })}
          </Group>
          <Group id="lights" icon="bulb" label="Lights" rows={lights}>
            {lights.map(r => <Row key={String(r.id)} r={r} depth={1} icon={r.lightType === 'area' ? 'lamp' : 'bulb'} name={lightLine(r)} />)}
          </Group>
          {p.photo && (
            <li role="treeitem" aria-selected={false}>
              <div className="st-ol-row" style={{ ['--d' as string]: 0 }}>
                <span className="chev" /><Ico n="image" /><span className="name">Your photo</span><span className="spacer" />
                <span className="st-meta">{p.photo.width} × {p.photo.height}</span>
              </div>
            </li>
          )}
        </ul>
        {people.length + props.length + lights.length === 0 && <p className="st-empty-note">Nothing placed yet. Press + to add people, props and lights.</p>}
      </nav>
    </>
  );
}
