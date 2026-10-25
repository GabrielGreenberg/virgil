"""Task 1122 — every library content/state write walks through ONE atomic door.

`_tools._atomic_write_bytes` (and its UTF-8 text sibling `_atomic_write_text`)
is temp-file + fsync + `os.replace`: the target is either its old bytes or its
new bytes, never a truncation. Before this task only the shared-state files
(catalog / inbox / aliases / master.bib) used it. The per-paper doors —
`write_paper_bib_entry` (THE references.bib writer), `index_paper`'s main.tex,
~45 deep-index fixers, the queue entries — wrote IN PLACE, so a kill or a full
disk mid-write truncated a deep-indexed paper's bibliography or text, and a
synced library shipped the stump. The door itself was also forked three ways
(`_refs_preimage`'s copy, `fuse_alternate`'s no-fsync hand roll, and the
canonical one writing in the LOCALE encoding while the copy wrote UTF-8).

Legs:
  * the door leaves the prior file byte-identical when the rename fails, and
    removes its temp file;
  * `write_paper_bib_entry` inherits that (the task's named contract);
  * the door writes UTF-8 whatever the locale says;
  * CENSUS: no `.write_text(` / `.write_bytes(` / `open(…, "w"|"a"|"x"|"+")`
    / `os.replace(` / `shutil.copy*(` / `shutil.move(` / `shutil.copytree(`
    in a library script outside the door, except the rows in
    `ALLOW` (reports, logs, scratch, self-test fixtures, locks) — and an
    `ALLOW` row nothing matches is itself a failure, so the list cannot rot;
  * the census SEES every spelling it bans (a fixture per spelling) — task
    1294: `index_paper`'s .tex passthrough wrote main.tex with
    `shutil.copyfile`, in place, and a census that scanned only
    `write_text`/`open` passed it unseen;
  * no second definition of the door anywhere in the tree.

Run: python3 library/scripts/tests/test_atomic_write_door.py
"""
from __future__ import annotations

import ast
import os
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import _tools  # noqa: E402

DOOR_NAMES = {"_atomic_write_bytes", "_atomic_write_text"}

# (script path relative to library/scripts, source of the write's target) →
# why a raw write is fine there. Every row names a file that is a REPORT, a LOG,
# SCRATCH, a self-test FIXTURE or a LOCK — never a paper's content or a library
# state file a later step reads back.
ALLOW: dict[tuple[str, str], str] = {
    ("_tools.py", "tmp"): "the door's own temp file",
    ("_tools.py", "lock_path"): "flock lock file (never holds content)",
    ("bulk_convert_numbered_examples.py", "Path(args.out)"): "report",
    ("extract_book_toc.py", "Path(args.out)"): "report",
    ("extract_pdf_footnotes.py", "out_path"): "derived report the caller re-runs",
    ("repair_etal_citekeys.py", "args.report"): "report",
    ("dedup.py", "Path(args.out)"): "plan report",
    ("dedup.py", "Path(args.report)"): "report",
    ("dedup.py", "manifest"): "append-only move log",
    ("index_paper.py", "log_dir / f'{slug}-index.log'"): "log",
    ("index_paper.py", "log_dir / f'{slug}-index.summary.md'"): "log",
    ("index_paper.py", "log_dir / f'{slug}-pgmark-continuity.md'"): "log",
    ("fuse_alternate.py", "log_path"): "log",
    ("triage_batch.py", "cache_path"): "re-derivable extraction cache",
    ("triage_batch.py", "Path(args.output).expanduser()"): "report",
    ("triage_llm_rescue.py", "prompts_dir / f'row-{idx:04d}.txt'"): "scratch",
    ("triage_llm_rescue.py", "out_dir / 'manifest.json'"): "scratch",
    ("triage_llm_rescue.py", "path"): "scratch JSONL (`_write_jsonl`)",
    ("rename_citekeys.py", "tmp / 'papers' / 'woods2002shape' / 'woods2002shape.pdf'"): "self-test fixture",
    ("rename_citekeys.py", "tmp / 'papers' / 'woods2002shape' / 'main.tex'"): "self-test fixture",
    ("rename_citekeys.py", "tmp / 'master.bib'"): "self-test fixture",
    ("rename_citekeys.py", "tmp / '.virgil' / 'catalog.json'"): "self-test fixture",
    ("rename_citekeys.py", "tmp / '.virgil' / 'aliases.json'"): "self-test fixture",
    ("dedup-run-2026-07-03/finalize_plan.py", "SCR / 'final_plan.json'"): "archived one-off run's report",
    # shutil copies/moves (task 1294). A COPY onto a content path writes in
    # place and is never allowed; these are backups or renames.
    ("_tools.py", "str(dest)"): "safe_move's rename fallback (the relocate door, task 619)",
    ("merge_bibs_preflight.py", "snap_dir / dst_name"): "pre-run backup snapshot",
    ("recover_ocr_pipeline.py", "archive_path"): "backup of the original PDF",
    ("recover_ocr_pipeline.py", "str(pdf_path)"): "rename of a finished temp PDF onto the source",
    ("index_paper.py", "dest / 'main.tex'"): "re-extract backup copy",
    ("index_paper.py", "str(dest / baseline.name)"): "re-extract backup move",
    ("index_paper.py", "str(backup)"): "backup of the original PDF",
    ("index_paper.py", "str(source_path)"): "rename of a finished OCR temp PDF onto the source",
}

