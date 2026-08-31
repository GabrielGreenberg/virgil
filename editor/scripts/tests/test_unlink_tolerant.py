#!/usr/bin/env python3
r"""The refused-delete policy, both silos (task 496).

A cowork session on a cloud (Dropbox) mount reported that "the pen-release step
errored after each write". The report understated it: `release_pen` ended every
skill commit by DELETING `.virgil/pen-context.json` through `atomic_write`'s
bare `os.remove`, and on a delete-blocked mount that raise fired AFTER the
collab restore had already committed — so `atomic_write`'s rollback put
`collab.json` back to the acquire-time state (`enabled: true`, pen held by
Claude) and wedged the paper read-only, while the exception escaped
`commit_under_pen`'s unguarded `finally` and turned an already-landed write-set
into exit 2 with no result JSON printed.

Three contracts live here, and the CENSUS is the leg with teeth: the helper was
never the part that could misbehave — a delete site that never asks it is, and
that runs perfectly until the day the mount says no.

  1. BEHAVIOUR — `unlink_tolerant` / `rmtree_tolerant` never raise, warn on
     STDERR (stdout carries the writeback-contract JSON), and report honestly.
  2. RELEASE BY REWRITE — with the delete monkeypatched to `PermissionError`,
     `commit_under_pen` returns normally, the write-set is on disk, collab.json
     is RESTORED (not Claude-held), and the pen record reads as RELEASED to the
     app's own ladder (`holder: null`), instantly rather than after the 60 s TTL.
  3. CENSUS + PARITY — every raw delete verb in `editor/scripts/` and
     `library/scripts/` is either inside the shared helper or carries an
     in-place `unlink-exempt:` marker with a stated reason; and the mirrored
     helper block is byte-identical across the two silos, which cannot import
     each other because they ship as independent skill bundles.

Runs from anywhere, no pytest:
    python3 editor/scripts/tests/test_unlink_tolerant.py
"""
import io
import json
import os
import re
import shutil
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

# repo root = tests/ -> scripts/ -> editor/ -> <root>
ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
LIB_SCRIPTS = ROOT / "library/scripts"
sys.path.insert(0, str(SCRIPTS))

import _common as C  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


# ── 1. Behaviour ──────────────────────────────────────────────────────────

def test_helper_behaviour():
    print("\nunlink_tolerant / rmtree_tolerant")
    d = Path(tempfile.mkdtemp())
    try:
        f = d / "gone.txt"
        f.write_text("x")

        # a present file is deleted, silently
        err = io.StringIO()
        with redirect_stderr(err):
            ok = C.unlink_tolerant(f)
        check(ok is True and not f.exists(), "a present file is deleted, reported True")
        check(err.getvalue() == "", "…with nothing on stderr")

        # an ABSENT file is 'gone afterwards' — True, silent
        err = io.StringIO()
        with redirect_stderr(err):
            ok = C.unlink_tolerant(d / "never-existed.txt")
        check(ok is True and err.getvalue() == "", "an absent file is True and silent")

        # a REFUSED delete: no raise, False, one stderr warning, nothing on stdout
        keep = d / "keep.txt"
        keep.write_text("y")
        real = Path.unlink

        def refuse(self, missing_ok=False):
            raise PermissionError(13, "Operation not permitted")

        out, err = io.StringIO(), io.StringIO()
        Path.unlink = refuse
        try:
            with redirect_stdout(out), redirect_stderr(err):
                ok = C.unlink_tolerant(keep, what="pen record")
        finally:
            Path.unlink = real
        check(ok is False, "a refused delete reports False rather than raising")
        check(keep.exists(), "…and the file is still there")
        check("PermissionError" in err.getvalue() and "pen record" in err.getvalue(),
              "…with a named warning on stderr")
        check(out.getvalue() == "", "…and NOTHING on stdout (it carries the contract JSON)")

        # rmtree twin
        sub = d / "tree" / "deep"
        sub.mkdir(parents=True)
        (sub / "a.txt").write_text("a")
        check(C.rmtree_tolerant(d / "tree") is True and not (d / "tree").exists(),
              "rmtree_tolerant removes a tree")
        check(C.rmtree_tolerant(d / "no-such-tree") is True,
              "…and an absent tree is True, not an error")

        real_rm = shutil.rmtree
        sub.mkdir(parents=True)
        err = io.StringIO()
        shutil.rmtree = lambda *a, **k: (_ for _ in ()).throw(PermissionError(13, "nope"))
        try:
            with redirect_stderr(err):
                ok = C.rmtree_tolerant(d / "tree")
        finally:
            shutil.rmtree = real_rm
        check(ok is False and "PermissionError" in err.getvalue(),
              "a refused rmtree reports False and warns")
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ── 2. Release by rewrite, on a delete-blocked mount ──────────────────────

