// Check-in markers inside the studio's east-north-up group: where the solver put each scout's texted photo, which way it
// faced, and how far off the mark it was. Rows come from useCheckins outside the canvas (R3F does not carry React context).
import { Html } from '@react-three/drei';
import type { Checkin } from '../module_bindings/types.ts';

const COLOR: Record<string, string> = { 'on the mark': '#5ec8c2', close: '#f2a33a', 'off the mark': '#e8675e' };

export function CheckinMarks({ rows }: { rows: Checkin[] }) {
  return (
    <group userData={{ helper: true }}>
      {rows.map(c => {
        const color = COLOR[c.verdict] ?? '#a39f96', yaw = (-c.heading * Math.PI) / 180;
        return (
          <group key={String(c.id)} position={[c.x, c.y, 0.04]}>
            <mesh><ringGeometry args={[0.35, 0.5, 40]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
            {/* which way the phone faced: a 2 m line along the solved heading */}
            <mesh rotation={[0, 0, yaw]} position={[Math.sin((c.heading * Math.PI) / 180), Math.cos((c.heading * Math.PI) / 180), 0]}>
              <boxGeometry args={[0.06, 2, 0.02]} /><meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            <Html position={[0, 0, 1.2]} center className="ph-mark-tag" style={{ ['--ph-c' as string]: color }}>
              {c.name || 'Scout'} checked in: {c.verdict}, {c.distanceM.toFixed(1)} m
            </Html>
          </group>
        );
      })}
    </group>
  );
}
