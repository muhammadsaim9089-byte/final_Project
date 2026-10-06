"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { NavigationSidebar } from "./NavigationSidebar";
import { TopNavbar } from "./TopNavbar";
import { SQLCodePanel } from "./SQLCodePanel";
import { LayoutShell } from "./LayoutShell";
import { useLayout } from "./LayoutContext";
import { ConfirmHost } from "@/components/ui/confirm";

const WorkspaceDashboard = dynamic(() => import("@/components/Dashboard/WorkspaceDashboard").then((m) => m.WorkspaceDashboard), { ssr: false });

// The AI chat is its own chunk — nothing is downloaded until it is first opened.
const AiPanel = dynamic(() => import("@/components/Tools/AiPanel").then((m) => m.AiPanel), { ssr: false });

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const layout = useLayout();
  // Landing page, the embeddable viewer and published (shared) diagrams render without the editor chrome.
  const chromeless = pathname === "/" || pathname?.startsWith("/embed") || pathname?.startsWith("/share");
  // Once opened, the AI chat stays mounted and is only hidden when closed (or folded away by the SQL playground), so a
  // conversation — including a half-typed message — is exactly where it was when it slides back out.
  const [aiMounted, setAiMounted] = useState(layout.aiOpen);
  useEffect(() => {
    if (layout.aiOpen) setAiMounted(true);
  }, [layout.aiOpen]);

  if (chromeless) {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden">
        <main className="relative flex flex-col flex-1 min-w-0 h-full">
          {children}
        </main>
        <ConfirmHost />
      </div>
    );
  }

  return (
    <>
      <NavigationSidebar />
      <div className="flex flex-col h-screen w-screen overflow-hidden">
        <TopNavbar />
        <LayoutShell>
          {aiMounted && (
            <div className={layout.aiOpen ? "contents" : "hidden"}>
              <AiPanel onClose={() => layout.setAiOpen(false)} />
            </div>
          )}
          <SQLCodePanel />
          <div className="relative flex flex-col flex-1 min-w-0 h-full">
            {children}
          </div>
        </LayoutShell>
      </div>
      {/* the dashboard: a large panel over the editor (loaded the first time it opens) */}
      {layout.dashboard && <WorkspaceDashboard section={layout.dashboard} onClose={layout.closeDashboard} />}
      {/* "You're deleting … Are you sure?" — one host for every confirmation in the app */}
      <ConfirmHost />
    </>
  );
}
