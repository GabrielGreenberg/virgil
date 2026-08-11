"""Regression guard for task 322 — `validate_bib_coherence.py` as a real
pipeline step.

The script was a working checker with a corpus regression guard and **zero
callers** for months (`clean-bibliography.md` said so in its own heading).
Wiring it into `/library/authenticate-bib` as an advisory cross-field
pre-flight promotes three of its behaviours from manual-tool quirks to
pipeline behaviour, and each was wrong in a way that argv/JSON never
complains about:

  1. **The headline case was a silent FALSE NEGATIVE.** `_read_master_bib_entry`
     hand-rolled a `field = {braced}` regex, so a `journal = "Journal of
     Nowhere"` on a `@phdthesis` — the literal shape of the
     `2026-05-13-bib-auth-mismatch-leong1994towards` memo the script was
     written for — parsed as *no field at all* and the entry was reported
     COHERENT. A gate that silently passes is worse than no gate. It now goes
     through the SSOT parser (`_bib_parse.read_master_bib`), exactly as
     `bib_auth.py` does.

  2. **Its default form failed on legitimate entries.** The cover-page leg
     hardcoded `papers/<citekey>/<citekey>.pdf` while the pipeline treats
     every format in `SOURCE_FORMAT_PRIORITY` as first-class and
     authenticate-bib explicitly serves bib-only entries with no paper folder
     at all — so "PDF not found" came back as a *finding*, exit 1. A `|| exit`
     on that step would refuse exactly the skill's documented use cases, which
     is why the wiring is advisory AND the script now SKIPS an unmakeable
     comparison instead of flagging it.

  3. **Two different answers shared one exit code.** Under `--json`, "entry not
     in master.bib" and "entry is incoherent" both exited 1, so an exit-code
     gate reports a typo'd citekey as incoherence. The read failure is now 2,
     matching text mode.

Plus the vocabulary consolidation the wiring forced: the source-format
priority is spelled ONCE, on the stdlib-only leaf (`_tools`), because
`index_paper.py` — where it was born — drags in marker/pymupdf and cannot be
imported by a step that must be cheap, local, and installable-free.

Run: python3 library/scripts/tests/test_validate_bib_coherence.py
     (or under pytest; it carries its own no-pytest runner so CI can shell out
     to it — nothing in CI runs Python directly.)
"""
import json
import subprocess
import sys
import unicodedata
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _SCRIPTS)

import _tools  # noqa: E402
import validate_bib_coherence as vbc  # noqa: E402


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def _make_library(tmp_path: Path, bib_text: str) -> Path:
    """A minimal but REAL library root: master.bib + `.virgil/catalog.json`."""
    lib = tmp_path / "lib"
    (lib / ".virgil").mkdir(parents=True)
    (lib / "master.bib").write_text(bib_text, encoding="utf-8")
    (lib / ".virgil" / "catalog.json").write_text(
        json.dumps({"version": 1, "entries": []}, indent=2) + "\n", encoding="utf-8",
    )
    return lib


def _run(lib: Path, *args: str) -> tuple[int, dict]:
    """Drive the REAL CLI in a subprocess — the form the skill documents."""
    proc = subprocess.run(
        [sys.executable, str(Path(_SCRIPTS) / "validate_bib_coherence.py"), *args],
        cwd=str(lib), capture_output=True, text=True,
        env={**_env_without_root(), "VIRGIL_LIBRARY_ROOT": str(lib)},
    )
    payload = {}
    if proc.stdout.strip().startswith("{"):
        payload = json.loads(proc.stdout)
    return proc.returncode, payload


def _env_without_root() -> dict:
    import os
    return {k: v for k, v in os.environ.items() if k != "VIRGIL_LIBRARY_ROOT"}


# ─────────────────────────────────────────────────────────────────────────
# 1. The headline case: a QUOTED value must be seen
# ─────────────────────────────────────────────────────────────────────────

QUOTED_PHDTHESIS = """\
@phdthesis{leong1994towards,
  title = {Towards a Semantics of Something},
  author = {Leong, X},
  journal = "Journal of Nowhere",
  school = {MIT},
  year = {1994}
}
"""


