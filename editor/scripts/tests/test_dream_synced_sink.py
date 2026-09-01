#!/usr/bin/env python3
r"""The SYNCED mailbox — `_common`'s sink ladder, `dream`'s corpus UNION, and
the courtesy digest copy (task 521).

All Virgil cowork now happens on a DIFFERENT computer from the one running the
scheduled loops. `dev_home()` resolves from the PRIMARY CHECKOUT, and a laptop
with no checkout resolves nothing at all — so a reflection written from cowork
there is not merely invisible to the dream, it is never written. The famine the
dream reported every night from 2026-08-26 stops being an accident and becomes
STRUCTURAL: the writer and the reader are on different disks.

Three claims, three groups of legs:

  LADDER   `memos_root()` resolves the Dropbox-synced `Virgil-Inbox/dev-loop/
           memos` when one is reachable, an explicit pin outranks it, and
           `memo_sink_kind()` SAYS which rung answered — so "no synced sink
           found" is a said thing rather than a silent local fallback. The leg
           with teeth is `test_laptop_with_no_checkout_still_resolves_a_sink`:
           the pre-521 ladder RAISES there, which is the whole defect.

  UNION    the dream reads every sink it can reach, not only the one it writes.
           `test_famine_flag_is_wrong_without_the_union` builds the observed
           production shape — the reader's own sink holding only step-8
           self-memos, a real skill memo sitting in a superseded one — and
           asserts `everCapturedNonDream` is FALSE without the union and true
           with it. A fix keyed on any reader-side flag passes its own tests and
           stays blind to this. (That half, and the reasoning behind it, is the
           dream's own 2026-09-01 `dream-split-sink-union` finding, generalized
           here from "the retired home" to "every sink this build does not
           write to" — of which the local checkout home is now one.)
           `test_a_memo_in_both_sinks_is_ONE_memo` is the second: a migration
           may COPY the old sink across, so the same memo exists at the same
           relative path in both and a naive union double-counts every memo
           that predates it — inflating `nonDreamLifetimeCount`, the very
           number the union exists to make honest.

  REPORTS  the digest's courtesy copy is WRITE-ONCE with a unique name. The
           authoritative digest ROTATES in place on a same-day re-run, and a
           file two machines can see being rewritten is a conflicted copy
           waiting to be minted (AGENTS.md → "The daemon half").

Every fixture is a synthetic sink tree under a temp `$HOME`, so no leg depends
on what the real corpus or the real Dropbox folder happens to hold.

Run from anywhere:  python3 editor/scripts/tests/test_dream_synced_sink.py
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
ROOT = SCRIPTS.parents[1]
sys.path.insert(0, str(SCRIPTS))

import _common  # noqa: E402
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


class _EnvCase(unittest.TestCase):
    """A temp `$HOME` plus a cleared dev-loop env — the ladder reads BOTH, so a
    leg that establishes neither is measuring the developer's shell."""

    ENV_KEYS = ("VIRGIL_INBOX", "VIRGIL_DEV_HOME", "VIRGIL_DEV_MEMOS_DIR",
                "VIRGIL_DREAM_DIGESTS_DIR", "VIRGIL_REPO_ROOT", "HOME")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.home = self.base / "home"
        self.home.mkdir()
        self._saved = {k: os.environ.get(k) for k in self.ENV_KEYS}
        for k in self.ENV_KEYS:
            os.environ.pop(k, None)
        os.environ["HOME"] = str(self.home)
        _common._PRIMARY_CACHE.clear()

    def tearDown(self):
        for k, v in self._saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v
        _common._PRIMARY_CACHE.clear()
        self._tmp.cleanup()

    def fake_checkout(self) -> Path:
        """A directory `source_repo_root()` accepts (it validates
        `editor/skills`), so `dev_home()` resolves without the real repo."""
        co = self.base / "checkout"
        (co / "editor" / "skills").mkdir(parents=True, exist_ok=True)
        os.environ["VIRGIL_REPO_ROOT"] = str(co)
        _common._PRIMARY_CACHE.clear()
        return co


# ---------------------------------------------------------------------------
# LADDER
# ---------------------------------------------------------------------------


