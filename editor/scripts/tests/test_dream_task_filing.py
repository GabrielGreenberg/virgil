#!/usr/bin/env python3
r"""The dream's ONE output channel: routing a finding, and minting its task
(task 522).

Since 2026-08-31 the dev-dream LANDS NOTHING. It reads memos, detects patterns,
and FILES: a task in `~/virgil-tasks/incoming/` for the worker to implement and
merge under its own discipline, or one in `blocked/` with `## Questions` for the
catcher to put in front of Gabriel. That makes it symmetric with the worker's own
idle-time audits — detectors file, one executor lands, one catcher surfaces — and
it is why Gabriel asked for the merge: one place to check.

Four claims, four groups of legs:

  ROUTE     `dream_land.task_route` is the WHOLE question a night asks per
            finding, over `classify_change`'s verdict (which is a PIECE and
            keeps answering its own question — how big and how risky). An
            own-rulebook change and a boundary refusal go to `blocked/`;
            everything else is ready work; a fix-now flag is a PRIORITY, not a
            landing mode. The leg with teeth is the red gate: attributed → a
            work task, UNATTRIBUTED → a question, because filing an unseparated
            break as work points a worker at somebody else's diff (the measured
            2026-08-25 defect).

  MINT      the id collision protocol `REMOTE_INBOX.md` states, now shared by
            THREE minters. Scan every queue dir for today's max immediately
            before the write; re-verify after; rename on a collision.
            `test_a_racing_minter_is_renamed_not_overwritten` drives the actual
            race by making the pre-scan LIE, which is exactly what a concurrent
            catcher does to it.

  BAR       a dream-filed task meets the same schema bar as a catcher-filed
            one, enforced at the WRITE rather than asked of the filer: no
            `## Done when`, no task; no `## Questions` on a blocked one, no
            task. "A task with no acceptance criteria is one the worker can't
            safely finish — it'll just get parked" (README.md).

  SANDBOX   a run that has pinned the loop's own sinks may NOT reach the human's
            live queue. Same rule and the same measured reason as
            `synced_inbox_root`'s (87 junk files into the real Dropbox inbox in
            twenty minutes, from suites that had pinned every sink they knew
            about) — and here the junk would be minted TASKS.

Every fixture is synthetic and every leg pins `VIRGIL_TASKS_DIR` at a temp dir,
so no leg can write into the real queue however it fails.

Run from anywhere:  python3 editor/scripts/tests/test_dream_task_filing.py
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
from dream_land import (  # noqa: E402
    PRIORITY_HIGH,
    PRIORITY_NORMAL,
    QUEUE_BLOCKED,
    QUEUE_INCOMING,
    ROUTE_GATE,
    task_route,
)

DREAM_PY = str(SCRIPTS / "dream.py")

SKILL_CHANGE = {"paths": ["editor/skills/draft-footnote.md"],
                "intent": "tighten-wording",
                "oldText": "the old sentence", "newText": "the new sentence"}
RULEBOOK_CHANGE = {"paths": ["editor/scripts/dream_land.py"],
                   "intent": "script-change",
                   "oldText": "a", "newText": "b"}
BOUNDARY_CHANGE = {"paths": ["editor/AGENTS.md"], "intent": "clarify",
                   "oldText": "- Don't add a backend. The cowork pattern is load-bearing",
                   "newText": "- Don't add a backend, usually."}


def _sections(**extra) -> dict:
    base = {"Description": "Three memos flag the same ambiguity.",
            "Done when": "The wording names the uuid door and the suite pins it."}
    base.update(extra)
    return base


# ---------------------------------------------------------------------------
# ROUTE
# ---------------------------------------------------------------------------


class Route(unittest.TestCase):
    def test_a_scoped_skill_fix_is_ready_work(self):
        r = task_route({"change": SKILL_CHANGE})
        self.assertEqual(r["queue"], QUEUE_INCOMING)
        self.assertEqual(r["status"], "ready")
        self.assertEqual(r["priority"], PRIORITY_NORMAL)
        self.assertFalse(r["questionsRequired"])
        # The verdict survives on the answer — the digest records it and
        # /editor/iterate consumes it — it just no longer picks the queue.
        self.assertEqual(r["mode"], "acts")

    def test_a_structural_change_is_ALSO_ready_work(self):
        """The `acts`/`proposes` split stops changing WHERE a finding goes.

        That is the distinction this merge dissolves: the worker lands both
        kinds of diff with the same worktree → types → tests → merge."""
        r = task_route({"change": {"paths": ["editor/scripts/anchor.py"],
                                   "intent": "script-change",
                                   "oldText": "a", "newText": "b"}})
        self.assertEqual(r["queue"], QUEUE_INCOMING)
        self.assertEqual(r["mode"], "proposes")

    def test_own_rulebook_goes_to_blocked_with_questions(self):
        r = task_route({"change": RULEBOOK_CHANGE})
        self.assertEqual(r["queue"], QUEUE_BLOCKED)
        self.assertEqual(r["status"], "blocked")
        self.assertTrue(r["questionsRequired"])
        self.assertTrue(r["neverSelfMerge"])
        self.assertEqual(r["procedurePaths"], ["editor/scripts/dream_land.py"])

    def test_a_boundary_refusal_goes_to_blocked_with_questions(self):
        """Pre-522 a refusal was 'recorded, not acted' — recorded in a digest,
        which is write-only. A refusal nobody reads decides by default."""
        r = task_route({"change": BOUNDARY_CHANGE})
        self.assertEqual(r["queue"], QUEUE_BLOCKED)
        self.assertTrue(r["questionsRequired"])
        self.assertEqual(r["mode"], "refused")
        self.assertTrue(r["boundary"])

    def test_fix_now_is_a_PRIORITY_not_a_landing_mode(self):
        plain = task_route({"change": SKILL_CHANGE})
        fast = task_route({"change": SKILL_CHANGE, "fixNow": True})
        self.assertEqual(plain["priority"], PRIORITY_NORMAL)
        self.assertEqual(fast["priority"], PRIORITY_HIGH)
        self.assertEqual(fast["queue"], QUEUE_INCOMING)

    def test_fix_now_does_NOT_buy_a_lane_past_the_human(self):
        """'The maintainer flagged it' is a claim about urgency, never about
        who may decide it."""
        r = task_route({"change": RULEBOOK_CHANGE, "fixNow": True})
        self.assertEqual(r["queue"], QUEUE_BLOCKED)

    def test_an_attributed_red_gate_is_a_high_priority_work_task(self):
        r = task_route({"kind": ROUTE_GATE, "commit": "deadbee"})
        self.assertEqual(r["queue"], QUEUE_INCOMING)
        self.assertEqual(r["priority"], PRIORITY_HIGH)
        self.assertIn("deadbee", r["reason"])

    def test_an_UNATTRIBUTED_red_gate_is_a_QUESTION(self):
        """The leg with teeth. A red gate is evidence about the TREE until
        somebody separates it from the night's own work; filing one as a work
        task points a worker at a diff nobody has separated — the measured
        2026-08-25 defect (a markdown edit filed as the suspect for two library
        guards a commit two hours older had broken)."""
        r = task_route({"kind": ROUTE_GATE, "commit": "  "})
        self.assertEqual(r["queue"], QUEUE_BLOCKED)
        self.assertTrue(r["questionsRequired"])

    def test_an_unrecognized_finding_kind_is_a_question_not_silent_work(self):
        r = task_route({"kind": "something-new"})
        self.assertEqual(r["queue"], QUEUE_BLOCKED)

    def test_a_gate_route_still_answers_a_red_gate_in_the_loops_own_scripts(self):
        """A break in `dream.py` is a broken TREE, not a self-modification
        proposal: the dream is reporting it, not authoring the repair."""
        r = task_route({"kind": ROUTE_GATE, "commit": "abc1234",
                        "change": RULEBOOK_CHANGE})
        self.assertEqual(r["queue"], QUEUE_INCOMING)


# ---------------------------------------------------------------------------
# The filing harness
# ---------------------------------------------------------------------------


class _QueueCase(unittest.TestCase):
    ENV_KEYS = ("VIRGIL_TASKS_DIR", "VIRGIL_INBOX", "VIRGIL_DEV_HOME",
                "VIRGIL_DEV_MEMOS_DIR", "VIRGIL_DREAM_DIGESTS_DIR",
                "VIRGIL_DREAM_NOW", "VIRGIL_DEV")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.queue = Path(self._tmp.name) / "virgil-tasks"
        for sub in _common.TASK_ID_DIRS:
            (self.queue / sub).mkdir(parents=True)
        self._saved = {k: os.environ.get(k) for k in self.ENV_KEYS}
        for k in self.ENV_KEYS:
            os.environ.pop(k, None)
        os.environ["VIRGIL_TASKS_DIR"] = str(self.queue)
        os.environ["VIRGIL_DEV"] = "1"
        os.environ["VIRGIL_DREAM_NOW"] = "2026-09-01T22:06:00"

    def tearDown(self):
        for k, v in self._saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v
        self._tmp.cleanup()

    def file_task(self, spec: dict, expect_ok: bool = True):
        r = subprocess.run([sys.executable, DREAM_PY, "file-task",
                            "--task", json.dumps(spec)],
                           capture_output=True, text=True, cwd=str(ROOT))
        if expect_ok:
            self.assertEqual(r.returncode, 0, r.stderr)
            return json.loads(r.stdout)
        self.assertNotEqual(r.returncode, 0)
        return r.stderr

    def listing(self, sub: str) -> list[str]:
        return sorted(f.name for f in (self.queue / sub).glob("*.md"))


# ---------------------------------------------------------------------------
# MINT + BAR
# ---------------------------------------------------------------------------


class Filing(_QueueCase):
    READY = {"title": "Tighten the anchor-lookup wording in draft-footnote",
             "type": "chore", "size": "small",
             "finding": {"kind": "change", "change": SKILL_CHANGE},
             "memoRefs": ["2026-08-30/10-05-00-draft-footnote.md"],
             "sections": None}

    def spec(self, **over) -> dict:
        s = dict(self.READY)
        s["sections"] = _sections()
        s.update(over)
        return s

    def test_a_ready_task_lands_in_incoming_with_the_pipeline_schema(self):
        out = self.file_task(self.spec())
        self.assertTrue(out["filed"])
        self.assertEqual(out["queue"], "incoming")
        body = (self.queue / "incoming" / Path(out["path"]).name).read_text()
        for line in ("id: 2026-09-01-001", "type: chore", "priority: normal",
                     "size: small", "source: dream", "status: ready",
                     "created: 2026-09-01T22:06:00"):
            self.assertIn(line, body)
        # Empty frontmatter values render bare — the shape every hand-written
        # task in the queue carries.
        self.assertIn("\nafter:\n", body)
        self.assertIn("\nworktree:\n", body)
        for section in ("## Description", "## Done when", "## Progress log"):
            self.assertIn(section, body)
        # The reasoning behind a finding is one grep away six weeks later.
        self.assertIn("2026-08-30/10-05-00-draft-footnote.md", body)

    def test_a_blocked_task_leads_with_its_questions(self):
        out = self.file_task(self.spec(
            title="Fold the marker hold into select",
            finding={"kind": "change", "change": RULEBOOK_CHANGE},
            sections=_sections(Questions="**Recommendation:** fold it. I cannot "
                                        "just take my own recommendation here "
                                        "because this is my own rulebook.")))
        self.assertEqual(out["queue"], "blocked")
        body = Path(out["path"]).read_text()
        self.assertIn("status: blocked", body)
        # LEADS with them: the catcher reads the top of the file.
        self.assertLess(body.index("## Questions"), body.index("## Description"))
        self.assertEqual(self.listing("incoming"), [])

    def test_no_done_when_no_task(self):
        err = self.file_task(self.spec(sections={"Description": "d"}),
                             expect_ok=False)
        self.assertIn("Done when", err)
        self.assertEqual(self.listing("incoming"), [])

    def test_a_blocked_finding_with_no_questions_is_REFUSED(self):
        """A question the catcher cannot surface is not a routing, it is a drop."""
        err = self.file_task(self.spec(
            finding={"kind": "change", "change": RULEBOOK_CHANGE}),
            expect_ok=False)
        self.assertIn("Questions", err)
        self.assertEqual(self.listing("blocked"), [])

    def test_ids_increment_across_EVERY_queue_dir(self):
        """`done/` is scanned because an id retires by MOVING there, never by
        disappearing; a minter that skipped it would re-issue every id the
        day's finished work already spent."""
        (self.queue / "done" / "2026-09-01-004-something.md").write_text("x")
        (self.queue / "blocked" / "2026-09-01-007-else.md").write_text("x")
        out = self.file_task(self.spec())
        self.assertEqual(out["id"], "2026-09-01-008")

    def test_an_unminted_inbox_drop_does_not_consume_an_id(self):
        (self.queue / "inbox").mkdir(exist_ok=True)
        (self.queue / "inbox" / "2026-09-01-999-raw-note.md").write_text("x")
        out = self.file_task(self.spec())
        self.assertEqual(out["id"], "2026-09-01-001")

    def test_a_racing_minter_is_renamed_not_overwritten(self):
        """The protocol's SECOND half, driven rather than described.

        A concurrent catcher makes the pre-scan a lie — it mints between our
        scan and our write. Simulated by neutering the pre-scan, which is
        exactly what the race does to it: without the after-write re-verify the
        second task overwrites or shadows the first at the same id."""
        first = self.file_task(self.spec())
        self.assertEqual(first["id"], "2026-09-01-001")
        real_scan = dream._minted_ids
        try:
            dream._minted_ids = lambda root, date_str: set()   # the lie
            spec = self.spec(title="A second, different finding")
            rc = dream.cmd_file_task(["--task", json.dumps(spec)])
            self.assertEqual(rc, 0)
        finally:
            dream._minted_ids = real_scan
        names = self.listing("incoming")
        self.assertEqual(len(names), 2, names)
        ids = sorted(n[:14] for n in names)
        self.assertEqual(ids, ["2026-09-01-001", "2026-09-01-002"])


