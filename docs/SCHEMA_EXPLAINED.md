# schema_mysql.sql Explained: Quick Reference

## What is schema_mysql.sql?

**TL;DR:** It's the database schema that **stores metadata about ERD projects** that users create in DesignDB. It's not the schema users design—it's the schema that runs the DesignDB app itself.

---

## The Two Different "Schemas"

### Schema A: `schema_mysql.sql` (What DesignDB Stores)
```
This is THE METADATA DATABASE - it stores information ABOUT database designs.

Example:
User creates a "Blog System" design in DesignDB
↓
DesignDB stores that design in schema_mysql.sql:
  - projects table: Stores project name, user, description
  - entities table: Stores "posts", "comments", "users"
  - attributes table: Stores "post_id", "title", "content"
  - relationships table: Stores FK connections
```

### Schema B: User's Exported Schema (What Users Get)
```
This is what the user DOWNLOADS from DesignDB.

Example:
User clicks "Export SQL"
↓
DesignDB exports:
  CREATE TABLE users (user_id INT PRIMARY KEY, name VARCHAR(255), ...);
  CREATE TABLE posts (post_id INT PRIMARY KEY, user_id INT, title VARCHAR(500), ...);
  ...
```

---

## 6-Table Structure of schema_mysql.sql

| Table | Purpose | Example Data |
|-------|---------|--------------|
| **users** | DesignDB app users (who designs) | `user_id=1, username="john_dev"` |
| **projects** | ERD projects created by users | `project_id=1, title="Blog System"` |
| **schemas** | Schema versions (multiple versions per project) | `schema_id=1, version=1, is_normalized=true` |
| **entities** | Tables in the user's design | `entity_id=1, entity_name="posts"` |
| **attributes** | Columns in those tables | `attr_name="post_id", data_type="INTEGER"` |
| **relationships** | Foreign keys between tables | `from="posts", to="users", type="many-to-one"` |

---

## ERD of schema_mysql.sql

```
USER (1)
  │
  └──(1:M)──→ PROJECT (M)
               │
               └──(1:M)──→ SCHEMA (M)
                           │
                           ├──(1:M)──→ ENTITY (M)
                           │            │
                           │            └──(1:M)──→ ATTRIBUTE (M)
                           │
                           └──(1:M)──→ RELATIONSHIP (M)
                                       └──(M)──→ ENTITY (M)
                                       └──(M)──→ ENTITY (M)
                                       (references from_entity and to_entity)
```

---

## Backend Flow: How It All Works

```
1. USER INPUT (Frontend)
   "Design a blog system with posts, comments, and users"
   ↓
   
2. API ENDPOINT (/api/generate)
   POST request with { prompt, projectId }
   ↓
   
3. ORCHESTRATION
   a) Call analyze_requirements.ts (LLM extraction)
      → Extract entities, attributes, relationships
   b) Call normalize_schema.ts (3NF validation)
      → Decompose schema if needed
   c) Call generate_mermaid.ts (diagram gen)
      → Create visual representation
   ↓
   
4. DATABASE STORAGE (schema_mysql.sql)
   Save to:
   - projects: { title, description, user_id }
   - schemas: { schema_name, version, is_normalized }
   - entities: { entity_name, description }
   - attributes: { attr_name, data_type, constraints }
   - relationships: { rel_type, foreign_key, referenced_key }
   ↓
   
5. FRONTEND DISPLAY
   - Render Mermaid diagram on canvas
   - Show entities in sidebar
   - Enable export options (SQL, PNG)
```

---

## File Organization

### Backend Files (Execution Layer)
```
execution/
├── analyze_requirements.ts      ← LLM prompt → JSON schema
├── normalize_schema.ts          ← Raw schema → 3NF schema
├── generate_mermaid.ts          ← Schema → Mermaid.js code
├── export_sql.ts                ← Schema → SQL DDL
└── utils/
    ├── logger.ts
    └── schema_validator.ts
```

### Frontend (Orchestration Layer)
```
frontend/src/
├── app/api/
│   ├── generate/route.ts        ← Main endpoint (orchestrates all)
│   ├── projects/save/route.ts   ← Saves to DB
│   ├── download/route.ts        ← Exports SQL
│   └── download-png/route.ts    ← Exports diagram as PNG
│
├── lib/
│   └── execution/               ← Duplicated scripts here (shared)
│       ├── analyze_requirements.ts
│       ├── normalize_schema.ts
│       ├── generate_mermaid.ts
│       └── export_sql.ts
│
└── components/
    └── Canvas/
        └── Canvas.tsx           ← Displays the diagram
```

