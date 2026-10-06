import { NextResponse } from "next/server";
import { introspect, ConnectionInput } from "@/lib/reverse/live";
import { catalogToModel } from "@/lib/reverse/catalog";
import { withRateLimit } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Reverse-engineer a live PostgreSQL / MySQL database (read-only catalog queries).
 * POST { type: "postgres" | "mysql", url? | host, port?, user, password, database, ssl?, schemas? }
 *
 * The server opens the connection, so this is meant for local / self-hosted use. It is disabled in
 * production unless ALLOW_LIVE_DB_CONNECT=true, and can be turned off anywhere with ALLOW_LIVE_DB_CONNECT=false.
 */
export const POST = withRateLimit("upload", async (req: Request) => {
  const flag = process.env.ALLOW_LIVE_DB_CONNECT;
  const allowed = flag === "true" || (flag !== "false" && process.env.NODE_ENV !== "production");
  if (!allowed) {
    return NextResponse.json({ error: "Live database connections are disabled on this server. Export your DDL and use the SQL import instead." }, { status: 403 });
  }
  try {
    const body = (await req.json()) as ConnectionInput;
    if (body.type !== "postgres" && body.type !== "mysql") return NextResponse.json({ error: "type must be 'postgres' or 'mysql'" }, { status: 400 });
    const catalog = await introspect(body);
    const model = catalogToModel(catalog, { mysqlDatabase: body.type === "mysql" });
    return NextResponse.json({
      model,
      summary: { tables: catalog.tables.length, columns: catalog.tables.reduce((n, t) => n + t.columns.length, 0), foreignKeys: catalog.foreignKeys.length, indexes: catalog.indexes.length },
    });
  } catch (e: any) {
    // never echo credentials back
    const msg = String(e?.message || e).replace(/password=[^\s&]+/gi, "password=***");
    const code = e?.code ? ` (${e.code})` : "";
    return NextResponse.json({ error: `Could not read the database${code}: ${msg}` }, { status: 502 });
  }
});
