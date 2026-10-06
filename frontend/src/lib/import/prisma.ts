/**
 * Prisma schema (`schema.prisma`) → DiagramModel.
 *
 * Understands models / views, enums, the datasource provider, scalar types (+ `@db.*` native types),
 * `@id` / `@@id`, `@unique` / `@@unique`, `@@index`, `@default`, `@map` / `@@map`, `///` doc comments and
 * relations: explicit foreign keys (with `onDelete` / `onUpdate`), one-to-one detection and implicit
 * many-to-many pairs.
 */
import { ColumnModel, DefaultValue, DiagramModel, EnumModel, IndexModel, RefModel, ReferentialAction, TableModel, emptyModel } from "../model/types";

const SCALARS = new Set(["String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Json", "Bytes"]);

const PROVIDERS: Record<string, string> = {
  postgresql: "PostgreSQL",
  postgres: "PostgreSQL",
  cockroachdb: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  sqlserver: "SQL Server",
};

const ACTIONS: Record<string, ReferentialAction> = {
  Cascade: "cascade",
  Restrict: "restrict",
  NoAction: "no action",
  SetNull: "set null",
  SetDefault: "set default",
};

export interface PrismaImportResult {
  model: DiagramModel;
  warnings: string[];
}

interface Block {
  kind: string;
  name: string;
  body: string;
}

/** Removes `//` comments but keeps `///` doc lines (as `///` markers) and never touches string contents. */
function stripComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let inStr = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"' && line[i - 1] !== "\\") inStr = !inStr;
        else if (!inStr && c === "/" && line[i + 1] === "/") {
          return line[i + 2] === "/" ? line : line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

function findBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const re = /^[ \t]*(model|view|enum|datasource|generator|type)[ \t]+(\w+)[ \t]*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    let inStr = false;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i];
      if (c === '"' && text[i - 1] !== "\\") inStr = !inStr;
      else if (!inStr && c === "{") depth++;
      else if (!inStr && c === "}") depth--;
    }
    blocks.push({ kind: m[1], name: m[2], body: text.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return blocks;
}

/** Splits `a, b(1, 2), "c,d"` on top-level commas. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") inStr = !inStr;
    if (!inStr) {
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** `@name(args)` occurrences in the tail of a field / model line. */
function readAttributes(tail: string): { name: string; args: string }[] {
  const out: { name: string; args: string }[] = [];
  const re = /@{1,2}([\w.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail))) {
    let args = "";
    let end = re.lastIndex;
    if (tail[end] === "(") {
      let depth = 0;
      let inStr = false;
      let j = end;
      for (; j < tail.length; j++) {
        const c = tail[j];
        if (c === '"' && tail[j - 1] !== "\\") inStr = !inStr;
        if (inStr) continue;
        if (c === "(") depth++;
        else if (c === ")" && --depth === 0) break;
      }
      args = tail.slice(end + 1, j);
      end = j + 1;
    }
    out.push({ name: m[1], args });
    re.lastIndex = end;
  }
  return out;
}

const unquote = (s: string) => {
  const t = s.trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/\\"/g, '"') : t;
};

const listOf = (s: string): string[] => {
  const m = s.trim().match(/^\[(.*)\]$/s);
  return m ? splitArgs(m[1]).map((x) => x.trim()).filter(Boolean) : [];
};

/** Named argument (`fields: [a]`) or the first positional one. */
function namedArg(args: string, name: string): string | undefined {
  for (const part of splitArgs(args)) {
    const m = part.match(new RegExp(`^${name}\\s*:\\s*([\\s\\S]*)$`));
    if (m) return m[1].trim();
  }
  return undefined;
}
const firstPositional = (args: string): string | undefined => splitArgs(args).find((p) => !/^\w+\s*:/.test(p));

