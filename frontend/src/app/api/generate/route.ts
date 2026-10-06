import { NextRequest, NextResponse } from 'next/server';
import { analyzeRequirements } from '@/lib/execution/analyse_requirements';
import { normalizeTo3NF } from '@/lib/execution/normalize_schema';
import { generateMermaid } from '@/lib/execution/generate_mermaid';
import { generateTables } from '@/lib/execution/export_sql';
import { SYSTEM_PROMPT, FEW_SHOT_EXAMPLES } from '@/lib/execution/prompts';
import { withRateLimit } from "@/lib/server/rateLimit";
import { upstreamAiBusy } from "@/lib/server/aiErrors";
import { cacheKey, caches, hashKey, memoResponse } from "@/lib/server/cache";

// Results are cached per prompt for 24 h: the home page's example chips send identical prompts, so their diagrams come back
// instantly without a Groq call, and a burst of identical requests shares one call. The key includes a hash of the
// prompts, so changing them starts afresh. On by default in production only — in development hot reloads keep the cache
// while you edit the pipeline (CACHE_AI=true turns it on there). `fresh: true` in the body skips the cached copy.
const PROMPT_VERSION = hashKey(SYSTEM_PROMPT, FEW_SHOT_EXAMPLES);
const aiCacheOn = () => process.env.NODE_ENV === "production" || process.env.CACHE_AI === "true";

export const POST = withRateLimit("ai", async (req: NextRequest) => {
  let input: { prompt?: string; existingSchema?: unknown; fresh?: unknown };
  try {
    input = (await req.json()) || {};
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
  const { prompt, existingSchema, fresh } = input;
  if (!prompt) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }
  // an edit of an existing schema depends on that schema: never cached
  if (existingSchema || !aiCacheOn()) return generate(prompt, existingSchema);
  const key = cacheKey.generate(hashKey(PROMPT_VERSION, String(prompt).trim().replace(/\s+/g, " ")));
  return memoResponse(caches.ai, key, () => generate(prompt, undefined), { fresh: fresh === true });
});

async function generate(prompt: string, existingSchema: unknown): Promise<Response> {
  try {
    // 1. Extract requirements or Mutate existing schema
    const rawSchema = await analyzeRequirements({
      userRequirements: prompt,
      systemPrompt: SYSTEM_PROMPT,
      fewShotExamples: FEW_SHOT_EXAMPLES,
      existingSchema: existingSchema,
    });

    // 2. Normalize to 3NF
    const normalizationResult = normalizeTo3NF({
      schema: rawSchema,
      options: { autoDecompose: true },
    });

    // 3. Generate Diagram Syntax
    const mermaid = generateMermaid(normalizationResult.schema);

    // 4. Generate SQL
    const sql = generateTables(normalizationResult.schema, 'postgres', {
      includeDropTables: true,
    });

    return NextResponse.json({
      schema: normalizationResult.schema,
      mermaid,
      sql,
      report: normalizationResult.report,
    });
  } catch (error: any) {
    const busy = upstreamAiBusy(error);
    if (busy) return busy;
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
