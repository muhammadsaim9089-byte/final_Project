/**
 * Deleting things from the diagram: what the confirmation says, and the deletion itself.
 *
 * Every delete on the canvas — the keyboard, a table's / note's trash button, the relationship toolbar, the Inspect
 * drawer — goes through these two functions, so the message always names what is about to go ("You're deleting table
 * customers") and the result is the same whichever button was used.
 */
import type { Edge, Node } from "@xyflow/react";
import { isDepEdge, isTableNode, normalizeRelType } from "./canvasAdapter";

/** A confirmation message: plain text, with the names of the things being deleted emphasised. */
export type MessagePart = string | { strong: string };

export interface DeletionSummary {
  message: MessagePart[];
  /** a second, quieter line: what else goes with it, or which columns a relationship joined */
  detail?: string;
}

const CARDINALITY: Record<string, string> = { "one-to-one": "1:1", "one-to-many": "1:N", "many-to-many": "N:M" };

export function tableName(n: Node): string {
  const d = (n.data as any) || {};
  const schema = String(d.schema || "");
  return (schema && schema !== "public" ? `${schema}.` : "") + String(d.label || "table");
}

function noteSnippet(n: Node): string {
  const text = String((n.data as any)?.text || "").replace(/\s+/g, " ").trim();
  return text.length > 40 ? `${text.slice(0, 38).trimEnd()}…` : text;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a, b and c" */
function listOf(parts: MessagePart[][]): MessagePart[] {
  const out: MessagePart[] = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(i === parts.length - 1 ? " and " : ", ");
    out.push(...p);
  });
  return out;
}

/** The ids of the edges that go when these nodes and edges are deleted (connected edges included). */
function removedEdgeIds(edges: Edge[], nodeIds: Set<string>, edgeIds: Set<string>): Set<string> {
  return new Set(edges.filter((e) => edgeIds.has(e.id) || nodeIds.has(e.source) || nodeIds.has(e.target)).map((e) => e.id));
}

function describeEdge(e: Edge, byId: Map<string, Node>): DeletionSummary {
  const d = (e.data as any) || {};
  const from = byId.get(e.source);
  const to = byId.get(e.target);
  const fromName = from ? tableName(from) : e.source;
  const toName = to ? tableName(to) : e.target;
  if (isDepEdge(e)) {
    const a = d.fromColumn ? `${fromName}.${d.fromColumn}` : fromName;
    const b = d.toColumn ? `${toName}.${d.toColumn}` : toName;
    return { message: ["You're deleting the lineage link from ", { strong: a }, " to ", { strong: b }, ". Are you sure?"] };
  }
  const card = CARDINALITY[normalizeRelType(d.relationshipType)] || "1:N";
  const pCol = d.sourceColumn || d.referencedKey || "";
  const cCol = d.targetColumn || d.foreignKey || "";
  return {
    message: ["You're deleting the ", { strong: card }, " relationship from ", { strong: fromName }, " to ", { strong: toName }, ". Are you sure?"],
    detail: pCol && cCol ? `${fromName}.${pCol} → ${toName}.${cCol}` : undefined,
  };
}

/**
 * What the confirmation says for deleting these nodes and edges (edges connected to a deleted node go too).
 * Returns null when nothing would be deleted.
 */