function nativeType(attr: { name: string; args: string }): string | undefined {
  if (!attr.name.startsWith("db.")) return undefined;
  const base = attr.name.slice(3);
  const special: Record<string, string> = { DoublePrecision: "double precision", TinyInt: "tinyint", SmallInt: "smallint", BigInt: "bigint", Int: "integer", Real: "real", ByteA: "bytea", Timestamptz: "timestamptz", Timetz: "timetz", JsonB: "jsonb", Json: "json", Uuid: "uuid", Xml: "xml", Inet: "inet", Money: "money", Oid: "oid", Bit: "bit", VarBit: "varbit" };
  const name = special[base] || base.toLowerCase();
  const args = attr.args.trim();
  return args ? `${name}(${args.replace(/\s+/g, "")})` : name;
}

function scalarType(prisma: string, native: string | undefined): string {
  if (native) return native;
  switch (prisma) {
    case "String":
      return "varchar(255)";
    case "Int":
      return "integer";
    case "BigInt":
      return "bigint";
    case "Float":
      return "float";
    case "Decimal":
      return "decimal(65,30)";
    case "Boolean":
      return "boolean";
    case "DateTime":
      return "timestamp";
    case "Json":
      return "json";
    case "Bytes":
      return "bytea";
    default:
      return prisma;
  }
}

function parseDefault(args: string, type: string): { def?: DefaultValue; increment?: boolean } {
  const a = args.trim();
  if (!a) return {};
  if (/^autoincrement\(\s*\)$/.test(a)) return { increment: true };
  if (/^now\(\s*\)$/.test(a)) return { def: { kind: "expression", value: "now()" } };
  if (/^uuid\(\s*\)$/.test(a)) return { def: { kind: "expression", value: "gen_random_uuid()" } };
  if (/^(cuid|nanoid|ulid)\(.*\)$/.test(a)) return {}; // generated by the client, no database default
  const gen = a.match(/^dbgenerated\(\s*"([\s\S]*)"\s*\)$/);
  if (gen) return { def: { kind: "expression", value: gen[1] } };
  if (/^dbgenerated\(\s*\)$/.test(a)) return {};
  if (/^-?\d+(\.\d+)?$/.test(a)) return { def: { kind: "number", value: a } };
  if (/^(true|false)$/.test(a)) return { def: { kind: "boolean", value: a } };
  if (/^".*"$/.test(a)) return { def: { kind: "string", value: unquote(a) } };
  if (/^\[.*\]$/.test(a)) return { def: { kind: "expression", value: `'{${splitArgs(a.slice(1, -1)).map(unquote).join(",")}}'` } };
  if (/^\w+$/.test(a) && !/^(true|false|null)$/.test(a)) return { def: { kind: "string", value: a } }; // enum value
  return type ? { def: { kind: "expression", value: a } } : {};
}

interface FieldInfo {
  name: string; // Prisma field name
  column: string; // database column name
  type: string;
  optional: boolean;
  list: boolean;
  attrs: { name: string; args: string }[];
  doc?: string;
}

function relationName(f: { attrs: { name: string; args: string }[] }): string {
  const r = f.attrs.find((a) => a.name === "relation");
  if (!r) return "";
  const n = namedArg(r.args, "name") ?? firstPositional(r.args);
  return n ? unquote(n) : "";
}

function hasForeignKey(f: { attrs: { name: string; args: string }[] }): boolean {
  const r = f.attrs.find((a) => a.name === "relation");
  return !!r && listOf(namedArg(r.args, "fields") || "").length > 0;
}

