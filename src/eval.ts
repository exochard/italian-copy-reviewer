// Compare the grounded agent with the same model alone on the held-out test pairs.
//   node --experimental-strip-types src/eval.ts [--split test|train|house|all] [--shared-filter] [--arm kb|no_kb]
// --shared-filter puts the model-alone arm behind the same grounded() check as the KB arm.
// --arm runs one arm only (to split a slice across free-tier days).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectKnowledgeBase, modelName, review } from "./agent.ts";
import { casesPath, loadItems, score, type Item, type Slice } from "./core.ts";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const split = (arg("--split") ?? "test") as Slice;
const sharedFilter = process.argv.includes("--shared-filter");
const arm = arg("--arm");
const modes = (["no_kb", "kb"] as const).filter((m) => !arm || m === arm);
const items = loadItems(casesPath(join(here, "..")), join(here, "../content/split.json"), split);

const kb = await connectKnowledgeBase();
const report: Record<string, unknown> = { model: modelName(), split, sharedFilter, items: items.length };
try {
  for (const mode of modes) {
    const results: { item: Item; verdict: "ok" | "error" | null; detail?: unknown }[] = [];
    for (const item of items) {
      try {
        const started = Date.now();
        const out = await review(item, mode === "kb" ? kb : null, mode === "kb" || sharedFilter);
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
