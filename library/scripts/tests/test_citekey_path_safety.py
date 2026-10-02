"""A citekey is a folder name — one safe segment, or nothing is written (task 894).

WHY THIS EXISTS. The bib parser accepts any key characters but `,`, whitespace
and `}`, so `@article{journals/jphil/Smith20,` (a DBLP export) and
`@article{../../notes,` (a hostile one) parsed as citekeys. A `.bib` dropped in
`unsorted/` fans out per entry, and every key went straight into
`library / "papers" / citekey`: the first nested a folder the app's scan does
not treat as a paper, the second wrote `references.bib` OUTSIDE `papers/`.

The rule is now stated ONCE (`_tools.citekey_path_problem`) and enforced at
the doors:
  * ADMISSION — `triage_batch` flags `bib-unsafe-citekey` and proposes a
    path-safe spelling, so the entry is not lost; apply records the original
    as an alias.
  * EVERY key→path join — `_tools.paper_folder` raises `UnsafeCitekey`; the
    queue slot (`queue_slot.slot_filename`) refuses the same keys; and
    `triage_apply` refuses a reviewer-typed unsafe key before writing anything.
  * The CENSUS below pins that no `"papers" / <variable>` join survives outside
    the helper, so the next script cannot quietly re-open the hole.

Run: python3 library/scripts/tests/test_citekey_path_safety.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

from _standalone import main as _standalone_main  # noqa: E402
import _tools  # noqa: E402
import queue_slot  # noqa: E402

BATCH = _SCRIPTS / "triage_batch.py"
APPLY = _SCRIPTS / "triage_apply.py"


def _check(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _raises(fn, exc=_tools.UnsafeCitekey) -> bool:
    try:
        fn()
    except exc:
        return True
    return False


# ── the predicate ─────────────────────────────────────────────────────

SAFE = ["smith2020", "Tichý1976", "o'neill1999", "a..b", "x-y_z:1", "a" * 200]
UNSAFE = ["", "  ", "a/b", "../evil", "..", ".", ".hidden", "a\\b", "a\x00b",
          "a\nb", " lead", "trail ", "a" * 201, "é" * 101]


def test_predicate_accepts_ordinary_keys():
    for ck in SAFE:
        _check(_tools.is_path_safe_citekey(ck), f"{ck!r} wrongly refused: "
               f"{_tools.citekey_path_problem(ck)}")


def test_predicate_refuses_every_escape_shape():
    for ck in UNSAFE:
        _check(not _tools.is_path_safe_citekey(ck), f"{ck!r} wrongly accepted")


def test_sanitize_yields_a_safe_spelling_or_nothing():
    _check(_tools.sanitize_citekey("journals/jphil/Smith20") == "journals-jphil-Smith20",
           _tools.sanitize_citekey("journals/jphil/Smith20"))
    _check(_tools.sanitize_citekey("../../notes") == "notes",
           _tools.sanitize_citekey("../../notes"))
    _check(_tools.sanitize_citekey("../..") == "", "nothing usable must be ''")
    for ck in UNSAFE + SAFE:
        out = _tools.sanitize_citekey(ck)
        _check(out == "" or _tools.is_path_safe_citekey(out), f"{ck!r} → unsafe {out!r}")
    # A safe key is its own sanitized spelling — admission changes nothing.
    for ck in SAFE:
        _check(_tools.sanitize_citekey(ck) == ck, f"safe {ck!r} was rewritten")


# ── the doors ─────────────────────────────────────────────────────────


def test_paper_folder_refuses_unsafe_and_joins_safe(tmp_path):
    _check(_tools.paper_folder(tmp_path, "smith2020") == tmp_path / "papers" / "smith2020",
           "safe join wrong")
    for ck in UNSAFE:
        _check(_raises(lambda: _tools.paper_folder(tmp_path, ck)), f"{ck!r} joined")


def test_queue_slot_refuses_unsafe_keys(tmp_path):
    _check(_raises(lambda: queue_slot.slot_filename("authenticate", "../evil")),
           "queue slot accepted ../evil")
    _check(_raises(lambda: queue_slot.write_request(tmp_path, "index", "a/b")),
           "write_request accepted a/b")
    _check(not (tmp_path / "queue").exists() or not any((tmp_path / "queue").rglob("*")),
           "a refused request left a file")


def test_read_probes_answer_absent_rather_than_raise(tmp_path):
    _check(_tools.resolve_paper_source(tmp_path, "a/b") is None, "probe raised/answered")
    _check(_tools.references_bib_keys(tmp_path, "../x") == [], "probe raised/answered")
    _check(queue_slot.paper_indexed(tmp_path, "../x") is False, "probe raised/answered")


# ── end to end: a .bib drop with unsafe keys ──────────────────────────

BIB = """@article{journals/jphil/Smith20,
  title = {On Slashes},
  author = {Smith, Sam},
  year = {2020},
  journal = {Journal of Philosophy},
}

@article{../../evil,
  title = {Escaping},
  author = {Evil, Eve},
  year = {2021},
  journal = {Nowhere},
}

