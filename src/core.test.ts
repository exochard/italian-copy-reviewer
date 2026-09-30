import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { casesPath, contextMcpUrl, grounded, loadItems, Review, score, userPrompt } from "./core.ts";

const here = dirname(fileURLToPath(import.meta.url));
const cases = casesPath(join(here, ".."));
const split = join(here, "../content/split.json");

test("endpoint url carries the knowledge-base mode and id", () => {
  const url = new URL(contextMcpUrl("org 1", "l10n", "kbAbc"));
  assert.equal(url.pathname, "/v1/context/organizations/org%201/mcp/l10n");
  assert.equal(url.searchParams.get("mode"), "knowledge_base");
  assert.equal(url.searchParams.get("knowledgeBases"), "kbAbc");
});

test("the test split is disjoint from train and both halves are loaded", () => {
  const testItems = loadItems(cases, split, "test");
  const trainItems = loadItems(cases, split, "train");
  const testIds = new Set(testItems.map((i) => i.caseId));
  assert.ok(trainItems.every((i) => !testIds.has(i.caseId)));
  assert.equal(testItems.length, testIds.size * 2);
});

test("flagging everything scores zero; a perfect reviewer scores one", () => {
  const items = loadItems(cases, split, "test");
  assert.equal(score(items.map((item) => ({ item, verdict: "error" as const }))).pairedScore, 0);
  const perfect = items.map((item) => ({ item, verdict: item.half === "shipped" ? ("error" as const) : ("ok" as const) }));
  assert.equal(score(perfect).pairedScore, 1);
});

test("prompt includes the English source only when there is one", () => {
  const base = { product: "p", context: "c", text: "t" };
  assert.ok(userPrompt({ ...base, englishSource: "src" }).includes("English source: <<<src>>>"));
  assert.ok(!userPrompt({ ...base, englishSource: null }).includes("English source"));
  assert.ok(userPrompt({ ...base, englishSource: null }).includes("never a placeholder"));
});

test("review schema rejects an unknown verdict", () => {
  assert.equal(Review.safeParse({ verdict: "maybe", reason: "", evidence: [], corrected: "", rules: [] }).success, false);
});

test("a flag survives only when its evidence is in the text", () => {
  const flag = { verdict: "error" as const, reason: "r", corrected: "c", rules: [] };
  assert.equal(grounded({ ...flag, evidence: ["and More"] }, "da tutte le registrazioni and More").verdict, "error");
  assert.equal(grounded({ ...flag, evidence: ["Lascia un’immagine"] }, "Lascia un'immagine").verdict, "error");
  assert.equal(grounded({ ...flag, evidence: ["Perché le Imprese Scelgono"] }, "Perché le imprese scelgono").verdict, "ok");
  assert.equal(grounded({ ...flag, evidence: ["Fidato da", "AI"] }, "Fidato da migliaia").verdict, "error");
  assert.equal(grounded({ ...flag, evidence: ["<<<USER GUIDE>>>"] }, "USER GUIDE").verdict, "error");
  assert.equal(grounded({ ...flag, evidence: ["AI"] }, "Offri video didattici").verdict, "ok");
  assert.equal(grounded({ ...flag, evidence: [" "] }, "Offri video didattici").verdict, "ok");
  const ok = { verdict: "ok" as const, reason: "r", evidence: [], corrected: "c", rules: [] };
  assert.deepEqual(grounded(ok, "x"), ok);
});

test("a flag that relies only on trigger rules needs one trigger in the text", () => {
  const flag = (text: string, rules: string[], reason = "r") =>
    grounded({ verdict: "error", reason, evidence: [text], corrected: text, rules }, text).verdict;
  const caps = ["Capitalization Rules for Italian UI"];
  // Title Case needs a capitalised word after the first; ALL CAPS and sentence starts do not count.
  assert.equal(flag("Pronto per Iniziare?", caps), "error");
  assert.equal(flag("Scopri tutte le funzionalità", ["grammar/capitalization"]), "ok");
  assert.equal(flag("RILEVATORE DI PLAGIO CON IA", caps), "ok");
  assert.equal(flag("Pronto? Inizia ora · Gratis", caps), "ok");
  assert.equal(flag("Scegli [BRAND] oggi", caps), "ok");
  // "+" rules need a plus sign; the AI rule needs "AI" and "IA" mixed in one text.
  const plus = ['Number & Quantity Formatting/Expressing quantities above a threshold ("+" sign)'];
  assert.equal(flag("6+ piattaforme", plus), "error");
  assert.equal(flag("Da 1 a oltre 15.000 computer", plus), "ok");
  assert.equal(flag("Offri video didattici", ["AI & Tech Abbreviations"]), "ok");
  assert.equal(flag("Basato sull'AI", ["ai_and_tech_abbreviations"]), "ok");
  assert.equal(flag("Basato sull'AI", ["rule.ai-abbreviation"]), "ok");
  assert.equal(flag("Basato sull'AI, rilevatore IA", ["linguistics/acronyms/ai-ia"]), "error");
  // Several trigger rules: the flag stays when one of them is triggered.
  assert.equal(flag("RILEVATORE DI PLAGIO CON IA", [...caps, "AI & Tech Abbreviations"]), "ok");
  assert.equal(flag("Pronto per Iniziare con l'AI", [...caps, "AI & Tech Abbreviations"]), "error");
  // Any other rule may still hold, so the flag stays.
  assert.equal(flag("AI PLAGIARISM CHECKER", ["untranslated_english", ...caps]), "error");
  assert.equal(flag("Lascia un'immagine", ["calques_and_false_friends"]), "error");
  // Without cited rules the reason names the rule.
  assert.equal(flag("Scopri tutte le funzionalità", [], "Uses English Title Case."), "ok");
  assert.equal(flag("Pronto per Iniziare?", [], "Uses English Title Case."), "error");
  assert.equal(flag("Perché le imprese scegli [BRAND]", [], "Verb agreement."), "error");
  assert.equal(flag("Offerte riservate ai clienti", [], "Manca l'articolo davanti ai clienti."), "error");
});
