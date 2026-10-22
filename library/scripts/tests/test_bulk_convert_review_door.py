"""The reviewed proposal list is what `--apply` converts (task 1227).

di-examples tells the agent to REJECT some proposals (broken-prose
continuations, overlaps with already-converted regions). Before this task
`--apply` took no proposal list — it re-detected and converted every
candidate, so a re-run over a partially converted paper turned prose into
an `\\ex` and nested an `\\ex` inside a new one. Now:

- mechanical rejections (inside / overlapping a converted `\\ex...\\xe`)
  are never proposed and never applied;
- judgment concerns are named in the record's `suspect` field;
- `--apply --proposals <reviewed.json>` converts exactly the kept records,
  refusing stale ones; bare `--apply` refuses while any record is suspect.

Run: python3 library/scripts/tests/test_bulk_convert_review_door.py
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import bulk_convert_numbered_examples as bc  # noqa: E402

_SCRIPT = _SCRIPTS / "bulk_convert_numbered_examples.py"

# The measured fixture: one converted example, one real example, one
# lowercase prose continuation, one line overlapping a converted block.
_PAPER = (
    "\\documentclass{article}\n\\begin{document}\n\n"
    "\\vexid{aaaa}\\ex[exno=1]\nJohn left.\n\\xe\n\n"
    "(2) Mary sang.\n\n"
    "(3) the claim in (2) is that she sang.\n\n"
    "(4) \\ex[exno=9] Sue danced. \\xe\n\n"
    "\\end{document}\n"
)


def _run(tex: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(_SCRIPT), str(tex), *args],
        capture_output=True, text=True,
    )


def test_overlap_is_never_proposed_and_prose_is_suspect():
    props = bc._propose(bc._gather_examples(_PAPER))
    assert [p["exno"] for p in props] == ["2", "3"], props
    assert props[0]["suspect"] is None
    assert "lowercase" in props[1]["suspect"]


def test_inside_converted_block_is_a_disallowed_region():
    text = "\\ex[exno=1]\n(5) Inside.\n\\xe\n\n(6) Outside.\n"
    assert [e["exno"] for e in bc._gather_examples(text)] == ["6"]


def test_sub_item_attaches_only_to_its_own_number():
    text = "(3) Pairs:\n\n(7b) Stray part.\n"
    (ex,) = bc._gather_examples(text)
    assert ex["kind"] == "ex" and ex["sub_items"] == []


def test_apply_with_reviewed_file_converts_only_kept_records():
    with tempfile.TemporaryDirectory() as d:
        tex = Path(d) / "main.tex"
        tex.write_text(_PAPER, encoding="utf-8")
        out = Path(d) / "proposals.json"
        assert _run(tex, "--out", str(out)).returncode == 0
        props = json.loads(out.read_text(encoding="utf-8"))
        out.write_text(
            json.dumps([p for p in props if not p["suspect"]]), encoding="utf-8",
        )
        r = _run(tex, "--apply", "--proposals", str(out))
        assert r.returncode == 0, r.stderr
        result = tex.read_text(encoding="utf-8")
        assert "\\ex[exno=2]\nMary sang.\n\\xe" in result
        assert "(3) the claim in (2)" in result        # rejected: untouched
        assert "(4) \\ex[exno=9] Sue danced. \\xe" in result
        assert result.count("\\ex[") == 3               # 1, 2, and the old 9
        assert "exno=3" not in result and "exno=4" not in result


def test_bare_apply_refuses_while_any_record_is_suspect():
    with tempfile.TemporaryDirectory() as d:
        tex = Path(d) / "main.tex"
        tex.write_text(_PAPER, encoding="utf-8")
        r = _run(tex, "--apply")
        assert r.returncode == 2 and "suspect" in r.stderr
        assert tex.read_text(encoding="utf-8") == _PAPER


def test_stale_record_refuses_the_whole_apply():
    with tempfile.TemporaryDirectory() as d:
        tex = Path(d) / "main.tex"
        tex.write_text(_PAPER, encoding="utf-8")
        out = Path(d) / "proposals.json"
        _run(tex, "--out", str(out))
        props = [p for p in json.loads(out.read_text()) if not p["suspect"]]
        # A record the script would never propose (the overlap) is stale too.
        props.append({"line": 13, "start_char": _PAPER.index("(4)"),
                      "kind": "ex", "exno": "4", "body": "x", "sub_items": []})
        out.write_text(json.dumps(props), encoding="utf-8")
        r = _run(tex, "--apply", "--proposals", str(out))
        assert r.returncode == 2 and "no longer match" in r.stderr
        assert tex.read_text(encoding="utf-8") == _PAPER


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
