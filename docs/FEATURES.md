# DesignDB — feature guide

DesignDB now covers the feature set of **dbdiagram.io** (free + paid) and **ERDLab** (free + paid) in one free,
self-hostable app. This page maps each feature to where you find it and how it works.

**Deliberately not included:** multi-user collaboration — real-time co-editing, live chat, team workspaces,
roles/permissions, billing/plans and SSO. Everything below works for a single person, without an account.

> Everything runs in the browser except: publishing (`/share/<slug>`), live-database reverse engineering, the
> programmatic converter and the optional LLM assistant. Those use small API routes in `src/app/api/`.

---

## 1. One model, many formats

All formats go through a single framework-free **DiagramModel** (`src/lib/model/types.ts`): tables, columns, refs,
enums, table groups, sticky notes, diagram views, data-lineage dependencies and project info. The canvas is a live
view of that model, and the code editor is another view of the *same* model.

| Direction | Formats |
|---|---|
| **Import** | DBML · SQL DDL (PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, SQLite, Snowflake, BigQuery, Redshift, Databricks — auto-detected, pg_dump / mysqldump output works) · Prisma schema · Django models · Rails `schema.rb` · Mermaid `erDiagram` · JSON (DesignDB model or AI schema) · **CSV / TSV** (Import → *Data files* → *Import from CSV*: one table per file — drop several at once — named after the file; comma / semicolon / tab / pipe separators; column types inferred from the values; `id` becomes the primary key, `customer_id` a relationship to an imported `customers`; the first 100 rows become the table's sample data; pasted CSV uses a `-- table: <name>` line per table) · SQLite database file · live PostgreSQL / MySQL · pasted DDL dumps |
| **Export** | PNG (1–3×, dark/light) · SVG · PDF · SQL for **9 dialects** · MongoDB · DBML · JSON · Mermaid · HTML / Markdown documentation (print → PDF) · CSV sample data (zip) |

**Import dialog** (*Import* menu, or `Ctrl+I`): pick where the schema comes from — *Import from MySQL / PostgreSQL / SQL Server / Oracle / SQLite / Snowflake / BigQuery / Redshift / Databricks / DBML / Prisma / Django / Rails / Mermaid / JSON*, or *Auto-detect*. The left pane shows step-by-step instructions for that source (the dump command with an example, ready to copy); paste the result on the right, click **Upload file**, or drop a file onto the box. A live summary ("Detected PostgreSQL · 12 tables · 9 relationships · 2 warnings") appears before you submit. Choose what happens on **Submit**: **Merge** (add new tables, keep the rest — the default), **Replace** (a restore point is saved first) or **Append DBML** (adds the converted DBML to the end of the code). SQLite `.db` files open in the reverse-engineering tool; live PostgreSQL / MySQL and database-to-database conversion are one click away in the same dialog.
Export: *Export* menu → SQL scripts / Diagram / Documentation / Sample data.

---

## 2. dbdiagram.io features

| Feature | Where / how |
|---|---|
| **DBML editor** with syntax highlighting, folding, autocomplete (tables, columns, types, settings), lint markers, format, comment toggle, go-to-table | Code panel → **DBML** tab (`Ctrl+\` shows / hides it; the arrow tab on its edge steps through open → full screen → closed, and stays visible when closed). Typing updates the diagram live; editing the diagram rewrites the code. Invalid DBML never wipes the canvas — errors are shown inline with line/column. |
| Full DBML syntax | `Table`, `Ref` (all four operators, composite refs, `delete`/`update` actions, colours, names), `Enum`, `TableGroup`, `Note`, `Project`, `indexes { }`, `checks { }`, column notes/defaults/expressions/`increment`/`unique`/`pk`, schemas, aliases, `headerColor`, `DiagramView`, `Dep` (lineage), `Records` (sample data) |
| **Diagram ⇄ code two-way sync** | Move/rename/relate on the canvas → code updates (260 ms). Edit code → canvas updates (550 ms). Positions and selection never rewrite your code. |
| Drag column → column to create a **foreign key** | Drag from any column handle to another table's column (or table header). The FK column is created if it does not exist. |
| **Table groups** | **Groups drawer** (the group icon in the tab row, after Enums; or search *groups*): every group as a card — colour, name, table count, **show on canvas**, **collapse to one card** (relationships stay connected), rename / colour / note, ungroup (the tables stay) — with its tables as chips you **drag between groups** or back to *Not in a group* (also *Add a table…* and *Add selected*). *New group* starts from the tables selected on the canvas (searchable checklist, colour). On the canvas: select tables (Ctrl+click, or Shift+drag a box) and a **selection bar** offers **Group** (**Ctrl+G**) — name a new group or add them to an existing one; **drop a table onto a group's frame** to add it (the frame lights up while you're over it). When grouping would draw a frame over tables that aren't in the group, the group's tables are gathered side by side in free space first; a table taken out of the middle of a group moves just below its frame. Every change is one undo step. Drag the frame to move everything. Exported as `TableGroup`. |
| **Sticky notes** | Bottom toolbar → **sticky note** button: a note in the middle of the visible canvas, selected and ready to type into (double-click a note to edit it again). Colours, exported as DBML `Note`. Double-clicking empty canvas does nothing. |
| **Diagram views** (paid) | Sidebar → **Views**. Named subsets of tables; switch instantly; saved with the diagram; exported as `DiagramView`. |
| **Data lineage / dependencies** | **Lineage drawer** (the branch icon in the tab row, or search *lineage*): a **flow map** of every table that takes part, in stages — *Sources → Transforms → Outputs* — click a table to **trace** everything upstream and downstream of it on the canvas; the list of dependencies (`orders.total → daily_revenue.amount`) with show-on-canvas, delete, and columns / note when you open one. **Draw dependency** mode: lines you drag between tables (or columns) become dashed lineage arrows instead of foreign keys, from where the drag starts to where it ends; Esc or *Done* stops it. *Add manually* (upstream / downstream table and column, swap). With exactly two tables selected, the selection bar's **Link as dependency** opens that form filled in. Also DBML `Dep:`; clicking a column on the canvas traces it too. |
| **Relationship types** 1:1, 1:N, N:M with crow's-foot notation, optional ends, referential actions | Click a relationship → a small toolbar appears on the line (1:1 · 1:N · N:M, delete, and **···** for the full Inspect panel); it keeps the same on-screen size at any zoom. N:M is exported through a junction table. |
| **Enums** | The list button in the tab row, next to the version-history clock (or search *Enums*) — create/rename/reorder values, notes). Enum names are valid column types and show in autocomplete. |
| **Templates** (28 real-world schemas) | **DesignDB** menu (click the logo) → *New sample diagram* ▸ opens any of them in a new tab (*Browse all templates…* for previews) — or the templates icon in the tab row, which can also merge one into the current diagram. |
| **Multiple diagrams (tabs)** | Tab bar. Each tab keeps its own diagram, code, views and history. Copy/paste tables **between tabs**. |
| **Save / open** | Saving lives in the editor: a **save status** at the right of the top bar (the **AI** on/off switch is first in the menu row: on opens the AI panel, off closes it) (*Not saved → Save*, *Unsaved changes*, *Saving…*, *Saved · 2 min ago*, *Save failed · Retry*). The first save is deliberate (the button, `Ctrl+S` or DesignDB ▾ → Save); after that every change **autosaves** 1.6 s after the last edit, and switching tabs or leaving the editor saves what is pending (closing the browser tab warns). Explicit saves also keep a version-history snapshot. The **DesignDB** menu (the logo — there is no separate File menu) holds *Dashboard*, *New diagram*, *New sample diagram* ▸, *My diagrams* ▸ (opens a diagram in its own tab, or switches to it), *Save diagram* and *Version history…*. |
| **Workspace dashboard** | A large panel over the editor, like dbdiagram.io's (DesignDB ▾ → Dashboard; `/dashboard` opens it too; × / Esc / a click on the editor around it closes it): every saved diagram as a card with a drawn **thumbnail** of the diagram, *Edited 2 hours ago*, the database engine and its table / relationship / view counts — or as a list. **Search** looks in names, table names and column names (and says where it matched); filter by engine; sort by last modified, name, creation or size. Each card's **•••** menu: open, rename, duplicate, export SQL / DBML, delete. **New schema** ▾: blank canvas, import SQL/DBML, generate with AI, or a template (a *Templates* section with live previews). Everything opens in the editor right behind the panel. Sidebar: *All diagrams*, *Edited this week*, *Templates*, and the diagrams open in the editor. With no diagrams yet, the page is onboarding (three ways to start + samples). Design notes: [DASHBOARD.md](DASHBOARD.md). |
| **Version history** (paid) | DesignDB ▾ → *Version history*, or the clock button in the tab row. A drawer docked on the right of the canvas (below the top bar; it takes turns with Inspect and the AI audit, and the minimap button and bottom toolbar move left of it). Automatic snapshots (idle, on save, before import/AI/restore) and named manual snapshots, grouped Today / Yesterday / Previous 7 days / Earlier. Click a snapshot to **preview it live on the canvas** (read-only): a banner over the visible canvas shows its name and age with **Restore this version** and **Exit preview**. Per row: restore (your current state is saved first), fork into a new tab, rename, delete. Esc closes (and exits a preview). Stored locally in IndexedDB. |
| **Share links** | Share → *Link*: the diagram lives **inside the URL** (compressed DBML — nothing uploaded). Optional **password** (AES-256-GCM, key derived with PBKDF2 — encrypted in your browser). View-only viewer or "open in editor". |
| **Embed** | Share → *Embed*: `<iframe>` snippet for `/embed#…` (theme, size, layout). |
| **Publish** (public / password / private) | Share → *Publish*: stable `/share/<slug>` page; update it later with the edit token kept in your browser. *Private* hides the page (404) without deleting it. Passwords are stored as scrypt hashes. |
| **Auto arrange** (auto layout) | Bottom toolbar → arrange button (also the Inspect drawer) opens *Choose auto arrange algorithm*: **Domains** (the default for new and generated diagrams: each table group — or, without groups, each cluster of tables joined by foreign keys — flows left to right in its own block, tall columns wrap, and the blocks are packed into a widescreen grid with related blocks side by side and hub tables such as tenants/users first; a 30-table schema fits a 16:9 screen at ~50 % zoom instead of ~15 % with plain Left-right), **Left-right** (along foreign keys), **Pipeline** (left-to-right lineage stages; each table group is a stage, its tables stacked), **Snowflake** (most connected tables in the centre, neighbours in rings), **Compact** (tight rectangle), **Top-bottom** (parents above children) — keys 1–6. There is no View menu: fit view and relationship style are in the bottom toolbar, templates, version history, enums, diagram views and grid in the second row, show relationships and colours in the workspace settings (the side drawer's *Inspect* tab with nothing selected — open it from *Diagram views* in the tab row). There is no settings gear or Tools menu either: reverse engineering and database conversion are under Import. A confirmation pops up on the canvas above the button (Enter confirms, Esc cancels); the result is one undo step (Ctrl+Z). Table groups stay together, so frames never overlap other tables. Showing / hiding relationship lines is in the workspace settings → *Show relationships*. |
| **Detail levels** | Bottom bar: table names / keys only / all fields. |
| **Semantic zoom** | Zoomed out, cards show what can still be read: below 70 % only primary and foreign keys (+ *N more columns*), below 35 % just the table name in large type with its column count, and group names float above their frames. It never shows more than the detail level you picked, and cards keep their size, so frames and lines don't move as you zoom. |
| **Hub connections** | In diagrams with 12+ tables, a table that most others reference (tenants, users, or any table with 8+ referrers and ≥25 % of tables pointing at it) is a *hub*: its lines are hidden by default, and each referencing table shows a small tab on its top edge instead (🔑 tenant, 👤 user, ◎ other hub; click it to jump to the hub). Selecting a table shows its hub lines; the bottom-bar ◎ button (or workspace settings → *Show hub connections*) shows them all. The hub itself is marked *hub · N*. |
| Export images, PDF, SQL, docs | See section 1. |
| **Programmatic conversion** (CLI / API equivalent) | `POST /api/convert` — see section 5. |
| **AI assistant** | The **AI** switch (first in the top bar) docks a chat panel to the left of the code editor: *Welcome to DesignDB AI* with one-click suggestions — **Create Table Groups**, **Add Timestamp Columns**, **Add Relationships**, **Add Indexes** (offline and instant, each shown as a diff you apply or discard; *More quick actions* adds primary keys, snake_case and type remap) and **Learn Database Design** — plus a message box (*Enter* sends, *Shift+Enter* adds a line) for plain-language edits (needs `GROQ_API_KEY`). Every change — quick action or chat — is a **proposal you review before anything touches your diagram**, shown identically in three places at once (dbdiagram.io-style): a *Schema changes* summary and line diff in the chat message; the **same diff full-size in the DBML code editor**, with its own Accept/Reject so you can review from wherever you're looking; and, once accepted, the affected tables flash a **coloured border + New/Mod badge on the canvas** for a few seconds so you can see exactly what the AI built. **+** starts a new chat, the clock lists earlier chats for this diagram, **✕** closes the panel. "Generate with AI" in the New schema dialog opens the panel and sends your description straight away. |

## 3. ERDLab features

| Feature | Where / how |
|---|---|
| **Reverse engineering** | Import → *Reverse engineer…* — SQLite file (in browser via sql.js), **live PostgreSQL / MySQL** (server reads catalog metadata only, read-only), or paste a DDL dump (guides for pg_dump, mysqldump, SSMS, Oracle DBMS_METADATA, Snowflake GET_DDL). |
| **Database conversion** (MySQL → PostgreSQL, Oracle → BigQuery …) | Import → *Convert between databases…* (or search *convert*): paste DDL from one database, get DDL for another with mapped data types (preview + warnings). |
| **Auto-layout** | See above. |
| **Colours** — table header colours, **show/hide by colour** | Inspect → header colour; workspace settings → *Colours & visibility* (or search *colour*) for show / hide by colour |
| **Show / hide relationships**, relationship style toggle | Show / hide in the workspace settings (also *Show hub connections*); style in the bottom bar. |
| **Documentation generator** | Export → Documentation: HTML (with embedded diagram) or Markdown, and a print-to-PDF button — tables, columns, keys, relations, enums, notes, table of contents. |
| **Sample data** editor + export | Inspect → *Sample data*; export as CSV (zip) or `INSERT` statements / DBML `Records`; the SQL playground seeds from it. |
| **SQL playground** (live SQL against the design) | Bottom toolbar → database icon. Real SQLite (WebAssembly, in a background worker) built from exactly the DDL the SQLite export produces — keys, constraints, enum checks, foreign keys and their ON DELETE / ON UPDATE actions are enforced — seeded with your sample data or generated, foreign-key-consistent rows. Docks under the canvas at its full width (the canvas shrinks and keeps its centre; drag the edge to resize; the AI chat and code editor fold away while it is open and slide back — with their text intact — when it closes, and reopening one hides the playground until it is closed again) or goes full screen as a three-pane IDE (**⤢** / `Alt+Enter`; `Esc` or *Back to ERD canvas* returns): live schema tree (click or drag names into the editor, preview rows, show on canvas), SQL editor with schema-aware autocomplete (`Ctrl+Enter` runs everything or the selection; a failing statement is underlined), and a results grid with one tab per result set and copy-as-TSV. Runaway queries can be stopped; *Diagram changed · Re-sync* appears when the design moves on. Architecture and wireframes: [SQL_PLAYGROUND.md](SQL_PLAYGROUND.md). |
| **Full SQL scripts** for 9 databases | Export → SQL: DROP / IF NOT EXISTS, inline vs `ALTER TABLE` foreign keys, indexes, comments, seed data. Cyclic FKs automatically become `ALTER TABLE`. |
| **NoSQL export** | Export → *DBML · JSON · MongoDB* — MongoDB collections with JSON-Schema validators. |
| **Multiple databases / schemas** | Schema field per table (`schema.table`), views can filter by schema. |
| **Search** | `Ctrl+K` — tables, columns, groups, notes, enums and commands (type `>`). |
| **Shortcuts, undo/redo** | `?` (or Help → *All keyboard shortcuts…*) opens the cheat sheet — General, Canvas, Panels and notes, Code editor, SQL playground, Dashboard; the Help menu lists the main ones. Both read one list (`src/components/Canvas/shortcuts.ts`), and show ⌘ / ⌥ on a Mac. Undo/redo covers diagram *and* enums/groups/views. |
| **Delete confirmations** | Every delete asks first and names what goes — *You're deleting table **customers**. Are you sure?* (with its relationships), *…group **sales*** (its tables stay), *…the **1:N** relationship from **customers** to **orders*** (with the joined columns), *…the note “…”*, or a count for a multi-selection. Same for the keyboard (Delete / Backspace), the table / note / group trash buttons, the relationship toolbar, the Inspect drawer, views, enums, saved diagrams, versions, AI chats and unpublishing a share link. From a button it points at that button; from the keyboard it is a centred dialog. Enter deletes, Esc keeps; on the canvas the deletion is one undo step. Rows inside an editor (columns, indexes, constraints, enum values) don't ask — they only apply when you save. |
| **AI Architecture Audit** | Bottom toolbar → ✨ (the *AI Audit* button). A drawer docked to the right of the canvas (it no longer covers the diagram) runs 8 deterministic checks and groups what it finds by severity — **Critical**: no primary key, foreign key type differs from the key it references; **Warning**: repeating groups like phone1/phone2 (1NF), columns copied from a parent table (3NF), foreign keys without an index (skipped for MySQL/MariaDB, which index them automatically), `_id` columns with no relationship; **Suggestion**: missing created_at/updated_at, mixed camelCase/snake_case. Each card has **Focus** (selects the tables and pans/zooms to them, centred in the space the drawer leaves) and **✨ Auto-Fix** (an exact change to the model — one undo step, positions kept). *Interactive Wizard* walks through the issues one by one (Skip / Previous); *Audit Log* lists them all with counts, *Fix all* per severity and a log of the fixes applied. *Auto-Fix all* also fixes whatever its own fixes introduce. Results follow the diagram live after the first scan; with nothing left: *No active warnings* and **Run Full Scan**. |

## 4. Working with the canvas

* **Inspect** (a full-height side drawer flush with the right edge, next to *Add* and *Views*; open it with the gear button or a **···** on a group / relationship — the minimap steps aside for it). Selecting something on the canvas never opens or closes the panel by itself — if it is open, it simply shows whatever you select; if not, groups and relationships give you quick actions right on the canvas (a pencil popover on the group title bar — it floats above the tables at any zoom — and a toolbar on the relationship line), each with a **···** that opens the full panel. Select a table, relationship, dependency, sticky note or
  group frame and its properties appear here — one consistent layout (identity card → contents → a collapsed
  *Advanced* section for rarely-used fields → delete) for every kind, so the panel stays scannable how ever much
  a selection can do. Table: name, schema, group, colour, note, columns (with PK/FK/unique/not-null flags),
  duplicate. Relationship: endpoints, cardinality and appearance up front; key mapping, referential actions and
  optionality under *Advanced*. Nothing selected shows an empty-state hint plus the diagram-wide settings
  (project name, database, grid, table opacity/typography).
* **Table editor** (double-click a table): columns with any type (datalist for the chosen database + your enums),
  PK / unique / not null / increment / default / note / colour, FK targets, indexes, checks. Renaming a column
  updates every relationship that uses it, and existing relationship settings are kept.
* **Copy / paste** tables (`Ctrl+C/X/V`) — also as DBML text on the system clipboard, so you can paste them into
  the code editor or another diagram.
* **Minimap** is a small floating map button you open and minimise yourself (a minimise button sits in the map's
  corner); the choice is remembered in this browser. It works the same whether or not the AI or code panel is open —
  only its position changes: bottom-right beside the toolbar when there is room, or just *above* the toolbar when
  the canvas is cramped (AI panel, code panel or Inspect drawer leaving it narrower than ~1080px). On very narrow canvases the bottom toolbar also drops its "Detail level" text label so it stays inside
  the canvas.

## 5. HTTP API (for scripts and CI)

```bash
# SQL (any dialect) → DBML
curl -X POST localhost:3000/api/convert -H 'content-type: application/json' \
  -d '{"from":"sql","to":"dbml","input":"CREATE TABLE t (id INT PRIMARY KEY);","raw":true}'

# DBML → SQL Server
curl -X POST localhost:3000/api/convert -H 'content-type: application/json' \
  -d '{"from":"dbml","to":"sql","dialect":"mssql","input":"Table a { id int [pk] }","raw":true}'
```

`from`: `auto | dbml | sql | prisma | django | rails | mermaid | json` · `to`: `dbml | sql | json | mongodb | markdown | html | svg` ·
`dialect`: `postgres | mysql | sqlite | mssql | oracle | snowflake | bigquery | redshift | databricks` · `raw: true` returns the
converted text instead of JSON.

| Route | Purpose |
|---|---|
| `POST /api/convert` | Format / dialect conversion (above) |
| `POST /api/share`, `GET/POST/PUT/DELETE /api/share/[slug]` | Publish, read (POST with `{password}` for protected), update / delete with the edit token |
| `POST /api/reverse-engineer` | Live PostgreSQL / MySQL introspection. Enabled by default in development; in production it needs `ALLOW_LIVE_DB_CONNECT=true` (`false` disables it everywhere) |
| `POST /api/ai-assistant` | LLM edits (needs `GROQ_API_KEY` in `frontend/.env`) |
| `/api/projects`, `/api/projects/save`, `/api/projects/[id]` | Saved projects (nodes, edges and `meta`: enums, groups, views) |

### Rate limits

Every API route is rate-limited per client IP (`src/lib/server/rateLimit.ts`; `tests/rateLimit.test.ts` fails if a
route handler is not wrapped). Sliding-window counters, in this server process's memory — correct for one server;
with several instances each keeps its own counts, so move the store to Redis before scaling out.

| Group | Routes | Limit per IP |
|---|---|---|
| auth | `POST/PUT/DELETE /api/share/[slug]` (share password, edit token) | 5 per 15 min; successful requests are refunded, so only failures count. 10 failures within an hour lock the group for 30 min |
| ai | `/api/generate`, `/api/ai-assistant`, `/api/ai-query` | 10 per min and 100 per day; plus 60 per min across all clients (`RATE_LIMIT_AI_GLOBAL_PER_MIN`, sized to the Groq plan) |
| upload | `POST /api/share` (publish), `POST /api/reverse-engineer` | 10 per hour |
| write | project save (autosave), rename, duplicate, delete | 60 per min |
| read | project lists and loads, `GET /api/share/[slug]`, `/api/convert`, `/api/audit`, `/api/download*` | 60 per min |
| all | every route | 2,000 per hour |

Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (epoch seconds, end of the
current window). A refusal is `429` with `Retry-After` and `{ "error": { "code": "RATE_LIMIT_EXCEEDED", "message",
"retryAfter" } }`; the app shows it as "Too many requests. Try again in 40 s." (`src/lib/apiError.ts`). Clients that
keep hitting limits are penalised progressively: 3 refusals in 5 min double the wait, 10 in 15 min block the IP on every
route for 1 h, and a second block within a day lasts 24 h. Violations are logged as JSON warnings (`rate_limit.*`).
When Groq itself refuses (its own 429, or 413 for a request over the tokens-per-minute budget) the AI routes answer
`503` `AI_BUSY` with `Retry-After` and never pass on Groq's message.

| Variable | Default | Meaning |
|---|---|---|
| `TRUST_PROXY_HOPS` | `1` | Reverse proxies in front of the app that append to `X-Forwarded-For`; the client IP is the entry before them. Run behind a proxy in production — without one a client can set its own `X-Forwarded-For`. |
| `RATE_LIMIT_ALLOWLIST` | — | Comma-separated IPs that are never limited |
| `RATE_LIMIT_INTERNAL_TOKEN` | — | Requests sending this value as `x-internal-token` are never limited (service-to-service calls) |
| `RATE_LIMIT_AI_GLOBAL_PER_MIN` | `60` | AI calls per minute across all clients |
| `RATE_LIMIT_DISABLED` | — | `true` turns limiting off |

### Caching

Server-side caches (`src/lib/server/cache.ts`): one TTL + LRU cache per domain (entry and size caps, hit / miss /
eviction counters, `cacheStats()`), keys `cache:<domain>:<id>`. Values are ready-to-send strings, so a hit does no JSON
work. Concurrent identical misses share one load. Invalidation is exact for one server process (the same assumption as
SQLite and the rate limiter); with several instances, move to Redis or set `CACHE_DISABLED=true`.

| Data | Key | TTL | Invalidation |
|---|---|---|---|
| Project list (`GET /api/projects`) | `cache:projects:list:<userId>` | 5 min | Every project write: save, rename, duplicate, delete (prefix delete of all lists) |
| One project (`GET /api/projects/[id]`) | `cache:projects:item:<id>` | 5 min | Deleted on that project's save / rename / delete |
| Published diagram (`/api/share/[slug]`) | `cache:share:<slug>` | 5 min | Write-through on update; deleted on unpublish |
| `POST /api/convert`, `POST /api/audit` results | `cache:convert:<hash>`, `cache:audit:<hash>` | 30 min | None needed: pure functions of the request body |
| `POST /api/generate` (new diagram from a prompt) | `cache:ai:generate:<hash>` | 24 h | Keyed by prompt + a hash of the system prompt and examples; `"fresh": true` skips the cached copy. Production only unless `CACHE_AI=true` |

Every invalidation also stops reads that were already in flight from storing what they read, so a load racing a save
can't put old data back. Errors are never cached.

HTTP headers (`src/lib/server/httpCache.ts`): `GET /api/convert` (usage) is `public, max-age=300, s-maxage=600,
stale-while-revalidate=60`. Shared diagrams are `public, max-age=0, must-revalidate`: always revalidated, so
unpublishing or adding a password takes effect at once and every view is counted. Project lists and projects are
`private, max-age=0, must-revalidate` with `Vary: Authorization, Cookie`. All three carry an ETag, and `If-None-Match`
gets `304 Not Modified`. Every other API response is `no-store` (the default applied by the route wrapper).
`X-Cache: HIT | MISS` shows server-cache use.

On start (`src/instrumentation.ts`, background, at most 10 s) the 20 most-viewed published diagrams and the project lists
of the 5 most recently active users are loaded. AI results are not warmed, because each would be a paid Groq call.

## 6. Code map

```
src/lib/model/      DiagramModel, canvas adapter, display graph (views/groups, hidden hub lines), hub detection, merge, diff, lineage
src/lib/layout.ts   auto arrange algorithms (domains = default, LR, TB, pipeline, snowflake, compact)
src/lib/lod.ts      semantic zoom thresholds for table cards
src/lib/dbml/       DBML parser (error-tolerant) + serializer
src/lib/sql/        dialects & type mapping, SQL parser, SQL/Mongo exporters
src/lib/import/     one entry point for every import format (+ Prisma parser)
src/lib/export/     SVG renderer, PNG/PDF, zip, Mermaid
src/lib/docs/       HTML / Markdown documentation
src/lib/share/      DBML-in-link codec (deflate, AES-GCM)
src/lib/versions/   IndexedDB version store
src/lib/reverse/    SQLite / live / catalog → model
src/lib/templates/  28 template schemas
src/hooks/useCanvasSync.ts   canvas ⇄ code ⇄ SQL sync, undo, copy/paste, tool API
src/components/Tools/        Export, Share, Versions, Templates, Convert, Reverse, AI, Enums, Colours
```

## 7. Verification & limits

* `npm test` — 320 unit tests (DBML parser/serializer round trips, SQL import/export for every dialect, canvas
  adapter, sharing codec, docs, templates, Prisma / Django / Rails import, the AI generation pipeline — normaliser,
  validator, SQL and Mermaid output, with generated SQLite DDL executed on a real SQLite engine — the API routes, rate
  limiting and caching). Groq is stubbed at `fetch` and the database by an in-memory stand-in, so the suite needs no
  network, API key or database. One test is marked todo: rejecting AI replies cut off at the token limit needs an
  output budget sized to the Groq plan. `npx tsc --noEmit`, `npm run lint` and `next build` are clean.
* Coverage: `npx tsx --test --experimental-test-coverage --test-coverage-include="src/**" tests/*.test.ts` (Node's
  built-in coverage). Not unit-tested: React hooks and components (no DOM renderer is set up), the SQL playground's
  Web Worker, the IndexedDB version store, and the live introspection queries (they need a real server).
* **Live PostgreSQL / MySQL introspection has not been run against a real server** in this repo's tests — the
  catalog → model mapping is unit-tested with fixtures, the SQLite path is exercised end to end. Try it on a
  local database before relying on it.
* Publishing stores diagrams in the app's own database (`SharedDiagram`); there is no account system, so the edit
  token in your browser is what authorises updates.
* The AI assistant needs a `GROQ_API_KEY`; without it the offline quick actions still work.
* PNG/PDF export is rendered by the app's own SVG renderer — fonts are the system's; very large diagrams are
  scaled down to stay within browser canvas limits.
