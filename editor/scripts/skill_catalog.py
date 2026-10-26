#!/usr/bin/env python3
r"""The front door's ROUTING VOCABULARY, read from the skills themselves (task 1056).

`/virgil/start` routes an ask by matching it against every `editor:*` and
`library:*` skill's own `description:` frontmatter — its triggers, its
`Does NOT trigger` lines, its `Heavy operation` / `Light —` weight
declaration and its `Args:` id contract. Until task 1056 it read those from
the harness skill listing, on the stated premise that the listing "surfaces
all of them". It does not: under its size budget the listing shows some
skills as a bare name and truncates others mid-sentence (measured
2026-10-10: 15 Virgil skills with no description at all, among them
`editor:review`, `editor:reject-suggestion` and `library:ai-requests`). A
dropped description is an unroutable skill, and a dropped `Heavy operation`
is a heavy run dispatched inline from a paper session.

So the vocabulary is read from DISK, here, once — and the CI doctrine guard
(`virgil/skills/__tests__/front-door-doctrine.test.ts`) runs THIS script for
its heavy / Task-bound populations, so the guard and the router share one
reader rather than two parses that can disagree.

Where the skills are (first that exists):
  1. `--root <dir>`: `<dir>/<silo>/skills/` (the Virgil repo — its source,
     not its built mirror) or, failing that, `<dir>/.claude/commands/<silo>/`
     (a managed folder).
  2. Derived from this file's own location: synced at
     `<folder>/.virgil/scripts/editor/skill_catalog.py` → the folder's
     `.claude/commands/<silo>/`; in the repo at `editor/scripts/` → the
     repo's `<silo>/skills/`.

Output: one JSON object per line, sorted by name —
  name          "editor:review" (the harness's own spelling)
  slash         "/editor/review"
  description   whitespace-normalised (hard wraps collapsed)
  heavy         /heavy operation/i on the normalised text (any casing:
                deep-index says `HEAVY operation`; `setup.md`'s "the heavy
                extraction tools" is an adjective, not a declaration)
  light         declares `Light — safe to invoke …`
  developerOnly description opens `Developer-only`, any casing — the SAME
                rule the bundle builders read to keep a skill OUT of the
                shipped bundle (`isRepoOnlySkill`, bundle-sources.mjs); the
                two are pinned equal by `developer-only-census.test.ts`
                (task 1310), so the front door never routes to a skill that
                is not on disk
  requiredIds   unbracketed `<requestId>` / `<bibKey>` in its `Args:` line
                (a bracketed `[<requestId>]` is optional — create-card)

CLI:  python3 skill_catalog.py [--root <dir>] [--silo editor|library]
Exits 0 with the catalog; exits 1 naming the paths it tried when no skill
directory resolves (an empty vocabulary is an error, not an answer).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Iterable, Optional

SILOS = ("editor", "library")
ID_TOKENS = ("<requestId>", "<bibKey>")

_HEAVY = re.compile(r"heavy operation", re.I)
_LIGHT = re.compile(r"\blight\s*[—–-]+\s*safe to invoke", re.I)
_ARGS = re.compile(r"Args:(.*?)(?:\.\s|\.?$)")
_BLOCK = re.compile(r"^[|>][+-]?\d*\s*$")
_DEV_ONLY = re.compile(r"developer-only", re.I)


def _frontmatter(text: str) -> Optional[str]:
    m = re.match(r"---\n(.*?)\n---", text, re.S)
    return m.group(1) if m else None


def parse_description(text: str) -> Optional[str]:
    """The `description:` value of a skill file, whitespace-normalised.

    Handles the three shapes the skill set uses: a `|` / `>` block scalar, a
    plain scalar on the key's line (with indented continuation lines), and a
    quoted scalar. Normalising is the point: the files hard-wrap freely, so a
    phrase like `Heavy operation` can sit across a line break."""
    fm = _frontmatter(text)
    if fm is None:
        return None
    lines = fm.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"description:\s*(.*)$", line)
        if not m:
            continue
        head = m.group(1).strip()
        parts = [] if _BLOCK.match(head) else [head]
        for cont in lines[i + 1:]:
            # The value runs until the next top-level key.
            if cont and not cont[0].isspace():
                break
            parts.append(cont)
        value = re.sub(r"\s+", " ", " ".join(parts)).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        return value
    return None


def required_ids(description: str) -> list[str]:
    m = _ARGS.search(description)
    if not m:
        return []
    required = re.sub(r"\[[^\]]*\]", "", m.group(1))
    return [t for t in ID_TOKENS if t in required]


def entry(silo: str, path: Path) -> Optional[dict]:
    desc = parse_description(path.read_text(encoding="utf-8"))
    if desc is None:
        return None
    name = path.stem
    return {
        "name": f"{silo}:{name}",
        "slash": f"/{silo}/{name}",
        "description": desc,
        "heavy": bool(_HEAVY.search(desc)),
        "light": bool(_LIGHT.search(desc)),
        "developerOnly": bool(_DEV_ONLY.match(desc)),
        "requiredIds": required_ids(desc),
    }


def skill_dirs(root: Optional[Path] = None) -> dict[str, Path]:
    """silo → its skill directory, for a managed folder or the repo."""
    if root is None:
        here = Path(__file__).resolve().parent
        # Synced: <folder>/.virgil/scripts/editor/skill_catalog.py
        if here.parent.name == "scripts" and here.parent.parent.name == ".virgil":
            root = here.parent.parent.parent
        else:  # Repo: <repo>/editor/scripts/skill_catalog.py
            root = here.parent.parent
    out: dict[str, Path] = {}
    for silo in SILOS:
        # Source first: in the repo, `.claude/commands/` is a gitignored BUILT
        # mirror that can lag the source; a managed folder has no `<silo>/skills/`.
        for cand in (root / silo / "skills", root / ".claude" / "commands" / silo):
            if cand.is_dir():
                out[silo] = cand
                break
    return out


def catalog(root: Optional[Path] = None, silos: Iterable[str] = SILOS) -> list[dict]:
    dirs = skill_dirs(root)
    rows = []
    for silo in silos:
        d = dirs.get(silo)
        if d is None:
            continue
        for f in sorted(d.glob("*.md")):
            if f.name.startswith("_"):
                continue
            e = entry(silo, f)
            if e is not None:
                rows.append(e)
    return sorted(rows, key=lambda r: r["name"])


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--root", type=Path, default=None)
    ap.add_argument("--silo", choices=SILOS, action="append")
    args = ap.parse_args(argv)
    silos = args.silo or list(SILOS)
    rows = catalog(args.root, silos)
    if not rows:
        dirs = skill_dirs(args.root)
        print(
            f"skill_catalog: no skills found for {silos} "
            f"(resolved dirs: {({k: str(v) for k, v in dirs.items()}) or 'none'}); "
            "pass --root <managed folder or Virgil repo>",
            file=sys.stderr,
        )
        return 1
    for r in rows:
        print(json.dumps(r, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
