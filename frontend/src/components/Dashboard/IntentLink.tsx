"use client";

import { createContext, useContext } from "react";
import { intentHref, type EditorIntent } from "@/components/Canvas/editorIntent";

/** What "open this in the editor" does inside the dashboard panel (send the intent to the editor, close the panel). */
export const OpenInEditorContext = createContext<(intent: EditorIntent) => void>(() => {});

/**
 * A link to something in the editor. A plain click opens it in the editor behind the panel; middle-click or
 * Ctrl/⌘-click still opens it in a new browser tab through the same intent in the URL.
 */
export function IntentLink({ intent, children, ...rest }: { intent: EditorIntent; children?: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  const open = useContext(OpenInEditorContext);
  return (
    <a
      href={intentHref(intent)}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        open(intent);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
