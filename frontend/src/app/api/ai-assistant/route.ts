import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { parseDbml } from "@/lib/dbml/parser";
import { withRateLimit } from "@/lib/server/rateLimit";
import { upstreamAiBusy } from "@/lib/server/aiErrors";

export const dynamic = "force-dynamic";

const SYSTEM = `You are DesignDB's database design assistant. You design, modify and optimise database schemas written in DBML (Database Markup Language, as used by dbdiagram.io).

Rules:
- The user's current schema is provided as DBML. When the request changes the schema, return the COMPLETE updated DBML in exactly one fenced \`\`\`dbml code block, preserving every existing table, column, Ref, Enum, TableGroup, Note and setting unless the user asked to remove it.
- Use valid DBML only: Table, Ref (> < - <>), Enum, TableGroup, Note, indexes {}, column settings [pk, increment, not null, unique, default: ..., note: '...'], headercolor / color settings. One column per line.
- TableGroup members and Enum values are each on their OWN LINE — never separated by commas. A TableGroup's note is
  a "Note:" line INSIDE its own braces, or a "note" setting — there is no standalone "Note on X { }" statement:
  TableGroup billing [color: #4A90D9] {
    invoices
    payments
    Note: 'Billing and payment records'
  }
  Enum status {
    active
    inactive
  }
- Prefer snake_case names, an integer primary key named id on every table, foreign keys for every relationship, and sensible types for the target database.
- Above the code block write 1-4 short sentences explaining what you changed and why. If the request is only a question (no schema change), answer in plain text and do NOT include a code block.
- Never invent unrelated tables. Never output anything but the explanation and the single DBML block.`;

/** Extracts the reply text and the fenced ```dbml block (if any) from a completion. */
function splitReply(text: string): { reply: string; dbml?: string } {
  const m = /```(?:dbml)?\s*\n([\s\S]*?)```/i.exec(text);
  const reply = text.replace(/```(?:dbml)?\s*\n[\s\S]*?```/i, "").trim();
  return { reply, dbml: m ? m[1].trim() + "\n" : undefined };
}

export const POST = withRateLimit("ai", async (req: NextRequest) => {
  try {
    const { messages, dbml, dialect } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) return NextResponse.json({ error: "messages are required" }, { status: 400 });
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GROQ_API_KEY is not configured on the server. Add it to frontend/.env — the deterministic quick actions still work without it." }, { status: 503 });

    const groq = new Groq({ apiKey });
    const context = `Target database: ${dialect || "PostgreSQL"}\n\nCurrent schema (DBML):\n\`\`\`dbml\n${String(dbml || "").slice(0, 60_000)}\n\`\`\``;
    const history = messages.slice(-12).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 8000) }));
    const base = [{ role: "system", content: SYSTEM }, { role: "system", content: context }, ...history] as any[];

    const ask = (thread: any[]) =>
      groq.chat.completions.create({ model: "openai/gpt-oss-120b", messages: thread, temperature: 0.2, max_tokens: 8000 });

    let completion = await ask(base);
    let text = completion.choices?.[0]?.message?.content?.trim() || "";
    let { reply, dbml: proposed } = splitReply(text);

    // A model can slip on DBML syntax (e.g. comma-separating a TableGroup/Enum list). Rather than hand the
    // user an "Accept" button that fails, show it the parser's own error and give it one chance to fix its
    // output — this is invisible to the user when it works, which is most of the time.
    if (proposed) {
      let check = parseDbml(proposed);
      if (!check.ok) {
        const err = check.diagnostics.find((d) => d.severity === "error")?.message || "invalid DBML";
        const retryThread = [
          ...base,
          { role: "assistant", content: text },
          { role: "user", content: `That DBML failed to parse: ${err}. Return the corrected, COMPLETE DBML in one fenced \`\`\`dbml block — nothing else.` },
        ];
        completion = await ask(retryThread);
        text = completion.choices?.[0]?.message?.content?.trim() || "";
        const retried = splitReply(text);
        check = retried.dbml ? parseDbml(retried.dbml) : check;
        if (check.ok && retried.dbml) {
          reply = retried.reply || reply;
          proposed = retried.dbml;
        } else {
          // Still broken after one correction attempt — never forward unparseable DBML to the client as a
          // proposal; say so in plain language instead so there is no dead-end "Accept" button.
          reply = "I worked out the change, but the DBML I generated had a formatting problem I couldn't fix automatically. Could you try rephrasing the request, or asking for a smaller change?";
          proposed = undefined;
        }
      }
    }

    return NextResponse.json({ reply: reply || (proposed ? "Here is the updated schema." : text), dbml: proposed, usage: completion.usage });
  } catch (e: any) {
    const busy = upstreamAiBusy(e);
    if (busy) return busy;
    console.error("AI assistant error:", e);
    return NextResponse.json({ error: e?.message || "The AI assistant failed" }, { status: 500 });
  }
});