def test_quoted_disallowed_field_is_found(tmp_path):
    """The defect leg. Fails on the pre-322 regex, which only matched
    `field = {braced}` and therefore reported this entry COHERENT — missing
    its own headline case while claiming to check it."""
    lib = _make_library(tmp_path, QUOTED_PHDTHESIS)
    code, report = _run(lib, "leong1994towards", "--json", "--no-cover-check")
    check(report.get("entry_type") == "phdthesis", f"wrong type: {report!r}")
    check(len(report.get("findings", [])) == 1, f"quoted journal missed: {report!r}")
    check("journal" in report["findings"][0], f"wrong finding: {report!r}")
    check(code == 1, f"findings must exit 1, got {code}")


def test_braced_disallowed_field_still_found(tmp_path):
    """The control: the shape the old regex DID see must keep working, so the
    leg above can't pass by the parser having become permissive about nothing."""
    lib = _make_library(tmp_path, QUOTED_PHDTHESIS.replace(
        'journal = "Journal of Nowhere"', "journal = {Journal of Nowhere}",
    ))
    code, report = _run(lib, "leong1994towards", "--json", "--no-cover-check")
    check(len(report.get("findings", [])) == 1, f"braced journal missed: {report!r}")
    check(code == 1, f"findings must exit 1, got {code}")


def test_a_coherent_entry_is_clean(tmp_path):
    """The corpus guard `leong1994towards` carries: a `@phdthesis` with no
    journal/publisher must pass. Without this the suite could pass by
    flagging everything."""
    lib = _make_library(tmp_path, """\
@phdthesis{leong1994towards,
  title = {Towards a Semantics of Something},
  author = {Leong, X},
  school = {MIT},
  year = {1994}
}
""")
    code, report = _run(lib, "leong1994towards", "--json", "--no-cover-check")
    check(report.get("findings") == [], f"false positive: {report!r}")
    check(report.get("ok") is True, f"not ok: {report!r}")
    check(code == 0, f"clean entry must exit 0, got {code}")


def test_an_empty_disallowed_field_is_not_a_finding(tmp_path):
    """`journal = {}` is not an attested venue; flagging it would make every
    stub entry incoherent."""
    lib = _make_library(tmp_path, """\
@phdthesis{k, title = {T}, journal = {}, school = {MIT}, year = {1994}
}
""")
    _, report = _run(lib, "k", "--json", "--no-cover-check")
    check(report.get("findings") == [], f"empty field flagged: {report!r}")


def test_nfd_citekey_resolves(tmp_path):
    """The write side normalizes to NFC and older rows are NFD (1976-Tichý).
    A pre-flight that reports `error` on a diacritic citekey would read as a
    typo and stop the skill — the one branch that IS terminal."""
    nfd = unicodedata.normalize("NFD", "tichý1988")
    nfc = unicodedata.normalize("NFC", "tichý1988")
    check(nfd != nfc, "fixture is not actually NFD-vs-NFC distinct")
    lib = _make_library(tmp_path, "@phdthesis{%s,\n  title = {T},\n  journal = {J},\n}\n" % nfd)
    code, report = _run(lib, nfc, "--json", "--no-cover-check")
    check("error" not in report, f"NFD row not found: {report!r}")
    check(len(report.get("findings", [])) == 1, f"finding lost: {report!r}")
    check(code == 1, f"expected findings exit, got {code}")


# ─────────────────────────────────────────────────────────────────────────
# 2. The cover-page leg: an unmakeable comparison is a SKIP, not a finding
# ─────────────────────────────────────────────────────────────────────────

BOOK = """\
@book{bringhurst1992,
  title = {The Elements of Typographic Style},
  author = {Bringhurst, Robert},
  publisher = {Hartley and Marks},
  year = {1992}
}
"""


def test_no_source_on_disk_skips_the_cover_check(tmp_path):
    """The leg that made the script unusable as a pipeline step. Verified live
    against the real library before this fix: `bringhurst1992 --json` →
    `["content-mismatch-needs-review: PDF not found"]`, exit 1 — on an entry
    whose only fault is having no PDF."""
    lib = _make_library(tmp_path, BOOK)
    code, report = _run(lib, "bringhurst1992", "--json")
    check(report.get("findings") == [], f"absent source flagged: {report!r}")
    check("skipped" in report.get("cover_check", ""), f"no skip reason: {report!r}")
    check(code == 0, f"absent source must exit 0, got {code}")


