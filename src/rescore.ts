// Re-apply the current grounded() to a saved eval, offline: no model or Knowledge Base calls.
//   node --experimental-strip-types src/rescore.ts results/eval-<id>.json
// A saved grounded review may already carry a dropped flag; it is restored before the check.
import { readFileSync } from "node:fs";
import { grounded, score, type Item, type Review } from "./core.ts";

const dropped = "Unsupported flag dropped: ";
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const mode of ["no_kb", "kb"]) {
  const runs: { item: Item; verdict: "ok" | "error" | null; detail: { review?: Review } | string }[] = report[mode].runs;
  const rescored = runs.map(({ item, verdict, detail }) => {
    if (typeof detail === "string" || !detail.review) return { item, verdict };
    const raw = detail.review.reason.startsWith(dropped)
      ? { ...detail.review, verdict: "error" as const, reason: detail.review.reason.slice(dropped.length) }
      : detail.review;
    const now = grounded(raw, item.text).verdict;
    if (now !== verdict) console.log(`${mode} ${item.caseId}:${item.half} ${verdict} -> ${now}`);
    return { item, verdict: now };
  });
  console.log(mode, "saved", report[mode].score.pairsFullyRight, "rescored", score(rescored));
}
