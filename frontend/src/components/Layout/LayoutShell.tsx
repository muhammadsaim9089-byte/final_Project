"use client";

import React from "react";
import { useLayout } from "./LayoutContext";

/**
 * LayoutShell provides the IDE-style flex split between the SQL code panel
 * and the canvas. It reads codeWindowMode and panelWidth from LayoutContext
 * to compute the proper flex layout.
 */
export function LayoutShell({ children }: { children: React.ReactNode }) {
  const { codeWindowMode } = useLayout();

  return (
    <div
      className="flex flex-1 min-h-0 w-full overflow-hidden"
      style={{
        // When fullscreen, the SQL panel takes 100vw and canvas is hidden
        // When split, they sit side-by-side
        // When collapsed, canvas takes full width
      }}
    >
      {children}
    </div>
  );
}
