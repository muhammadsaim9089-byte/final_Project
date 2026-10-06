import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";

export const POST = withRateLimit("read", async (req: NextRequest) => {
  const { content, filename, mimeType } = await req.json();

  if (!content || !filename) {
    return NextResponse.json({ error: "Missing content or filename" }, { status: 400 });
  }

  const buffer = Buffer.from(content, "utf-8");

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.byteLength.toString(),
    },
  });
});