def test_a_docx_source_skips_the_cover_check(tmp_path):
    """DOCX and TEX are first-class sources (`SOURCE_FORMAT_PRIORITY`) and
    `pdftotext` cannot read either. The old code looked only for `<key>.pdf`,
    so a DOCX-sourced paper reported the same false finding as one with no
    source at all."""
    lib = _make_library(tmp_path, BOOK)
    d = lib / "papers" / "bringhurst1992"
    d.mkdir(parents=True)
    (d / "bringhurst1992.docx").write_bytes(b"PK\x03\x04not-a-real-docx")
    code, report = _run(lib, "bringhurst1992", "--json")
    check(report.get("findings") == [], f"docx source flagged: {report!r}")
    check(".docx" in report.get("cover_check", ""), f"wrong reason: {report!r}")
    check(code == 0, f"docx source must exit 0, got {code}")


def test_source_resolution_follows_the_shared_priority(tmp_path):
    """`resolve_paper_source` is the SSOT both this script and
    `paper_has_holdings` read. Priority is tex > docx > pdf."""
    lib = _make_library(tmp_path, BOOK)
    d = lib / "papers" / "bringhurst1992"
    d.mkdir(parents=True)
    (d / "bringhurst1992.pdf").write_bytes(b"%PDF-1.4\n")
    got = _tools.resolve_paper_source(lib, "bringhurst1992")
    check(got is not None and got[1] == "pdf", f"pdf not resolved: {got!r}")
    (d / "bringhurst1992.docx").write_bytes(b"PK\x03\x04")
    got = _tools.resolve_paper_source(lib, "bringhurst1992")
    check(got is not None and got[1] == "docx", f"docx must win over pdf: {got!r}")
    (d / "bringhurst1992.tex").write_text("\\documentclass{article}", encoding="utf-8")
    got = _tools.resolve_paper_source(lib, "bringhurst1992")
    check(got is not None and got[1] == "tex", f"tex must win over docx: {got!r}")
    check(_tools.paper_has_holdings(lib, "bringhurst1992") is True,
          "holdings gate disagrees with the resolver it derives from")
    check(_tools.paper_has_holdings(lib, "nosuchkey") is False,
          "holdings gate true for a citekey with no folder")


def test_the_priority_is_spelled_once(tmp_path):
    """`index_paper.FORMAT_PRIORITY` must BE the leaf's tuple, not a copy.
    Imported lazily: index_paper pulls in the extraction stack, so this leg is
    skipped rather than failed where those deps aren't installed — the point
    being guarded is that a *second literal* can't drift, and a missing
    optional dependency is not evidence either way."""
    try:
        import index_paper
    except Exception as e:  # marker / pymupdf / ocrmypdf absent
        print(f"    (skipped: index_paper not importable here — {type(e).__name__})")
        return
    check(index_paper.FORMAT_PRIORITY is _tools.SOURCE_FORMAT_PRIORITY,
          "index_paper.FORMAT_PRIORITY is a second literal, not the SSOT")


def test_check_pdf_cover_page_treats_a_missing_file_as_a_skip():
    """One policy, stated once. The boundary guard used to return
    `(False, "PDF not found")`, which `validate()` turned into a finding."""
    ok, reason = vbc.check_pdf_cover_page(Path("/nonexistent/x.pdf"), "A Title")
    check(ok is True, "a missing PDF is still reported as a mismatch")
    check("skip" in reason.lower(), f"reason not a skip: {reason!r}")


# ─────────────────────────────────────────────────────────────────────────
# 3. Exit codes: a read failure is not incoherence
# ─────────────────────────────────────────────────────────────────────────

def test_unknown_citekey_exits_2_under_json(tmp_path):
    """Pre-322 this exited 1 under `--json` — indistinguishable from
    "incoherent" — so an exit-code gate reported a typo as a finding."""
    lib = _make_library(tmp_path, BOOK)
    code, report = _run(lib, "nosuchkey1999", "--json")
    check("error" in report, f"no error object: {report!r}")
    check("findings" not in report, f"error report carries findings: {report!r}")
    check(code == 2, f"read failure must exit 2 under --json, got {code}")


