import { showToast } from "@/components/ui/toast";
import type { useLayout } from "@/components/Layout/LayoutContext";
import type { DiagramTemplate } from "@/lib/templates";
import { parseDbml } from "@/lib/dbml/parser";
import { modelToCanvas } from "@/lib/model/canvasAdapter";
import { DEFAULT_LAYOUT, layoutNodes } from "@/lib/layout";
import { defaultMeta } from "@/lib/model/types";

type Layout = ReturnType<typeof useLayout>;

/**
 * Puts a template on the canvas: as a new diagram tab, or merged into the current diagram. Kept apart from the gallery
 * (which also renders previews) so the DesignDB menu can open a sample diagram without loading the gallery.
 */
export function applyTemplate(layout: Layout, t: DiagramTemplate, mode: "new" | "merge") {
  const { model } = parseDbml(t.dbml);
  const api = layout.getCanvasApi();
  if (mode === "merge" && api) {
    api.applyModel(model, { mode: "merge", layout: "keep", fit: true, restorePoint: "Before adding template" });
    showToast(`Added “${t.name}” to the current diagram`, "success");
  } else {
    // build the new tab's content up-front so it appears fully laid out
    const res = modelToCanvas(model);
    const nodes = layoutNodes(res.nodes, res.edges, DEFAULT_LAYOUT);
    layout.addTab(t.name, { nodes, edges: res.edges, meta: { ...res.meta, versionKey: defaultMeta().versionKey } });
    showToast(`Created “${t.name}” — ${res.nodes.filter((n) => n.type === "tableMode").length} tables`, "success");
  }
}
