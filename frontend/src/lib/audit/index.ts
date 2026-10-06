/**
 * Architecture audit: deterministic checks over the diagram model, each with an exact fix.
 *
 *   critical    no primary key · foreign key type differs from the key it references
 *   warning     repeating group (1NF) · copied parent columns (3NF) · unindexed foreign keys · undeclared relationship
 *   suggestion  no audit timestamps · mixed naming styles
 *
 * `auditModel` lists the findings; `applyFix` re-finds one on the *current* model (the diagram may have changed since the
 * scan) and returns the fixed model. Framework-free: the drawer (components/Canvas/AuditDrawer.tsx) applies the result
 * through the canvas API, so a fix is one undo step, keeps table positions and updates the DBML.
 */
import { DiagramModel, RefModel, TableModel, tableKey, tableKeyOf, tablePkColumns } from "../model/types";
import { canonicalType } from "../sql/dialects";
import { addTimestamps, snakeCaseNames } from "../ai/quickActions";

export type Severity = "critical" | "warning" | "suggestion";
export type AuditRule =
  | "no-primary-key"
  | "fk-type-mismatch"
  | "repeating-group"
  | "copied-parent-columns"
  | "unindexed-foreign-keys"
  | "undeclared-relationship"
  | "missing-timestamps"
  | "mixed-naming";

export interface Finding {
  /** stable across scans: rule + what it is about */
  id: string;
  rule: AuditRule;
  severity: Severity;
  category: "Integrity" | "Normalization" | "Performance" | "Relationships" | "Conventions";
  title: string;
  description: string;
  /** table keys to focus on */
  tables: string[];
  /** what Auto-Fix will do, in a few words */
  fixLabel: string;
}

