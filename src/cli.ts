// Review one string from the command line:
//   node --experimental-strip-types src/cli.ts "Fidato da oltre 2.000 negozi" --context "homepage" [--en "Trusted by 2,000+ shops"] [--no-kb]
import { connectKnowledgeBase, review } from "./agent.ts";

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const text = args[0];
if (!text || text.startsWith("--")) {
  console.error('usage: cli.ts "<italian text>" [--context <where>] [--en <english source>] [--product <type>] [--no-kb]');
  process.exit(2);
}
const kb = args.includes("--no-kb") ? null : await connectKnowledgeBase();
try {
  const out = await review({ text, context: flag("--context") ?? "website copy",
    englishSource: flag("--en") ?? null, product: flag("--product") ?? "software product" }, kb);
  console.log(JSON.stringify(out, null, 2));
} finally {
  await kb?.close();
}
