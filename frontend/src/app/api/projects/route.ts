import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/server/rateLimit";
import { loadProjectList } from "@/lib/server/cachedData";
import { cachedJson } from "@/lib/server/httpCache";

// reads the query string — always render on demand (keeps `next build` from trying to prerender it)
export const dynamic = "force-dynamic";

// Every project with its whole diagram: cached server-side (invalidated by every project write) and sent with an ETag,
// so a client that already has this list gets a 304 instead of the full payload again.
export const GET = withRateLimit("read", async (req: Request) => {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId") || "demo-user-id";
    const { value, hit } = await loadProjectList(userId);
    return cachedJson(req, value!.body, "private", { etag: value!.etag, headers: { "X-Cache": hit ? "HIT" : "MISS" } });
  } catch (error: any) {
    console.error("List projects error:", error);
    return NextResponse.json({ error: "Failed to list projects" }, { status: 500 });
  }
});
