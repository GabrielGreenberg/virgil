"""`triage_batch.py --only` — single-drop scoping, and the twin it retires (task 511).

WHY THIS EXISTS. `/library/triage-pdf`'s frontmatter says it does NOT do batch
processing, and its `.bib` closing block told an agent to run `triage_batch.py`
with `--library` and `--output` only — which iterates the WHOLE inbox. Following
that recipe to triage one `.bib` gave every other PDF/DOCX/`.tex` sitting in
`unsorted/` a citekey, moved it into `papers/<citekey>/`, and enqueued it for
indexing, while the agent reported that it had processed one file.

The flag is also what retires a HAND-ROLLED TWIN. `/editor/sync-bib-to-library`
step (b) said, in as many words, "do **not** call `triage_batch.py` — that scans
every file in `unsorted/`", and then emitted its own triage rows from twenty
lines of inline Python. That copy dropped `bibEntryRaw`, dropped the
`citekey-exists` collision flag, dropped `_strip_tex` on the field values, and
hard-coded `proposedBibState: "unverified"` — so an `@unpublished` entry synced
out of a paper landed as `unverified` and was queued for authentication, where
the real engine calls it `manuscript` (terminal, left alone). Those divergences
are pinned below: they are the reason the flag is a FIX and not a tidy-up.

The scoping legs run the REAL CLIs end to end (`triage_batch.py` →
`triage_apply.py`), because what has to be true is a fact about the pipeline's
effect on the inbox, not about a function's return value: `triage_apply` is
driven entirely by the rows it is handed and sweeps `unsorted/` for nothing of
its own, which is what makes scoping the BATCH sufficient. A leg that only
asserted on the emitted JSONL would pass on an apply step that swept the inbox
anyway.

Every scoping leg carries its ACCEPTING CONTROL — the same fixture run WITHOUT
`--only` — or "the second file was untouched" passes on an engine that triages
nothing at all.

Run: python3 library/scripts/tests/test_triage_only_scope.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

from _standalone import main as _standalone_main  # noqa: E402
import triage_batch as tb  # noqa: E402

BATCH = _SCRIPTS / "triage_batch.py"
APPLY = _SCRIPTS / "triage_apply.py"


# ── fixtures ──────────────────────────────────────────────────────────


BIB_TEXT = """@article{Alpha2020,
  title = {A Study of {Th}ings},
  author = {Alpha, Ada},
  year = {2020},
  journal = {Journal of Things},
}

