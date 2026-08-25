#!/usr/bin/env python3
r"""The editor silo's bib-family AUTHORITY, driven end to end (task 464).

`\citet` is natbib-only and UNDEFINED under biblatex; `\textcite` is the mirror
image. So a cite command composed for the wrong family is not a style slip — it
is "Undefined control sequence", and Virgil does not heal it (a preamble that
hard-loads the other family raises a save-time conflict warning rather than
injecting anything, because co-loading both is itself fatal).

Task 344 settled the question for the app and reached none of this silo, where
four sites then answered it privately. What is driven here:

  * the LADDER — the stored `bibPackage` outranks every scan; below it the LIVE
    preamble load, the live cite usage, and finally natbib;
  * the six real biblatex PREAMBLE SPELLINGS the retired `find-citation` needle
    was measured against — options, `\RequirePackage`, a wrapper package, a
    comma-list (4 of the 6 missed) and the commented-out load it read as live;
  * `create_card.py --kind=citation` defaulting its command FROM the door,
    driven through the real CLI against a real biblatex paper — the site whose
    literal `"citet"` spliced straight into `document.tex`;
  * `rename_citekey.py`'s VOCABULARY, the fifth member found while implementing:
    its hand-typed natbib-only list rewrote 1 of 4 cites on a biblatex paper
    while the same atomic op swapped the `.bib` entry out from under it.

Every biblatex leg carries its natbib CONTROL through the identical harness, so
none of them can pass on an implementation that simply answers "biblatex".

Runs from anywhere, no pytest:
    python3 editor/scripts/tests/test_bib_family_slice.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# repo root = tests/ -> scripts/ -> editor/ -> <root>
ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
SAMPLE = ROOT / "samples/annotation-history"
CREATE = str(SCRIPTS / "create_card.py")
sys.path.insert(0, str(SCRIPTS))

import bib_family as BF  # noqa: E402
import cite_commands as CC  # noqa: E402
import rename_citekey as RC  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


def _doc(preamble: str = "", body: str = "Hello.", stored: str | None = None) -> Path:
    """A minimal Virgil paper folder. `stored` writes citations.json's
    `bibPackage` — the AUTHORITY rung."""
    tmp = Path(tempfile.mkdtemp(prefix="virgil-bibfam-"))
    doc = tmp / "paper"
    (doc / "virgil").mkdir(parents=True)
    (doc / "document.tex").write_text(
        "\\documentclass{article}\n"
        + preamble
        + "\n\\begin{document}\n"
        + body
        + "\n\\end{document}\n",
        encoding="utf-8",
    )
    cit = {"citations": []}
    if stored is not None:
        cit["bibPackage"] = stored
    (doc / "virgil" / "citations.json").write_text(
        json.dumps(cit, indent=2), encoding="utf-8"
    )
    return doc


# ---------------------------------------------------------------------------
# The six preamble spellings the retired needle was measured against.
# ---------------------------------------------------------------------------

SPELLINGS = [
    (r"\usepackage[backend=biber,style=authoryear]{biblatex}", "biblatex", True),
    (r"\usepackage{biblatex}", "biblatex", False),
    (r"\RequirePackage{biblatex}", "biblatex", True),
    (r"\usepackage{biblatex-chicago}", "biblatex", True),
    (r"\usepackage{amsmath,biblatex}", "biblatex", True),
    # The one the skill's raw-source needle DID hit and the app deliberately
    # does not: a commented-out load is dead bytes, so the paper is natbib.
    (r"% \usepackage{biblatex}  % tried this, reverted", "natbib", False),
]


def test_preamble_spellings():
    print("\npreamble spellings (the four the retired needle missed, + the comment trap)")
    missed_by_old = 0
    for line, want, was_missed in SPELLINGS:
        doc = _doc(preamble=line)
        got = BF.resolve_bib_family(doc)
        check(got == want, f"{line[:52]!r:<56} -> {got}")
        if was_missed:
            missed_by_old += 1
        shutil.rmtree(doc.parent, ignore_errors=True)
    check(missed_by_old == 4, f"the fixture still carries all 4 missed spellings ({missed_by_old})")
    # CONTROL — a live natbib load, through the identical harness.
    doc = _doc(preamble=r"\usepackage{natbib}")
    check(BF.resolve_bib_family(doc) == "natbib", "CONTROL: a live natbib load is natbib")
    shutil.rmtree(doc.parent, ignore_errors=True)


def test_ladder():
    print("\nthe ladder (stored > preamble > usage > natbib)")

    # 1. STORED outranks a preamble that says the opposite. This is the rung the
    #    retired needle did not have at all: a user who set the Package control
    #    by hand was overridden by a guess.
    doc = _doc(preamble=r"\usepackage{natbib}", stored="biblatex")
    check(BF.resolve_bib_family(doc) == "biblatex", "stored biblatex outranks a natbib preamble")
    check(BF.stored_bib_family(doc) == "biblatex", "…and reports as stored")
    shutil.rmtree(doc.parent, ignore_errors=True)

    doc = _doc(preamble=r"\usepackage{biblatex}", stored="natbib")
    check(BF.resolve_bib_family(doc) == "natbib", "stored natbib outranks a biblatex preamble")
    shutil.rmtree(doc.parent, ignore_errors=True)

    # A junk stored value is NOT a choice — it narrows to None and the scan runs.
    doc = _doc(preamble=r"\usepackage{biblatex}", stored="chicago")
    check(BF.stored_bib_family(doc) is None, "a junk bibPackage narrows to None")
    check(BF.resolve_bib_family(doc) == "biblatex", "…so the preamble decides")
    shutil.rmtree(doc.parent, ignore_errors=True)

    # 2/3. No preamble load → the live cite USAGE decides, biblatex-only bucket
    #      included (a bucket the retired needle could not see at all).
    doc = _doc(body=r"As \parencite[p.~4]{smith} shows.")
    check(BF.resolve_bib_family(doc) == "biblatex", "usage: \\parencite pins biblatex")
    shutil.rmtree(doc.parent, ignore_errors=True)
    doc = _doc(body=r"As \citep{smith} shows.")
    check(BF.resolve_bib_family(doc) == "natbib", "usage: \\citep pins natbib")
    shutil.rmtree(doc.parent, ignore_errors=True)
    # A shared cite pins NEITHER — it must fall through to the default.
    doc = _doc(body=r"As \citeauthor{smith} shows.")
    check(BF.resolve_bib_family(doc) == "natbib", "a shared cite pins neither → default")
    shutil.rmtree(doc.parent, ignore_errors=True)

    # 4. Nothing at all → the baseline.
    doc = _doc()
    check(BF.resolve_bib_family(doc) == "natbib", "a bare doc is natbib (the baseline)")
    shutil.rmtree(doc.parent, ignore_errors=True)

    # The usage fallback believes only LIVE bytes too — a \parencite inside a
    # verbatim listing is not usage.
    doc = _doc(body="\\begin{verbatim}\n\\parencite{x}\n\\end{verbatim}\nPlain prose.")
    check(BF.resolve_bib_family(doc) == "natbib", "a verbatim-quoted cite is not usage")
    shutil.rmtree(doc.parent, ignore_errors=True)


def test_preamble_slice_fails_open():
    print("\nthe preamble slice fails OPEN (not split_regions' all-body)")
    # A fragment / preamble-only file with no \begin{document}. split_regions
    # answers ALL BODY (right for a preservation gate, wrong here) — this door
    # treats the whole projection as preamble, so the load still counts.
    frag = r"\documentclass{article}" + "\n" + r"\usepackage{biblatex}" + "\n"
    check(BF.detect_bib_family(frag) == "biblatex", "a preamble-only fragment still reports biblatex")
    check(
        BF.live_preamble(frag).strip().endswith("{biblatex}"),
        "…because the whole projection is the preamble",
    )


def test_no_tex_answers_quietly():
    print("\na paper folder with no readable .tex answers QUIETLY")
    tmp = Path(tempfile.mkdtemp(prefix="virgil-bibfam-notex-"))
    doc = tmp / "paper"
    (doc / "virgil").mkdir(parents=True)
    # Through a subprocess, so stderr is observable: `find_tex_file`'s miss path
    # is `die()`, and an "error: no .tex file found" line from a run that then
    # succeeds is a misleading one.
    r = subprocess.run(
        [sys.executable, "-c",
         f"import sys; sys.path.insert(0, {str(SCRIPTS)!r});"
         f"import bib_family as B; print(B.resolve_bib_family(__import__('pathlib').Path({str(doc)!r})))"],
        capture_output=True, text=True,
    )
    check(r.stdout.strip() == "natbib", f"answers the baseline (got {r.stdout.strip()!r})")
    check(r.stderr.strip() == "", f"…and says nothing on stderr (got {r.stderr.strip()[:80]!r})")
    shutil.rmtree(tmp, ignore_errors=True)


def test_voice_table():
    print("\nvoice within the family")
    check(BF.cite_command_for("natbib", "textual") == "citet", "natbib textual = citet")
    check(BF.cite_command_for("natbib", "parenthetical") == "citep", "natbib parenthetical = citep")
    check(BF.cite_command_for("biblatex", "textual") == "textcite", "biblatex textual = textcite")
    check(
        BF.cite_command_for("biblatex", "parenthetical") == "parencite",
        "biblatex parenthetical = parencite",
    )
    check(BF.classify_cite_family("citet") == "natbib", "\\citet pins natbib")
    check(BF.classify_cite_family(r"\Parencite[see][]{k}") == "biblatex", "\\Parencite pins biblatex")
    check(BF.classify_cite_family(r"\cite{k}") is None, "\\cite pins neither")


# ---------------------------------------------------------------------------
# create_card.py --kind=citation — the site that splices into the user's .tex.
# ---------------------------------------------------------------------------

def _paper(stored: str | None = None, preamble: str | None = None) -> Path:
    """A real copy of the sample paper, optionally re-pointed at a family."""
    tmp = Path(tempfile.mkdtemp(prefix="virgil-bibfam-doc-"))
    doc = tmp / "paper"
    shutil.copytree(SAMPLE, doc)
    if stored is not None:
        p = doc / "virgil" / "citations.json"
        data = json.loads(p.read_text(encoding="utf-8"))
        data["bibPackage"] = stored
        p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    if preamble is not None:
        tex = next(f for f in doc.iterdir() if f.suffix == ".tex")
        t = tex.read_text(encoding="utf-8")
        tex.write_text(t.replace("\\begin{document}", preamble + "\n\\begin{document}", 1),
                       encoding="utf-8")
    return doc


def _first_key(doc: Path) -> str:
    bib = next(f for f in doc.iterdir() if f.suffix == ".bib")
    import re
    m = re.search(r"@\w+\{([^,]+),", bib.read_text(encoding="utf-8"))
    return m.group(1).strip()


def _anchor(doc: Path) -> str:
    sys.path.insert(0, str(SCRIPTS))
    import _common as C
    tex = C.find_tex_file(doc).read_text(encoding="utf-8")
    return C.find_paragraph_uuids(tex)[0]["uuid"]


def _run_create(doc: Path, key: str, extra: list[str]) -> tuple[int, dict, str]:
    r = subprocess.run(
        [sys.executable, CREATE, str(doc), "--kind=citation", "--citekey", key,
         "--anchor", _anchor(doc), "--task-text", "cite it"] + extra,
        capture_output=True, text=True,
    )
    try:
        out = json.loads(r.stdout or "{}")
    except json.JSONDecodeError:
        out = {}
    return r.returncode, out, r.stderr


def test_create_card_defaults_from_the_door():
    print("\ncreate_card --kind=citation defaults FROM the door (into the real .tex)")

    # biblatex paper, no --cite-command: the command must be \textcite, and it
    # must be what actually landed in the .tex.
    doc = _paper(stored="biblatex")
    key = _first_key(doc)
    rc, out, err = _run_create(doc, key, [])
    check(rc == 0, f"create landed (rc={rc}) {err[:180]}")
    tex = next(f for f in doc.iterdir() if f.suffix == ".tex").read_text(encoding="utf-8")
    check("\\textcite{" + key + "}" in tex, "the .tex carries \\textcite (not \\citet)")
    check("\\citet{" + key + "}" not in tex, "…and no \\citet was spliced")
    check(out.get("warnings") is None, "an unqualified default warns about nothing")
    shutil.rmtree(doc.parent, ignore_errors=True)

    # CONTROL — the same paper as natbib takes \citet, byte-for-byte the
    # pre-464 behaviour, so this leg cannot pass by always answering biblatex.
    doc = _paper(stored="natbib")
    key = _first_key(doc)
    rc, out, err = _run_create(doc, key, [])
    check(rc == 0, f"CONTROL create landed (rc={rc}) {err[:180]}")
    tex = next(f for f in doc.iterdir() if f.suffix == ".tex").read_text(encoding="utf-8")
    check("\\citet{" + key + "}" in tex, "CONTROL: a natbib paper still takes \\citet")
    shutil.rmtree(doc.parent, ignore_errors=True)

    # An explicit --cite-command still WINS, and a family-incompatible one is
    # WARNED, never rewritten (the app's locked decision).
    doc = _paper(stored="biblatex")
    key = _first_key(doc)
    rc, out, err = _run_create(doc, key, ["--cite-command", "citet"])
    check(rc == 0, f"explicit command landed (rc={rc}) {err[:180]}")
    tex = next(f for f in doc.iterdir() if f.suffix == ".tex").read_text(encoding="utf-8")
    check("\\citet{" + key + "}" in tex, "an explicit \\citet is HONOURED, not rewritten")
    w = " ".join(out.get("warnings") or [])
    check("natbib-only" in w and "biblatex" in w, f"…and warned: {w[:110]!r}")
    shutil.rmtree(doc.parent, ignore_errors=True)

    # A family-COMPATIBLE explicit command warns about nothing.
    doc = _paper(stored="biblatex")
    key = _first_key(doc)
    rc, out, err = _run_create(doc, key, ["--cite-command", "parencite"])
    check(rc == 0, f"compatible explicit command landed (rc={rc}) {err[:180]}")
    check(out.get("warnings") is None, "a compatible explicit command warns about nothing")
    shutil.rmtree(doc.parent, ignore_errors=True)

    # The DETECTED path, not just the stored one: a biblatex preamble with no
    # stored choice must reach \textcite too.
    doc = _paper(preamble=r"\usepackage[backend=biber]{biblatex}")
    p = doc / "virgil" / "citations.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    data.pop("bibPackage", None)
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    key = _first_key(doc)
    rc, out, err = _run_create(doc, key, [])
    check(rc == 0, f"detected-path create landed (rc={rc}) {err[:180]}")
    tex = next(f for f in doc.iterdir() if f.suffix == ".tex").read_text(encoding="utf-8")
    check("\\textcite{" + key + "}" in tex, "a DETECTED biblatex preamble also reaches \\textcite")
    shutil.rmtree(doc.parent, ignore_errors=True)


# ---------------------------------------------------------------------------
# rename_citekey — the fifth member (a natbib-only rewrite vocabulary).
# ---------------------------------------------------------------------------

def test_rename_reaches_both_families():
    print("\nrename_citekey reaches BOTH families (and every multi-cite key group)")
    tex = (
        r"\textcite{oldkey} \parencite[p.~4]{oldkey} \autocites{oldkey}{other} "
        r"\autocites{a}{oldkey} \citet{oldkey} \Citep{oldkey} \citep*{oldkey} "
        r"\citet{a, oldkey, b} \cites{oldkey}[x][]{z}" "\n"
        r"Untouched: \citeauthorX{oldkey} \emph{oldkey} oldkey"
    )
    out, n = RC.rewrite_tex(tex, "oldkey", "newkey")
    check(n == 9, f"all 9 cite commands rewritten (got {n})")
    check("oldkey" not in out.split("Untouched:")[0], "no cite still names the retired key")
    check("\\citeauthorX{oldkey}" in out, "a non-cite command is untouched")
    check("\\emph{oldkey}" in out and out.rstrip().endswith("oldkey"), "prose is untouched")
    check("\\citep*{newkey}" in out, "the STARRED form is reached")
    check("\\autocites{newkey}{other}" in out, "multi-cite: the first key group")
    check("\\autocites{a}{newkey}" in out, "multi-cite: a LATER key group (the silent partial)")

    # ARITY. A SINGULAR command takes exactly one argument group, so an adjacent
    # unrelated brace group is not swallowed as a second key list — the cost of
    # writing the multi-cite repetition as the pattern for BOTH shapes.
    one, k = RC.rewrite_tex(r"\citet{oldkey}{oldkey}", "oldkey", "newkey")
    check(one == r"\citet{newkey}{oldkey}", f"a singular command claims ONE group (got {one})")
    check(k == 1, "…counted once")

    # The retired natbib-only vocabulary, reimplemented locally — so this leg
    # fails for the reason it names rather than by arithmetic identity.
    import re
    retired = re.compile(
        r"\\(" + "|".join(["citeyearpar", "citeauthor", "Citeauthor", "citealt", "citealp",
                           "Citealt", "Citealp", "citeyear", "citenum", "citet", "citep",
                           "Citet", "Citep", "cite"]) + r")"
        r"((?:\[[^\]]*\]){0,2})\{([^{}]*)\}"
    )
    old_hits = len(retired.findall(tex))
    check(old_hits < n, f"the retired natbib-only vocabulary reached only {old_hits} of {n}")

    # Idempotence — an absent key is a no-op, which is what makes the contract
    # treat a sync entry the doc never used as a clean 0-change op.
    same, zero = RC.rewrite_tex(tex, "nosuchkey", "x")
    check(zero == 0 and same == tex, "an absent key is a byte-identical no-op")


def test_vocabulary_is_partitioned():
    print("\nthe vocabulary partitions (every known command in exactly one bucket)")
    for name in CC.KNOWN_CITE_COMMANDS:
        buckets = [
            b for b, s in (("natbib-only", CC.NATBIB_ONLY),
                           ("shared", CC.SHARED),
                           ("biblatex-only", CC.BIBLATEX_ONLY))
            if name in s
        ]
        check(len(buckets) == 1, f"{name} is in exactly one bucket ({buckets})")
    check(CC.KERNEL_NEUTRAL <= CC.SHARED, "kernel-neutral is a subset of shared")
    check(CC.MULTI_CITE_NAMES <= CC.BIBLATEX_ONLY, "every multi-cite form is biblatex-only")


if __name__ == "__main__":
    test_preamble_spellings()
    test_ladder()
    test_preamble_slice_fails_open()
    test_no_tex_answers_quietly()
    test_voice_table()
    test_create_card_defaults_from_the_door()
    test_rename_reaches_both_families()
    test_vocabulary_is_partitioned()
    total = PASS + FAIL
    print(f"\n{PASS}/{total} passed")
    sys.exit(1 if FAIL else 0)
