// The Simple | Studio toggle. It sits in the same place in both top bars (right after the logo). Switching remembers the
// choice, hands the selection over and changes the URL; App keeps both views mounted, so nothing reloads.
import { useEffect, useRef, useState } from 'react';
import { navigate } from '../App.tsx';
import { handOff, rememberView, takeHandoff, viewPath, type ViewName } from './view.ts';
import './switch.css';

interface Props {
  code: string;
  current: ViewName;
  selected?: bigint | null; // the object selected in this view, handed to the other one
  /** Runs when this view becomes active. `first` is true when it was just opened from the other view. */
  onArrive?: (h: { selected: bigint | null; first: boolean }) => void;
}

const activeIn = (v: ViewName, path: string) => (v === 'studio' ? path.startsWith('/studio/') : path.startsWith('/p/'));

export function ViewSwitch({ code, current, selected = null, onArrive }: Props) {
  const [path, setPath] = useState(location.pathname);
  const first = useRef(true);
  const arrive = useRef(onArrive);
  arrive.current = onArrive;

  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);

  useEffect(() => {
    if (!activeIn(current, path)) return;
    const h = takeHandoff(current, code);
    if (h) arrive.current?.({ selected: h.selected, first: first.current });
    first.current = false;
  }, [path, current, code]);

  const go = (to: ViewName) => {
    if (to === current) return;
    rememberView(to);
    handOff({ to, code, selected });
    navigate(viewPath(to, code));
  };

  return (
    <div className="vswitch" role="group" aria-label="View">
      {(['simple', 'studio'] as const).map(v => (
        <button key={v} type="button" aria-pressed={v === current} onClick={() => go(v)}>{v === 'simple' ? 'Simple' : 'Studio'}</button>
      ))}
    </div>
  );
}
