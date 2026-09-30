"""Build seed.ndjson for `sanity dataset import` from rules.json and glossary.json.

Rules carry real examples from the benchmark's train split only; the test split is held
out so the agent is measured on strings its Knowledge Base has never seen.
"""

import json
import re
from pathlib import Path

HERE = Path(__file__).parent
# A standalone checkout carries its own copy; the monorepo reads the benchmark folder.
CASES = HERE / "cases.jsonl"
if not CASES.exists():
    CASES = HERE.parent.parent / "it-l10n-bench" / "cases.jsonl"


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def build() -> list[dict]:
    cases = {c["id"]: c for c in map(json.loads, CASES.read_text(encoding="utf-8").splitlines())}
    split = json.loads((HERE / "split.json").read_text())
    docs = []
    for rule in json.loads((HERE / "rules.json").read_text(encoding="utf-8")):
        examples = [
            {"_key": cid, "_type": "example", "product": cases[cid]["product"],
             "context": cases[cid]["context"], "englishSource": cases[cid]["english_source"],
             "shipped": cases[cid]["shipped"], "fixed": cases[cid]["fixed"]}
            for cid in rule["cases"] if split.get(cid) == "train"
        ]
        docs.append({
            "_id": f"rule.{rule['slug']}", "_type": "l10nRule", "title": rule["title"],
            "slug": {"_type": "slug", "current": rule["slug"]}, "category": rule["category"],
            "severity": rule["severity"], "rule": rule["rule"], "prefer": rule["prefer"],
            "avoid": rule["avoid"], "examples": examples,
        })
    for term in json.loads((HERE / "glossary.json").read_text(encoding="utf-8")):
        docs.append({"_id": f"term.{slugify(term['english'])}", "_type": "glossaryTerm", **term})
    return docs


def main() -> None:
    docs = build()
    out = HERE / "seed.ndjson"
    out.write_text("".join(json.dumps(d, ensure_ascii=False) + "\n" for d in docs), encoding="utf-8")
    examples = sum(len(d.get("examples", [])) for d in docs)
    print(f"wrote {out.name}: {len(docs)} documents, {examples} train examples")


if __name__ == "__main__":
    main()
