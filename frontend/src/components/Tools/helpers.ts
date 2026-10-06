import type { useLayout } from "@/components/Layout/LayoutContext";
import { DiagramModel, defaultMeta } from "@/lib/model/types";
import { modelToCanvas } from "@/lib/model/canvasAdapter";
import { DEFAULT_LAYOUT, layoutNodes } from "@/lib/layout";
import { showToast } from "@/components/ui/toast";

type Layout = ReturnType<typeof useLayout>;

/** Opens a model as a brand-new diagram tab, already laid out. */
export function openModelInNewTab(layout: Layout, model: DiagramModel, title: string) {
  const res = modelToCanvas(model);
  const nodes = layoutNodes(res.nodes, res.edges, DEFAULT_LAYOUT);
  layout.addTab(title, { nodes, edges: res.edges, meta: { ...res.meta, versionKey: defaultMeta().versionKey } });
  return res.nodes.filter((n) => n.type === "tableMode").length;
}

export type ImportTarget = "new" | "replace" | "merge";

export function importModel(layout: Layout, model: DiagramModel, target: ImportTarget, title: string, label: string) {
  const api = layout.getCanvasApi();
  if (target === "new" || !api) {
    const n = openModelInNewTab(layout, model, title);
    showToast(`Opened ${n} tables from ${label} in a new diagram`, "success");
    return;
  }
  api.applyModel(model, { mode: target, layout: target === "merge" ? "keep" : "auto", fit: true, restorePoint: target === "replace" ? `Before importing ${label}` : "Before adding tables" });
  showToast(`${target === "merge" ? "Added" : "Imported"} ${model.tables.length} tables from ${label}`, "success");
}
