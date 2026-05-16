import { BaseEdge, EdgeProps, getSmoothStepPath } from '@xyflow/react';
import { useHoverSync } from '../HoverContext';

export function CrowsFootEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    data,
  } = props;
  
  const { activeHover } = useHoverSync();
  const isHovered = activeHover?.edgeId === id;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const relType = (data?.relationshipType as string) || 'one-to-many';
  let markerStart = 'url(#crow-one)';
  let markerEnd = 'url(#crow-one)';

  if (relType === 'one-to-many') {
    markerStart = 'url(#crow-one)';
    markerEnd = 'url(#crow-many)';
  } else if (relType === 'many-to-one') {
    markerStart = 'url(#crow-many)';
    markerEnd = 'url(#crow-one)';
  } else if (relType === 'many-to-many') {
    markerStart = 'url(#crow-many)';
    markerEnd = 'url(#crow-many)';
  }

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction"
      />
      <BaseEdge 
        path={edgePath} 
        markerStart={markerStart}
        markerEnd={markerEnd} 
        style={{ 
          ...style, 
          strokeWidth: isHovered ? 2 : 1.5, 
          stroke: isHovered ? '#c2ef4e' : 'rgba(106, 95, 193, 0.4)', 
        }}
        className={isHovered ? 'filter drop-shadow-[0_0_8px_rgba(194,239,78,0.8)]' : 'transition-colors duration-300'}
      />
    </>
  );
}
