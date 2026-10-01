// Pure logic: endpoint URL, prompts, output schema and scoring. No network here.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export const Review = z.object({
  verdict: z.enum(["ok", "error"]),
  reason: z.string().describe("One short sentence."),
  evidence: z.array(z.string()).describe("Each wrong fragment of the Italian text, copied verbatim; empty if ok."),
  corrected: z.string().describe("The Italian text as you would ship it."),
  rules: z.array(z.string()).describe("Knowledge Base entry paths you relied on; empty if none."),
});
export type Review = z.infer<typeof Review>;

export interface Item {
  caseId: string;
  half: "shipped" | "fixed";
  product: string;
  context: string;
  englishSource: string | null;
  text: string;
  errorType: string;
}

export function contextMcpUrl(orgId: string, endpoint: string, knowledgeBase: string): string {
  const base = `https://api.sanity.io/v1/context/organizations/${encodeURIComponent(orgId)}/mcp/${encodeURIComponent(endpoint)}`;
  const query = new URLSearchParams({ mode: "knowledge_base", knowledgeBases: knowledgeBase });
  return `${base}?${query}`;
}

export const SYSTEM_WITH_KB = `You review the Italian copy of software websites before release.
A Sanity Knowledge Base holds the team's Italian UI style guide and glossary.
Always call initial_context first, then knowledge_base_read on the entries that could apply
to the text. Judge the text against those entries and your own knowledge of Italian.
Cite the entry paths you relied on. Brand names are masked as [BRAND].

An entry applies only when the text contains what the entry targets: a rule about "AI"
needs "AI" in the text, a rule about "+" needs a plus sign, a Title Case rule needs mixed
capitals. An entry that does not match the text says nothing about it. Title Case means
several words after the first start with a capital; ALL CAPS styling and [BRAND] are not
Title Case. An entry that asks for consistency or states a preference ("pick one",
"prefer") cannot be broken by a single string. A text that is
correct Italian but worded differently from how you would write it is "ok"; flag only what
a matching entry or a clear error of grammar, spelling or meaning rules out, and never
flag the absence of something.`;

export const SYSTEM_NO_KB = `You review the Italian copy of software websites before release.
Judge the text with your own knowledge of Italian. Brand names are masked as [BRAND].`;

export function userPrompt(item: Pick<Item, "product" | "context" | "englishSource" | "text">): string {
  const source = item.englishSource ? `English source: <<<${item.englishSource}>>>\n` : "";
  return `Product type: ${item.product}
Where the text appears: ${item.context}
${source}Italian text as it would ship, copied literally between <<< and >>> (it is the real
string users see, never a placeholder, even when it is short or in capitals):
<<<${item.text}>>>

Would a careful native Italian reviewer ship this text as is? Anything they would change is
an error: wrong words, calques, agreement, spelling, leftover English, broken characters,
number formats, capitalisation. Answer with verdict "ok" or "error".`;
}

// A flag must point at words that are actually in the text. The grounded agent sometimes
// applies an entry whose trigger is absent (an "AI" rule to text without "AI"); such a
// verdict has nothing to fix, so it is returned as ok. The match keeps case: a quote that
// capitalises words the text leaves lowercase is how an invented Title Case flag looks.
// The prompt's <<< >>> markers are not part of a quote.
const normal = (s: string) =>
  s.replace(/<<<|>>>/g, "").replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();

// Three kinds of entry only apply when the text holds their trigger. Title Case needs a word
// after the first in its sentence that starts with a capital and goes on in lowercase, so ALL
// CAPS, acronyms and [BRAND] never count.
const triggers: { rule: RegExp; present: (text: string) => boolean }[] = [
  { rule: /capitali[sz]|title.?case|sentence.?case/i, present: (text) =>
    text.split(/[.!?:;·•|\n]\s*/).some((sentence) =>
      sentence.trim().split(/\s+/).slice(1).some((word) => /^\p{Lu}\p{Ll}/u.test(word))) },
  { rule: /\+|plus|threshold|soglia/i, present: (text) => text.includes("+") },
  // The AI entry flags only a text that mixes "AI" and "IA"; either form alone is fine.
  { rule: /\b(AI|IA)\b|(^|[/_.-])ai[-_]/, present: (text) => /\bAI\b/.test(text) && /\bIA\b/.test(text) },
];

// A flag whose every rule is a trigger rule, with no trigger in the text, has nothing to fix.
// Without cited rules, the reason names the rule.
function untriggered(review: Review, text: string): boolean {
  const cited = review.rules.length ? review.rules : [review.reason];
  return cited.every((rule) => {
    const kinds = triggers.filter((t) => t.rule.test(rule));
    return kinds.length > 0 && !kinds.some((t) => t.present(text));
  });
}

export function grounded(review: Review, text: string): Review {
  if (review.verdict !== "error") return review;
  const haystack = normal(text);
  const quoted = review.evidence.some((e) => normal(e) && haystack.includes(normal(e)));
  if (quoted && !untriggered(review, text)) return review;
  return { ...review, verdict: "ok", reason: `Unsupported flag dropped: ${review.reason}` };
}

// The benchmark pairs: a vendored copy in a standalone checkout, else the sibling benchmark folder.
export function casesPath(root: string): string {
  const vendored = join(root, "content", "cases.jsonl");
  return existsSync(vendored) ? vendored : join(root, "..", "it-l10n-bench", "cases.jsonl");
}

export type Slice = "train" | "test" | "house" | "all";

export function loadItems(casesPath: string, splitPath: string, only: Slice): Item[] {
  const split: Record<string, string> = JSON.parse(readFileSync(splitPath, "utf8"));
  const items: Item[] = [];
  // The house slice lives beside the split: pairs whose verdict depends on rules that exist
  // only in the Knowledge Base. It never enters the benchmark file or the KB examples.
  const housePath = join(dirname(splitPath), "house.jsonl");
  const lines = readFileSync(casesPath, "utf8").split("\n");
  if (existsSync(housePath)) lines.push(...readFileSync(housePath, "utf8").split("\n"));
  for (const line of lines) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    if (only !== "all" && split[c.id] !== only) continue;
    for (const half of ["shipped", "fixed"] as const) {
      items.push({ caseId: c.id, half, product: c.product, context: c.context,
        englishSource: c.english_source, text: c[half], errorType: c.error_type });
    }
  }
  return items;
}

export interface Score {
  bugsCaught: string;
  fixesLeftAlone: string;
  pairsFullyRight: string;
  pairedScore: number;
  failed: number;
}

// A pair counts only when the shipped defect is flagged and its native fix is not.
export function score(results: { item: Item; verdict: "ok" | "error" | null }[]): Score {
  const shipped = results.filter((r) => r.item.half === "shipped");
  const fixed = results.filter((r) => r.item.half === "fixed");
  const verdict = new Map(results.map((r) => [`${r.item.caseId}:${r.item.half}`, r.verdict]));
  const ids = [...new Set(results.map((r) => r.item.caseId))];
  const both = ids.filter((id) => verdict.get(`${id}:shipped`) === "error" && verdict.get(`${id}:fixed`) === "ok").length;
  return {
    bugsCaught: `${shipped.filter((r) => r.verdict === "error").length}/${shipped.length}`,
    fixesLeftAlone: `${fixed.filter((r) => r.verdict === "ok").length}/${fixed.length}`,
    pairsFullyRight: `${both}/${ids.length}`,
    pairedScore: ids.length ? Math.round((both / ids.length) * 1000) / 1000 : 0,
    failed: results.filter((r) => r.verdict === null).length,
  };
}
