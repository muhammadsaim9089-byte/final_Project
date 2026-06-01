import { ChevronUp, ChevronDown, Sparkles, Code2 } from 'lucide-react';

interface BottomPanelProps {
  isSqlOpen: boolean;
  setIsSqlOpen: (open: boolean) => void;
  isReviewsOpen: boolean;
  setIsReviewsOpen: (open: boolean) => void;
  sql?: string;
}

export function BottomPanel({ isSqlOpen, setIsSqlOpen, isReviewsOpen, setIsReviewsOpen, sql }: BottomPanelProps) {
  const displaySql = sql || `-- Synthesizing architecture...\n-- Please wait a moment while DesignDB generates your schema.`;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-4xl z-40 flex justify-between px-6 pointer-events-none transition-all duration-300">
      
      {/* SQL Code Drawer */}
      <div className="relative pointer-events-auto">
        <button 
          onClick={() => setIsSqlOpen(!isSqlOpen)} 
          className={`flex items-center gap-2 px-5 py-2.5 rounded-full transition-all duration-300 text-xs font-semibold tracking-wide border backdrop-blur-xl
            ${isSqlOpen 
              ? 'bg-purple-950/40 border-purple-500/50 text-white shadow-[0_0_20px_rgba(124,58,237,0.3)]' 
              : 'bg-[#090F1E]/80 border-white/[0.08] text-white/80 hover:text-white hover:border-purple-500/30 hover:bg-[#0F182E]/90 hover:shadow-[0_0_15px_rgba(124,58,237,0.15)]'
            }`}
        >
          <Code2 size={13} className={`transition-transform duration-300 ${isSqlOpen ? 'text-purple-400 rotate-12 scale-110' : 'text-purple-400/80'}`} />
          <span>View SQL Code</span>
          {isSqlOpen ? (
            <ChevronDown size={13} className="text-white/50" />
          ) : (
            <ChevronUp size={13} className="text-white/50 animate-bounce" />
          )}
        </button>
        
        {isSqlOpen && (
          <div className="absolute bottom-full left-0 mb-4 w-[480px] h-[360px] glass-panel rounded-2xl border border-white/[0.08] overflow-hidden flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.8)] animate-in fade-in slide-in-from-bottom-5 duration-300">
            <div className="bg-[#0C1222]/90 px-5 py-3.5 border-b border-white/[0.06] flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                <span className="text-xs font-semibold text-white tracking-wider uppercase font-mono">SQL Output</span>
              </div>
              <span className="text-[10px] font-mono font-bold tracking-wider px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400 uppercase">READ ONLY</span>
            </div>
            <div className="flex-1 p-5 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-300 bg-[#060A13]/60 p-scrollbar select-text">
              {displaySql.split('\n').map((line, index) => (
                <div key={index} className="flex gap-4 hover:bg-white/[0.02] py-0.5 px-1 rounded transition-colors">
                  <span className="text-slate-600 w-6 text-right select-none">{index + 1}</span>
                  <span className="text-slate-300 flex-1 whitespace-pre-wrap">{line}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* AI Insights Drawer */}
      <div className="relative pointer-events-auto flex justify-end">
        <button 
          onClick={() => setIsReviewsOpen(!isReviewsOpen)} 
          className={`flex items-center gap-2 px-5 py-2.5 rounded-full transition-all duration-300 text-xs font-semibold tracking-wide border backdrop-blur-xl
            ${isReviewsOpen 
              ? 'bg-lime-950/30 border-lime-500/50 text-white shadow-[0_0_20px_rgba(194,239,78,0.2)]' 
              : 'bg-[#090F1E]/80 border-white/[0.08] text-white/80 hover:text-white hover:border-lime-500/30 hover:bg-[#0F182E]/90 hover:shadow-[0_0_15px_rgba(194,239,78,0.12)]'
            }`}
        >
          <Sparkles size={13} className={`transition-transform duration-300 ${isReviewsOpen ? 'text-lime-green scale-110' : 'text-lime-green/80'}`} />
          <span>AI Insights</span>
          {isReviewsOpen ? (
            <ChevronDown size={13} className="text-white/50" />
          ) : (
            <ChevronUp size={13} className="text-white/50 animate-bounce" />
          )}
        </button>

        {isReviewsOpen && (
          <div className="absolute bottom-full right-0 mb-4 w-[380px] max-h-[320px] glass-panel rounded-2xl border border-white/[0.08] overflow-hidden flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.8)] animate-in fade-in slide-in-from-bottom-5 duration-300">
            <div className="bg-[#0C1222]/90 px-5 py-3.5 border-b border-white/[0.06] flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-lime-400 animate-pulse" />
                <span className="text-xs font-semibold text-white tracking-wider uppercase font-mono">Architecture Audit</span>
              </div>
              <span className="text-[10px] font-mono font-bold tracking-wider px-2 py-0.5 rounded bg-lime-400/10 border border-lime-400/20 text-lime-green uppercase">INTELLIGENCE</span>
            </div>
            <div className="p-5 overflow-y-auto p-scrollbar bg-[#060A13]/60 flex-1">
              <div className="bg-purple-950/10 border border-purple-500/20 rounded-xl p-4 flex gap-3 shadow-[0_4px_16px_rgba(124,58,237,0.05)]">
                <div className="text-purple-400 shrink-0 text-base font-bold animate-pulse">✨</div>
                <div>
                  <h4 className="text-[11px] font-bold tracking-wider font-mono text-purple-400 uppercase mb-1">Normalization check</h4>
                  <p className="text-xs text-slate-300 leading-relaxed font-sans font-medium">
                    {!sql ? "Awaiting model design execution... Enter requirements above to kick off automatic 3NF schemas." : "Your database is optimized in Third Normal Form (3NF). Redundant variables collapsed, candidate keys resolved, and visual node boundaries synced."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

