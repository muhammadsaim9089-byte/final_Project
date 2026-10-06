/**
 * Standalone SVG renderer for a DiagramModel (tables need x/y positions).
 * Used for SVG / PNG / PDF export, the embeddable viewer and generated documentation, so the result is
 * identical everywhere and never depends on the live DOM.
 */
import { DiagramModel, RefModel, TableModel, tableKey, tableKeyOf, tablePkColumns } from "../model/types";

export type SvgTheme = "dark" | "light";
export type SvgDetail = "all" | "keys" | "headers";

export interface SvgOptions {
  theme?: SvgTheme;
  detail?: SvgDetail;
  showRelationships?: boolean;
  showGroups?: boolean;
  showNotes?: boolean;
  title?: string;
  transparent?: boolean;
  /** table keys to include (diagram views). Undefined = all. */
  visibleKeys?: Set<string> | null;
  /** add data-* attributes and classes used by the interactive viewer */
  interactive?: boolean;
  padding?: number;
}

export interface SvgResult {
  svg: string;
  width: number;
  height: number;
}

const PALETTE = {
  dark: {
    bg: "#0b1120",
    card: "#111a2e",
    border: "#2a3a58",
    text: "#dbe4f3",
    muted: "#7d8ba6",
    stripe: "rgba(255,255,255,0.025)",
    edge: "#7186e0",
    header: "#2f5f9e",
    pk: "#f5b73d",
    fk: "#4cc3f0",
    noteFill: "#3b3418",
    noteText: "#f6e7a6",
    title: "#e9eef8",
  },
  light: {
    bg: "#ffffff",
    card: "#ffffff",
    border: "#c7d0de",
    text: "#1e293b",
    muted: "#64748b",
    stripe: "rgba(15,23,42,0.03)",
    edge: "#5b6ee1",
    header: "#3b82f6",
    pk: "#d97706",
    fk: "#0284c7",
    noteFill: "#fef3c7",
    noteText: "#78350f",
    title: "#0f172a",
  },
};

const NOTE_COLORS = [
  { fill: "#fde68a", text: "#78350f" },
  { fill: "#bae6fd", text: "#0c4a6e" },
  { fill: "#a7f3d0", text: "#064e3b" },
  { fill: "#fbcfe8", text: "#831843" },
  { fill: "#ddd6fe", text: "#4c1d95" },
];

const W = 250;
const HEADER = 38;
const ROW = 26;
const PAD_BOTTOM = 8;
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const SANS = "Inter,'Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif";

export const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s);

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})/i.exec(hex || "");
  if (!m) return 0;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const onColor = (bg: string) => (luminance(bg) > 0.6 ? "#0f172a" : "#ffffff");

interface Box {
  t: TableModel;
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rows: TableModel["columns"];
}

function rowsFor(t: TableModel, detail: SvgDetail, fkCols: Set<string>): TableModel["columns"] {
  if (detail === "headers") return [];
  if (detail === "keys") {
    const pk = new Set(tablePkColumns(t));
    return t.columns.filter((c) => pk.has(c.name) || fkCols.has(c.name));
  }
  return t.columns;
}

