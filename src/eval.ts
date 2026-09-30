// Compare the grounded agent with the same model alone on the held-out test pairs.
//   node --experimental-strip-types src/eval.ts [--split test|train|all]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectKnowledgeBase, modelName, review } from "./agent.ts";
import { casesPath, loadItems, score, type Item } from "./core.ts";

const here = dirname(fileURLToPath(import.meta.url));
const split = (process.argv[process.argv.indexOf("--split") + 1] ?? "test") as "train" | "test" | "all";
const items = loadItems(casesPath(join(here, "..")), join(here, "../content/split.json"),
  process.argv.includes("--split") ? split : "test");

const kb = await connectKnowledgeBase();
const report: Record<string, unknown> = { model: modelName(), items: items.length };
try {
  for (const mode of ["no_kb", "kb"] as const) {
    const results: { item: Item; verdict: "ok" | "error" | null; detail?: unknown }[] = [];
    for (const item of items) {
      try {
        const started = Date.now();
        const out = await review(item, mode === "kb" ? kb : null);
        results.push({ item, verdict: out.review.verdict, detail: out });
        console.log(`${mode} ${results.length}/${items.length} ${item.caseId}:${item.half} -> ${out.review.verdict} (${Math.round((Date.now() - started) / 1000)}s)`);
      } catch (error) {
        results.push({ item, verdict: null, detail: String(error) });
        console.log(`${mode} ${results.length}/${items.length} ${item.caseId}:${item.half} -> FAILED ${String(error).slice(0, 120)}`);
      }
    }
    report[mode] = { score: score(results), runs: results };
    console.log(mode, score(results));
  }
} finally {
  await kb.close();
}
const out = join(here, "../results", `eval-${Date.now()}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 1));
console.log("wrote", out);
