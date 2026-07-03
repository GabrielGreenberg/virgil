#!/usr/bin/env python3
"""End-to-end tests for the de-duplication cleanup CLI (``dedup.py``).

Builds a synthetic FIXTURE library in a tempdir, then drives the real CLI
subcommands (``scan`` → ``apply`` → ``verify``) against it and asserts the
non-negotiable safety invariants from ``DEDUP_DESIGN.md``:

* The deep-indexed member (with a real ``papers/<ck>/`` folder + sidecars)
  is the SURVIVOR and its folder + files are never archived/deleted.
* The bib-only loser row disappears from the catalog.
* The loser's master.bib entry disappears.
* The survivor keeps its citekey.
* An alias loser→survivor is recorded.
* ``verify`` passes.
* A backup file exists after ``apply``.
* An ``--expect-sha`` mismatch aborts with NO changes.

Fixture composition (8 master.bib entries):

  Duplicate-work pair #1 (both bib-only, share a DOI):
    doiA_keep / doiA_dup   → same DOI 10.1111/aaa

  Duplicate-work pair #2 (a held+deepIndexed paper vs a bib-only stub;
  identical title+year+surname so Rule C fires):
    heldpaper2020          → deepIndexed, has papers/<ck>/ + sidecars (SURVIVOR)
    stub2020               → bib-only stub                        (LOSER)

  Four singleton controls that must NOT be touched:
    alpha2001, beta2002, gamma2003, delta2004

Run:  python3 test_dedup_cli.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import _tools  # noqa: E402
import dedup  # noqa: E402  (import for in-process helpers / sanity)


# ─────────────────────────────────────────────────────────────────────────
# Fixture construction
# ─────────────────────────────────────────────────────────────────────────


MASTER_BIB = """% Virgil Library — master bibliography (synthetic fixture)

% bib.state = authenticated
@article{doiA_keep,
  title = {A Study of Widgets},
  author = {Smith, Jane},
  year = {2015},
  doi = {10.1111/aaa},
  journal = {Journal of Widgets}
}

% bib.state = unverified
@article{doiA_dup,
  title = {A Study of Widgets},
  author = {Smith, Jane},
  year = {2015},
  doi = {10.1111/aaa}
}

% bib.state = manuscript
@article{heldpaper2020,
  title = {Coherence and Discourse Structure},
  author = {Cohen, Jonathan},
  year = {2020},
  journal = {Journal of Semantics}
}

% bib.state = unverified
@article{stub2020,
  title = {Coherence and Discourse Structure},
  author = {Cohen, Jonathan},
  year = {2020}
}

% bib.state = authenticated
@article{alpha2001,
  title = {Alpha Particles in Context},
  author = {Alpher, Ralph},
  year = {2001},
  doi = {10.2222/alpha}
}

% bib.state = authenticated
@book{beta2002,
  title = {Beta Decay and Beyond},
  author = {Bethe, Hans},
  year = {2002},
  isbn = {9780000000002}
}

% bib.state = authenticated
@article{gamma2003,
  title = {Gamma Ray Bursts Explained},
  author = {Gamow, George},
  year = {2003},
  doi = {10.3333/gamma}
}

