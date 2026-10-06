import { BaseEdge, EdgeLabelRenderer, EdgeProps, Position, getBezierPath, getSmoothStepPath, useReactFlow, useStore } from "@xyflow/react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useHoverSync } from "../HoverContext";
import { useDisplay } from "../DisplayContext";
import { useLayout } from "@/components/Layout/LayoutContext";
import { normalizeRelType } from "@/lib/model/canvasAdapter";
import { requestCanvasDelete } from "../deleteRequest";

const DEFAULT_COLOR = "rgba(126, 116, 220, 0.55)";
const HOVER_COLOR = "#c2ef4e";

const QUICK_CARDINALITY = [
  { type: "one-to-one", label: "1:1", hint: "One-to-one" },
  { type: "one-to-many", label: "1:N", hint: "One-to-many" },
  { type: "many-to-many", label: "N:M", hint: "Many-to-many" },
];

/**
 * The on-canvas quick-action popover for a selected relationship (mirrors TableGroupNode's pencil popover):
 * cardinality + delete right where you clicked, with a "···" escape hatch into the full Inspect panel for
 * key mapping, referential actions, optionality, name and colour. Selecting the edge never opens that panel
 * by itself — this popover is the fast path for the common case.
 */
function QuickActions({ id, data, x, y }: { id: string; data: Record<string, any>; x: number; y: number }) {
  const { getEdges, setEdges } = useReactFlow();
  // Edge labels live inside the zoomed viewport, so at 30 % zoom the toolbar was a third of its size and its buttons a
  // few pixels wide. Undo the zoom: the toolbar keeps the same on-screen size at any zoom level.
  const zoom = useStore((s) => s.transform[2]);
  const layout = useLayout();
  const type = normalizeRelType(data.relationshipType);

  const setCardinality = (t: string) => {
    const nextEdges = getEdges().map((e) => (e.id === id ? { ...e, data: { ...(e.data as any), relationshipType: t } } : e));
    setEdges(nextEdges);
    layout.getCanvasApi()?.snapshot({ edges: nextEdges });
  };

  return (
    <div
      // pointer-events: React Flow's edge-label layer ignores the mouse (pointer-events: none) and its children inherit
      // that — without this every button here let the click fall through to the canvas, which just deselected the edge
      style={{ position: "absolute", transformOrigin: "0 0", transform: `translate(${x}px, ${y}px) scale(${1 / zoom}) translate(-50%, -50%)`, pointerEvents: "all" }}
      className="nodrag nopan flex items-center gap-0.5 px-1 py-1 rounded-xl bg-[#0c101b] border border-white/[0.14] shadow-2xl z-50"
      onClick={(e) => e.stopPropagation()}
    >
      {QUICK_CARDINALITY.map((c) => (
        <button
          key={c.type}
          title={c.hint}
          onClick={() => setCardinality(c.type)}
          className={`px-2 py-1 rounded-lg text-[10.5px] font-bold transition-colors ${type === c.type ? "bg-[#4A90D9]/25 text-white" : "text-white/45 hover:text-white hover:bg-white/[0.07]"}`}
        >
          {c.label}
        </button>
      ))}
      <div className="w-px h-4 bg-white/10 mx-0.5" />
      <button onClick={() => window.dispatchEvent(new CustomEvent("open-inspector", { detail: { edgeId: id } }))} title="More settings (key mapping, actions, colour…)" className="p-1.5 rounded-lg text-white/45 hover:text-white hover:bg-white/[0.07]">
        <MoreHorizontal size={14} />
      </button>
      <button onClick={(e) => requestCanvasDelete({ edgeIds: [id], anchor: e.currentTarget })} title="Delete relationship" className="p-1.5 rounded-lg text-white/35 hover:text-red-300 hover:bg-red-500/10">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function dirOf(pos: Position): [number, number] {
  switch (pos) {
    case Position.Left:
      return [-1, 0];
    case Position.Top:
      return [0, -1];
    case Position.Bottom:
      return [0, 1];
    default:
      return [1, 0];
  }
}

/** Cardinality symbol at the end of a relationship: bar = one, crow's foot = many, circle = optional. */
function Marker({ x, y, pos, kind, optional, color }: { x: number; y: number; pos: Position; kind: "one" | "many"; optional: boolean; color: string }) {
  const [dx, dy] = dirOf(pos);
  const px = -dy; // perpendicular
  const py = dx;
  const at = (d: number, w = 0) => `${x + dx * d + px * w},${y + dy * d + py * w}`;
  const path =
    kind === "one"
      ? `M${at(11, -6)}L${at(11, 6)}`
      : `M${at(13, 0)}L${at(0, -7)}M${at(13, 0)}L${at(0, 7)}M${at(13, 0)}L${at(0, 0)}`;
  const cd = kind === "one" ? 17 : 21;
  return (
    <g stroke={color} fill="none" strokeWidth={1.5} strokeLinecap="round">
      <path d={path} />
      {optional && <circle cx={x + dx * cd} cy={y + dy * cd} r={4} fill="#0a0e1a" />}
    </g>
  );
}

export function RelationEdge(props: EdgeProps & { variant: "step" | "bezier" }) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, data, selected, variant } = props;
  const { activeHover } = useHoverSync();
  const display = useDisplay();
  const isHovered = activeHover?.edgeId === id;
  const d = (data as any) || {};

  const args = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition };
  const [edgePath, labelX, labelY] = variant === "bezier" ? getBezierPath(args) : getSmoothStepPath({ ...args, borderRadius: 8 });

  const rel = normalizeRelType(d.relationshipType);
  const parentKind: "one" | "many" = rel === "many-to-many" ? "many" : "one";
  const childKind: "one" | "many" = rel === "one-to-one" ? "one" : "many";

  const custom = typeof d.color === "string" && d.color ? d.color : "";
  const color = isHovered || selected ? HOVER_COLOR : custom || DEFAULT_COLOR;
  const dim = !!display.lineage;

  return (
    <g style={{ opacity: dim ? 0.22 : 1, transition: "opacity 0.25s" }}>
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={20} className="react-flow__edge-interaction" />
      <BaseEdge
        path={edgePath}
        style={{
          ...style,
          strokeWidth: isHovered || selected ? 2.2 : 1.5,
          stroke: color,
          strokeDasharray: variant === "bezier" && !isHovered ? "4 4" : undefined,
        }}
        className={isHovered ? "filter drop-shadow-[0_0_8px_rgba(194,239,78,0.8)]" : "transition-colors duration-300"}
      />
      <Marker x={sourceX} y={sourceY} pos={sourcePosition} kind={parentKind} optional={!!d.optionalSource} color={color} />
      <Marker x={targetX} y={targetY} pos={targetPosition} kind={childKind} optional={!!d.optionalTarget} color={color} />
      {variant === "bezier" && !isHovered && (
        <circle r="3" fill="#a4e5ed" filter="drop-shadow(0 0 6px #a4e5ed)">
          <animateMotion dur="4s" keyPoints="0;1;1" keyTimes="0;0.5;1" calcMode="linear" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
      {selected && (
        <EdgeLabelRenderer>
          <QuickActions id={id} data={d} x={labelX} y={labelY} />
        </EdgeLabelRenderer>
      )}
    </g>
  );
}
