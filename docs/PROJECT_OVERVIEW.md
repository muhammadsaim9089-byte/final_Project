# DesignDB — Project Overview

## Summary
- **Purpose:** DesignDB converts natural-language requirements into normalized database schemas (3NF), produces ER diagrams (Mermaid), and exports SQL DDL for multiple dialects. It also provides an interactive ERD canvas to edit, inspect, run live SQLite queries, and persist design projects.

## Functionalities & Features
- Natural-language schema generation (prompt or API) — outputs normalized schema JSON, Mermaid ER syntax, SQL DDL (multi-dialect), and a normalization report.
- Deterministic normalization (1NF → 2NF → 3NF) with heuristics and automatic surrogate primary-key injection when needed.
- Schema validation using `zod` to catch malformed LLM outputs before applying changes.
- Interactive ERD canvas with drag-and-drop table creation, column edits, inline rename, duplicate, delete, and multi-select operations.
- Relationship creation and editing with cardinality (1:1, 1:N, N:M), FK assignment, and on-delete/on-update cascade rules.
- SQL import (paste raw DDL) to reverse-engineer a canvas and SQL export for PostgreSQL, MySQL and SQLite (downloadable files and clipboard copy).
- Mermaid diagram generation and PNG/PNG-download of the rendered canvas.
- In-browser SQL sandbox (sql.js) to build schema from the canvas, seed deterministic sample rows, run queries, and export query results as CSV.
- Project-level persistence and management (save, load, duplicate, delete) via Prisma-backed local SQLite storage.
- Deterministic seed-data and CSV generation for testing and demoing schemas.
- CLI scripts for pipeline tasks (`execution/*`) including exporters, mermaid generation, seed generation and a test pipeline.
- JSONL logging to `.tmp/logs/` for reproducible runs and audit trails.

## Frontend UI — Screens & Controls
The UI is a single-page app with focused screens and reusable components; key screens and controls are listed below with their primary responsibilities and component locations.

### Primary screens
- Home / Prompt: enter natural-language prompts, choose templates, or start from examples. Component: [frontend/src/components/Home/PromptBox.tsx](frontend/src/components/Home/PromptBox.tsx).
- Canvas / Editor: the main ERD editor with toolbar, canvas view, and inspector sidebar. Component: [frontend/src/components/Canvas/Canvas.tsx](frontend/src/components/Canvas/Canvas.tsx).
- Project Dashboard: list and manage saved projects (open, duplicate, export, delete). Component: [frontend/src/components/Canvas/Dashboard.tsx](frontend/src/components/Canvas/Dashboard.tsx).

### Common controls (visible across screens)
- Top header / toolbar: project title, `Save`, `Export` (SQL/PNG), `Undo` / `Redo`, `Auto-layout`, `Zoom` controls. See: [frontend/src/components/Canvas/CanvasToolbar.tsx](frontend/src/components/Canvas/CanvasToolbar.tsx).
- Left dock / Add panel: drag-in table templates, quick add table, import DDL action. See: [frontend/src/components/ui/floating-dock.tsx](frontend/src/components/ui/floating-dock.tsx).
- Bottom prompt bar: chat-like input for regenerating or mutating schema and applying changes to the canvas.

### Node (table) interactions
- Select / multi-select nodes (marquee selection) and move them freely on the canvas.
- Double-click or inline edit to rename a table; inline edit for column names and types.
- Add / remove columns with the `+` / `–` controls; attribute type dropdown and modifiers (NOT NULL, UNIQUE, DEFAULT).
- Toggle `PK` / `FK` badges on attributes. Component: [frontend/src/components/Canvas/Nodes/TableNode.tsx](frontend/src/components/Canvas/Nodes/TableNode.tsx).
- Node context menu: duplicate, delete, center-on-screen, export single-table SQL.

