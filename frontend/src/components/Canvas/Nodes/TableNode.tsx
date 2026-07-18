import { Handle, Position, NodeProps, useNodes, useEdges, useReactFlow } from '@xyflow/react';
import { Key, Type, Server, ShoppingCart, Link, ChevronDown, ChevronUp } from 'lucide-react';
import { useHoverSync } from '../HoverContext';

export function TableNode(props: NodeProps) {
  const { data, id } = props;
  const { label, icon = 'server', attributes = [], isActive, spotlightActive, color = '', group = '', diffStatus, errors = [], warnings = [] } = data as any;
  const { activeHover, setActiveHover } = useHoverSync();
  const nodes = useNodes();
  const edges = useEdges();
  const { setNodes } = useReactFlow();
  
  const HeaderIcon = icon === 'cart' ? ShoppingCart : Server;
  const isTargetNode = activeHover?.targetNodeId === id;
  
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  const globalDetailsLevel = data.globalDetailsLevel || "all";
  const isIndividualCollapsed = !!data.isCollapsed;
  const isCollapsed = globalDetailsLevel === "headers" || (globalDetailsLevel === "all" && isIndividualCollapsed);

  const toggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid triggering node selection or drag events
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, isCollapsed: !isIndividualCollapsed } }
          : n
      )
    );
  };

  return (
    <div
      className={`node-panel w-60 p-4 bg-[#080D1A]/90 shadow-[0_16px_40px_rgba(0,0,0,0.6)] border transition-all duration-300 rounded-2xl
        ${hasErrors
          ? 'border-red-500/50 ring-2 ring-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.2)]'
          : diffStatus === 'added'
            ? 'border-emerald-500 ring-2 ring-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.2)]'
            : diffStatus === 'modified'
              ? 'border-amber-500 ring-2 ring-amber-500/30 shadow-[0_0_30px_rgba(245,158,11,0.2)]'
              : diffStatus === 'deleted'
                ? 'border-red-500/40 ring-1 ring-red-500/20 opacity-50 bg-[#080D1A]/50'
                : isActive 
                  ? 'border-transparent ring-2 ring-lime-green shadow-[0_0_30px_rgba(194,239,78,0.25)]' 
                  : 'border-white/[0.08] hover:border-white/[0.15] hover:shadow-[0_20px_48px_rgba(0,0,0,0.7)]'
        } 
        ${isTargetNode ? 'border-purple-500/60 ring-1 ring-purple-500/40 shadow-[0_0_30px_rgba(124,58,237,0.3)]' : ''}
        ${spotlightActive ? 'spotlight-pulse-node' : ''}`}
      style={{
        borderTopColor: hasErrors
          ? '#ef4444'
          : diffStatus === 'added'
            ? '#10b981'
            : diffStatus === 'modified'
              ? '#f59e0b'
              : diffStatus === 'deleted'
                ? '#ef4444'
                : (color || 'var(--theme-color, #C2EF4E)'),
        borderTopWidth: '4px',
        fontFamily: 'var(--node-font, Vagnola, sans-serif)',
        opacity: 'var(--node-opacity, 1)' as any,
      }}
    >
      
      {/* Node Header */}
      <div className={`flex items-center justify-between px-0.5 ${isCollapsed ? '' : 'mb-4 border-b border-white/[0.06] pb-3'}`}>
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className={`p-1 rounded-lg shrink-0 ${isTargetNode ? 'bg-purple-500/10 text-purple-400' : 'bg-lime-green/10 text-lime-green'} transition-colors`}>
            <HeaderIcon size={13} className="font-bold" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
              <h3 className={`font-bold tracking-wide text-xs uppercase truncate ${diffStatus === 'deleted' ? 'line-through text-white/40' : 'text-white'}`}>{label}</h3>
              {diffStatus && (
                <span className={`text-[7.5px] font-mono font-bold tracking-widest px-1 py-0.2 rounded uppercase select-none shrink-0 ${
                  diffStatus === 'added'
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                    : diffStatus === 'modified'
                      ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                      : 'bg-red-500/10 border border-red-500/20 text-red-400'
                }`}>
                  {diffStatus === 'added' ? 'New' : diffStatus === 'modified' ? 'Mod' : 'Del'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-sans font-semibold text-[10px] tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">{attributes.length} columns</span>
              {group && (
                <span 
                  className="text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border truncate max-w-[80px]"
                  style={{ 
                    backgroundColor: color ? `${color}15` : 'rgba(74,144,217,0.1)',
                    borderColor: color ? `${color}40` : 'rgba(74,144,217,0.2)',
                    color: color || '#4A90D9',
                  }}
                >{group}</span>
              )}
            </div>
          </div>
        </div>
        
        {/* Collapse Chevron & Status Indicators */}
        <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
          {globalDetailsLevel === "all" && (
            <button
              onClick={toggleCollapse}
              className="p-1 rounded hover:bg-white/5 text-white/40 hover:text-white transition-colors"
              title={isIndividualCollapsed ? "Expand table" : "Collapse table"}
            >
              {isIndividualCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </button>
          )}

          {hasErrors ? (
            <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-[9px] font-bold text-white shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse" title={`${errors.length} validation errors`}>
              !
            </div>
          ) : hasWarnings ? (
            <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-[9px] font-bold text-black shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse" title={`${warnings.length} validation warnings`}>
              !
            </div>
          ) : (
            <div className="w-1.5 h-1.5 rounded-full bg-lime-green/80 animate-pulse" />
          )}
        </div>
      </div>
      
      <Handle type="target" position={Position.Left} className="w-2 h-2 rounded-full border-none opacity-0" />

      {/* Node Properties */}
      {!isCollapsed && (
        <div className="flex flex-col gap-1.5">
          {attributes.length > 0 ? (
            attributes
              .filter((attr: any) => {
                if (globalDetailsLevel === "keys") {
                  return attr.isPk || attr.isFk;
                }
                return true;
              })
              .map((attr: any, idx: number) => {
                let FieldIcon = attr.isPk || attr.isFk ? Key : Type;
                if (attr.isFk && !attr.isPk) FieldIcon = Link;

                // Strictly defined universal active highlighting 
                const isHighlightedPk = isTargetNode && attr.isPk;
                const isHoveredFk = activeHover !== null && activeHover.sourceAttr === attr.name && !isTargetNode;

                const colErrors = errors.filter((e: any) => e.column === attr.name);
                const colWarnings = warnings.filter((w: any) => w.column === attr.name);
                const hasColError = colErrors.length > 0;
                const hasColWarning = colWarnings.length > 0;

                return (
                  <div 
                    key={idx} 
                    onMouseEnter={() => {
                      // Universal Dynamic Edge Resolver Handler
                      if (attr.isFk) {
                        // Look up relationship using edge data (which maps column names directly)
                        let edge = edges.find(e => 
                          e.target === id && 
                          e.data?.targetColumn === attr.name
                        );
                        
                        let targetNodeId = edge ? edge.source : null;

                        // Fallback: Fuzzy name-based guessing if no edge is mapped
                        if (!edge) {
                          const targetLabel = attr.name.toLowerCase().replace('_id', '');
                          const targetNode = nodes.find(n => 
                            (n.data.label as string).toLowerCase() === targetLabel || 
                            (n.data.label as string).toLowerCase().startsWith(targetLabel)
                          );
                          if (targetNode) {
                            edge = edges.find(e => 
                              (e.source === id && e.target === targetNode.id) || 
                              (e.target === id && e.source === targetNode.id)
                            );
                            targetNodeId = targetNode.id;
                          }
                        }

                        if (edge && targetNodeId) {
                          setActiveHover({ edgeId: edge.id, targetNodeId, sourceAttr: attr.name });
                        }
                      }
                    }}
                    onMouseLeave={() => {
                      if (attr.isFk) setActiveHover(null);
                    }}
                    className={`flex justify-between items-center group py-1.5 px-2 rounded-xl transition-all duration-300 border
                      ${attr.isFk ? 'cursor-pointer hover:bg-white/[0.04]' : ''} 
                      ${hasColError
                        ? 'bg-red-950/10 border-red-500/20'
                        : hasColWarning
                          ? 'bg-amber-950/10 border-amber-500/20'
                          : isHighlightedPk 
                            ? 'bg-purple-950/20 shadow-[0_0_15px_rgba(124,58,237,0.3)] border-purple-500/40' 
                            : isHoveredFk 
                              ? 'bg-lime-950/20 border-lime-500/40 shadow-[0_0_15px_rgba(194,239,78,0.2)]' 
                              : 'bg-white/[0.01] border-transparent hover:bg-white/[0.03]'
                      }`}
                    title={hasColError ? colErrors[0].message : hasColWarning ? colWarnings[0].message : undefined}
                  >
                    <div className="flex gap-2 items-center min-w-0">
                      <FieldIcon 
                        size={11} 
                        className={`shrink-0 transition-colors
                          ${hasColError ? 'text-red-400' : hasColWarning ? 'text-amber-400' : isHighlightedPk ? 'text-purple-400' : isHoveredFk ? 'text-lime-green' : attr.isPk ? 'text-amber-400' : attr.isFk ? 'text-sky-400' : 'text-slate-500'}
                        `} 
                      />
                      <span className={`text-[11px] font-mono tracking-wide truncate transition-colors ${hasColError ? 'text-red-300' : hasColWarning ? 'text-amber-300' : isHighlightedPk || isHoveredFk ? 'text-white font-bold' : 'text-slate-300'}`}>
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
                      <span className={`text-[9px] font-mono lowercase transition-colors ${hasColError ? 'text-red-400/80' : hasColWarning ? 'text-amber-400/80' : isHighlightedPk ? 'text-purple-300/80' : isHoveredFk ? 'text-lime-green/80' : 'text-slate-500'}`}>
                        {attr.type}
                      </span>
                    </div>
                  </div>
                );
              })
          ) : (
            <span className="text-[10px] text-slate-500 italic py-2 text-center">No columns defined...</span>
          )}
          {globalDetailsLevel === "keys" && attributes.filter((attr: any) => attr.isPk || attr.isFk).length === 0 && (
            <span className="text-[10px] text-slate-500 italic py-2 text-center">No keys defined...</span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="w-2 h-2 rounded-full border-none opacity-0" />
    </div>
  );
}

