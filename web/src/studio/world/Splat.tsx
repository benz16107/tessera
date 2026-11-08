// The photoreal world: the spot's Gaussian splat through Spark, which sorts splats in the normal three.js render and
// merges them with our meshes through the depth buffer. Our own data (CC BY-SA from Commons photos), so it may appear in
// renders; Google's tiles never do. Lives inside the east-north-up group at the offset from spots/<id>/SPLAT.md.
import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { SPLATS } from './geometry.ts';

export const splatRef: { current: SplatMesh | null } = { current: null };

/** First splat URL that answers, or null. Checked once per spot. */
export function useSplatUrl(spotId: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const override = new URLSearchParams(location.search).get('splat'); // test a splat file before its route exists
    if (override) { setUrl(override); return; }
    const cfg = SPLATS[spotId];
    if (!cfg) return;
    let live = true;
    (async () => {
      for (const u of cfg.urls) {
        try {
          const r = await fetch(u, { method: 'HEAD' });
          const type = r.headers.get('content-type') ?? '';
          if (r.ok && !type.includes('text/html') && !type.includes('json')) { if (live) setUrl(u); return; }
        } catch { /* try the next one */ }
      }
    })();
    return () => { live = false; };
  }, [spotId]);
  return url;
}

export default function Splat({ spotId, url, visible, onProgress, onLoaded }: {
  spotId: string; url: string; visible: boolean; onProgress?: (f: number) => void; onLoaded?: () => void;
}) {
  const { gl, scene } = useThree();
  const cfg = SPLATS[spotId];
  const spark = useMemo(() => new SparkRenderer({ renderer: gl }), [gl]);
  const mesh = useMemo(() => {
    const m = new SplatMesh({
      url,
      onProgress: e => { if (e.lengthComputable && e.total) onProgress?.(e.loaded / e.total); },
      onLoad: () => onLoaded?.(),
    });
    m.userData.world = true;
    splatRef.current = m;
    return m;
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  // The renderer object goes at the scene root (it collects every SplatMesh in the scene); the splat sits in the ENU group.
  useEffect(() => { scene.add(spark); return () => { scene.remove(spark); spark.dispose(); }; }, [spark, scene]);
  useEffect(() => () => { mesh.dispose(); if (splatRef.current === mesh) splatRef.current = null; }, [mesh]);
  return (
    <>
      <primitive object={mesh} position={cfg?.offset ?? [0, 0, 0]} visible={visible} />
    </>
  );
}