def _paper(with_collab: bool) -> Path:
    d = Path(tempfile.mkdtemp())
    (d / "virgil").mkdir()
    if with_collab:
        (d / "virgil" / "collab.json").write_text(json.dumps({
            "enabled": False,
            "participants": [
                {"name": "Gabriel", "color": "#14b8a6", "firstSeen": "x"},
                {"name": "Claude", "color": "#6366f1", "firstSeen": "x"},
            ],
            "pen": dict(C.FREE_PEN),
            "presence": {},
        }, indent=2) + "\n")
    return d


class _RefuseDeletes:
    """The delete-blocked mount, in miniature: every `Path.unlink` raises."""

    def __enter__(self):
        self._real = Path.unlink

        def refuse(inner, missing_ok=False):
            raise PermissionError(13, "Operation not permitted")

        Path.unlink = refuse
        return self

    def __exit__(self, *exc):
        Path.unlink = self._real
        return False


def test_release_is_a_rewrite():
    print("\nrelease_pen — released record, not a delete")
    d = _paper(with_collab=True)
    try:
        C.acquire_pen(d)
        pcp = C.pen_context_path(d)
        check(json.loads(pcp.read_text())["holder"] == "claude", "acquire holds the pen")

        C.release_pen(d)
        check(pcp.exists(), "the pen record SURVIVES the release (it is rewritten)")
        # Each record leg stands on its own: on the pre-496 delete the file is
        # gone, and a read that throws would abort the rest of this function —
        # under-reporting the neuter it exists to measure.
        rec = json.loads(pcp.read_text()) if pcp.exists() else {}
        check(rec.get("holder", "absent") is None,
              "…carrying holder: null — released to the app's ladder")
        check(isinstance(rec.get("released_at"), str), "…and a released_at stamp")
        check(bool(rec) and "prior_pen" not in rec and "prior_collab_enabled" not in rec,
              "…and NONE of the acquire's spent prior_* snapshot")
        collab = json.loads((d / "virgil" / "collab.json").read_text())
        check(collab["enabled"] is False and collab["pen"]["holder"] is None,
              "collab.json is restored")

        # Idempotent: releasing an already-released record writes nothing.
        before = pcp.stat().st_mtime_ns if pcp.exists() else None
        C.release_pen(d)
        after = pcp.stat().st_mtime_ns if pcp.exists() else None
        check(before is not None and after == before,
              "releasing twice is a no-op — no second filesystem event")
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_commit_survives_a_delete_blocked_mount():
    print("\ncommit_under_pen on a mount that refuses deletion")
    d = _paper(with_collab=True)
    try:
        target = d / "virgil" / "notes.json"
        with _RefuseDeletes():
            err = io.StringIO()
            raised = None
            with redirect_stderr(err):
                try:
                    C.commit_under_pen(d, [(target, C.json_dumps({"n": 1}))])
                except Exception as e:  # noqa: BLE001
                    raised = e
        check(raised is None, "the commit returns NORMALLY — no exit-2 for a landed write")
        check(json.loads(target.read_text()) == {"n": 1}, "…and the write-set is on disk")

        collab = json.loads((d / "virgil" / "collab.json").read_text())
        check(collab["enabled"] is False,
              "collab.json is RESTORED, not rolled back to acquire-time enabled:true")
        check(collab["pen"]["holder"] is None,
              "…and the pen is free, not stuck at Claude-held")

        rec = json.loads(C.pen_context_path(d).read_text())
        check(rec.get("holder") is None,
              "the app's ladder reads the record as RELEASED immediately")
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_no_collab_paper_and_failed_write_still_release():
    print("\nthe two shapes the fix must not regress")
    d = _paper(with_collab=False)
    try:
        with _RefuseDeletes():
            err = io.StringIO()
            with redirect_stderr(err):
                C.commit_under_pen(d, [(d / "virgil" / "x.json", C.json_dumps({"x": 1}))])
        check(not (d / "virgil" / "collab.json").exists(),
              "a paper with no collab.json still gets none fabricated")
        check(json.loads(C.pen_context_path(d).read_text()).get("holder") is None,
              "…and its pen record still reads released")
    finally:
        shutil.rmtree(d, ignore_errors=True)

    # A FAILED write still propagates — the finally guards the RELEASE only.
    d = _paper(with_collab=True)
    try:
        a = d / "virgil" / "a.json"
        b = d / "virgil" / "b.json"
        os.environ["VIRGIL_TEST_FAIL_AFTER_WRITES"] = "1"
        raised = None
        try:
            C.commit_under_pen(d, [(a, C.json_dumps({"a": 1})), (b, C.json_dumps({"b": 1}))])
        except RuntimeError as e:
            raised = e
        finally:
            del os.environ["VIRGIL_TEST_FAIL_AFTER_WRITES"]
        check(raised is not None, "a failed WRITE still raises — the guard is around the release")
        check(not a.exists() and not b.exists(), "…and rolls back")
        check(json.loads(C.pen_context_path(d).read_text()).get("holder") is None,
              "…with the pen still released")
        check(json.loads((d / "virgil" / "collab.json").read_text())["enabled"] is False,
              "…and collab restored")
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_a_failing_release_cannot_poison_a_landed_commit():
    """The finally WRAP, on its own.

    The two halves of the fix are independently sufficient for the reported
    symptom — release-by-rewrite removes the delete, and the tolerant unlink
    swallows a refusal one layer down — so with both in place the wrap has
    nothing observable to do. An invariant with no leg is a habit: this drives
    it directly, by making the release itself raise. Every OTHER IO failure a
    release can hit (a full disk on the collab restore, a permission flip
    mid-commit) arrives exactly this way, and must not turn an already-landed
    write-set into exit 2 with no result JSON printed."""
    print("\ncommit_under_pen — a release that RAISES")
    d = _paper(with_collab=True)
    real = C.release_pen
    try:
        target = d / "virgil" / "notes.json"

        def boom(doc):
            raise OSError(28, "No space left on device")

        C.release_pen = boom
        err = io.StringIO()
        raised = None
        try:
            with redirect_stderr(err):
                C.commit_under_pen(d, [(target, C.json_dumps({"n": 1}))])
        except Exception as e:  # noqa: BLE001
            raised = e
        finally:
            C.release_pen = real
        check(raised is None, "the commit returns normally — the release cannot poison it")
        check(json.loads(target.read_text()) == {"n": 1}, "…and the write-set is on disk")
        check("pen release failed" in err.getvalue(),
              "…with the failure reported on stderr, not swallowed silently")
    finally:
        C.release_pen = real
        shutil.rmtree(d, ignore_errors=True)