### Database
```
data/
├── schema_mysql.sql             ← Production schema
├── schema_postgres.sql          ← PostgreSQL version
└── schema_sqlite.sql            ← SQLite version

frontend/prisma/
├── schema.prisma                ← Prisma ORM schema
└── dev.db                       ← Development SQLite DB
```

---

## Key Relationships Explained

### 1️⃣ User → Project (1-to-Many)
```
A single user can create multiple projects.

SQL:
SELECT p.title, p.description
FROM projects p
WHERE p.user_id = 1;

Result:
- "Blog System"
- "E-Commerce Platform"
- "University Enrollment"
```

### 2️⃣ Project → Schema (1-to-Many)
```
A project can have multiple schema versions.

SQL:
SELECT s.version, s.is_normalized
FROM schemas s
WHERE s.project_id = 1
ORDER BY s.version DESC;

Result:
- Version 3 (is_normalized=true)
- Version 2 (is_normalized=false, decomposed)
- Version 1 (is_normalized=false, raw)
```

### 3️⃣ Schema → Entities (1-to-Many)
```
A schema contains multiple entities (tables).

SQL:
SELECT e.entity_name, COUNT(a.attribute_id) as attr_count
FROM entities e
LEFT JOIN attributes a ON e.entity_id = a.entity_id
WHERE e.schema_id = 1
GROUP BY e.entity_id;

Result:
- posts (4 attributes)
- users (5 attributes)
- comments (3 attributes)
```

### 4️⃣ Entity → Attributes (1-to-Many)
```
A table has multiple columns.

SQL:
SELECT attr_name, data_type, is_primary_key, is_nullable
FROM attributes
WHERE entity_id = 1;

Result:
- post_id (INTEGER, PK, NOT NULL)
- title (VARCHAR(500), NOT NULL)
- content (TEXT, NULL)
- user_id (INTEGER, FK, NOT NULL)
```

### 5️⃣ Schema → Relationships (1-to-Many)
```
A schema has multiple FK relationships between entities.

SQL:
SELECT 
  e1.entity_name as from_table,
  e2.entity_name as to_table,
  r.rel_type
FROM relationships r
JOIN entities e1 ON r.from_entity_id = e1.entity_id
JOIN entities e2 ON r.to_entity_id = e2.entity_id
WHERE r.schema_id = 1;

Result:
- posts → users (many-to-one)
- comments → posts (many-to-one)
- comments → users (many-to-one)
```

---

## API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/generate` | POST | Generate schema from natural language |
| `/api/projects/save` | POST | Save project to database |
| `/api/projects` | GET | List all projects for a user |
| `/api/projects/[id]` | GET | Get detailed project schema |
| `/api/download?projectId=X&dialect=mysql` | GET | Export schema as SQL |
| `/api/download-png?projectId=X` | GET | Export diagram as PNG |

---

## Execution Flow: Step-by-Step

```typescript
// 1. Frontend sends prompt
const response = await fetch('/api/generate', {
  method: 'POST',
  body: JSON.stringify({
    prompt: "Design a blog system",
    projectId: "cuid_123"
  })
});

// 2. /api/generate orchestrates:

// 2a. ANALYZE REQUIREMENTS
const rawSchema = await analyzeRequirements(prompt);
// Result: { entities: [...], relationships: [...] }

// 2b. NORMALIZE SCHEMA
const normalizedSchema = await normalizeSchema(rawSchema);
// Result: 3NF-compliant schema (possibly decomposed)

// 2c. GENERATE MERMAID
const mermaidCode = await generateMermaid(normalizedSchema);
// Result: "erDiagram\n  USERS ||--o{ POSTS : creates\n..."

// 2d. SAVE TO DATABASE
const saved = await prisma.project.upsert({
  where: { id: projectId },
  create: {
    userId: currentUser.id,
    title: "Blog System",
    rawPrompt: prompt,
    nodesJson: JSON.stringify(normalizedSchema.entities),
    edgesJson: JSON.stringify(normalizedSchema.relationships)
  }
});

// 2e. RETURN RESPONSE
return Response.json({
  success: true,
  entities: normalizedSchema.entities,
  relationships: normalizedSchema.relationships,
  mermaidCode: mermaidCode
});

// 3. Frontend receives and renders on canvas
```