export const SEVERITY_ORDER: Severity[] = ["critical", "warning", "suggestion"];
export const RULE_COUNT = 8;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const keyOf = (t: Pick<TableModel, "schema" | "name">) => tableKeyOf(t);
const q = (s: string) => `“${s}”`;
const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(", ")} +${xs.length - max} more` : xs.join(", "));
const singular = (s: string) => s.replace(/ies$/i, "y").replace(/(xes|ches|shes|sses)$/i, (m) => m.slice(0, -2)).replace(/s$/i, "");
const plural = (s: string) => (/[^aeiou]y$/i.test(s) ? s.slice(0, -1) + "ies" : /(s|x|ch|sh)$/i.test(s) ? s + "es" : s + "s");
const findTable = (m: DiagramModel, schema: string | undefined, name: string) => m.tables.find((t) => t.name === name && (t.schema || "") === (schema || ""));
/** the plain integer type behind an auto-increment one (a foreign key to a serial column is an integer) */
const nonSerial = (type: string) => {
  const t = type.trim().toLowerCase();
  if (t === "serial" || t === "serial4") return "integer";
  if (t === "bigserial" || t === "serial8") return "bigint";
  if (t === "smallserial" || t === "serial2") return "smallint";
  return type;
};
const typeKind = (type: string) => {
  const c = canonicalType(type);
  return `${c.kind}${c.array ? "[]" : ""}`;
};

/** The endpoint that holds the foreign key (null for many-to-many, which becomes a junction table). */
function childSide(r: RefModel, m: DiagramModel): { child: RefModel["from"]; parent: RefModel["from"] } | null {
  if (r.type === "many-to-many") return null;
  if (r.type === "many-to-one") return { child: r.from, parent: r.to };
  if (r.type === "one-to-many") return { child: r.to, parent: r.from };
  // one-to-one: the side whose columns are not its table's primary key holds the key
  const fromT = findTable(m, r.from.schema, r.from.table);
  const fromIsPk = !!fromT && r.from.columns.every((c) => tablePkColumns(fromT).includes(c));
  return fromIsPk ? { child: r.to, parent: r.from } : { child: r.from, parent: r.to };
}

function isJunction(t: TableModel, m: DiagramModel): boolean {
  const fkCols = new Set<string>();
  for (const r of m.refs) {
    const s = childSide(r, m);
    if (s && s.child.table === t.name && (s.child.schema || "") === (t.schema || "")) s.child.columns.forEach((c) => fkCols.add(c));
  }
  return fkCols.size >= 2 && t.columns.every((c) => fkCols.has(c.name) || c.pk);
}

// ───────────────────────── the checks ─────────────────────────

interface Rule {
  rule: AuditRule;
  find(m: DiagramModel): Finding[];
  /** applies the fix for the finding with this id; false if it no longer applies */
  fix(m: DiagramModel, id: string): string | false;
}

const RULES: Rule[] = [
  // ── critical ──
  {
    rule: "no-primary-key",
    find: (m) =>
      m.tables
        .filter((t) => t.columns.length && !tablePkColumns(t).length)
        .map((t) => {
          const hasId = t.columns.some((c) => c.name.toLowerCase() === "id");
          return {
            id: `no-primary-key:${keyOf(t)}`,
            rule: "no-primary-key" as const,
            severity: "critical" as const,
            category: "Integrity" as const,
            title: `${q(keyOf(t))} has no primary key`,
            description: "Its rows can't be identified or referenced reliably, other tables can't point at it, and many tools refuse to edit such a table.",
            tables: [keyOf(t)],
            fixLabel: hasId ? "Make “id” the primary key" : "Add an “id” primary key",
          };
        }),
    fix: (m, id) => {
      const t = m.tables.find((x) => `no-primary-key:${keyOf(x)}` === id);
      if (!t || tablePkColumns(t).length) return false;
      const existing = t.columns.find((c) => c.name.toLowerCase() === "id");
      if (existing) {
        existing.pk = true;
        existing.notNull = true;
        if (/^(int|bigint|smallint)/.test(canonicalType(existing.type).kind)) existing.increment = true;
        return `${keyOf(t)}: “${existing.name}” is now the primary key`;
      }
      t.columns.unshift({ name: "id", type: "integer", pk: true, increment: true, notNull: true });
      return `${keyOf(t)}: added primary key “id”`;
    },
  },
  {
    rule: "fk-type-mismatch",
    find: (m) => {
      const out: Finding[] = [];
      for (const r of m.refs) {
        const s = childSide(r, m);
        if (!s) continue;
        const ct = findTable(m, s.child.schema, s.child.table);
        const pt = findTable(m, s.parent.schema, s.parent.table);
        if (!ct || !pt) continue;
        s.child.columns.forEach((cn, i) => {
          const cc = ct.columns.find((c) => c.name === cn);
          const pc = pt.columns.find((c) => c.name === s.parent.columns[i]);
          if (!cc || !pc || typeKind(cc.type) === typeKind(pc.type)) return;
          out.push({
            id: `fk-type-mismatch:${keyOf(ct)}.${cn}`,
            rule: "fk-type-mismatch",
            severity: "critical",
            category: "Integrity",
            title: `Type mismatch: ${keyOf(ct)}.${cn} → ${keyOf(pt)}.${pc.name}`,
            description: `The foreign key is ${cc.type} but the key it references is ${pc.type}. Joins need casts, indexes go unused, and the database may reject the constraint.`,
            tables: [...new Set([keyOf(ct), keyOf(pt)])],
            fixLabel: `Change ${cn} to ${pc.type}`,
          });
        });
      }
      return out;
    },
    fix: (m, id) => {
      for (const r of m.refs) {
        const s = childSide(r, m);
        if (!s) continue;
        const ct = findTable(m, s.child.schema, s.child.table);
        const pt = findTable(m, s.parent.schema, s.parent.table);
        if (!ct || !pt) continue;
        for (let i = 0; i < s.child.columns.length; i++) {
          if (`fk-type-mismatch:${keyOf(ct)}.${s.child.columns[i]}` !== id) continue;
          const cc = ct.columns.find((c) => c.name === s.child.columns[i]);
          const pc = pt.columns.find((c) => c.name === s.parent.columns[i]);
          if (!cc || !pc || typeKind(cc.type) === typeKind(pc.type)) return false;
          cc.type = nonSerial(pc.type);
          return `${keyOf(ct)}.${cc.name} is now ${cc.type}`;
        }
      }
      return false;
    },
  },
  // ── warning ──
  {
    rule: "repeating-group",
    find: (m) => {
      const out: Finding[] = [];
      for (const t of m.tables) {
        for (const [stem, cols] of repeatingGroups(t)) {
          out.push({
            id: `repeating-group:${keyOf(t)}:${stem}`,
            rule: "repeating-group",
            severity: "warning",
            category: "Normalization",
            title: `Repeating group in ${q(keyOf(t))}: ${list(cols)}`,
            description: `Numbered columns store a list inside one row (first normal form). A child table holds any number of ${plural(stem)} and can be searched and indexed.`,
            tables: [keyOf(t)],
            fixLabel: `Move into ${q(`${singular(t.name)}_${plural(stem)}`)}`,
          });
        }
      }
      return out;
    },
    fix: (m, id) => {
      for (const t of m.tables) {
        for (const [stem, cols] of repeatingGroups(t)) {
          if (`repeating-group:${keyOf(t)}:${stem}` !== id) continue;
          if (!tablePkColumns(t).length) t.columns.unshift({ name: "id", type: "integer", pk: true, increment: true, notNull: true });
          const pkName = tablePkColumns(t)[0];
          const pkType = t.columns.find((c) => c.name === pkName)?.type || "integer";
          const valueType = t.columns.find((c) => c.name === cols[0])?.type || "varchar";
          const childName = uniqueTableName(m, t.schema, `${singular(t.name)}_${plural(stem)}`);
          const fk = `${singular(t.name)}_id`;
          m.tables.push({
            schema: t.schema,
            name: childName,
            columns: [
              { name: "id", type: "integer", pk: true, increment: true, notNull: true },
              { name: fk, type: nonSerial(pkType), notNull: true },
              { name: stem, type: valueType },
            ],
            indexes: [{ columns: [fk], name: `idx_${childName}_${fk}` }],
            checks: [],
            x: (t.x ?? 0) + 340,
            y: t.y ?? 0,
          });
          m.refs.push({ from: { schema: t.schema, table: childName, columns: [fk] }, to: { schema: t.schema, table: t.name, columns: [pkName] }, type: "many-to-one", onDelete: "cascade" });
          removeColumns(t, cols);
          return `${keyOf(t)}: ${list(cols)} moved into ${childName}`;
        }
      }
      return false;
    },
  },
  {
    rule: "copied-parent-columns",
    find: (m) =>
      copiedColumns(m).map(({ child, parent, fk, cols }) => ({
        id: `copied-parent-columns:${keyOf(child)}.${fk}`,
        rule: "copied-parent-columns" as const,
        severity: "warning" as const,
        category: "Normalization" as const,
        title: `${q(keyOf(child))} copies data from ${q(keyOf(parent))}`,
        description: `${list(cols.map((c) => c.copy))} depend on ${fk}, not on the ${keyOf(child)} key (third normal form). They duplicate ${list(cols.map((c) => `${parent.name}.${c.source}`), 3)} and drift out of sync.`,
        tables: [keyOf(child), keyOf(parent)],
        fixLabel: `Remove the copied column${cols.length === 1 ? "" : "s"}`,
      })),
    fix: (m, id) => {
      const hit = copiedColumns(m).find((c) => `copied-parent-columns:${keyOf(c.child)}.${c.fk}` === id);
      if (!hit) return false;
      removeColumns(hit.child, hit.cols.map((c) => c.copy));
      return `${keyOf(hit.child)}: removed ${list(hit.cols.map((c) => c.copy))} (read them through ${hit.fk})`;
    },
  },
  {
    // one finding for the whole diagram — a card per table was noise. MySQL / MariaDB (InnoDB) index foreign keys
    // automatically, so the check is skipped there.
    rule: "unindexed-foreign-keys",
    find: (m) => {
      if (/^(mysql|mariadb)/i.test(m.project.databaseType || "")) return [];
      const hits = [...unindexedForeignKeys(m)];
      const keys = hits.flatMap(([t, cols]) => cols.map((c) => `${keyOf(t)}.${c.join(", ")}`));
      if (!keys.length) return [];
      return [
        {
          id: "unindexed-foreign-keys",
          rule: "unindexed-foreign-keys",
          severity: "warning",
          category: "Performance",
          title: keys.length === 1 ? `Foreign key ${keys[0]} has no index` : `${keys.length} foreign keys have no index`,
          description: `Joins through ${keys.length === 1 ? "it" : list(keys)} — and the checks that run whenever a referenced row is deleted — have to scan the whole table.`,
          tables: hits.map(([t]) => keyOf(t)),
          fixLabel: keys.length === 1 ? "Add an index" : `Add ${keys.length} indexes`,
        },
      ];
    },
    fix: (m, id) => {
      const hits = id === "unindexed-foreign-keys" ? [...unindexedForeignKeys(m)] : [];
      if (!hits.length) return false;
      for (const [t, cols] of hits) for (const c of cols) t.indexes.push({ columns: [...c], name: `idx_${t.name}_${c.join("_")}` });
      return `indexed ${list(hits.flatMap(([t, cols]) => cols.map((c) => `${t.name}.${c.join(", ")}`)))}`;
    },
  },
  {
    rule: "undeclared-relationship",
    find: (m) =>
      undeclaredRefs(m).map(({ t, col, target, pk }) => ({
        id: `undeclared-relationship:${keyOf(t)}.${col}`,
        rule: "undeclared-relationship" as const,
        severity: "warning" as const,
        category: "Relationships" as const,
        title: `${keyOf(t)}.${col} looks like a foreign key`,
        description: `It matches ${keyOf(target)}.${pk}, but no relationship is defined — the database won't stop it pointing at rows that don't exist, and the diagram doesn't show the link.`,
        tables: [keyOf(t), keyOf(target)],
        fixLabel: `Add ${t.name}.${col} > ${target.name}.${pk}`,
      })),
    fix: (m, id) => {
      const hit = undeclaredRefs(m).find((u) => `undeclared-relationship:${keyOf(u.t)}.${u.col}` === id);
      if (!hit) return false;
      m.refs.push({ from: { schema: hit.t.schema, table: hit.t.name, columns: [hit.col] }, to: { schema: hit.target.schema, table: hit.target.name, columns: [hit.pk] }, type: "many-to-one" });
      return `added ${keyOf(hit.t)}.${hit.col} > ${keyOf(hit.target)}.${hit.pk}`;
    },
  },
  // ── suggestion ──
  {
    rule: "missing-timestamps",
    find: (m) => {
      const tables = timestampless(m);
      if (!tables.length) return [];
      return [
        {
          id: "missing-timestamps",
          rule: "missing-timestamps",
          severity: "suggestion",
          category: "Conventions",
          title: `${tables.length === 1 ? `${q(keyOf(tables[0]))} has` : `${tables.length} tables have`} no created_at / updated_at`,
          description: `Audit timestamps make debugging, syncing and “recently changed” queries possible${tables.length > 1 ? ` (${list(tables.map(keyOf))})` : ""}. Link tables are left out.`,
          tables: tables.map(keyOf),
          fixLabel: `Add timestamps to ${tables.length === 1 ? "it" : `${tables.length} tables`}`,
        },
      ];
    },
    fix: (m, id) => {
      if (id !== "missing-timestamps") return false;
      const targets = new Set(timestampless(m).map(keyOf));
      if (!targets.size) return false;
      const done = addTimestamps({ ...m, tables: m.tables.filter((t) => targets.has(keyOf(t))) }).model.tables;
      m.tables = m.tables.map((t) => done.find((d) => keyOf(d) === keyOf(t)) ?? t);
      return `added created_at / updated_at to ${list([...targets])}`;
    },
  },
  {
    rule: "mixed-naming",
    find: (m) => {
      const { camel, snakeCount } = namingStyles(m);
      if (!camel.length || !snakeCount) return [];
      return [
        {
          id: "mixed-naming",
          rule: "mixed-naming",
          severity: "suggestion",
          category: "Conventions",
          title: "Mixed naming styles",
          description: `${camel.length} name${camel.length === 1 ? " uses" : "s use"} camelCase (${list(camel.map((c) => c.name), 3)}) while ${snakeCount} use snake_case. One style keeps SQL predictable — unquoted camelCase is folded to lower case by PostgreSQL.`,
          tables: [...new Set(camel.map((c) => c.table))],
          fixLabel: "Convert names to snake_case",
        },
      ];
    },
    fix: (m, id) => {
      if (id !== "mixed-naming" || !namingStyles(m).camel.length) return false;
      const res = snakeCaseNames(m);
      Object.assign(m, res.model);
      return `renamed to snake_case${res.changes.length ? ` (${list(res.changes, 3)})` : ""}`;
    },
  },
];

