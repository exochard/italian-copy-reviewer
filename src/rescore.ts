// Re-score a saved eval offline, both ways: no model or Knowledge Base calls.
//   node --experimental-strip-types src/rescore.ts results/eval-<id>.json
// Each arm is scored with no filter and with grounded(), so the model-alone and Knowledge
// Base arms can be compared like for like. A saved review may already carry a dropped flag
// (older files); it is restored before the check, and `detail.raw` is used when present.
import { readFileSync } from "node:fs";
import { grounded, score, type Item, type Review } from "./core.ts";

const dropped = "Unsupported flag dropped: ";
type Run = { item: Item; verdict: "ok" | "error" | null; detail: { review?: Review; raw?: Review } | string };

export function rawReview(detail: Run["detail"]): Review | null {
  if (typeof detail === "string") return null;
  if (detail.raw) return detail.raw;
  const saved = detail.review;
  if (!saved) return null;
  return saved.reason.startsWith(dropped)
    ? { ...saved, verdict: "error", reason: saved.reason.slice(dropped.length) }
    : saved;
}

export function rescore(runs: Run[], filter: boolean) {
  return score(runs.map(({ item, verdict, detail }) => {
    const raw = rawReview(detail);
    if (!raw) return { item, verdict };
    return { item, verdict: filter ? grounded(raw, item.text).verdict : raw.verdict };
  }));
}

if (process.argv[1]?.endsWith("rescore.ts") && process.argv[2]) {
  const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const rows = [];
  for (const mode of ["no_kb", "kb"]) {
    if (!report[mode]) continue;
    for (const filter of [false, true]) {
      const s = rescore(report[mode].runs, filter);
      rows.push({ arm: mode, filter: filter ? "grounded()" : "none", bugs: s.bugsCaught,
        fixesKept: s.fixesLeftAlone, pairs: s.pairsFullyRight, failed: s.failed });
    }
  }
  console.table(rows);
  console.log("like for like = filter 'grounded()' on both arms; the original report is no_kb/none vs kb/grounded()");
}
