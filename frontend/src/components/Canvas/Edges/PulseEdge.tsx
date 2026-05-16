import { BaseEdge, EdgeProps, getBezierPath } from '@xyflow/react';
import { useHoverSync } from '../HoverContext';

export function PulseEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
  } = props;
  
  const { activeHover } = useHoverSync();
  const isHovered = activeHover?.edgeId === id;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge 
        path={edgePath} 
        markerEnd={markerEnd} 
        style={{ 
          ...style, 
          strokeWidth: isHovered ? 2 : 1.5, 
          stroke: isHovered ? '#c2ef4e' : 'rgba(106, 95, 193, 0.4)', 
          strokeDasharray: isHovered ? '8 6' : '4 4' 
        }}
        className={isHovered ? 'animate-[dash_1s_linear_infinite] filter drop-shadow-[0_0_8px_rgba(194,239,78,0.8)]' : 'transition-all duration-500'}
      />
      
      {/* The glowing traveling spark triggers only when not actively flowing telemetry (idle state) or constantly if preferred. We'll leave it as a constant background heartbeat */}
      <circle r={isHovered ? "0" : "3"} fill="#a4e5ed" filter="drop-shadow(0 0 6px #a4e5ed)" className="transition-all duration-300">
        <animateMotion dur="4s" keyPoints="0;1;1" keyTimes="0;0.5;1" calcMode="linear" repeatCount="indefinite" path={edgePath} />
      </circle>
    </>
  );
}
