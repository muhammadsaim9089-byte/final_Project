// Stands in for the Groq API in tests: groq-sdk calls the global fetch, so swapping it means no network and no cost.

export interface GroqReply {
  status?: number;
  content?: string;
  finish?: string;
  headers?: Record<string, string>;
}

export interface SentRequest {
  url: string;
  body: any;
}

/**
 * Runs `run` with GROQ_API_KEY set and fetch answering like Groq's chat-completions endpoint — one reply per call,
 * the last reply repeating. Every request body is recorded in `sent`.
 */
export async function withGroq<T>(replies: GroqReply | GroqReply[], run: (sent: SentRequest[]) => Promise<T>): Promise<T> {
  const queue = Array.isArray(replies) ? replies : [replies];
  const realFetch = globalThis.fetch;
  const realKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "gsk_test_key";
  const sent: SentRequest[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const reply = queue[Math.min(sent.length, queue.length - 1)];
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    const status = reply.status ?? 200;
    const body =
      status === 200
        ? {
            id: `chatcmpl-${sent.length}`,
            object: "chat.completion",
            created: 1,
            model: "openai/gpt-oss-120b",
            choices: [{ index: 0, message: { role: "assistant", content: reply.content ?? "" }, finish_reason: reply.finish ?? "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }
        : { error: { message: "Rate limit reached for model in organization org_test", type: "tokens", code: "rate_limit_exceeded" } };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-should-retry": "false", ...reply.headers } });
  }) as typeof fetch;
  try {
    return await run(sent);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = realKey;
  }
}
