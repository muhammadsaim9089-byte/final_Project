# DesignDB Backend Architecture & Database Schema

## 📋 Quick Answer: What is `schema_mysql.sql`?

`schema_mysql.sql` is the **metadata database schema** that stores information about all ERD projects created by users in DesignDB. It is NOT the database schema that users design—it's the schema that powers the DesignDB application itself.

### The Key Distinction

```
┌─────────────────────────────────────────────────────────────┐
│ DesignDB Application (Backend)                              │
│                                                             │
│  Users create ERD projects → Stored in schema_mysql.sql    │
│                                                             │
│  Example: User designs a "Library Management" system       │
│           DesignDB stores the metadata in MySQL:           │
│           - Project name, description, user                │
│           - Entities (Books, Authors, Borrowers)           │
│           - Attributes (title, ISBN, author_name, etc.)    │
│           - Relationships (Book-Author, Borrower-Book)     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ User's Generated Database Schema (Export)                   │
│                                                             │
│  DesignDB exports user's design as SQL:                     │
│  - CREATE TABLE statements for PostgreSQL/MySQL/SQLite     │
│  - User can download and use in their own project          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Schema Explanation: `schema_mysql.sql`

### Table: `users`
Stores DesignDB application users.

```sql
users:
  - user_id (PRIMARY KEY) — unique identifier
  - username — login credential
  - email — contact & authentication
  - full_name — display name
  - role — permission level (admin, designer, viewer, editor)
  - created_at — registration timestamp
  - is_active — soft delete flag
```

**Purpose:** Authentication, authorization, user management.

---

### Table: `projects`
Stores ERD design projects created by users.

```sql
projects:
  - project_id (PRIMARY KEY) — unique identifier
  - user_id (FOREIGN KEY → users) — who owns this project
  - title — project name ("Library Management System")
  - description — what the project is about
  - is_public — visibility flag (shareable projects)
  - created_at / updated_at — timestamps
```

**Purpose:** Project management, tracking all designs per user.

---

### Table: `schemas`
Stores database schema versions for each project (supports versioning).

```sql
schemas:
  - schema_id (PRIMARY KEY) — unique schema version
  - project_id (FOREIGN KEY → projects) — which project
  - schema_name — internal schema identifier
  - version — version number (1, 2, 3, etc.)
  - is_normalized — did this pass 3NF validation?
  - dialect — target SQL dialect (mysql, postgresql, sqlite)
  - created_at — when this version was created
```

**Purpose:** Store multiple versions of the same design, track normalization status.

---

### Table: `entities`
Stores tables/entities designed within a schema.

```sql
entities:
  - entity_id (PRIMARY KEY) — unique identifier
  - schema_id (FOREIGN KEY → schemas) — which schema
  - entity_name — table name ("books", "authors", "borrowers")
  - description — what this entity represents
  - estimated_row_count — performance planning hint
```

**Purpose:** Define the tables that make up the schema.

---

### Table: `attributes`
Stores columns/attributes for each entity.

```sql
attributes:
  - attribute_id (PRIMARY KEY) — unique identifier
  - entity_id (FOREIGN KEY → entities) — which table
  - attr_name — column name ("book_id", "title", "isbn")
  - data_type — SQL type ("VARCHAR(255)", "INTEGER", "TIMESTAMP")
  - is_primary_key — is this the primary key?
  - is_nullable — can this column be NULL?
  - is_unique — must this be unique?
  - default_value — default value if provided
```

**Purpose:** Define the structure of each table (columns, types, constraints).

---

### Table: `relationships`
Stores foreign key relationships between entities.

```sql
relationships:
  - relationship_id (PRIMARY KEY) — unique identifier
  - schema_id (FOREIGN KEY → schemas) — which schema
  - from_entity_id (FOREIGN KEY → entities) — source table
  - to_entity_id (FOREIGN KEY → entities) — target table
  - rel_type — relationship cardinality (one-to-one, one-to-many, many-to-one, many-to-many)
  - foreign_key — column name of the FK in source table
  - referenced_key — column name in target table (usually PK)
  - on_delete — cascade behavior (CASCADE, RESTRICT, SET NULL, NO ACTION)
  - on_update — update behavior (CASCADE, RESTRICT, NO ACTION)
