import { NextResponse } from "next/server";
import { db } from "@/lib/db";

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
