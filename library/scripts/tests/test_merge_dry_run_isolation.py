"""Task 1037 — a dry run writes nothing a later real run reads.

`/library/merge-bibs --dry-run` used to write `.virgil/merge-reports/<ck>.json`
for every never-imported paper; the next real run's legacy up-to-date check
(report mtime ≥ references.bib mtime) then skipped them all, and their
references were never folded into master.bib. Pinned here:

  * the engine's dry run leaves every pre-existing library file byte-identical
    and writes its report only under `merge-reports/_dry-run/`;
  * the worklist (now a script, not a skill heredoc) still selects the paper
    after a dry run — and ignores a legacy report stamped `"dry_run": true`;
  * a real report still makes a legacy paper count as up to date;
  * `populate_references_bib_from_itemize --dry-run` writes no
    `.numeric-citekeys.txt` sidecar.

Run: python3 -m pytest library/scripts/tests/test_merge_dry_run_isolation.py -v
"""
import json
import os
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import merge_bibs_worklist as worklist  # noqa: E402
import merge_paper_references as engine  # noqa: E402
import populate_references_bib_from_itemize as populate  # noqa: E402
from _tools import merge_report_dir  # noqa: E402

CK = "smith2020paper"
REFS = "@article{doe2001thing,\n  author={Doe, Jane},\n  title={A Thing},\n  journal={J},\n  year={2001},\n}\n"


def _library(root: Path, *, bib: dict | None = None) -> Path:
    (root / ".virgil" / "scripts").mkdir(parents=True, exist_ok=True)
    (root / "master.bib").write_text("")
    row = {"citekey": CK, "indexed": {"state": "deepIndexed"}}
    if bib is not None:
        row["bib"] = bib
    (root / ".virgil" / "catalog.json").write_text(json.dumps({"entries": [row]}))
    paper = root / "papers" / CK
    paper.mkdir(parents=True)
    (paper / "references.bib").write_text(REFS)
    return root


def _snapshot(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes()
            for p in root.rglob("*") if p.is_file()}


def test_engine_dry_run_writes_only_under_dry_run_dir(tmp_path, capsys):
    lib = _library(tmp_path / "lib")
    before = _snapshot(lib)
    assert engine.main([CK, "--dry-run", "--library", str(lib)]) == 0
    after = _snapshot(lib)
    changed = {k for k in after if before.get(k) != after[k]}
    dry = str(merge_report_dir(lib, dry_run=True).relative_to(lib))
    assert changed, "the dry run must still produce a report"
    assert all(k.startswith(dry + os.sep) for k in changed), changed
    assert not (merge_report_dir(lib) / f"{CK}.json").exists()
    report = json.loads((merge_report_dir(lib, dry_run=True) / f"{CK}.json").read_text())
    assert report["dry_run"] is True


def test_worklist_still_selects_paper_after_a_dry_run(tmp_path, capsys):
    lib = _library(tmp_path / "lib")
    engine.main([CK, "--dry-run", "--library", str(lib)])
    todo, skipped = worklist.build_worklist(lib)
    assert todo == [CK] and skipped == 0


def test_legacy_dry_run_report_in_real_dir_never_counts(tmp_path):
    """A pre-1037 engine wrote dry-run reports to the REAL dir — still poisoned
    on disk in existing libraries. The worklist must see through them."""
    lib = _library(tmp_path / "lib")
    rd = merge_report_dir(lib)
    rd.mkdir(parents=True)
    rpt = rd / f"{CK}.json"
    rpt.write_text(json.dumps({"citekey": CK, "dry_run": True}))
    refs = lib / "papers" / CK / "references.bib"
    os.utime(rpt, (refs.stat().st_mtime + 60,) * 2)
    assert worklist.build_worklist(lib) == ([CK], 0)


def test_real_report_still_marks_legacy_paper_up_to_date(tmp_path):
    lib = _library(tmp_path / "lib")
    rd = merge_report_dir(lib)
    rd.mkdir(parents=True)
    rpt = rd / f"{CK}.json"
    rpt.write_text(json.dumps({"citekey": CK, "dry_run": False}))
    refs = lib / "papers" / CK / "references.bib"
    os.utime(rpt, (refs.stat().st_mtime + 60,) * 2)
    assert worklist.build_worklist(lib) == ([], 1)
    assert worklist.build_worklist(lib, force=True) == ([CK], 0)


def test_flag_bearing_paper_decided_by_content(tmp_path):
    lib = _library(tmp_path / "lib", bib={"imported": True, "importedKeys": ["doe2001thing"]})
    assert worklist.build_worklist(lib) == ([], 1)
    lib2 = _library(tmp_path / "lib2", bib={"imported": True, "importedKeys": []})
    assert worklist.build_worklist(lib2) == ([CK], 0)


def test_worklist_cli_routes_dry_run_worklist(tmp_path, capsys):
    lib = _library(tmp_path / "lib")
    state = tmp_path / "run.json"
    state.write_text(json.dumps({"library_root": str(lib),
                                 "run": {"filter": "", "force": False, "dry_run": True}}))
    before = _snapshot(lib)
    assert worklist.main(["--run-state", str(state)]) == 0
    out = merge_report_dir(lib, dry_run=True) / "_worklist.txt"
    assert out.read_text() == f"{CK}\n"
    changed = {k for k, v in _snapshot(lib).items() if before.get(k) != v}
    assert changed == {str(out.relative_to(lib))}


def test_populate_dry_run_writes_no_sidecar(tmp_path):
    paper = tmp_path / "paper"
    paper.mkdir()
    items = "\n".join(f"\\bibitem{{{i}}} Author {i}. Title {i}. Journal, 200{i}."
                      for i in range(1, 7))
    (paper / "main.tex").write_text(f"Body.\n\\section{{References}}\n{items}\n")
    before = _snapshot(paper)
    result = populate.populate(paper, dry_run=True)
    assert result.get("added", 0) > 0, result
    assert _snapshot(paper) == before
    populate.populate(paper)
    assert (paper / ".numeric-citekeys.txt").exists()


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