### Edge & relationship interactions
- Draw FKs by dragging from a column or table to another table; edit cardinality (1:1, 1:N, N:M) in the inspector.
- Visual styles: Crow's-Foot and Pulse edge renderers. Components: [frontend/src/components/Canvas/Edges/CrowsFootEdge.tsx](frontend/src/components/Canvas/Edges/CrowsFootEdge.tsx) and [frontend/src/components/Canvas/Edges/PulseEdge.tsx](frontend/src/components/Canvas/Edges/PulseEdge.tsx).
- Relationship editor in the `Inspector` tab allows setting `onDelete`/`onUpdate` rules and FK constraint names.

### Inspector / Unified Sidebar
- Tabs: `Add` (templates), `Inspector` (selected node/edge properties), `SQL` (preview & import). Component: [frontend/src/components/Canvas/UnifiedSidebar.tsx](frontend/src/components/Canvas/UnifiedSidebar.tsx).
- Inspector fields: table name, columns list (name, type, PK, FK, nullable, unique, default, index), relationships, and JSON export for the node.

### SQL Sandbox
- Open the in-browser SQL sandbox to `Build from canvas` (construct schema in sql.js), `Seed sample data`, and `Run query` in a SQL editor. Component: [frontend/src/components/Canvas/SqlSandbox.tsx](frontend/src/components/Canvas/SqlSandbox.tsx).
- Results are shown in a tabular grid with CSV export and copy-to-clipboard actions.

### Import / Export flows
- `Import DDL` modal: paste SQL DDL to parse into nodes/columns/relationships and apply to canvas.
- `Export` menu: choose dialect (Postgres, MySQL, SQLite), download SQL file, copy to clipboard, or download PNG of the current canvas. Server routes used: [frontend/src/app/api/download/route.ts](frontend/src/app/api/download/route.ts) and [frontend/src/app/api/download-png/route.ts](frontend/src/app/api/download-png/route.ts).

### Project actions & dashboard
- Save project (title, nodesJson, edgesJson, prompt) to Prisma-backed DB. API: [frontend/src/app/api/projects/save/route.ts](frontend/src/app/api/projects/save/route.ts).
- Project list shows quick-actions: Open, Duplicate, Export SQL, Export PNG, Delete. API: [frontend/src/app/api/projects/route.ts](frontend/src/app/api/projects/route.ts).

### UX details & shortcuts
- Staggered reveal animations on large graphs for smoother rendering.
- Local autosave of canvas state (session/localStorage) before explicit save to server.
- Keyboard shortcuts: `Ctrl+Z` Undo, `Ctrl+Y` Redo, `Ctrl+S` Save, `Delete` to remove selected nodes/edges, arrow keys to nudge selection.
## Quick Run (developer)
- **Generate DDL (all dialects):**

```bash
npx ts-node execution/run_export_sql.ts
```

- **Generate seed CSVs:**

```bash
npx ts-node execution/generate_seed_data.ts
```

- **Run end-to-end test pipeline (mock):**

```bash
npx ts-node execution/test_pipeline.ts
```

- **Frontend (Next.js) dev:**

```bash
cd frontend
npm install
npm run dev
```

## High-level Architecture
- **LLM-based analysis (probabilistic):** Extracts entities, attributes and relationships from plain text using adapter scripts.
- **Deterministic pipeline (TypeScript):** Validation, normalization to 3NF, Mermaid generation and SQL export are deterministic TS programs.
- **Interactive frontend:** Next.js + React + React Flow canvas for visual editing, with in-browser SQLite sandbox and save/load via Prisma.

