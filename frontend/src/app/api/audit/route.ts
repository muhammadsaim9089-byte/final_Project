import { NextRequest, NextResponse } from 'next/server';
import { normalizeTo3NF } from '@/lib/execution/normalize_schema';
import { validateSchema } from '@/lib/execution/utils/schema_validator';

export async function POST(req: NextRequest) {
  try {
    const { schema, strictMode } = await req.json();

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
