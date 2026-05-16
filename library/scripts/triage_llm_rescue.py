"""LLM-rescue stage for triage rows the heuristic + marker-rescue
couldn't resolve.

Reads a triage JSONL (output of `triage_batch.py --marker-rescue`),
filters to rows whose `proposedCitekey` is empty / matches the
filename stem / has a stopword lastname, and emits a per-row
LLM-rescue prompt + merged output JSONL. For chunks of ~30 rows it's
cheap enough (~$0.01-0.05/row with Sonnet) to run as a final pass
before `triage_apply.py`. Optionally backfills missing pub-years via
Crossref (5 req/sec rate-limited).

Designed to be invoked from `/library/triage-pending` via the
`--llm-rescue` mode. The skill prompt should:

1. Run `triage_batch.py --marker-rescue` → `triage.rescued.jsonl`.
2. Run `triage_llm_rescue.py triage.rescued.jsonl triage.llm.jsonl`
   to spawn per-row LLM subagents and merge back.
3. Run `triage_apply.py < triage.llm.jsonl`.

This script does not call the LLM directly — it dispatches per-row
prompts to the Claude Agent SDK via the standard `Agent` tool from
inside the skill. The skill is responsible for orchestrating the
~30-row chunks; this script handles only:

- Selection of which rows need LLM rescue.
- Generation of the per-row prompt text.
- Crossref year-backfill for rows where the LLM found title+author
  but no year.
- Merge of the per-row LLM outputs back into the JSONL.

Usage:
    # Phase 1: filter + emit prompts.
    python3 triage_llm_rescue.py emit-prompts \\
        <input.jsonl> --out-dir <dir>

    # Phase 2: skill dispatches Agent per prompt, writes
    # <dir>/responses/<row-id>.json. Then merge:
    python3 triage_llm_rescue.py merge-responses \\
        <input.jsonl> --responses-dir <dir>/responses \\
        --output <output.jsonl>

    # Optional: backfill years via Crossref.
    python3 triage_llm_rescue.py crossref-year-backfill \\
        <input.jsonl> --output <output.jsonl>
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


STOPWORD_AUTHORS = frozenset({
    "the", "a", "an", "of", "in", "on", "for", "and", "or",
    "editors", "edited", "press", "university", "publishing",
    "blackwell", "wiley", "springer", "elsevier", "routledge",
    "cuny", "mit", "ucla", "harvard", "oxford", "cambridge",
})


def _needs_rescue(row: dict) -> bool:
    """Same criterion as triage_batch._needs_marker_rescue, plus
    "marker-rescue ran and still failed"."""
    if row.get("extension") != "pdf":
        return False
    ck = row.get("proposedCitekey", "")
    if not ck:
        return True
    if "needs-metadata" in (row.get("flags") or []):
        return True
    # Citekey shaped `<stopword>YYYY...` — heuristic picked a
    # stopword as the author.
    m = re.match(r"^([a-z]+)\d{4}", ck)
    if m and m.group(1) in STOPWORD_AUTHORS:
        return True
    # Citekey is the filename stem (heuristic gave up).
    stem = Path(row.get("filename", "")).stem.lower()
    if ck == stem:
        return True
    return False


def _prompt_for_row(row: dict) -> str:
    """Generate the per-row LLM prompt."""
    filename = row.get("filename", "")
    byline = row.get("byline", []) or []
    text_preview = row.get("textPreview", "")[:1500]
    return f"""You are extracting bibliographic metadata from a triage row.

Filename: {filename}
Heuristic byline candidates: {json.dumps(byline)}
First-page text (truncated):

{text_preview}

Identify the paper's title, first-author surname, and publication
year. Return strict JSON with these fields:

{{
  "title": "<full title or empty string>",
  "surname": "<first author surname (lowercase, ASCII)>",
  "year": "<4-digit year or empty string>",
  "confidence": "<high|medium|low>",
  "needs_crossref": <true if you need title+author lookup to fill year>
}}

