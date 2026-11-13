"""`/library/triage-pdf` runs the batch engine, not a prose twin of it (task 1601).

WHY THIS EXISTS. One dropped file used to get two different triages depending
on which skill touched it. `/library/triage-pdf` hand-performed every step in
prose — its own citekey rule (`<LastName><Year>`, else `<LastName><LastName2>`,
which the engine never mints), folding a same-work drop INTO the existing paper
(a hand `mv` onto `papers/<existing>/<existing>.<ext>`, which can replace a
file), and parking with a bare `mv` that bypassed the no-clobber park door
(`triage_apply._park`, task 619). `/library/triage-pending` ran the engine
(`triage_batch.py` → `triage_apply.py`) and did all three differently.

The fix routes the single-file skill through the SAME engine
(`triage_batch.py --only <file>` → review → `triage_apply.py`), so the
semantics exist once. Two halves are pinned here:

- THE ENGINE HALF. The one behaviour only the prose had — a SUPERSEDE, a new
  source format arriving for a paper already held in another — now lives in
  `triage_apply.supersede_verdict`, so the batch path gets it too (before, a
  batch-triaged `.docx` next to a held `.pdf` was queued as a plain `index`,
  and a lower-priority `.pdf` next to a held `.docx` was queued for a
  re-extraction that would read the `.docx` anyway). Each leg runs the real
  CLIs end to end and carries its control (the same drop with NOTHING held).
- THE PROSE HALF. A census over `triage-pdf.md`: it names
  `triage_batch.py --only` and `triage_apply.py`, hand-moves nothing into
  `papers/` or `_pending/`, writes `master.bib` through no shim of its own, and
  carries no private citekey rule.

Run: python3 library/scripts/tests/test_triage_pdf_one_engine.py
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
import triage_apply as ta  # noqa: E402

BATCH = _SCRIPTS / "triage_batch.py"
APPLY = _SCRIPTS / "triage_apply.py"
SKILL = _SCRIPTS.parent / "skills" / "triage-pdf.md"


def _check(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _init_library(tmp_path: Path) -> Path:
    (tmp_path / ".virgil" / "scripts").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".virgil" / "catalog.json").write_text('{"version": 1, "entries": []}\n')
    (tmp_path / "papers").mkdir(parents=True, exist_ok=True)
    (tmp_path / "unsorted").mkdir(parents=True, exist_ok=True)
    (tmp_path / "master.bib").write_text("")
    return tmp_path


def _hold(library: Path, citekey: str, ext: str) -> Path:
    d = library / "papers" / citekey
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{citekey}.{ext}"
    p.write_bytes(b"held source")
    return p


def _drop(library: Path, name: str) -> Path:
    p = library / "unsorted" / name
    p.write_bytes(b"new source")
    return p


def _row(filename: str, citekey: str) -> dict:
    return {
        "filename": filename,
        "extension": filename.rsplit(".", 1)[1],
        "proposedCitekey": citekey,
        "proposedType": "article",
        "proposedFields": {"title": "On Things", "author": "Smith, Sam", "year": "2020"},
        "flags": [],
    }


def _apply(library: Path, rows: list[dict]) -> subprocess.CompletedProcess:
    inp = library / "apply.jsonl"
    inp.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    return subprocess.run(
        [sys.executable, str(APPLY), "--library", ".", "--input", str(inp)],
        cwd=str(library), capture_output=True, text=True,
    )


def _queued_kind(library: Path, citekey: str) -> str | None:
    q = library / ".virgil" / "queue" / f"{citekey}.json"
    if not q.exists():
        return None
    return json.loads(q.read_text()).get("kind")


# ── the engine half: supersede_verdict, in isolation ──────────────────


def test_verdict_nothing_held_is_the_ordinary_index(tmp_path):
    library = _init_library(tmp_path)
    _check(ta.supersede_verdict(library, "smith2020things", "pdf") == ("index", ""),
           "an unheld paper must take the ordinary index flow")


def test_verdict_higher_format_reindexes(tmp_path):
    library = _init_library(tmp_path)
    _hold(library, "smith2020things", "pdf")
    _check(ta.supersede_verdict(library, "smith2020things", "docx") == ("reindex", "pdf"),
           "a .docx over a held .pdf must reindex")


def test_verdict_lower_format_queues_nothing(tmp_path):
    library = _init_library(tmp_path)
    _hold(library, "smith2020things", "docx")
    _check(ta.supersede_verdict(library, "smith2020things", "pdf") == ("", "docx"),
           "a .pdf under a held .docx must queue nothing")


def test_verdict_same_format_is_not_a_supersede(tmp_path):
    library = _init_library(tmp_path)
    _hold(library, "smith2020things", "pdf")
    _check(ta.supersede_verdict(library, "smith2020things", "pdf") == ("index", ""),
           "a same-format holding is a collision for the move door, not a supersede")


# ── the engine half, end to end through the real CLI ──────────────────


def test_control_unheld_drop_is_moved_and_indexed(tmp_path):
    library = _init_library(tmp_path)
    _drop(library, "smith.pdf")
    proc = _apply(library, [_row("smith.pdf", "smith2020things")])
    _check(proc.returncode == 0, proc.stderr)
    _check((library / "papers/smith2020things/smith2020things.pdf").exists(), proc.stdout)
    _check(_queued_kind(library, "smith2020things") == "index", proc.stdout)
    _check("[triaged]" in proc.stdout, proc.stdout)


def test_higher_format_lands_alongside_and_queues_reindex(tmp_path):
    library = _init_library(tmp_path)
    held = _hold(library, "smith2020things", "pdf")
    _drop(library, "smith.docx")
    proc = _apply(library, [_row("smith.docx", "smith2020things")])
    _check(proc.returncode == 0, proc.stderr)
    _check((library / "papers/smith2020things/smith2020things.docx").exists(), proc.stdout)
    _check(held.read_bytes() == b"held source", "the held .pdf must stay on disk as an archive")
    _check(_queued_kind(library, "smith2020things") == "reindex", proc.stdout)
    _check("supersedes the held .pdf" in proc.stdout, proc.stdout)


def test_lower_format_lands_as_archive_and_queues_nothing(tmp_path):
    library = _init_library(tmp_path)
    held = _hold(library, "smith2020things", "docx")
    _drop(library, "smith.pdf")
    proc = _apply(library, [_row("smith.pdf", "smith2020things")])
    _check(proc.returncode == 0, proc.stderr)
    _check((library / "papers/smith2020things/smith2020things.pdf").exists(), proc.stdout)
    _check(held.read_bytes() == b"held source", proc.stdout)
    _check(_queued_kind(library, "smith2020things") is None,
           "a lower-priority source must queue nothing")
    _check("[archived]" in proc.stdout and "remains canonical" in proc.stdout, proc.stdout)
    _check(not (library / "unsorted/smith.pdf").exists(), "the drop must have left unsorted/")


def test_same_format_holding_is_refused_and_never_replaced(tmp_path):
    library = _init_library(tmp_path)
    held = _hold(library, "smith2020things", "pdf")
    _drop(library, "smith.pdf")
    proc = _apply(library, [_row("smith.pdf", "smith2020things")])
    _check("[collision]" in proc.stdout, proc.stdout)
    _check(held.read_bytes() == b"held source", "a same-format holding must never be replaced")
    _check((library / "unsorted/smith.pdf").exists(), "a refused drop stays in unsorted/")


# ── the prose half: triage-pdf.md drives the engine ───────────────────


def _skill() -> str:
    return SKILL.read_text()


def _fenced(text: str) -> list[str]:
    return re.findall(r"```[a-z]*\n(.*?)```", text, re.S)


def test_skill_names_the_engine_scoped_to_one_file():
    text = _skill()
    blocks = "\n".join(_fenced(text))
    _check(re.search(r"triage_batch\.py[^\n]*\\?\n?[^\n]*--only", blocks) is not None,
           "triage-pdf.md must run triage_batch.py --only")
    _check("triage_apply.py" in blocks, "triage-pdf.md must apply through triage_apply.py")
    for ext in (".pdf", ".docx", ".tex", ".bib"):
        _check(f"`{ext}`" in text or f"**`{ext}`**" in text,
               f"triage-pdf.md must say what the engine does with {ext}")


def test_skill_hand_moves_nothing_into_papers_or_pending():
    for block in _fenced(_skill()):
        for line in block.splitlines():
            if re.match(r"\s*(mv|cp|rm)\b", line):
                _check("papers/" not in line and "_pending" not in line
                       and "unsorted/" not in line,
                       f"triage-pdf.md hand-moves a source: {line.strip()}")


def test_skill_prose_hand_performs_no_move():
    # The old moves were PROSE steps ("Move the source file from …"), not
    # fenced commands — the leg above alone passed against them.
    text = _skill()
    for phrase in ("Move the source file", "Move file to", "Move `unsorted/",
                   "hand-moves into", "mkdir variants"):
        _check(phrase not in text, f"triage-pdf.md still hand-performs a move: {phrase!r}")


def test_skill_writes_master_bib_through_no_shim_of_its_own():
    blocks = "\n".join(_fenced(_skill()))
    _check("update_master_bib_entry.py" not in blocks,
           "triage-pdf.md must leave the master.bib stub to triage_apply.py")


def test_skill_carries_no_private_citekey_rule():
    text = _skill()
    _check("<LastName><LastName2>" not in text and "<LastName><Year>" not in text,
           "triage-pdf.md must not state a citekey rule of its own")


if __name__ == "__main__":
    raise SystemExit(_standalone_main(dict(globals())))
