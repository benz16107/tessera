// Mount points for the panels other workers build in web/src/nvidia and web/src/spacetime. import.meta.glob resolves to
// an empty map while a folder does not exist, so the studio builds either way and picks the panels up once they export.
import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react';

const NVIDIA = import.meta.glob('../nvidia/index.ts');
const SPACETIME = import.meta.glob('../spacetime/index.ts');
const PHOTON = import.meta.glob('../photon/index.ts');

type Mod = Record<string, unknown>;
const cache = new Map<object, Promise<Mod>>();

function useMod(glob: Record<string, () => Promise<unknown>>) {
  const [mod, setMod] = useState<Mod | null>(null);
  useEffect(() => {
    const load = Object.values(glob)[0];
    if (!load) { setMod({}); return; }
    if (!cache.has(glob)) cache.set(glob, load().then(m => m as Mod).catch(() => ({})));
    let live = true;
    cache.get(glob)!.then(m => { if (live) setMod(m); });
    return () => { live = false; };
  }, [glob]);
  return mod;
}

class Guard extends Component<{ children: ReactNode; label: string }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() { return this.state.error ? <p className="st-slot warn">{this.props.label} failed: {this.state.error}</p> : this.props.children; }
}

function Slot({ glob, owner, name, props, fallbackText }: { glob: Record<string, () => Promise<unknown>>; owner: string; name: string; props: Record<string, unknown>; fallbackText?: string }) {
  const mod = useMod(glob);
  const C = mod?.[name] as ComponentType<Record<string, unknown>> | undefined;
  if (C) return <Guard label={name}><C {...props} /></Guard>;
  if (!mod || fallbackText === '') return null;
  return <p className="st-slot">{fallbackText ?? `${owner} ${name} mounts here once web/src/${owner.toLowerCase()} exports it.`}</p>;
}

export const NvidiaSlot = (p: { name: string; props: Record<string, unknown>; fallbackText?: string }) => <Slot glob={NVIDIA} owner="NVIDIA" {...p} />;
export const SpacetimeSlot = (p: { name: string; props: Record<string, unknown>; fallbackText?: string }) => <Slot glob={SPACETIME} owner="SpacetimeDB" {...p} fallbackText={p.fallbackText ?? ''} />;
/** Whether the NVIDIA module exports a component, for choosing between its panel and the studio's own fallback. */
export function useNvidiaHas(name: string) { const m = useMod(NVIDIA); return m ? !!m[name] : null; }
/** The web/src/spacetime module once loaded (null while loading, {} when the folder does not exist). */
export const useSpacetimeMod = () => useMod(SPACETIME);
export const PhotonSlot = (p: { name: string; props: Record<string, unknown>; fallbackText?: string }) => <Slot glob={PHOTON} owner="Photon" {...p} fallbackText={p.fallbackText ?? ''} />;
export const usePhotonMod = () => useMod(PHOTON);
