import { DiagramModel, TableModel, tableKey, tableKeyOf, tablePkColumns } from "../model/types";

const ident = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_") || "_";
const typeName = (t: string) => t.replace(/\(.*?\)/g, "").replace(/\[\]$/, "_array").replace(/\s+/g, "_") || "string";

/** DiagramModel → Mermaid `erDiagram` (paste into mermaid.live, GitHub markdown, Notion …). */
export function modelToMermaid(model: DiagramModel): string {
  const lines: string[] = ["erDiagram"];
  const byKey = new Map(model.tables.map((t) => [tableKeyOf(t), t]));
  const find = (ep: { schema?: string; table: string }) => byKey.get(tableKey(ep.schema, ep.table)) || model.tables.find((t) => t.name === ep.table);
  const name = (t: TableModel) => ident(t.schema && t.schema !== "public" ? `${t.schema}_${t.name}` : t.name);

  const fkCols = new Map<string, Set<string>>();
  const rels: string[] = [];
  for (const r of model.refs) {
    const a = find(r.from);
    const b = find(r.to);
    if (!a || !b) continue;
    if (r.type === "many-to-many") {
      rels.push(`    ${name(a)} }o--o{ ${name(b)} : "${r.from.columns.join(",")}"`);
      continue;
    }
    const childIsFrom = r.type === "many-to-one";
    const child = childIsFrom ? a : b;
    const parent = childIsFrom ? b : a;
    const cEp = childIsFrom ? r.from : r.to;
    const nullable = cEp.columns.some((c) => !child.columns.find((x) => x.name === c)?.notNull && !child.columns.find((x) => x.name === c)?.pk);
    const set = fkCols.get(tableKeyOf(child)) || new Set<string>();
    cEp.columns.forEach((c) => set.add(c));
    fkCols.set(tableKeyOf(child), set);
    const left = nullable ? "|o" : "||";
    const right = r.type === "one-to-one" ? (nullable ? "o|" : "||") : "o{";
    rels.push(`    ${name(parent)} ${left}--${right} ${name(child)} : "${cEp.columns.join(",")}"`);
  }

  for (const t of model.tables) {
    lines.push(`    ${name(t)} {`);
    const pk = new Set(tablePkColumns(t));
    const fk = fkCols.get(tableKeyOf(t)) || new Set<string>();
    for (const c of t.columns) {
      const keys = [pk.has(c.name) ? "PK" : "", fk.has(c.name) ? "FK" : "", c.unique && !pk.has(c.name) ? "UK" : ""].filter(Boolean).join(",");
      const note = c.note ? ` "${c.note.replace(/"/g, "'").replace(/\n/g, " ")}"` : "";
      lines.push(`        ${typeName(c.type)} ${ident(c.name)}${keys ? " " + keys : ""}${note}`);
    }
    lines.push("    }");
  }
  return [...lines, ...rels].join("\n") + "\n";
}
