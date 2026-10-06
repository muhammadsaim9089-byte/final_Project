import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDjango, parseRails } from "../src/lib/frameworkParsers";
import { importText } from "../src/lib/import";

// Importing Django models.py and Rails schema.rb (Import dialog → Django / Rails, and auto-detection).

const cols = (s: ReturnType<typeof parseDjango>, entity: string) => s.entities.find((e) => e.name === entity)?.attributes.map((a) => `${a.name}:${a.dataType}${a.isPrimaryKey ? ":pk" : ""}${a.isForeignKey ? ":fk" : ""}`);
const rels = (s: ReturnType<typeof parseDjango>) => s.relationships.map((r) => `${r.fromEntity}.${r.foreignKey}->${r.toEntity}.${r.referencedKey}:${r.type}`);

// ─── Django ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const BLOG = `
from django.db import models

class Author(models.Model):
    # who writes
    name = models.CharField(max_length=120)
    email = models.EmailField(unique=True)
    bio = models.TextField(blank=True)

    def __str__(self):
        return self.name


class Post(models.Model):
    author = models.ForeignKey(Author, on_delete=models.CASCADE, related_name="posts")
    title = models.CharField(max_length=200)
    published = models.BooleanField(default=False)
    views = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
`;

test("Django: models become tables with an implicit id key and mapped field types", () => {
  const s = parseDjango(BLOG);
  assert.deepEqual(s.entities.map((e) => e.name), ["Author", "Post"]);
  assert.deepEqual(cols(s, "Author"), ["id:integer:pk", "name:varchar(120)", "email:varchar(254)", "bio:text"]);
  assert.deepEqual(cols(s, "Post"), ["id:integer:pk", "author_id:integer:fk", "title:varchar(200)", "published:boolean", "views:bigint", "created_at:timestamp"]);
  assert.deepEqual(rels(s), ["Post.author_id->Author.id:one-to-many"]);
});

test("Django: an explicit primary key replaces the implicit id", () => {
  const s = parseDjango(`class Country(models.Model):\n    code = models.CharField(max_length=2, primary_key=True)\n    name = models.CharField(max_length=80)\n`);
  assert.deepEqual(cols(s, "Country"), ["code:varchar(2):pk", "name:varchar(80)"]);
});

test("Django: to=, quoted names, db_column and OneToOneField", () => {
  const s = parseDjango(`
class Profile(models.Model):
    user = models.OneToOneField(to="Account", on_delete=models.CASCADE)
    country = models.ForeignKey('Country', db_column='country_code', on_delete=models.PROTECT)
`);
  assert.deepEqual(rels(s), ["Profile.user_id->Account.id:one-to-one", "Profile.country_code->Country.id:one-to-many"]);
});

test("Django: ForeignKey('self') points at the model itself", () => {
  const s = parseDjango(`class Employee(models.Model):\n    manager = models.ForeignKey("self", null=True, on_delete=models.SET_NULL)\n`);
  assert.deepEqual(rels(s), ["Employee.manager_id->Employee.id:one-to-many"]);
});

test("Django: app-qualified and settings references resolve to the model name", () => {
  const s = parseDjango(`
class Order(models.Model):
    customer = models.ForeignKey('shop.Customer', on_delete=models.PROTECT)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
`);
  assert.deepEqual(rels(s), ["Order.customer_id->Customer.id:one-to-many", "Order.created_by_id->User.id:one-to-many"]);
});

test("Django: an argument that merely ends in 'to' is not mistaken for the target", () => {
  const s = parseDjango(`class Photo(models.Model):\n    album = models.ForeignKey(Album, on_delete=models.CASCADE, auto=True)\n`);
  assert.deepEqual(rels(s), ["Photo.album_id->Album.id:one-to-many"]);
});

test("Django: ManyToManyField becomes a join table, not a column", () => {
  const s = parseDjango(`
class Tag(models.Model):
    label = models.CharField(max_length=30)

class Article(models.Model):
    title = models.CharField(max_length=200)
    tags = models.ManyToManyField(Tag, blank=True)
`);
  assert.deepEqual(cols(s, "Article"), ["id:integer:pk", "title:varchar(200)"]);
  assert.deepEqual(cols(s, "Article_tags"), ["id:integer:pk", "article_id:integer:fk", "tag_id:integer:fk"]);
  assert.deepEqual(rels(s), ["Article_tags.article_id->Article.id:one-to-many", "Article_tags.tag_id->Tag.id:one-to-many"]);
});

test("Django: DecimalField keeps its digits and places; unknown fields fall back to varchar", () => {
  const s = parseDjango(`class Price(models.Model):\n    amount = models.DecimalField(max_digits=12, decimal_places=4)\n    plain = models.DecimalField()\n    blob = models.CustomWeirdField()\n    uid = models.UUIDField()\n`);
  assert.deepEqual(cols(s, "Price"), ["id:integer:pk", "amount:decimal(12,4)", "plain:decimal(10,2)", "blob:varchar(255)", "uid:uuid"]);
});

test("Django: fields formatted over several lines, and fields after an inner Meta class", () => {
  const s = parseDjango(`
