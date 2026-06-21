# Backend Architecture: Visual Diagrams & Reference

## 🎯 The Core Concept

```
╔══════════════════════════════════════════════════════════════════════╗
║                         DesignDB Architecture                        ║
╚══════════════════════════════════════════════════════════════════════╝

┌──────────────────────────────────────────────────────────────────────┐
│ WHAT IS schema_mysql.sql?                                            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  It's the METADATA DATABASE SCHEMA for DesignDB itself.             │
│                                                                      │
│  Think of it like this:                                             │
│                                                                      │
│  DesignDB is a tool that lets users design databases.              │
│  When users create designs, DesignDB needs to store them.          │
│  schema_mysql.sql defines HOW DesignDB stores that data.           │
│                                                                      │
│  ┌─ User creates a Blog System design                              │
│  │  (entities: posts, users, comments)                             │
│  │  ↓                                                               │
│  │  DesignDB stores it in schema_mysql.sql:                        │
│  │  ├─ projects table: Blog System project info                    │
│  │  ├─ entities table: posts, users, comments                      │
│  │  ├─ attributes table: post_id, title, user_id, etc.            │
│  │  └─ relationships table: FK connections                         │
│  │  ↓                                                               │
│  │  User exports as SQL:                                           │
│  │  ├─ CREATE TABLE posts (...)                                    │
│  │  ├─ CREATE TABLE users (...)                                    │
│  │  └─ CREATE TABLE comments (...)                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 📊 The 6-Table Metadata Model

```
                            ┌─────────────┐
                            │   USERS     │
                            │             │
                            │ • user_id   │
                            │ • username  │
                            │ • email     │
                            │ • role      │
                            └──────┬──────┘
                                   │ 1:M
                                   │
                            ┌──────▼──────┐
                            │ PROJECTS    │
                            │             │
                            │ • project_id│
                            │ • user_id ──┼──(FK)
                            │ • title     │
                            │ • description
                            │ • created_at│
                            └──────┬──────┘
                                   │ 1:M
                                   │
                            ┌──────▼──────────┐
                            │   SCHEMAS      │
                            │                │
                            │ • schema_id    │
                            │ • project_id ──┼──(FK)
                            │ • version      │
                            │ • is_normalized│
                            │ • created_at   │
                            └────┬────────┬──┘
                                 │        │
                         1:M      │        │  1:M
                                 │        │
                    ┌────────────▼┐  ┌───▼──────────┐
                    │  ENTITIES   │  │RELATIONSHIPS │
                    │             │  │              │
                    │ • entity_id │  │ • rel_id     │
                    │ • schema_id─┼──┼─ • schema_id─┼──(FK)
                    │ • name      │  │ • from_entity┼──(FK)
                    │ • description│ │ • to_entity──┼──(FK)
                    │             │  │ • rel_type   │
                    └────┬────────┘  │ • foreign_key│
                         │           └──────────────┘
                    1:M  │
                         │
                    ┌────▼────────────┐
                    │  ATTRIBUTES     │
                    │                 │
                    │ • attribute_id  │
                    │ • entity_id ────┼──(FK)
                    │ • attr_name     │
                    │ • data_type     │
                    │ • is_primary_key│
                    │ • is_nullable   │
                    │ • is_unique     │
                    └─────────────────┘
```

---

## 🔄 Request-Response Cycle

```
┌──────────────────────────────────────────────────────────────────────┐
│                     USER INITIATES WORKFLOW                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  "Design a library system with books, authors, and borrowers"       │
│  ↓                                                                   │
│  [Generate Button Clicked]                                          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                ↓
┌──────────────────────────────────────────────────────────────────────┐
│               FRONTEND: PromptBox.tsx                                │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  const handleGenerate = async () => {                               │
│    setLoading(true);                                                │
│    const response = await fetch('/api/generate', {                  │
│      method: 'POST',                                                │
│      body: JSON.stringify({                                         │
│        prompt: userInput,                                           │
│        projectId: projectId                                         │
│      })                                                             │
│    });                                                              │
│  }                                                                  │
│                                                                      │
│  STATUS: ⏳ Loading...                                               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                ↓
        ┌──────────────────────────────────────────────────────────┐
        │          HTTP POST /api/generate                         │
        │                                                          │
        │  Request Body:                                           │
        │  {                                                       │
        │    "prompt": "Design a library system...",              │
        │    "projectId": "cuid_abc123xyz"                        │
        │  }                                                       │
        └──────────────────────────────────────────────────────────┘
                                ↓
