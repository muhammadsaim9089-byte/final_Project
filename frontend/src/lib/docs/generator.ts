/**
 * Documentation generator (dbdocs / ERDLab "Documentation"): Markdown and a self-contained HTML page
 * with sidebar navigation, live search, per-table detail, relationships, enums, groups, lineage and
 * the embedded ER diagram. The HTML prints cleanly, so "Print → Save as PDF" gives a vector PDF.
 */
import { DiagramModel, TableModel, slugify, tableKey, tableKeyOf, tablePkColumns } from "../model/types";
import { esc } from "../export/svgRenderer";

export interface DocsOptions {
  title?: string;
  /** inline SVG of the ER diagram (from renderSvg) */
  svg?: string;
  generatedAt?: Date;
}

interface Rel {
  column: string;
  otherTable: string;
  otherColumn: string;
  kind: string;
  onDelete?: string;
  onUpdate?: string;
}

function relations(model: DiagramModel) {
  const out = new Map<string, Rel[]>();
  const inc = new Map<string, Rel[]>();
  const byKey = new Map(model.tables.map((t) => [tableKeyOf(t), t]));
  const find = (ep: { schema?: string; table: string }) => byKey.get(tableKey(ep.schema, ep.table)) || model.tables.find((t) => t.name === ep.table);
  const push = (m: Map<string, Rel[]>, k: string, r: Rel) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  };
  for (const r of model.refs) {
    const a = find(r.from);
    const b = find(r.to);
    if (!a || !b) continue;
    if (r.type === "many-to-many") {
      push(out, tableKeyOf(a), { column: r.from.columns.join(", "), otherTable: tableKeyOf(b), otherColumn: r.to.columns.join(", "), kind: "many-to-many" });
      push(out, tableKeyOf(b), { column: r.to.columns.join(", "), otherTable: tableKeyOf(a), otherColumn: r.from.columns.join(", "), kind: "many-to-many" });
      continue;
    }
    const childIsFrom = r.type === "many-to-one";
    const child = childIsFrom ? a : b;
    const parent = childIsFrom ? b : a;
    const cEp = childIsFrom ? r.from : r.to;
    const pEp = childIsFrom ? r.to : r.from;
    const kind = r.type === "one-to-one" ? "one-to-one" : "many-to-one";
    push(out, tableKeyOf(child), { column: cEp.columns.join(", "), otherTable: tableKeyOf(parent), otherColumn: pEp.columns.join(", ") || tablePkColumns(parent).join(", "), kind, onDelete: r.onDelete, onUpdate: r.onUpdate });
    push(inc, tableKeyOf(parent), { column: pEp.columns.join(", ") || tablePkColumns(parent).join(", "), otherTable: tableKeyOf(child), otherColumn: cEp.columns.join(", "), kind: r.type === "one-to-one" ? "one-to-one" : "one-to-many", onDelete: r.onDelete, onUpdate: r.onUpdate });
  }
  return { out, inc };
}

function constraintsOf(t: TableModel, c: TableModel["columns"][number], fk: boolean): string[] {
  const s: string[] = [];
  if (tablePkColumns(t).includes(c.name)) s.push("PK");
  if (fk) s.push("FK");
  if (c.notNull && !tablePkColumns(t).includes(c.name)) s.push("NOT NULL");
  if (c.unique) s.push("UNIQUE");
  if (c.increment) s.push("AUTO INCREMENT");
  for (const ck of c.checks || []) s.push(`CHECK (${ck})`);
  return s;
}

function defaultText(c: TableModel["columns"][number]): string {
  if (!c.default) return "";
  return c.default.kind === "string" ? `'${c.default.value}'` : c.default.value;
}

const cell = (s: string) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

// ───────────────────────────── Markdown ─────────────────────────────