def test_text_mode_exit_codes_match_json_mode(tmp_path):
    """The two modes must agree, or a caller that drops `--json` changes
    meaning. Text mode was already 0/1/2; JSON now matches it."""
    lib = _make_library(tmp_path, QUOTED_PHDTHESIS)
    for args, expected in (
        (["leong1994towards", "--no-cover-check"], 1),
        (["nosuchkey1999", "--no-cover-check"], 2),
    ):
        proc = subprocess.run(
            [sys.executable, str(Path(_SCRIPTS) / "validate_bib_coherence.py"), *args],
            cwd=str(lib), capture_output=True, text=True,
            env={**_env_without_root(), "VIRGIL_LIBRARY_ROOT": str(lib)},
        )
        check(proc.returncode == expected,
              f"text mode {args} → {proc.returncode}, want {expected}")


# ─────────────────────────────────────────────────────────────────────────
# 4. The wiring: the finding must be REPRESENTABLE as a catalog warning
# ─────────────────────────────────────────────────────────────────────────

def test_findings_prefix_as_a_bib_coherence_kind(tmp_path):
    """The skill files each finding as `bib-coherence: <finding>` through
    `--recompute-warning-kind bib-coherence`. That shim REFUSES a fresh line
    whose head isn't a declared kind, so a finding containing a colon (every
    cross-field finding does: `(value: '…')`) must still parse with
    `bib-coherence` as its head — otherwise the documented invocation fails on
    the one input it exists for."""
    lib = _make_library(tmp_path, QUOTED_PHDTHESIS)
    _, report = _run(lib, "leong1994towards", "--json", "--no-cover-check")
    lines = [f"bib-coherence: {f}" for f in report["findings"]]
    check(lines and ":" in lines[0].split(": ", 1)[1],
          "fixture no longer exercises a colon-bearing finding")
    for line in lines:
        check(line.split(":", 1)[0] == "bib-coherence", f"bad head: {line!r}")
    merged = _tools.merge_indexed_warnings(
        ["pgmark-gap: 12-14", "bib-coherence: stale from a prior run"],
        ["bib-coherence"], lines,
    )
    check(merged[0] == "pgmark-gap: 12-14", f"foreign kind lost: {merged!r}")
    check(merged[1:] == lines, f"recompute wrong: {merged!r}")
    # And the clear-on-fix half: a later run with no findings drops the kind.
    cleared = _tools.merge_indexed_warnings(merged, ["bib-coherence"], [])
    check(cleared == ["pgmark-gap: 12-14"], f"stale finding not cleared: {cleared!r}")


# ─────────────────────────────────────────────────────────────────────────
# 5. The persist channel: exit 1 must mean exactly ONE thing
# ─────────────────────────────────────────────────────────────────────────

def _shim(lib: Path, *args: str):
    return subprocess.run(
        [sys.executable, str(Path(_SCRIPTS) / "update_catalog_entry.py"), *args,
         "--library", str(lib)],
        capture_output=True, text=True,
    )


def _lib_with_row(tmp_path: Path) -> Path:
    lib = _make_library(tmp_path, BOOK)
    (lib / ".virgil" / "catalog.json").write_text(
        json.dumps({"version": 1, "entries": [{"citekey": "bringhurst1992"}]}, indent=2),
        encoding="utf-8",
    )
    return lib


