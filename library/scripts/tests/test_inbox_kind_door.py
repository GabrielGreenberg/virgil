"""Task 799 — the inbox `kind` vocabulary is owned by the append DOOR.

Before it, the toast enum lived only in skill prose and `append_inbox_item`
appended verbatim, so the merge engine sent raw `bib.state` values and every
`unverified` merge toasted as a 5 s `info` row instead of an 11 s `attention`
one. Now the door maps a bib.state, refuses an undeclared kind, and stamps
`severity`. This suite pins:

  * the mapping (`bib_state_to_notification_kind`) over every canonical state;
  * the door: bib.state mapped + raw state kept, undeclared kind refused with
    NOTHING written, severity stamped (and a caller's own overwritten);
  * the CLI shim refuses with exit 2;
  * the merge engine: an `unverified` result lands as `kind == "failed"`;
  * a CENSUS over every `append_inbox_item(...)` call in the Python scripts:
    each literal kind is declared, and no site passes a raw state.

Run: python3 library/scripts/tests/test_inbox_kind_door.py [--standalone]
"""
import ast
import contextlib
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import merge_paper_references as mpr  # noqa: E402
import triage_apply as ta  # noqa: E402
from _tools import (  # noqa: E402
    CANONICAL_BIB_STATES,
    NOTIFICATION_CORE_SEVERITY,
    NOTIFICATION_KIND_FAMILIES,
    TERMINAL_BIB_STATES,
    InboxKindError,
    append_inbox_item,
    bib_state_to_notification_kind,
    notification_severity,
    resolve_inbox_item,
)


@contextlib.contextmanager
def _raises(exc_type):
    """`pytest.raises` for the standalone runner (no pytest in CI's python)."""
    try:
        yield
    except exc_type:
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def _library(root: Path) -> Path:
    (root / ".virgil" / "notifications").mkdir(parents=True, exist_ok=True)
    (root / "papers").mkdir(parents=True, exist_ok=True)
    (root / "master.bib").write_text("")
    (root / ".virgil" / "scripts").mkdir(parents=True, exist_ok=True)
    (root / ".virgil" / "catalog.json").write_text("{}")
    return root


def _inbox(library: Path) -> list[dict]:
    p = library / ".virgil" / "notifications" / "inbox.json"
    return json.loads(p.read_text())["items"] if p.exists() else []


# ── the mapping ───────────────────────────────────────────────────────


def test_every_canonical_state_maps_by_whether_the_user_must_act():
    for state in CANONICAL_BIB_STATES:
        expected = "authenticated" if state in TERMINAL_BIB_STATES else "failed"
        assert bib_state_to_notification_kind(state) == expected, state
    assert bib_state_to_notification_kind("unverified") == "failed"
    assert notification_severity("failed") == "attention"


def test_mapping_refuses_a_non_state():
    with _raises(InboxKindError):
        bib_state_to_notification_kind("would-auth")


# ── the door ──────────────────────────────────────────────────────────


def test_door_maps_a_bib_state_and_keeps_the_raw_state(tmp_path):
    lib = _library(tmp_path)
    append_inbox_item(lib, {"kind": "unverified", "citekey": "a", "at": "t", "summary": "s"})
    [item] = _inbox(lib)
    assert item["kind"] == "failed"
    assert item["state"] == "unverified"
    assert item["severity"] == "attention"


def test_door_refuses_an_undeclared_kind_and_writes_nothing(tmp_path):
    lib = _library(tmp_path)
    with _raises(InboxKindError):
        append_inbox_item(lib, {"kind": "made-up", "at": "t", "summary": "s"})
    with _raises(InboxKindError):
        append_inbox_item(lib, {"at": "t", "summary": "no kind"})
    assert _inbox(lib) == []


def test_door_stamps_severity_and_overrides_the_callers(tmp_path):
    assert resolve_inbox_item({"kind": "triage-needs-title", "severity": "info"})["severity"] == "attention"
    assert resolve_inbox_item({"kind": "indexed"})["severity"] == "info"
    assert resolve_inbox_item({"kind": "setup-needed"})["severity"] == "attention"


def test_family_kinds_resolve_only_with_a_member_tail():
    for head, (_sev, tails) in NOTIFICATION_KIND_FAMILIES.items():
        for tail in tails:
            notification_severity(head + tail)
        with _raises(InboxKindError):
            notification_severity(head + "bogus")


def test_every_triage_declared_kind_resolves_at_the_door():
    for kind in ta.notification_kinds():
        notification_severity(kind)


def test_core_kinds_are_the_five_the_app_knows():
    assert set(NOTIFICATION_CORE_SEVERITY) == {
        "indexed", "authenticated", "failed", "triaged", "setup-needed",
    }