┌──────────────────────────────────────────────────────────────────────┐
│     API ROUTE: frontend/src/app/api/generate/route.ts               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  export async function POST(request: Request) {                     │
│    const { prompt, projectId } = await request.json();            │
│                                                                      │
│    // STEP 1: Validate                                              │
│    if (!prompt.trim().length) throw Error('Empty prompt');          │
│                                                                      │
│    // STEP 2-5: Call execution layer (see below)                   │
│  }                                                                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                ↓
    ┌───────────────────────────┬───────────────────────────┐
    │                           │                           │
    ▼                           ▼                           ▼
┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ STEP 2a: ANALYZE│  │  STEP 2b:        │  │  STEP 2c:        │
│ REQUIREMENTS    │  │  NORMALIZE       │  │  GENERATE        │
│                 │  │  SCHEMA          │  │  MERMAID         │
│ analyze_requir  │  │  normalize_schema│  │ generate_mermaid │
│ .ts             │  │  .ts             │  │  .ts             │
│                 │  │                  │  │                  │
│ Input:          │  │ Input:           │  │ Input:           │
│ "Design a       │  │ Raw schema with  │  │ Normalized 3NF   │
│  library..."    │  │ entities &       │  │ schema           │
│                 │  │ relationships    │  │                  │
│ Output:         │  │ Output:          │  │ Output:          │
│ {               │  │ {                │  │ erDiagram        │
│   entities: [   │  │   entities: [    │  │   BOOKS ||--o{   │
│     { name:     │  │     (decomposed) │  │   AUTHORS : ...  │
│     "books" }   │  │   ],             │  │                  │
│   ],            │  │   isNormalized:  │  │ Mermaid code     │
│   relationships │  │   true           │  │ ready for render │
│   : [...]       │  │ }                │  │ }                │
│ }               │  │                  │  │                  │
└─────────────────┘  └──────────────────┘  └──────────────────┘
    │                 │                      │
    └─────────────────┴──────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│           STEP 3: SAVE TO DATABASE (Prisma ORM)                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  const project = await prisma.project.upsert({                      │
│    where: { id: projectId },                                        │
│    create: {                                                        │
│      userId: currentUser.id,                                        │
│      title: "Library System",                                       │
│      rawPrompt: prompt,                                             │
│      nodesJson: JSON.stringify(normalizedSchema.entities),          │
│      edgesJson: JSON.stringify(normalizedSchema.relationships)      │
│    }                                                                │
│  });                                                                │
│                                                                      │
│  ↓ Saves to schema_mysql.sql (or SQLite in dev)                    │
│                                                                      │
│  projects table: INSERT { id, userId, title, ... }                 │
│  (entities/relationships stored as JSON strings)                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                ↓
┌──────────────────────────────────────────────────────────────────────┐
│          STEP 4: RETURN RESPONSE (JSON)                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Response.json({                                                    │
│    success: true,                                                   │
│    projectId: "cuid_abc123xyz",                                     │
│    entities: [                                                      │
│      { id: "e_1", name: "books", attributes: [...] },             │
│      { id: "e_2", name: "authors", attributes: [...] }            │
│    ],                                                               │
│    relationships: [                                                 │
│      { id: "r_1", from: "e_1", to: "e_2", type: "many-to-one" }   │
│    ],                                                               │
│    mermaidCode: "erDiagram\n..."                                    │
│  })                                                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                ↓
┌──────────────────────────────────────────────────────────────────────┐
│  FRONTEND: Receive JSON & Render                                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  const data = await response.json();                                │
│                                                                      │
│  setNodes(data.entities);         // For canvas drawing            │
│  setEdges(data.relationships);    // For canvas connections        │
│  setMermaidCode(data.mermaidCode); // For diagram render          │
│                                                                      │
│  ✅ CANVAS DISPLAYS:                                                │
│     ┌──────────┐     (many-to-many)    ┌──────────┐               │
│     │  BOOKS   │◄─────────────────────►│ AUTHORS  │               │
│     └──────────┘                        └──────────┘               │
│     ├─ book_id                         ├─ author_id               │
│     ├─ title                           ├─ name                    │
│     ├─ isbn                            └─ email                   │
│     └─ author_id(FK)                                               │
│                                                                      │
│  ✅ LEFT SIDEBAR: Shows entities & attributes                       │
│  ✅ RIGHT SIDEBAR: Allows editing                                   │
│  ✅ BUTTONS: Export SQL, Export PNG                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Data Persistence Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│           NORMALIZED SCHEMA (in memory)                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  {                                                                   │
│    entities: [                                                      │
│      { name: "books", attributes: ["book_id", "title", ...] },    │
│      { name: "authors", attributes: ["author_id", "name", ...] }, │
│      { name: "borrowers", attributes: [...] }                      │
│    ],                                                               │
│    relationships: [...]                                             │
│  }                                                                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                ↓
                        JSON.stringify()
                                ↓