# Every shutil call that writes its second argument. `copyfileobj` writes a
# file object some `open(…, "w")` already produced, which the census sees.
SHUTIL_WRITERS = {"copy", "copy2", "copyfile", "copytree", "move"}


def _script_files() -> list[Path]:
    out = []
    for p in sorted(SCRIPTS.rglob("*.py")):
        rel = p.relative_to(SCRIPTS)
        if rel.parts[0] in ("tests", "__pycache__") or "__pycache__" in rel.parts:
            continue
        if rel.name.startswith("test_") or rel.name == "_standalone.py":
            continue
        out.append(p)
    return out


def _is_write_mode(call: ast.Call) -> bool:
    mode = None
    if len(call.args) >= 2:
        mode = call.args[1]
    for kw in call.keywords:
        if kw.arg == "mode":
            mode = kw.value
    return (isinstance(mode, ast.Constant) and isinstance(mode.value, str)
            and any(c in mode.value for c in "wax+"))


def _raw_writes(path: Path) -> list[tuple[int, str, str]]:
    """(line, kind, target source) for every raw write in `path`."""
    return _raw_writes_in(path.read_text(encoding="utf-8"))


def _raw_writes_in(source: str) -> list[tuple[int, str, str]]:
    tree = ast.parse(source)
    # `from shutil import copyfile` — the bare name is the same write.
    shutil_names = {a.asname or a.name: a.name for n in ast.walk(tree)
                    if isinstance(n, ast.ImportFrom) and n.module == "shutil"
                    for a in n.names}
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if isinstance(f, ast.Attribute) and f.attr in ("write_text", "write_bytes"):
            found.append((node.lineno, f.attr, ast.unparse(f.value)))
        elif isinstance(f, ast.Name) and f.id == "open" and node.args and _is_write_mode(node):
            found.append((node.lineno, "open", ast.unparse(node.args[0])))
        elif (isinstance(f, ast.Attribute) and f.attr == "replace"
              and isinstance(f.value, ast.Name) and f.value.id == "os"):
            found.append((node.lineno, "os.replace", ast.unparse(node.args[0]) if node.args else ""))
        elif (isinstance(f, ast.Attribute) and f.attr in SHUTIL_WRITERS
              and isinstance(f.value, ast.Name) and f.value.id == "shutil"):
            found.append((node.lineno, f"shutil.{f.attr}", _second_arg(node, "dst")))
        elif isinstance(f, ast.Name) and shutil_names.get(f.id) in SHUTIL_WRITERS:
            found.append((node.lineno, f"shutil.{shutil_names[f.id]}", _second_arg(node, "dst")))
    return found


def _second_arg(call: ast.Call, kw: str) -> str:
    if len(call.args) >= 2:
        return ast.unparse(call.args[1])
    for k in call.keywords:
        if k.arg == kw:
            return ast.unparse(k.value)
    return ""


def test_census_every_content_write_goes_through_the_door():
    violations, seen = [], set()
    for path in _script_files():
        rel = path.relative_to(SCRIPTS).as_posix()
        for line, kind, target in _raw_writes(path):
            key = (rel, target)
            if rel == "_tools.py" and kind == "os.replace" and target == "tmp":
                seen.add(key)
                continue
            if key in ALLOW and kind != "os.replace":
                seen.add(key)
                continue
            violations.append(f"{rel}:{line}: raw {kind}({target})")
    assert not violations, (
        "A library script writes a file outside the atomic door. Route it through "
        "`_tools._atomic_write_text` / `_atomic_write_bytes` (crash-safe, UTF-8); only "
        "a report / log / scratch / fixture / lock may be added to ALLOW, with its reason:\n  "
        + "\n  ".join(violations)
    )
    stale = sorted(set(ALLOW) - seen)
    assert not stale, f"ALLOW rows that match no write any more — delete them: {stale}"


