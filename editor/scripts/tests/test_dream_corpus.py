#!/usr/bin/env python3
r"""Corpus-LIFETIME test for the §1 dream preflight — `dream._corpus_lifetime`.

`selfReferentialOnly` / `nonDreamMemoCount` answer a WINDOW question ("what
arrived since the last dream?"). `memoSinkPresent` answers an EXISTENCE
question about the sink DIRECTORY. Neither can answer the lifetime one — *has
this sink ever captured a real skill run?* — and the gap is not academic: the
dream's own step 8 writes into the sink, so `memoSinkPresent` is **self-
satisfied** from the second night onward, and a window flag reads "quiet night"
forever.

The leg with teeth is `test_sink_fed_only_by_step_8_is_never_fed`: it builds the
exact production shape observed on 2026-08-26 — three memos, all `skill: dream`,
written by step 8 — and asserts the two pre-existing flags BOTH report healthy
over it while `everCapturedNonDream` reports false. A fix keyed on either
existing flag passes its own tests and stays blind to this.

Every fixture is a synthetic sink in a temp dir, so the suite never depends on
what the real corpus happens to hold.

Run from anywhere:  python3 editor/scripts/tests/test_dream_corpus.py
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dream  # noqa: E402


def _memo(root: Path, day: str, hhmmss: str, skill: str) -> Path:
    d = root / day
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{hhmmss}-{skill}.md"
    p.write_text(
        "---\n"
        f"skill: {skill}\n"
        "taskId: -\n"
        "tier: noted\n"
        f"reflectedAt: {day}T{hhmmss.replace('-', ':')}.000Z\n"
        "---\n\n"
        "## issues\n\nsynthetic\n"
    )
    return p


class CorpusLifetime(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "memos"

    def tearDown(self):
        self._tmp.cleanup()

    # -- the leg with teeth ------------------------------------------------
    def test_sink_fed_only_by_step_8_is_never_fed(self):
        """The observed production shape: a sink whose ONLY writer is its reader.

        Both pre-existing flags report healthy over it. That is the defect."""
        _memo(self.root, "2026-08-22", "05-22-40", "dream")
        _memo(self.root, "2026-08-23", "05-20-11", "dream")
        _memo(self.root, "2026-08-25", "05-18-51", "dream")
        corpus = dream._read_corpus(self.root)
        self.assertEqual(len(corpus), 3)

        # The two flags that exist today both say "fine".
        self.assertTrue(dream._memo_sink_present(self.root),
                        "sink exists — step 8 created it")
        window = dream._filter_since(corpus, dream._memo_sort_key(corpus[-1]))
        self.assertEqual([r for r in window if r["skill"] != "dream"], [],
                         "window flag reads as a quiet night")

        # The lifetime question is the only one that reports the famine.
        ever, last_at, n = dream._corpus_lifetime(corpus)
        self.assertFalse(ever)
        self.assertIsNone(last_at)
        self.assertEqual(n, 0)

    def test_a_single_real_run_flips_it(self):
        _memo(self.root, "2026-08-22", "05-22-40", "dream")
        _memo(self.root, "2026-08-24", "11-00-00", "draft-footnote")
        _memo(self.root, "2026-08-25", "05-18-51", "dream")
        ever, last_at, n = dream._corpus_lifetime(dream._read_corpus(self.root))
        self.assertTrue(ever)
        self.assertEqual(n, 1)
        self.assertEqual(last_at, "2026-08-24T11:00:00.000Z")

    def test_last_non_dream_is_the_latest_not_the_last_file(self):
        """`lastNonDreamMemoAt` must be the newest REAL run, not the newest memo."""
        _memo(self.root, "2026-08-20", "09-00-00", "find-citation")
        _memo(self.root, "2026-08-24", "11-00-00", "draft-footnote")
        _memo(self.root, "2026-08-25", "05-18-51", "dream")
        ever, last_at, n = dream._corpus_lifetime(dream._read_corpus(self.root))
        self.assertTrue(ever)
        self.assertEqual(n, 2)
        self.assertEqual(last_at, "2026-08-24T11:00:00.000Z")

    def test_absent_sink_is_never_fed_and_does_not_raise(self):
        """An absent sink answers the lifetime question too — `memoSinkPresent`
        carries the stronger 'could not look' fact, and the digest orders them."""
        ever, last_at, n = dream._corpus_lifetime(dream._read_corpus(self.root))
        self.assertFalse(ever)
        self.assertIsNone(last_at)
        self.assertEqual(n, 0)
        self.assertFalse(dream._memo_sink_present(self.root))


class OneScanTwoQuestions(unittest.TestCase):
    """`_select` must stay byte-identical to the pre-split behaviour."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "memos"
        _memo(self.root, "2026-08-22", "05-22-40", "dream")
        _memo(self.root, "2026-08-24", "11-00-00", "draft-footnote")
        _memo(self.root, "2026-08-25", "05-18-51", "dream")

    def tearDown(self):
        self._tmp.cleanup()

    def test_select_equals_filter_over_corpus(self):
        corpus = dream._read_corpus(self.root)
        for marker in (None, dream._memo_sort_key(corpus[0]),
                       dream._memo_sort_key(corpus[-1])):
            self.assertEqual(
                [r["path"] for r in dream._select(self.root, marker)],
                [r["path"] for r in dream._filter_since(corpus, marker)],
                f"marker={marker!r}")

    def test_select_still_filters_strictly_after_the_marker(self):
        corpus = dream._read_corpus(self.root)
        got = dream._select(self.root, dream._memo_sort_key(corpus[0]))
        self.assertEqual(len(got), 2)
        self.assertNotIn(corpus[0]["path"], [r["path"] for r in got])

    def test_absent_sink_selects_nothing(self):
        missing = Path(self._tmp.name) / "nope"
        self.assertEqual(dream._select(missing, None), [])
        self.assertEqual(dream._read_corpus(missing), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
