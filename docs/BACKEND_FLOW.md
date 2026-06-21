# Backend Data Flow & API Endpoints

## 🔄 Complete Request-Response Cycle

### Request Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ USER ACTION                                                             │
│                                                                         │
│ 1. User enters natural language prompt in PromptBox                    │
│    Example: "Design a university enrollment system with students,     │
│              courses, and professors"                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ FRONTEND LAYER (React/Next.js)                                         │
│ File: frontend/src/components/Home/PromptBox.tsx                       │
│                                                                         │
│ const handleGenerate = async () => {                                   │
│   const response = await fetch('/api/generate', {                      │
│     method: 'POST',                                                    │
│     body: JSON.stringify({                                             │
│       prompt: userInput,                                               │
│       projectId: currentProject.id                                     │
│     })                                                                 │
│   });                                                                  │
│   const schema = await response.json();                                │
│   setNodes(schema.entities);      // For canvas display               │
│   setEdges(schema.relationships); // For canvas connections           │
│ }                                                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓
        ┌──────────────────────────────────────────────────────────────┐
        │ HTTP POST Request                                            │
        │ URL: /api/generate                                           │
        │ Body:                                                        │
        │ {                                                            │
        │   "prompt": "Design a university enrollment system...",      │
        │   "projectId": "cuid_abc123xyz"                             │
        │ }                                                            │
        └──────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ API ORCHESTRATION LAYER (Next.js API Route)                            │
