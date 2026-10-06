import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSql, detectDialect } from "../src/lib/sql/parser";
import { modelToSql, modelToMongo } from "../src/lib/sql/exporter";
import { canonicalType, convertType } from "../src/lib/sql/dialects";
import { parseDbml } from "../src/lib/dbml/parser";
import { modelToDbml } from "../src/lib/dbml/serializer";

const PG_DUMP = `
--
-- PostgreSQL database dump
--
SET statement_timeout = 0;
CREATE TYPE public.order_status AS ENUM ('pending', 'paid', 'shipped');

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    name text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    status public.order_status DEFAULT 'pending'::public.order_status,
    balance numeric(10,2) DEFAULT 0
);
CREATE SEQUENCE public.users_id_seq START WITH 1;
ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_email_key UNIQUE (email);

CREATE TABLE public.posts (
    id serial PRIMARY KEY,
    user_id integer NOT NULL,
    title varchar(200) NOT NULL DEFAULT 'untitled',
    body text
);
ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE NO ACTION;
CREATE INDEX idx_posts_title ON public.posts USING btree (title);
CREATE UNIQUE INDEX uq_lower_email ON public.users (lower(email));
COMMENT ON TABLE public.users IS 'Registered accounts';
COMMENT ON COLUMN public.users.email IS 'Login e-mail';
INSERT INTO public.users (id, email, name) VALUES (1, 'a@x.com', 'Al'), (2, 'b@x.com', NULL);
`;

const MYSQL_DUMP = `
/*!40101 SET NAMES utf8 */;
DROP TABLE IF EXISTS \`customers\`;
CREATE TABLE \`customers\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`name\` varchar(100) NOT NULL COMMENT 'Full name',
  \`tier\` enum('free','pro') NOT NULL DEFAULT 'free',
  \`active\` tinyint(1) DEFAULT '1',
  \`created\` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_name\` (\`name\`),
  KEY \`idx_created\` (\`created\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Customer table';

CREATE TABLE \`orders\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`customer_id\` int(11) NOT NULL,
  \`total\` decimal(10,2) NOT NULL,
  PRIMARY KEY (\`id\`),
  CONSTRAINT \`fk_orders_customer\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB;
`;

const MSSQL = `
CREATE TABLE [dbo].[Products] (
  [ProductId] INT IDENTITY(1,1) NOT NULL,
  [Name] NVARCHAR(200) NOT NULL,
  [Price] DECIMAL(18,2) NOT NULL DEFAULT ((0)),
  CONSTRAINT [PK_Products] PRIMARY KEY CLUSTERED ([ProductId] ASC)
)
GO
CREATE TABLE [dbo].[Reviews] (
  [ReviewId] INT IDENTITY(1,1) PRIMARY KEY,
  [ProductId] INT NOT NULL REFERENCES [dbo].[Products]([ProductId]),
  [Stars] TINYINT NOT NULL CHECK ([Stars] BETWEEN 1 AND 5)
)
GO
`;

test("pg_dump: enums, alter-table constraints, indexes, comments, inserts", () => {
  const { model, warnings } = parseSql(PG_DUMP);
  assert.deepEqual(warnings, []);
  const users = model.tables.find((t) => t.name === "users")!;
  assert.equal(users.schema, undefined); // public is the default schema
  assert.equal(users.columns.length, 6);
  assert.equal(users.columns[0].pk, true);
  assert.equal(users.columns[1].type, "character varying(255)");
  assert.equal(users.columns.find((c) => c.name === "email")!.unique, true);
  assert.equal(users.columns.find((c) => c.name === "created_at")!.default?.value, "now()");
  assert.deepEqual(users.columns.find((c) => c.name === "status")!.default, { kind: "string", value: "pending" });
  assert.equal(users.columns.find((c) => c.name === "balance")!.default?.kind, "number");
  assert.equal(users.note, "Registered accounts");
  assert.equal(users.columns[1].note, "Login e-mail");
  assert.deepEqual(users.records?.rows, [[1, "a@x.com", "Al"], [2, "b@x.com", null]]);
  assert.equal(model.enums[0].name, "order_status");
  assert.deepEqual(model.enums[0].values.map((v) => v.name), ["pending", "paid", "shipped"]);
  const posts = model.tables.find((t) => t.name === "posts")!;
  assert.equal(posts.columns[0].pk, true);
  assert.equal(posts.indexes[0].name, "idx_posts_title");
  assert.equal(users.indexes.find((i) => i.name === "uq_lower_email")!.columns[0], "`lower(email)`");
  assert.equal(model.refs.length, 1);
  assert.equal(model.refs[0].type, "many-to-one");
  assert.equal(model.refs[0].from.table, "posts");
  assert.equal(model.refs[0].onDelete, "cascade");
  assert.equal(model.refs[0].onUpdate, "no action");
});

