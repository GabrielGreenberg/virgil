"""Task 1292 — rewrite_citations.py's tally is a SUM, and the write is gated
on the text changing.

The style branches used to ASSIGN `count`, discarding the multi-year fold's
tally added just before them; the write was gated on that counter, so a paper
whose only change was a `(Author 1945, 1963)` fold printed
"Multi-year folded: 1", exited 0, and wrote nothing.

Run: python3 -m pytest library/scripts/tests/test_rewrite_citations_count.py -v
"""
import subprocess
import sys
import tempfile
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parent.parent / "rewrite_citations.py"

_BIB = """@book{quine1945,
  author = {Quine, Willard Van Orman},
  title = {First},
  year = {1945},
}

@book{quine1963,
  author = {Quine, Willard Van Orman},
  title = {Second},
  year = {1963},
}

@book{lewis1986,
  author = {Lewis, David},
  title = {Plurality},
  year = {1986},
}
"""


def _run(tex: str) -> tuple[subprocess.CompletedProcess, str]:
    with tempfile.TemporaryDirectory() as d:
        tex_p = Path(d) / "main.tex"
        bib_p = Path(d) / "references.bib"
        tex_p.write_text(tex, encoding="utf-8")
        bib_p.write_text(_BIB, encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(_SCRIPT), str(tex_p), str(bib_p)],
            capture_output=True, text=True, encoding="utf-8",
        )
        return proc, tex_p.read_text(encoding="utf-8")


def test_fold_only_paper_is_written():
    tex = "As argued (Quine 1945, 1963), meaning is holistic.\n"
    proc, out = _run(tex)
    assert proc.returncode == 0, proc.stderr
    assert "Multi-year folded: 1" in proc.stdout
    assert "\\citealt{quine1945, quine1963}" in out
    assert "1963)" not in out
    assert "Rewrote 1 " in proc.stdout


def test_fold_plus_ordinary_rewrite_sums():
    tex = (
        "As argued (Quine 1945, 1963), meaning is holistic, "
        "but see (Lewis 1986).\n"
    )
    proc, out = _run(tex)
    assert proc.returncode == 0, proc.stderr
    assert "\\citealt{quine1945, quine1963}" in out
    assert "lewis1986" in out
    assert "Rewrote 2 " in proc.stdout, proc.stdout


def test_unchanged_paper_is_not_rewritten():
    tex = "No citations here.\n"
    proc, out = _run(tex)
    assert proc.returncode == 0, proc.stderr
    assert out == tex
    assert "Rewrote" not in proc.stdout


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
