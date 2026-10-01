// The reviewer agent: one model, optionally grounded in the Sanity Knowledge Base via Context MCP.
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { google } from "@ai-sdk/google";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { generateText, Output, stepCountIs, type LanguageModel } from "ai";
import { contextMcpUrl, grounded, Review, SYSTEM_NO_KB, SYSTEM_WITH_KB, userPrompt, type Item } from "./core.ts";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

// LLM_PROVIDER=bedrock runs the same agent on Amazon Bedrock with the standard AWS
// credential chain (`aws login`, a profile or env keys); the default is Gemini.
export function modelName(): string {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  return process.env.LLM_PROVIDER === "bedrock" ? "eu.amazon.nova-lite-v1:0" : "gemini-3.1-flash-lite";
}

export function model(): LanguageModel {
  if (process.env.LLM_PROVIDER === "bedrock") {
    const bedrock = createAmazonBedrock({ region: process.env.AWS_REGION ?? "eu-central-1",
      credentialProvider: fromNodeProviderChain() });
    return bedrock(modelName());
  }
  return google(modelName());
}

export async function connectKnowledgeBase(): Promise<MCPClient> {
  return createMCPClient({
    transport: {
      type: "http",
      url: contextMcpUrl(env("SANITY_ORG_ID"), env("SANITY_CONTEXT_ENDPOINT"), env("SANITY_KB_ID")),
      headers: { Authorization: `Bearer ${env("SANITY_ORG_TOKEN")}` },
    },
  });
}

export async function review(
  item: Pick<Item, "product" | "context" | "englishSource" | "text">,
  kb: MCPClient | null,
  // Default keeps the original behaviour: the code filter guards the grounded arm only.
  // The eval passes true to put the model-alone arm behind the same filter.
  filter: boolean = kb !== null,
): Promise<{ review: Review; raw: Review; toolCalls: { tool: string; input: unknown }[] }> {
  const finish = (raw: Review, text: string) => ({ review: filter ? grounded(raw, text) : raw, raw });
  // Free-tier Gemini answers 503 under load; the SDK backs off exponentially between tries.
  const common = { model: model(), temperature: 0, maxRetries: 8 } as const;
  if (!kb) {
    const result = await generateText({ ...common, system: SYSTEM_NO_KB, prompt: userPrompt(item),
      output: Output.object({ schema: Review }) });
    return { ...finish(result.output, item.text), toolCalls: [] };
  }
  // Gemini ends a tool loop with prose, not the requested object, so the grounded review
  // runs in two calls: the agent reads the Knowledge Base, then writes the typed verdict
  // from the entries it read.
  const research = await generateText({ ...common, system: SYSTEM_WITH_KB, prompt: userPrompt(item),
    tools: await kb.tools(), stopWhen: stepCountIs(6) });
  const toolCalls = research.steps.flatMap((step) =>
    step.toolCalls.map((call) => ({ tool: call.toolName, input: call.input })),
  );
  const read = research.steps.flatMap((step) =>
    step.toolResults.filter((r) => r.toolName === "knowledge_base_read").map((r) => JSON.stringify(r.output)),
  );
  const verdict = await generateText({ ...common, system: SYSTEM_WITH_KB,
    prompt: `${userPrompt(item)}

Knowledge Base entries you read:
${read.join("\n\n") || "(none)"}

Your notes after reading them:
${research.text}

Give the final review. In "rules", list the Knowledge Base entry paths you relied on.
In "evidence", copy each wrong fragment of the Italian text exactly, one per item.`,
    output: Output.object({ schema: Review }) });
  return { ...finish(verdict.output, item.text), toolCalls };
}
