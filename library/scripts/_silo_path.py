"""Where the OTHER silo's scripts live — the one cross-silo import door (task 1428).

A helper script runs from one of two layouts, and the two disagree about where
the sibling silo sits:

  repo     <repo>/editor/scripts/X.py          <repo>/library/scripts/Y.py
  synced   <folder>/.virgil/scripts/editor/X.py   <folder>/.virgil/scripts/library/Y.py

(`scriptsDirFor` in `library/lib/skill-bundle-layout.mjs` is the synced shape.)
An import anchored on ONE of them — `parents[2] / "library" / "scripts"` — works
in the repo and dies with `ModuleNotFoundError` in every paper folder, and the
bundle's path rewrite cannot save it: that rewrites path STRINGS, and this path
is assembled from parts. So no script spells the sibling path itself; it asks
`sibling_silo_dir`, which tries both layouts and names both when neither holds.

This file is byte-identical in `editor/scripts/` and `library/scripts/` (each
silo must import it from its OWN directory, before it can reach the other);
`scripts/__tests__/silo-layout-census.test.ts` pins the parity AND runs every
cross-silo script from a materialized synced layout.

Stdlib only.
"""

from __future__ import annotations

import sys
from pathlib import Path

SILOS = ("editor", "library")


def sibling_silo_dir(silo: str, *, needs: tuple[str, ...] = ()) -> Path:
    """The scripts directory of `silo`, as seen from the calling script.

    `needs` names module files (e.g. `"_bib_parse.py"`) that must exist there,
    so a half-shipped directory is not mistaken for the right one. Anchored
    on THIS file, which is always a sibling of the caller (every silo ships
    its own copy).
    """
    if silo not in SILOS:
        raise ValueError(f"unknown silo {silo!r} (expected one of {SILOS})")
    mine = Path(__file__).resolve().parent
    candidates = (
        mine.parent / silo,                    # synced: .virgil/scripts/<silo>
        mine.parent.parent / silo / "scripts",  # repo: <repo>/<silo>/scripts
    )
    for d in candidates:
        if d.is_dir() and all((d / n).is_file() for n in needs):
            return d
    looked = ", ".join(str(d) for d in candidates)
    want = f" holding {', '.join(needs)}" if needs else ""
    raise RuntimeError(
        f"the {silo} skill scripts{want} were found in none of: {looked} — "
        f"re-sync this folder's skills (open it in Virgil) or run from the repo"
    )


def import_path_for(silo: str, *, needs: tuple[str, ...] = ()) -> Path:
    """`sibling_silo_dir`, then APPEND it to `sys.path`.

    Appended, never prepended: the sibling silo's modules import their own
    siblings by bare name, and a module of the calling silo must never be
    shadowed by a same-named one from the other.
    """
    d = sibling_silo_dir(silo, needs=needs)
    if str(d) not in sys.path:
        sys.path.append(str(d))
    return d
