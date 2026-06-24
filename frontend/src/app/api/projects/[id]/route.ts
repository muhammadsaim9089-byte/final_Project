import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET a project by ID
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const projectId = params.id;

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

    const project = await db.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Parse stringified JSON fields back for SQLite consistency
    const parsedProject = {
      ...project,
      nodesJson: JSON.parse(project.nodesJson as string),
      edgesJson: JSON.parse(project.edgesJson as string),
    };

    return NextResponse.json({ success: true, project: parsedProject }, { status: 200 });
  } catch (error: any) {
    console.error("Fetch project error:", error);
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}

// DELETE a project by ID
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const projectId = params.id;

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

    await db.project.delete({
      where: { id: projectId },
    });

    return NextResponse.json({ success: true, message: "Project deleted successfully" }, { status: 200 });
  } catch (error: any) {
    console.error("Delete project error:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}

// POST to duplicate a project by ID (or other actions)
export async function POST(req: Request, { params }: { params: { id: string } }) {
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
        },
      });

      const parsedProject = {
        ...duplicated,
        nodesJson: JSON.parse(duplicated.nodesJson as string),
        edgesJson: JSON.parse(duplicated.edgesJson as string),
      };

      return NextResponse.json({ success: true, project: parsedProject }, { status: 200 });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error: any) {
    console.error("Duplicate project error:", error);
    return NextResponse.json({ error: "Failed to duplicate project" }, { status: 500 });
  }
}
