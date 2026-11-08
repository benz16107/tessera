import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import Credits from './Credits.tsx';
import { storedView, viewPath, type ViewName } from './simple/view.ts';

const Home = lazy(() => import('./simple/Drop.tsx')); // the drop page stays light: no 3D libraries
const Simple = lazy(() => import('./simple/Simple.tsx'));
const Legal = lazy(() => import('./simple/Legal.tsx'));
const Scout = lazy(() => import('./Scout.tsx'));
const Studio = lazy(() => import('./studio/Studio.tsx'));

/** Keep a failed view recoverable and show the error needed to diagnose it. */
export class LoadBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean; error: string }> {
  state = { failed: false, error: '' };
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: Error) {
    console.error(`${this.props.label} failed to load`, error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="load-failed" role="alert">
        <p>{this.props.label} did not load.</p>
        <p>{/webgl|webglrenderer|graphics context/i.test(this.state.error)
          ? 'The browser could not start the 3D graphics view. Check that hardware acceleration is enabled, then reload.'
          : 'Reload to try again. If it still fails, share the error below.'}</p>
        <details open><summary>Error details</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: '60ch' }}>{this.state.error}</pre></details>
        <button className="btn" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}

/** Tiny path router: /, /p/:code (Simple), /studio/:code (Studio), /s/:code (scout), /credits, /privacy, /terms. */
export function navigate(path: string) {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

type Route =
  | { kind: 'home' } | { kind: 'credits' } | { kind: 'legal'; page: 'privacy' | 'terms' }
  | { kind: 'scout'; code: string } | { kind: 'set'; code: string; view: ViewName };

function parse(path: string): Route {
  if (path.startsWith('/credits')) return { kind: 'credits' };
  if (path === '/privacy' || path === '/terms') return { kind: 'legal', page: path.slice(1) as 'privacy' | 'terms' };
  const m = path.match(/^\/(p|s|studio)\/([A-Za-z0-9]{4,12})/);
  if (!m) return { kind: 'home' };
  const code = m[2].toUpperCase();
  if (m[1] === 's') return { kind: 'scout', code };
  return { kind: 'set', code, view: m[1] === 'studio' ? 'studio' : 'simple' };
}

// On arrival, a person's remembered choice of view wins over the link they opened (no choice: the link decides).
function arrive(): string {
  const r = parse(location.pathname);
  const want = storedView();
  if (r.kind === 'set' && want && want !== r.view) history.replaceState(null, '', viewPath(want, r.code) + location.search);
  return location.pathname;
}

// Studio's keyboard shortcuts listen on window. While Studio is mounted but hidden behind Simple, they must not fire.
const STUDIO_KEYS = new Set(['g', 'r', 's', 'w', 'q', 'm', 'x', 'f', 'l', 'h', 'a', 'z', 'y', '0', '1', '3', '5', '7', 'delete', 'home', 'escape']);

export default function App() {
  const [path, setPath] = useState(arrive);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  const r = parse(path);

  // Both views of one shoot stay mounted once opened, so switching keeps the connection, selection and camera.
  const kept = useRef<{ code: string; views: Set<ViewName> } | null>(null);
  if (r.kind === 'set') {
    if (kept.current?.code !== r.code) kept.current = { code: r.code, views: new Set() };
    kept.current.views.add(r.view);
  }
  const studioHidden = r.kind === 'set' && r.view !== 'studio' && !!kept.current?.views.has('studio');
  useEffect(() => {
    if (!studioHidden) return;
    const guard = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, select, textarea, [contenteditable]')) return;
      if (STUDIO_KEYS.has(e.key.toLowerCase())) e.stopPropagation();
    };
    addEventListener('keydown', guard, true);
    return () => removeEventListener('keydown', guard, true);
  }, [studioHidden]);

  if (r.kind === 'credits') return <Credits />;
  const boot = <div className="boot-skeleton" aria-busy="true" />;
  if (r.kind === 'set' && kept.current) {
    const views = kept.current.views;
    return (
      <>
        {(['simple', 'studio'] as const).filter(v => views.has(v)).map(v => (
          <div key={v} style={{ display: v === r.view ? 'contents' : 'none' }}>
            <LoadBoundary label={v === 'studio' ? 'The studio' : 'ShotMatch'}>
              <Suspense fallback={boot}>
                {v === 'studio' ? <Studio code={r.code} /> : <Simple code={r.code} active={r.view === 'simple'} />}
              </Suspense>
            </LoadBoundary>
          </div>
        ))}
      </>
    );
  }
  return (
    <LoadBoundary label="ShotMatch">
      <Suspense fallback={boot}>
        {r.kind === 'scout' ? <Scout code={r.code} /> : r.kind === 'legal' ? <Legal page={r.page} /> : <Home />}
      </Suspense>
    </LoadBoundary>
  );
}
