import { NextResponse } from "next/server";
import { ImportFormat, importText } from "@/lib/import";
import { modelToDbml } from "@/lib/dbml/serializer";
import { modelToMongo, modelToSql } from "@/lib/sql/exporter";
import { isSqlDialect } from "@/lib/sql/dialects";
import { generateHtmlDocs, generateMarkdownDocs } from "@/lib/docs/generator";
import { renderSvg } from "@/lib/export/svgRenderer";
import { layoutModel } from "@/lib/model/autoLayout";
import { withRateLimit } from "@/lib/server/rateLimit";
import { cacheKey, caches, hashKey, memoResponse } from "@/lib/server/cache";
import { cachedJson } from "@/lib/server/httpCache";

export const dynamic = "force-dynamic";

const TARGETS = ["dbml", "sql", "json", "mongodb", "markdown", "html", "svg"] as const;

/**
 * Programmatic conversion for scripts and CI/CD (the equivalent of dbdiagram's CLI / "programmatic ERD updates").
 *
 *   curl -X POST /api/convert -H 'content-type: application/json' \
 *        -d '{"from":"sql","to":"dbml","input":"CREATE TABLE …"}'
 *
 * body: { input: string, from?: auto|dbml|sql|prisma|django|rails|mermaid|json, to: dbml|sql|json|mongodb|markdown|html|svg,
 *         dialect?: postgres|mysql|sqlite|mssql|oracle|snowflake|bigquery|redshift|databricks, raw?: boolean }
 *
 * A conversion is a pure function of the request body, so successful results are cached by it (30 min; X-Cache: HIT).
 */
export const POST = withRateLimit("read", async (req: Request) => {
  const text = await req.text();
  return memoResponse(caches.compute, cacheKey.convert(hashKey(text)), () => convert(text));
});

async function convert(text: string): Promise<Response> {
  try {
    const body = JSON.parse(text);
    const { input, from = "auto", to, dialect = "postgres", raw } = body || {};
    if (typeof input !== "string" || !input.trim()) return NextResponse.json({ error: "`input` is required" }, { status: 400 });
    if (!TARGETS.includes(to)) return NextResponse.json({ error: `\`to\` must be one of ${TARGETS.join(", ")}` }, { status: 400 });
    if (to === "sql" && !isSqlDialect(dialect)) return NextResponse.json({ error: `Unknown dialect '${dialect}'` }, { status: 400 });
    if (input.length > 5_000_000) return NextResponse.json({ error: "Input is too large" }, { status: 413 });

    const result = importText(input, from as ImportFormat, { dialect: isSqlDialect(dialect) ? dialect : undefined });
    if (result.errors.length) return NextResponse.json({ error: result.errors[0], errors: result.errors, warnings: result.warnings }, { status: 422 });
    const model = result.model;

    let output = "";
    let contentType = "text/plain";
    switch (to) {
      case "dbml":
        output = modelToDbml(model);
        break;
      case "sql":
        output = modelToSql(model, { dialect });
        contentType = "application/sql";
        break;
      case "mongodb":
        output = modelToMongo(model);
        contentType = "text/javascript";
        break;
      case "json":
        output = JSON.stringify(model, null, 2);
        contentType = "application/json";
        break;
      case "markdown":
        output = generateMarkdownDocs(model);
        contentType = "text/markdown";
        break;
      case "html":
        output = generateHtmlDocs(model, { svg: renderSvg(layoutModel(model), { theme: "light", transparent: true }).svg });
        contentType = "text/html";
        break;
      case "svg":
        output = renderSvg(layoutModel(model), { theme: body.theme === "dark" ? "dark" : "light" }).svg;
        contentType = "image/svg+xml";
        break;
    }
    if (raw) return new NextResponse(output, { status: 200, headers: { "Content-Type": `${contentType}; charset=utf-8` } });
    return NextResponse.json({ output, from: result.format, to, warnings: result.warnings, tables: model.tables.length, refs: model.refs.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Conversion failed" }, { status: 500 });
  }
}

// the same for everyone and changes only with a deploy: browsers and CDNs may keep it for a few minutes
export const GET = withRateLimit("read", async (req: Request) => {
  return cachedJson(req, JSON.stringify({
    usage: "POST JSON { input, from?, to, dialect?, raw? }",
    from: ["auto", "dbml", "sql", "prisma", "django", "rails", "mermaid", "json"],
    to: TARGETS,
    dialects: ["postgres", "mysql", "sqlite", "mssql", "oracle", "snowflake", "bigquery", "redshift", "databricks"],
  }), "public-static");
});
