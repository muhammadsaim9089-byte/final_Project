import { test } from "node:test";
import assert from "node:assert/strict";
import type { Node } from "@xyflow/react";
import { parseDbml } from "../src/lib/dbml/parser";
import { modelToCanvas } from "../src/lib/model/canvasAdapter";
import { describeDeletion, describeGroupDeletion, messageText, removeElements } from "../src/lib/model/deletion";

const { nodes: tables, edges } = modelToCanvas(
  parseDbml(`
    Table customers { id int [pk]  email varchar }
    Table core.orders { id int [pk]  customer_id int [ref: > customers.id]  editor_id int [ref: > customers.id] }
    Table profiles { id int [pk]  customer_id int [ref: - customers.id] }
    Table tags { id int [pk] }
    Table post_tags { id int [pk] }
    Ref: tags.id <> post_tags.id
    Table raw { x int }
    Table clean { y int }
    Dep: raw.x -> clean.y
  `).model
);
const note = (id: string, text: string): Node => ({ id, type: "stickyNote", position: { x: 0, y: 0 }, data: { text } });
const nodes = [...tables, note("n1", "Remember to add the audit columns before the migration goes out"), note("n2", "   ")];
const id = (label: string) => nodes.find((n) => (n.data as any).label === label)!.id;
const edgeBetween = (a: string, b: string, col?: string) =>
  edges.find((e) => ((e.source === id(a) && e.target === id(b)) || (e.source === id(b) && e.target === id(a))) && (!col || (e.data as any).targetColumn === col))!.id;
const say = (nodeIds: string[], edgeIds: string[] = []) => {
  const d = describeDeletion(nodes, edges, nodeIds, edgeIds)!;
  return { text: messageText(d.message), detail: d.detail };
};

test("a table is named, with the relationships that go with it", () => {
  assert.deepEqual(say([id("customers")]), {
    text: "You're deleting table customers. Are you sure?",
    detail: "Its 3 relationships are deleted with it.",
  });
  assert.equal(say([id("orders")]).text, "You're deleting table core.orders. Are you sure?", "schema-qualified");
  assert.equal(say([id("tags")]).detail, "Its 1 relationship is deleted with it.");
  // React Flow hands over the table *and* its connected edges — still reads as one table
  const connected = edges.filter((e) => e.source === id("customers") || e.target === id("customers")).map((e) => e.id);
  assert.equal(say([id("customers")], connected).text, "You're deleting table customers. Are you sure?");
});

test("a relationship names its cardinality, both tables and the joined columns", () => {
  assert.deepEqual(say([], [edgeBetween("customers", "orders", "customer_id")]), {
    text: "You're deleting the 1:N relationship from customers to core.orders. Are you sure?",
    detail: "customers.id → core.orders.customer_id",
  });
  assert.match(say([], [edgeBetween("customers", "profiles")]).text, /the 1:1 relationship from profiles to customers/);
  assert.match(say([], [edgeBetween("tags", "post_tags")]).text, /the N:M relationship from tags to post_tags/);
  assert.equal(say([], [edgeBetween("raw", "clean")]).text, "You're deleting the lineage link from raw.x to clean.y. Are you sure?");
});

test("notes are quoted (shortened), empty ones called empty", () => {
  assert.equal(say(["n1"]).text, "You're deleting the note “Remember to add the audit columns befo…”. Are you sure?");
  assert.equal(say(["n2"]).text, "You're deleting an empty note. Are you sure?");
});

test("several things at once are counted", () => {
  assert.equal(
    say([id("tags"), id("raw"), "n1"], [edgeBetween("customers", "profiles")]).text,
    "You're deleting 2 tables (tags, raw), 1 note, 2 relationships and 1 lineage link. Are you sure?"
  );
  assert.equal(say([id("customers"), id("tags"), id("raw"), id("clean")]).text.startsWith("You're deleting 4 tables (customers, tags, raw +1 more)"), true);
  assert.equal(describeDeletion(nodes, edges, ["nope"], ["nope"]), null, "nothing to delete");
});

test("a group: named, and its tables stay", () => {
  const d = describeGroupDeletion("sales", 3);
  assert.equal(messageText(d.message), "You're deleting group sales. Are you sure?");
  assert.equal(d.detail, "Its 3 tables stay on the canvas, ungrouped.");
});

test("deleting removes connected edges and un-marks foreign keys nobody uses any more", () => {
  const fk = (ns: Node[], table: string, col: string) => ((ns.find((n) => n.id === id(table))!.data as any).attributes.find((a: any) => a.name === col)).isFk;
  assert.equal(fk(nodes, "orders", "customer_id"), true);

  const oneRel = removeElements(nodes, edges, [], [edgeBetween("customers", "orders", "customer_id")]);
  assert.equal(oneRel.edges.length, edges.length - 1);
  assert.equal(fk(oneRel.nodes, "orders", "customer_id"), false, "its FK column is no longer a foreign key");
  assert.equal(fk(oneRel.nodes, "orders", "editor_id"), true, "the other FK is untouched");

  const parentGone = removeElements(nodes, edges, [id("customers")]);
  assert.ok(!parentGone.nodes.some((n) => n.id === id("customers")));
  assert.ok(!parentGone.edges.some((e) => e.source === id("customers") || e.target === id("customers")));
  assert.equal(fk(parentGone.nodes, "orders", "customer_id"), false);
  assert.equal(fk(parentGone.nodes, "profiles", "customer_id"), false);

  const noteGone = removeElements(nodes, edges, ["n1"]);
  assert.equal(noteGone.nodes.length, nodes.length - 1);
  assert.equal(noteGone.edges.length, edges.length);
});
