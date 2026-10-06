/**
 * DiagramModel — the framework-free, serialisable description of a database design.
 *
 * Everything that reads or writes a schema (DBML, SQL, docs, SVG, share links, AI actions)
 * goes through this model. React Flow nodes/edges are converted to and from it by
 * `canvasAdapter.ts`, so none of the heavy lifting depends on the UI.
 */

export type DefaultKind = "string" | "number" | "boolean" | "null" | "expression";

export interface DefaultValue {
  kind: DefaultKind;
  value: string;
}

export interface SourceLoc {
  line: number; // 1-based
  col: number; // 1-based
}

export interface ColumnModel {
  name: string;
  /** Raw type text: "varchar(255)", "int", "core.order_status", "int[]", "double precision" */
  type: string;
  pk?: boolean;
  notNull?: boolean;
  unique?: boolean;
  increment?: boolean;
  default?: DefaultValue;
  note?: string;
  /** Column level CHECK expressions (without the CHECK keyword). */
  checks?: string[];
  /** Free-form metadata (`[classification: "confidential"]`). */
  meta?: Record<string, string>;
  loc?: SourceLoc;
}

export interface IndexModel {
  /** Column names. Expression parts are wrapped in backticks, e.g. "`lower(name)`". */
  columns: string[];
  name?: string;
  unique?: boolean;
  pk?: boolean;
  type?: string; // btree | hash | gin | gist ...
  note?: string;
}

export interface CheckModel {
  expression: string;
  name?: string;
}

export type RecordValue = string | number | boolean | null;

export interface RecordsModel {
  columns: string[];
  rows: RecordValue[][];
}

export interface TableModel {
  schema?: string;
  name: string;
  alias?: string;
  headerColor?: string;
  note?: string;
  columns: ColumnModel[];
  indexes: IndexModel[];
  checks: CheckModel[];
  records?: RecordsModel;
  meta?: Record<string, string>;
  /** Layout hints — not part of DBML, carried by the canvas adapter and share links. */
  x?: number;
  y?: number;
  loc?: SourceLoc;
}

export type RefType = "one-to-many" | "many-to-one" | "one-to-one" | "many-to-many";
export type ReferentialAction = "cascade" | "restrict" | "set null" | "set default" | "no action";

export interface RefEndpoint {
  schema?: string;
  table: string;
  columns: string[];
}

export interface RefModel {
  name?: string;
  /** Endpoint written on the left of the operator. */
  from: RefEndpoint;
  /** Endpoint written on the right of the operator. */
  to: RefEndpoint;
  /** Operator as written: `>` many-to-one, `<` one-to-many, `-` one-to-one, `<>` many-to-many. */
  type: RefType;
  fromOptional?: boolean;
  toOptional?: boolean;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  color?: string;
  loc?: SourceLoc;
}

export interface EnumValueModel {
  name: string;
  note?: string;
}

export interface EnumModel {
  schema?: string;
  name: string;
  values: EnumValueModel[];
  note?: string;
}

export interface TableGroupModel {
  name: string;
  color?: string;
  note?: string;
  /** Table keys (`schema.table` or `table`). */
  tables: string[];
  collapsed?: boolean;
  loc?: SourceLoc;
}

export interface StickyNoteModel {
  name: string;
  text: string;
  colorIndex?: number;
  x?: number;
  y?: number;
}

export interface DiagramViewModel {
  id: string;
  name: string;
  /** Table keys, or "*" for every table. */
  tables: string[] | "*";
  groups: string[];
  schemas: string[];
  notes?: string[];
}

export interface DepEndpoint {
  schema?: string;
  table: string;
  column?: string;
}

export interface DepModel {
  name?: string;
  from: DepEndpoint;
  to: DepEndpoint;
  note?: string;
  color?: string;
  custom?: Record<string, string>;
  loc?: SourceLoc;
}

export interface ProjectInfo {
  name?: string;
  databaseType?: string;
  note?: string;
  extra?: Record<string, string>;
}

export interface DiagramModel {
  project: ProjectInfo;
  tables: TableModel[];
  refs: RefModel[];
  enums: EnumModel[];
  groups: TableGroupModel[];
  notes: StickyNoteModel[];
  views: DiagramViewModel[];
  deps: DepModel[];
}

export function emptyModel(): DiagramModel {
  return { project: {}, tables: [], refs: [], enums: [], groups: [], notes: [], views: [], deps: [] };
}

