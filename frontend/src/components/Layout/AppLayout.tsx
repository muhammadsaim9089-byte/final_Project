"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { NavigationSidebar } from "./NavigationSidebar";
import { TopNavbar } from "./TopNavbar";
import { SQLCodePanel } from "./SQLCodePanel";
import { LayoutShell } from "./LayoutShell";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHomePage = pathname === "/";

  if (isHomePage) {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden">
        <main className="relative flex flex-col flex-1 min-w-0 h-full">
          {children}
        </main>
      </div>
    );
  }

  return (
    <>
      <NavigationSidebar />
      <div className="flex flex-col h-screen w-screen overflow-hidden">
        <TopNavbar />
        <LayoutShell>
          <SQLCodePanel />
          <div className="relative flex flex-col flex-1 min-w-0 h-full">
            {children}
          </div>
        </LayoutShell>
      </div>
    </>
  );
}
