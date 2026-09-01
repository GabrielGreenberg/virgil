#!/usr/bin/env python3
r"""Blackout test for the §1 dream preflight — `dream._nights_since_last_digest`.

Every no-signal flag the loop already publishes is a fact about a night that
RAN. `memoSinkPresent` asks whether the sink directory exists; `memoCount` /
`selfReferentialOnly` / `nonDreamMemoCount` ask what arrived in the window;
`everCapturedNonDream` asks the lifetime question about the corpus. None of
them can see the one failure where nothing ran at all — a night the host slept
writes NO digest, so the next run that does happen inherits an ordinary-looking
window and reports a healthy quiet night over a four-night gap.

The leg with teeth is `test_a_four_night_gap_reads_healthy_on_every_other_flag`:
it builds the production shape observed 2026-08-27 → 08-30 on this machine and
asserts that FOUR pre-existing flags all report healthy over it while the
blackout counter reports 4. A fix keyed on any existing flag passes its own
tests and stays blind to this.

The second contract is the conflation rule this loop's scripts have now closed
five times (`driftChecked`, the absent sink, the empty `marker`,
`everCapturedNonDream`, and this): a bare `null` may never stand for two
conditions. `nightsSinceLastDigest: null` is always accompanied by a
`nightsSinceReason` separating "there is no prior digest" (bootstrap — not a
finding) from "a digest exists but could not be read" (the run could not look).

Every fixture is a synthetic digest root in a temp dir with the clock pinned via
`VIRGIL_DREAM_NOW`, so the suite never depends on the real corpus or the wall
clock.

Run from anywhere:  python3 editor/scripts/tests/test_dream_blackout.py
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
SCRIPTS = HERE.parents[1]
sys.path.insert(0, str(SCRIPTS))

import dream  # noqa: E402

DREAM = str(SCRIPTS / "dream.py")


def _digest(root: Path, day: str, dreamed_at: str | None = "",
            marker: str = "2026-01-01T00:00:00.000Z",
            marker_memo: str = "-") -> Path:
    """A digest artifact. `dreamed_at=None` writes the field EMPTY (the
    unreadable case); the default derives it from `day`."""
    root.mkdir(parents=True, exist_ok=True)
    p = root / f"{day}.md"
    at = f"{day}T23:17:00.000Z" if dreamed_at == "" else (dreamed_at or "")
    p.write_text(
        "---\n"
        f"dreamedAt: {at}\n"
        f"marker: {marker}\n"
        f"markerMemo: {marker_memo}\n"
        "memoCount: 0\n"
        "---\n\n"
        f"# Dream digest — {day}\n"
    )
    return p


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


def _select(memos: Path, digests: Path, now: str) -> dict:
    env = dict(os.environ)
    env["VIRGIL_DEV_MEMOS_DIR"] = str(memos)
    env["VIRGIL_DREAM_DIGESTS_DIR"] = str(digests)
    env["VIRGIL_DREAM_NOW"] = now
    env["VIRGIL_DEV"] = "1"
    r = subprocess.run([sys.executable, DREAM, "select"],
                       capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _digest_run(memos: Path, digests: Path, now: str) -> str:
    env = dict(os.environ)
    env["VIRGIL_DEV_MEMOS_DIR"] = str(memos)
    env["VIRGIL_DREAM_DIGESTS_DIR"] = str(digests)
    env["VIRGIL_DREAM_NOW"] = now
    env["VIRGIL_DEV"] = "1"
    r = subprocess.run([sys.executable, DREAM, "digest"],
                       capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    return (digests / f"{now[:10]}.md").read_text(encoding="utf-8")


class Blackout(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.memos = Path(self._tmp.name) / "memos"
        self.digests = Path(self._tmp.name) / "digests"

    def tearDown(self):
        self._tmp.cleanup()

    # -- the leg with teeth ------------------------------------------------
    def test_a_four_night_gap_reads_healthy_on_every_other_flag(self):
        """The observed shape: Aug 26 ran, Aug 27-30 dark, Aug 31 runs again.

        Four pre-existing flags call it a quiet night. That is the defect."""
        # step 8's own self-reflection is the only thing in the sink — the
        # ordinary steady state, and what makes every other flag read healthy.
        # The 08-26 digest recorded it, so the window since is genuinely empty.
        _memo(self.memos, "2026-08-26", "23-18-00", "dream")
        _digest(self.digests, "2026-08-26",
                marker="2026-08-26T23:18:00.000Z",
                marker_memo="2026-08-26/23-18-00-dream.md")
        out = _select(self.memos, self.digests, "2026-08-31T23:00:00")

        # The flags that exist today all say "fine".
        self.assertTrue(out["memoSinkPresent"], "sink exists")
        self.assertEqual(out["memoCount"], 0, "window is empty — 'a quiet night'")
        self.assertTrue(out["selfReferentialOnly"])
        self.assertEqual(out["nonDreamMemoCount"], 0)
        self.assertIsNotNone(out["lastDigest"], "a digest exists, so nothing is odd")

        # Only the blackout counter reports the gap.
        self.assertEqual(out["nightsSinceLastDigest"], 5)
        self.assertIsNone(out["nightsSinceReason"])

    def test_a_nightly_loop_answers_one(self):
        _digest(self.digests, "2026-08-30")
        out = _select(self.memos, self.digests, "2026-08-31T23:00:00")
        self.assertEqual(out["nightsSinceLastDigest"], 1)
        self.assertIsNone(out["nightsSinceReason"])

    def test_a_second_run_the_same_day_answers_zero(self):
        _digest(self.digests, "2026-08-31")
        out = _select(self.memos, self.digests, "2026-08-31T23:59:00")
        self.assertEqual(out["nightsSinceLastDigest"], 0)

    # -- the conflation rule: null is never bare ---------------------------
    def test_bootstrap_is_not_a_blackout(self):
        """No prior digest at all: there is nothing to measure FROM."""
        out = _select(self.memos, self.digests, "2026-08-31T23:00:00")
        self.assertTrue(out["bootstrap"])
        self.assertIsNone(out["nightsSinceLastDigest"])
        self.assertEqual(out["nightsSinceReason"], "bootstrap")

    def test_an_unreadable_dreamed_at_is_could_not_look_not_bootstrap(self):
        """A digest EXISTS — so this is not the first dream — but carries no
        parseable date. Reporting a bare null would read as bootstrap."""
        _digest(self.digests, "2026-08-26", dreamed_at=None)
        out = _select(self.memos, self.digests, "2026-08-31T23:00:00")
        self.assertFalse(out["bootstrap"],
                         "the digest's marker still arms the marker half")
        self.assertIsNone(out["nightsSinceLastDigest"])
        self.assertEqual(out["nightsSinceReason"], "unreadable")

    def test_a_malformed_dreamed_at_is_unreadable_and_does_not_raise(self):
        _digest(self.digests, "2026-08-26", dreamed_at="not-a-date")
        out = _select(self.memos, self.digests, "2026-08-31T23:00:00")
        self.assertIsNone(out["nightsSinceLastDigest"])
        self.assertEqual(out["nightsSinceReason"], "unreadable")

    # -- the anomaly is reported, not laundered ----------------------------
    def test_a_future_digest_is_reported_negative_not_clamped(self):
        """Clamping to 0 would launder a clock anomaly into a healthy answer."""
        _digest(self.digests, "2026-09-03")
        out = _select(self.memos, self.digests, "2026-08-31T23:00:00")
        self.assertEqual(out["nightsSinceLastDigest"], -3)
        self.assertIsNone(out["nightsSinceReason"])

    # -- the pure helper, over the same cases ------------------------------
    def test_helper_reports_exactly_one_of_the_pair(self):
        _digest(self.digests, "2026-08-26")
        os.environ["VIRGIL_DREAM_NOW"] = "2026-08-31T23:00:00"
        try:
            for path, expect in (
                (None, (None, "bootstrap")),
                (self.digests / "2026-08-26.md", (5, None)),
                (self.digests / "nope.md", (None, "unreadable")),
            ):
                got = dream._nights_since_last_digest(path)
                self.assertEqual(got, expect, f"path={path}")
                self.assertTrue((got[0] is None) != (got[1] is None),
                                "exactly one of (nights, reason) is set")
        finally:
            os.environ.pop("VIRGIL_DREAM_NOW", None)


class DigestBanner(unittest.TestCase):
    """The blackout reaches the DURABLE artifact, like its two siblings.

    `memoSinkPresent` and `everCapturedNonDream` each render a banner from
    frontmatter so a run cannot forget to mention them. A third no-signal
    condition that reached only `select` would be the one that is forgotten."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.memos = Path(self._tmp.name) / "memos"
        self.memos.mkdir(parents=True)
        self.digests = Path(self._tmp.name) / "digests"

    def tearDown(self):
        self._tmp.cleanup()

    def test_gap_banner_and_frontmatter(self):
        _digest(self.digests, "2026-08-26")
        text = _digest_run(self.memos, self.digests, "2026-08-31T23:00:00")
        self.assertIn("nightsSinceLastDigest: 5", text)
        self.assertIn("nightsSinceReason: ", text)
        self.assertIn("went DARK", text)
        self.assertIn("4 night(s)", text)

    def test_a_nightly_run_renders_no_banner(self):
        _digest(self.digests, "2026-08-30")
        text = _digest_run(self.memos, self.digests, "2026-08-31T23:00:00")
        self.assertIn("nightsSinceLastDigest: 1", text)
        self.assertNotIn("went DARK", text)

    def test_bootstrap_renders_no_banner(self):
        text = _digest_run(self.memos, self.digests, "2026-08-31T23:00:00")
        self.assertIn("nightsSinceReason: bootstrap", text)
        self.assertNotIn("went DARK", text)

    def test_unreadable_says_could_not_look(self):
        _digest(self.digests, "2026-08-26", dreamed_at=None)
        text = _digest_run(self.memos, self.digests, "2026-08-31T23:00:00")
        self.assertIn("no readable", text)
        self.assertNotIn("went DARK", text)

    def test_future_digest_says_clock_anomaly(self):
        _digest(self.digests, "2026-09-03")
        text = _digest_run(self.memos, self.digests, "2026-08-31T23:00:00")
        self.assertIn("FUTURE", text)
        self.assertNotIn("went DARK", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
