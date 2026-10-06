"use client";

import { useMemo } from "react";
import { useLayout } from "@/components/Layout/LayoutContext";
import { canvasToModel } from "@/lib/model/canvasAdapter";
import { hiddenTableIds } from "@/lib/model/displayGraph";
import { DiagramModel, tableKey } from "@/lib/model/types";

/**
 * Snapshot of the current diagram for tools (export, share, docs …): the model with table positions,
 * plus the set of table keys that are visible in the active view. Recomputed when the tool opens.
 */
export function useDiagramModel(): { model: DiagramModel; visibleKeys: Set<string> | null } {
  const layout = useLayout();
  return useMemo(() => {
    const api = layout.getCanvasApi();
    if (!api) return { model: canvasToModel([], [], layout.meta), visibleKeys: null as Set<string> | null };
    const { nodes, edges, meta } = api.getState();
    const model = canvasToModel(nodes, edges, meta);
    const hidden = hiddenTableIds(nodes, meta);
    let visibleKeys: Set<string> | null = null;
    if (hidden.size) {
      visibleKeys = new Set(nodes.filter((n) => n.type === "tableMode" && !hidden.has(n.id)).map((n) => tableKey((n.data as any).schema, String((n.data as any).label))));
    }
    return { model, visibleKeys };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
