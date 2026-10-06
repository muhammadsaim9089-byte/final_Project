/**
 * How big a node is on the canvas — measured by React Flow when it has been rendered, estimated from its columns
 * otherwise. Kept apart from the layout algorithms (lib/layout, which pulls in dagre) so light pages — the dashboard's
 * card thumbnails — can size tables without the layout engine.
 */
import type { Node } from "@xyflow/react";

export const NODE_WIDTH = 260;
const HEADER_H = 74;
const ROW_H = 34;

export function estimateNodeSize(n: Node): { width: number; height: number } {
  if (n.type === "stickyNote") return { width: 208, height: 110 };
  const m = (n as any).measured as { width?: number; height?: number } | undefined;
  if (m?.width && m?.height) return { width: m.width, height: m.height };
  const d = (n.data as any) || {};
  const attrs = Array.isArray(d.attributes) ? d.attributes.length : 0;
  const level = d.globalDetailsLevel || "all";
  if (level === "headers" || d.isCollapsed) return { width: NODE_WIDTH, height: HEADER_H };
  if (level === "keys") {
    const keys = (d.attributes || []).filter((a: any) => a.isPk || a.isFk).length;
    return { width: NODE_WIDTH, height: HEADER_H + Math.max(1, keys) * ROW_H };
  }
  const commentH = typeof d.comment === "string" && d.comment.trim() ? 40 : 0;
  return { width: NODE_WIDTH, height: HEADER_H + Math.max(1, attrs) * ROW_H + commentH };
}
