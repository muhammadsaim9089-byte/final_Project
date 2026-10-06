import { useCallback, useEffect, useRef, useState } from 'react';
import { Node, Edge } from '@xyflow/react';
import type { ProjectMeta } from '@/lib/model/types';

interface HistoryState {
  nodes: Node[];
  edges: Edge[];
  meta?: ProjectMeta;
}

/**
 * Undo / redo over the diagram. Besides nodes and edges it now records the schema meta
 * (enums, table-group styling, views), so collapsing a group or editing an enum can be undone too.
 */
export function useUndoRedo(
  nodes: Node[],
  setNodes: (nodes: Node[] | ((nds: Node[]) => Node[])) => void,
  edges: Edge[],
  setEdges: (edges: Edge[] | ((eds: Edge[]) => Edge[])) => void,
  meta?: ProjectMeta,
  setMeta?: (meta: ProjectMeta) => void
) {
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const isUndoingRef = useRef(false);

  const historyRef = useRef<HistoryState[]>([]);
  const currentIndexRef = useRef(-1);
  const metaRef = useRef<ProjectMeta | undefined>(meta);
  metaRef.current = meta;

  // Sync refs with state
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const takeSnapshot = useCallback((override?: Partial<HistoryState>) => {
    if (isUndoingRef.current) return;

    const currentHistory = historyRef.current;
    const currIndex = currentIndexRef.current;

    const newHistory = currentHistory.slice(0, currIndex + 1);
    const lastState = newHistory[newHistory.length - 1];

    const snapNodes = override?.nodes ?? nodes;
    const snapEdges = override?.edges ?? edges;
    const snapMeta = override?.meta ?? metaRef.current;

    if (
      lastState &&
      JSON.stringify(lastState.nodes) === JSON.stringify(snapNodes) &&
      JSON.stringify(lastState.edges) === JSON.stringify(snapEdges) &&
      JSON.stringify(lastState.meta) === JSON.stringify(snapMeta)
    ) {
      return;
    }

    const nextHistory = [
      ...newHistory,
      { nodes: JSON.parse(JSON.stringify(snapNodes)), edges: JSON.parse(JSON.stringify(snapEdges)), meta: snapMeta ? JSON.parse(JSON.stringify(snapMeta)) : undefined },
    ];
    // very large diagrams keep a shorter history so memory stays reasonable
    const limit = snapNodes.length > 300 ? 12 : 50;
    while (nextHistory.length > limit) nextHistory.shift();

    // refs first, so a second snapshot in the same tick (e.g. "before" + "after" an auto-arrange) builds on this one
    historyRef.current = nextHistory;
    currentIndexRef.current = nextHistory.length - 1;
    setHistory(nextHistory);
    setCurrentIndex(nextHistory.length - 1);
  }, [nodes, edges]);

  const restore = useCallback(
    (state: HistoryState) => {
      setNodes(state.nodes);
      setEdges(state.edges);
      if (state.meta && setMeta) setMeta(state.meta);
    },
    [setNodes, setEdges, setMeta]
  );

  const undo = useCallback(() => {
    const currIndex = currentIndexRef.current;
    const currentHistory = historyRef.current;

    if (currIndex > 0) {
      isUndoingRef.current = true;
      restore(currentHistory[currIndex - 1]);
      currentIndexRef.current = currIndex - 1;
      setCurrentIndex(currIndex - 1);
      // Wait for next animation frame to clear the isUndoing block,
      // ensuring React has flushed the state updates.
      requestAnimationFrame(() => {
        isUndoingRef.current = false;
      });
    }
  }, [restore]);

  const redo = useCallback(() => {
    const currIndex = currentIndexRef.current;
    const currentHistory = historyRef.current;

    if (currIndex < currentHistory.length - 1) {
      isUndoingRef.current = true;
      restore(currentHistory[currIndex + 1]);
      currentIndexRef.current = currIndex + 1;
      setCurrentIndex(currIndex + 1);
      requestAnimationFrame(() => {
        isUndoingRef.current = false;
      });
    }
  }, [restore]);

  // Global hotkeys for Undo/Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if user is typing in an input field to avoid triggering undo
      const el = e.target as HTMLElement | null;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        el?.closest?.('.cm-editor') // the DBML editor has its own undo history
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const reset = useCallback(() => {
    setHistory([]);
    setCurrentIndex(-1);
    historyRef.current = [];
    currentIndexRef.current = -1;
  }, []);

  return { takeSnapshot, undo, redo, reset, canUndo: currentIndex > 0, canRedo: currentIndex < history.length - 1 };
}
