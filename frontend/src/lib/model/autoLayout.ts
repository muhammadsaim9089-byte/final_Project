import type { Node } from "@xyflow/react";
import { DiagramModel, tableKey } from "./types";
import { modelToCanvas } from "./canvasAdapter";
import { DEFAULT_LAYOUT, LayoutKind, layoutNodes } from "../layout";

/**
 * Gives every table without a position an x/y (the default arrangement: lib/layout DEFAULT_LAYOUT). Existing positions are kept unless
 * `force` is set. Returns a copy — the input model is not modified.
 */
export function layoutModel(model: DiagramModel, kind: LayoutKind = DEFAULT_LAYOUT, force = false): DiagramModel {
  const copy: DiagramModel = JSON.parse(JSON.stringify(model));
  const needs = force || copy.tables.some((t) => t.x === undefined || t.y === undefined);
  if (!needs) return copy;
  const { nodes, edges } = modelToCanvas(copy);
  const laid = layoutNodes(nodes, edges, kind);
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of laid) if (n.type === "tableMode") pos.set(tableKey((n.data as any).schema, (n.data as any).label), n.position);
  for (const t of copy.tables) {
    const p = pos.get(tableKey(t.schema, t.name));
    if (p && (force || t.x === undefined || t.y === undefined)) {
      t.x = Math.round(p.x);
      t.y = Math.round(p.y);
    }
  }
  // place sticky notes below the diagram
  let maxY = Math.max(0, ...copy.tables.map((t) => (t.y ?? 0) + 200));
  for (const n of copy.notes) {
    if (n.x === undefined || n.y === undefined) {
      n.x = 0;
      n.y = maxY + 40;
      maxY += 140;
    }
  }
  return copy;
}

export function positionsOf(model: DiagramModel): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const t of model.tables) if (t.x !== undefined && t.y !== undefined) out[tableKey(t.schema, t.name)] = [t.x, t.y];
  return out;
}

export function applyPositions(model: DiagramModel, positions: Record<string, [number, number]> | undefined | null): DiagramModel {
  if (!positions) return model;
  for (const t of model.tables) {
    const p = positions[tableKey(t.schema, t.name)];
    if (p) {
      t.x = p[0];
      t.y = p[1];
    }
  }
  return model;
}

export type { Node };