// ───────────────────────── rule helpers ─────────────────────────

/** stem → columns, for 2+ columns named stem1, stem_2… (address_line_1 / _2 is a legitimate pair, not a group) */
function repeatingGroups(t: TableModel): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const c of t.columns) {
    const mm = /^([a-z][a-z_]*?)_?(\d{1,2})$/i.exec(c.name);
    if (!mm || c.pk) continue;
    const stem = mm[1].replace(/_+$/, "");
    if (stem.length < 3 || /line$/i.test(stem)) continue; // (x1/x2 coordinates, address_line_1/_2 are not groups)
    groups.set(stem, [...(groups.get(stem) || []), c.name]);
  }
  for (const [stem, cols] of groups) if (cols.length < 2) groups.delete(stem);
  return groups;
}

function removeColumns(t: TableModel, cols: string[]) {
  const gone = new Set(cols);
  t.columns = t.columns.filter((c) => !gone.has(c.name));
  t.indexes = t.indexes.filter((ix) => !ix.columns.some((c) => gone.has(c)));
  if (t.records) {
    const keep = t.records.columns.map((c, i) => (gone.has(c) ? -1 : i)).filter((i) => i >= 0);
    t.records = { columns: keep.map((i) => t.records!.columns[i]), rows: t.records.rows.map((r) => keep.map((i) => r[i])) };
  }
}