export function parsePrismaSchema(text: string): PrismaImportResult {
  const model = emptyModel();
  const warnings: string[] = [];
  const blocks = findBlocks(stripComments(text));
  const enumNames = new Set(blocks.filter((b) => b.kind === "enum").map((b) => b.name));
  const modelBlocks = blocks.filter((b) => b.kind === "model" || b.kind === "view");
  const modelNames = new Set(modelBlocks.map((b) => b.name));

  for (const b of blocks) {
    if (b.kind === "datasource") {
      const provider = b.body.match(/provider\s*=\s*"([^"]+)"/)?.[1];
      if (provider && PROVIDERS[provider]) model.project.databaseType = PROVIDERS[provider];
    }
  }

  for (const b of blocks.filter((x) => x.kind === "enum")) {
    const values = b.body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("@@") && !l.startsWith("///"))
      .map((l) => ({ name: l.split(/\s+/)[0] }));
    const en: EnumModel = { name: b.name, values };
    model.enums.push(en);
  }

  // pass 1: tables and their columns; field → column name maps drive relation resolution
  const tables = new Map<string, TableModel>();
  const fieldsByModel = new Map<string, FieldInfo[]>();
  const tableNameOf = new Map<string, string>();
  const pkOf = new Map<string, string[]>();

  for (const b of modelBlocks) {
    const fields: FieldInfo[] = [];
    const blockAttrs: { name: string; args: string }[] = [];
    let doc: string[] = [];
    for (const raw of b.body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("///")) {
        doc.push(line.replace(/^\/\/\/\s?/, ""));
        continue;
      }
      if (line.startsWith("@@")) {
        blockAttrs.push(...readAttributes(line));
        continue;
      }
      const m = line.match(/^(\w+)\s+([\w.]+)(\[\]|\?)?\s*(.*)$/);
      if (!m) {
        doc = [];
        continue;
      }
      const attrs = readAttributes(m[4]);
      const mapped = attrs.find((a) => a.name === "map");
      fields.push({ name: m[1], column: mapped ? unquote(firstPositional(mapped.args) || m[1]) : m[1], type: m[2], optional: m[3] === "?", list: m[3] === "[]", attrs, doc: doc.length ? doc.join(" ") : undefined });
      doc = [];
    }
    const mapAttr = blockAttrs.find((a) => a.name === "map");
    const tableName = mapAttr ? unquote(firstPositional(mapAttr.args) || b.name) : b.name;
    tableNameOf.set(b.name, tableName);
    fieldsByModel.set(b.name, fields);

    const columns: ColumnModel[] = [];
    const indexes: IndexModel[] = [];
    const colOf = (f: string) => fields.find((x) => x.name === f)?.column || f;

    for (const f of fields) {
      const isRelation = modelNames.has(f.type);
      if (isRelation) continue; // relation fields are not columns
      const col: ColumnModel = { name: f.column, type: "" };
      const native = f.attrs.map(nativeType).find(Boolean);
      const isEnum = enumNames.has(f.type);
      if (!SCALARS.has(f.type) && !isEnum) warnings.push(`Field ${b.name}.${f.name}: unknown type '${f.type}' kept as is`);
      col.type = scalarType(f.type, native);
      if (f.list) col.type += "[]";
      if (f.attrs.some((a) => a.name === "id")) col.pk = true;
      if (f.attrs.some((a) => a.name === "unique")) col.unique = true;
      if (!f.optional && !f.list) col.notNull = true;
      const def = f.attrs.find((a) => a.name === "default");
      if (def) {
        const r = parseDefault(def.args, col.type);
        if (r.increment) col.increment = true;
        if (r.def) col.default = r.def;
      }
      if (f.attrs.some((a) => a.name === "updatedAt") && !col.default) col.default = { kind: "expression", value: "now()" };
      if (f.doc) col.note = f.doc;
      columns.push(col);
    }

    for (const a of blockAttrs) {
      if (a.name === "id") {
        const cols = listOf(firstPositional(a.args) || "").map(colOf);
        if (cols.length) indexes.push({ columns: cols, pk: true });
        for (const c of columns) if (cols.includes(c.name)) c.notNull = true;
      } else if (a.name === "unique" || a.name === "index") {
        const cols = listOf(namedArg(a.args, "fields") || firstPositional(a.args) || "").map(colOf);
        if (!cols.length) continue;
        const name = namedArg(a.args, "map") || namedArg(a.args, "name");
        const ix: IndexModel = { columns: cols };
        if (name) ix.name = unquote(name);
        if (a.name === "unique") ix.unique = true;
        const type = namedArg(a.args, "type");
        if (type) ix.type = type.toLowerCase();
        indexes.push(ix);
      }
    }

    const pk = columns.filter((c) => c.pk).map((c) => c.name);
    pkOf.set(b.name, pk.length ? pk : indexes.find((i) => i.pk)?.columns || []);
    const table: TableModel = { name: tableName, columns, indexes, checks: [] };
    if (b.kind === "view") table.note = "View";
    tables.set(b.name, table);
  }

  // pass 2: relations
  const uniqueCols = (modelName: string): Set<string> => {
    const s = new Set<string>();
    const t = tables.get(modelName);
    if (!t) return s;
    for (const c of t.columns) if (c.unique || c.pk) s.add(c.name);
    for (const i of t.indexes) if ((i.unique || i.pk) && i.columns.length === 1) s.add(i.columns[0]);
    return s;
  };
  const fkFieldsOf = (fields: FieldInfo[], names: string[]) => names.map((n) => fields.find((f) => f.name === n)?.column || n);
  const seenPairs = new Set<string>();

  for (const b of modelBlocks) {
    const fields = fieldsByModel.get(b.name) || [];
    for (const f of fields) {
      if (!modelNames.has(f.type)) continue;
      const rel = f.attrs.find((a) => a.name === "relation");
      const fkNames = rel ? listOf(namedArg(rel.args, "fields") || "") : [];
      const refNames = rel ? listOf(namedArg(rel.args, "references") || "") : [];

      if (fkNames.length && refNames.length) {
        // this side holds the foreign key
        const targetFields = fieldsByModel.get(f.type) || [];
        const fkCols = fkFieldsOf(fields, fkNames);
        const refCols = fkFieldsOf(targetFields, refNames);
        const childTable = tables.get(b.name)!;
        const parentTable = tables.get(f.type)!;
        const uq = uniqueCols(b.name);
        const pkCols = pkOf.get(b.name) || [];
        const oneToOne = (fkCols.length === 1 && uq.has(fkCols[0])) || (fkCols.length > 1 && (pkCols.length === fkCols.length && fkCols.every((c) => pkCols.includes(c))));
        const onDelete = ACTIONS[unquote(namedArg(rel!.args, "onDelete") || "")];
        const onUpdate = ACTIONS[unquote(namedArg(rel!.args, "onUpdate") || "")];
        const name = namedArg(rel!.args, "map") || undefined;
        const child = { table: childTable.name, columns: fkCols };
        const parent = { table: parentTable.name, columns: refCols };
        const ref: RefModel = oneToOne ? { from: parent, to: child, type: "one-to-one" } : { from: child, to: parent, type: "many-to-one" };
        // an optional relation field means the child may exist without a parent
        if (f.optional) {
          if (oneToOne) ref.fromOptional = true;
          else ref.toOptional = true;
        }
        if (onDelete) ref.onDelete = onDelete;
        if (onUpdate) ref.onUpdate = onUpdate;
        if (name) ref.name = unquote(name);
        model.refs.push(ref);
        continue;
      }

      // implicit many-to-many: both sides are lists without foreign-key fields
      if (f.list) {
        const relName = relationName(f);
        const otherFields = fieldsByModel.get(f.type) || [];
        const back = otherFields.find((o) => o !== f && o.type === b.name && o.list && !hasForeignKey(o) && relationName(o) === relName);
        if (!back) continue; // the list side of an ordinary one-to-many
        const key = [b.name, f.type].sort().join("|") + `|${relName}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const a = pkOf.get(b.name) || [];
        const c = pkOf.get(f.type) || [];
        if (!a.length || !c.length) {
          warnings.push(`Many-to-many ${b.name} ⇄ ${f.type}: a primary key is required on both models`);
          continue;
        }
        model.refs.push({ from: { table: tables.get(b.name)!.name, columns: [a[0]] }, to: { table: tables.get(f.type)!.name, columns: [c[0]] }, type: "many-to-many" });
      }
    }
  }

  model.tables = Array.from(tables.values());
  if (!model.tables.length) warnings.push("No models were found in the Prisma schema");
  return { model, warnings };
}