test("mysqldump: backticks, engine options, enums, inline keys, comments", () => {
  assert.equal(detectDialect(MYSQL_DUMP), "mysql");
  const { model, warnings } = parseSql(MYSQL_DUMP);
  assert.deepEqual(warnings, []);
  const c = model.tables.find((t) => t.name === "customers")!;
  assert.equal(c.note, "Customer table");
  assert.equal(c.columns[0].type, "int"); // display width removed
  assert.equal(c.columns[0].increment, true);
  assert.equal(c.columns[1].note, "Full name");
  assert.equal(c.columns.find((x) => x.name === "tier")!.type, "customers_tier");
  assert.equal(model.enums.find((e) => e.name === "customers_tier")!.values.length, 2);
  assert.equal(c.columns.find((x) => x.name === "active")!.type, "tinyint(1)");
  assert.equal(c.columns.find((x) => x.name === "created")!.default?.value, "CURRENT_TIMESTAMP");
  assert.equal(c.columns.find((x) => x.name === "name")!.unique, true);
  assert.equal(c.indexes.some((i) => i.name === "idx_created"), true);
  const o = model.tables.find((t) => t.name === "orders")!;
  assert.equal(o.columns[0].type, "bigint unsigned");
  assert.equal(model.refs[0].onDelete, "cascade");
});

test("SQL Server: bracket identifiers, IDENTITY, GO batches, inline REFERENCES, CHECK", () => {
  assert.equal(detectDialect(MSSQL), "mssql");
  const { model, warnings } = parseSql(MSSQL);
  assert.deepEqual(warnings, []);
  const p = model.tables.find((t) => t.name === "Products")!;
  assert.equal(p.schema, undefined);
  assert.equal(p.columns[0].increment, true);
  assert.equal(p.columns[0].pk, true);
  assert.deepEqual(p.columns[2].default, { kind: "number", value: "0" });
  const r = model.tables.find((t) => t.name === "Reviews")!;
  assert.equal(r.columns[2].checks?.[0], "[Stars] BETWEEN 1 AND 5");
  assert.equal(model.refs[0].from.table, "Reviews");
  assert.equal(model.refs[0].to.table, "Products");
  assert.deepEqual(model.refs[0].to.columns, ["ProductId"]);
});

test("composite primary key becomes a pk index; DBML round trip works", () => {
  const { model } = parseSql(`CREATE TABLE enroll (student_id int NOT NULL, course_id int NOT NULL, grade char(1), PRIMARY KEY (student_id, course_id));`);
  const t = model.tables[0];
  assert.deepEqual(t.indexes[0], { columns: ["student_id", "course_id"], pk: true });
  const dbml = modelToDbml(model);
  assert.match(dbml, /\(student_id, course_id\) \[pk\]/);
  const back = parseDbml(dbml);
  assert.ok(back.ok);
  assert.deepEqual(back.model.tables[0].indexes[0].columns, ["student_id", "course_id"]);
});

test("canonical types + cross-dialect conversion", () => {
  assert.equal(canonicalType("character varying(255)").kind, "varchar");
  assert.equal(canonicalType("NUMBER(10)").kind, "integer");
  assert.equal(canonicalType("NUMBER(5)").kind, "smallint");
  assert.equal(canonicalType("NUMBER(19,0)").kind, "bigint");
  assert.equal(canonicalType("NUMBER(10,2)").kind, "decimal");
  assert.equal(canonicalType("tinyint(1)").kind, "boolean");
  assert.equal(canonicalType("serial").autoIncrement, true);
  assert.equal(convertType("varchar(50)", "oracle"), "VARCHAR2(50)");
  assert.equal(convertType("timestamp", "mysql"), "DATETIME");
  assert.equal(convertType("int", "bigquery"), "INT64");
  assert.equal(convertType("uuid", "mysql"), "CHAR(36)");
  assert.equal(convertType("boolean", "mssql"), "BIT");
  assert.equal(convertType("weird_type", "postgres"), "WEIRD_TYPE");
});

const SAMPLE = `
enum status { active inactive }
Table users {
  id integer [pk, increment]
  email varchar(255) [unique, not null, note: 'Login']
  status status [default: 'active']
  created_at timestamp [default: \`now()\`]
  Note: 'App users'
  indexes { (email, status) [name: 'idx_es'] }
}
Table posts {
  id integer [pk, increment]
  user_id integer [not null]
  title varchar(200)
  records (id, user_id, title) {
    1, 1, 'It''s a post'
  }
}
Table tags { id integer [pk] }
Ref: posts.user_id > users.id [delete: cascade]
Ref: posts.id <> tags.id
`;