def test_atomic_write_delete_arm_is_tolerant():
    print("\natomic_write's content-None arm")
    d = Path(tempfile.mkdtemp())
    try:
        doomed = d / "doomed.json"
        doomed.write_text("{}")
        kept = d / "kept.json"
        with _RefuseDeletes():
            err = io.StringIO()
            raised = None
            with redirect_stderr(err):
                try:
                    C.atomic_write([(doomed, None), (kept, C.json_dumps({"k": 1}))],
                                   fault_injectable=False)
                except Exception as e:  # noqa: BLE001
                    raised = e
        check(raised is None, "a refused delete does not fail the write-set")
        check(json.loads(kept.read_text()) == {"k": 1},
              "…the sibling content-write still lands (no rollback)")
        check(doomed.exists() and "warning" in err.getvalue(),
              "…the undeletable file stays, with a warning")
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ── 3. Census + parity ────────────────────────────────────────────────────

# A raw delete VERB, in any of the spellings either silo uses.
DELETE_CALL = re.compile(r"(?:os\.remove|os\.unlink|shutil\.rmtree|\.unlink)\s*\(")
# The in-place exemption, with a stated reason.
EXEMPT = re.compile(r"unlink-exempt:\s*\S")


def _strip_strings_and_comments(src: str) -> str:
    """Blank string literals and comments so the census reads CODE only —
    `_common.py`'s own docstrings name the verbs it retired, and the exemption
    markers are comments naming the very calls they excuse."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c == "#":
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
            continue
        if c in "'\"":
            triple = src[i:i + 3] in ('"""', "'''")
            q = src[i:i + 3] if triple else c
            j = i + len(q)
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src.startswith(q, j):
                    j += len(q)
                    break
                j += 1
            else:
                j = n
            out.append("".join(ch if ch == "\n" else " " for ch in src[i:j]))
            i = j
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _census_files():
    for root in (SCRIPTS, LIB_SCRIPTS):
        for p in sorted(root.rglob("*.py")):
            rel = p.relative_to(ROOT).as_posix()
            if "/tests/" in rel or p.name.startswith("test_") or "__pycache__" in rel:
                continue
            yield p, rel


