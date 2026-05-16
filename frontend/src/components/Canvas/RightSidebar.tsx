import { Settings, ChevronRight, FormInput, Database, Paintbrush, AlignLeft } from "lucide-react";
import { Magnetic } from "./Magnetic";

export function RightSidebar() {
  return (
    <div className="absolute right-0 top-16 bottom-0 w-72 z-40 bg-[#050B14]/80 backdrop-blur-md border-l border-white/5 flex flex-col pointer-events-auto">
      
      <div className="p-6 pb-2">
        <h2 className="text-white text-lg font-bold flex items-center gap-2">
          <span className="text-lime-green">Components</span>
          <ChevronRight size={16} className="text-muted-foreground" />
        </h2>
        <span className="text-[10px] text-muted-foreground font-mono tracking-widest sentry-label uppercase mt-1 block opacity-70">Node Library</span>
      </div>
      
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-8">
        
        {/* CREATION SECTION */}
        <div>
          <span className="text-[10px] text-muted-foreground sentry-label uppercase tracking-widest block mb-3">Creation</span>
          <div className="space-y-1">
            <button className="w-full flex items-center gap-3 px-3 py-2.5 bg-white/10 text-white rounded-md border-r-2 border-lime-green transition-all shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]">
              <FormInput size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium">Inputs</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:text-white hover:bg-white/5 rounded-md transition-all border-r-2 border-transparent">
              <AlignLeft size={18} className="opacity-70" />
              <span className="text-sm">Transform</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:text-white hover:bg-white/5 rounded-md transition-all border-r-2 border-transparent">
              <Database size={18} className="opacity-70" />
              <span className="text-sm">Database</span>
            </button>
          </div>
        </div>

        {/* VISUALS SECTION */}
        <div>
          <span className="text-[10px] text-muted-foreground sentry-label uppercase tracking-widest block mb-3">Visuals</span>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:text-white hover:bg-white/5 rounded-md transition-all">
            <Paintbrush size={18} className="opacity-70" />
            <span className="text-sm">Styles</span>
          </button>
        </div>

        {/* TYPOGRAPHY SECTION */}
        <div>
          <span className="text-[10px] text-muted-foreground sentry-label uppercase tracking-widest block mb-3">Typography</span>
          <div className="w-full bg-white/5 border border-white/10 rounded-md p-3 flex justify-between items-center cursor-pointer hover:bg-white/10 transition-colors">
            <span className="text-sm text-white">Vagnola Regular</span>
            <span className="text-muted-foreground text-xs">↕</span>
          </div>
        </div>

        {/* TABLE THEME SECTION */}
        <div>
          <span className="text-[10px] text-muted-foreground sentry-label uppercase tracking-widest block mb-3">Table Theme</span>
          <div className="flex gap-3 px-1">
            <div className="w-6 h-6 rounded-sm bg-lime-green shadow-[0_0_8px_rgba(194,239,78,0.4)] cursor-pointer ring-2 ring-white/20 ring-offset-2 ring-offset-background"></div>
            <div className="w-6 h-6 rounded-sm bg-sentry-purple hover:scale-110 transition-transform cursor-pointer"></div>
            <div className="w-6 h-6 rounded-sm bg-coral-accent hover:scale-110 transition-transform cursor-pointer"></div>
            <div className="w-6 h-6 rounded-sm bg-muted hover:scale-110 transition-transform cursor-pointer"></div>
          </div>
        </div>
        
        {/* MAGNETIC BUTTON FIX HERE */}
        <Magnetic>
          <button className="w-full mt-1 flex justify-center items-center py-2 border border-dashed border-border rounded text-xs text-muted-foreground hover:text-white hover:border-lime-green transition-all sentry-label shadow-inset-sm hover:shadow-[0_0_8px_rgba(194,239,78,0.2)]">
            + Add Attribute
          </button>
        </Magnetic>

      </div>
      
      {/* Bottom Settings Menu */}
      <div className="p-6 border-t border-white/5">
        <button className="flex items-center gap-3 text-muted-foreground hover:text-white transition-colors">
          <Settings size={18} />
          <span className="text-sm">Settings</span>
        </button>
      </div>

    </div>
  );
}
