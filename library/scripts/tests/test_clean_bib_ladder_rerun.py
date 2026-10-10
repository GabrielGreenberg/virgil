"""Task 1039 — every clean-bibliography script step can be re-run.

  * `format_references_section --diagnostic` is a preview: main.tex stays
    byte-identical (it used to write, so the `--style` retry it invites was
    refused as "already shaped").
  * every itemizer write stashes the raw section; `--restore` puts it back
    and a retry with another style then succeeds — for both itemizers, which
    share one stash.
  * `populate_references_bib_from_itemize` dedups by WORK identity, not by
    generated key: a second run adds 0 and reports the dupes; two distinct
    same-identity works still get `-2`, and survive a re-run as two.

Run: python3 -m pytest library/scripts/tests/test_clean_bib_ladder_rerun.py -v
"""
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import format_references_section as fmt  # noqa: E402
import itemize_jammed_references as jammed  # noqa: E402
import populate_references_bib_from_itemize as populate  # noqa: E402
from _refs_preimage import preimage_path  # noqa: E402

RAW_REFS = (
    "Bach, K. 2002. \"Giorgione Was So-Called Because of His Name.\" "
    "Philosophical Perspectives 16: 73-103. "
    "Barwise, J., and J. Perry. 1983. Situations and Attitudes. Cambridge, MA: MIT Press. "
    "Burge, T. 1973. \"Reference and Proper Names.\" Journal of Philosophy 70: 425-39.\n"
)
TEX = (
    "\\documentclass{article}\n\\begin{document}\nBody text (Burge 1973).\n\n"
    "\\section{References}\n\n" + RAW_REFS + "\n\\end{document}\n"
)


def _paper(root: Path, tex: str = TEX) -> Path:
    paper = root / "papers" / "x2020paper"
    paper.mkdir(parents=True)
    (paper / "main.tex").write_text(tex, encoding="utf-8")
    return paper


def test_diagnostic_writes_nothing(tmp_path, capsys):
    paper = _paper(tmp_path)
    before = (paper / "main.tex").read_bytes()
    assert fmt.main(["x", str(paper), "--diagnostic"]) == 0
    assert (paper / "main.tex").read_bytes() == before
    assert not preimage_path(paper).exists()
    assert "[diagnostic]" in capsys.readouterr().out


def test_write_restore_retry_with_another_style(tmp_path, capsys):
    paper = _paper(tmp_path)
    assert fmt.main(["x", str(paper), "--style=chicago"]) == 0
    assert "\\begin{itemize}" in (paper / "main.tex").read_text()
    assert RAW_REFS.strip() in preimage_path(paper).read_text()

    # A retry over the itemized section is refused — and says how to undo.
    capsys.readouterr()
    assert fmt.main(["x", str(paper), "--style=apa"]) == 0
    assert "--restore" in capsys.readouterr().out

    assert fmt.main(["x", str(paper), "--restore"]) == 0
    assert (paper / "main.tex").read_text() == TEX
    assert not preimage_path(paper).exists()

    capsys.readouterr()
    assert fmt.main(["x", str(paper), "--style=apa"]) == 0
    assert "Itemized" in capsys.readouterr().out
    assert "\\begin{itemize}" in (paper / "main.tex").read_text()


def test_jammed_itemizer_shares_the_stash(tmp_path):
    paper = _paper(tmp_path)
    assert fmt.main(["x", str(paper), "--style=chicago"]) == 0
    saved, sys.argv = sys.argv, ["x", str(paper), "--restore"]
    try:
        assert jammed.main() == 0
    finally:
        sys.argv = saved
    assert (paper / "main.tex").read_text() == TEX

    assert jammed.itemize_paper(paper)["entries"] > 0
    assert preimage_path(paper).exists()
    assert fmt.main(["x", str(paper), "--restore"]) == 0
    assert (paper / "main.tex").read_text() == TEX


def test_restore_without_stash_is_an_error(tmp_path):
    paper = _paper(tmp_path)
    assert fmt.main(["x", str(paper), "--restore"]) == 1
    assert (paper / "main.tex").read_text() == TEX


ITEMIZED = (
    "\\documentclass{article}\n\\begin{document}\n\\section{References}\n\n"
    "\\begin{itemize}\n"
    "\\item \\textbf{Burge, T. 1973.} \"Reference and Proper Names.\" "
    "\\textit{Journal of Philosophy} 70: 425--39.\n"
    "\\item \\textbf{Bach, K. 2002.} \"Giorgione Was So-Called.\" "
    "\\textit{Philosophical Perspectives} 16: 73--103.\n"
    "\\end{itemize}\n\\end{document}\n"
)


def _keys(bib: str) -> list[str]:
    import re
    return re.findall(r"^@\w+\{([^,\s]+),", bib, re.M)


def test_populate_twice_adds_nothing_the_second_time(tmp_path):
    paper = _paper(tmp_path, ITEMIZED)
    (paper / "references.bib").write_text(
        "@article{x2020paper,\n  author = {X, Y},\n  year = {2020},\n  title = {Paper},\n}\n",
    )
    first = populate.populate(paper)
    assert first["added"] == 2
    bib_after_first = (paper / "references.bib").read_text()
    assert sorted(_keys(bib_after_first)) == [
        "bach2002giorgione", "burge1973reference", "x2020paper",
    ]

    second = populate.populate(paper)
    assert second == {"added": 0, "skipped_dupes": 2, "skipped_unparsable": 0}
    assert (paper / "references.bib").read_text() == bib_after_first


def test_populate_matches_identity_under_any_key(tmp_path):
    """A hand-keyed entry for the same work is a dupe, whatever its key;
    a top-up adds only the work that is genuinely new."""
    paper = _paper(tmp_path, ITEMIZED)
    (paper / "references.bib").write_text(
        "@article{Burge:RefPN,\n  author = {Tyler Burge},\n  year = {1973},\n"
        "  title = {{Reference} and Proper Names},\n}\n",
    )
    result = populate.populate(paper)
    assert result["added"] == 1 and result["skipped_dupes"] == 1
    assert "bach2002giorgione" in _keys((paper / "references.bib").read_text())


def test_distinct_same_identity_works_still_suffixed_and_rerun_stable(tmp_path):
    tex = ITEMIZED.replace(
        "\\end{itemize}",
        "\\item \\textbf{Burge, T. 1973.} \"Reference and Proper Names, Again.\" "
        "\\textit{Mind} 82: 1--10.\n\\end{itemize}",
    )
    paper = _paper(tmp_path, tex)
    first = populate.populate(paper)
    assert first["added"] == 3
    keys = _keys((paper / "references.bib").read_text())
    assert "burge1973reference" in keys and "burge1973reference-2" in keys

    second = populate.populate(paper)
    assert second["added"] == 0 and second["skipped_dupes"] == 3


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