@unpublished{Beta2021,
  title = {A Draft About Stuff},
  author = {Beta, Bo},
  year = {2021},
}
"""


def _init_library(tmp_path: Path) -> Path:
    """A minimal library root: the four directories every script resolves."""
    (tmp_path / ".virgil").mkdir(parents=True, exist_ok=True)
    (tmp_path / "papers").mkdir(parents=True, exist_ok=True)
    (tmp_path / "unsorted").mkdir(parents=True, exist_ok=True)
    (tmp_path / "master.bib").write_text("")
    return tmp_path


def _drop_bib(library: Path, name: str = "drop.bib", text: str = BIB_TEXT) -> Path:
    p = library / "unsorted" / name
    p.write_text(text)
    return p


def _drop_tex(library: Path, name: str = "bystander.tex") -> Path:
    """A second, unrelated drop — the bystander every scoping leg protects."""
    p = library / "unsorted" / name
    p.write_text(
        "\\title{An Unrelated Manuscript}\n"
        "\\author{Gamma, Gil}\n"
        "\\date{2019}\n"
        "\\begin{document}\nBody text.\n\\end{document}\n"
    )
    return p


def _run(argv: list[str], library: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, *argv],
        cwd=str(library),
        capture_output=True,
        text=True,
    )


def _batch(library: Path, *extra: str) -> tuple[list[dict], subprocess.CompletedProcess]:
    out = library / "rows.jsonl"
    proc = _run([str(BATCH), "--library", ".", "--output", str(out), *extra], library)
    rows: list[dict] = []
    if out.exists():
        rows = [json.loads(l) for l in out.read_text().splitlines() if l.strip()]
    return rows, proc


def _apply(library: Path, rows: list[dict]) -> subprocess.CompletedProcess:
    inp = library / "apply.jsonl"
    inp.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    return _run([str(APPLY), "--library", ".", "--input", str(inp)], library)


def _check(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


# ── the selector, in isolation ────────────────────────────────────────


def test_select_sources_default_is_the_whole_inbox(tmp_path):
    library = _init_library(tmp_path)
    _drop_bib(library)
    _drop_tex(library)
    names = sorted(p.name for p in tb.select_sources(library / "unsorted"))
    _check(names == ["bystander.tex", "drop.bib"], f"got {names}")


def test_select_sources_only_returns_exactly_one(tmp_path):
    library = _init_library(tmp_path)
    _drop_bib(library)
    _drop_tex(library)
    picked = tb.select_sources(library / "unsorted", "drop.bib")
    _check([p.name for p in picked] == ["drop.bib"], f"got {picked}")


def test_select_sources_skips_reserved_and_unsupported(tmp_path):
    """The membership rule is the SAME one the whole-inbox sweep uses — that is
    the point of having one selector — so the skips are pinned here rather than
    left to be re-derived by a second reader."""
    library = _init_library(tmp_path)
    _drop_bib(library)
    (library / "unsorted" / "_pending").mkdir()
    (library / "unsorted" / "_notes.bib").write_text("@misc{x,}")
    (library / "unsorted" / ".DS_Store").write_text("")
    (library / "unsorted" / "readme.txt").write_text("hi")
    names = sorted(p.name for p in tb.select_sources(library / "unsorted"))
    _check(names == ["drop.bib"], f"got {names}")


def test_select_sources_missing_name_errors_loudly(tmp_path):
    library = _init_library(tmp_path)
    _drop_bib(library)
    try:
        tb.select_sources(library / "unsorted", "nope.bib")
    except tb.TriageSelectionError as e:
        # It must NAME the miss and show what IS there — an agent following a
        # skill recipe has only this line to work from.
        _check("nope.bib" in str(e), f"error does not name the file: {e}")
        _check("drop.bib" in str(e), f"error does not list candidates: {e}")
        return
    raise AssertionError("a missing --only silently fell back")


def test_select_sources_present_but_unsupported_says_why(tmp_path):
    library = _init_library(tmp_path)
    (library / "unsorted" / "readme.txt").write_text("hi")
    try:
        tb.select_sources(library / "unsorted", "readme.txt")
    except tb.TriageSelectionError as e:
        _check("extension" in str(e), f"unhelpful reason: {e}")
        return
    raise AssertionError("an untriageable --only was accepted")


def test_select_sources_rejects_a_path(tmp_path):
    library = _init_library(tmp_path)
    (library / "unsorted" / "_pending").mkdir()
    (library / "unsorted" / "_pending" / "old.bib").write_text("@misc{x,}")
    try:
        tb.select_sources(library / "unsorted", "_pending/old.bib")
    except tb.TriageSelectionError as e:
        _check("bare filename" in str(e), f"unhelpful reason: {e}")
        return
    raise AssertionError("--only accepted a path separator")


# ── the CLI, end to end ───────────────────────────────────────────────


def test_only_emits_rows_for_that_file_alone(tmp_path):
    library = _init_library(tmp_path)
    _drop_bib(library)
    _drop_tex(library)

    rows, proc = _batch(library, "--only", "drop.bib")
    _check(proc.returncode == 0, f"batch failed: {proc.stderr}")
    _check({r["filename"] for r in rows} == {"drop.bib"},
           f"rows leaked past --only: {[r['filename'] for r in rows]}")
    _check(len(rows) == 2, f"expected one row per bib entry, got {len(rows)}")

    # ACCEPTING CONTROL: without the flag the bystander IS triaged, so the leg
    # above cannot pass on an engine that emits nothing.
    all_rows, proc2 = _batch(library)
    _check(proc2.returncode == 0, f"batch failed: {proc2.stderr}")
    _check("bystander.tex" in {r["filename"] for r in all_rows},
           "control: the whole-inbox run did not see the bystander")


def _papers(library: Path) -> list[str]:
    return sorted(p.name for p in (library / "papers").iterdir())


def _queued(library: Path) -> list[str]:
    q = library / ".virgil" / "queue"
    return sorted(p.stem for p in q.glob("*.json")) if q.exists() else []


def test_only_run_leaves_the_bystander_untouched_through_apply(tmp_path):
    """The claim the skill's contract actually makes: following the recipe for
    one `.bib` must not move, rename, or enqueue anything else in the inbox.

    Asserted as a DELTA over the whole `papers/` + queue state rather than
    against a citekey this file guessed — the bystander's proposed citekey is
    whatever the extractor derives (here the filename stem, not the `\author`),
    so a hand-written `"Gamma2019" not in papers` passes for the wrong reason.
    """
    library = _init_library(tmp_path)
    _drop_bib(library)
    bystander = _drop_tex(library)

    rows, proc = _batch(library, "--only", "drop.bib")
    _check(proc.returncode == 0, f"batch failed: {proc.stderr}")
    applied = _apply(library, rows)
    _check(applied.returncode == 0, f"apply failed: {applied.stderr}")

    _check(bystander.exists(), "the bystander was moved out of unsorted/")
    # Exactly the two entries of the .bib we asked for, and nothing else.
    _check(_papers(library) == ["Alpha2020", "Beta2021"],
           f"apply touched more than the requested .bib: {_papers(library)}")
    _check(_queued(library) == ["Alpha2020"],
           f"apply queued more than the requested .bib: {_queued(library)}")


def test_whole_inbox_run_does_process_the_bystander(tmp_path):
    """The control for the leg above, run through the same apply step: without
    `--only` the bystander is exactly what DOES get a folder. This is the
    pre-511 behaviour the single-file skill was silently invoking."""
    library = _init_library(tmp_path)
    _drop_bib(library)
    _drop_tex(library)

    rows, proc = _batch(library)
    _check(proc.returncode == 0, f"batch failed: {proc.stderr}")
    bystander_key = next(
        r["proposedCitekey"] for r in rows if r["filename"] == "bystander.tex"
    )
    applied = _apply(library, rows)
    _check(applied.returncode == 0, f"apply failed: {applied.stderr}")

    _check(bystander_key in _papers(library),
           f"control: whole-inbox apply did not process the bystander "
           f"({bystander_key!r}): {_papers(library)}")
    _check(not (library / "unsorted" / "bystander.tex").exists(),
           "control: whole-inbox apply left the bystander in unsorted/")


def test_only_miss_exits_nonzero_and_writes_nothing(tmp_path):
    library = _init_library(tmp_path)
    _drop_bib(library)
    _drop_tex(library)

    out = library / "rows.jsonl"
    proc = _run(
        [str(BATCH), "--library", ".", "--output", str(out), "--only", "typo.bib"],
        library,
    )
    _check(proc.returncode == 2, f"expected exit 2, got {proc.returncode}")
    _check("typo.bib" in proc.stderr, f"stderr does not name the miss: {proc.stderr}")
    # No output file at all: a miss must not hand the caller a JSONL to apply.
    _check(not out.exists(), "a missed --only still wrote an output file")


def test_only_rows_are_identical_to_the_batch_run_s_rows(tmp_path):
    """ONE engine, not two. The single-file path may differ from the batch path
    in SCOPE and in nothing else — which is the property that lets a caller with
    a single-file contract stop hand-rolling its own row builder."""
    library = _init_library(tmp_path)
    _drop_bib(library)
    _drop_tex(library)

    scoped, _ = _batch(library, "--only", "drop.bib")
    every, _ = _batch(library)
    from_batch = [r for r in every if r["filename"] == "drop.bib"]
    _check(scoped == from_batch, "--only rows differ from the batch run's rows")


# ── the twin the flag retires ─────────────────────────────────────────


def test_engine_rows_carry_what_the_hand_twin_dropped(tmp_path):
    """`/editor/sync-bib-to-library` used to build its own bib rows inline.
    These four fields are what that copy did not produce; the sync skill now
    calls the engine, so a regression here is a regression there."""
    library = _init_library(tmp_path)
    _drop_bib(library)
    rows, proc = _batch(library, "--only", "drop.bib")
    _check(proc.returncode == 0, f"batch failed: {proc.stderr}")
    by_key = {r["proposedCitekey"]: r for r in rows}

    # 1. `@unpublished` is a MANUSCRIPT — terminal, so apply leaves it alone
    #    rather than queueing it for authentication. The hand copy said
    #    "unverified" for every entry.
    _check(by_key["Beta2021"]["proposedBibState"] == "manuscript",
           f"@unpublished lost its manuscript state: {by_key['Beta2021']}")
    _check("bib-manuscript" in by_key["Beta2021"]["flags"],
           f"@unpublished carries no manuscript flag: {by_key['Beta2021']['flags']}")
    _check(by_key["Alpha2020"]["proposedBibState"] == "unverified",
           "an ordinary @article should still be unverified")

    # 2. The verbatim entry text.
    _check(by_key["Alpha2020"].get("bibEntryRaw", "").strip().startswith("@article"),
           "bibEntryRaw is missing")

    # 3. TeX stripped out of the field values.
    _check(by_key["Alpha2020"]["proposedFields"]["title"] == "A Study of Things",
           f"fields were not TeX-stripped: {by_key['Alpha2020']['proposedFields']}")


def test_engine_rows_flag_a_citekey_the_library_already_holds(tmp_path):
    """The collision flag — the fourth thing the hand copy dropped. Without it
    a reviewer sees a brand-new entry where the library already holds one."""
    library = _init_library(tmp_path)
    (library / "master.bib").write_text(
        "@article{Alpha2020,\n  title = {A Study of Things},\n}\n"
        "% bib.state = authenticated\n"
    )
    _drop_bib(library)
    rows, proc = _batch(library, "--only", "drop.bib")
    _check(proc.returncode == 0, f"batch failed: {proc.stderr}")
    alpha = next(r for r in rows if r["proposedCitekey"] == "Alpha2020")
    _check("citekey-exists" in alpha["flags"],
           f"no collision flag against a held citekey: {alpha['flags']}")
    beta = next(r for r in rows if r["proposedCitekey"] == "Beta2021")
    _check("citekey-exists" not in beta["flags"],
           f"control: a genuinely new citekey was flagged as existing: {beta['flags']}")


if __name__ == "__main__":
    raise SystemExit(_standalone_main(dict(globals())))