┌──────────────────────────────────────────────────────────────────────┐
│           PROJECTS TABLE (schema_mysql.sql)                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────┬──────────┬──────────┬─────────────┬──────────────────┐ │
│  │ proj_id│ user_id  │ title    │ nodesJson   │ edgesJson        │ │
│  ├────────┼──────────┼──────────┼─────────────┼──────────────────┤ │
│  │ 1      │ 1        │ Library  │ "[{name:... │ "[{from:'e_1'... │ │
│  │        │          │ System   │   ...}]"    │ ...}]"           │ │
│  └────────┴──────────┴──────────┴─────────────┴──────────────────┘ │
│                                                                      │
│  Alternative: Normalized storage in separate tables:               │
│  ┌─ SCHEMAS table                                                   │
│  │ ├─ ENTITIES table (books, authors, borrowers)                   │
│  │ ├─ ATTRIBUTES table (book_id, title, author_id, etc.)          │
│  │ └─ RELATIONSHIPS table (FK constraints)                         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                ↓
                        On Export Request
                                ↓
┌──────────────────────────────────────────────────────────────────────┐
│         USER'S EXPORTED SCHEMA (SQL DDL)                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  CREATE TABLE books (                                               │
│    book_id INT AUTO_INCREMENT PRIMARY KEY,                          │
│    title VARCHAR(500) NOT NULL,                                    │
│    isbn VARCHAR(20) UNIQUE,                                         │
│    author_id INT NOT NULL,                                          │
│    FOREIGN KEY (author_id) REFERENCES authors(author_id)            │
│      ON DELETE CASCADE ON UPDATE CASCADE                             │
│  );                                                                 │
│                                                                      │
│  CREATE TABLE authors (                                             │
│    author_id INT AUTO_INCREMENT PRIMARY KEY,                        │
│    name VARCHAR(255) NOT NULL,                                      │
│    email VARCHAR(255) UNIQUE,                                       │
│    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP                   │
│  );                                                                 │
│                                                                      │
│  CREATE TABLE borrowers (                                            │
│    borrower_id INT AUTO_INCREMENT PRIMARY KEY,                      │
│    name VARCHAR(255) NOT NULL,                                      │
│    email VARCHAR(255),                                              │
│    membership_date DATE DEFAULT CURDATE()                           │
│  );                                                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 🔀 Normalization Validation Flow

```
┌────────────────────────────────────────────────────┐
│ RAW SCHEMA (from LLM)                              │
│ May contain:                                       │
│ • Denormalized data                                │
│ • Repeating groups                                 │
│ • Composite attributes                             │
│ • Partial/transitive dependencies                  │
└─────────────────┬──────────────────────────────────┘
                  │
                  ▼
        ┌─────────────────────────┐
        │ normalize_schema.ts     │
        └─────────────────────────┘
                  │
      ┌───────────┼───────────┐
      │           │           │
      ▼           ▼           ▼
┌───────────┐ ┌───────────┐ ┌───────────┐
│  CHECK 1NF│ │  CHECK 2NF│ │  CHECK 3NF│
│           │ │           │ │           │
│ Atomic    │ │ No        │ │ No        │
│ values?   │ │ partial   │ │ transitive│
│ No repeating
 │ deps?    │ │ deps?     │
│ groups?   │ │           │ │           │
└───────────┘ └───────────┘ └───────────┘
      │           │           │
      └───────────┴───────────┘
                  │
                  ▼
        ┌─────────────────────────┐
        │ VALIDATION RESULT       │
        ├─────────────────────────┤
        │ ✓ PASSED (is 3NF)       │
        │   Return schema as-is   │
        │                         │
        │ ✗ FAILED                │
        │   Decompose tables      │
        │   Create new entities   │
        │   Return corrected      │
        └─────────────────────────┘
```

