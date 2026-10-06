/**
 * SERVER-ONLY cached reads of saved projects and published diagrams, shared by the API routes and the startup warm-up
 * (src/instrumentation.ts). Writers invalidate: invalidateProjects() after a project write, cacheShare() / forgetShare()
 * after a share update / unpublish.
 */
import type { SharedDiagram } from "@prisma/client";
import { db } from "@/lib/db";
import { caches, cacheKey, type CachedBody } from "./cache";
import { etagOf } from "./httpCache";

function safeParse(json: string | null | undefined, fallback: unknown) {
  try {
    return json ? JSON.parse(json) : fallback;
  } catch {
    return fallback;
  }
}

function body(value: unknown): CachedBody {
  const b = JSON.stringify(value);
  return { body: b, etag: etagOf(b) };
}

// ─── projects ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The GET /api/projects body for one user (every project with its diagram, newest first). */
export function loadProjectList(userId: string) {
  return caches.projects.load(cacheKey.projectList(userId), async () => {
    const projects = await db.project.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
    return body({
      success: true,
      projects: projects.map((p) => ({
        ...p,
        nodesJson: safeParse(p.nodesJson, []),
        edgesJson: safeParse(p.edgesJson, []),
        meta: safeParse(p.metaJson, {}),
      })),
    });
  });
}

/** The GET /api/projects/[id] body; `value` is undefined when there is no such project. */
export function loadProject(id: string) {
  return caches.projects.load(cacheKey.project(id), async () => {
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return undefined;
    return body({
      success: true,
      project: {
        ...project,
        nodesJson: JSON.parse(project.nodesJson as string),
        edgesJson: JSON.parse(project.edgesJson as string),
        meta: safeParse(project.metaJson, {}),
      },
    });
  });
}

// ─── published diagrams ──────────────────────────────────────────────────────────────────────────────────────────────

export type ShareEntry = CachedBody & { row: SharedDiagram };

/** what a viewer receives for a diagram they may see */
export function sharePayload(row: Pick<SharedDiagram, "title" | "dbml" | "layoutJson" | "visibility" | "updatedAt">) {
  return { title: row.title, dbml: row.dbml, layout: safeParse(row.layoutJson, {}), visibility: row.visibility, updatedAt: row.updatedAt };
}

/** the row plus the public GET body (a password prompt for protected diagrams) */
export function shareEntry(row: SharedDiagram): ShareEntry {
  return { row, ...body(row.visibility === "password" ? { needsPassword: true, title: row.title } : sharePayload(row)) };
}

export async function loadShare(slug: string): Promise<ShareEntry | undefined> {
  const { value } = await caches.shares.load(cacheKey.share(slug), async () => {
    const row = await db.sharedDiagram.findUnique({ where: { slug } });
    return row ? shareEntry(row) : undefined;
  });
  return value as ShareEntry | undefined;
}

/** write-through after an update (the delete first stops a read that began before the write from storing old data) */
export function cacheShare(row: SharedDiagram) {
  const key = cacheKey.share(row.slug);
  caches.shares.delete(key);
  caches.shares.set(key, shareEntry(row));
}

/** after unpublishing */
export function forgetShare(slug: string) {
  caches.shares.delete(cacheKey.share(slug));
}