Do not invent metadata. If a field is genuinely absent from the visible
text, return empty string. If the surname is a publisher / institution
word ("press", "university", "editors"), return empty string instead
of the bad value.
"""


def emit_prompts(input_jsonl: Path, out_dir: Path) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    prompts_dir = out_dir / "prompts"
    prompts_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    rows = _read_jsonl(input_jsonl)
    for idx, row in enumerate(rows):
        if not _needs_rescue(row):
            continue
        prompt = _prompt_for_row(row)
        (prompts_dir / f"row-{idx:04d}.txt").write_text(prompt, encoding="utf-8")
        count += 1
    (out_dir / "manifest.json").write_text(
        json.dumps({"prompts": count, "input": str(input_jsonl)}, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {count} prompts to {prompts_dir}/", file=sys.stderr)
    return count


def merge_responses(
    input_jsonl: Path, responses_dir: Path, output_jsonl: Path,
) -> int:
    rows = _read_jsonl(input_jsonl)
    merged = 0
    for idx, row in enumerate(rows):
        if not _needs_rescue(row):
            continue
        resp_path = responses_dir / f"row-{idx:04d}.json"
        if not resp_path.exists():
            continue
        try:
            resp = json.loads(resp_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        title = (resp.get("title") or "").strip()
        surname = (resp.get("surname") or "").strip().lower()
        year = (resp.get("year") or "").strip()
        if surname in STOPWORD_AUTHORS or len(surname) < 2:
            continue
        if surname and year:
            from re import sub as _sub
            stem = _sub(r"[^a-z]", "", surname)
            word = _first_title_word(title)
            row["proposedCitekey"] = f"{stem}{year}{word}"
            if "needs-metadata" in (row.get("flags") or []):
                row["flags"] = [f for f in row["flags"] if f != "needs-metadata"]
            if title:
                row.setdefault("proposedFields", {})["title"] = title
            row.setdefault("notes", []).append(
                f"llm-rescue: surname={surname!r} year={year!r} conf={resp.get('confidence', '?')}"
            )
            merged += 1
        elif surname and title and resp.get("needs_crossref"):
            row.setdefault("notes", []).append(
                f"llm-rescue: title+author found, needs crossref year backfill"
            )
            row.setdefault("proposedFields", {})["title"] = title
            row["_llm_surname"] = surname
            row["_llm_needs_crossref"] = True
    _write_jsonl(output_jsonl, rows)
    print(f"Merged {merged} LLM responses into {output_jsonl}", file=sys.stderr)
    return merged


def crossref_year_backfill(input_jsonl: Path, output_jsonl: Path) -> int:
    rows = _read_jsonl(input_jsonl)
    backfilled = 0
    for row in rows:
        if not row.get("_llm_needs_crossref"):
            continue
        title = (row.get("proposedFields") or {}).get("title", "")
        surname = row.get("_llm_surname", "")
        if not title or not surname:
            continue
        year = _crossref_lookup_year(surname, title)
        if not year:
            continue
        # Mint citekey now.
        stem = re.sub(r"[^a-z]", "", surname.lower())
        word = _first_title_word(title)
        row["proposedCitekey"] = f"{stem}{year}{word}"
        if "needs-metadata" in (row.get("flags") or []):
            row["flags"] = [f for f in row["flags"] if f != "needs-metadata"]
        row.setdefault("notes", []).append(
            f"crossref-backfill: year={year}"
        )
        row.pop("_llm_needs_crossref", None)
        row.pop("_llm_surname", None)
        backfilled += 1
        # Rate-limit: 5 req/sec.
        time.sleep(0.2)
    _write_jsonl(output_jsonl, rows)
    print(f"Backfilled {backfilled} years via Crossref", file=sys.stderr)
    return backfilled


def _crossref_lookup_year(surname: str, title: str) -> str:
    qparts = []
    if surname:
        qparts.append(f"query.author={urllib.parse.quote(surname)}")
    if title:
        qparts.append(f"query.title={urllib.parse.quote(title[:120])}")
    qparts.append("rows=3")
    url = "https://api.crossref.org/works?" + "&".join(qparts)
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Virgil-Library-triage-rescue/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return ""
    items = (data.get("message") or {}).get("items") or []
    if not items:
        return ""
    first = items[0]
    issued = first.get("issued") or {}
    parts = issued.get("date-parts") or []
    if parts and parts[0]:
        return str(parts[0][0])
    return ""


def _first_title_word(title: str) -> str:
    stopwords = {"the", "a", "an", "of", "on", "in", "and", "or", "for"}
    for w in re.findall(r"[A-Za-z]+", title):
        lw = w.lower()
        if lw in stopwords:
            continue
        return lw[:10]
    return ""


def _read_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_emit = sub.add_parser("emit-prompts")
    p_emit.add_argument("input", type=Path)
    p_emit.add_argument("--out-dir", type=Path, required=True)
    p_merge = sub.add_parser("merge-responses")
    p_merge.add_argument("input", type=Path)
    p_merge.add_argument("--responses-dir", type=Path, required=True)
    p_merge.add_argument("--output", type=Path, required=True)
    p_cr = sub.add_parser("crossref-year-backfill")
    p_cr.add_argument("input", type=Path)
    p_cr.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    if args.cmd == "emit-prompts":
        emit_prompts(args.input, args.out_dir)
    elif args.cmd == "merge-responses":
        merge_responses(args.input, args.responses_dir, args.output)
    elif args.cmd == "crossref-year-backfill":
        crossref_year_backfill(args.input, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
