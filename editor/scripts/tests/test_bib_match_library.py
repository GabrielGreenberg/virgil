#!/usr/bin/env python3
r"""Task 1312 — `bib_match_library.py` asks the library's identity owner.

`/editor/sync-bib-to-library` matches a paper's references.bib against the
library's master.bib on a cascade (citekey → DOI → surname+year+title). Its
identity signals used to be private copies of `work_identity`'s normalizers,
and they had drifted: a `https://dx.doi.org/…` DOI missed the DOI rung, so
sync proposed a duplicate add instead of a link. This suite pins

  - the matcher's rungs on the shapes the copy got wrong (dx.doi.org, `doi:`,
    a LaTeX-marked title, a `Jr.` suffix), and
  - that the matcher (and `merge_paper_references`) READ `work_identity`'s
    functions — the same objects, not look-alikes — so the copy cannot regrow.

Run from anywhere:  python3 editor/scripts/tests/test_bib_match_library.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "editor/scripts"))
sys.path.insert(0, str(ROOT / "library/scripts"))
import bib_match_library as bml  # noqa: E402
import merge_paper_references as mpr  # noqa: E402
import work_identity as wi  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok  {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label}")


MASTER = r"""
@article{Lib2001doi,
  title = {Pictures and Their Content},
  author = {Kulvicki, John},
  year = {2001},
  doi = {10.1/x}
}

@book{Lib1999title,
  title = {{The {DNA} of Meaning}},
  author = {Smith, Anna},
  year = {1999}
}

@article{Lib1964king,
  title = {Letter from Birmingham Jail},
  author = {King Jr., Martin Luther},
  year = {1964}
}
"""

INDEX = bml._build_library_index(MASTER)


def match(citekey, **fields):
    return bml.match_entry({"citekey": citekey, "type": "article", "fields": fields}, INDEX)


print("DOI rung")
for doi in ("https://dx.doi.org/10.1/x", "http://doi.org/10.1/X", "doi:10.1/x",
            "DOI: 10.1/x", "{10.1/x}", "10.1/x."):
    r = match("paperA", doi=doi, title="Something else entirely")
    check(r["status"] == "matched" and r["match_source"] == "doi"
          and r["library_citekey"] == "Lib2001doi", f"{doi!r} matches the bare library DOI")
check(match("paperA", doi="10.1/y")["status"] == "missing", "a different DOI does not match")

print("title-author rung")
r = match("paperB", title=r"The \emph{DNA} of Meaning", author="Anna Smith", year="2000")
check(r["status"] == "matched" and r["library_citekey"] == "Lib1999title",
      "LaTeX-marked, re-braced title + First Last author + year±1 match")
r = match("paperC", title="Letter from Birmingham Jail", author="Martin Luther King Jr.", year="1964")
check(r["status"] == "matched" and r["library_citekey"] == "Lib1964king",
      "`Given Surname Jr.` matches `Surname Jr., Given` on the surname")
check(match("paperD", title="Pictures and Their Content", author="Other, Ann",
            year="2001")["status"] == "missing", "a different first author does not match")

print("citekey rung")
check(match("Lib1999title")["match_source"] == "citekey", "exact citekey wins first")

print("work_identity normalizers")
check(wi.normalize_doi("https://dx.doi.org/10.1/X") == "10.1/x", "dx.doi.org prefix stripped")
check(wi.normalize_doi("doi:10.1/x;") == "10.1/x", "doi: prefix + trailing punctuation stripped")
check(wi.first_author_surname("John Smith III and Jane Doe") == "smith", "trailing III dropped")
check(wi.first_author_surname("Jr") == "jr", "a lone token is never dropped as a suffix")
check(wi.first_author_surname("van der Berg, Jan") == "vanderberg", "particles kept in the comma form")

print("one owner (no private copies)")
check(bml.normalize_doi is wi.normalize_doi and bml.norm_title is wi.norm_title
      and bml.first_author_surname is wi.first_author_surname and bml.norm_year is wi.norm_year,
      "bib_match_library binds work_identity's functions")
check(not any(hasattr(bml, n) for n in ("_normalize_doi", "_normalize_title", "_strip_braces",
                                        "_first_author_surname", "_normalize_surname", "_year")),
      "bib_match_library defines no private identity normalizer")
check(mpr._normalize_doi is wi.normalize_doi and mpr._norm_title is wi.norm_title
      and mpr._first_author_surname is wi.first_author_surname and mpr._strip_braces is wi._strip_braces,
      "merge_paper_references binds work_identity's functions")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