function uniqueTableName(m: DiagramModel, schema: string | undefined, base: string): string {
  let name = base;
  for (let i = 2; findTable(m, schema, name); i++) name = `${base}_${i}`;
  return name;
}

/** child columns named <parent stem>_<parent column> next to a foreign key to that parent */
function copiedColumns(m: DiagramModel) {
  const out: { child: TableModel; parent: TableModel; fk: string; cols: { copy: string; source: string }[] }[] = [];
  for (const r of m.refs) {
    const s = childSide(r, m);
    if (!s || s.child.columns.length !== 1) continue;
    const child = findTable(m, s.child.schema, s.child.table);
    const parent = findTable(m, s.parent.schema, s.parent.table);
    if (!child || !parent || child === parent) continue;
    const fk = s.child.columns[0];
    const stems = new Set([fk.replace(/_?id$/i, "").toLowerCase(), singular(parent.name).toLowerCase()].filter(Boolean));
    const parentCols = new Map(parent.columns.filter((c) => !c.pk).map((c) => [c.name.toLowerCase(), c.name]));
    const cols: { copy: string; source: string }[] = [];
    for (const c of child.columns) {
      if (c.name === fk || c.pk) continue;
      for (const stem of stems) {
        const lc = c.name.toLowerCase();
        if (!lc.startsWith(stem)) continue;
        const rest = lc.slice(stem.length).replace(/^_/, "");
        const source = parentCols.get(rest);
        if (rest && source) {
          cols.push({ copy: c.name, source });
          break;
        }
      }
    }
    if (cols.length) out.push({ child, parent, fk, cols });
  }
  return out;
}