export function describeDeletion(nodes: Node[], edges: Edge[], nodeIds: string[], edgeIds: string[] = []): DeletionSummary | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const doomedNodes = [...new Set(nodeIds)].map((id) => byId.get(id)).filter((n): n is Node => !!n);
  const nodeSet = new Set(doomedNodes.map((n) => n.id));
  const explicit = new Set(edgeIds.filter((id) => edges.some((e) => e.id === id)));
  const goneEdges = removedEdgeIds(edges, nodeSet, explicit);
  if (!doomedNodes.length && !goneEdges.size) return null;

  const tables = doomedNodes.filter(isTableNode);
  const notes = doomedNodes.filter((n) => n.type === "stickyNote");
  const others = doomedNodes.filter((n) => !isTableNode(n) && n.type !== "stickyNote");
  const edgeList = edges.filter((e) => goneEdges.has(e.id));
  const rels = edgeList.filter((e) => !isDepEdge(e));
  const deps = edgeList.filter(isDepEdge);
  const withIt = [rels.length ? plural(rels.length, "relationship") : "", deps.length ? plural(deps.length, "lineage link") : ""].filter(Boolean).join(" and ");

  // one thing on its own
  const standalone = [...explicit].every((id) => {
    const e = edges.find((x) => x.id === id)!;
    return nodeSet.has(e.source) || nodeSet.has(e.target);
  });
  if (doomedNodes.length === 1 && standalone) {
    const n = doomedNodes[0];
    if (isTableNode(n)) {
      return {
        message: ["You're deleting table ", { strong: tableName(n) }, ". Are you sure?"],
        detail: withIt ? `Its ${withIt} ${rels.length + deps.length === 1 ? "is" : "are"} deleted with it.` : undefined,
      };
    }
    if (n.type === "stickyNote") {
      const snippet = noteSnippet(n);
      return { message: snippet ? ["You're deleting the note ", { strong: `“${snippet}”` }, ". Are you sure?"] : ["You're deleting an empty note. Are you sure?"] };
    }
  }
  if (!doomedNodes.length && edgeList.length === 1) return describeEdge(edgeList[0], byId);

  // several things
  const names = (list: Node[], max = 3) => {
    const shown = list.slice(0, max).map(tableName).join(", ");
    return list.length > max ? `${shown} +${list.length - max} more` : shown;
  };
  const parts: MessagePart[][] = [];
  if (tables.length) parts.push([{ strong: plural(tables.length, "table") }, ` (${names(tables)})`]);
  if (notes.length) parts.push([{ strong: plural(notes.length, "note") }]);
  if (others.length) parts.push([{ strong: plural(others.length, "item") }]);
  if (rels.length) parts.push([{ strong: plural(rels.length, "relationship") }]);
  if (deps.length) parts.push([{ strong: plural(deps.length, "lineage link") }]);
  return { message: ["You're deleting ", ...listOf(parts), ". Are you sure?"] };
}

/** The confirmation for removing a table group (its tables stay). */
export function describeGroupDeletion(name: string, tableCount: number): DeletionSummary {
  return {
    message: ["You're deleting group ", { strong: name }, ". Are you sure?"],
    detail: tableCount ? `Its ${plural(tableCount, "table")} ${tableCount === 1 ? "stays" : "stay"} on the canvas, ungrouped.` : undefined,
  };
}

/**
 * Deletes nodes and edges (and every edge connected to a deleted node). A foreign-key column loses its FK marking
 * when the last relationship using it goes, as when the relationship is deleted by hand.
 */
export function removeElements(nodes: Node[], edges: Edge[], nodeIds: string[], edgeIds: string[] = []): { nodes: Node[]; edges: Edge[] } {
  const nodeSet = new Set(nodeIds);
  const gone = removedEdgeIds(edges, nodeSet, new Set(edgeIds));
  const keptEdges = edges.filter((e) => !gone.has(e.id));
  const fkCol = (e: Edge) => String((e.data as any)?.targetColumn || (e.data as any)?.foreignKey || "");
  // child table id → FK columns that no remaining relationship uses any more
  const orphaned = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!gone.has(e.id) || isDepEdge(e) || nodeSet.has(e.target)) continue;
    const col = fkCol(e);
    if (!col || keptEdges.some((k) => !isDepEdge(k) && k.target === e.target && fkCol(k) === col)) continue;
    orphaned.set(e.target, (orphaned.get(e.target) || new Set()).add(col));
  }
  const keptNodes = nodes
    .filter((n) => !nodeSet.has(n.id))
    .map((n) => {
      const cols = orphaned.get(n.id);
      if (!cols || !isTableNode(n)) return n;
      const attributes = ((n.data as any).attributes || []).map((a: any) => (cols.has(a.name) ? { ...a, isFk: false, fkRefTable: "", fkRefField: "" } : a));
      return { ...n, data: { ...n.data, attributes } };
    });
  return { nodes: keptNodes, edges: keptEdges };
}

/** The message as plain text (tests, aria labels). */
export function messageText(parts: MessagePart[]): string {
  return parts.map((p) => (typeof p === "string" ? p : p.strong)).join("");
}