## Backend / Execution Scripts (what they do)
- **`execution/analyse_requirements.ts`**: Calls a generative model (Gemini via `@google/generative-ai`) to convert natural language into a JSON schema, then validates with `execution/utils/schema_validator.ts`.
- **`execution/normalize_schema.ts`**: Deterministic normalization passes (1NF, 2NF, 3NF) using heuristics and generates a normalization report.
- **`execution/generate_mermaid.ts`**: Converts normalized schema into Mermaid ER diagram syntax.
- **`execution/export_sql.ts`**: Produces SQL DDL for `postgres`, `mysql`, and `sqlite` with options for `DROP`, `ALTER TABLE` for cyclic FKs, and CHECK constraints.
- **`execution/run_export_sql.ts`**: Example script that defines the application schema and writes `data/schema_<dialect>.sql` files.
- **`execution/generate_seed_data.ts`**: Produces deterministic CSV seed files under `data/csv/` (users, projects, schemas, entities, attributes, relationships).
- **`execution/test_pipeline.ts`**: Small E2E mock pipeline combining normalization → Mermaid → SQL generation to validate flows.
- **Utilities:**
  - `execution/utils/schema_validator.ts` — Zod-based schema validation and TypeScript types.
  - `execution/utils/logger.ts` — Simple JSONL logger writing to `.tmp/logs/`.

## Frontend (how it works)
- Project root for the UI: [frontend](frontend)
- App uses Next.js app-router under [frontend/src/app](frontend/src/app).
- Key flow: home `PromptBox` → user prompt saved to sessionStorage → navigate to `/canvas` → `Canvas` reads prompt and POSTs to `/api/generate`.

### Server API endpoints (Next.js server routes)
- `POST /api/generate` ([frontend/src/app/api/generate/route.ts](frontend/src/app/api/generate/route.ts)):
  - Orchestrates analysis (LLM wrapper), normalization, Mermaid generation and SQL export.
  - Returns: `{ schema, mermaid, sql, report }`.
- `GET /api/projects` ([frontend/src/app/api/projects/route.ts](frontend/src/app/api/projects/route.ts)):
  - Lists saved projects from Prisma-backed DB (SQLite).
- `POST /api/projects/save` ([frontend/src/app/api/projects/save/route.ts](frontend/src/app/api/projects/save/route.ts)):
  - Upserts a project (title, nodes, edges, raw prompt) to Prisma DB.
- `GET|DELETE|POST /api/projects/[id]` ([frontend/src/app/api/projects/[id]/route.ts](frontend/src/app/api/projects/[id]/route.ts)):
  - Fetch, delete, or duplicate a project by id.
- `POST /api/download` and `POST /api/download-png` ([frontend/src/app/api/download/route.ts](frontend/src/app/api/download/route.ts), [frontend/src/app/api/download-png/route.ts](frontend/src/app/api/download-png/route.ts)):
  - Return file responses (binary) for SQL or PNG exports.

### Frontend features and components
- **Canvas & Visual Editor** ([frontend/src/components/Canvas/Canvas.tsx](frontend/src/components/Canvas/Canvas.tsx)):
  - Renders entities as draggable nodes, relationships as edges, auto-layout via `dagre`.
  - Chat-like prompt at bottom to mutate or generate schema using `/api/generate`.
  - Staggered reveal UI when rendering large graphs for visual polish.

- **Nodes & Edges**:
  - `TableNode` ([frontend/src/components/Canvas/Nodes/TableNode.tsx](frontend/src/components/Canvas/Nodes/TableNode.tsx)): displays attributes, PK/FK badges and hover interactions.
  - `CrowsFootEdge` and `PulseEdge` ([frontend/src/components/Canvas/Edges](frontend/src/components/Canvas/Edges)): two edge styles including Crow's-Foot notation.

- **Unified Sidebar** ([frontend/src/components/Canvas/UnifiedSidebar.tsx](frontend/src/components/Canvas/UnifiedSidebar.tsx)):
  - Tabs: Add, Inspector, SQL Code (preview & import).
  - Add: spawn tables from templates or custom columns.
  - Inspector: edit a node's columns, rename table, duplicate, delete, configure relationship cardinality and cascade rules.
  - SQL: preview generated SQL, copy to clipboard, or paste raw DDL to import (reverse-engineer into canvas).

