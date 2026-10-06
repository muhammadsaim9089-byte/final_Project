import { test } from "node:test";
import assert from "node:assert/strict";
import { IMPORT_SOURCES, analyzeImport, getImportSource, sourceForFormat } from "../src/lib/import/sources";
import { IMPORT_FORMATS } from "../src/lib/import";
import { SQL_DIALECTS } from "../src/lib/sql/dialects";

const PG_DUMP = `
CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL
);
CREATE TABLE public.posts (
    id serial PRIMARY KEY,
    user_id integer NOT NULL
);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.posts ADD CONSTRAINT posts_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
`;

test("every import source is complete and unique", () => {
  const ids = IMPORT_SOURCES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  // the sources the menu promises
  for (const id of ["mysql", "postgres", "mssql", "oracle", "sqlite", "snowflake", "bigquery", "redshift", "databricks", "dbml", "prisma", "django", "rails", "mermaid", "json", "auto"]) {
    assert.ok(ids.includes(id), `missing source ${id}`);
  }
  for (const s of IMPORT_SOURCES) {
    assert.ok(s.title && s.blocks.length > 0 && s.accept && s.placeholder, `${s.id} is incomplete`);
    assert.ok(s.format === "auto" || IMPORT_FORMATS.some((f) => f.id === s.format), `${s.id}: unknown format`);
    if (s.group === "database") {
      assert.equal(s.format, "sql");
      assert.ok(s.dialect && SQL_DIALECTS.some((d) => d.id === s.dialect), `${s.id}: needs a SQL dialect`);
      assert.ok(s.blocks.some((b) => b.kind === "code"), `${s.id}: needs a command or query to copy`);
    }
  }
});

test("database instructions contain the right tools", () => {
  const code = (id: string) => getImportSource(id).blocks.filter((b) => b.kind === "code").map((b) => (b as { code: string }).code).join("\n");
  assert.match(code("mysql"), /mysqldump/);
  assert.match(code("postgres"), /pg_dump/);
  assert.match(code("oracle"), /DBMS_METADATA\.GET_DDL/);
  assert.match(code("snowflake"), /GET_DDL/);
  assert.match(code("bigquery"), /INFORMATION_SCHEMA/);
  assert.match(code("sqlite"), /sqlite3/);
});

test("a database source parses its dump and names the dialect", () => {
  const a = analyzeImport(PG_DUMP, getImportSource("postgres"));
  assert.equal(a.empty, false);
  assert.equal(a.result!.errors.length, 0);
  assert.equal(a.result!.model.tables.length, 2);
  assert.equal(a.result!.model.refs.length, 1);
  assert.equal(a.label, "PostgreSQL");
  assert.equal(a.mismatch, false);
});

test("auto-detect works out the format and the SQL dialect", () => {
  const sql = analyzeImport(PG_DUMP, getImportSource("auto"));
  assert.equal(sql.detected, "sql");
  assert.equal(sql.result!.model.tables.length, 2);
  const dbml = analyzeImport("Table t { id int [pk] }", getImportSource("auto"));
  assert.equal(dbml.detected, "dbml");
  assert.equal(dbml.label, "DBML");
  const mysql = analyzeImport("CREATE TABLE `a` (`id` int(11) NOT NULL AUTO_INCREMENT, PRIMARY KEY (`id`)) ENGINE=InnoDB;", getImportSource("auto"));
  assert.equal(mysql.label, "MySQL / MariaDB");
});

test("the wrong source reports a mismatch and suggests the right one", () => {
  const a = analyzeImport(PG_DUMP, getImportSource("prisma"));
  assert.ok(a.result!.errors.length > 0);
  assert.equal(a.mismatch, true);
  assert.equal(a.detected, "sql");
  assert.equal(sourceForFormat(a.detected!).id, "auto");
  const b = analyzeImport("model User {\n  id Int @id\n}", getImportSource("postgres"));
  assert.equal(b.mismatch, true);
  assert.equal(sourceForFormat(b.detected!).id, "prisma");
});

test("empty input is not an error", () => {
  const a = analyzeImport("   \n", getImportSource("mysql"));
  assert.equal(a.empty, true);
  assert.equal(a.result, null);
});

test("the examples shown in the instructions actually import", () => {
  for (const id of ["dbml", "mermaid", "json"]) {
    const source = getImportSource(id);
    const example = source.blocks.filter((b) => b.kind === "code").map((b) => (b as { code: string }).code)[0];
    const a = analyzeImport(example, source);
    assert.deepEqual(a.result!.errors, [], `${id} example failed`);
    assert.ok(a.result!.model.tables.length >= 1, `${id} example has no tables`);
  }
});