# ---------------------------------------------------------------------------
# SANDBOX
# ---------------------------------------------------------------------------


class Sandbox(unittest.TestCase):
    ENV_KEYS = ("VIRGIL_TASKS_DIR", "VIRGIL_INBOX", "VIRGIL_DEV_HOME",
                "VIRGIL_DEV_MEMOS_DIR", "VIRGIL_DREAM_DIGESTS_DIR", "HOME")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self._saved = {k: os.environ.get(k) for k in self.ENV_KEYS}
        for k in self.ENV_KEYS:
            os.environ.pop(k, None)
        os.environ["HOME"] = str(self.base / "home")
        (self.base / "home").mkdir()

    def tearDown(self):
        for k, v in self._saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v
        self._tmp.cleanup()

    def test_a_pin_is_honored_whether_or_not_the_dir_exists(self):
        os.environ["VIRGIL_TASKS_DIR"] = str(self.base / "nowhere")
        self.assertEqual(_common.tasks_root(), (self.base / "nowhere").resolve())

    def test_discovery_requires_the_queue_to_EXIST(self):
        self.assertIsNone(_common.tasks_root())
        (Path(os.environ["HOME"]) / "virgil-tasks").mkdir()
        self.assertIsNotNone(_common.tasks_root())

    def test_a_pinned_dev_loop_sink_SUPPRESSES_discovery(self):
        """The load-bearing half. A suite that has sandboxed the loop must not
        be able to mint a task into the human's live queue — the same rule, and
        the same measured reason, as `synced_inbox_root`'s."""
        (Path(os.environ["HOME"]) / "virgil-tasks").mkdir()
        self.assertIsNotNone(_common.tasks_root())
        for key in ("VIRGIL_DEV_MEMOS_DIR", "VIRGIL_DEV_HOME",
                    "VIRGIL_DREAM_DIGESTS_DIR", "VIRGIL_INBOX"):
            os.environ[key] = str(self.base / "sandbox")
            self.assertIsNone(_common.tasks_root(), key)
            os.environ.pop(key)

    def test_an_explicit_tasks_pin_is_never_suppressed(self):
        """…because that IS the caller naming this one."""
        os.environ["VIRGIL_DEV_MEMOS_DIR"] = str(self.base / "sandbox")
        os.environ["VIRGIL_TASKS_DIR"] = str(self.base / "q")
        self.assertEqual(_common.tasks_root(), (self.base / "q").resolve())


if __name__ == "__main__":
    unittest.main(verbosity=2)