function unindexedForeignKeys(m: DiagramModel): Map<TableModel, string[][]> {
  const out = new Map<TableModel, string[][]>();
  for (const r of m.refs) {
    const s = childSide(r, m);
    if (!s || !s.child.columns.length) continue;
    const t = findTable(m, s.child.schema, s.child.table);
    if (!t) continue;
    const first = s.child.columns[0];
    const pk = tablePkColumns(t);
    const covered =
      t.indexes.some((ix) => ix.columns[0] === first) ||
      pk[0] === first ||
      t.columns.some((c) => c.unique && c.name === first && s.child.columns.length === 1);
    if (covered) continue;
    const cols = out.get(t) || [];
    if (!cols.some((c) => c.join() === s.child.columns.join())) cols.push([...s.child.columns]);
    out.set(t, cols);
  }
  return out;
}

function undeclaredRefs(m: DiagramModel) {
  const declared = new Set<string>();
  for (const r of m.refs) for (const ep of [r.from, r.to]) for (const c of ep.columns) declared.add(`${tableKey(ep.schema, ep.table)}.${c}`);
  const byName = new Map<string, TableModel>();
  for (const t of m.tables) {
    byName.set(t.name.toLowerCase(), t);
    if (!byName.has(singular(t.name).toLowerCase())) byName.set(singular(t.name).toLowerCase(), t);
  }
  const out: { t: TableModel; col: string; target: TableModel; pk: string }[] = [];
  for (const t of m.tables) {
    const pk = tablePkColumns(t);
    for (const c of t.columns) {
      if (pk.length === 1 && pk[0] === c.name) continue;
      const mm = /^(.+?)(?:_id|Id|_ID)$/.exec(c.name);
      if (!mm || declared.has(`${keyOf(t)}.${c.name}`)) continue;
      const stem = mm[1].toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const target = byName.get(stem) || byName.get(singular(stem)) || byName.get(plural(stem));
      if (!target || target === t) continue;
      const tpk = tablePkColumns(target);
      if (tpk.length !== 1) continue;
      out.push({ t, col: c.name, target, pk: tpk[0] });
    }
  }
  return out;
}

