#!/usr/bin/env python3
r"""Task 883 — the skill READER and the WRITER agree on every paragraph's bytes.

`get_para_context.py` used to re-derive "which bytes are the anchored
paragraph" from blank-line slabs, keeping only the FIRST `%!v:` marker of each
slab: a heading + `\label` (`1100`), the title block and list items came back
as a one-line fallback with no neighbours, so ten skills drafted against the
wrong context. It now reads through `_common.paragraph_spans`, the resolver
`apply_response._anchored_paragraph` scopes its edits through.

Census over EVERY marker in the frozen sample: the reader's span covers
exactly the writer's region (leading whitespace aside) through its own marker,
and its neighbours are the adjacent markers — non-empty except at a doc end.

Run from anywhere:  python3 editor/scripts/tests/test_para_context_agreement.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
SAMPLE = ROOT / "samples/annotation-history"
sys.path.insert(0, str(SCRIPTS))

import apply_response as AR  # noqa: E402
import get_para_context as GPC  # noqa: E402
from _common import find_tex_file, paragraph_spans  # noqa: E402

PASS, FAIL = 0, 0
def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")

text = find_tex_file(SAMPLE).read_text(encoding="utf-8")
lines = text.splitlines()
spans = paragraph_spans(text)
markers = [s["uuid"] for s in spans]
kinds = {s["uuid"]: s["kind"] for s in spans}
check(len(markers) > 20, f"sample carries a real marker census ({len(markers)})")
check("texBlock" in kinds.values(), "sample carries a raw texBlock (7e10)")
first_seen = {}
for i, u in enumerate(markers):
    first_seen.setdefault(u, i)

for u, i in first_seen.items():
    ctx = GPC.para_context(text, u, neighbors=1)
    check(ctx is not None, f"{u}: reader resolves")
    if ctx is None:
        continue
    if kinds[u] == "texBlock":
        check(AR._anchored_paragraph(text, u) is None, f"{u}: writer never targets a texBlock")
        check(ctx["paragraph"].startswith(f"%!vtex:begin {u}")
              and ctx["paragraph"].endswith(f"%!vtex:end {u}"), f"{u}: texBlock span = sentinel pair")
    else:
        start, mi = AR._anchored_paragraph(text, u)
        want = text[start:mi].lstrip() + f"%!v:{u}"
        check(ctx["paragraph"] == want, f"{u}: reader span == writer span")
        check("%!vtex:" not in ctx["paragraph"], f"{u}: no raw block swallowed")
    a, b = ctx["lineRange"]
    got_lines = "\n".join(lines[a - 1 : b])
    check(ctx["paragraph"] in got_lines, f"{u}: lineRange {a}-{b} covers the paragraph")
    nb = [n["uuid"] for n in ctx["neighbors"]]
    expect = markers[max(0, i - 1) : i] + markers[i + 1 : i + 2]
    check(nb == expect, f"{u}: neighbours {nb} == adjacent markers {expect}")
    check(bool(nb), f"{u}: neighbours non-empty")

# The reported regression, end to end through the CLI.
out = subprocess.run(
    [sys.executable, str(SCRIPTS / "get_para_context.py"), str(SAMPLE), "1100"],
    capture_output=True, text=True, check=True,
)
j = json.loads(out.stdout)
check(j["paragraph"].startswith("\\section{Introduction}"), "1100: heading line kept")
check(len(j["neighbors"]) == 2, "1100: both neighbours present")
check(j["tex"] == "document.tex", "1100: tex path")

# A raw block bounds the paragraph after it; a `%!v:` inside one is raw LaTeX;
# an unterminated begin is a comment line (parser fails closed), not a block.
SYN = r"""\documentclass{article}
\begin{document}
First. %!v:aa01

%!vtex:begin bb01
\draw (0,0) -- (1,1); %!v:dead
%!vtex:end bb01

After the block. %!v:aa02

%!vtex:begin cc01
Unterminated. %!v:aa03
\end{document}
"""
sp = paragraph_spans(SYN)
check([(x["uuid"], x["kind"]) for x in sp]
      == [("aa01", "paragraph"), ("bb01", "texBlock"), ("aa02", "paragraph"), ("aa03", "paragraph")],
      f"synthetic census {[(x['uuid'], x['kind']) for x in sp]}")
c = GPC.para_context(SYN, "aa02")
check(c["paragraph"] == "After the block. %!v:aa02", f"aa02 bounded by the raw block: {c['paragraph']!r}")
check([n["uuid"] for n in c["neighbors"]] == ["bb01", "aa03"], "aa02 neighbours")
check(GPC.para_context(SYN, "dead") is None, "a %!v: inside a raw block is not an anchor")
check(GPC.para_context(SYN, "aa03")["paragraph"].startswith("%!vtex:begin cc01"),
      "unterminated begin stays paragraph bytes")

# --neighbors=0 → none; absent uuid → exit 3.
check(GPC.para_context(text, "1100", neighbors=0)["neighbors"] == [], "neighbors=0")
miss = subprocess.run(
    [sys.executable, str(SCRIPTS / "get_para_context.py"), str(SAMPLE), "ffff"],
    capture_output=True, text=True,
)
check(miss.returncode == 3, "absent uuid exits 3")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