- **SqlSandbox** ([frontend/src/components/Canvas/SqlSandbox.tsx](frontend/src/components/Canvas/SqlSandbox.tsx)):
  - In-browser SQLite powered by `sql.js` (`/public/sql-wasm.js`) to build schema from the canvas, seed sample rows, and run arbitrary SQL queries (SELECT, JOINs, GROUP BY, etc.).

- **Project Dashboard** ([frontend/src/components/Canvas/Dashboard.tsx](frontend/src/components/Canvas/Dashboard.tsx)):
  - List, load, duplicate, delete and save projects via server APIs and Prisma.

- **Prompt & Onboarding**:
  - `PromptBox` ([frontend/src/components/Home/PromptBox.tsx](frontend/src/components/Home/PromptBox.tsx)) is the entry point for natural-language input.
  - `CanvasLoader` prefetches and improves perceived performance when switching to canvas.

## Data, DB and Persistence
- **Prisma (frontend/prisma/schema.prisma):** local SQLite DB schema with `User` and `Project` models. See [frontend/prisma/schema.prisma](frontend/prisma/schema.prisma).
- **Sample DDL & CSVs:** `execution/run_export_sql.ts` writes `data/schema_mysql.sql`, `data/schema_postgres.sql`, `data/schema_sqlite.sql`.
- **Seed CSVs:** `data/csv/*.csv` are produced by `generate_seed_data.ts` (users.csv, projects.csv, schemas.csv, entities.csv, attributes.csv, relationships.csv).

## Validation & Safety
- **Schema validation:** both backend and frontend use `zod` validators in `*/utils/schema_validator.ts` to ensure the LLM output matches the expected structure.
- **Deterministic normalizer:** the normalization engine (`normalize_schema.ts`) uses deterministic heuristics (1NF/2NF/3NF passes), auto-adds surrogate PKs when missing, and produces a human-readable normalization report.

## Environment & Secrets
- **LLM keys:**
  - `execution/analyse_requirements.ts` expects `GEMINI_API_KEY` in environment for the Gemini-based workflow.
  - `frontend/src/lib/execution/analyse_requirements.ts` expects `GROQ_API_KEY` (Groq/Groq SDK) for the frontend server-run path.
- **Prisma dev DB:** the frontend Prisma datasource points to `file:./dev.db` by default.

## Files of Interest (quick links)
- Execution core: [execution/analyse_requirements.ts](execution/analyse_requirements.ts) | [execution/normalize_schema.ts](execution/normalize_schema.ts) | [execution/export_sql.ts](execution/export_sql.ts) | [execution/generate_mermaid.ts](execution/generate_mermaid.ts)
- Frontend server glue: [frontend/src/app/api/generate/route.ts](frontend/src/app/api/generate/route.ts)
- Canvas UI: [frontend/src/components/Canvas/Canvas.tsx](frontend/src/components/Canvas/Canvas.tsx)
- Sidebar & SQL import/export: [frontend/src/components/Canvas/UnifiedSidebar.tsx](frontend/src/components/Canvas/UnifiedSidebar.tsx)
- In-browser SQL sandbox: [frontend/src/components/Canvas/SqlSandbox.tsx](frontend/src/components/Canvas/SqlSandbox.tsx)
- Prisma schema: [frontend/prisma/schema.prisma](frontend/prisma/schema.prisma)

## Developer notes & next steps
- To reproduce generation locally, set the required API keys in environment (`.env` or `.env.local`), run the execution scripts or start the frontend dev server and use the prompt on the homepage.
- The system is intentionally split: LLM adapters live both under `execution/` (Gemini) and `frontend/src/lib/execution` (Groq) — choose which integration to use and set the corresponding env var.
- If you want I can:
  - Add a short README with exact env var examples and `npm` commands.
  - Produce a diagram of the request flow (Prompt → /api/generate → normalization → canvas).

---

Generated summary of the repository on 2026-06-23.