```

**Purpose:** Define how tables relate to each other (referential integrity).

---

## 🏗️ The 3-Layer Backend Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ LAYER 1: FRONTEND (React + Next.js)                                │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ • PromptBox: User enters natural language                    │   │
│ │ • Canvas: Displays Mermaid diagram of design                │   │
│ │ • LeftSidebar: Project/schema management                    │   │
│ │ • RightSidebar: Entity/attribute editing                    │   │
│ │ • API calls: /api/generate, /api/projects/save, etc.       │   │
│ └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
                                 ↓ HTTP Request
┌────────────────────────────────────────────────────────────────────┐
│ LAYER 2: ORCHESTRATION (Next.js API Routes + Directives)          │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ /api/generate                                                │   │
│ │ ├─→ Call analyze_requirements.ts (LLM)                      │   │
│ │ ├─→ Call normalize_schema.ts (3NF validation)               │   │
│ │ ├─→ Call generate_mermaid.ts (diagram gen)                  │   │
│ │ ├─→ Store in Prisma/Database                               │   │
│ │ └─→ Return JSON (entities, attributes, relationships)       │   │
│ │                                                              │   │
│ │ /api/projects/save                                           │   │
│ │ └─→ Save project to database                                │   │
│ │                                                              │   │
│ │ /api/download                                               │   │
│ │ ├─→ Call export_sql.ts (SQL generation)                     │   │
│ │ └─→ Return .sql file to user                                │   │
│ │                                                              │   │
│ │ /api/download-png                                           │   │
│ │ ├─→ Call generate_mermaid.ts                                │   │
│ │ ├─→ Render to PNG via Mermaid.ink API                       │   │
│ │ └─→ Return image to user                                    │   │
│ └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
                                 ↓
┌────────────────────────────────────────────────────────────────────┐
│ LAYER 3: EXECUTION (TypeScript Deterministic Scripts)             │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ execution/                                                   │   │
│ │ ├─ analyze_requirements.ts                                   │   │
│ │ │  └─→ Call OpenAI/Claude API                               │   │
│ │ │  └─→ Extract entities, attributes, relationships          │   │
│ │ │  └─→ Return structured JSON                               │   │
│ │                                                              │   │
│ │ ├─ normalize_schema.ts                                       │   │
│ │ │  └─→ Validate 1NF, 2NF, 3NF compliance                    │   │
│ │ │  └─→ Detect anomalies (transitive deps, partial deps)    │   │
│ │ │  └─→ Decompose tables if needed                           │   │
│ │ │  └─→ Return normalized schema                             │   │
│ │                                                              │   │
│ │ ├─ generate_mermaid.ts                                       │   │
│ │ │  └─→ Convert schema JSON → Mermaid.js syntax             │   │
│ │ │  └─→ Return .mmd string                                   │   │
│ │                                                              │   │
│ │ ├─ export_sql.ts                                             │   │
│ │ │  └─→ Generate CREATE TABLE for PostgreSQL/MySQL/SQLite   │   │
│ │ │  └─→ Add constraints, indexes, defaults                  │   │
│ │ │  └─→ Return .sql string                                   │   │
│ │                                                              │   │
│ │ └─ utils/                                                    │   │
│ │    ├─ logger.ts — logging                                   │   │
│ │    └─ schema_validator.ts — schema validation               │   │
│ └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
                                 ↓
┌────────────────────────────────────────────────────────────────────┐
│ DATABASE (Metadata Store)                                          │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ schema_mysql.sql (or SQLite for dev)                         │   │
│ │                                                              │   │
│ │ • Development: SQLite (prisma/dev.db)                        │   │
│ │ • Production: MySQL or PostgreSQL                           │   │
│ │                                                              │   │
│ │ Tables:                                                      │   │
│ │ ├─ users (app users)                                         │   │
│ │ ├─ projects (ERD projects)                                   │   │
│ │ ├─ schemas (schema versions)                                 │   │
│ │ ├─ entities (tables in design)                               │   │
│ │ ├─ attributes (columns in tables)                            │   │
│ │ └─ relationships (foreign keys)                              │   │
│ └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Complete Backend Workflow

### Step 1: User Submits Prompt
```
User Input: "I need a blog system with posts, comments, and users"
                                ↓
                    Frontend sends to /api/generate