function timestampless(m: DiagramModel): TableModel[] {
  return m.tables.filter((t) => t.columns.length && !isJunction(t, m) && !t.columns.some((c) => /^created(_at|At|_on)?$/.test(c.name)));
}

function namingStyles(m: DiagramModel) {
  const camel: { name: string; table: string }[] = [];
  let snakeCount = 0;
  const look = (name: string, table: string) => {
    if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(name)) camel.push({ name, table });
    else if (/_/.test(name) && name === name.toLowerCase()) snakeCount++;
  };
  for (const t of m.tables) {
    look(t.name, keyOf(t));
    for (const c of t.columns) look(c.name, keyOf(t));
  }
  return { camel, snakeCount };
}

// ───────────────────────── public API ─────────────────────────

export function auditModel(model: DiagramModel): Finding[] {
  const findings = RULES.flatMap((r) => r.find(model));
  const rank = (s: Severity) => SEVERITY_ORDER.indexOf(s);
  return findings.sort((a, b) => rank(a.severity) - rank(b.severity) || a.tables[0]?.localeCompare(b.tables[0] ?? "") || a.title.localeCompare(b.title));
}

/** Applies one finding's fix to (a copy of) the current model. Null when it no longer applies. */
export function applyFix(model: DiagramModel, finding: Pick<Finding, "id" | "rule">): { model: DiagramModel; summary: string } | null {
  const rule = RULES.find((r) => r.rule === finding.rule);
  if (!rule) return null;
  const m = clone(model);
  const summary = rule.fix(m, finding.id);
  return summary === false ? null : { model: m, summary };
}

/**
 * Applies every fix that still applies, in order (each on the result of the previous one) — and then whatever those
 * fixes themselves introduced (declaring a relationship adds a foreign key that needs an index), so "fix all" really
 * leaves nothing behind. Issues that were already there and weren't asked for are left alone.
 */
export function applyAllFixes(model: DiagramModel, findings: Pick<Finding, "id" | "rule">[]): { model: DiagramModel; summaries: string[] } {
  const seen = new Set(auditModel(model).map((f) => `${f.id}|${f.title}`));
  let m = model;
  const summaries: string[] = [];
  let queue: Pick<Finding, "id" | "rule">[] = findings;
  for (let pass = 0; pass < 4 && queue.length; pass++) {
    for (const f of queue) {
      const res = applyFix(m, f);
      if (!res) continue;
      m = res.model;
      summaries.push(res.summary);
    }
    const followUps = auditModel(m).filter((f) => !seen.has(`${f.id}|${f.title}`));
    followUps.forEach((f) => seen.add(`${f.id}|${f.title}`));
    queue = followUps;
  }
  return { model: m, summaries };
}
