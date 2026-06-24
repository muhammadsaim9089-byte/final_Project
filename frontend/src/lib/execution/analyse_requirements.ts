import Groq from "groq-sdk";
import { validateSchema } from "./utils/schema_validator";

export interface AnalyzeRequest {
  userRequirements: string;
  systemPrompt: string;
  fewShotExamples?: string[];
  model?: string;
  temperature?: number;
  existingSchema?: any;
}

export async function analyzeRequirements(req: AnalyzeRequest): Promise<any> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in environment variables. Please add it to your .env.local file.");
  }

  const groq = new Groq({ apiKey });
  const modelName = req.model || 'llama-3.3-70b-versatile';
  const temperature = req.temperature || 0.1;

  try {
    const messages: any[] = [
      { role: "system", content: req.systemPrompt }
    ];

    if (req.fewShotExamples && req.fewShotExamples.length > 0) {
      req.fewShotExamples.forEach((ex, i) => {
        messages.push({ role: "system", content: `Example ${i + 1}:\n${ex}` });
      });
    }

    if (req.existingSchema) {
      messages.push({ role: "system", content: `CRITICAL CONTEXT - CURRENT SCHEMA INSTANCE:\n${JSON.stringify(req.existingSchema)}` });
      messages.push({ role: "system", content: `INSTRUCTION: You are executing a mutation request on an existing database schema. You MUST return the entirely updated JSON schema including all unaffected tables. Do not destructively remove entities unless implicitly requested. Apply the user's modifications efficiently.` });
      messages.push({ role: "user", content: `Modification Request:\n${req.userRequirements}\n\nReturn the fully updated JSON schema now:` });
    } else {
      messages.push({ role: "user", content: `User Requirements:\n${req.userRequirements}\n\nReturn the structured JSON schema now:` });
    }

    const completion = await groq.chat.completions.create({
      messages: messages,
      model: modelName,
      temperature: temperature,
      response_format: { type: "json_object" }, // Crucial for valid JSON schema adherence
    });

    const content = completion.choices[0]?.message?.content || "";

    let parsedJson;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      throw new Error('Groq did not return parseable JSON.');
    }

    const validationResult = validateSchema(parsedJson);

    if (!validationResult.isValid) {
      throw new Error(`Generated Schema from Groq represents invalid database structure.`);
    }

    return validationResult.data;

  } catch (error: any) {
    throw error;
  }
}
