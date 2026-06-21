import { useCallback, useEffect, useState } from 'react';
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
  const [isUndoing, setIsUndoing] = useState(false);

  // Take a snapshot whenever nodes or edges change significantly
  // In a real app, you might want to debounce this or only save on specific events
  // like 'onNodeDragStop', but for simplicity we save after any non-undo change
  // using a snapshot function we can call explicitly.
  
  const takeSnapshot = useCallback(() => {
    if (isUndoing) return; // Prevent saving state during undo/redo traversal

    setHistory((prev) => {
      // If we are not at the end of history and we take a new snapshot,
      // we discard the future (redo) states.
      const newHistory = prev.slice(0, currentIndex + 1);
      // Avoid saving identical sequential states (shallow check for simplicity, deep check is better)
      const lastState = newHistory[newHistory.length - 1];
      if (lastState && JSON.stringify(lastState.nodes) === JSON.stringify(nodes) && JSON.stringify(lastState.edges) === JSON.stringify(edges)) {
          return prev;
      }
      
      newHistory.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
      // Keep only last 50 states to prevent memory leaks
      if (newHistory.length > 50) newHistory.shift();
      
      setCurrentIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [nodes, edges, currentIndex, isUndoing]);

  const undo = useCallback(() => {
    if (currentIndex > 0) {
      setIsUndoing(true);
      const previousState = history[currentIndex - 1];
      setNodes(previousState.nodes);
      setEdges(previousState.edges);
      setCurrentIndex((prev) => prev - 1);
      setTimeout(() => setIsUndoing(false), 50); // slight delay to prevent snapshotting
    }
  }, [history, currentIndex, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (currentIndex < history.length - 1) {
      setIsUndoing(true);
      const nextState = history[currentIndex + 1];
      setNodes(nextState.nodes);
      setEdges(nextState.edges);
      setCurrentIndex((prev) => prev + 1);
      setTimeout(() => setIsUndoing(false), 50);
    }
  }, [history, currentIndex, setNodes, setEdges]);

  // Global hotkeys for Undo/Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if user is typing in an input field to avoid triggering undo
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
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
