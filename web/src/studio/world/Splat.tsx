// The photoreal world: the spot's Gaussian splat through Spark, which sorts splats in the normal three.js render and
// merges them with our meshes through the depth buffer. Our own data (CC BY-SA from Commons photos), so it may appear in
// renders; Google's tiles never do. Lives inside the east-north-up group at the offset from spots/<id>/SPLAT.md.
import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { SPLATS } from './geometry.ts';

export const splatRef: { current: SplatMesh | null } = { current: null };
/** Spark's renderer object. Secondary renders (picture-in-picture, render layers) hide this, not the splat mesh: Spark rebuilds
 *  its splat list a frame late, so toggling the mesh every frame would leave the main view with an empty list. */
export const sparkRef: { current: SparkRenderer | null } = { current: null };

/** First splat URL that answers, or null. Checked once per spot. */
export function useSplatUrl(spotId: string, full = false, skip: string[] = []) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const override = new URLSearchParams(location.search).get('splat'); // test a splat file before its route exists
    if (override) { setUrl(override); return; }
    const cfg = SPLATS[spotId];
    if (!cfg) return;
    let live = true;
    setUrl(null);
    (async () => {
      for (const u of (full ? [...cfg.full, ...cfg.urls] : cfg.urls).filter(x => !skip.includes(x))) {
        try {
          const r = await fetch(u, { method: 'HEAD' });
          const type = r.headers.get('content-type') ?? '';
          if (r.ok && !type.includes('text/html') && !type.includes('json')) { if (live) setUrl(u); return; }
        } catch { /* try the next one */ }
      }
    })();
    return () => { live = false; };
  }, [spotId, full, skip.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

export default function Splat({ spotId, url, visible, onProgress, onLoaded, onError }: {
  spotId: string; url: string; visible: boolean; onProgress?: (f: number) => void; onLoaded?: () => void; onError?: (e: unknown) => void;
}) {
  const { gl, scene } = useThree();
  const cfg = SPLATS[spotId];
  const spark = useMemo(() => new SparkRenderer({ renderer: gl }), [gl]);
  const mesh = useMemo(() => {
    const m = new SplatMesh({
      url,
      lod: true, // Spark builds a level-of-detail tree in a worker, so far splats draw coarser and laptops keep their frame rate
      onProgress: e => { if (e.lengthComputable && e.total) onProgress?.(e.loaded / e.total); },
      onLoad: () => onLoaded?.(),
    });
    m.userData.world = true;
    m.initialized.catch(e => onError?.(e)); // a file Spark can't parse: the studio moves to the next one
    splatRef.current = m;
    return m;
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  // The renderer object goes at the scene root (it collects every SplatMesh in the scene); the splat sits in the ENU group.
  useEffect(() => {
    scene.add(spark); sparkRef.current = spark;
    return () => { scene.remove(spark); spark.dispose(); if (sparkRef.current === spark) sparkRef.current = null; };
  }, [spark, scene]);
  useEffect(() => () => { mesh.dispose(); if (splatRef.current === mesh) splatRef.current = null; }, [mesh]);
  return (
    <>
      <primitive object={mesh} position={cfg?.offset ?? [0, 0, 0]} visible={visible} />
    </>
  );
}
