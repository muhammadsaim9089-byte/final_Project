import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MAX_DBML_BYTES, hashPassword, hashToken, newEditToken, newSlug } from "@/lib/server/shareAuth";
import { withRateLimit } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Publish a diagram: POST { title, dbml, layout?, visibility: "public" | "password" | "private", password? }
 * Returns { slug, url, editToken } — keep the edit token to update or unpublish later.
 */
export const POST = withRateLimit("upload", async (req: Request) => {
  try {
    const body = await req.json();
    const { title, dbml, layout, visibility = "public", password } = body || {};
    if (typeof dbml !== "string" || !dbml.trim()) return NextResponse.json({ error: "dbml is required" }, { status: 400 });
    if (dbml.length > MAX_DBML_BYTES) return NextResponse.json({ error: "Diagram is too large to publish" }, { status: 413 });
    if (!["public", "password", "private"].includes(visibility)) return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
    if (visibility === "password" && (typeof password !== "string" || password.length < 4)) {
      return NextResponse.json({ error: "Choose a password of at least 4 characters" }, { status: 400 });
    }

    const editToken = newEditToken();
    let pw: { hash: string; salt: string } | null = null;
    if (visibility === "password") pw = hashPassword(password);

    let slug = newSlug();
    for (let i = 0; i < 5; i++) {
      if (!(await db.sharedDiagram.findUnique({ where: { slug } }))) break;
      slug = newSlug();
    }

    const row = await db.sharedDiagram.create({
      data: {
        slug,
        title: String(title || "Untitled diagram").slice(0, 200),
        dbml,
        layoutJson: JSON.stringify(layout && typeof layout === "object" ? layout : {}),
        visibility,
        passwordHash: pw?.hash ?? null,
        passwordSalt: pw?.salt ?? null,
        editTokenHash: hashToken(editToken),
      },
    });

    const origin = new URL(req.url).origin;
    return NextResponse.json({ slug: row.slug, url: `${origin}/share/${row.slug}`, editToken, visibility: row.visibility });
  } catch (e: any) {
    console.error("Publish error:", e);
    return NextResponse.json({ error: e?.message || "Failed to publish" }, { status: 500 });
  }
});
