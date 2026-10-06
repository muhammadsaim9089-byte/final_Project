"use client";

import React from "react";
import { LayoutTemplate } from "lucide-react";
import { ModalShell } from "./ModalShell";
import { TEMPLATES } from "@/lib/templates";
import { TemplateGallery, useApplyTemplate } from "./TemplateGallery";

export function TemplatesModal({ onClose }: { onClose: () => void }) {
  const apply = useApplyTemplate();

  return (
    <ModalShell title="Templates" subtitle={`${TEMPLATES.length} ready-made schemas — start from a real-world design`} icon={<LayoutTemplate size={16} />} onClose={onClose} width="max-w-6xl" height="h-[86vh]">
      <TemplateGallery
        onUse={(t, mode) => {
          apply(t, mode);
          onClose();
        }}
      />
    </ModalShell>
  );
}
