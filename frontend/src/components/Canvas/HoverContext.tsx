"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export type ActiveHoverType = { edgeId: string; targetNodeId: string; sourceAttr: string } | null;

interface HoverContextType {
  activeHover: ActiveHoverType;
  setActiveHover: (val: ActiveHoverType) => void;
}

const HoverContext = createContext<HoverContextType | undefined>(undefined);

export function HoverProvider({ children }: { children: ReactNode }) {
  const [activeHover, setActiveHover] = useState<ActiveHoverType>(null);

  return (
    <HoverContext.Provider value={{ activeHover, setActiveHover }}>
      {children}
    </HoverContext.Provider>
  );
}

export function useHoverSync() {
  const context = useContext(HoverContext);
  if (context === undefined) {
    throw new Error("useHoverSync must be used within a HoverProvider");
  }
  return context;
}