---

## Why This Architecture?

```
┌─────────────────────────────────────────────────────────┐
│ Benefits of the 3-Layer Architecture                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Layer 1: FRONTEND (React/Next.js)                      │
│ ✓ Handles UI/UX (canvas, sidebar, forms)              │
│ ✓ Manages user interactions                            │
│ ✓ Makes HTTP requests to backend                       │
│                                                         │
│ Layer 2: ORCHESTRATION (API Routes)                    │
│ ✓ Routes requests to correct execution scripts         │
│ ✓ Coordinates multi-step workflows                     │
│ ✓ Handles error management                             │
│ ✓ Manages database transactions                        │
│                                                         │
│ Layer 3: EXECUTION (Deterministic Scripts)             │
│ ✓ LLMs are probabilistic → need reusable prompts      │
│ ✓ Algorithms are deterministic → guaranteed results   │
│ ✓ Can be tested independently                          │
│ ✓ Can be swapped (e.g., use different LLM)           │
│                                                         │
│ Layer 4: DATABASE (Metadata Store)                     │
│ ✓ Persists all project data                            │
│ ✓ Enables version control                              │
│ ✓ Supports multi-user scenarios                        │
│ ✓ Allows history/audit trails                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Example Workflow: Blog System

```
INPUT:
"I need a blog system with posts by authors, 
 comments on posts, and user ratings"

↓ ANALYZE REQUIREMENTS

ENTITIES DETECTED:
- users (id, name, email)
- posts (id, user_id, title, content)
- comments (id, post_id, user_id, text)
- ratings (id, post_id, user_id, score)

RELATIONSHIPS DETECTED:
- users (1) → posts (M): one user creates many posts
- posts (1) → comments (M): one post has many comments
- users (1) → comments (M): one user can comment on many posts
- users (1) → ratings (M): one user can rate many posts
- posts (1) → ratings (M): one post can have many ratings

↓ NORMALIZE SCHEMA

CHECK 1NF: ✓ (all values are atomic)
CHECK 2NF: ✓ (no partial dependencies on composite keys)
CHECK 3NF: ✓ (no transitive dependencies detected)

Result: SCHEMA IS VALID 3NF

↓ GENERATE MERMAID

erDiagram
    USERS ||--o{ POSTS : creates
    USERS ||--o{ COMMENTS : writes
    USERS ||--o{ RATINGS : gives
    POSTS ||--o{ COMMENTS : receives
    POSTS ||--o{ RATINGS : receives

↓ SAVE TO DATABASE

projects table:
  project_id=1, user_id=1, title="Blog System", is_public=false

schemas table:
  schema_id=1, project_id=1, version=1, is_normalized=true

entities table:
  entity_id=1, schema_id=1, entity_name="users"
  entity_id=2, schema_id=1, entity_name="posts"
  entity_id=3, schema_id=1, entity_name="comments"
  entity_id=4, schema_id=1, entity_name="ratings"

attributes table:
  (40+ rows describing all columns)

relationships table:
  rel_id=1, from_entity=1, to_entity=2, rel_type="one-to-many", fk="user_id"
  (4+ more relationships)

↓ RENDER ON FRONTEND

Display:
✓ Interactive Mermaid diagram with Crow's Foot notation
✓ Entity cards in sidebar showing attributes
✓ Relationship details
✓ Export buttons (SQL, PNG)

↓ USER EXPORTS AS SQL

CREATE TABLE users (
  user_id INTEGER AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
  post_id INTEGER AUTO_INCREMENT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_posts_user_id FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

(... more tables and constraints ...)
```

---

## Summary

| Question | Answer |
|----------|--------|
| **What is schema_mysql.sql?** | Database schema that stores DesignDB project metadata |
| **What does it store?** | Users, projects, entities, attributes, relationships |
| **Who creates data in it?** | The backend when users generate ERD designs |
| **How many tables?** | 6 tables: users, projects, schemas, entities, attributes, relationships |
| **Is it the user's schema?** | No, it's the metadata about the user's schema |
| **Where's the user's schema?** | Exported as SQL or stored in nodesJson/edgesJson fields |
| **Role in backend?** | Central store for all project data, enables multi-user, versioning, persistence |
| **Dev vs Production?** | SQLite (dev) or MySQL/PostgreSQL (prod), same structure |