def test_shim_exit_1_means_no_catalog_row_and_nothing_else(tmp_path):
    """`authenticate-bib.md` step 7 branches on this: exit 1 makes it report
    "reference-only entry; not recorded" and continue. `json.loads` used to sit
    ABOVE the shim's `try`, so an unparseable or missing patch file exited 1
    too — CPython's generic uncaught-exception code — and the skill would state
    something false about the library on a write that simply failed. Both are
    refusals, so both are 2; exit 1 is now only the missing row."""
    lib = _lib_with_row(tmp_path)
    good = tmp_path / "good.json"
    good.write_text(json.dumps({"indexed": {"warnings": ["bib-coherence: x"]}}),
                    encoding="utf-8")

    r = _shim(lib, "nosuchkey", "--patch-file", str(good),
              "--recompute-warning-kind", "bib-coherence")
    check(r.returncode == 1, f"missing row must exit 1, got {r.returncode}: {r.stderr}")

    bad = tmp_path / "bad.json"
    bad.write_text('{"indexed": {"warnings": ["bib-coherence: he said "hi""]}}',
                   encoding="utf-8")
    r = _shim(lib, "bringhurst1992", "--patch-file", str(bad),
              "--recompute-warning-kind", "bib-coherence")
    check(r.returncode == 2, f"unparseable patch must exit 2, got {r.returncode}")
    check("Traceback" not in r.stderr, f"unhandled exception leaked:\n{r.stderr}")

    r = _shim(lib, "bringhurst1992", "--patch-file", str(tmp_path / "gone.json"),
              "--recompute-warning-kind", "bib-coherence")
    check(r.returncode == 2, f"missing patch file must exit 2, got {r.returncode}")
    check("Traceback" not in r.stderr, f"unhandled exception leaked:\n{r.stderr}")

    r = _shim(lib, "bringhurst1992", "--patch-file", str(good),
              "--recompute-warning-kind", "bib-coherence")
    check(r.returncode == 0, f"good write must exit 0, got {r.returncode}: {r.stderr}")


def test_a_findings_line_with_an_apostrophe_round_trips_through_the_shim(tmp_path):
    """The realistic malformed-patch trigger, closed at the source rather than
    trusted to care: a value carrying an apostrophe makes Python's `!r` switch
    to DOUBLE quotes, so the finding text contains a bare `"`. Under `--json`
    the report is `json.dumps`-escaped, so an agent copying what it SEES writes
    valid JSON — this pins that end-to-end, since the skill's persist fence is
    hand-authored JSON."""
    lib = _lib_with_row(tmp_path)
    (lib / "master.bib").write_text(
        "@phdthesis{bringhurst1992,\n  title = {T},\n"
        "  journal = {Nowhere's Journal},\n  school = {MIT},\n}\n",
        encoding="utf-8",
    )
    _, report = _run(lib, "bringhurst1992", "--json", "--no-cover-check")
    finding = report["findings"][0]
    check('"' in finding, "fixture no longer produces a repr with double quotes")
    patch = tmp_path / "p.json"
    # Exactly what an agent transcribing the printed report produces.
    patch.write_text(json.dumps({"indexed": {"warnings": [f"bib-coherence: {finding}"]}}),
                     encoding="utf-8")
    r = _shim(lib, "bringhurst1992", "--patch-file", str(patch),
              "--recompute-warning-kind", "bib-coherence")
    check(r.returncode == 0, f"apostrophe finding rejected: {r.returncode} {r.stderr}")
    row = json.loads((lib / ".virgil" / "catalog.json").read_text())["entries"][0]
    check(row["indexed"]["warnings"] == [f"bib-coherence: {finding}"],
          f"round trip lost the finding: {row['indexed']!r}")


def _run_standalone() -> int:
    """Run without pytest (it isn't installed everywhere), supplying the one
    fixture these tests use (`tmp_path`) from `tempfile`."""
    import inspect
    import tempfile
    import traceback

    tests = [
        (n, f) for n, f in sorted(globals().items())
        if n.startswith("test_") and callable(f)
    ]
    failures = 0
    for name, fn in tests:
        with tempfile.TemporaryDirectory() as td:
            try:
                if "tmp_path" in inspect.signature(fn).parameters:
                    fn(tmp_path=Path(td))
                else:
                    fn()
                print(f"  PASS  {name}")
            except Exception:
                failures += 1
                print(f"  FAIL  {name}")
                traceback.print_exc()
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    # `--standalone` forces the built-in runner regardless of whether pytest is
    # installed. The vitest shell asserts on the "<n>/<n> passed" tally this
    # runner prints; under pytest that tally is absent and the JS test would
    # fail on a machine where the Python suite actually PASSED.
    if "--standalone" in sys.argv:
        raise SystemExit(_run_standalone())
    try:
        import pytest
    except ImportError:
        raise SystemExit(_run_standalone())
    raise SystemExit(pytest.main([__file__, "-q"]))
