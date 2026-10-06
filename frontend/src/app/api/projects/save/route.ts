import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRateLimit } from "@/lib/server/rateLimit";
import { invalidateProjects } from "@/lib/server/cache";

export const POST = withRateLimit("write", async (req: Request) => {
  try {
    const body = await req.json();
    const { id, title, rawPrompt, nodes, edges, meta, userId } = body;

    if (!title || !nodes || !edges) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // In a real app, userId comes from the authentication session.
    // For now, we will use a dummy user or require it in the payload.
    // Let's upsert a dummy user just for testing purposes if userId is missing.
    const actualUserId = userId || "demo-user-id";

    // Ensure dummy user exists for now so FK constraint doesn't fail
    await db.user.upsert({
      where: { id: actualUserId },
      update: {},
      create: {
        id: actualUserId,
        email: "demo@designdb.app",
      },
    });

    const hasMeta = !!meta && typeof meta === "object";
    const metaJson = JSON.stringify(hasMeta ? meta : {});

    let project;
    if (id) {
      // The tab may carry an id that was never persisted (or was deleted) — fall back to creating it.
      const existing = await db.project.findUnique({ where: { id } });
      if (existing) {
        project = await db.project.update({
          where: { id },
          data: {
            title,
            rawPrompt: rawPrompt || "",
            nodesJson: JSON.stringify(nodes),
            edgesJson: JSON.stringify(edges),
            // a save without meta (e.g. a rename) must not wipe enums, groups and views
            ...(hasMeta ? { metaJson } : {}),
          },
        });
      }
    }
    if (!project) {
      project = await db.project.create({
        data: {
          userId: actualUserId,
          title,
          rawPrompt: rawPrompt || "",
          nodesJson: JSON.stringify(nodes),
          edgesJson: JSON.stringify(edges),
          metaJson,
        },
      });
    }

    // the saved project and every cached project list are out of date now (id may differ from project.id on a re-create)
    invalidateProjects(id, project.id);

    return NextResponse.json({ success: true, project }, { status: 200 });
  } catch (error: any) {
    console.error("Save project error:", error);
    return NextResponse.json({ error: error?.message || "Failed to save project" }, { status: 500 });
  }
});
