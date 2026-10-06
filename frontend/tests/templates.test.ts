import { test } from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES, TEMPLATE_CATEGORIES, searchTemplates } from "../src/lib/templates";
import { parseDbml } from "../src/lib/dbml/parser";
import { modelToDbml } from "../src/lib/dbml/serializer";
import { modelToSql } from "../src/lib/sql/exporter";
import { parseSql } from "../src/lib/sql/parser";
import { modelToCanvas, canvasToModel, modelSignature } from "../src/lib/model/canvasAdapter";
import { layoutNodes } from "../src/lib/layout";
import { SQL_DIALECTS } from "../src/lib/sql/dialects";

test("template catalogue is well-formed", () => {
  assert.ok(TEMPLATES.length >= 20);
  const ids = new Set(TEMPLATES.map((t) => t.id));
  assert.equal(ids.size, TEMPLATES.length, "duplicate template ids");
  for (const t of TEMPLATES) assert.ok((TEMPLATE_CATEGORIES as readonly string[]).includes(t.category), `${t.id}: unknown category ${t.category}`);
  assert.ok(searchTemplates("bank").some((t) => t.id === "banking"));
  assert.ok(searchTemplates("", "Education").length >= 3);
});

for (const t of TEMPLATES) {
  test(`template "${t.id}" parses with no errors or warnings`, () => {
    const { model, diagnostics } = parseDbml(t.dbml);
    assert.deepEqual(diagnostics, [], `${t.id}: ${JSON.stringify(diagnostics)}`);
    assert.ok(model.tables.length >= 2);
    assert.ok(model.tables.every((tb) => tb.columns.length >= 1));
    for (const tb of model.tables) {
      const names = tb.columns.map((c) => c.name);
      assert.equal(new Set(names).size, names.length, `${t.id}.${tb.name}: duplicate column`);
    }
  });

  test(`template "${t.id}" survives canvas round trip and exports to every dialect`, () => {
    const { model } = parseDbml(t.dbml);
    const canvas = modelToCanvas(model);
    const laid = layoutNodes(canvas.nodes, canvas.edges, "LR");
    const back = canvasToModel(laid, canvas.edges, canvas.meta);
    assert.equal(back.tables.length, model.tables.length);
    assert.equal(back.refs.length, model.refs.length, `${t.id}: refs lost on the canvas`);
    const again = parseDbml(modelToDbml(back));
    assert.deepEqual(again.diagnostics.filter((d) => d.severity === "error"), []);
    assert.equal(modelSignature(canvasToModel(modelToCanvas(again.model).nodes, modelToCanvas(again.model).edges, modelToCanvas(again.model).meta)), modelSignature(canvasToModel(modelToCanvas(back).nodes, modelToCanvas(back).edges, modelToCanvas(back).meta)));
    for (const d of SQL_DIALECTS) {
      const sql = modelToSql(model, { dialect: d.id });
      const reparsed = parseSql(sql, d.id);
      assert.deepEqual(reparsed.warnings, [], `${t.id}/${d.id}`);
      assert.equal(reparsed.model.tables.length, model.tables.length + (model.refs.filter((r) => r.type === "many-to-many").length), `${t.id}/${d.id} table count`);
    }
  });
}