```

### Step 2: API Route Receives Request
**File:** `frontend/src/app/api/generate/route.ts`

```typescript
POST /api/generate
{
  "prompt": "I need a blog system with posts, comments, and users",
  "projectId": "cuid_12345"
}
```

### Step 3: Orchestration Layer Processes
**File:** `frontend/src/lib/execution/` or `execution/` (backend)

**3a. Analyze Requirements** → `analyze_requirements.ts`
```
Input:  "blog system with posts, comments, and users"
Output: {
  entities: [
    { name: "users", attrs: ["user_id", "username", "email", ...] },
    { name: "posts", attrs: ["post_id", "title", "content", "user_id", ...] },
    { name: "comments", attrs: ["comment_id", "text", "post_id", "user_id", ...] }
  ],
  relationships: [
    { from: "users", to: "posts", type: "one-to-many" },
    { from: "posts", to: "comments", type: "one-to-many" },
    { from: "users", to: "comments", type: "one-to-many" }
  ]
}
```

**3b. Normalize Schema** → `normalize_schema.ts`
```
Input:  Schema from step 3a
Process: Validate 1NF, 2NF, 3NF compliance
         Check for transitive dependencies
         Check for partial dependencies
         Decompose if needed
Output: Normalized schema (guaranteed 3NF)
```

**3c. Generate Diagram** → `generate_mermaid.ts`
```
Input:  Normalized schema
Output: Mermaid.js syntax string
        
        erDiagram
          USERS ||--o{ POSTS : creates
          USERS ||--o{ COMMENTS : writes
          POSTS ||--o{ COMMENTS : receives
```

### Step 4: Store in Database
**File:** `frontend/src/app/api/generate/route.ts` or Prisma handler

```typescript
// Save to database using Prisma
const project = await prisma.project.create({
  data: {
    userId: "user_123",
    title: "Blog System",
    rawPrompt: "I need a blog system...",
    nodesJson: JSON.stringify(entities),    // Nodes = Entities
    edgesJson: JSON.stringify(relationships) // Edges = Relationships
  }
});

// The metadata is saved in schema_mysql.sql structure:
// projects table stores the project
// schemas table stores the version
// entities table stores users, posts, comments
// attributes table stores the columns
// relationships table stores the connections
```

### Step 5: Return to Frontend
```typescript
HTTP 200 OK
{
  projectId: "cuid_12345",
  entities: [...],
  attributes: {...},
  relationships: [...],
  mermaidCode: "erDiagram\n..."
}
```

### Step 6: Frontend Renders
- **Canvas:** Display Mermaid diagram
- **Left Sidebar:** Show project details
- **Right Sidebar:** Show entity/attribute editor
- **Download Button:** Allow export to SQL/PNG

---

## 📂 File Locations Reference

### Backend Files (Orchestration + Execution)

| File | Purpose |
|------|---------|
| `frontend/src/app/api/generate/route.ts` | Main API endpoint for LLM → schema generation |
| `frontend/src/app/api/projects/save/route.ts` | Save project to database |
| `frontend/src/app/api/download/route.ts` | Export schema as SQL |
| `frontend/src/app/api/download-png/route.ts` | Export diagram as PNG |
| `frontend/src/lib/execution/analyze_requirements.ts` | LLM-based requirements extraction |
| `frontend/src/lib/execution/normalize_schema.ts` | 3NF normalization validation |
| `frontend/src/lib/execution/generate_mermaid.ts` | Mermaid.js diagram generation |
| `frontend/src/lib/execution/export_sql.ts` | SQL export (PostgreSQL/MySQL/SQLite) |
| `execution/` | Root-level deterministic scripts (optional duplicate or shared) |

### Database

| File | Purpose |
|------|---------|
| `data/schema_mysql.sql` | **METADATA schema** for production MySQL |
| `data/schema_postgres.sql` | **METADATA schema** for PostgreSQL |
| `data/schema_sqlite.sql` | **METADATA schema** for SQLite |
| `frontend/prisma/schema.prisma` | Prisma ORM schema (current dev setup) |
| `frontend/prisma/dev.db` | SQLite database file (local development) |

---

## 🔑 Key Relationships

### How Data Flows Through the Database

```
User creates a project
    ↓
projects table (stores project metadata)
    ↓
schemas table (stores schema version)
    ├─→ entities table (stores each table in schema)
    │   └─→ attributes table (stores each column)
    │
    └─→ relationships table (stores FK connections between entities)
```

### Example: Blog System Query

```sql
-- Get all entities in a project's latest schema
SELECT e.entity_name, e.description
FROM projects p
JOIN schemas s ON p.project_id = s.project_id
JOIN entities e ON s.schema_id = e.schema_id
WHERE p.project_id = 1
  AND s.version = (SELECT MAX(version) FROM schemas WHERE project_id = 1);

-- Get all attributes of the "posts" entity
SELECT attr_name, data_type, is_primary_key
FROM attributes
WHERE entity_id = (SELECT entity_id FROM entities WHERE entity_name = 'posts');

-- Get relationships from "posts" to other entities
SELECT r.rel_type, e.entity_name
FROM relationships r
JOIN entities e ON r.to_entity_id = e.entity_id
WHERE r.from_entity_id = (SELECT entity_id FROM entities WHERE entity_name = 'posts');
```

---

## 🚀 Development vs. Production

| Aspect | Development | Production |
|--------|-------------|-----------|
| **Database** | SQLite (file-based) | MySQL/PostgreSQL (server) |
| **ORM** | Prisma (auto-migrates) | Prisma or raw SQL |
| **Storage** | `prisma/dev.db` | External database server |
| **Env File** | `.env.local` | `.env.production` |
| **Schema Migrations** | `prisma migrate dev` | `prisma migrate deploy` |

---

## 📊 Diagram: Complete Data Model

```mermaid
erDiagram
    USERS ||--o{ PROJECTS : creates
    PROJECTS ||--o{ SCHEMAS : contains
    SCHEMAS ||--o{ ENTITIES : defines
    SCHEMAS ||--o{ RELATIONSHIPS : specifies
    ENTITIES ||--o{ ATTRIBUTES : has
    ENTITIES ||--o{ RELATIONSHIPS : participates_in

    USERS : integer user_id
    USERS : string username
    USERS : string email
    USERS : string role

    PROJECTS : integer project_id
    PROJECTS : integer user_id FK
    PROJECTS : string title
    PROJECTS : text description

    SCHEMAS : integer schema_id
    SCHEMAS : integer project_id FK
    SCHEMAS : string schema_name
    SCHEMAS : integer version
    SCHEMAS : boolean is_normalized

    ENTITIES : integer entity_id
    ENTITIES : integer schema_id FK
    ENTITIES : string entity_name

    ATTRIBUTES : integer attribute_id
    ATTRIBUTES : integer entity_id FK
    ATTRIBUTES : string attr_name
    ATTRIBUTES : string data_type
    ATTRIBUTES : boolean is_primary_key

    RELATIONSHIPS : integer relationship_id
    RELATIONSHIPS : integer schema_id FK
    RELATIONSHIPS : integer from_entity_id FK
    RELATIONSHIPS : integer to_entity_id FK
    RELATIONSHIPS : string rel_type
```

---

## 💡 Summary

| Concept | Explanation |
|---------|-------------|
| **schema_mysql.sql** | Stores metadata about projects, entities, attributes, and relationships that users create |
| **Backend Role** | Orchestrates LLM calls, normalization, diagram generation, and SQL export |
| **3 Layers** | Frontend (UI) → Orchestration (API routes) → Execution (deterministic scripts) → Database |
| **User's Schema vs. App Schema** | Users design business schemas; the app uses `schema_mysql.sql` to store those designs |
| **Workflow** | Natural Language → Analyze → Normalize → Generate Diagram → Export SQL → Store in DB |

