#!/usr/bin/env python3
r"""The Python footnote helpers read the footnote atom's whole grammar (task 1561).

The serializer emits LaTeX's mark override raw — `\vfid{f1}\footnote[7]{…}` —
but apply_response.py's body-edit and strip helpers each re-spelled the atom as
`\footnote\{`, so editing such a card died ("could not find …") and reverting
one left `\footnote[7]{body}` in the .tex as a cardless footnote. Both now ask
ONE reader, `footnote_body_span` in _common.py, which shares its argument walk
with `bound_atom_after`.

Runs from anywhere, no pytest:
    python3 editor/scripts/tests/test_footnote_mark_option.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from _common import bound_atom_after, footnote_body_span  # noqa: E402
from apply_response import (  # noqa: E402
    _replace_footnote_body_in_tex,
    _strip_footnote_from_tex,
)

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


def main():
    pre, post = "Claim.", " Next sentence."
    cases = {
        "mark option": r"\footnote[7]{a {b} c}",
        "plain footnote": r"\footnote{a {b} c}",
        "thanks": r"\thanks{a {b} c}",
        "argument gap": "\\footnote[7] {a {b} c}",
        "escaped brace": r"\footnote{a \} {b} c}",
    }
    for label, atom in cases.items():
        text = pre + r"\vfid{f1}" + atom + post
        body = atom[atom.index("{") + 1:-1]

        out = _replace_footnote_body_in_tex(text, "f1", "new {x} body")
        check(out == pre + r"\vfid{f1}" + atom[:atom.index("{") + 1] + "new {x} body}" + post,
              f"edit {label}: body replaced, command + [mark] kept")

        out = _strip_footnote_from_tex(text, "f1")
        check(out == pre + post, f"strip {label}: marker AND atom removed")

        span = footnote_body_span(text, len(pre) + len(r"\vfid{f1}"))
        check(span is not None and text[span[0]:span[1]] == body,
              f"reader {label}: body span is the required arg's inside")

        # The reader agrees with the marker-conservation bound on the atom's end.
        bound = bound_atom_after(text, len(pre) + len(r"\vfid{f1}"))
        check(bound is not None and bound[1] and bound[0] == atom,
              f"reader {label}: atom end agrees with bound_atom_after")

    # Not a footnote atom: edit refuses, strip drops only the orphan marker.
    for label, after in {"no atom": " plain", "footnotetext": r"\footnotetext{x}",
                         "unterminated": r"\footnote[7]{open"}.items():
        text = pre + r"\vfid{f1}" + after
        check(_replace_footnote_body_in_tex(text, "f1", "x") is None,
              f"edit {label}: refused (None)")
        check(_strip_footnote_from_tex(text, "f1") == pre + after,
              f"strip {label}: only the orphan marker goes")

    check(_replace_footnote_body_in_tex("no marker", "f1", "x") is None
          and _strip_footnote_from_tex("no marker", "f1") is None,
          "absent marker: both helpers return None")

    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
