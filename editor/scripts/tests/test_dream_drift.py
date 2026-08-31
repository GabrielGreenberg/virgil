#!/usr/bin/env python3
r"""Drift-check test for the §1 dream preflight — `dream._detect_skill_drift`.

The check answers one question: **has a landed edit not yet been published by
`npm run build:skill-bundles`?** Its authority is the editor skill BUNDLE (the
artifact that actually reaches an agent) via that bundle's own
`bundle-manifest.json`, not the `.claude/commands/editor/` dev mirror.

The leg with teeth is `test_stale_helper_script_is_drift`: the mirror carries
only non-underscore command MARKDOWN, so a check keyed on it is structurally
blind to the `.py` helpers the skills invoke and to the `_`-prefixed shared
includes — and reports GREEN for both. That is not hypothetical: on 2026-08-10
commit 4b453a5c had left seven skill markdowns AND `create_card.py` stale in the
bundle, and the mirror-keyed check could see only the seven. A prompt and its
helper going stale together is exactly what makes that invisible.

THE CHECK ASKS THE BUNDLE WHAT IT BUILT FROM (task 506). Markdown does not ship
verbatim — helper invocations are re-prefixed and every relative link is
re-spelled for the synced layout — so a check that DIFFS shipped bytes against
the SSOT must know every transform the build applies, and reports every command
markdown as drifted the day it does not. The manifest's `sourceDigests` map
records each shipped file's `repoPath` plus the sha256 of the bytes it was built
FROM, so this side knows no transform at all and cannot fall behind one. The
retired prefix-parsing legs are renegotiated in place below with the reason at
the site: they pinned a mechanism whose whole purpose was to keep a re-derivation
in step, and there is no longer a re-derivation.

Every fixture is a synthetic repo in a temp dir, pinned via `VIRGIL_REPO_ROOT`,
so the suite never depends on whether the real checkout happens to be built.

Run from anywhere:  python3 editor/scripts/tests/test_dream_drift.py
"""
import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dream  # noqa: E402
from _common import SOURCE_REPO_ENV  # noqa: E402

# A skill body invoking its helper repo-relative — the form the bundle rewrites.
SKILL_SRC = "# draft-footnote\n\nRun `python3 editor/scripts/create_card.py x`.\n"
SKILL_SHIPPED = "# draft-footnote\n\nRun `python3 .virgil/scripts/editor/create_card.py x`.\n"


class DriftCheckTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._built = {}
        self.repo = Path(self._tmp.name) / "repo"
        (self.repo / "editor" / "skills").mkdir(parents=True)
        (self.repo / "editor" / "scripts").mkdir(parents=True)
        self.bundle = self.repo / "public" / "skill-bundle" / "editor"
        (self.bundle / "claude-commands").mkdir(parents=True)
        (self.bundle / "scripts").mkdir(parents=True)

        # A consistent baseline: one command markdown (rewritten on the way in),
        # one shared include, one helper script.
        self.write_pair("draft-footnote.md", SKILL_SRC, SKILL_SHIPPED)
        self.write_pair("_latex-allowlist.md", "allowlist v1\n", "allowlist v1\n")
        self.write_script("create_card.py", "print('v1')\n", "print('v1')\n")
        self.write_manifest()

        self._prev = os.environ.get(SOURCE_REPO_ENV)
        os.environ[SOURCE_REPO_ENV] = str(self.repo)

    def tearDown(self):
        if self._prev is None:
            os.environ.pop(SOURCE_REPO_ENV, None)
        else:
            os.environ[SOURCE_REPO_ENV] = self._prev
        self._tmp.cleanup()

    # ── fixture helpers ────────────────────────────────────────────────────
    def write_pair(self, name, src, shipped):
        (self.repo / "editor/skills" / name).write_text(src)
        (self.bundle / "claude-commands" / name).write_text(shipped)
        self._built[f"claude-commands/{name}"] = ("editor/skills/" + name, src)

    def write_script(self, name, src, shipped):
        (self.repo / "editor/scripts" / name).write_text(src)
        (self.bundle / "scripts" / name).write_text(shipped)
        self._built[f"scripts/{name}"] = ("editor/scripts/" + name, src)

    def write_manifest(self):
        """What the builder recorded: for each shipped file, the repo path and
        the sha256 of the SOURCE bytes it was built from."""
        digests = {
            bundle_path: {
                "repoPath": repo_rel,
                "sha256": hashlib.sha256(src.encode()).hexdigest(),
            }
            for bundle_path, (repo_rel, src) in self._built.items()
        }
        (self.bundle / "bundle-manifest.json").write_text(
            json.dumps({"version": "deadbeef",
                        "files": sorted(digests),
                        "sourceDigests": digests})
        )

    # ── the legs ───────────────────────────────────────────────────────────
    def test_built_bundle_is_clean(self):
        """A bundle that matches its sources reports nothing — including the
        command markdown, whose shipped bytes differ from source BY DESIGN."""
        self.assertEqual(dream._detect_skill_drift(), [])

    def test_stale_helper_script_is_drift(self):
        """THE LEG WITH TEETH. A `.py` helper edited after the last build is
        drift — and it is invisible to a `.claude/commands/`-keyed check,
        which never carries scripts at all."""
        (self.repo / "editor/scripts/create_card.py").write_text("print('v2')\n")
        self.assertEqual(dream._detect_skill_drift(), ["editor/scripts/create_card.py"])

    def test_stale_underscore_include_is_drift(self):
        """`_`-prefixed shared includes ship in the bundle but are deliberately
        NOT mirrored as slash commands, so the mirror check cannot see them."""
        (self.repo / "editor/skills/_latex-allowlist.md").write_text("allowlist v2\n")
        self.assertEqual(dream._detect_skill_drift(), ["editor/skills/_latex-allowlist.md"])

    def test_stale_command_markdown_is_drift(self):
        """The case the old check DID catch still gets caught."""
        (self.repo / "editor/skills/draft-footnote.md").write_text(SKILL_SRC + "more\n")
        self.assertEqual(dream._detect_skill_drift(), ["editor/skills/draft-footnote.md"])

    def test_paper_path_rewrite_is_not_false_drift(self):
        """THE LEG THE DIGEST DESIGN EXISTS FOR. The shipped command markdown
        carries `.virgil/scripts/editor/` where the SSOT carries
        `editor/scripts/` — and, since task 506, re-spelled links besides.
        Diffing the two would report EVERY command markdown as drifted, every
        night, which is the fastest way to make the check ignorable. Asking the
        bundle what it built FROM knows none of that."""
        self.assertIn("editor/scripts/", (self.repo / "editor/skills/draft-footnote.md").read_text())
        self.assertIn(".virgil/scripts/editor/", (self.bundle / "claude-commands/draft-footnote.md").read_text())
        self.assertEqual(dream._detect_skill_drift(), [])

    def test_source_deleted_but_still_shipped_is_drift(self):
        """A manifest member whose SSOT is gone is stale shipped bytes, not a
        file to skip."""
        (self.repo / "editor/scripts/create_card.py").unlink()
        self.assertEqual(dream._detect_skill_drift(), ["editor/scripts/create_card.py"])

    def test_unbuilt_bundle_yields_no_drift(self):
        """A synced paper copy carries no bundle; drift is only meaningful in a
        repo holding both halves."""
        (self.bundle / "bundle-manifest.json").unlink()
        self.assertEqual(dream._detect_skill_drift(), [])

    def test_bundle_without_source_digests_fails_closed(self):
        """RENEGOTIATED (task 506) from `test_unparseable_rewrite_table_fails_closed`:
        the prefix table this used to break is no longer read at all. The
        fail-closed rule it pinned survives one field over — a bundle built
        before the builders recorded their sources yields NOTHING rather than
        an empty list that reads as clean for the whole silo."""
        (self.bundle / "bundle-manifest.json").write_text(
            json.dumps({"version": "deadbeef", "files": ["scripts/create_card.py"]})
        )
        (self.repo / "editor/scripts/create_card.py").write_text("print('v2')\n")
        self.assertEqual(dream._detect_skill_drift(), [])

    # -- "clean" must be distinguishable from "could not look" ----------------
    # Every case below returns the SAME empty list as a genuinely clean bundle,
    # which is why the reason is the only thing that can tell them apart.
    #
    # `unbuilt-bundle` is reachable but CONFIG-DEPENDENT, which is what makes a
    # published flag worth more than a comment — it works on the dev box and
    # degrades quietly where the environment is thinner. `public/skill-bundle/`
    # is gitignored, so no fresh `git worktree add` carries a bundle; whether
    # that matters turns on `source_repo_root()`, which prefers
    # `VIRGIL_REPO_ROOT` before walking up from `__file__`. Measured from a
    # dream worktree on 2026-08-17: with the pin set (this machine's
    # `~/.zshenv`) it resolves to the primary checkout and checks correctly;
    # with the pin unset it resolved to the worktree and returned
    # `([], 'unbuilt-bundle')` — silently `[]` before this change.
    #
    # That env fallback is deliberately NOT asserted here: the walk-up lands on
    # whatever real tree hosts this file, so a leg pinning it would assert a
    # property of the checkout rather than of the code.

    def test_clean_bundle_reports_the_check_actually_ran(self):
        drifted, reason = dream._detect_skill_drift_status()
        self.assertEqual(drifted, [])
        self.assertIsNone(reason)

    def test_real_drift_also_reports_the_check_ran(self):
        (self.repo / "editor/scripts/create_card.py").write_text("print('v2')\n")
        drifted, reason = dream._detect_skill_drift_status()
        self.assertEqual(drifted, ["editor/scripts/create_card.py"])
        self.assertIsNone(reason)

    def test_unbuilt_bundle_names_itself_rather_than_reading_clean(self):
        (self.bundle / "bundle-manifest.json").unlink()
        self.assertEqual(
            dream._detect_skill_drift_status(), ([], "unbuilt-bundle"))

    def test_bundle_without_source_digests_names_itself(self):
        (self.bundle / "bundle-manifest.json").write_text(
            json.dumps({"version": "deadbeef", "files": ["scripts/create_card.py"]})
        )
        (self.repo / "editor/scripts/create_card.py").write_text("print('v2')\n")
        self.assertEqual(
            dream._detect_skill_drift_status(), ([], "no-source-digests"))

    def test_unreadable_manifest_names_itself(self):
        (self.bundle / "bundle-manifest.json").write_text("{ not json\n")
        self.assertEqual(
            dream._detect_skill_drift_status(), ([], "unreadable-manifest"))

    def test_select_publishes_the_reason_beside_the_list(self):
        """The prompt reads a FLAG the script computed — it never re-derives
        'was this checkable?' by eye. Same rule as `selfReferentialOnly`."""
        (self.bundle / "bundle-manifest.json").unlink()
        drifted, reason = dream._detect_skill_drift_status()
        self.assertEqual((drifted, reason), ([], "unbuilt-bundle"))
        # The two published fields are derived from exactly that pair.
        self.assertIs(reason is None, False)

    def test_real_bundle_records_what_it_built_from(self):
        """Canary: the REAL editor bundle carries a `sourceDigests` map naming
        real repo paths. A builder refactor that stops recording them fails
        here instead of silently disarming the check (fail-closed → []) forever
        — the role `test_real_builder_constant_is_still_parseable` used to play
        for the retired prefix parse."""
        real = Path(__file__).resolve().parents[3]
        manifest = real / "public/skill-bundle/editor/bundle-manifest.json"
        if not manifest.is_file():
            self.skipTest("editor bundle not built in this checkout")
        digests = json.loads(manifest.read_text()).get("sourceDigests")
        self.assertIsInstance(digests, dict, "builder no longer records sourceDigests")
        self.assertTrue(digests)
        for rec in digests.values():
            self.assertTrue((real / rec["repoPath"]).is_file(), rec["repoPath"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
