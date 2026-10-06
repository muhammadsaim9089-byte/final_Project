import { test } from "node:test";
import assert from "node:assert/strict";
import { importText, detectFormat } from "../src/lib/import";
import { parsePrismaSchema } from "../src/lib/import/prisma";
import { modelToDbml } from "../src/lib/dbml/serializer";
import { modelToSql } from "../src/lib/sql/exporter";
import { parseDbml } from "../src/lib/dbml/parser";

const SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  USER
  ADMIN
}

/// Registered accounts
model User {
  id        Int      @id @default(autoincrement())
  /// Login e-mail
  email     String   @unique
  name      String?
  role      Role     @default(USER)
  createdAt DateTime @default(now()) @map("created_at")
  posts     Post[]
  profile   Profile?
  friends   User[]   @relation("Friends")
  friendOf  User[]   @relation("Friends")

  @@map("users")
  @@index([name, email], name: "idx_user_name_email")
}

model Profile {
  id     Int    @id @default(autoincrement())
  bio    String @db.Text
  userId Int    @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Post {
  id         Int        @id @default(autoincrement())
  title      String     @db.VarChar(120)
  published  Boolean    @default(false)
  authorId   Int
  author     User       @relation(fields: [authorId], references: [id], onDelete: SetNull, onUpdate: Cascade)
  categories Category[]
  parentId   Int?
  parent     Post?      @relation("Tree", fields: [parentId], references: [id])
  children   Post[]     @relation("Tree")
}

model Category {
  id    Int    @id
  label String
  posts Post[]
}

model Membership {
  userId Int
  teamId Int
  role   String @default("member")

  @@id([userId, teamId])
  @@unique([teamId, role])
}
`;

test("detects and imports a Prisma schema", () => {
  assert.equal(detectFormat(SCHEMA), "prisma");
  const r = importText(SCHEMA);
  assert.equal(r.format, "prisma");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.model.tables.map((t) => t.name), ["users", "Profile", "Post", "Category", "Membership"]);
  assert.equal(r.model.project.databaseType, "PostgreSQL");
});

test("columns: keys, defaults, optionality, mapped names and native types", () => {
  const { model } = parsePrismaSchema(SCHEMA);
  const users = model.tables.find((t) => t.name === "users")!;
  const id = users.columns.find((c) => c.name === "id")!;
  assert.ok(id.pk && id.increment && id.notNull);
  const email = users.columns.find((c) => c.name === "email")!;
  assert.ok(email.unique && email.notNull);
  assert.equal(email.note, "Login e-mail");
  assert.equal(users.columns.find((c) => c.name === "name")!.notNull, undefined); // optional
  assert.deepEqual(users.columns.find((c) => c.name === "role")!.default, { kind: "string", value: "USER" });
  assert.equal(users.columns.find((c) => c.name === "role")!.type, "Role");
  const created = users.columns.find((c) => c.name === "created_at")!; // @map
  assert.deepEqual(created.default, { kind: "expression", value: "now()" });
  assert.equal(users.note, undefined);
  // relation fields are not columns
  assert.equal(users.columns.some((c) => c.name === "posts" || c.name === "profile" || c.name === "friends"), false);
  const post = model.tables.find((t) => t.name === "Post")!;
  assert.equal(post.columns.find((c) => c.name === "title")!.type, "varchar(120)");
  assert.deepEqual(post.columns.find((c) => c.name === "published")!.default, { kind: "boolean", value: "false" });
  assert.equal(model.tables.find((t) => t.name === "Profile")!.columns.find((c) => c.name === "bio")!.type, "text");
  assert.deepEqual(model.enums, [{ name: "Role", values: [{ name: "USER" }, { name: "ADMIN" }] }]);
});

test("indexes: @@map, @@index, @@id and @@unique", () => {
  const { model } = parsePrismaSchema(SCHEMA);
  const users = model.tables.find((t) => t.name === "users")!;
  assert.deepEqual(users.indexes, [{ columns: ["name", "email"], name: "idx_user_name_email" }]);
  const m = model.tables.find((t) => t.name === "Membership")!;
  assert.deepEqual(m.indexes.find((i) => i.pk)?.columns, ["userId", "teamId"]);
  assert.deepEqual(m.indexes.find((i) => i.unique)?.columns, ["teamId", "role"]);
  assert.ok(m.columns.every((c) => (c.name === "role" ? true : c.notNull)));
});

test("relations: foreign keys with actions, one-to-one, self relations and implicit many-to-many", () => {
  const { model } = parsePrismaSchema(SCHEMA);
  const find = (a: string, b: string) => model.refs.find((r) => (r.from.table === a && r.to.table === b) || (r.from.table === b && r.to.table === a));

  const author = model.refs.find((r) => r.from.table === "Post" && r.to.table === "users")!;
  assert.deepEqual(author.from.columns, ["authorId"]);
  assert.deepEqual(author.to.columns, ["id"]);
  assert.equal(author.type, "many-to-one");
  assert.equal(author.onDelete, "set null");
  assert.equal(author.onUpdate, "cascade");

  const profile = find("Profile", "users")!; // userId is @unique → one-to-one, parent on the left
  assert.equal(profile.type, "one-to-one");
  assert.equal(profile.from.table, "users");
  assert.equal(profile.onDelete, "cascade");

  const tree = model.refs.find((r) => r.from.table === "Post" && r.to.table === "Post")!; // self relation, optional parent
  assert.deepEqual(tree.from.columns, ["parentId"]);
  assert.equal(tree.toOptional, true);

  const m2m = model.refs.filter((r) => r.type === "many-to-many");
  assert.equal(m2m.length, 2); // Post ⇄ Category and the self-referencing friends relation
  assert.ok(m2m.some((r) => [r.from.table, r.to.table].sort().join() === "Category,Post"));
  assert.ok(m2m.some((r) => r.from.table === "users" && r.to.table === "users"));
  // list sides of ordinary one-to-many relations do not create extra refs
  assert.equal(model.refs.filter((r) => r.type !== "many-to-many").length, 3);
});

test("the imported model round-trips through DBML and exports as SQL", () => {
  const { model } = importText(SCHEMA);
  const dbml = modelToDbml(model);
  const back = parseDbml(dbml);
  assert.equal(back.ok, true, JSON.stringify(back.diagnostics));
  assert.equal(back.model.tables.length, model.tables.length);
  assert.equal(back.model.refs.length, model.refs.length);
  const sql = modelToSql(model, { dialect: "postgres" });
  assert.match(sql, /CREATE TABLE users/);
  assert.match(sql, /ON DELETE SET NULL/);
  assert.match(sql, /CREATE TYPE Role AS ENUM|CREATE TYPE "?Role"? AS ENUM/i);
});

test("unknown input yields a helpful error instead of an empty diagram", () => {
  const r = importText("model {", "prisma");
  assert.ok(r.errors.length > 0);
});