/** Stable identity for a table across all formats: "schema.name" or just "name". */
export function tableKey(schema: string | undefined | null, name: string): string {
  const s = (schema || "").trim();
  return s && s !== "public" ? `${s}.${name}` : name;
}

export function tableKeyOf(t: Pick<TableModel, "schema" | "name">): string {
  return tableKey(t.schema, t.name);
}

/** Keeps canonical relationship semantics: many-to-one is the mirror of one-to-many. */
export function isManyToOne(t: RefType): boolean {
  return t === "many-to-one";
}

/** Primary-key column names, whether declared per column (`[pk]`) or as a composite `(a, b) [pk]` index. */
export function tablePkColumns(t: Pick<TableModel, "columns" | "indexes">): string[] {
  const inline = t.columns.filter((c) => c.pk).map((c) => c.name);
  if (inline.length) return inline;
  return t.indexes.find((i) => i.pk)?.columns.filter((c) => !c.startsWith("`")) || [];
}

// ───────────────────────────── project meta (persisted per project / tab) ─────────────────────────────

export interface GroupMeta {
  color?: string;
  note?: string;
  collapsed?: boolean;
}

export interface ProjectMeta {
  /** Stable key used to index version history across tab-id changes (unsaved → saved). */
  versionKey: string;
  project: ProjectInfo;
  enums: EnumModel[];
  groups: Record<string, GroupMeta>;
  views: DiagramViewModel[];
  activeViewId: string | null;
  /** Colours (hex, lower-case) currently hidden in the diagram — ERDLab "toggle visibility by colour". */
  hiddenColors: string[];
  showRelationships: boolean;
  /**
   * Lines to hub tables (tenants, users … — lib/model/hubs) are hidden by default and badged on the referencing tables;
   * true draws them like any other relationship.
   */
  showHubEdges: boolean;
}

export const DEFAULT_VIEW_ID = "default";

export function newVersionKey(): string {
  return `vk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultMeta(): ProjectMeta {
  return {
    versionKey: newVersionKey(),
    project: {},
    enums: [],
    groups: {},
    views: [],
    activeViewId: null,
    hiddenColors: [],
    showRelationships: true,
    showHubEdges: false,
  };
}

export function normalizeMeta(raw: any): ProjectMeta {
  const base = defaultMeta();
  if (!raw || typeof raw !== "object") return base;
  return {
    versionKey: typeof raw.versionKey === "string" && raw.versionKey ? raw.versionKey : base.versionKey,
    project: raw.project && typeof raw.project === "object" ? raw.project : {},
    enums: Array.isArray(raw.enums) ? raw.enums : [],
    groups: raw.groups && typeof raw.groups === "object" ? raw.groups : {},
    views: Array.isArray(raw.views) ? raw.views : [],
    activeViewId: typeof raw.activeViewId === "string" ? raw.activeViewId : null,
    hiddenColors: Array.isArray(raw.hiddenColors) ? raw.hiddenColors : [],
    showRelationships: raw.showRelationships !== false,
    showHubEdges: raw.showHubEdges === true,
  };
}

// ───────────────────────────── small shared helpers ─────────────────────────────

/** Splits "varchar(255)" → { base: "varchar", args: "255" }. */
export function splitType(type: string): { base: string; args: string; array: boolean } {
  const t = (type || "").trim();
  const array = /\[\d*\]$/.test(t);
  const noArray = t.replace(/\[\d*\]$/, "");
  const m = noArray.match(/^([^(]+?)\s*\(([^)]*)\)\s*(.*)$/);
  if (m) return { base: (m[1] + (m[3] ? " " + m[3] : "")).trim(), args: m[2].trim(), array };
  return { base: noArray.trim(), args: "", array };
}

/** Diagram views list tables by key — when a table is renamed or moved to another schema, keep it in its views. */
export function rekeyViews(meta: ProjectMeta, oldKey: string, newKey: string): ProjectMeta {
  if (oldKey === newKey) return meta;
  if (!meta.views.some((v) => Array.isArray(v.tables) && v.tables.includes(oldKey))) return meta;
  return { ...meta, views: meta.views.map((v) => (Array.isArray(v.tables) && v.tables.includes(oldKey) ? { ...v, tables: v.tables.map((k) => (k === oldKey ? newKey : k)) } : v)) };
}

export function slugify(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (v as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return v;
  });
}
