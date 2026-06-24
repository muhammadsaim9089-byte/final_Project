import { Handle, Position, NodeProps, useNodes, useEdges } from '@xyflow/react';
import { Key, Type, Server, ShoppingCart, Link } from 'lucide-react';
import { useHoverSync } from '../HoverContext';

export function TableNode(props: NodeProps) {
  const { data, id } = props;
  const { label, icon = 'server', attributes = [], isActive } = data as any;
  const { activeHover, setActiveHover } = useHoverSync();
  const nodes = useNodes();
  const edges = useEdges();
  
  const HeaderIcon = icon === 'cart' ? ShoppingCart : Server;
  const isTargetNode = activeHover?.targetNodeId === id;
  
  return (
    <div
      className={`node-panel w-60 p-4 bg-[#080D1A]/90 shadow-[0_16px_40px_rgba(0,0,0,0.6)] border transition-all duration-300 rounded-2xl
        ${isActive 
          ? 'border-transparent ring-2 ring-lime-green shadow-[0_0_30px_rgba(194,239,78,0.25)]' 
          : 'border-white/[0.08] hover:border-white/[0.15] hover:shadow-[0_20px_48px_rgba(0,0,0,0.7)]'
        } 
        ${isTargetNode ? 'border-purple-500/60 ring-1 ring-purple-500/40 shadow-[0_0_30px_rgba(124,58,237,0.3)]' : ''}`}
      style={{
        borderTopColor: 'var(--theme-color, #C2EF4E)',
        borderTopWidth: '4px',
        fontFamily: 'var(--node-font, Vagnola, sans-serif)',
        opacity: 'var(--node-opacity, 1)' as any,
      }}
    >
      
      {/* Node Header */}
      <div className="flex items-center justify-between mb-4 border-b border-white/[0.06] pb-3 px-0.5">
        <div className="flex items-center gap-2.5">
          <div className={`p-1 rounded-lg ${isTargetNode ? 'bg-purple-500/10 text-purple-400' : 'bg-lime-green/10 text-lime-green'} transition-colors`}>
            <HeaderIcon size={13} className="font-bold" />
          </div>
          <div>
            <h3 className="font-bold tracking-wide text-xs text-white uppercase">{label}</h3>
            <span className="font-sans font-semibold text-[10px] tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">{attributes.length} columns</span>
          </div>
        </div>
        
        {/* Simple helper for visual styling */}
        <div className="w-1.5 h-1.5 rounded-full bg-lime-green/80 animate-pulse" />
      </div>
      
      <Handle type="target" position={Position.Left} className="w-2 h-2 rounded-full border-none opacity-0" />

      {/* Node Properties */}
      <div className="flex flex-col gap-1.5">
        {attributes.length > 0 ? attributes.map((attr: any, idx: number) => {
          let FieldIcon = attr.isPk || attr.isFk ? Key : Type;
          if (attr.isFk && !attr.isPk) FieldIcon = Link;

          // Strictly defined universal active highlighting 
          const isHighlightedPk = isTargetNode && attr.isPk;
          const isHoveredFk = activeHover !== null && activeHover.sourceAttr === attr.name && !isTargetNode;

          return (
            <div 
              key={idx} 
              onMouseEnter={() => {
                // Universal Dynamic Edge Resolver Handler
                if (attr.isFk) {
                  // Stripping _id to correlate logical table structures dynamically
                  const targetLabel = attr.name.toLowerCase().replace('_id', '');
                  const targetNode = nodes.find(n => 
                    (n.data.label as string).toLowerCase() === targetLabel || 
                    (n.data.label as string).toLowerCase().startsWith(targetLabel)
                  );

                  if (targetNode) {
                    const edge = edges.find(e => 
                      (e.source === id && e.target === targetNode.id) || 
                      (e.target === id && e.source === targetNode.id)
                    );
                    if (edge) {
                      setActiveHover({ edgeId: edge.id, targetNodeId: targetNode.id, sourceAttr: attr.name });
                    }
                  }
                }
              }}
              onMouseLeave={() => {
                if (attr.isFk) setActiveHover(null);
              }}
              className={`flex justify-between items-center group py-1.5 px-2 rounded-xl transition-all duration-300 border
                ${attr.isFk ? 'cursor-pointer hover:bg-white/[0.04]' : ''} 
                ${isHighlightedPk 
                  ? 'bg-purple-950/20 shadow-[0_0_15px_rgba(124,58,237,0.3)] border-purple-500/40' 
                  : isHoveredFk 
                    ? 'bg-lime-950/20 border-lime-500/40 shadow-[0_0_15px_rgba(194,239,78,0.2)]' 
                    : 'bg-white/[0.01] border-transparent hover:bg-white/[0.03]'
                }`}
            >
              <div className="flex gap-2 items-center min-w-0">
                <FieldIcon 
                  size={11} 
                  className={`shrink-0 transition-colors
                    ${isHighlightedPk ? 'text-purple-400' : isHoveredFk ? 'text-lime-green' : attr.isPk ? 'text-amber-400' : attr.isFk ? 'text-sky-400' : 'text-slate-500'}
                  `} 
                />
                <span className={`text-[11px] font-mono tracking-wide truncate transition-colors ${isHighlightedPk || isHoveredFk ? 'text-white font-bold' : 'text-slate-300'}`}>
                  {attr.name}
                </span>
              </div>
              
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Badges for PK/FK */}
                {attr.isPk && (
                  <span className="text-[7px] font-bold font-mono px-1 py-0.2 rounded bg-amber-500/10 border border-amber-500/25 text-amber-400 select-none">
                    PK
                  </span>
                )}
                {attr.isFk && (
                  <span className="text-[7px] font-bold font-mono px-1 py-0.2 rounded bg-sky-500/10 border border-sky-500/25 text-sky-400 select-none">
                    FK
                  </span>
                )}
                <span className={`text-[9px] font-mono lowercase transition-colors ${isHighlightedPk ? 'text-purple-300/80' : isHoveredFk ? 'text-lime-green/80' : 'text-slate-500'}`}>
                  {attr.type}
                </span>
              </div>
            </div>
          )
        }) : (
          <span className="text-[10px] text-slate-500 italic py-2 text-center">No columns defined...</span>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2 rounded-full border-none opacity-0" />
    </div>
  );
}

