import { NextRequest, NextResponse } from 'next/server';
import { analyzeRequirements } from '@/lib/execution/analyse_requirements';
import { normalizeTo3NF } from '@/lib/execution/normalize_schema';
import { generateMermaid } from '@/lib/execution/generate_mermaid';
import { generateTables } from '@/lib/execution/export_sql';
import { SYSTEM_PROMPT, FEW_SHOT_EXAMPLES } from '@/lib/execution/prompts';

export async function POST(req: NextRequest) {
  try {
    const { prompt, existingSchema } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

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
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