def _helper_span(src: str) -> tuple[int, int]:
    a = src.index("# --- BEGIN MIRRORED")
    b = src.index("# --- END MIRRORED")
    return src.count("\n", 0, a) + 1, src.count("\n", 0, b) + 1


def test_census():
    print("\ncensus · every delete asks the helper (or says why not)")
    offenders, exempt_sites = [], []
    for p, rel in _census_files():
        raw = p.read_text(encoding="utf-8")
        raw_lines = raw.splitlines()
        code_lines = _strip_strings_and_comments(raw).splitlines()
        lo = hi = -1
        if "# --- BEGIN MIRRORED" in raw:
            lo, hi = _helper_span(raw)
        for idx, line in enumerate(code_lines, start=1):
            if not DELETE_CALL.search(line):
                continue
            if lo <= idx <= hi:
                continue  # the helper's own definition
            window = "\n".join(raw_lines[max(0, idx - 9):idx])
            if EXEMPT.search(window):
                exempt_sites.append((rel, idx))
                continue
            offenders.append(f"{rel}:{idx}  {raw_lines[idx - 1].strip()}")

    check(offenders == [],
          "no raw delete outside the helper\n      " + "\n      ".join(offenders))

    # A canary: the census must be able to SEE a delete at all, or it is
    # passing because the needle matches nothing.
    seen = sum(1 for p, _ in _census_files()
               if DELETE_CALL.search(_strip_strings_and_comments(p.read_text(encoding="utf-8"))))
    check(seen >= 2, f"the needle matches live code in {seen} file(s) (canary)")

    # An exemption is a standing licence, so it may only cover a HAND-TOLERANT
    # site: the delete must sit inside a try whose except does not re-raise.
    for rel, idx in exempt_sites:
        p = ROOT / rel
        lines = p.read_text(encoding="utf-8").splitlines()
        tail = "\n".join(lines[idx - 1: idx + 6])
        check("except" in tail and "raise" not in tail,
              f"exempt site {rel}:{idx} is hand-tolerant (try/except, no re-raise)")
    check(len(exempt_sites) == 2,
          f"exactly the two stated exemptions survive (found {len(exempt_sites)})")

    # The helper must be REACHED, not merely defined: the headline site is
    # `atomic_write`'s content-None arm, which is what the pen release rides.
    raw_common = (SCRIPTS / "_common.py").read_text(encoding="utf-8")
    common = _strip_strings_and_comments(raw_common)
    # Everything OUTSIDE the mirrored helper block, which legitimately spells
    # the raw verbs because it IS the implementation. The span is measured on
    # RAW lines (the stripper blanks the marker comments) and applied to the
    # code-only view line-for-line — the stripper is line-preserving.
    lo, hi = _helper_span(raw_common)
    outside = "\n".join(
        ln for i, ln in enumerate(common.splitlines(), start=1) if not (lo <= i <= hi)
    )
    check("unlink_tolerant(p)" in outside,
          "atomic_write's content-None arm goes through the helper")
    check("os.remove" not in outside and "shutil.rmtree(" not in outside,
          "…and _common.py spells no raw delete verb outside the helper")

    # release_pen must not put a delete in its write-set at all — and it must
    # write the released record the app's ladder reads as free.
    rel_body = common[common.index("def release_pen"):common.index("def commit_under_pen")]
    check("None)" not in rel_body.replace("default=None)", ""),
          "release_pen's write-set carries no content-None (delete) entry")
    raw_rel = raw_common[raw_common.index("def release_pen"):
                         raw_common.index("def commit_under_pen")]
    check('"holder": None' in raw_rel and "json_dumps(released)" in raw_rel,
          "…it writes a released record instead")