export function generateMarkdownDocs(model: DiagramModel, opts: DocsOptions = {}): string {
  const title = opts.title || model.project.name || "Database documentation";
  const { out, inc } = relations(model);
  const L: string[] = [];
  L.push(`# ${title}`, "");
  if (model.project.note) L.push(model.project.note, "");
  const cols = model.tables.reduce((n, t) => n + t.columns.length, 0);
  L.push(`> ${model.tables.length} tables · ${cols} columns · ${model.refs.length} relationships${model.project.databaseType ? ` · ${model.project.databaseType}` : ""}`, "");

  L.push("## Contents", "");
  L.push("- [Tables](#tables)");
  if (model.enums.length) L.push("- [Enums](#enums)");
  if (model.groups.length) L.push("- [Table groups](#table-groups)");
  if (model.deps.length) L.push("- [Data lineage](#data-lineage)");
  L.push("");

  L.push("## Tables", "");
  for (const t of model.tables) L.push(`- [${tableKeyOf(t)}](#${slugify(tableKeyOf(t))})${t.note ? ` — ${t.note.split("\n")[0]}` : ""}`);
  L.push("");

  for (const t of model.tables) {
    const key = tableKeyOf(t);
    const fkCols = new Set((out.get(key) || []).filter((r) => r.kind !== "many-to-many").flatMap((r) => r.column.split(", ")));
    L.push(`### ${key}`, "");
    if (t.note) L.push(t.note, "");
    L.push("| Column | Type | Constraints | Default | Description |", "| --- | --- | --- | --- | --- |");
    for (const c of t.columns) L.push(`| \`${c.name}\` | \`${c.type}\` | ${cell(constraintsOf(t, c, fkCols.has(c.name)).join(", "))} | ${cell(defaultText(c) ? "`" + defaultText(c) + "`" : "")} | ${cell(c.note || "")} |`);
    L.push("");
    if (t.indexes.length) {
      L.push("**Indexes**", "", "| Name | Columns | Type |", "| --- | --- | --- |");
      for (const ix of t.indexes) L.push(`| ${ix.name || ""} | ${ix.columns.join(", ")} | ${[ix.pk ? "PRIMARY KEY" : "", ix.unique ? "UNIQUE" : "", ix.type || ""].filter(Boolean).join(" ") || "INDEX"} |`);
      L.push("");
    }
    if (t.checks.length) {
      L.push("**Check constraints**", "");
      for (const c of t.checks) L.push(`- ${c.name ? `\`${c.name}\`: ` : ""}\`${c.expression}\``);
      L.push("");
    }
    const outgoing = out.get(key) || [];
    const incoming = inc.get(key) || [];
    if (outgoing.length || incoming.length) {
      L.push("**Relationships**", "");
      for (const r of outgoing) L.push(`- \`${r.column}\` → [${r.otherTable}](#${slugify(r.otherTable)}).\`${r.otherColumn}\` (${r.kind}${r.onDelete ? `, on delete ${r.onDelete}` : ""})`);
      for (const r of incoming) L.push(`- referenced by [${r.otherTable}](#${slugify(r.otherTable)}).\`${r.otherColumn}\``);
      L.push("");
    }
    if (t.records && t.records.rows.length) {
      L.push("**Sample data**", "", `| ${t.records.columns.join(" | ")} |`, `| ${t.records.columns.map(() => "---").join(" | ")} |`);
      for (const row of t.records.rows.slice(0, 5)) L.push(`| ${row.map((v) => cell(v === null ? "NULL" : String(v))).join(" | ")} |`);
      if (t.records.rows.length > 5) L.push(`| … ${t.records.rows.length - 5} more rows |${" |".repeat(Math.max(0, t.records.columns.length - 1))}`);
      L.push("");
    }
  }

  if (model.enums.length) {
    L.push("## Enums", "");
    for (const e of model.enums) {
      L.push(`### ${e.schema ? e.schema + "." : ""}${e.name}`, "");
      if (e.note) L.push(e.note, "");
      for (const v of e.values) L.push(`- \`${v.name}\`${v.note ? ` — ${v.note}` : ""}`);
      L.push("");
    }
  }
  if (model.groups.length) {
    L.push("## Table groups", "");
    for (const g of model.groups) {
      L.push(`### ${g.name}`, "");
      if (g.note) L.push(g.note, "");
      for (const k of g.tables) L.push(`- [${k}](#${slugify(k)})`);
      L.push("");
    }
  }
  if (model.deps.length) {
    L.push("## Data lineage", "", "| Upstream | Downstream | Description |", "| --- | --- | --- |");
    for (const d of model.deps) {
      const ep = (e: typeof d.from) => `${tableKey(e.schema, e.table)}${e.column ? "." + e.column : ""}`;
      L.push(`| \`${ep(d.from)}\` | \`${ep(d.to)}\` | ${cell(d.note || "")} |`);
    }
    L.push("");
  }
  L.push("---", `_Generated by DesignDB on ${(opts.generatedAt || new Date()).toISOString().slice(0, 10)}_`, "");
  return L.join("\n");
}

// ───────────────────────────── HTML ─────────────────────────────

