import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId") || "demo-user-id";

    const projects = await db.project.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });

    const parsedProjects = projects.map(p => ({
      ...p,
      nodesJson: JSON.parse(p.nodesJson),
      edgesJson: JSON.parse(p.edgesJson),
    }));

    return NextResponse.json({ success: true, projects: parsedProjects }, { status: 200 });
  } catch (error: any) {
    console.error("List projects error:", error);
    return NextResponse.json({ error: "Failed to list projects" }, { status: 500 });
  }
}