def test_released_ness_has_one_home():
    """The retired notion of released-ness ("the file is GONE") was spelled by
    hand in nine places across six suites. A suite that re-forks it would go
    green against a delete-based release and red against the rewrite — i.e. it
    would pin the defect as the contract, which is what four of them did."""
    print("\ncensus · released-ness is ONE predicate")
    offenders = []
    for p in sorted((SCRIPTS / "tests").glob("test_*.py")):
        if p.name == Path(__file__).name:
            continue
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), start=1):
            code = _strip_strings_and_comments(line)
            if "pen-context.json" in line and "exists()" in code:
                offenders.append(f"{p.name}:{i}  {line.strip()}")
    check(offenders == [],
          "no suite hand-tests the pen record's EXISTENCE\n      "
          + "\n      ".join(offenders))
    users = [p.name for p in sorted((SCRIPTS / "tests").glob("test_*.py"))
             if "pen_released" in p.read_text(encoding="utf-8")]
    check(len(users) >= 6, f"…and {len(users)} suites read the shared predicate (canary)")


def test_parity():
    print("\nparity · the mirrored block is byte-identical across the silos")
    blocks = {}
    for rel in ("editor/scripts/_common.py", "library/scripts/_tools.py"):
        src = (ROOT / rel).read_text(encoding="utf-8")
        a = src.index("# --- BEGIN MIRRORED")
        b = src.index("# --- END MIRRORED")
        blocks[rel] = src[a:b]
    vals = list(blocks.values())
    check(len(vals[0]) > 500, "the block is substantive")
    check(vals[0] == vals[1],
          "editor/_common.py and library/_tools.py carry the SAME helper block")
    # Both must actually EXPORT the names, not merely contain the text.
    sys.path.insert(0, str(LIB_SCRIPTS))
    import _tools as T  # noqa: PLC0415

    check(callable(getattr(T, "unlink_tolerant", None))
          and callable(getattr(T, "rmtree_tolerant", None)),
          "the library silo's copy is importable")
    check(T.unlink_tolerant.__doc__ == C.unlink_tolerant.__doc__,
          "…with the same contract")


if __name__ == "__main__":
    test_helper_behaviour()
    test_release_is_a_rewrite()
    test_commit_survives_a_delete_blocked_mount()
    test_no_collab_paper_and_failed_write_still_release()
    test_a_failing_release_cannot_poison_a_landed_commit()
    test_atomic_write_delete_arm_is_tolerant()
    test_census()
    test_released_ness_has_one_home()
    test_parity()
    total = PASS + FAIL
    print(f"\n{PASS}/{total} passed")
    sys.exit(1 if FAIL else 0)