---

## 🎨 How Frontend Displays the Data

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CANVAS.TSX COMPONENT                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │  FloatingHeader (Home button, project title)            │       │
│  └─────────────────────────────────────────────────────────┘       │
│                                                                     │
│  ┌──────────────┐  ┌──────────────────────────┐  ┌──────────────┐  │
│  │   Left       │  │                          │  │    Right     │  │
│  │  Sidebar     │  │    INTERACTIVE CANVAS    │  │   Sidebar    │  │
│  │              │  │   (Mermaid Diagram)      │  │              │  │
│  │ • Projects   │  │                          │  │ • Edit Entity│  │
│  │ • Schemas    │  │   ┌─────────────┐        │  │ • Add Field  │  │
│  │ • Entities   │  │   │   BOOKS     │        │  │ • Delete     │  │
│  │              │  │   │             │        │  │ • Relationship
│  │              │  │   │ book_id(PK) │        │  │   settings   │  │
│  │              │  │   │ title       │◄───┐  │  │              │  │
│  │              │  │   │ author_id   │    │  │  │              │  │
│  │              │  │   │ (FK)        │    │  │  │              │  │
│  │              │  │   └─────────────┘    │  │  │              │  │
│  │              │  │         │            │  │  │              │  │
│  │              │  │         │many-to-one│  │  │              │  │
│  │              │  │         │            │  │  │              │  │
│  │              │  │   ┌─────▼─────┐     │  │  │              │  │
│  │              │  │   │ AUTHORS   │     │  │  │              │  │
│  │              │  │   │           │     │  │  │              │  │
│  │              │  │   │ author_id │─────┘  │  │              │  │
│  │              │  │   │ (PK)      │        │  │              │  │
│  │              │  │   │ name      │        │  │              │  │
│  │              │  │   └───────────┘        │  │              │  │
│  │              │  │                        │  │              │  │
│  │ [Download]   │  │  ┌─────────┬───────┐  │  │              │  │
│  │ [Export]     │  │  │ Export  │ Save  │  │  │              │  │
│  │              │  │  │  SQL    │       │  │  │              │  │
│  │              │  │  └─────────┴───────┘  │  │              │  │
│  └──────────────┘  └──────────────────────────┘  └──────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │  BottomPanel (Relationship details, constraints)        │       │
│  └─────────────────────────────────────────────────────────┘       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📝 Development Workflow

```
1. DEVELOPER VIEWS PROJECT
   ↓
2. FRONTEND LOADS
   └─ Reads from localStorage or fetches /api/projects/[id]
   ↓
3. CANVAS RENDERS
   └─ Convert nodesJson/edgesJson to React Flow nodes/edges
   └─ Render Mermaid diagram
   ↓
4. USER EDITS
   ├─ Add entity (RightSidebar)
   ├─ Modify attributes (LeftSidebar)
   ├─ Create/remove relationships (Edges)
   └─ Update in local state
   ↓
5. USER SAVES
   └─ POST /api/projects/save with updated nodesJson/edgesJson
   └─ Updates database
   ↓
6. USER EXPORTS
   ├─ GET /api/download?projectId=X&dialect=mysql
   │  └─ Returns .sql file
   │
   └─ GET /api/download-png?projectId=X
      └─ Returns .png image
```

---

## 🎯 Summary Table

| Layer | File | Responsibility |
|-------|------|-----------------|
| **UI** | Canvas.tsx, PromptBox.tsx | Display & interaction |
| **API** | /api/generate, /api/projects/save | Orchestration |
| **Logic** | analyze_requirements.ts | LLM extraction |
| **Logic** | normalize_schema.ts | 3NF validation |
| **Logic** | generate_mermaid.ts | Diagram generation |
| **Logic** | export_sql.ts | SQL export |
| **Database** | schema_mysql.sql | Metadata persistence |

---

## 🚀 Key Takeaways

1. **schema_mysql.sql** = App's internal metadata database (6 tables)
2. **Stores**: Projects, entities, attributes, relationships that users create
3. **NOT** the schema users design (that's exported separately)
4. **Backend** orchestrates: LLM → Normalization → Diagram → Export
5. **Frontend** displays the Mermaid diagram and allows editing
6. **Database** persists everything using Prisma ORM

