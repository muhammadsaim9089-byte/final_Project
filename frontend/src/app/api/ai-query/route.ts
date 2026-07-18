import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';

export async function POST(req: NextRequest) {
  try {
    const { prompt, tables } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY not configured. Add it to your .env file.' },
        { status: 500 }
      );
    }

    const groq = new Groq({ apiKey });

    // Build schema context from table list
    let schemaContext = "";
    if (tables && typeof tables === 'object') {
      schemaContext = Object.entries(tables)
        .map(([tableName, cols]: [string, any]) => {
          const colList = (cols as { name: string; type: string }[])
            .map(c => `  ${c.name} ${c.type}`)
            .join('\n');
          return `TABLE ${tableName}:\n${colList}`;
        })
        .join('\n\n');
    }

    const systemPrompt = `You are a SQL query generator assistant. Given a database schema and a natural language request, generate the appropriate SQL query.

Rules:
- Output ONLY the raw SQL query, no explanations or markdown.
- Use standard SQL (SQLite compatible).
- Reference only the tables and columns provided in the schema.
- If the user's request is ambiguous, make reasonable assumptions.
- For SELECT queries, include appropriate LIMIT clauses when sensible.
- Support complex queries: JOINs, subqueries, aggregations, CTEs, window functions.

Database Schema:
${schemaContext || 'No schema available.'}`;

    const completion = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    });

    const generatedQuery = completion.choices?.[0]?.message?.content?.trim() || '';

    // Strip potential markdown code fences
    const cleanQuery = generatedQuery
      .replace(/^```sql\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    return NextResponse.json({ query: cleanQuery });
  } catch (error: any) {
    console.error('AI Query Generation Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate query' },
      { status: 500 }
    );
  }
}
