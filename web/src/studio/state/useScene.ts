// The live set: every scene_object row of the session, the reducers that edit it, gizmo locks, drag streaming at 10 Hz,
// and undo/redo of this client's own edits (keyed by the uid each client writes into params, so a re-added row still matches).
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from '../../module_bindings/index.ts';
import type { SceneObject } from '../../module_bindings/types.ts';
import { keyOf, stateOf, parseParams, type ObjState } from '../scene/objects.ts';

interface Edit { key: string; before: ObjState | null; after: ObjState | null; at: number; tag: string }

const DRAG_MS = 100; // about 10 updates a second while a gizmo moves

export function useScene(sessionId: bigint) {
  const [rows, ready] = useTable(tables.sceneObject.where(r => r.sessionId.eq(sessionId)));
  const add = useReducer(reducers.addSceneObject);
  const update = useReducer(reducers.updateSceneObject);
  const remove = useReducer(reducers.deleteSceneObject);
  const lock = useReducer(reducers.lockSceneObject);
  const [error, setError] = useState('');
  const undoStack = useRef<Edit[]>([]);
  const redoStack = useRef<Edit[]>([]);
  const [, bump] = useState(0);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const sorted = useMemo(() => [...rows].sort((a, b) => Number(a.id - b.id)), [rows]);
  const fail = useCallback((e: unknown) => setError(String((e as Error)?.message ?? e)), []);
  const byKey = (key: string) => rowsRef.current.find(r => keyOf(r) === key);

  /** Write a state to the row with this key: add it if missing, delete it for null. */
  const apply = useCallback(async (key: string, s: ObjState | null) => {
    const row = byKey(key);
    if (!s) { if (row) await remove({ id: row.id }); return; }
    if (!row) await add({ sessionId, ...s });
    else await update({ id: row.id, sessionId, ...s });
  }, [add, update, remove, sessionId]);

  const record = (e: Omit<Edit, 'at'>) => {
    const last = undoStack.current[undoStack.current.length - 1];
    // Typing in one inspector field merges into one undo step.
    if (last && e.tag && last.tag === e.tag && last.key === e.key && performance.now() - last.at < 800) {
      last.after = e.after; last.at = performance.now();
    } else undoStack.current.push({ ...e, at: performance.now() });
    if (undoStack.current.length > 200) undoStack.current.shift();
    redoStack.current = [];
    bump(n => n + 1);
  };

  const addObject = useCallback((s: ObjState) => {
    const key = parseParams(s.params).uid ?? '';
    add({ sessionId, ...s }).catch(fail);
    if (key) record({ key, before: null, after: s, tag: '' });
  }, [add, sessionId, fail]);

  /** updateSceneObject replaces the whole row, so send only what this edit changed (against `base`, the state it started
   *  from) on top of the freshest copy of the row: two people renaming and moving one object both keep their edit. */
  const onLatest = (id: bigint, base: ObjState, s: ObjState): ObjState => {
    const latest = rowsRef.current.find(r => r.id === id);
    if (!latest) return s;
    const out = stateOf(latest) as unknown as Record<string, unknown>;
    for (const k of Object.keys(s) as (keyof ObjState)[]) if (s[k] !== base[k]) out[k] = s[k];
    return out as unknown as ObjState;
  };
  const setObject = useCallback((row: SceneObject, s: ObjState, tag = '') => {
    record({ key: keyOf(row), before: stateOf(row), after: s, tag });
    update({ id: row.id, sessionId, ...onLatest(row.id, stateOf(row), s) }).catch(fail);
  }, [update, sessionId, fail]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteObject = useCallback((row: SceneObject) => {
    record({ key: keyOf(row), before: stateOf(row), after: null, tag: '' });
    remove({ id: row.id }).catch(fail);
  }, [remove, fail]);

  const undo = useCallback(() => {
    const e = undoStack.current.pop();
    if (!e) return;
    redoStack.current.push(e);
    bump(n => n + 1);
    apply(e.key, e.before).catch(fail);
  }, [apply, fail]);
  const redo = useCallback(() => {
    const e = redoStack.current.pop();
    if (!e) return;
    undoStack.current.push(e);
    bump(n => n + 1);
    apply(e.key, e.after).catch(fail);
  }, [apply, fail]);

  // Gizmo drags: lock, stream at 10 Hz, final write and unlock on drop, one undo step for the whole drag.
  const drag = useRef<{ row: SceneObject; before: ObjState; last: number; pending: ObjState | null; timer?: number } | null>(null);
  const beginDrag = useCallback((row: SceneObject) => {
    drag.current = { row, before: stateOf(row), last: 0, pending: null };
    lock({ id: row.id, lock: true }).catch(fail);
  }, [lock, fail]);
  const flushDrag = useCallback(() => {
    const d = drag.current;
    if (!d?.pending) return;
    const s = d.pending;
    d.pending = null; d.last = performance.now();
    update({ id: d.row.id, sessionId, ...onLatest(d.row.id, d.before, s) }).catch(fail);
  }, [update, sessionId, fail]); // eslint-disable-line react-hooks/exhaustive-deps
  const moveDrag = useCallback((s: ObjState) => {
    const d = drag.current;
    if (!d) return;
    d.pending = s;
    clearTimeout(d.timer);
    const wait = DRAG_MS - (performance.now() - d.last);
    if (wait <= 0) flushDrag(); else d.timer = window.setTimeout(flushDrag, wait);
  }, [flushDrag]);
  const endDrag = useCallback((s: ObjState) => {
    const d = drag.current;
    if (!d) return;
    clearTimeout(d.timer);
    drag.current = null;
    record({ key: keyOf(d.row), before: d.before, after: s, tag: '' });
    update({ id: d.row.id, sessionId, ...onLatest(d.row.id, d.before, s) }).catch(fail)
      .finally(() => lock({ id: d.row.id, lock: false }).catch(fail));
  }, [update, lock, sessionId, fail]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    rows: sorted, ready, error, clearError: () => setError(''),
    addObject, setObject, deleteObject, undo, redo,
    canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0,
    beginDrag, moveDrag, endDrag, draggingId: () => drag.current?.row.id,
  };
}
export type SceneApi = ReturnType<typeof useScene>;