class SinkLadder(_EnvCase):
    def test_no_synced_inbox_falls_back_to_the_checkout_AND_SAYS_SO(self):
        co = self.fake_checkout()
        self.assertIsNone(_common.synced_inbox_root())
        self.assertEqual(_common.memos_root(),
                         (co / "editor" / "dev" / "memos").resolve())
        # The honesty half. A local answer and a synced one are the same `Path`
        # type, so without this the fallback is silent — which is the shape the
        # loop has been failing in.
        self.assertEqual(_common.memo_sink_kind(), _common.SINK_LOCAL)

    def test_dropbox_home_is_discovered(self):
        self.fake_checkout()
        inbox = self.home / "Dropbox" / "Virgil-Inbox"
        inbox.mkdir(parents=True)
        self.assertEqual(_common.synced_inbox_root(), inbox.resolve())
        self.assertEqual(_common.memos_root(),
                         inbox.resolve() / "dev-loop" / "memos")
        self.assertEqual(_common.memo_sink_kind(), _common.SINK_SYNCED)

    def test_cloudstorage_path_is_discovered(self):
        self.fake_checkout()
        inbox = self.home / "Library" / "CloudStorage" / "Dropbox" / "Virgil-Inbox"
        inbox.mkdir(parents=True)
        self.assertEqual(_common.synced_inbox_root(), inbox.resolve())

    def test_the_documented_symlink_name_is_the_last_rung(self):
        """`virgil-tasks/REMOTE_INBOX.md` names `~/Virgil-Inbox` — a machine
        whose Dropbox lives somewhere unusual is reachable through it with no
        env pin."""
        self.fake_checkout()
        inbox = self.home / "Virgil-Inbox"
        inbox.mkdir()
        self.assertEqual(_common.synced_inbox_root(), inbox.resolve())

    def test_dropbox_wins_over_the_bare_symlink(self):
        self.fake_checkout()
        (self.home / "Virgil-Inbox").mkdir()
        dropbox = self.home / "Dropbox" / "Virgil-Inbox"
        dropbox.mkdir(parents=True)
        self.assertEqual(_common.synced_inbox_root(), dropbox.resolve())

    def test_VIRGIL_INBOX_pin_outranks_discovery_and_need_not_exist_yet(self):
        """A pin is a caller statement — the laptop's escape hatch when its
        Dropbox lives elsewhere — and is honored whether or not the dir is
        there yet, exactly as every other `_dir_override` is. The dir is minted
        on first write."""
        self.fake_checkout()
        (self.home / "Dropbox" / "Virgil-Inbox").mkdir(parents=True)
        pinned = self.base / "elsewhere" / "Virgil-Inbox"
        os.environ["VIRGIL_INBOX"] = str(pinned)
        self.assertFalse(pinned.exists())
        self.assertEqual(_common.synced_inbox_root(), pinned.resolve())
        self.assertEqual(_common.memos_root(),
                         pinned.resolve() / "dev-loop" / "memos")

    def test_an_explicit_home_pin_outranks_the_synced_sink(self):
        """`VIRGIL_DEV_HOME` and `VIRGIL_DEV_MEMOS_DIR` are callers saying where
        these go; discovery may not override a statement. Both report `pinned`,
        which is what suppresses the read-side union."""
        self.fake_checkout()
        (self.home / "Dropbox" / "Virgil-Inbox").mkdir(parents=True)
        os.environ["VIRGIL_DEV_HOME"] = str(self.base / "vh")
        self.assertEqual(_common.memos_root(), (self.base / "vh" / "memos").resolve())
        self.assertEqual(_common.memo_sink_kind(), _common.SINK_PINNED)
        os.environ["VIRGIL_DEV_MEMOS_DIR"] = str(self.base / "pin")
        self.assertEqual(_common.memos_root(), (self.base / "pin").resolve())
        self.assertEqual(_common.memo_sink_kind(), _common.SINK_PINNED)

    # -- the leg with teeth -------------------------------------------------
    def test_laptop_with_no_checkout_still_resolves_a_sink(self):
        """THE defect. On the cowork machine there is no Virgil checkout, so
        `dev_home()` raises and `spawn_reflection` refuses — the memo is never
        written, and the dream reports a quiet night forever. With a synced
        inbox the sink resolves with no checkout at all, which is the whole
        point of the move."""
        inbox = self.home / "Dropbox" / "Virgil-Inbox"
        inbox.mkdir(parents=True)
        # `source_repo_root()` walks up from `__file__` as its last rung, and
        # this file lives INSIDE the repo — so "no checkout anywhere" cannot be
        # established by env alone and is driven at the resolver's own seam,
        # the way `test_reflect_tail_trigger` already drives it.
        _orig = _common.source_repo_root
        _common.source_repo_root = lambda: None
        try:
            with self.assertRaises(_common.DevHomeUnresolved):
                _common.dev_home()                 # still true: no checkout
            self.assertEqual(_common.memos_root(),
                             inbox.resolve() / "dev-loop" / "memos")
            self.assertEqual(_common.memo_sink_kind(), _common.SINK_SYNCED)
        finally:
            _common.source_repo_root = _orig

    def test_reports_root_rides_the_same_resolution(self):
        self.fake_checkout()
        inbox = self.home / "Dropbox" / "Virgil-Inbox"
        inbox.mkdir(parents=True)
        self.assertEqual(_common.synced_reports_root(),
                         inbox.resolve() / "dev-loop" / "reports")
        os.environ["VIRGIL_INBOX"] = ""            # cleared → back to discovery
        self.assertEqual(_common.synced_reports_root(),
                         inbox.resolve() / "dev-loop" / "reports")

    def test_no_inbox_means_no_reports_channel(self):
        self.fake_checkout()
        self.assertIsNone(_common.synced_reports_root())
        self.assertIsNone(_common.dev_loop_root())


