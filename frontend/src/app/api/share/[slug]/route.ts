import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MAX_DBML_BYTES, hashPassword, hashToken, safeEqualHex, verifyPassword } from "@/lib/server/shareAuth";
import { withRateLimit } from "@/lib/server/rateLimit";
import { cacheShare, forgetShare, loadShare, sharePayload } from "@/lib/server/cachedData";
import { cachedJson } from "@/lib/server/httpCache";

export const dynamic = "force-dynamic";

// Rows come from the share cache (lib/server/cachedData): an update writes through, unpublishing forgets the slug.

/**
 * Public diagrams return their content; password-protected ones only say so; private ones are hidden.
 * Cacheable but always revalidated (ETag → 304): unpublishing or adding a password takes effect at once, and every view
 * is counted.
 */
export const GET = withRateLimit("read", async (req: Request, { params }: { params: { slug: string } }) => {
  const entry = await loadShare(params.slug);
  if (!entry || entry.row.visibility === "private") return NextResponse.json({ error: "This diagram is private or does not exist" }, { status: 404 });
  if (entry.row.visibility !== "password") {
    await db.sharedDiagram.update({ where: { id: entry.row.id }, data: { views: { increment: 1 } } }).catch(() => undefined);
  }
  return cachedJson(req, entry.body, "public-revalidate", { etag: entry.etag });
});

/** Unlock a password-protected diagram: POST { password } — never cached (the route wrapper sends no-store). */
export const POST = withRateLimit("auth", async (req: Request, { params }: { params: { slug: string } }) => {
  const { password } = await req.json().catch(() => ({ password: "" }));
  const row = (await loadShare(params.slug))?.row;
  if (!row || row.visibility === "private") return NextResponse.json({ error: "This diagram is private or does not exist" }, { status: 404 });
  if (row.visibility === "public") return NextResponse.json(sharePayload(row));
  if (!row.passwordHash || !row.passwordSalt || typeof password !== "string" || !verifyPassword(password, row.passwordHash, row.passwordSalt)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  await db.sharedDiagram.update({ where: { id: row.id }, data: { views: { increment: 1 } } }).catch(() => undefined);
  return NextResponse.json(sharePayload(row));
});

async function authorised(slug: string, token: string | undefined) {
  const row = (await loadShare(slug))?.row;
  if (!row || !row.editTokenHash || !token) return null;
  return safeEqualHex(hashToken(token), row.editTokenHash) ? row : null;
}

/** Update content / visibility / password: PUT { editToken, title?, dbml?, layout?, visibility?, password? } */
export const PUT = withRateLimit("auth", async (req: Request, { params }: { params: { slug: string } }) => {
  const body = await req.json().catch(() => ({}));
  const row = await authorised(params.slug, body.editToken);
  if (!row) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const data: Record<string, any> = {};
  if (typeof body.title === "string") data.title = body.title.slice(0, 200);
  if (typeof body.dbml === "string") {
    if (body.dbml.length > MAX_DBML_BYTES) return NextResponse.json({ error: "Diagram is too large" }, { status: 413 });
    data.dbml = body.dbml;
  }
  if (body.layout && typeof body.layout === "object") data.layoutJson = JSON.stringify(body.layout);
  if (body.visibility) {
    if (!["public", "password", "private"].includes(body.visibility)) return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
    data.visibility = body.visibility;
    if (body.visibility === "password") {
      if (typeof body.password === "string" && body.password.length >= 4) {
        const pw = hashPassword(body.password);
        data.passwordHash = pw.hash;
        data.passwordSalt = pw.salt;
      } else if (!row.passwordHash) return NextResponse.json({ error: "Choose a password of at least 4 characters" }, { status: 400 });
    } else {
      data.passwordHash = null;
      data.passwordSalt = null;
    }
  }
  const updated = await db.sharedDiagram.update({ where: { id: row.id }, data });
  cacheShare(updated);
  return NextResponse.json({ ok: true, visibility: updated.visibility, updatedAt: updated.updatedAt });
});

/** Unpublish: DELETE { editToken } */
export const DELETE = withRateLimit("auth", async (req: Request, { params }: { params: { slug: string } }) => {
  const body = await req.json().catch(() => ({}));
  const row = await authorised(params.slug, body.editToken);
  if (!row) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  await db.sharedDiagram.delete({ where: { id: row.id } });
  forgetShare(params.slug);
  return NextResponse.json({ ok: true });
});
