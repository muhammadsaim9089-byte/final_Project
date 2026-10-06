/**
 * Hub tables: the few tables nearly everything references — a tenant / organization / workspace table, `users`.
 * Drawn as lines they cross the whole canvas: in a typical 30-table multi-tenant schema 71 of the 89 lines end at
 * `tenants` or `users`. The canvas therefore hides relationships whose parent is a hub (unless the diagram turns them
 * on, or one of the two tables is selected) and badges the referencing tables instead; the layout ignores them too,
 * because one table linked to everything flattens any layered arrangement into a single tall column.
 *
 * Detection is structural, with names as a hint:
 *   - any table referenced by at least HUB_MIN_REFERRERS other tables, and by at least HUB_MIN_SHARE of them;
 *   - a tenant-like table (tenants, organizations, workspaces …, or referenced through tenant_id, org_id …) already
 *     from TENANT_MIN_REFERRERS referrers, at the same share.
 * and only in diagrams of HUB_MIN_TABLES tables or more: smaller ones are not cluttered, so they keep every line.
 */
import type { Edge, Node } from "@xyflow/react";

export type HubKind = "tenant" | "user" | "hub";

export interface HubTable {
  label: string;
  kind: HubKind;
  /** how many other tables reference it */
  referencedBy: number;
}

export interface HubRef {
  hubId: string;
  hub: string;
  kind: HubKind;
  /** the foreign-key column on the referencing table, when known */
  column?: string;
}

export interface HubInfo {
  hubs: Map<string, HubTable>;
  /** relationship edges whose parent (source) is a hub */
  hubEdgeIds: Set<string>;
  /** referencing table id → the hub references it holds */
  refsByTable: Map<string, HubRef[]>;
}

export const HUB_MIN_REFERRERS = 8;
export const TENANT_MIN_REFERRERS = 4;
export const HUB_MIN_SHARE = 0.25;
export const HUB_MIN_TABLES = 12;

const TENANT_TABLE = /^(tenants?|organi[sz]ations?|orgs?|workspaces?|compan(y|ies)|teams?|accounts?)$/i;
const TENANT_COLUMN = /^(tenant|organi[sz]ation|org|workspace|company|team|account)_id$/i;
const USER_TABLE = /^(users?|app_users?|members?|people|persons?|customers?)$/i;
const USER_COLUMN = /^(user|owner|author|creator|created_by|updated_by|assignee|reporter|member)(_id)?$/i;

export const EMPTY_HUBS: HubInfo = { hubs: new Map(), hubEdgeIds: new Set(), refsByTable: new Map() };

const isTable = (n: Node) => n.type === "tableMode";
// same tests as canvasAdapter's isTableNode / isDepEdge, kept here so the layout engine can use this without the adapter
const isRelationship = (e: Edge) => (e.data as any)?.kind !== "dep" && e.type !== "depEdge";
const labelOf = (n: Node) => String((n.data as any)?.label ?? n.id);
const columnOf = (e: Edge): string | undefined => {
  const d = (e.data as any) || {};
  return d.targetColumn || d.foreignKey || undefined;
};

export function detectHubs(nodes: Node[], edges: Edge[]): HubInfo {
  const tables = nodes.filter(isTable);
  if (tables.length < HUB_MIN_TABLES) return EMPTY_HUBS;
  const byId = new Map(tables.map((t) => [t.id, t]));
  const rels = edges.filter((e) => isRelationship(e) && e.source !== e.target && byId.has(e.source) && byId.has(e.target));

  const referrers = new Map<string, Set<string>>();
  const columns = new Map<string, string[]>();
  for (const e of rels) {
    if (!referrers.has(e.source)) referrers.set(e.source, new Set());
    referrers.get(e.source)!.add(e.target);
    const c = columnOf(e);
    if (c) columns.set(e.source, [...(columns.get(e.source) || []), c]);
  }

  const others = tables.length - 1;
  const hubs = new Map<string, HubTable>();
  for (const [id, refs] of referrers) {
    const label = labelOf(byId.get(id)!);
    const cols = columns.get(id) || [];
    const tenantLike = TENANT_TABLE.test(label) || cols.some((c) => TENANT_COLUMN.test(c));
    const min = tenantLike ? TENANT_MIN_REFERRERS : HUB_MIN_REFERRERS;
    if (refs.size < min || refs.size / others < HUB_MIN_SHARE) continue;
    const kind: HubKind = tenantLike ? "tenant" : USER_TABLE.test(label) || cols.filter((c) => USER_COLUMN.test(c)).length > cols.length / 2 ? "user" : "hub";
    hubs.set(id, { label, kind, referencedBy: refs.size });
  }
  if (!hubs.size) return EMPTY_HUBS;

  const hubEdgeIds = new Set<string>();
  const refsByTable = new Map<string, HubRef[]>();
  for (const e of rels) {
    const hub = hubs.get(e.source);
    if (!hub) continue;
    hubEdgeIds.add(e.id);
    const list = refsByTable.get(e.target) || [];
    const column = columnOf(e);
    if (!list.some((r) => r.hubId === e.source && r.column === column)) list.push({ hubId: e.source, hub: hub.label, kind: hub.kind, column });
    refsByTable.set(e.target, list);
  }
  return { hubs, hubEdgeIds, refsByTable };
}

/** A key that changes only when hub detection could change (tables added / renamed, relationships edited) — not on drags. */
export function hubStructureKey(nodes: Node[], edges: Edge[]): string {
  const t = nodes.filter(isTable).map((n) => `${n.id}:${labelOf(n)}`).join("|");
  const e = edges.filter(isRelationship).map((x) => `${x.id}:${x.source}>${x.target}:${columnOf(x) || ""}`).join("|");
  return `${t}#${e}`;
}
