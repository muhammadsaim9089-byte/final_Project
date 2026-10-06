import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRateLimit } from "@/lib/server/rateLimit";
import { invalidateProjects } from "@/lib/server/cache";
import { loadProject } from "@/lib/server/cachedData";
import { cachedJson } from "@/lib/server/httpCache";

function safeParseJson(json: string | null | undefined): Record<string, any> {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

// GET a project by ID — cached server-side (invalidated by every write below and by /api/projects/save) and sent with an
// ETag, so reopening an unchanged project costs a 304
export const GET = withRateLimit("read", async (req: Request, { params }: { params: { id: string } }) => {
  try {
    const projectId = params.id;

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

    const { value, hit } = await loadProject(projectId);
    if (!value) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return cachedJson(req, value.body, "private", { etag: value.etag, headers: { "X-Cache": hit ? "HIT" : "MISS" } });
  } catch (error: any) {
    console.error("Fetch project error:", error);
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
});

// DELETE a project by ID
export const DELETE = withRateLimit("write", async (req: Request, { params }: { params: { id: string } }) => {
  try {
    const projectId = params.id;

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

    await db.project.delete({
      where: { id: projectId },
    });
    invalidateProjects(projectId);

    return NextResponse.json({ success: true, message: "Project deleted successfully" }, { status: 200 });
  } catch (error: any) {
    console.error("Delete project error:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
});

// PATCH { title } — rename without resending the whole diagram (the dashboard's "Rename")
export const PATCH = withRateLimit("write", async (req: Request, { params }: { params: { id: string } }) => {
  try {
    const body = await req.json().catch(() => ({}));
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
    if (!params.id || !title) {
      return NextResponse.json({ error: "A project id and a non-empty title are required" }, { status: 400 });
    }
    const existing = await db.project.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const project = await db.project.update({ where: { id: params.id }, data: { title } });
    invalidateProjects(params.id);
    return NextResponse.json({ success: true, project: { id: project.id, title: project.title, updatedAt: project.updatedAt } }, { status: 200 });
  } catch (error: any) {
    console.error("Rename project error:", error);
    return NextResponse.json({ error: "Failed to rename project" }, { status: 500 });
  }
});

// POST to duplicate a project by ID (or other actions)
export const POST = withRateLimit("write", async (req: Request, { params }: { params: { id: string } }) => {
  try {
    const projectId = params.id;
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

    const existingProject = await db.project.findUnique({
      where: { id: projectId },
    });

    if (!existingProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (action === "duplicate") {
      const duplicated = await db.project.create({
        data: {
          userId: existingProject.userId,
          title: `${existingProject.title} (Copy)`,
          rawPrompt: existingProject.rawPrompt,
          nodesJson: existingProject.nodesJson,
          edgesJson: existingProject.edgesJson,
          metaJson: JSON.stringify({ ...safeParseJson(existingProject.metaJson), versionKey: undefined }),
        },
      });
      invalidateProjects(duplicated.id);

      const parsedProject = {
        ...duplicated,
        nodesJson: JSON.parse(duplicated.nodesJson as string),
        edgesJson: JSON.parse(duplicated.edgesJson as string),
        meta: safeParseJson(duplicated.metaJson),
      };

      return NextResponse.json({ success: true, project: parsedProject }, { status: 200 });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error: any) {
    console.error("Duplicate project error:", error);
    return NextResponse.json({ error: "Failed to duplicate project" }, { status: 500 });
  }
});
