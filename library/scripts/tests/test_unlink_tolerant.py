"""The refused-delete policy, LIBRARY silo (task 496).

The editor silo's twin (`editor/scripts/tests/test_unlink_tolerant.py`) carries
the headline: the cowork pen's release deleted `.virgil/pen-context.json`, and
on a mount that refuses deletion (the reported cloud/Dropbox one) the raise
rolled a committed collab restore back to Claude-held and reported exit 2 on an
already-landed write. This silo has the identical SHAPE at four more sites, and
one of them is worse in kind: `drain_queue._mark_done` unlinks the queue entry
it has just retired, and `_drain_one`'s `finally:` unlinks the lock — a refused
delete there replaces the entry's own result with an OSError.

The helper is MIRRORED rather than shared: the two script trees ship as
independent skill bundles and cannot import each other. The byte-identity of
the two copies is pinned on the editor side; what is pinned HERE is that this
silo's copy behaves, and that every delete in it asks the helper.

Run: python3 library/scripts/tests/test_unlink_tolerant.py
"""
import io
import re
import shutil
import sys
import tempfile
import traceback
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "library/scripts"
sys.path.insert(0, str(SCRIPTS))

from _tools import rmtree_tolerant, unlink_tolerant  # noqa: E402


# ── behaviour ─────────────────────────────────────────────────────────────

def test_present_file_is_deleted_silently():
    d = Path(tempfile.mkdtemp())
    try:
        f = d / "x.txt"
        f.write_text("x")
        err = io.StringIO()
        with redirect_stderr(err):
            assert unlink_tolerant(f) is True
        assert not f.exists()
        assert err.getvalue() == ""
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_absent_file_reads_as_gone():
    d = Path(tempfile.mkdtemp())
    try:
        err = io.StringIO()
        with redirect_stderr(err):
            assert unlink_tolerant(d / "never") is True
        assert err.getvalue() == ""
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_refused_delete_warns_on_stderr_and_never_raises():
    d = Path(tempfile.mkdtemp())
    try:
        keep = d / "keep.txt"
        keep.write_text("y")
        real = Path.unlink

        def refuse(self, missing_ok=False):
            raise PermissionError(13, "Operation not permitted")

        out, err = io.StringIO(), io.StringIO()
        Path.unlink = refuse
        try:
            with redirect_stdout(out), redirect_stderr(err):
                ok = unlink_tolerant(keep, what="queue lock")
        finally:
            Path.unlink = real
        assert ok is False
        assert keep.exists()
        assert "PermissionError" in err.getvalue()
        assert "queue lock" in err.getvalue()
        # stdout is a contract channel in both silos — nothing may land there.
        assert out.getvalue() == ""
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_rmtree_tolerant():
    d = Path(tempfile.mkdtemp())
    try:
        sub = d / "t" / "deep"
        sub.mkdir(parents=True)
        (sub / "a").write_text("a")
        assert rmtree_tolerant(d / "t") is True
        assert not (d / "t").exists()
        assert rmtree_tolerant(d / "absent") is True

        sub.mkdir(parents=True)
        real = shutil.rmtree
        err = io.StringIO()
        shutil.rmtree = lambda *a, **k: (_ for _ in ()).throw(PermissionError(13, "nope"))
        try:
            with redirect_stderr(err):
                assert rmtree_tolerant(d / "t") is False
        finally:
            shutil.rmtree = real
        assert "PermissionError" in err.getvalue()
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ── the drain-queue members ───────────────────────────────────────────────

def test_mark_done_survives_a_refused_delete():
    """M4. `_mark_done` writes a `.done` sibling and then unlinks the entry.
    The `.done` WRITE is what retires it — `_list_pending` skips a queue file
    whose same-kind `.done` sibling exists — so a refused unlink must leave a
    completed drain completed, not raise out of it."""
    import drain_queue as DQ  # noqa: PLC0415

    d = Path(tempfile.mkdtemp())
    try:
        entry = d / "e.json"
        entry.write_text('{"kind": "index", "citekey": "x"}')
        real = Path.unlink

        def refuse(self, missing_ok=False):
            raise PermissionError(13, "Operation not permitted")

        err = io.StringIO()
        Path.unlink = refuse
        try:
            with redirect_stderr(err):
                DQ._mark_done(entry)          # must NOT raise
        finally:
            Path.unlink = real
        assert (d / "e.done").exists(), "the .done sibling — the actual retirement — landed"
        assert entry.exists(), "the undeletable entry is left behind, inertly"
        assert "PermissionError" in err.getvalue()
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ── census ────────────────────────────────────────────────────────────────

DELETE_CALL = re.compile(r"(?:os\.remove|os\.unlink|shutil\.rmtree|\.unlink)\s*\(")
EXEMPT = re.compile(r"unlink-exempt:\s*\S")


def _strip_strings_and_comments(src: str) -> str:
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


def test_census_no_raw_delete_in_the_library_silo():
    """The leg with teeth. The helper was never the part that could misbehave —
    a delete site that never asks it is, and it runs perfectly until the day the
    mount says no."""
    src_tools = (SCRIPTS / "_tools.py").read_text(encoding="utf-8")
    lo = src_tools.count("\n", 0, src_tools.index("# --- BEGIN MIRRORED")) + 1
    hi = src_tools.count("\n", 0, src_tools.index("# --- END MIRRORED")) + 1

    offenders, exempt, seen = [], 0, 0
    for p in sorted(SCRIPTS.rglob("*.py")):
        rel = p.relative_to(ROOT).as_posix()
        if "/tests/" in rel or p.name.startswith("test_") or "__pycache__" in rel:
            continue
        raw = p.read_text(encoding="utf-8")
        raw_lines = raw.splitlines()
        code_lines = _strip_strings_and_comments(raw).splitlines()
        for idx, line in enumerate(code_lines, start=1):
            if not DELETE_CALL.search(line):
                continue
            seen += 1
            if p.name == "_tools.py" and lo <= idx <= hi:
                continue
            if EXEMPT.search("\n".join(raw_lines[max(0, idx - 9):idx])):
                exempt += 1
                continue
            offenders.append(f"{rel}:{idx}  {raw_lines[idx - 1].strip()}")
    assert offenders == [], "raw delete outside the helper:\n  " + "\n  ".join(offenders)
    assert seen >= 3, f"canary: the needle matched only {seen} line(s)"
    assert exempt == 1, f"exactly one stated exemption survives (found {exempt})"


def test_the_helper_is_actually_reached():
    for name in ("drain_queue.py", "backfill_auth.py", "merge_bibs_preflight.py",
                 "apply_metadata_mismatch_policy.py", "rename_citekeys.py"):
        src = _strip_strings_and_comments((SCRIPTS / name).read_text(encoding="utf-8"))
        assert "unlink_tolerant" in src or "rmtree_tolerant" in src, name


def _run_standalone() -> int:
    tests = [(n, o) for n, o in sorted(globals().items())
             if n.startswith("test_") and callable(o)]
    failures = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  PASS  {name}")
        except Exception:
            failures += 1
            print(f"  FAIL  {name}")
            traceback.print_exc()
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        import pytest
    except ImportError:
        raise SystemExit(_run_standalone())
    raise SystemExit(pytest.main([__file__, "-q"]))