for (const d of ["postgres", "mysql", "sqlite", "mssql", "oracle", "snowflake", "bigquery", "redshift", "databricks"] as const) {
  test(`export → ${d} produces parseable DDL with all tables and FKs`, () => {
    const model = parseDbml(SAMPLE).model;
    const sql = modelToSql(model, { dialect: d });
    assert.match(sql, /CREATE TABLE/);
    for (const t of ["users", "posts", "tags", "posts_tags"]) assert.ok(sql.includes(t), `${d}: missing ${t}\n${sql}`);
    assert.match(sql, /FOREIGN KEY/);
    // junction table for many-to-many
    assert.match(sql, /posts_tags/);
    // what we export must be re-importable by our own parser (except mongo)
    const back = parseSql(sql, d);
    assert.deepEqual(back.warnings, [], `${d}\n${sql}`);
    assert.ok(back.model.tables.length >= 4, `${d} parsed ${back.model.tables.length} tables\n${sql}`);
    assert.ok(back.model.refs.length >= 3, `${d} parsed ${back.model.refs.length} refs\n${sql}`);
  });
}

test("postgres output details", () => {
  const sql = modelToSql(parseDbml(SAMPLE).model, { dialect: "postgres" });
  assert.match(sql, /CREATE TYPE status AS ENUM \('active', 'inactive'\)/);
  assert.match(sql, /id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY/);
  assert.match(sql, /status status DEFAULT 'active'/);
  assert.match(sql, /created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP/);
  assert.match(sql, /COMMENT ON TABLE users IS 'App users'/);
  assert.match(sql, /INSERT INTO posts \(id, user_id, title\) VALUES\n\s+\(1, 1, 'It''s a post'\)/);
  assert.match(sql, /ON DELETE CASCADE/);
});

test("mysql / sqlite / mssql specifics", () => {
  const model = parseDbml(SAMPLE).model;
  assert.match(modelToSql(model, { dialect: "mysql" }), /status ENUM\('active', 'inactive'\) DEFAULT 'active'/);
  assert.match(modelToSql(model, { dialect: "mysql" }), /id INT AUTO_INCREMENT PRIMARY KEY/);
  assert.match(modelToSql(model, { dialect: "sqlite" }), /id INTEGER PRIMARY KEY AUTOINCREMENT/);
  assert.match(modelToSql(model, { dialect: "mssql" }), /id INT IDENTITY\(1,1\) PRIMARY KEY/);
  assert.match(modelToSql(model, { dialect: "oracle" }), /VARCHAR2\(255\)/);
  assert.match(modelToSql(model, { dialect: "bigquery" }), /PRIMARY KEY \(id\) NOT ENFORCED/);
});

test("circular foreign keys fall back to ALTER TABLE", () => {
  const model = parseDbml(`Table a { id int [pk] b_id int }\nTable b { id int [pk] a_id int }\nRef: a.b_id > b.id\nRef: b.a_id > a.id`).model;
  const sql = modelToSql(model, { dialect: "postgres" });
  assert.match(sql, /ALTER TABLE a ADD CONSTRAINT/);
  assert.match(sql, /ALTER TABLE b ADD CONSTRAINT/);
});

test("drop, if-not-exists, schemas", () => {
  const model = parseDbml(`Table core.users { id int [pk] }`).model;
  const sql = modelToSql(model, { dialect: "postgres", includeDrop: true, ifNotExists: true });
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS core;/);
  assert.match(sql, /DROP TABLE IF EXISTS core\.users CASCADE;/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS core\.users/);
  assert.match(modelToSql(model, { dialect: "sqlite" }), /CREATE TABLE core_users/);
});

test("reserved words are quoted per dialect", () => {
  const model = parseDbml(`Table "order" { id int [pk] "group" varchar }`).model;
  assert.match(modelToSql(model, { dialect: "postgres" }), /CREATE TABLE "order" \(\n  id INTEGER PRIMARY KEY,\n  "group"/);
  assert.match(modelToSql(model, { dialect: "mysql" }), /CREATE TABLE `order`/);
  assert.match(modelToSql(model, { dialect: "mssql" }), /CREATE TABLE \[order\]/);
});

test("MongoDB export", () => {
  const js = modelToMongo(parseDbml(SAMPLE).model);
  assert.match(js, /db\.createCollection\("users"/);
  assert.match(js, /"bsonType": "string"/);
  assert.match(js, /"enum": \[\s*"active",\s*"inactive"\s*\]/);
  assert.match(js, /db\.users\.createIndex\(\{ "email": 1 \}, \{ unique: true \}\)/);
  assert.match(js, /insertMany/);
});
