"use client";

import { useRouter } from "next/navigation";
import { Play, Share2, Grid, Home, Edit3 } from "lucide-react";
import { Magnetic } from "./Magnetic";

export function FloatingHeader() {
  const router = useRouter();

  return (
    <div className="absolute top-0 w-full z-50 flex items-center justify-between px-6 py-4 border-b border-white/5 bg-background/40 backdrop-blur-md">
      
      {/* Left: Logo and Tool Icons */}
      <div className="flex items-center gap-8">
        <h1 className="text-xl text-white tracking-wide" style={{ fontFamily: "Vagnola, sans-serif" }}>DesignDB</h1>
        <div className="flex items-center gap-4 text-muted-foreground">
          {/* Fix 3: Home button routes back to home page */}
          <button
            onClick={() => router.push("/")}
            className="p-2 hover:text-white hover:bg-white/5 rounded-md transition-all"
          >
            <Home size={18} />
          </button>
          <button className="p-2 hover:text-white hover:bg-white/5 rounded-md transition-all"><Grid size={18} /></button>
          <div className="relative border-b-2 border-lime-green text-lime-green pb-[2px]">
            <button className="p-2 rounded-md transition-all"><Edit3 size={18} /></button>
          </div>
        </div>
      </div>
      
      {/* Right: Actions */}
      <div className="flex items-center gap-4">
        
        {/* Progress Counter */}
        <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-md">
          <span className="text-white text-xs font-bold" style={{ fontFamily: "Vagnola, sans-serif" }}>ERD Generation</span>
          <span className="text-lime-green text-xs font-mono">100%</span>
        </div>

        <Magnetic>
          <button className="p-2.5 flex items-center justify-center text-lime-green bg-white/5 hover:bg-lime-green/20 rounded-md transition-all border border-lime-green/30">
            <Play size={16} className="fill-current" />
          </button>
        </Magnetic>
        
        <button className="p-2.5 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-white/5 rounded-md transition-all">
          <Share2 size={16} />
        </button>
      </div>
    </div>
  );
}