│ File: frontend/src/app/api/generate/route.ts                           │
│                                                                         │
│ export async function POST(request: Request) {                         │
│   const { prompt, projectId } = await request.json();                 │
│   try {                                                                │
│     // Step 1: Analyze requirements                                   │
│     const rawSchema = await analyzeRequirements(prompt);              │
│                                                                         │
│     // Step 2: Normalize to 3NF                                       │
│     const normalizedSchema = await normalizeSchema(rawSchema);        │
│                                                                         │
│     // Step 3: Generate Mermaid diagram                               │
│     const mermaidCode = await generateMermaid(normalizedSchema);      │
│                                                                         │
│     // Step 4: Save to database                                       │
│     await saveSchemaToDatabase({                                      │
│       projectId,                                                      │
│       entities: normalizedSchema.entities,                            │
│       attributes: normalizedSchema.attributes,                        │
│       relationships: normalizedSchema.relationships                   │
│     });                                                               │
│                                                                         │
│     // Step 5: Return to frontend                                     │
│     return Response.json({                                            │
│       success: true,                                                 │
│       entities: normalizedSchema.entities,                           │
│       attributes: normalizedSchema.attributes,                       │
│       relationships: normalizedSchema.relationships,                 │
│       mermaidCode: mermaidCode                                       │
│     });                                                              │
│                                                                         │
│   } catch (error) {                                                   │
│     return Response.json({ error: error.message }, { status: 500 });│
│   }                                                                   │
│ }                                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓
        ┌───────────────────────────────────────────────────────────────┐
        │ EXECUTION LAYER (Deterministic Scripts)                       │
        │                                                               │
        │ Step 2a: Analyze Requirements                                │
        │ File: frontend/src/lib/execution/analyze_requirements.ts     │
        │                                                               │
        │ async function analyzeRequirements(prompt: string) {         │
        │   // Call OpenAI/Claude API                                  │
        │   const completion = await openai.chat.completions.create({ │
        │     model: "gpt-4",                                          │
        │     messages: [{                                             │
        │       role: "system",                                        │
        │       content: `Extract entities, attributes, and relations │
        │                 from database design requirements.`          │
        │     }, {                                                     │
        │       role: "user",                                          │
        │       content: prompt                                        │
        │     }]                                                       │
        │   });                                                        │
        │                                                               │
        │   return JSON.parse(completion.choices[0].message.content);  │
        │ }                                                            │
        │                                                               │
        │ Returns:                                                     │
        │ {                                                            │
        │   "entities": [                                              │
        │     { name: "students", attrs: ["id", "name", "email"] },   │
        │     { name: "courses", attrs: ["id", "title", "credits"] }, │
        │     { name: "professors", attrs: ["id", "name", "dept"] }   │
        │   ],                                                         │
        │   "relationships": [                                         │
        │     {                                                        │
        │       "from": "students",                                    │
        │       "to": "courses",                                       │
        │       "type": "many-to-many",                               │
        │       "description": "Enrollment"                            │
        │     },                                                       │
        │     {                                                        │
        │       "from": "courses",                                     │
        │       "to": "professors",                                    │
        │       "type": "many-to-one",                                │
        │       "description": "Taught by"                             │
        │     }                                                        │
        │   ]                                                          │
        │ }                                                            │
        │                                                               │
        │ ─────────────────────────────────────────────────────────   │
        │                                                               │
        │ Step 2b: Normalize Schema (3NF)                              │
        │ File: frontend/src/lib/execution/normalize_schema.ts         │
        │                                                               │
        │ function normalizeSchema(schema) {                           │
        │   // Validate 1NF (atomic values, no repeating groups)      │
        │   if (!isFirstNormalForm(schema)) {                          │
        │     decompose1NF(schema);                                    │
        │   }                                                          │
        │                                                               │
        │   // Validate 2NF (no partial dependencies)                 │
        │   if (!isSecondNormalForm(schema)) {                         │
        │     decomposePartialDependencies(schema);                    │
        │   }                                                          │
        │                                                               │
        │   // Validate 3NF (no transitive dependencies)              │
        │   if (!isThirdNormalForm(schema)) {                          │
        │     decomposeTransitiveDependencies(schema);                 │
        │   }                                                          │
        │                                                               │
        │   return schema; // Now guaranteed 3NF                      │
        │ }                                                            │
        │                                                               │
        │ ─────────────────────────────────────────────────────────   │
        │                                                               │
        │ Step 2c: Generate Mermaid Diagram                            │
        │ File: frontend/src/lib/execution/generate_mermaid.ts         │
        │                                                               │
        │ async function generateMermaid(schema) {                    │
        │   let mermaidCode = "erDiagram\n";                           │
        │                                                               │
        │   // Add entity definitions                                  │
        │   for (const entity of schema.entities) {                    │
        │     mermaidCode += `  ${entity.name}\n`;                     │
        │   }                                                          │
        │                                                               │
        │   // Add relationships with Crow's Foot notation             │
        │   for (const rel of schema.relationships) {                  │
        │     const cardinality = getCardinality(rel.type);            │
        │     mermaidCode +=                                           │
        │       `  ${rel.from} ||${cardinality} ${rel.to} : ${rel.desc}│
        │ `;                                                            │
        │   }                                                          │
        │                                                               │
        │   return mermaidCode;                                        │
        │ }                                                            │
        │                                                               │
        │ Returns:                                                     │
        │ erDiagram                                                    │
        │   STUDENTS ||--o{ COURSES : enrolls                          │
        │   PROFESSORS ||--o{ COURSES : teaches                        │
        │   STUDENTS : int student_id PK                               │
        │   STUDENTS : string name                                     │
        │   COURSES : int course_id PK                                 │
        │   PROFESSORS : int prof_id PK                                │
        └───────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ DATABASE LAYER (Prisma ORM → SQLite/PostgreSQL)                        │
│ File: frontend/prisma/schema.prisma                                    │
│                                                                         │
│ async function saveSchemaToDatabase(designData) {                      │
│   // Create/update project                                             │
│   const project = await prisma.project.upsert({                        │
│     where: { id: projectId },                                          │
│     create: {                                                          │
│       id: projectId,                                                  │
│       userId: "user_123",                                             │
│       title: "University Enrollment System",                          │
│       rawPrompt: prompt,                                              │
│       nodesJson: JSON.stringify(designData.entities),    // → entities│
│       edgesJson: JSON.stringify(designData.relationships) // → rels   │
│     },                                                               │
│     update: {                                                         │
│       nodesJson: JSON.stringify(designData.entities),               │
│       edgesJson: JSON.stringify(designData.relationships),          │
│       updatedAt: new Date()                                         │
│     }                                                                │
│   });                                                                │
│                                                                        │
│   return project;                                                      │
│ }                                                                     │
│                                                                        │
│ Database Schema (Prisma → SQLite/MySQL):                             │
│                                                                        │
│ [User] ←1:M→ [Project]                                               │
│                │                                                      │
│                └─ Stores:                                            │
│                   - id (CUID)                                        │
│                   - userId (who owns it)                             │
│                   - title (project name)                             │
│                   - rawPrompt (original input)                       │
│                   - nodesJson (entities JSON)                        │
│                   - edgesJson (relationships JSON)                   │
│                   - createdAt / updatedAt                            │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓
        ┌───────────────────────────────────────────────────────────────┐
        │ HTTP 200 Response                                             │
        │                                                               │
        │ {                                                             │
        │   "success": true,                                           │
        │   "entities": [                                              │
        │     {                                                        │
        │       "id": "entity_1",                                      │
        │       "name": "students",                                    │
        │       "attributes": [                                        │
        │         { "name": "student_id", "type": "INTEGER", "pk":... │
        │         { "name": "name", "type": "VARCHAR(255)", ... }     │
        │         { "name": "email", "type": "VARCHAR(255)", ... }    │
        │       ]                                                      │
        │     },                                                       │
        │     { "id": "entity_2", "name": "courses", ... },           │
        │     { "id": "entity_3", "name": "professors", ... }         │
        │   ],                                                         │
        │   "relationships": [                                         │
        │     {                                                        │
        │       "id": "rel_1",                                         │
        │       "from": "entity_1",                                    │
        │       "to": "entity_2",                                      │
        │       "type": "many-to-many"                                │
        │     },                                                       │
        │     { "id": "rel_2", "from": "entity_2", "to": "entity_3... │
        │   ],                                                         │
        │   "mermaidCode": "erDiagram\n..."                           │
        │ }                                                            │
        └───────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ FRONTEND CANVAS RENDERING                                              │
│ File: frontend/src/components/Canvas/Canvas.tsx                        │
│                                                                         │
│ 1. Parse response JSON                                                 │
│ 2. Convert entities → ReactFlow Nodes                                  │
│ 3. Convert relationships → ReactFlow Edges                             │
│ 4. Render Mermaid diagram                                              │
│ 5. Display in interactive canvas                                       │
│ 6. Enable editing (left/right sidebar)                                 │
│ 7. Show export buttons (Download SQL, Download PNG)                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📡 API Endpoints Reference

### 1️⃣ POST `/api/generate`

**Purpose:** Generate schema from natural language prompt

**Request:**
```json
{
  "prompt": "Design a blog system with posts, comments, tags, and authors",
  "projectId": "cuid_xyz123"
}
```

**Response:**
```json
{
  "success": true,
  "projectId": "cuid_xyz123",
  "entities": [
    {
      "id": "e_1",
      "name": "users",
      "attributes": [
        { "name": "user_id", "type": "INTEGER", "isPrimaryKey": true },
        { "name": "username", "type": "VARCHAR(255)", "isUnique": true },
        { "name": "email", "type": "VARCHAR(255)", "isUnique": true },
        { "name": "created_at", "type": "TIMESTAMP", "isNullable": false }
      ]
    },
    {
      "id": "e_2",
      "name": "posts",
      "attributes": [
        { "name": "post_id", "type": "INTEGER", "isPrimaryKey": true },
        { "name": "user_id", "type": "INTEGER", "isForeignKey": true },
        { "name": "title", "type": "VARCHAR(500)", "isNullable": false },
        { "name": "content", "type": "TEXT", "isNullable": false },
        { "name": "created_at", "type": "TIMESTAMP", "isNullable": false }
      ]
    }
  ],
  "relationships": [
    {
      "id": "r_1",
      "from": "e_1",
      "to": "e_2",
      "fromName": "users",
      "toName": "posts",
      "type": "one-to-many",
      "label": "creates"
    }
  ],
  "mermaidCode": "erDiagram\n  USERS ||--o{ POSTS : creates\n  ...",
  "isNormalized": true,
  "normalizationDetails": {
    "level": "3NF",
    "status": "PASSED",
    "decompositions": []
  }
}
```

**Status Codes:**
- `200 OK` — Successfully generated schema
- `400 BAD REQUEST` — Invalid prompt or missing fields
- `500 INTERNAL SERVER ERROR` — LLM API error or processing failure

---

### 2️⃣ POST `/api/projects/save`

**Purpose:** Save/update project to database

**Request:**
```json
{
  "projectId": "cuid_xyz123",
  "title": "Blog System",
  "description": "A multi-user blogging platform",
  "nodesJson": "[{...entities...}]",
  "edgesJson": "[{...relationships...}]"
}
```

**Response:**
```json
{
  "success": true,
  "projectId": "cuid_xyz123",
  "message": "Project saved successfully",
  "savedAt": "2026-06-03T14:32:45Z"
}
```

---

### 3️⃣ GET `/api/download?projectId=cuid_xyz123&format=sql&dialect=mysql`

**Purpose:** Export schema as SQL

**Query Parameters:**
- `projectId` (required) — Project ID
- `format` (default: `sql`) — Export format (`sql`, `json`)
- `dialect` (default: `mysql`) — SQL dialect (`mysql`, `postgresql`, `sqlite`)

**Response:**
```sql
-- Exported from DesignDB
-- Project: Blog System
-- Generated: 2026-06-03T14:32:45Z

CREATE TABLE users (
  user_id INTEGER AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_users_valid CHECK (username != '')
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

CREATE TABLE comments (
  comment_id INTEGER AUTO_INCREMENT PRIMARY KEY,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_comments_post_id FOREIGN KEY (post_id) REFERENCES posts(post_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_comments_user_id FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_user_id ON comments(user_id);
```

**Status Codes:**
- `200 OK` — File downloaded successfully
- `404 NOT FOUND` — Project not found
- `500 INTERNAL SERVER ERROR` — SQL generation error

---

### 4️⃣ GET `/api/download-png?projectId=cuid_xyz123`

**Purpose:** Export diagram as PNG image

**Response:** Binary PNG image data

**Behind the scenes:**
```typescript
// 1. Retrieve project schema
const project = await prisma.project.findUnique({ where: { id: projectId } });

// 2. Generate Mermaid code
const mermaidCode = JSON.parse(project.nodesJson); // Convert to diagram

// 3. Call Mermaid Live Editor API
const imageUrl = `https://mermaid.ink/img/${encodeURIComponent(mermaidCode)}`;
const imageResponse = await fetch(imageUrl);

// 4. Return image as PNG
return new Response(imageResponse.body, {
  headers: { 'Content-Type': 'image/png' }
});
```

---

### 5️⃣ GET `/api/projects?userId=user_123`

**Purpose:** List all projects for a user

**Response:**
```json
{
  "success": true,
  "projects": [
    {
      "projectId": "cuid_xyz123",
      "title": "Blog System",
      "description": "A multi-user blogging platform",
      "createdAt": "2026-05-15T10:00:00Z",
      "updatedAt": "2026-06-03T14:32:45Z",
      "isPublic": false,
      "entityCount": 5,
      "relationshipCount": 6
    },
    {
      "projectId": "cuid_abc789",
      "title": "E-Commerce Platform",
      "description": "Online store with products, orders, and customers",
      "createdAt": "2026-05-20T09:15:00Z",
      "updatedAt": "2026-06-01T16:20:30Z",
      "isPublic": true,
      "entityCount": 8,
      "relationshipCount": 10
    }
  ]
}
```

---

### 6️⃣ GET `/api/projects/[id]`

**Purpose:** Get detailed project schema

**Response:**
```json
{
  "success": true,
  "project": {
    "projectId": "cuid_xyz123",
    "title": "Blog System",
    "userId": "user_123",
    "rawPrompt": "Design a blog system...",
    "entities": [...],
    "relationships": [...],
    "mermaidCode": "erDiagram\n...",
    "isNormalized": true,
    "createdAt": "2026-05-15T10:00:00Z",
    "updatedAt": "2026-06-03T14:32:45Z"
  }
}
```

---

## 🔐 Error Handling

### Common Error Responses

**Invalid Prompt (400):**
```json
{
  "success": false,
  "error": "INVALID_PROMPT",
  "message": "Prompt is empty or too short. Provide at least 10 characters."
}
```

**LLM API Error (503):**
```json
{
  "success": false,
  "error": "LLM_API_ERROR",
  "message": "OpenAI API rate limit exceeded. Please try again in 1 minute.",
  "retryAfter": 60
}
```

**Normalization Failed (400):**
```json
{
  "success": false,
  "error": "NORMALIZATION_FAILED",
  "message": "Schema violates 3NF. Transitive dependencies detected.",
  "details": {
    "violations": [
      {
        "type": "TRANSITIVE_DEPENDENCY",
        "table": "orders",
        "issue": "customer_name depends on customer_id, not on order_id"
      }
    ]
  }
}
```

---

## 🔄 Data Transformation Pipeline

```
┌─────────────────────────────────────────────────────┐
│ Input: Natural Language Prompt (String)             │
│ "Design a university system with students, courses, │
│  professors, and enrollments"                       │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ analyze_requirements.ts                             │
│                                                     │
│ Output: RawSchema                                   │
│ {                                                   │
│   entities: Entity[],                               │
│   relationships: Relationship[],                    │
│   rawJson: string                                   │
│ }                                                   │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ normalize_schema.ts                                 │
│                                                     │
│ Validates and decomposes schema to 3NF            │
│                                                     │
│ Output: NormalizedSchema                            │
│ {                                                   │
│   entities: Entity[],           // Decomposed      │
│   attributes: Attribute[],      // Normalized      │
│   relationships: Relationship[], // Validated       │
│   normalizationLog: NormLog[]                       │
│ }                                                   │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ generate_mermaid.ts                                 │
│                                                     │
│ Output: MermaidDiagram                              │
│ {                                                   │
│   code: string,        // Mermaid.js syntax        │
│   svg: string,         // SVG representation       │
│   nodes: Node[],       // For canvas               │
│   edges: Edge[]        // For canvas               │
│ }                                                   │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ export_sql.ts (for download endpoint)              │
│                                                     │
│ Output: SQLScript                                   │
│ {                                                   │
│   code: string,        // CREATE TABLE statements  │
│   dialect: "mysql",    // or postgresql, sqlite    │
│   tables: Table[]      // Table metadata           │
│ }                                                   │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Database Storage (Prisma)                           │
│                                                     │
│ Save to projects table:                            │
│ - nodesJson: Entity[] as JSON string               │
│ - edgesJson: Relationship[] as JSON string         │
│ - rawPrompt: Original user input                   │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Frontend Display                                    │
│                                                     │
│ - Render Mermaid diagram on canvas                 │
│ - Show entities in sidebar                         │
│ - Allow editing and refinement                     │
│ - Provide download/export options                  │
└─────────────────────────────────────────────────────┘
```

---

## 📊 Execution Pipeline (Detailed)

```typescript
// File: frontend/src/app/api/generate/route.ts

export async function POST(request: Request) {
  const { prompt, projectId } = await request.json();

  // STEP 1: Validate input
  if (!prompt || prompt.trim().length < 10) {
    return Response.json(
      { error: "Prompt too short" },
      { status: 400 }
    );
  }

  try {
    // STEP 2: Call analysis service
    const rawSchema = await import('@/lib/execution/analyze_requirements').then(
      m => m.analyzeRequirements(prompt)
    );

    // STEP 3: Normalize schema
    const normalizedSchema = await import('@/lib/execution/normalize_schema').then(
      m => m.normalizeSchema(rawSchema)
    );

    // If normalization detected issues
    if (!normalizedSchema.isValid) {
      return Response.json(
        {
          success: false,
          error: "NORMALIZATION_FAILED",
          violations: normalizedSchema.violations
        },
        { status: 400 }
      );
    }

    // STEP 4: Generate Mermaid diagram
    const mermaidCode = await import('@/lib/execution/generate_mermaid').then(
      m => m.generateMermaid(normalizedSchema)
    );

    // STEP 5: Save to database
    const savedProject = await prisma.project.upsert({
      where: { id: projectId },
      create: {
        userId: "current_user_id", // From auth session
        title: "Auto-generated project",
        rawPrompt: prompt,
        nodesJson: JSON.stringify(normalizedSchema.entities),
        edgesJson: JSON.stringify(normalizedSchema.relationships)
      },
      update: {
        nodesJson: JSON.stringify(normalizedSchema.entities),
        edgesJson: JSON.stringify(normalizedSchema.relationships),
        updatedAt: new Date()
      }
    });

    // STEP 6: Return response
    return Response.json({
      success: true,
      projectId: savedProject.id,
      entities: normalizedSchema.entities,
      attributes: normalizedSchema.attributes,
      relationships: normalizedSchema.relationships,
      mermaidCode: mermaidCode,
      isNormalized: normalizedSchema.isValid
    });

  } catch (error) {
    console.error('Generation error:', error);
    return Response.json(
      { error: "Generation failed", details: error.message },
      { status: 500 }
    );
  }
}
```

---

## 🎯 Summary

| Phase | File | Input | Output |
|-------|------|-------|--------|
| **Frontend Submit** | `PromptBox.tsx` | Natural language | HTTP POST request |
| **API Orchestration** | `route.ts` | HTTP request | Calls execution layer |
| **Requirement Analysis** | `analyze_requirements.ts` | Prompt text | Entities + relationships |
| **Normalization** | `normalize_schema.ts` | Raw schema | 3NF-compliant schema |
| **Diagram Generation** | `generate_mermaid.ts` | Schema | Mermaid code + nodes/edges |
| **Database Storage** | Prisma ORM | Normalized data | Saved to SQLite/PostgreSQL |
| **SQL Export** | `export_sql.ts` | Schema | CREATE TABLE statements |
| **Frontend Render** | `Canvas.tsx` | JSON response | Interactive diagram |

