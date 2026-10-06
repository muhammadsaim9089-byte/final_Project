"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useLayout } from "@/components/Layout/LayoutContext";

// Each tool is a separate chunk — nothing is downloaded until it is opened.
const ExportModal = dynamic(() => import("./ExportModal").then((m) => m.ExportModal), { ssr: false });
const ShareModal = dynamic(() => import("./ShareModal").then((m) => m.ShareModal), { ssr: false });
const VersionsPanel = dynamic(() => import("./VersionsPanel").then((m) => m.VersionsPanel), { ssr: false });
const TemplatesModal = dynamic(() => import("./TemplatesModal").then((m) => m.TemplatesModal), { ssr: false });
const ConvertModal = dynamic(() => import("./ConvertModal").then((m) => m.ConvertModal), { ssr: false });
const ReverseModal = dynamic(() => import("./ReverseModal").then((m) => m.ReverseModal), { ssr: false });
const EnumsModal = dynamic(() => import("./EnumsModal").then((m) => m.EnumsModal), { ssr: false });
const ColorsModal = dynamic(() => import("./ColorsModal").then((m) => m.ColorsModal), { ssr: false });
const ImportModal = dynamic(() => import("./ImportModal").then((m) => m.ImportModal), { ssr: false });

/** Renders whichever tool the navbar / sidebar asked for (layout.openTool). */
export function ToolHost() {
  const layout = useLayout();
  const tool = layout.activeTool;

  if (!tool) return null;
  const close = layout.closeTool;
  switch (tool.id) {
    case "export":
      return <ExportModal onClose={close} initialTab={tool.payload?.tab} />;
    case "docs":
      return <ExportModal onClose={close} initialTab="docs" />;
    case "share":
      return <ShareModal onClose={close} initialTab={tool.payload?.tab} />;
    case "versions":
      return <VersionsPanel onClose={close} />;
    case "templates":
      return <TemplatesModal onClose={close} />;
    case "convert":
      return <ConvertModal onClose={close} />;
    case "reverse":
      return <ReverseModal onClose={close} sqliteFile={tool.payload?.sqliteFile} />;
    case "enums":
      return <EnumsModal onClose={close} />;
    case "colors":
      return <ColorsModal onClose={close} />;
    case "import":
      // key: opening another source from the menu while the dialog is open starts fresh on that source
      return <ImportModal key={tool.payload?.source || "auto"} onClose={close} initialSource={tool.payload?.source} />;
    default:
      return null;
  }
}