class ExtraSinks(_EnvCase):
    def test_the_local_home_becomes_a_READ_sink_once_the_synced_one_is_in_use(self):
        """The migration's own dual: the checkout-relative sink keeps receiving
        memos from every paper folder carrying a pre-521 bundle, so the reader
        must scan it — and it must NOT appear once it IS the sink in use."""
        co = self.fake_checkout()
        (co / "editor" / "dev" / "memos").mkdir(parents=True)
        inbox = self.home / "Dropbox" / "Virgil-Inbox"
        inbox.mkdir(parents=True)
        labels = {label: root for label, root in _common.extra_memos_roots()}
        self.assertIn(_common.SINK_LOCAL, labels)
        self.assertEqual(labels[_common.SINK_LOCAL].resolve(),
                         (co / "editor" / "dev" / "memos").resolve())

    def test_the_sink_in_use_is_never_also_an_extra(self):
        co = self.fake_checkout()
        (co / "editor" / "dev" / "memos").mkdir(parents=True)
        self.assertIsNone(_common.synced_inbox_root())   # local IS the sink
        self.assertEqual(_common.extra_memos_roots(), [])

    def test_a_retired_home_is_read_when_it_exists(self):
        co = self.fake_checkout()
        (co / "editor" / "dev" / "memos").mkdir(parents=True)
        (self.home / ".virgil-dev" / "memos").mkdir(parents=True)
        (self.home / "Dropbox" / "Virgil-Inbox").mkdir(parents=True)
        labels = [label for label, _ in _common.extra_memos_roots()]
        self.assertIn("2026-08-23", labels)

    def test_a_home_that_does_not_exist_is_not_a_sink(self):
        self.fake_checkout()
        (self.home / "Dropbox" / "Virgil-Inbox").mkdir(parents=True)
        self.assertEqual(_common.extra_memos_roots(), [])

    def test_a_pin_suppresses_the_union_entirely(self):
        """Load-bearing rather than tidy: every dev-loop suite pins a temp
        sink, so without this the union folds the human's real, durable corpus
        into every test run."""
        co = self.fake_checkout()
        (co / "editor" / "dev" / "memos").mkdir(parents=True)
        (self.home / ".virgil-dev" / "memos").mkdir(parents=True)
        (self.home / "Dropbox" / "Virgil-Inbox").mkdir(parents=True)
        self.assertNotEqual(_common.extra_memos_roots(), [])
        os.environ["VIRGIL_DEV_MEMOS_DIR"] = str(self.base / "pin")
        self.assertEqual(_common.extra_memos_roots(), [])
        os.environ.pop("VIRGIL_DEV_MEMOS_DIR")
        os.environ["VIRGIL_DEV_HOME"] = str(self.base / "vh")
        self.assertEqual(_common.extra_memos_roots(), [])


# ---------------------------------------------------------------------------
# UNION
# ---------------------------------------------------------------------------


