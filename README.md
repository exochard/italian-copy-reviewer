# Italian copy reviewer

An agent that reviews the Italian copy of a software website before release. It reads the
team's Italian style guide from a Sanity Knowledge Base through the Sanity Context MCP
endpoint, flags what a native reviewer would change, proposes the fix and cites the rules
it used.

Built for the [DEV Sanity Challenge](https://dev.to/challenges/sanity-2026-09-16), Path One.

## How it works

- `content/rules.json`, `content/glossary.json`: 15 rules and 19 glossary terms. Every
  rule carries real examples of strings shipped on live Italian product pages, taken from
  the train half of a 29-pair benchmark (`content/cases.jsonl`, brand names masked). The
  test half never enters the Knowledge Base (`content/split.json`; `src/core.test.ts`
  asserts the split is disjoint).
- `content/build_seed.py` → `content/seed.ndjson`: the Sanity documents (`l10nRule`,
  `glossaryTerm`), modelled in `studio/schemaTypes/`.
- Knowledge Base sources: the dataset above, plus Microsoft's public
  [Italian Localization Style Guide](https://download.microsoft.com/download/f/f/7/ff70427c-1f7e-429f-96be-724d2e49cd47/ITA-ITA-STYLEGUIDE.PDF).
  Where the two disagree, Sanity Context surfaces both claims with their sources.
- `src/agent.ts`: AI SDK `generateText` with the Context MCP tools (`initial_context`,
  `knowledge_base_read`) and a typed `Review` output (verdict, reason, corrected text,
  cited entry paths). The same call without tools is the baseline.
- `src/eval.ts`: runs the grounded agent and the bare model on the held-out pairs. A pair
  scores only when the shipped bug is flagged **and** its native fix is left alone, so a
  reviewer that flags everything scores zero.
- `src/server.ts` + `public/index.html`: a local web UI. `src/cli.ts`: one string from the
  command line.

## Setup

Needs Node 22+, a free Sanity account and a Gemini API key (Google AI Studio free tier).

1. Create a Sanity project; note the project ID and organization ID. In Manage → Labs,
   enable **Context**.
2. `npm install && (cd studio && npm install)`, then
   `cd studio && SANITY_STUDIO_PROJECT_ID=<id> npx sanity login`, `npm run deploy-schema`
   and `npm run import-seed`.
3. Dashboard → Context → **New knowledge base**. Add the **Dataset** (production) and the
   Microsoft style guide (as a file, or as a website source with the URL above). Build the
   entries and note the knowledge base id (`kb…`).
   After any later import, rebuild it (Sources → Check for changes, then Rebuild): the
   entries are a built snapshot and an import alone does not change them. Document IDs use
   dashes, not dots, because Sanity keeps dotted IDs private even in a public dataset.
4. Create a Context MCP configuration in knowledge-base mode; note its endpoint name.
5. Manage → API → Tokens, at organization level: a token with **Context Viewer**.
6. Write `.env`:

   ```
   SANITY_ORG_ID=...
   SANITY_CONTEXT_ENDPOINT=...
   SANITY_KB_ID=...
   SANITY_ORG_TOKEN=...
   GOOGLE_GENERATIVE_AI_API_KEY=...
   ```

## Run

```
npm test                  # unit tests, no network
npm run review -- "Fidato da oltre 2.000 negozi" --context "homepage" --en "Trusted by 2,000+ shops"
npm run eval              # grounded agent vs bare model on the held-out pairs
npm run serve             # web UI on http://localhost:5174
```

`LLM_MODEL` overrides the model (default `gemini-3.1-flash-lite`).

## Results

Held-out test pairs (12), `gemini-3.1-flash-lite`, pairs fully right (`npm run eval`):

| Test run | Model alone | Model + Sanity Knowledge Base |
|---|---:|---:|
| 2026-09-28, first version | 7/12 | 4/12 |
| 2026-09-29, quote check | 9/12 | 5/12 |
| 2026-09-30, per-rule trigger check | 9/12 | 9/12 |
| 2026-10-01, same filter on both arms (`--shared-filter`) | 10/12 | 11/12 |

House-style pairs (16, `npm run eval -- --split house --shared-filter`), 2026-10-01: model alone
0/16, with the Knowledge Base 10/16, no correct string flagged by either arm. These pairs
break rules the team chose (tu not Lei, "persona" not "utente", 29 €, no "!") and exist only
in the Knowledge Base, so they measure what grounding adds, not how often real copy breaks them.

Sep 30 run: model alone 11/12 bugs caught and 10/12 fixes left alone; with
the Knowledge Base 10/12 and 11/12. Every change was tuned on the 17 train
pairs, except the literal-text line in the prompt, which came from a test failure.
`node --experimental-strip-types src/rescore.ts results/eval-<id>.json` re-applies the flag
checks to a saved run without calling a model; on the last train run it moves the grounded
agent from 12/17 to 16/17.

## How it was made

Written with an AI coding assistant (Claude Code) against a spec and acceptance checks,
then reviewed and tested by hand. The benchmark strings and their corrections come from
Italian QA audits of real product pages.
