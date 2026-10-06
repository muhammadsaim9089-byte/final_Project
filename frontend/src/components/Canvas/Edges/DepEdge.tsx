import { BaseEdge, EdgeLabelRenderer, EdgeProps, Position, getBezierPath } from "@xyflow/react";
import { useDisplay } from "../DisplayContext";

const DEFAULT_COLOR = "#f59e0b";

/**
 * Data-lineage dependency (DBML `Dep`): a dashed arrow from the upstream table to the downstream one.
 * Refs and Deps look different, so both can share one canvas.
 */
export function DepEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props;
  const display = useDisplay();
  const d = (data as any) || {};
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.35 });
  const base = typeof d.color === "string" && d.color ? d.color : DEFAULT_COLOR;
  const traced = !!display.lineage && display.lineage.edgeIds.has(id);
  const dim = !!display.lineage && !traced;
  const color = selected ? "#fde68a" : base;

  // arrowhead pointing into the downstream table
  const dir: [number, number] = targetPosition === Position.Left ? [1, 0] : targetPosition === Position.Right ? [-1, 0] : targetPosition === Position.Top ? [0, 1] : [0, -1];
  const px = -dir[1];
  const py = dir[0];
  const arrow = `M${targetX},${targetY}L${targetX - dir[0] * 11 + px * 5},${targetY - dir[1] * 11 + py * 5}L${targetX - dir[0] * 11 - px * 5},${targetY - dir[1] * 11 - py * 5}Z`;
  const label = [d.fromColumn && d.toColumn ? `${d.fromColumn} → ${d.toColumn}` : "", d.note || ""].filter(Boolean).join(" · ");

  return (
    <g style={{ opacity: dim ? 0.15 : 1, transition: "opacity 0.25s" }}>
      <path d={path} fill="none" stroke="transparent" strokeWidth={18} className="react-flow__edge-interaction" />
      <BaseEdge path={path} style={{ stroke: color, strokeWidth: traced ? 2.6 : 1.8, strokeDasharray: "7 5", animation: traced ? "dash 1s linear infinite" : undefined }} />
      <path d={arrow} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />
      {label && (traced || selected) && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="absolute pointer-events-none px-2 py-0.5 rounded-md bg-[#1f1a0a]/95 border border-amber-500/40 text-[10px] text-amber-200 font-mono max-w-[240px] truncate"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}
