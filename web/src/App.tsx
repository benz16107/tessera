import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import Credits from './Credits.tsx';

const Planner = lazy(() => import('./Planner.tsx'));
const Scout = lazy(() => import('./Scout.tsx'));

/** Shows a reload prompt when a chunk fails to download (flaky networks) instead of a blank page. */
export class LoadBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="load-failed" role="alert">
        <p>{this.props.label} did not load. The connection may have dropped.</p>
        <button className="btn" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}

/** Tiny path router: /, /p/:code, /s/:code, /credits. */
export function navigate(path: string) {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

export default function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);

  if (path.startsWith('/credits')) return <Credits />;
  const m = path.match(/^\/([ps])\/([A-Za-z0-9]{4,12})/);
  const code = m?.[2].toUpperCase();
  return (
    <LoadBoundary label="ShotMatch">
      <Suspense fallback={<div className="boot-skeleton" aria-busy="true" />}>
        {m?.[1] === 's' && code ? <Scout code={code} /> : <Planner code={code} />}
      </Suspense>
    </LoadBoundary>
  );
}