class Comment(models.Model):
    post = models.ForeignKey(
        "Post",
        on_delete=models.CASCADE,
        related_name="comments",  # newest first
    )
    body = models.TextField(
        max_length=2000,
    )

    class Meta:
        ordering = ["-id"]

    edited = models.BooleanField(default=False)
`);
  assert.deepEqual(cols(s, "Comment"), ["id:integer:pk", "post_id:integer:fk", "body:text", "edited:boolean"]);
  assert.deepEqual(rels(s), ["Comment.post_id->Post.id:one-to-many"]);
});

test("Django: a many-to-many with its own through= model adds no extra table; a self many-to-many gets from_/to_ columns", () => {
  const s = parseDjango(`
class Person(models.Model):
    groups = models.ManyToManyField("Group", through="Membership")
    friends = models.ManyToManyField("self")
`);
  assert.deepEqual(s.entities.map((e) => e.name), ["Person", "Person_friends"]);
  assert.deepEqual(cols(s, "Person_friends"), ["id:integer:pk", "from_person_id:integer:fk", "to_person_id:integer:fk"]);
});

test("Django: text with no models gives an empty schema", () => {
  assert.deepEqual(parseDjango(""), { entities: [], relationships: [] });
  assert.deepEqual(parseDjango("import os\nprint('hello')\n"), { entities: [], relationships: [] });
});

test("Django import end to end: references point from the child's column to the parent's key", () => {
  const r = importText(BLOG, "django");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.model.tables.map((t) => t.name), ["Author", "Post"]);
  assert.deepEqual(r.model.refs, [{ from: { table: "Post", columns: ["author_id"] }, to: { table: "Author", columns: ["id"] }, type: "many-to-one" }]);
  assert.equal(r.model.tables[0].columns[0].pk, true);
});

// ─── Rails ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const SCHEMA_RB = `
ActiveRecord::Schema[7.1].define(version: 2026_09_01_000000) do
  create_table "users", force: :cascade do |t|
    t.string "email", null: false
    t.string "legend"
    t.datetime "created_at", null: false
  end

  create_table "categories", force: :cascade do |t|
    t.string "name"
  end

  create_table "messages", force: :cascade do |t|
    t.bigint "sender_id", null: false
    t.bigint "category_id"
    t.text "body"
    t.decimal "price", precision: 12, scale: 3
    t.string "code", limit: 3
  end

  create_table "messages_users", id: false, force: :cascade do |t|
    t.bigint "message_id"
    t.bigint "user_id"
  end

  create_table "devices", id: :uuid, force: :cascade do |t|
    t.string "name"
  end

  add_foreign_key "messages", "users", column: "sender_id"
  add_foreign_key "messages", "categories"
end
`;

test("Rails: tables keep every column, even ones whose names contain 'end'", () => {
  const s = parseRails(SCHEMA_RB);
  assert.deepEqual(s.entities.map((e) => e.name), ["users", "categories", "messages", "messages_users", "devices"]);
  assert.deepEqual(cols(s, "users"), ["id:bigint:pk", "email:varchar(255)", "legend:varchar(255)", "created_at:timestamp"]);
  assert.deepEqual(cols(s, "messages"), ["id:bigint:pk", "sender_id:bigint:fk", "category_id:bigint:fk", "body:text", "price:decimal(12,3)", "code:varchar(3)"]);
});

test("Rails: add_foreign_key with and without column:, singularising -ies names", () => {
  const s = parseRails(SCHEMA_RB);
  assert.deepEqual(rels(s), ["messages.sender_id->users.id:one-to-many", "messages.category_id->categories.id:one-to-many"]);
});

test("Rails: id: false tables have no id; id: :uuid tables have a uuid key", () => {
  const s = parseRails(SCHEMA_RB);
  assert.deepEqual(cols(s, "messages_users"), ["message_id:bigint:fk", "user_id:bigint:fk"]);
  assert.deepEqual(cols(s, "devices"), ["id:uuid:pk", "name:varchar(255)"]);
});

test("Rails: foreign keys to tables ending in -ses, -xes and plain -s", () => {
  const s = parseRails(`
create_table "orders" do |t|
  t.bigint "address_id"
  t.bigint "box_id"
  t.bigint "item_id"
end
add_foreign_key "orders", "addresses"
add_foreign_key "orders", "boxes"
add_foreign_key "orders", "items"
`);
  assert.deepEqual(s.relationships.map((r) => r.foreignKey), ["address_id", "box_id", "item_id"]);
});

test("Rails: unknown column types pass through; comments and blank lines are ignored", () => {
  const s = parseRails(`create_table "points" do |t|\n  # coordinates\n\n  t.geometry "location"\n  t.binary "thumb"\nend\n`);
  assert.deepEqual(cols(s, "points"), ["id:bigint:pk", "location:geometry", "thumb:blob"]);
});

test("Rails import end to end", () => {
  const r = importText(SCHEMA_RB, "rails");
  assert.deepEqual(r.errors, []);
  assert.equal(r.model.tables.length, 5);
  assert.deepEqual(r.model.refs.map((x) => `${x.from.table}.${x.from.columns}->${x.to.table}.${x.to.columns}`), ["messages.sender_id->users.id", "messages.category_id->categories.id"]);
});