def test_census_sees_every_banned_spelling():
    """A negative census is only as wide as the spellings it can see."""
    fixture = (
        "import os, shutil\n"
        "from shutil import copyfile as cf\n"
        "p.write_text('x')\n"
        "p.write_bytes(b'x')\n"
        "open(p, 'w')\n"
        "os.replace(tmp, p)\n"
        "shutil.copyfile(src, paper_dir / 'main.tex')\n"
        "shutil.copy(src, dst=p)\n"
        "shutil.copy2(src, p)\n"
        "shutil.copytree(src, p)\n"
        "shutil.move(src, p)\n"
        "cf(src, p)\n"
    )
    kinds = [k for _, k, _ in _raw_writes_in(fixture)]
    assert sorted(kinds) == sorted([
        "write_text", "write_bytes", "open", "os.replace", "shutil.copyfile",
        "shutil.copy", "shutil.copy2", "shutil.copytree", "shutil.move", "shutil.copyfile",
    ]), kinds
    targets = {t for _, k, t in _raw_writes_in(fixture) if k.startswith("shutil.")}
    assert "paper_dir / 'main.tex'" in targets and "p" in targets


def test_tex_passthrough_writes_main_tex_through_the_door():
    """Task 1294's named member: no raw write targets main.tex in index_paper."""
    raw = _raw_writes(SCRIPTS / "index_paper.py")
    offenders = [r for r in raw if "main.tex" in r[2] and "dest" not in r[2]]
    assert not offenders, offenders


def test_the_door_is_defined_once():
    homes = []
    for path in _script_files():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in DOOR_NAMES:
                homes.append(f"{path.relative_to(SCRIPTS).as_posix()}:{node.name}")
    assert sorted(homes) == ["_tools.py:_atomic_write_bytes", "_tools.py:_atomic_write_text"], homes


def test_failed_rename_leaves_prior_bytes_and_no_temp(tmp_path):
    target = tmp_path / "main.tex"
    target.write_bytes(b"\\pgmark{1} original body\n")
    real = os.replace

    def boom(*a, **k):
        raise OSError("disk full")

    os.replace = boom
    try:
        try:
            _tools._atomic_write_text(target, "TRUNCATED")
            raise AssertionError("the door swallowed a failed rename")
        except OSError:
            pass
    finally:
        os.replace = real
    assert target.read_bytes() == b"\\pgmark{1} original body\n"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["main.tex"]


def test_write_paper_bib_entry_failure_leaves_references_bib_byte_identical(tmp_path):
    paper = tmp_path / "papers" / "smith2001x"
    paper.mkdir(parents=True)
    refs = paper / "references.bib"
    prior = (b"@article{jones1999a,\n  title = {Kept},\n  year = {1999},\n}\n\n"
             b"@book{lee2005b,\n  title = {Also kept},\n  year = {2005},\n}\n")
    refs.write_bytes(prior)
    real = os.replace

    def boom(*a, **k):
        raise OSError("killed mid-write")

    os.replace = boom
    try:
        try:
            _tools.write_paper_bib_entry(paper, "smith2001x", "article",
                                         {"title": "New", "year": "2001"})
            raise AssertionError("write_paper_bib_entry swallowed a failed write")
        except OSError:
            pass
    finally:
        os.replace = real
    assert refs.read_bytes() == prior
    assert sorted(p.name for p in paper.iterdir()) == ["references.bib"]
    # …and the success path still lands, with the other entries intact.
    _tools.write_paper_bib_entry(paper, "smith2001x", "article", {"title": "New", "year": "2001"})
    text = refs.read_text(encoding="utf-8")
    assert "jones1999a" in text and "lee2005b" in text and "smith2001x" in text


def test_door_writes_utf8_whatever_the_locale(tmp_path):
    target = tmp_path / "references.bib"
    _tools._atomic_write_text(target, "Gödel — Ἀριστοτέλης\n")
    assert target.read_bytes() == "Gödel — Ἀριστοτέλης\n".encode("utf-8")


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