% bib.state = authenticated
@incollection{delta2004,
  title = {Delta Functions in Practice},
  author = {Dirac, Paul},
  year = {2004},
  booktitle = {Handbook of Distributions}
}
"""


def _catalog() -> dict:
    """Catalog with rows for the held paper + the two doiA refs + controls.

    Note: doiA_keep/doiA_dup are bib-only *refs* but we still give them catalog
    rows here so the test can prove the loser ROW is removed (the more dangerous
    catalog-side deletion), not just the master entry."""
    return {
        "version": 1,
        "generatedAt": "2020-01-01T00:00:00Z",
        "entries": [
            {
                "citekey": "doiA_keep",
                "addedAt": "2020-01-01T00:00:00Z",
                "updatedAt": "2020-01-01T00:00:00Z",
                "pdf": {"present": False},
                "indexed": {"state": "none"},
                "bib": {"state": "authenticated", "importedKeys": ["x1"]},
                "title": "A Study of Widgets",
                "doi": "10.1111/aaa",
            },
            {
                "citekey": "doiA_dup",
                "addedAt": "2020-06-01T00:00:00Z",
                "updatedAt": "2020-06-01T00:00:00Z",
                "pdf": {"present": False},
                "indexed": {"state": "none"},
                "bib": {"state": "unverified"},
            },
            {
                "citekey": "heldpaper2020",
                "addedAt": "2020-01-01T00:00:00Z",
                "updatedAt": "2020-05-01T00:00:00Z",
                "pdf": {"present": True, "filename": "heldpaper2020.pdf",
                        "sha256": "deadbeef", "pageCount": 20},
                "indexed": {"state": "deepIndexed", "pgmarkCount": 20},
                "bib": {"state": "manuscript"},
                "title": "Coherence and Discourse Structure",
            },
            {
                "citekey": "stub2020",
                "addedAt": "2020-07-01T00:00:00Z",
                "updatedAt": "2020-07-01T00:00:00Z",
                "pdf": {"present": False},
                "indexed": {"state": "none"},
                "bib": {"state": "unverified"},
            },
            {
                "citekey": "alpha2001",
                "addedAt": "2020-01-01T00:00:00Z", "updatedAt": "2020-01-01T00:00:00Z",
                "pdf": {"present": False}, "indexed": {"state": "none"},
                "bib": {"state": "authenticated"},
            },
            {
                "citekey": "gamma2003",
                "addedAt": "2020-01-01T00:00:00Z", "updatedAt": "2020-01-01T00:00:00Z",
                "pdf": {"present": False}, "indexed": {"state": "none"},
                "bib": {"state": "authenticated"},
            },
        ],
    }


def build_fixture(root: Path) -> None:
    """Materialize a synthetic library at ``root``."""
    (root / ".virgil").mkdir(parents=True, exist_ok=True)
    (root / "papers").mkdir(parents=True, exist_ok=True)

    (root / "master.bib").write_text(MASTER_BIB)
    (root / ".virgil" / "catalog.json").write_text(json.dumps(_catalog(), indent=2) + "\n")
    (root / ".virgil" / "catalog-version.txt").write_text("1\n")

    # The deepIndexed survivor's real folder + sidecars (must SURVIVE).
    pdir = root / "papers" / "heldpaper2020"
    (pdir / "virgil").mkdir(parents=True, exist_ok=True)
    (pdir / "main.tex").write_text(r"\documentclass{article}\begin{document}Held.\end{document}")
    (pdir / "heldpaper2020.pdf").write_text("%PDF-1.4 fake")
    (pdir / "virgil" / "ai-requests.json").write_text("[]\n")
    (pdir / "references.bib").write_text("@article{heldpaper2020,title={Coherence and Discourse Structure}}\n")


# ─────────────────────────────────────────────────────────────────────────
# Harness
# ─────────────────────────────────────────────────────────────────────────


def run(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    cmd = [sys.executable, str(HERE / "dedup.py"), *args]
    return subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)


class Checks:
    def __init__(self) -> None:
        self.failed: list[str] = []
        self.passed: list[str] = []

    def check(self, cond: bool, msg: str) -> None:
        (self.passed if cond else self.failed).append(msg)
        mark = "PASS" if cond else "FAIL"
        print(f"  [{mark}] {msg}")


def main() -> int:
    c = Checks()
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "lib"
        build_fixture(root)
        backup = Path(td) / "backup"
        plan_path = root / "plan.json"

        # ── SCAN ──────────────────────────────────────────────────────────
        print("== scan ==")
        r = run("scan", "--library", str(root), "--out", str(plan_path),
                "--report", str(root / "report.md"), cwd=root)
        c.check(r.returncode == 0, f"scan exits 0 (rc={r.returncode}) {r.stderr.strip()[:200]}")
        plan = json.loads(plan_path.read_text())
        master_sha = plan["master_sha"]

        # Two clusters expected: the doiA pair and the held/stub pair.
        survivors = {cl["survivor"] for cl in plan["clusters"]}
        c.check(len(plan["clusters"]) == 2,
                f"scan finds exactly 2 clusters (got {len(plan['clusters'])})")
        c.check("heldpaper2020" in survivors,
                "held+deepIndexed paper is the survivor of its cluster")
        held_cluster = next((cl for cl in plan["clusters"]
                             if cl["survivor"] == "heldpaper2020"), None)
        c.check(held_cluster is not None and
                any(m["citekey"] == "stub2020" and m["role"] == "loser"
                    for m in held_cluster["members"]),
                "stub2020 is a loser under heldpaper2020")
        # Report exists.
        c.check((root / "report.md").exists(), "scan wrote report.md")

        # ── APPLY with WRONG sha → must ABORT, no changes ─────────────────
        print("== apply (bad --expect-sha → abort) ==")
        before_master = (root / "master.bib").read_text()
        before_catalog = (root / ".virgil" / "catalog.json").read_text()
        r_bad = run("apply", "--library", str(root), "--plan", str(plan_path),
                    "--tiers", "auto,conflict", "--expect-sha", "deadbeefwrong",
                    "--backup-dir", str(backup), cwd=root)
        c.check(r_bad.returncode != 0, f"apply with bad sha aborts nonzero (rc={r_bad.returncode})")
        c.check((root / "master.bib").read_text() == before_master,
                "master.bib UNCHANGED after aborted apply")
        c.check((root / ".virgil" / "catalog.json").read_text() == before_catalog,
                "catalog.json UNCHANGED after aborted apply")
        c.check(not backup.exists() or not any(backup.iterdir()),
                "no backup written on aborted apply")

        # ── APPLY for real ────────────────────────────────────────────────
        print("== apply (correct sha) ==")
        r_ap = run("apply", "--library", str(root), "--plan", str(plan_path),
                   "--tiers", "auto,conflict", "--expect-sha", master_sha,
                   "--backup-dir", str(backup), cwd=root)
        c.check(r_ap.returncode == 0, f"apply exits 0 (rc={r_ap.returncode}) {r_ap.stderr.strip()[:300]}")
        print("    " + r_ap.stdout.strip())

        # ── ASSERTIONS on post-apply state ───────────────────────────────
        print("== post-apply invariants ==")
        master = _tools.read_master_bib(root / "master.bib")
        catalog = json.loads((root / ".virgil" / "catalog.json").read_text())
        cat_keys = {e["citekey"] for e in catalog["entries"]}
        aliases = json.loads((root / ".virgil" / "aliases.json").read_text())

        # Survivor kept citekey + master entry.
        c.check("heldpaper2020" in master, "survivor heldpaper2020 kept its master entry")
        c.check("heldpaper2020" in cat_keys, "survivor heldpaper2020 kept its catalog row")
        c.check("doiA_keep" in master, "survivor doiA_keep kept its master entry")

        # Loser master entries gone.
        c.check("stub2020" not in master, "loser stub2020 master entry removed")
        c.check("doiA_dup" not in master, "loser doiA_dup master entry removed")

        # Loser catalog rows gone.
        c.check("stub2020" not in cat_keys, "loser stub2020 catalog row removed")
        c.check("doiA_dup" not in cat_keys, "loser doiA_dup catalog row removed")

        # The deepIndexed folder + files SURVIVE, un-archived.
        pdir = root / "papers" / "heldpaper2020"
        c.check(pdir.is_dir(), "deepIndexed survivor folder still present")
        c.check((pdir / "main.tex").exists(), "survivor main.tex survives")
        c.check((pdir / "virgil" / "ai-requests.json").exists(), "survivor virgil/ sidecar survives")
        archive = root / ".virgil" / "_dedup-archive"
        c.check(not (archive / "heldpaper2020").exists(),
                "survivor folder NOT in _dedup-archive")

        # Aliases recorded loser→survivor.
        c.check(aliases.get("stub2020", {}).get("survivor") == "heldpaper2020",
                "alias stub2020 → heldpaper2020 recorded")
        c.check(aliases.get("doiA_dup", {}).get("survivor") == "doiA_keep",
                "alias doiA_dup → doiA_keep recorded")

        # Untouched controls survive.
        for ck in ("alpha2001", "beta2002", "gamma2003", "delta2004"):
            c.check(ck in master, f"control {ck} untouched in master.bib")

        # Untouched master entries kept VERBATIM (no reformat).
        c.check("@book{beta2002," in (root / "master.bib").read_text(),
                "untouched entry beta2002 emitted verbatim (not reformatted)")

        # Backup file exists.
        c.check((backup / "master.bib.bak").exists(), "backup master.bib.bak exists")
        c.check((backup / "catalog.json.bak").exists(), "backup catalog.json.bak exists")

        # ── VERIFY ────────────────────────────────────────────────────────
        print("== verify ==")
        r_v = run("verify", "--library", str(root), cwd=root)
        print("    " + (r_v.stdout.strip().replace("\n", "\n    ")))
        c.check(r_v.returncode == 0, f"verify passes (rc={r_v.returncode}) {r_v.stderr.strip()[:200]}")

        # ── CHECK ─────────────────────────────────────────────────────────
        print("== check ==")
        r_c = run("check", "--library", str(root), cwd=root)
        c.check(r_c.returncode == 0,
                f"check exits 0 — no same-work clusters left (rc={r_c.returncode}) {r_c.stdout.strip()}")

    print()
    print(f"RESULT: {len(c.passed)} passed, {len(c.failed)} failed")
    if c.failed:
        print("FAILURES:")
        for m in c.failed:
            print(f"  - {m}")
        return 1
    print("ALL ASSERTIONS PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
