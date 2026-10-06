/**
 * Asking the canvas to delete something. Nodes, edges and the Inspect drawer don't delete on their own: they send this
 * request, and Canvas confirms ("You're deleting table customers. Are you sure?"), deletes, cleans up foreign-key
 * markings and records one undo step — the same way for every button and for the keyboard.
 */
export const DELETE_REQUEST_EVENT = "designdb:request-delete";

export interface DeleteRequest {
  nodeIds?: string[];
  edgeIds?: string[];
  /** remove this table group (its tables stay) */
  group?: string;
  /** the clicked control — the confirmation points at it */
  anchor?: Element | DOMRect | null;
  /** told whether it was deleted (false = cancelled) */
  onDone?: (deleted: boolean) => void;
}

export function requestCanvasDelete(req: DeleteRequest) {
  // the button may be gone by the time the confirmation renders (a toolbar closing): keep where it was
  const anchor = req.anchor instanceof Element ? req.anchor.getBoundingClientRect() : req.anchor;
  window.dispatchEvent(new CustomEvent<DeleteRequest>(DELETE_REQUEST_EVENT, { detail: { ...req, anchor } }));
}
