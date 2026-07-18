import { useCallback, useEffect, useRef, useState } from 'react';
import { Node, Edge } from '@xyflow/react';

interface HistoryState {
  nodes: Node[];
  edges: Edge[];
}

export function useUndoRedo(
  nodes: Node[],
  setNodes: (nodes: Node[] | ((nds: Node[]) => Node[])) => void,
  edges: Edge[],
  setEdges: (edges: Edge[] | ((eds: Edge[]) => Edge[])) => void
) {
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const isUndoingRef = useRef(false);

  const historyRef = useRef<HistoryState[]>([]);
  const currentIndexRef = useRef(-1);

  // Sync refs with state
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const takeSnapshot = useCallback(() => {
    if (isUndoingRef.current) return;

    const currentHistory = historyRef.current;
    const currIndex = currentIndexRef.current;

    const newHistory = currentHistory.slice(0, currIndex + 1);
    const lastState = newHistory[newHistory.length - 1];

    if (
      lastState &&
      JSON.stringify(lastState.nodes) === JSON.stringify(nodes) &&
      JSON.stringify(lastState.edges) === JSON.stringify(edges)
    ) {
      return;
    }

    const nextHistory = [...newHistory, { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) }];
    if (nextHistory.length > 50) nextHistory.shift();

    setHistory(nextHistory);
    setCurrentIndex(nextHistory.length - 1);
  }, [nodes, edges]);

  const undo = useCallback(() => {
    const currIndex = currentIndexRef.current;
    const currentHistory = historyRef.current;

    if (currIndex > 0) {
      isUndoingRef.current = true;
      const previousState = currentHistory[currIndex - 1];
      setNodes(previousState.nodes);
      setEdges(previousState.edges);
      setCurrentIndex(currIndex - 1);
      // Wait for next animation frame to clear the isUndoing block,
      // ensuring React has flushed the state updates.
      requestAnimationFrame(() => {
        isUndoingRef.current = false;
      });
    }
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    const currIndex = currentIndexRef.current;
    const currentHistory = historyRef.current;

    if (currIndex < currentHistory.length - 1) {
      isUndoingRef.current = true;
      const nextState = currentHistory[currIndex + 1];
      setNodes(nextState.nodes);
      setEdges(nextState.edges);
      setCurrentIndex(currIndex + 1);
      requestAnimationFrame(() => {
        isUndoingRef.current = false;
      });
    }
  }, [setNodes, setEdges]);

  // Global hotkeys for Undo/Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if user is typing in an input field to avoid triggering undo
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
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

  return { takeSnapshot, undo, redo, canUndo: currentIndex > 0, canRedo: currentIndex < history.length - 1 };
}
