// Local web UI: paste Italian strings, get a grounded review with the rules it cited.
//   node --experimental-strip-types src/server.ts   →  http://localhost:5174
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectKnowledgeBase, review } from "./agent.ts";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../public/index.html"));
const kb = await connectKnowledgeBase();
const port = Number(process.env.PORT ?? 5174);

createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page);
    return;
  }
  if (req.method === "POST" && req.url === "/api/review") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 20_000) { res.writeHead(413).end(); return; }
    }
    try {
      const input = JSON.parse(body);
      const text = String(input.text ?? "").slice(0, 2_000);
      if (!text.trim()) { res.writeHead(400).end("text is required"); return; }
      const out = await review({
        text, context: String(input.context ?? "website copy").slice(0, 200),
        englishSource: input.englishSource ? String(input.englishSource).slice(0, 2_000) : null,
        product: String(input.product ?? "software product").slice(0, 200),
      }, input.useKnowledgeBase === false ? null : kb);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain" }).end(String(error));
    }
    return;
  }
  res.writeHead(404).end();
}).listen(port, "127.0.0.1", () => console.log(`http://localhost:${port}`));
