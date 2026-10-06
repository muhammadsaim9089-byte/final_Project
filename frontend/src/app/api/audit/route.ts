import { NextRequest, NextResponse } from 'next/server';
import { normalizeTo3NF } from '@/lib/execution/normalize_schema';
import { validateSchema } from '@/lib/execution/utils/schema_validator';
import { withRateLimit } from "@/lib/server/rateLimit";
import { cacheKey, caches, hashKey, memoResponse } from "@/lib/server/cache";

// deterministic: successful results are cached by request body (30 min; X-Cache: HIT)
export const POST = withRateLimit("read", async (req: NextRequest) => {
  const text = await req.text();
  return memoResponse(caches.compute, cacheKey.audit(hashKey(text)), () => audit(text));
});

async function audit(text: string): Promise<Response> {
  try {
    const { schema, strictMode } = JSON.parse(text);

    if (!schema) {
      return NextResponse.json({ error: 'Schema is required' }, { status: 400 });
    }

    // Validate the incoming schema
    const validation = validateSchema(schema);
    if (!validation.isValid) {
      return NextResponse.json({ error: 'Invalid schema format', details: validation.errors }, { status: 400 });
    }

    // Run deterministic normalization
    const normalizationResult = normalizeTo3NF({
      schema: validation.data!,
      options: { strictMode: !!strictMode, autoDecompose: true },
    });

    return NextResponse.json({
      normalizedSchema: normalizationResult.schema,
      issuesFound: normalizationResult.issuesFound,
      report: normalizationResult.report,
    });
  } catch (error: any) {
    console.error('Audit API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