@article{Plain2019,
  title = {Control},
  author = {Plain, Pat},
  year = {2019},
  journal = {Somewhere},
}
"""


def _library(tmp_path: Path) -> Path:
    lib = tmp_path / "lib"
    for d in (".virgil", "papers", "unsorted"):
        (lib / d).mkdir(parents=True)
    (lib / "master.bib").write_text("")
    return lib


def _run(argv: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, *argv], cwd=str(cwd),
                          capture_output=True, text=True)


def _files_outside_papers(tmp_path: Path, lib: Path) -> list[str]:
    papers = lib / "papers"
    bad = []
    for p in tmp_path.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(lib) if p.is_relative_to(lib) else None
        if rel is None:
            bad.append(str(p.relative_to(tmp_path)))
        elif p.is_relative_to(papers) and len(p.relative_to(papers).parts) > 1:
            # papers/<one segment>/<anything> — the segment must be a safe key
            seg = p.relative_to(papers).parts[0]
            if not _tools.is_path_safe_citekey(seg):
                bad.append(str(rel))
    return bad


def test_bib_drop_with_unsafe_keys_is_admitted_sanitized(tmp_path):
    lib = _library(tmp_path)
    (lib / "unsorted" / "drop.bib").write_text(BIB)
    out = lib / "rows.jsonl"
    proc = _run([str(BATCH), "--library", ".", "--output", str(out)], lib)
    _check(proc.returncode == 0, f"batch failed: {proc.stderr}")
    rows = [json.loads(l) for l in out.read_text().splitlines() if l.strip()]
    by_orig = {r.get("originalCitekey", r["proposedCitekey"]): r for r in rows}

    dblp = by_orig["journals/jphil/Smith20"]
    _check("bib-unsafe-citekey" in dblp["flags"], f"no flag: {dblp['flags']}")
    _check(dblp["proposedCitekey"] == "journals-jphil-Smith20", dblp["proposedCitekey"])
    evil = by_orig["../../evil"]
    _check("bib-unsafe-citekey" in evil["flags"] and evil["proposedCitekey"] == "evil",
           f"{evil}")
    plain = by_orig["Plain2019"]
    _check("bib-unsafe-citekey" not in plain["flags"] and "originalCitekey" not in plain,
           f"control row was touched: {plain}")

    inp = lib / "apply.jsonl"
    inp.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    proc = _run([str(APPLY), "--library", ".", "--input", str(inp)], lib)
    _check(proc.returncode == 0, f"apply failed: {proc.stdout}\n{proc.stderr}")

    _check((lib / "papers" / "journals-jphil-Smith20" / "references.bib").exists(),
           f"sanitized folder missing: {proc.stdout}")
    _check((lib / "papers" / "evil" / "references.bib").exists(), "evil → papers/evil")
    _check((lib / "papers" / "Plain2019" / "references.bib").exists(), "control missing")
    _check(not (lib / "papers" / "journals").exists(), "nested papers/journals/ written")
    bad = _files_outside_papers(tmp_path, lib)
    _check(not bad, f"files outside the library/unsafe folders: {bad}")

    aliases = json.loads((lib / ".virgil" / "aliases.json").read_text())
    _check(aliases.get("journals/jphil/Smith20", {}).get("survivor") == "journals-jphil-Smith20",
           f"original key not aliased: {aliases}")


def test_apply_refuses_a_reviewer_typed_unsafe_key(tmp_path):
    """The reviewer may edit `proposedCitekey`; apply is the last door."""
    lib = _library(tmp_path)
    (lib / "unsorted" / "drop.bib").write_text(BIB)
    rows = [{
        "filename": "drop.bib", "extension": "bib", "flags": ["bib-only"],
        "proposedCitekey": "../escaped", "proposedType": "article",
        "proposedFields": {"title": "X"}, "proposedBibState": "unverified",
    }, {
        "filename": "paper.pdf", "extension": "pdf", "flags": [],
        "proposedCitekey": "a/b", "proposedType": "article", "proposedFields": {},
    }]
    (lib / "unsorted" / "paper.pdf").write_bytes(b"%PDF-1.4\n")
    inp = lib / "apply.jsonl"
    inp.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    proc = _run([str(APPLY), "--library", ".", "--input", str(inp)], lib)
    _check(proc.stdout.count("[unsafe-citekey]") == 2, f"not refused: {proc.stdout}")
    _check("escaped" not in (lib / "master.bib").read_text(), "master.bib written")
    _check((lib / "unsorted" / "paper.pdf").exists(), "refused PDF was moved")
    _check(not (tmp_path / "escaped").exists() and not (lib / "escaped").exists(),
           "escaped folder written")
    _check(not (lib / "papers" / "a").exists(), "nested folder written")
    _check(not (lib / "queue").exists() or not any((lib / "queue").iterdir()),
           "a request was queued for an unsafe key")


# ── census: no raw key→path join outside the helper ───────────────────

# `"papers" / <identifier>` (a variable segment) — the shape every pre-894
# site had. String-literal segments (`"papers" / "smith2020"` in fixtures)
# are not joins of an untrusted key and are not matched.
RAW_JOIN = re.compile(r'"papers"\s*/\s*(?![\s"\'])')
# The ONE sanctioned join.
ALLOWED = {("_tools.py", 'return Path(library) / "papers" / require_path_safe_citekey(citekey)')}


def test_census_no_raw_papers_join_outside_the_helper():
    offenders = []
    for py in sorted(_SCRIPTS.rglob("*.py")):
        if "tests" in py.relative_to(_SCRIPTS).parts:
            continue
        for n, line in enumerate(py.read_text().splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue
            if RAW_JOIN.search(line) and (py.name, line.strip()) not in ALLOWED:
                offenders.append(f"{py.name}:{n}: {line.strip()}")
    _check(not offenders, "raw `\"papers\" / <key>` joins — route through "
           "_tools.paper_folder:\n  " + "\n  ".join(offenders))
    # Accepting control: the pattern does see the sanctioned join.
    _check(RAW_JOIN.search(next(iter(ALLOWED))[1]), "census regex is blind")


if __name__ == "__main__":
    raise SystemExit(_standalone_main(dict(globals())))