# ── the CLI shim ──────────────────────────────────────────────────────


def _cli(lib: Path, item: dict, tmp_path: Path) -> subprocess.CompletedProcess:
    f = tmp_path / "item.json"
    f.write_text(json.dumps(item))
    return subprocess.run(
        [sys.executable, str(_SCRIPTS / "append_inbox_item.py"),
         "--item-file", str(f), "--library", str(lib)],
        capture_output=True, text=True,
    )


def test_cli_refuses_an_off_enum_kind_with_exit_2(tmp_path):
    lib = _library(tmp_path / "lib")
    r = _cli(lib, {"kind": "bogus", "at": "t", "summary": "s"}, tmp_path)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "refused" in r.stderr
    assert _inbox(lib) == []


def test_cli_maps_a_settled_state(tmp_path):
    lib = _library(tmp_path / "lib")
    r = _cli(lib, {"kind": "canonical", "citekey": "c", "at": "t", "summary": "s"}, tmp_path)
    assert r.returncode == 0, r.stderr
    [item] = _inbox(lib)
    assert (item["kind"], item["state"], item["severity"]) == ("authenticated", "canonical", "info")


# ── the merge engine ──────────────────────────────────────────────────


def test_merge_engine_unverified_result_toasts_as_failed(tmp_path):
    lib = _library(tmp_path)
    fake = SimpleNamespace(
        state="unverified", proposed_type=None, field_changes=[], doi_verified=False,
        sources=["crossref"], score=0.4, note="",
    )
    real = mpr._do_authenticate
    mpr._do_authenticate = lambda *a, **k: fake
    try:
        report = mpr.Report(citekey="paper", at="t")
        mpr._process_no_dup(
            library=lib,
            entry={"citekey": "smith2020", "type": "article",
                   "fields": {"title": "A Title", "author": "Smith, J.", "year": "2020"}},
            dry_run=False, report=report,
        )
    finally:
        mpr._do_authenticate = real
    items = [i for i in _inbox(lib) if i.get("citekey") == "smith2020"]
    assert items, "the merge engine appended no notification"
    assert items[-1]["kind"] == "failed"
    assert items[-1]["state"] == "unverified"
    assert items[-1]["severity"] == "attention"


# ── census: every Python caller ───────────────────────────────────────


def _module_constants(tree: ast.Module) -> dict[str, str]:
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) \
                and isinstance(node.value.value, str):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    out[t.id] = node.value.value
    return out


def _append_sites():
    roots = [_SCRIPTS, _SCRIPTS.parent.parent / "editor" / "scripts"]
    for root in roots:
        for f in sorted(root.glob("*.py")):
            tree = ast.parse(f.read_text())
            consts = _module_constants(tree)
            for n in ast.walk(tree):
                if not isinstance(n, ast.Call):
                    continue
                name = getattr(n.func, "id", getattr(n.func, "attr", None))
                if name != "append_inbox_item" or len(n.args) < 2:
                    continue
                yield f, n, n.args[1], consts


def test_census_no_caller_passes_an_undeclared_or_raw_state_kind():
    seen = 0
    problems = []
    for f, call, arg, consts in _append_sites():
        if not isinstance(arg, ast.Dict):
            continue  # a variable item (triage_apply's `inbox_item`): triage's declared set is pinned above
        for k, v in zip(arg.keys, arg.values):
            if not (isinstance(k, ast.Constant) and k.value == "kind"):
                continue
            seen += 1
            where = f"{f.name}:{call.lineno}"
            if isinstance(v, ast.Constant):
                try:
                    notification_severity(v.value)
                except InboxKindError as e:
                    problems.append(f"{where}: {e}")
            elif isinstance(v, ast.Name):
                if v.id not in consts:
                    problems.append(f"{where}: kind is an unresolvable name {v.id}")
                else:
                    try:
                        notification_severity(consts[v.id])
                    except InboxKindError as e:
                        problems.append(f"{where}: {e}")
            elif isinstance(v, ast.Call):
                fn = getattr(v.func, "id", getattr(v.func, "attr", None))
                if fn != "bib_state_to_notification_kind":
                    problems.append(f"{where}: kind computed by {fn}()")
            elif isinstance(v, ast.JoinedStr):
                head = v.values[0].value if v.values and isinstance(v.values[0], ast.Constant) else ""
                if head not in NOTIFICATION_KIND_FAMILIES:
                    problems.append(f"{where}: f-string kind with undeclared head {head!r}")
            else:
                problems.append(f"{where}: kind is {ast.unparse(v)} — a raw state?")
    assert seen >= 20, f"census found only {seen} sites — the scan broke"
    assert problems == []


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
