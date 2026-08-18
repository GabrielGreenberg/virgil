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

Every fixture is a synthetic repo in a temp dir, pinned via `VIRGIL_REPO_ROOT`,
so the suite never depends on whether the real checkout happens to be built.

Run from anywhere:  python3 editor/scripts/tests/test_dream_drift.py
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dream  # noqa: E402
from _common import SOURCE_REPO_ENV  # noqa: E402

# The builder constant this check parses rather than re-spells.
BUILDER = """\
const PAPER_SCRIPT_PREFIXES = [
  ["editor/scripts/", ".virgil/scripts/editor/"],
  ["library/scripts/", ".virgil/scripts/library/"],
];
export function isPaperCommandMarkdown(bundlePath) { return true; }
"""

# A skill body invoking its helper repo-relative — the form the bundle rewrites.
SKILL_SRC = "# draft-footnote\n\nRun `python3 editor/scripts/create_card.py x`.\n"
SKILL_SHIPPED = "# draft-footnote\n\nRun `python3 .virgil/scripts/editor/create_card.py x`.\n"


class DriftCheckTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name) / "repo"
        (self.repo / "editor" / "skills").mkdir(parents=True)
        (self.repo / "editor" / "scripts").mkdir(parents=True)
        (self.repo / "editor" / "build").mkdir(parents=True)
        self.bundle = self.repo / "public" / "skill-bundle" / "editor"
        (self.bundle / "claude-commands").mkdir(parents=True)
        (self.bundle / "scripts").mkdir(parents=True)

        (self.repo / "editor/build/build-editor-bundle.mjs").write_text(BUILDER)

        # A consistent baseline: one command markdown (rewritten on the way in),
        # one shared include, one helper script.
        self.write_pair("draft-footnote.md", SKILL_SRC, SKILL_SHIPPED)
        self.write_pair("_latex-allowlist.md", "allowlist v1\n", "allowlist v1\n")
        self.write_script("create_card.py", "print('v1')\n", "print('v1')\n")
        self.write_manifest([
            "claude-commands/draft-footnote.md",
            "claude-commands/_latex-allowlist.md",
            "scripts/create_card.py",
        ])

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

    def write_script(self, name, src, shipped):
        (self.repo / "editor/scripts" / name).write_text(src)
        (self.bundle / "scripts" / name).write_text(shipped)

    def write_manifest(self, files):
        (self.bundle / "bundle-manifest.json").write_text(
            json.dumps({"version": "deadbeef", "files": files})
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
        """The shipped command markdown carries `.virgil/scripts/editor/` where
        the SSOT carries `editor/scripts/`. Diffing without the builder's
        rewrite would report EVERY command markdown as drifted, every night —
        the fastest way to make the check ignorable."""
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

    def test_unparseable_rewrite_table_fails_closed(self):
        """If the builder's prefix table can't be read, yield NOTHING rather
        than guess — a guessed prefix reports every command markdown as
        drifted."""
        (self.repo / "editor/build/build-editor-bundle.mjs").write_text("// moved\n")
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

    def test_unparseable_rewrite_table_names_itself(self):
        (self.repo / "editor/build/build-editor-bundle.mjs").write_text("// moved\n")
        (self.repo / "editor/scripts/create_card.py").write_text("print('v2')\n")
        self.assertEqual(
            dream._detect_skill_drift_status(), ([], "unparseable-rewrite-table"))

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

    def test_prefixes_are_read_from_the_builder(self):
        """The prefixes are a token two layers must agree on byte-for-byte, so
        they are PARSED from the builder, never re-spelled here."""
        self.assertEqual(
            dream._paper_script_prefixes(self.repo),
            [("editor/scripts/", ".virgil/scripts/editor/"),
             ("library/scripts/", ".virgil/scripts/library/")],
        )

    def test_parse_survives_the_builders_older_spelling(self):
        """The parse keys on the SILO TOKEN, not the container syntax. Before
        task 158 the builder spelled this as two scalar consts; a regex pinned
        to the `PAPER_SCRIPT_PREFIXES` array would have gone None — silently
        disarming the whole check — on the commit that introduced the array."""
        (self.repo / "editor/build/build-editor-bundle.mjs").write_text(
            'const REPO_SCRIPT_PREFIX = "editor/scripts/";\n'
            'const PAPER_SCRIPT_PREFIX = ".virgil/scripts/editor/";\n'
        )
        self.assertEqual(
            dream._paper_script_prefixes(self.repo),
            [("editor/scripts/", ".virgil/scripts/editor/")],
        )
        # …and the check still works end to end under that spelling.
        (self.repo / "editor/scripts/create_card.py").write_text("print('v2')\n")
        self.assertEqual(dream._detect_skill_drift(), ["editor/scripts/create_card.py"])

    def test_real_builder_constant_is_still_parseable(self):
        """Canary: the parse runs against the REAL build-editor-bundle.mjs, so a
        refactor that renames or reshapes PAPER_SCRIPT_PREFIXES fails here
        instead of silently disarming the check (fail-closed → []) forever."""
        real = Path(__file__).resolve().parents[3]
        if not (real / "editor/build/build-editor-bundle.mjs").is_file():
            self.skipTest("not running from a source checkout")
        parsed = dream._paper_script_prefixes(real)
        self.assertIsNotNone(parsed, "PAPER_SCRIPT_PREFIXES no longer parseable")
        self.assertIn(("editor/scripts/", ".virgil/scripts/editor/"), parsed)


if __name__ == "__main__":
    unittest.main(verbosity=2)