export function generateHtmlDocs(model: DiagramModel, opts: DocsOptions = {}): string {
  const title = opts.title || model.project.name || "Database documentation";
  const { out, inc } = relations(model);
  const cols = model.tables.reduce((n, t) => n + t.columns.length, 0);
  const id = (k: string) => "t-" + slugify(k);

  const tableHtml = model.tables
    .map((t) => {
      const key = tableKeyOf(t);
      const fkCols = new Set((out.get(key) || []).filter((r) => r.kind !== "many-to-many").flatMap((r) => r.column.split(", ")));
      const rows = t.columns
        .map((c) => {
          const cons = constraintsOf(t, c, fkCols.has(c.name));
          return `<tr><td class="mono strong">${esc(c.name)}</td><td class="mono type">${esc(c.type)}</td><td>${cons.map((x) => `<span class="pill ${x === "PK" ? "pk" : x === "FK" ? "fk" : ""}">${esc(x)}</span>`).join(" ")}</td><td class="mono">${esc(defaultText(c))}</td><td>${esc(c.note || "")}</td></tr>`;
        })
        .join("");
      const outgoing = out.get(key) || [];
      const incoming = inc.get(key) || [];
      const rel =
        outgoing.length || incoming.length
          ? `<h4>Relationships</h4><ul class="rels">${outgoing.map((r) => `<li><code>${esc(r.column)}</code> → <a href="#${id(r.otherTable)}">${esc(r.otherTable)}</a>.<code>${esc(r.otherColumn)}</code> <em>${esc(r.kind)}${r.onDelete ? ` · on delete ${esc(r.onDelete)}` : ""}</em></li>`).join("")}${incoming.map((r) => `<li>referenced by <a href="#${id(r.otherTable)}">${esc(r.otherTable)}</a>.<code>${esc(r.otherColumn)}</code></li>`).join("")}</ul>`
          : "";
      const idx = t.indexes.length ? `<h4>Indexes</h4><ul>${t.indexes.map((ix) => `<li><code>${esc(ix.name || "(unnamed)")}</code> on (${esc(ix.columns.join(", "))}) ${ix.pk ? "· primary key" : ""}${ix.unique ? "· unique" : ""}${ix.type ? "· " + esc(ix.type) : ""}</li>`).join("")}</ul>` : "";
      const chk = t.checks.length ? `<h4>Check constraints</h4><ul>${t.checks.map((c) => `<li>${c.name ? `<code>${esc(c.name)}</code>: ` : ""}<code>${esc(c.expression)}</code></li>`).join("")}</ul>` : "";
      const sample =
        t.records && t.records.rows.length
          ? `<h4>Sample data</h4><div class="scroll"><table class="grid"><thead><tr>${t.records.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${t.records.rows.slice(0, 5).map((r) => `<tr>${r.map((v) => `<td class="mono">${v === null ? '<span class="null">NULL</span>' : esc(String(v))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
          : "";
      const color = t.headerColor ? ` style="border-left-color:${esc(t.headerColor)}"` : "";
      return `<section class="card" id="${id(key)}" data-name="${esc(key.toLowerCase())}"${color}><h3>${esc(key)} <small>${t.columns.length} columns</small></h3>${t.note ? `<p class="note">${esc(t.note)}</p>` : ""}<div class="scroll"><table class="grid"><thead><tr><th>Column</th><th>Type</th><th>Constraints</th><th>Default</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>${rel}${idx}${chk}${sample}</section>`;
    })
    .join("\n");

  const enums = model.enums.length
    ? `<h2 id="enums">Enums</h2>${model.enums.map((e) => `<section class="card"><h3>${esc((e.schema ? e.schema + "." : "") + e.name)}</h3>${e.note ? `<p class="note">${esc(e.note)}</p>` : ""}<ul>${e.values.map((v) => `<li><code>${esc(v.name)}</code>${v.note ? ` — ${esc(v.note)}` : ""}</li>`).join("")}</ul></section>`).join("")}`
    : "";
  const groups = model.groups.length
    ? `<h2 id="groups">Table groups</h2>${model.groups.map((g) => `<section class="card"${g.color ? ` style="border-left-color:${esc(g.color)}"` : ""}><h3>${esc(g.name)}</h3>${g.note ? `<p class="note">${esc(g.note)}</p>` : ""}<ul>${g.tables.map((k) => `<li><a href="#${id(k)}">${esc(k)}</a></li>`).join("")}</ul></section>`).join("")}`
    : "";
  const dep = (e: { schema?: string; table: string; column?: string }) => `${tableKey(e.schema, e.table)}${e.column ? "." + e.column : ""}`;
  const lineage = model.deps.length
    ? `<h2 id="lineage">Data lineage</h2><div class="scroll"><table class="grid"><thead><tr><th>Upstream</th><th></th><th>Downstream</th><th>Description</th></tr></thead><tbody>${model.deps.map((d) => `<tr><td class="mono">${esc(dep(d.from))}</td><td>→</td><td class="mono">${esc(dep(d.to))}</td><td>${esc(d.note || "")}</td></tr>`).join("")}</tbody></table></div>`
    : "";

  const nav = model.tables.map((t) => `<a href="#${id(tableKeyOf(t))}" data-name="${esc(tableKeyOf(t).toLowerCase())}">${esc(tableKeyOf(t))}</a>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Documentation</title>
<style>
:root{--bg:#f6f8fb;--card:#fff;--text:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#3b82f6;--code:#eef2f7}
@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--card:#111a2e;--text:#e2e8f0;--muted:#8b9bb8;--line:#26334d;--accent:#5aa2f5;--code:#182238}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex}
aside{position:sticky;top:0;height:100vh;width:280px;flex:none;overflow:auto;padding:20px 16px;border-right:1px solid var(--line);background:var(--card)}
aside h1{font-size:16px;margin:0 0 4px}aside p{margin:0 0 12px;color:var(--muted);font-size:12px}
aside input{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);margin-bottom:10px}
aside nav a{display:block;padding:5px 8px;border-radius:6px;color:var(--text);text-decoration:none;font:13px ui-monospace,Menlo,Consolas,monospace}
aside nav a:hover{background:var(--code)}aside .sec{margin:14px 8px 4px;font-size:11px;letter-spacing:.08em;color:var(--muted);text-transform:uppercase}
main{flex:1;min-width:0;padding:32px 40px;max-width:1100px}h1.title{font-size:30px;margin:0 0 6px}h2{margin:36px 0 12px;font-size:22px}
.meta{color:var(--muted);margin-bottom:24px}.card{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:12px;padding:16px 18px;margin:0 0 16px}
.card h3{margin:0 0 6px;font:600 17px ui-monospace,Menlo,Consolas,monospace}.card h3 small{font:12px Inter,sans-serif;color:var(--muted);margin-left:8px}
.card h4{margin:16px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.note{color:var(--muted);margin:0 0 10px;white-space:pre-wrap}
.scroll{overflow:auto}table.grid{border-collapse:collapse;width:100%;font-size:13px}.grid th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:6px 10px;border-bottom:1px solid var(--line)}
.grid td{padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}.strong{font-weight:600}.type{color:var(--accent)}
.pill{display:inline-block;padding:1px 7px;border-radius:999px;background:var(--code);font-size:11px;margin-right:3px}.pill.pk{background:#f59e0b26;color:#d97706}.pill.fk{background:#0ea5e926;color:#0284c7}
code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:12.5px}.rels{margin:0;padding-left:18px}.null{color:var(--muted);font-style:italic}a{color:var(--accent)}
.diagram{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px;overflow:auto;margin-bottom:24px}.diagram svg{max-width:100%;height:auto;display:block;margin:auto}
@media print{aside{display:none}body{display:block;background:#fff;color:#000}main{padding:0;max-width:none}.card{break-inside:avoid;box-shadow:none}}
@media (max-width:820px){body{display:block}aside{position:static;height:auto;width:auto}main{padding:20px}}
</style></head><body>
<aside><h1>${esc(title)}</h1><p>${model.tables.length} tables · ${cols} columns · ${model.refs.length} relationships</p>
<input id="q" placeholder="Search tables…" autocomplete="off"><nav id="nav"><div class="sec">Tables</div>${nav}${model.enums.length ? '<div class="sec">More</div><a href="#enums">Enums</a>' : ""}${model.groups.length ? '<a href="#groups">Table groups</a>' : ""}${model.deps.length ? '<a href="#lineage">Data lineage</a>' : ""}</nav></aside>
<main><h1 class="title">${esc(title)}</h1>
<div class="meta">${model.project.databaseType ? esc(model.project.databaseType) + " · " : ""}Generated by DesignDB on ${(opts.generatedAt || new Date()).toISOString().slice(0, 10)}</div>
${model.project.note ? `<p class="note">${esc(model.project.note)}</p>` : ""}
${opts.svg ? `<h2>Entity-relationship diagram</h2><div class="diagram">${opts.svg}</div>` : ""}
<h2 id="tables">Tables</h2>
${tableHtml}
${enums}${groups}${lineage}
</main>
<script>
(function(){var q=document.getElementById('q'),links=[].slice.call(document.querySelectorAll('#nav a[data-name]')),cards=[].slice.call(document.querySelectorAll('section.card[data-name]'));
q.addEventListener('input',function(){var v=q.value.trim().toLowerCase();links.forEach(function(a){a.style.display=!v||a.dataset.name.indexOf(v)>-1?'':'none'});cards.forEach(function(c){c.style.display=!v||c.dataset.name.indexOf(v)>-1?'':'none'})})})();
</script></body></html>`;
}