export function renderSvg(model: DiagramModel, options: SvgOptions = {}): SvgResult {
  const theme = options.theme || "dark";
  const P = PALETTE[theme];
  const detail = options.detail || "all";
  const showRefs = options.showRelationships !== false;
  const pad = options.padding ?? 48;

  const visibleKeys = options.visibleKeys || null;
  const tables = model.tables.filter((t) => !visibleKeys || visibleKeys.has(tableKeyOf(t)));

  // FK column lookup (for badges + keys-only detail)
  const fkCols = new Map<string, Set<string>>();
  const oriented: { parent: TableModel; child: TableModel; parentCols: string[]; childCols: string[]; type: string; ref: RefModel; optP: boolean; optC: boolean }[] = [];
  const byKey = new Map(tables.map((t) => [tableKeyOf(t), t]));
  const find = (ep: { schema?: string; table: string }) => byKey.get(tableKey(ep.schema, ep.table)) || tables.find((t) => t.name === ep.table);
  for (const r of model.refs) {
    const a = find(r.from);
    const b = find(r.to);
    if (!a || !b) continue;
    if (r.type === "many-to-many") {
      oriented.push({ parent: a, child: b, parentCols: r.from.columns, childCols: r.to.columns, type: "many-to-many", ref: r, optP: !!r.fromOptional, optC: !!r.toOptional });
      continue;
    }
    const childIsFrom = r.type === "many-to-one";
    const child = childIsFrom ? a : b;
    const parent = childIsFrom ? b : a;
    const childEp = childIsFrom ? r.from : r.to;
    const parentEp = childIsFrom ? r.to : r.from;
    const parentCols = parentEp.columns.length ? parentEp.columns : tablePkColumns(parent).slice(0, 1);
    const set = fkCols.get(tableKeyOf(child)) || new Set<string>();
    childEp.columns.forEach((c) => set.add(c));
    fkCols.set(tableKeyOf(child), set);
    oriented.push({
      parent,
      child,
      parentCols,
      childCols: childEp.columns,
      type: r.type === "one-to-one" ? "one-to-one" : "one-to-many",
      ref: r,
      optP: childIsFrom ? !!r.toOptional : !!r.fromOptional,
      optC: childIsFrom ? !!r.fromOptional : !!r.toOptional,
    });
  }

  const boxes = new Map<string, Box>();
  for (const t of tables) {
    const rows = rowsFor(t, detail, fkCols.get(tableKeyOf(t)) || new Set());
    const h = HEADER + rows.length * ROW + (rows.length ? PAD_BOTTOM : 0);
    boxes.set(tableKeyOf(t), { t, key: tableKeyOf(t), x: t.x ?? 0, y: t.y ?? 0, w: W, h, rows });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };

  // ── groups ──
  const groupSvg: string[] = [];
  if (options.showGroups !== false) {
    for (const g of model.groups) {
      const members = g.tables.map((k) => boxes.get(k)).filter(Boolean) as Box[];
      if (!members.length) continue;
      const gx = Math.min(...members.map((b) => b.x)) - 24;
      const gy = Math.min(...members.map((b) => b.y)) - 46;
      const gw = Math.max(...members.map((b) => b.x + b.w)) - gx + 24;
      const gh = Math.max(...members.map((b) => b.y + b.h)) - gy + 24;
      const c = g.color || "#4A90D9";
      grow(gx, gy, gw, gh);
      groupSvg.push(
        `<g class="grp"><rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="16" fill="${c}" fill-opacity="0.07" stroke="${c}" stroke-opacity="0.55" stroke-width="1.5" stroke-dasharray="7 5"/>` +
          `<text x="${gx + 16}" y="${gy + 26}" font-family="${SANS}" font-size="13" font-weight="700" fill="${c}" letter-spacing="0.6">${esc(g.name.toUpperCase())}</text></g>`
      );
    }
  }

  // ── tables ──
  const tableSvg: string[] = [];
  for (const b of boxes.values()) {
    const t = b.t;
    const hc = t.headerColor || P.header;
    const hcText = onColor(hc);
    grow(b.x, b.y, b.w, b.h);
    const pkSet = new Set(tablePkColumns(t));
    const fks = fkCols.get(b.key) || new Set<string>();
    const parts: string[] = [];
    parts.push(`<g class="tbl" data-t="${esc(b.key)}"${options.interactive ? ' style="cursor:pointer"' : ""} transform="translate(${b.x},${b.y})">`);
    parts.push(`<rect width="${b.w}" height="${b.h}" rx="10" fill="${P.card}" stroke="${P.border}" stroke-width="1.2"/>`);
    parts.push(`<path d="M0 10a10 10 0 0 1 10-10h${b.w - 20}a10 10 0 0 1 10 10v${HEADER - 10}H0z" fill="${hc}"/>`);
    const title = (t.schema && t.schema !== "public" ? t.schema + "." : "") + t.name;
    parts.push(`<text x="14" y="${HEADER / 2 + 5}" font-family="${SANS}" font-size="14" font-weight="700" fill="${hcText}">${esc(trunc(title, 26))}</text>`);
    if (t.alias) parts.push(`<text x="${b.w - 12}" y="${HEADER / 2 + 4}" text-anchor="end" font-family="${MONO}" font-size="10" fill="${hcText}" fill-opacity="0.75">${esc(t.alias)}</text>`);
    b.rows.forEach((c, i) => {
      const y = HEADER + i * ROW;
      if (i % 2 === 1) parts.push(`<rect x="1" y="${y}" width="${b.w - 2}" height="${ROW}" fill="${P.stripe}"/>`);
      const isPk = pkSet.has(c.name);
      const isFk = fks.has(c.name);
      if (isPk || isFk) {
        const col = isPk ? P.pk : P.fk;
        parts.push(`<rect x="10" y="${y + 6}" width="22" height="14" rx="3" fill="${col}" fill-opacity="0.16" stroke="${col}" stroke-opacity="0.55" stroke-width="0.8"/>`);
        parts.push(`<text x="21" y="${y + 16.5}" text-anchor="middle" font-family="${MONO}" font-size="8.5" font-weight="700" fill="${col}">${isPk ? "PK" : "FK"}</text>`);
      }
      const type = trunc(c.type, 16);
      const nameMax = Math.floor((b.w - 44 - 12 - type.length * 6.6) / 7.2);
      parts.push(`<text x="40" y="${y + 17}" font-family="${MONO}" font-size="12" fill="${P.text}"${c.notNull ? ' font-weight="600"' : ""}>${esc(trunc(c.name, Math.max(6, nameMax)))}</text>`);
      parts.push(`<text x="${b.w - 12}" y="${y + 17}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${P.muted}">${esc(type)}</text>`);
    });
    if (detail === "keys" && t.columns.length > b.rows.length) {
      parts.push(`<text x="${b.w / 2}" y="${b.h - 2}" text-anchor="middle" font-family="${SANS}" font-size="9" fill="${P.muted}">+${t.columns.length - b.rows.length} more</text>`);
    }
    parts.push("</g>");
    tableSvg.push(parts.join(""));
  }

  // ── relationships ──
  const edgeSvg: string[] = [];
  const anchorY = (b: Box, col: string | undefined) => {
    if (detail !== "all" && detail !== "keys") return b.y + HEADER / 2;
    const idx = col ? b.rows.findIndex((c) => c.name === col) : -1;
    return idx >= 0 ? b.y + HEADER + idx * ROW + ROW / 2 : b.y + HEADER / 2;
  };
  if (showRefs) {
    for (const o of oriented) {
      const p = boxes.get(tableKeyOf(o.parent));
      const c = boxes.get(tableKeyOf(o.child));
      if (!p || !c) continue;
      const py = anchorY(p, o.parentCols[0]);
      const cy = anchorY(c, o.childCols[0]);
      let x1: number, x2: number, s1: number, s2: number;
      if (c.x >= p.x + p.w + 24) {
        x1 = p.x + p.w;
        x2 = c.x;
        s1 = 1;
        s2 = -1;
      } else if (c.x + c.w <= p.x - 24) {
        x1 = p.x;
        x2 = c.x + c.w;
        s1 = -1;
        s2 = 1;
      } else {
        x1 = p.x + p.w;
        x2 = c.x + c.w;
        s1 = 1;
        s2 = 1;
      }
      const same = p === c;
      const off = same ? 70 : Math.max(48, Math.min(180, Math.abs(x2 - x1) / 2));
      const color = o.ref.color || P.edge;
      const d = `M${x1},${py} C${x1 + s1 * off},${py} ${x2 + s2 * off},${cy} ${x2},${cy}`;
      const g: string[] = [`<g class="rel" data-a="${esc(tableKeyOf(o.parent))}" data-b="${esc(tableKeyOf(o.child))}" stroke="${color}" fill="none" stroke-width="1.5" stroke-linecap="round">`];
      g.push(`<path d="${d}" stroke-opacity="0.85"/>`);
      const end = (x: number, y: number, side: number, kind: "one" | "many", optional: boolean) => {
        const s: string[] = [];
        if (kind === "one") s.push(`<path d="M${x + side * 11},${y - 6}V${y + 6}"/>`);
        else s.push(`<path d="M${x + side * 13},${y}L${x},${y - 7}M${x + side * 13},${y}L${x},${y + 7}M${x + side * 13},${y}H${x}"/>`);
        if (optional) s.push(`<circle cx="${x + side * (kind === "one" ? 17 : 21)}" cy="${y}" r="4" fill="${P.bg}"/>`);
        return s.join("");
      };
      const pKind = o.type === "many-to-many" ? "many" : "one";
      const cKind = o.type === "one-to-one" ? "one" : "many";
      g.push(end(x1, py, s1, pKind, o.optP));
      g.push(end(x2, cy, s2, cKind, o.optC));
      g.push("</g>");
      edgeSvg.push(g.join(""));
      grow(Math.min(x1, x2) - 20, Math.min(py, cy) - 10, Math.abs(x2 - x1) + 40, Math.abs(cy - py) + 20);
    }
  }

  // ── sticky notes ──
  const noteSvg: string[] = [];
  if (options.showNotes !== false) {
    for (const n of model.notes) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const lines = wrap(n.text, 26);
      const h = 34 + lines.length * 17;
      const col = NOTE_COLORS[(n.colorIndex ?? 0) % NOTE_COLORS.length];
      grow(x, y, 210, h);
      noteSvg.push(
        `<g transform="translate(${x},${y})"><rect width="210" height="${h}" rx="8" fill="${col.fill}" stroke="rgba(0,0,0,0.15)"/>` +
          lines.map((l, i) => `<text x="12" y="${26 + i * 17}" font-family="${SANS}" font-size="12" fill="${col.text}">${esc(l)}</text>`).join("") +
          "</g>"
      );
    }
  }

  if (!isFinite(minX)) {
    const w = 420;
    const h = 160;
    return {
      width: w,
      height: h,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${options.transparent ? "" : `<rect width="100%" height="100%" fill="${P.bg}"/>`}<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-family="${SANS}" font-size="14" fill="${P.muted}">Empty diagram — add a table to get started</text></svg>`,
    };
  }

  const titleH = options.title ? 44 : 0;
  const ox = pad - minX;
  const oy = pad - minY + titleH;
  const width = Math.ceil(maxX - minX + pad * 2);
  const height = Math.ceil(maxY - minY + pad * 2 + titleH);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${options.interactive ? ' class="erd"' : ""}>` +
    (options.transparent ? "" : `<rect width="100%" height="100%" fill="${P.bg}"/>`) +
    (options.title ? `<text x="${pad}" y="${pad + 8}" font-family="${SANS}" font-size="22" font-weight="700" fill="${P.title}">${esc(options.title)}</text>` : "") +
    `<g transform="translate(${ox},${oy})">${groupSvg.join("")}${edgeSvg.join("")}${tableSvg.join("")}${noteSvg.join("")}</g></svg>`;
  return { svg, width, height };
}

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = "";
    for (const word of raw.split(/\s+/)) {
      if ((line + " " + word).trim().length > max) {
        if (line) out.push(line);
        line = word;
      } else line = (line + " " + word).trim();
    }
    out.push(line);
  }
  return out.slice(0, 10);
}
