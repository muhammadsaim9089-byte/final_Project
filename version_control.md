# DesignDB Version Control Documentation

This document maintains a chronological record of all builds, commits, and features implemented across both the `master` and `Features` branches of the DesignDB repository.

---

### Build 1 : ( v0.1.0-alpha.1 )
* **Commit ID**: `659e980893080fffe92cd34606b0d911e3b2e75e`
* **Features Implemented**:
  * Initialized the repository structure containing deterministic TypeScript scripts in `execution/` and standard directives/SOPs in `directives/`.
  * Implemented structured logging system (`execution/utils/logger.ts`) supporting info, warning, and error logs.
  * Designed strict type-safe schema validator using **Zod** (`execution/utils/schema_validator.ts`) for database entities, attributes, and relationships.
  * Drafted Standard Operating Procedures (SOPs) forrequirements analysis, table generation, and database normalization guidelines.

---

### Build 2 : ( v0.2.0-alpha.1 )
* **Commit ID**: `8afb0266014e304b4c735d45465c4900890f845d`
* **Features Implemented**:
  * Scaffolded Next.js 14 App Router project with TypeScript and Tailwind CSS (`frontend/`).
  * Established custom design token tokens (sentry-purple, lime-green, coral-accent, and HSL variables) and set up the `@font-face` configuration for the Vagnola font.
  * Configured **Vanta.js** animated background for interactive blue/purple fog effects.
  * Created the Prompt Input Box featuring glassmorphism styling and auto-fill presets.
  * Built the glassmorphic Canvas Loader overlay with custom SVG polyline heartbeat pulse.

---

### Build 3 : ( v0.2.0-beta.1 )
* **Commit ID**: `c55258cfbb1f4eb27339d67ef260682fa08d42d3`
* **Features Implemented**:
  * Implemented the deterministic 3NF Normalization Engine in execution scripts, analyzing candidate keys and functional dependencies.
  * Built the multi-dialect **SQL Export Engine** generating schema scripts for PostgreSQL, MySQL, and SQLite with topological sort resolving foreign keys.
  * Created the custom **Mermaid.js diagram generator** representing entity relationship cardinalities.

---

### Build 4 : ( v0.3.0-alpha.1 )
* **Commit ID**: `6b0c8033b00688f121ce1c793ff611c0f0fb5461`
* **Features Implemented**:
  * **Milestone 3 Deliverables**: Created synthetic CSV datasets (`users.csv`, `projects.csv`, `schemas.csv`, `entities.csv`, `attributes.csv`, `relationships.csv`) simulating real project interactions.
  * Authored system architecture and dataflow documentation detailing routing stages from user prompt input to final SQL export.
  * Programmed data cleaning scripts verifying foreign key integrity and unique user creation.

---

### Build 5 : ( v0.4.0-alpha.1 )
* **Commit ID**: `dbe9845ad4e8e815617a26fcd00ff2f0dfc83bb3`
* **Features Implemented**:
  * **Milestone 4 Deliverables**: Validated Enhanced Entity-Relationship (EER) diagrams and created production-ready DDL statements.
  * Formulated the database mapping structure for the main persistent user session schema (containing composite PKs and relational constraints).

---

### Build 6 : ( v0.4.0-beta.1 )
* **Commit ID**: `8313a9f02959828236d8d641154562479e0a2948`
* **Features Implemented**:
  * Added visual export actions directly to the React Flow canvas, allowing users to download schemas as Mermaid (`.mmd`), standard SQL scripts (`.sql`), or high-quality image (`.png`) formats.
  * Integrated server-side API endpoints responding with clean binary exports.

---

### Build 7 : ( v0.4.0-rc.1 )
* **Commit ID**: `17bda65181be38686d1b7ee9707e997f7422f2cb`
* **Features Implemented**:
  * Merged features from the `master` branch upstream into `Features`.
  * Consolidated export button assets and Next.js TS configurations to prevent divergence.

---

### Build 8 : ( v0.5.0-alpha.1 )
* **Commit ID**: `8828b17849929844be8066f1fc9a77ef7d8b5c92`
* **Features Implemented**:
  * Completed user interface visual pass integrating custom layout themes, border colors, and accent selectors on canvas components.
  * Programmed the Right Sidebar with comprehensive schema property editors, dialect settings, and opacity controllers.
  * Embedded glassmorphism panel styles, customized themed scrollbars, and dynamic animated border styles inside dashboard cards.

---

### Build 9 : ( v0.5.0-beta.1 )
* **Commit ID**: `2c0978ceb6ed0dc172345a19bf1bfd0038439f74`
* **Features Implemented**:
  * **Milestone 5 Deliverables**: Integrated Supabase PostgreSQL database instances and configured Prisma ORM client with Next.js database pooling.
  * Designed the `/api/projects/save` API route for serializing visual ReactFlow states as binary JSONB objects.
  * Built the **Cursor Spotlight** tracking mouse coordinates with a custom `requestAnimationFrame` canvas overlay to render glowing interactive dots.
  * Configured mock validation feedback inside the header Validate controls.

---

### Build 10 : ( v0.6.0 )
* **Commit ID**: `a5ddaa28a506822c608ee85ca9505c2a11b619fe`
* **Features Implemented**:
  * Fixed typo (**`PostgeSQL`** -> **`PostgreSQL`**) in repository commit messages and verified absolute documentation accuracy.
  * Finalized Milestone 5 publication and synced branch commits.

---

### Build 11 : ( v0.7.0 )
* **Commit ID**: `df8e89f81a7b8e5c54be89aa94101e4a64ef811e`
* **Features Implemented**:
  * Resolved the Canvas Loader premature "back navigation" bug by transitioning to `router.replace` navigation and standardizing durations to prevent premature fade-outs.
  * Replaced yellow/lime canvas grid dots and cursor highlights with the custom brand purple (`#5045a8`).
  * Removed the **"View SQL Code"** tab from the React Flow canvas bottom panel, maintaining all underlying query states, props, and schema functionalities perfectly while hiding the UI element from end-users.
  * Changed the left side floating dock icons, active circles, borders, and glowing drop shadows to match the custom brand blue (`#4A90D9`) extracted from the "DB" text gradient.
  * Styled the "Create Elements" (`LeftSidebar`) header icon, active navigation tabs, quick field pills, input focus borders, and all submit buttons ("Create Input Table", "Create Computed View", and "Create Table") to use the unified brand blue (`#4A90D9`) with premium light grey-silver text (`#C9C8C7`) replacing standard dark and purple colors.
  * Relocated the **"AI Insights"** (Architecture Audit) panel from the bottom panel of the canvas to the left-side vertical floating dock, complete with automated layout shifting that keeps the insights drawer from overlapping with the "Create Elements" sidebar when both are open.
