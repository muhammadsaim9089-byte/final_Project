/**
 * Asking the editor to open something: a saved diagram, a new blank / imported / AI-drafted diagram, or a template.
 * The dashboard panel sends these as window events; links (`/canvas?project=…`, `?new=…`, `?template=…`) carry the same
 * intents in the URL for a fresh page. Canvas handles both in one place (runIntent), so they behave the same.
 */
export type NewDiagramKind = "blank" | "import" | "ai";
export type DashboardSection = "all" | "recent" | "templates";

export interface EditorIntent {
  /** a project as the dashboard already has it (no refetch) … */
  project?: any;
  /** … or just its id */
  projectId?: string;
  new?: NewDiagramKind;
  template?: string;
}

export const EDITOR_INTENT_EVENT = "designdb:editor-intent";

export function requestEditorIntent(intent: EditorIntent) {
  window.dispatchEvent(new CustomEvent<EditorIntent>(EDITOR_INTENT_EVENT, { detail: intent }));
}

/** The URL that carries an intent, for middle-click / "open in new tab". */
export function intentHref(intent: EditorIntent): string {
  const id = intent.projectId ?? intent.project?.id;
  if (id) return `/canvas?project=${encodeURIComponent(id)}`;
  if (intent.template) return `/canvas?template=${encodeURIComponent(intent.template)}`;
  return `/canvas?new=${intent.new ?? "blank"}`;
}