class CorpusUnion(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.live = base / "synced" / "memos"     # what the reader resolves
        self.old = base / "checkout-dev" / "memos"  # what a stale writer does
        self.live.mkdir(parents=True)
        self.old.mkdir(parents=True)
        self.extra = [("local", self.old)]

    def tearDown(self):
        self._tmp.cleanup()

    # -- the leg with teeth -------------------------------------------------
    def test_famine_flag_is_wrong_without_the_union(self):
        _memo(self.live, "2026-08-31", "05-15-42", "dream")
        _memo(self.old, "2026-08-30", "11-02-00", "draft-footnote")

        reader_only = dream._read_corpus(self.live)
        self.assertFalse(dream._corpus_lifetime(reader_only)[0],
                         "without the union the loop reports it has never been fed")
        union = dream._read_corpus(self.live, self.extra)
        ever, _last, count = dream._corpus_lifetime(union)
        self.assertTrue(ever)
        self.assertEqual(count, 1)

    def test_a_memo_in_both_sinks_is_ONE_memo(self):
        """A migration may COPY the old sink across, so the same memo exists at
        the same relative path in both. A naive union double-counts it."""
        _memo(self.live, "2026-08-30", "11-02-00", "draft-footnote")
        _memo(self.old, "2026-08-30", "11-02-00", "draft-footnote")
        union = dream._read_corpus(self.live, self.extra)
        self.assertEqual(len(union), 1)
        self.assertEqual(union[0]["sink"], "", "the sink in USE wins the tie")

    def test_each_record_says_which_sink_held_it(self):
        _memo(self.live, "2026-08-31", "05-15-42", "dream")
        _memo(self.old, "2026-08-30", "11-02-00", "draft-footnote")
        union = dream._read_corpus(self.live, self.extra)
        self.assertEqual({r["path"]: r["sink"] for r in union},
                         {"2026-08-31/05-15-42-dream.md": "",
                          "2026-08-30/11-02-00-draft-footnote.md": "local"})

    def test_the_split_counts_real_memos_separately_from_residue(self):
        _memo(self.old, "2026-08-20", "09-00-00", "dream")
        _memo(self.old, "2026-08-30", "11-02-00", "draft-footnote")
        union = dream._read_corpus(self.live, self.extra)
        total, non_dream, labels = dream._extra_sink_split(union)
        self.assertEqual((total, non_dream, labels), (2, 1, ["local"]))

    def test_residue_only_is_not_a_live_divergent_writer(self):
        _memo(self.old, "2026-08-20", "09-00-00", "dream")
        union = dream._read_corpus(self.live, self.extra)
        self.assertEqual(dream._extra_sink_split(union)[1], 0)

    def test_a_conflicted_copy_is_debris_not_a_memo(self):
        """A sync daemon renames one side aside rather than merging. Counted as
        a memo it would inflate `nonDreamLifetimeCount` — the very number the
        union exists to make honest — and re-report a memo already held."""
        p = _memo(self.live, "2026-08-30", "11-02-00", "draft-footnote")
        p.with_name("11-02-00-draft-footnote (Gabriel's conflicted copy 2026-09-01).md"
                    ).write_text(p.read_text())
        p.with_name("11-02-00-draft-footnote.sync-conflict-20260901-a.md"
                    ).write_text(p.read_text())
        union = dream._read_corpus(self.live)
        self.assertEqual([r["path"] for r in union],
                         ["2026-08-30/11-02-00-draft-footnote.md"])

    def test_reflects_own_same_second_suffix_is_NOT_debris(self):
        """`reflect.py` mints `-2.md` to disambiguate two memos written in the
        same second. iCloud's bare " 2" decoration is the same shape, which is
        exactly why only the two UNAMBIGUOUS grammars are filtered."""
        _memo(self.live, "2026-08-30", "11-02-00", "draft-footnote")
        (self.live / "2026-08-30" / "11-02-00-draft-footnote-2.md").write_text(
            (self.live / "2026-08-30" / "11-02-00-draft-footnote.md").read_text())
        self.assertEqual(len(dream._read_corpus(self.live)), 2)

    def test_the_window_and_the_lifetime_read_the_same_union(self):
        """`digest` re-selects to re-derive the marker authoritatively; a union
        the two halves disagreed about would advance the marker past a memo the
        run never reported."""
        _memo(self.old, "2026-08-30", "11-02-00", "draft-footnote")
        self.assertEqual(
            [r["path"] for r in dream._select(self.live, None, self.extra)],
            [r["path"] for r in dream._read_corpus(self.live, self.extra)])


# ---------------------------------------------------------------------------
# REPORTS — the courtesy copy
# ---------------------------------------------------------------------------


class ReportsChannel(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.inbox = self.base / "Virgil-Inbox"
        self.memos = self.base / "memos"
        self.digests = self.base / "digests"
        for d in (self.inbox, self.memos, self.digests):
            d.mkdir(parents=True)
        _memo(self.memos, "2026-08-30", "11-02-00", "draft-footnote")

    def tearDown(self):
        self._tmp.cleanup()

    def _run(self, when: str, *, inbox: Path | None) -> subprocess.CompletedProcess:
        env = dict(os.environ)
        env["VIRGIL_DEV"] = "1"
        env["VIRGIL_DEV_MEMOS_DIR"] = str(self.memos)
        env["VIRGIL_DREAM_DIGESTS_DIR"] = str(self.digests)
        env["VIRGIL_DREAM_NOW"] = when
        env.pop("VIRGIL_DEV_HOME", None)
        if inbox is None:
            env.pop("VIRGIL_INBOX", None)
            env["HOME"] = str(self.base / "nohome")
            (self.base / "nohome").mkdir(exist_ok=True)
        else:
            env["VIRGIL_INBOX"] = str(inbox)
        return subprocess.run(
            [sys.executable, str(SCRIPTS / "dream.py"), "digest"],
            capture_output=True, text=True, env=env, cwd=str(SCRIPTS))

    def _reports(self) -> list[Path]:
        d = self.inbox / "dev-loop" / "reports"
        return sorted(d.glob("*.md")) if d.is_dir() else []

    def test_the_digest_copy_lands_in_the_synced_reports_dir(self):
        r = self._run("2026-09-01T02:30:45Z", inbox=self.inbox)
        self.assertEqual(r.returncode, 0, r.stderr)
        copies = self._reports()
        self.assertEqual(len(copies), 1, f"got {copies}")
        self.assertEqual(copies[0].name, "2026-09-01T023045Z-digest.md")
        self.assertEqual(copies[0].read_text(),
                         (self.digests / "2026-09-01.md").read_text(),
                         "the copy is byte-identical to the digest it copies")

    def test_a_second_run_ADDS_a_file_and_never_rewrites_one(self):
        """The authoritative digest ROTATES in place; a synced file that gets
        rewritten is a conflicted copy waiting to be minted."""
        self._run("2026-09-01T02:30:45Z", inbox=self.inbox)
        first = self._reports()[0].read_text()
        self._run("2026-09-01T09:14:00Z", inbox=self.inbox)
        copies = self._reports()
        self.assertEqual(len(copies), 2)
        self.assertEqual([p.name for p in copies],
                         ["2026-09-01T023045Z-digest.md",
                          "2026-09-01T091400Z-digest.md"])
        self.assertEqual(copies[0].read_text(), first, "the first copy is untouched")

    def test_no_synced_inbox_means_no_copy_and_no_failure(self):
        r = self._run("2026-09-01T02:30:45Z", inbox=None)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self._reports(), [])
        self.assertTrue((self.digests / "2026-09-01.md").is_file(),
                        "the durable digest still landed")


class ConflictedCopiesAtBothEnds(unittest.TestCase):
    """The predicate has TWO readers, and the write-side one is the sharper.

    `reflect._find_existing` scans the sink to decide which memo the reflection
    convention ENRICHES. Picking a daemon's conflicted copy lands the update in
    the orphaned file and leaves the real memo un-updated — the silent
    writer/reader divergence this subsystem exists to prevent, arriving through
    the filesystem instead of through resolution. A leg for the corpus scan
    alone cannot see it."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.memos = Path(self._tmp.name) / "memos"
        self.memos.mkdir(parents=True)

    def tearDown(self):
        self._tmp.cleanup()

    def _write(self, name: str, *, task: str) -> Path:
        d = self.memos / "2026-08-30"
        d.mkdir(parents=True, exist_ok=True)
        p = d / name
        p.write_text(
            "---\nskill: draft-footnote\n"
            f"taskId: {task}\ntier: noted\n"
            "reflectedAt: 2026-08-30T11:02:00.000Z\n---\n\n## issues\n\nx\n")
        return p

    def test_find_existing_never_picks_a_conflicted_copy(self):
        import reflect
        real = self._write("11-02-00-draft-footnote.md", task="req-1")
        # sorted() puts the parenthesised copy FIRST, so a scan with no filter
        # returns it — this leg fails on any implementation that only filters
        # the READ side.
        self._write("11-02-00-draft-footnote (Gabriel's conflicted copy 2026-09-01).md",
                    task="req-1")
        found = reflect._find_existing(self.memos, "draft-footnote", "req-1", None, "")
        self.assertEqual(found, real)

    def test_the_task_less_day_scan_skips_them_too(self):
        import reflect
        doc = Path(self._tmp.name) / "paper"
        doc.mkdir()
        key = reflect.doc_key(doc)
        d = self.memos / "2026-08-30"
        d.mkdir(parents=True, exist_ok=True)
        body = ("---\nskill: draft-footnote\ntaskId: -\ntier: noted\n"
                f"doc: {key}\nreflectedAt: 2026-08-30T11:02:00.000Z\n---\n\n"
                "## issues\n\nx\n")
        (d / "11-02-00-draft-footnote.md").write_text(body)
        # The Dropbox grammar, deliberately: a space sorts BEFORE `.`, so this
        # copy is what an unfiltered `sorted()` returns first. Syncthing's
        # `.sync-conflict-` always sorts AFTER the real name, which would make
        # this leg pass for a reason that has nothing to do with the filter.
        (d / "11-02-00-draft-footnote (Gabriel's conflicted copy 2026-09-01).md"
         ).write_text(body)
        found = reflect._find_existing(self.memos, "draft-footnote", "-", doc, "2026-08-30")
        self.assertEqual(found, d / "11-02-00-draft-footnote.md")

    def test_one_predicate_serves_both_ends(self):
        """Two spellings of this rule is how the writer and the reader come to
        disagree about which files are memos."""
        import reflect
        self.assertIs(reflect.is_sync_conflict_name, _common.is_sync_conflict_name)
        self.assertIs(dream.is_sync_conflict_name, _common.is_sync_conflict_name)


class LocalSinkBanner(unittest.TestCase):
    """`memoSinkKind: local` is BANNERED, for the reason every other no-signal
    flag is: a fact that reaches only the prompt is the one a run forgets."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.co = self.base / "checkout"
        (self.co / "editor" / "skills").mkdir(parents=True)
        (self.co / "editor" / "dev" / "memos").mkdir(parents=True)
        self.digests = self.base / "digests"
        self.digests.mkdir()
        self.home = self.base / "home"
        self.home.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def _env(self, *, inbox: Path | None):
        env = dict(os.environ)
        env["VIRGIL_DEV"] = "1"
        env["HOME"] = str(self.home)
        env["VIRGIL_REPO_ROOT"] = str(self.co)
        env["VIRGIL_DREAM_DIGESTS_DIR"] = str(self.digests)
        env["VIRGIL_DREAM_NOW"] = "2026-09-01T02:30:45Z"
        for k in ("VIRGIL_DEV_HOME", "VIRGIL_DEV_MEMOS_DIR", "VIRGIL_INBOX"):
            env.pop(k, None)
        if inbox is not None:
            env["VIRGIL_INBOX"] = str(inbox)
        return env

    def _digest(self, env) -> str:
        r = subprocess.run([sys.executable, str(SCRIPTS / "dream.py"), "digest"],
                           capture_output=True, text=True, env=env, cwd=str(SCRIPTS))
        self.assertEqual(r.returncode, 0, r.stderr)
        return (self.digests / "2026-09-01.md").read_text()

    def test_a_local_sink_is_bannered_and_named(self):
        text = self._digest(self._env(inbox=None))
        self.assertIn("memoSinkKind: local", text)
        self.assertIn("No SYNCED mailbox", text)
        self.assertIn("VIRGIL_INBOX", text, "the banner names the escape hatch")

    def test_a_synced_sink_raises_no_banner(self):
        inbox = self.base / "inbox"
        text = self._digest(self._env(inbox=inbox))
        self.assertIn("memoSinkKind: synced", text)
        self.assertNotIn("No SYNCED mailbox", text)

    def test_select_publishes_the_kind_and_the_roots(self):
        env = self._env(inbox=self.base / "inbox")
        r = subprocess.run([sys.executable, str(SCRIPTS / "dream.py"), "select"],
                           capture_output=True, text=True, env=env, cwd=str(SCRIPTS))
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["memoSinkKind"], "synced")
        self.assertTrue(out["syncedMemosRoot"].endswith("/dev-loop/memos"))
        self.assertTrue(out["reportsRoot"].endswith("/dev-loop/reports"))
        # The local checkout home is now a READ sink, and `select` says so.
        self.assertIn(str((self.co / "editor" / "dev" / "memos").resolve()),
                      out["extraSinksRead"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
