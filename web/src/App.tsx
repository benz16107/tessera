import { lazy, Suspense, useEffect, useState } from 'react';
import Credits from './Credits.tsx';

const Planner = lazy(() => import('./Planner.tsx'));
const Scout = lazy(() => import('./Scout.tsx'));

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
    <Suspense fallback={<div className="boot-skeleton" aria-busy="true" />}>
      {m?.[1] === 's' && code ? <Scout code={code} /> : <Planner code={code} />}
    </Suspense>
  );
}
