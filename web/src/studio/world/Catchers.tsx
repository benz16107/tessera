// Shadow catchers and occluders from the street geometry (or a flat plane at z = 0 for a spot without it).
// Catchers are invisible except for the shadows on them (THREE.ShadowMaterial), so a bike shadows the real street and walls.
// Occluders write depth only and hide objects that sit behind a facade; they are on in the shot view and the render layers.
import { useMemo } from 'react';
import { TeleportTarget } from '@react-three/xr';
import type { ThreeEvent } from '@react-three/fiber';
import type { Vector3 } from 'three';
import { groundGeometry, facadeGeometry, occluderGeometry, type StreetGeometry } from './geometry.ts';

interface Props {
  geo: StreetGeometry | null;
  occlude: boolean;
  shadowOpacity: number;
  onTeleport: (p: Vector3) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}

export default function Catchers({ geo, occlude, shadowOpacity, onTeleport, onPointerMove, onClick }: Props) {
  const ground = useMemo(() => (geo ? groundGeometry(geo) : null), [geo]);
  const walls = useMemo(() => (geo ? facadeGeometry(geo) : null), [geo]);
  const occ = useMemo(() => (geo ? occluderGeometry(geo) : null), [geo]);
  const mat = <shadowMaterial transparent opacity={shadowOpacity} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} side={2} />;
  return (
    <>
      <TeleportTarget onTeleport={p => onTeleport(p.clone())}>
        {ground
          ? <mesh geometry={ground} receiveShadow userData={{ ground: true, catcher: true }} renderOrder={2} onPointerMove={onPointerMove} onClick={onClick}>{mat}</mesh>
          : <mesh position={[0, 0, 0.01]} receiveShadow userData={{ ground: true, catcher: true }} renderOrder={2} onPointerMove={onPointerMove} onClick={onClick}>
              <planeGeometry args={[3000, 3000]} />{mat}
            </mesh>}
      </TeleportTarget>
      {walls && <mesh geometry={walls} receiveShadow userData={{ catcher: true, wall: true }} renderOrder={2}>{mat}</mesh>}
      {occ && <mesh geometry={occ} visible={occlude} renderOrder={-1} userData={{ occluder: true }} raycast={() => null}>
        <meshBasicMaterial colorWrite={false} side={2} />
      </mesh>}
    </>
  );
}
