#!/usr/bin/env python3
r"""The dev-dream NIGHT engine — the mechanical half of /editor/dream (chip 18).

The "day" capture layer (/editor/reflect, chip 17) drops tiered memos into the
memo sink (`_common.memos_root` — since task 521 the Dropbox-synced
`Virgil-Inbox/dev-loop/memos`, so cowork on any machine reaches it, falling back
to `<checkout>/editor/dev/memos`) as real skill invocations run under DEV
mode.  This script is
the deterministic half of the overnight pass that consumes them; the skill
markdown (editor/skills/dream.md) is the agent-facing half — the agent does the
cross-memo PATTERN DETECTION and the actual editing, this script does the
read-and-account work around it:

  select   gate on DEV → find the memos written since the last dream → parse
           them (reusing reflect.py's _parse_memo — NOT a second parser) → group
           by tier, by skill+bucket, and by the result-lenses → emit one JSON
           blob the agent reads to decide what to change.
  digest   re-run the selection to fix the deterministic facts (memo count,
           counts, the high-water marker the NEXT dream reads), merge the
           agent's qualitative ACTED / PROPOSED / REFUSED entries, and write the
           morning digest to editor/dev/dream-digests/<date>.md.
  file-task
           file ONE of the night's findings as a task in ~/virgil-tasks/ — the
           loop's only actionable output since task 522.  Mints the id under the
           three-minter collision protocol, asks dream_land.task_route which
           queue it goes to, and enforces the pipeline's schema bar.
  paths    print where THIS build resolves every dev-loop root — the digest
           root, the memo sink (and which rung answered), the courtesy reports
           dir, the task queue — as JSON, or ONE of them bare (`paths digests`).
           The door an OUTSIDE reader takes (the catcher's nightly-digest step)
           instead of spelling a path that has moved twice (tasks 431, 521) and
           went stale in prose both times (task 538). Gate-free: a pure read
           that writes nothing.

It does NOT decide a queue by itself — that is dream_land.task_route, over
dream_land.classify_change (the shared landing-mode helper + the three-boundary
guard).  It does NOT edit a skill, create a branch, or run a merge: since task
522 the dream LANDS NOTHING.  The worker is the one executor; this script writes
the task that asks it, and the digest that accounts for the night.

"Since the last dream": the previous digest records a `marker` (the highest
memo timestamp it processed).  This run selects memos strictly after it, so an
already-digested memo is never re-processed.  No prior digest → the bootstrap
dream reads every memo.

Bootstrap / recursion: /editor/dream is itself a Virgil skill, so it reflects
on its OWN run (a skill=dream memo) AFTER writing the digest — that memo lands
after this dream's marker, so the NEXT dream reads it.  "The first dreams will
be the worst."

Gating: a no-op (exit 0, nothing written) unless VIRGIL_DEV is truthy
(_common.dev_mode_enabled) — the dream is a developer affordance and runs in
DEV mode like every other piece of the loop.

Env overrides (test seams; never set in prod):
  VIRGIL_DEV_MEMOS_DIR       memo root          (shared with reflect.py)
  VIRGIL_DREAM_DIGESTS_DIR   digest root        (default: <repo>/editor/dev/dream-digests)
  VIRGIL_DREAM_NOW           ISO timestamp for the digest's dreamedAt + filename date
  VIRGIL_TASKS_DIR           task queue root    (default: ~/virgil-tasks, and a
                             pinned dev-loop sink suppresses discovery entirely
                             so a sandboxed run cannot mint into the live queue)

Usage:
  dream.py select
  dream.py digest [--report <inline|@file>]
  dream.py file-task --task <inline|@file>
  dream.py paths [digests|memos|reports|tasks]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from _common import (
    SINK_LOCAL,
    TASK_ID_DIRS,
    DevHomeUnresolved,
    atomic_write,
    dev_mode_enabled,
    die,
    digests_root as _shared_digests_root,
    extra_memos_roots,
    is_sync_conflict_name,
    memo_sink_kind,
    memos_root as _shared_memos_root,
    source_repo_root,
    synced_reports_root,
    tasks_root,
)

# The routing SSOT. `file-task` asks it rather than re-deriving a queue from a
# verdict, so "where does this go?" has one implementation (task 522).
from dream_land import task_route  # noqa: E402  (sibling module)

# Reuse the chip-17 memo reader + its vocab — do NOT reinvent a parser.
from reflect import (  # noqa: E402  (sibling module in editor/scripts/)
    BUCKET_ORDER,
    BUCKET_TITLES,
    RESULT_TIER,
    TIER_FLAGGED,
    TIER_NOTED,
    TIER_ORDER,
    TIER_UNREMARKABLE,
    _parse_memo,
    bucket_body,
)

# Result-lenses the dream audits (design §4; README "What chip 18 consumes").
LENS_REJECTION = "rejectionCorpus"      # result: rejected
LENS_SILENT = "silentEditAudit"         # result: silent-applied
LENS_REFUSAL = "refusalPatterns"        # result: refused | impossible
_LENS_RESULTS = {
    LENS_REJECTION: {"rejected"},
    LENS_SILENT: {"silent-applied"},
    LENS_REFUSAL: {"refused", "impossible"},
}


# ---------------------------------------------------------------------------
# Time + paths (mirrors reflect.py's clock + memo-root seams)
# ---------------------------------------------------------------------------


def _now_iso_date() -> tuple[str, str]:
    """(iso, YYYY-MM-DD) from VIRGIL_DREAM_NOW or the wall clock."""
    raw = os.environ.get("VIRGIL_DREAM_NOW", "").strip()
    if raw:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    dt = dt.astimezone(timezone.utc)
    iso = dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return iso, dt.strftime("%Y-%m-%d")


def _memos_root() -> Path:
    # The one sink (shared with reflect.py) — the synced `Virgil-Inbox/
    # dev-loop/memos` where one is reachable, else the primary checkout's
    # `editor/dev/memos`. Resolves the same from a repo checkout, a worktree, a
    # synced paper's .virgil/scripts/editor/ copy, or a machine with no
    # checkout at all, so the dream reads exactly where reflect wrote (tasks
    # 431, 521). Unresolvable is a loud refusal. What this sink does NOT cover
    # is a writer running an OLDER bundle — see `_read_corpus`'s union.
    try:
        return _shared_memos_root()
    except DevHomeUnresolved as e:
        die(str(e))
        raise  # unreachable; for the type checker


def _digests_root() -> Path:
    try:
        return _shared_digests_root()
    except DevHomeUnresolved as e:
        die(str(e))
        raise  # unreachable; for the type checker


def _dream_sha() -> str:
    """Best-effort `git rev-parse HEAD:editor/skills/dream.md`, short, against the
    Virgil SOURCE repo (resolved independently of `__file__`). Never fatal
    (mirrors reflect._skill_sha)."""
    repo = source_repo_root()
    if repo is None:
        return "unknown"
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--short",
             "HEAD:editor/skills/dream.md"],
            capture_output=True, text=True, timeout=10,
        )
        sha = out.stdout.strip()
        return sha if out.returncode == 0 and sha else "uncommitted"
    except Exception:
        return "unknown"


def _detect_skill_drift() -> list[str]:
    """Repo paths whose SSOT differs from the bytes the editor skill bundle
    actually SHIPPED — i.e. a landed edit not yet published by
    `npm run build:skill-bundles`.

    Keyed on the bundle's own `bundle-manifest.json`, because **the bundle is
    the artifact that reaches an agent** and the manifest is its record of what
    it shipped. Specifically on its `sourceDigests` map — each shipped file's
    `repoPath` plus the sha256 of the SSOT bytes it was BUILT FROM — so the
    question is asked uniformly over every carrier: the command markdowns, the
    `_`-prefixed shared includes, AND the `.py`/`.json` helpers the skills
    invoke.

    IT ASKS THE BUNDLE WHAT IT BUILT FROM RATHER THAN RE-DERIVING THE
    TRANSFORMS (task 506). Markdown does not ship verbatim: helper invocations
    are re-prefixed and every relative link is re-spelled for the synced layout,
    so the shipped bytes differ from the SSOT bytes BY DESIGN. A check that
    DIFFS the two must therefore know every transform the build applies — and
    the day a transform is added and this side has not learned it, every command
    markdown reports as drifted, every night, which is the fastest way to make
    the check ignorable. That is not hypothetical: this side used to parse the
    builder's `PAPER_SCRIPT_PREFIXES` table out of the `.mjs` source, and went
    quietly `None` for three days when task 374 changed that constant's shape.
    A digest knows no transform and so cannot fall behind one.

    It deliberately no longer consults `.claude/commands/editor/`. That mirror
    is a DEV convenience written by the same `main()` in the same run, so it
    cannot drift from the bundle independently — but it carries only
    non-underscore markdown (build-editor-bundle.mjs skips `_`-prefixed names
    when mirroring, and never mirrors scripts at all), so a check keyed on it is
    structurally blind to roughly a third of what ships and reports GREEN for
    the blind part. Measured on 2026-08-10: the mirror check saw 7 drifted
    skills and could not see that `create_card.py` — the helper those very
    skills invoke — was stale in the bundle from the same commit (4b453a5c).
    A prompt and its helper going stale together is what kept that invisible;
    it stays invisible right up until one of them is rebuilt alone.

    Still the §1 preflight, still hoisted OUT of the distributed prompt into
    `select` (which always runs from source, never the bundle) so it is immune
    to the very drift it detects. Best-effort and never fatal — an unresolvable
    source repo, an unbuilt bundle (e.g. a synced paper copy), or a bundle built
    before the builders recorded their sources yields `[]`.

    **`[]` alone is therefore not "clean" — it is also "I could not look."**
    Callers that need to tell those apart read `_detect_skill_drift_status`,
    whose second member names the reason the check could not run (`None` iff it
    ran to completion). `select` publishes it as `driftChecked`/`driftReason`
    so the dream never reports a green preflight it did not actually perform —
    the same rule `selfReferentialOnly` follows: the SCRIPT computes the
    condition, the prompt reads the flag instead of re-deriving it by eye.

    The reachable case is CONFIG-DEPENDENT, which is what makes it worth a
    flag rather than a comment — it works on the dev box and degrades quietly
    exactly where the environment is thinner. `public/skill-bundle/` is
    gitignored, so no fresh `git worktree add` carries a bundle; whether that
    matters turns on `source_repo_root()`, which prefers `VIRGIL_REPO_ROOT`
    and only then walks up from `__file__`. With the pin set (this machine:
    `~/.zshenv` + `~/.claude/settings.json`) a worktree run resolves to the
    PRIMARY checkout and checks its built bundle correctly. With the pin
    absent — a clean-env cron, another machine, a synced paper copy — the walk
    lands on the bundle-less tree and every question answers `[]`. Measured
    both ways on 2026-08-17, from a dream worktree."""
    return _detect_skill_drift_status()[0]


def _detect_skill_drift_status() -> tuple[list[str], str | None]:
    """`(drifted_paths, unavailable_reason)`. The reason is `None` iff the
    check actually ran; otherwise the path list is empty because nothing could
    be compared, NOT because nothing differs. See `_detect_skill_drift`."""
    repo = source_repo_root()
    if repo is None:
        return [], "no-source-repo"
    bundle_dir = repo / "public" / "skill-bundle" / "editor"
    manifest = bundle_dir / "bundle-manifest.json"
    if not manifest.is_file():
        return [], "unbuilt-bundle"
    try:
        digests = json.loads(manifest.read_text()).get("sourceDigests")
    except Exception:
        return [], "unreadable-manifest"
    # A bundle built before the builders recorded what they built FROM. Fail
    # CLOSED: an empty list here would read as "clean" for the whole editor
    # silo, which is the one answer this check must never give by accident.
    if not isinstance(digests, dict) or not digests:
        return [], "no-source-digests"

    drifted: list[str] = []
    for rec in digests.values():
        if not isinstance(rec, dict):
            continue
        repo_rel, want = rec.get("repoPath"), rec.get("sha256")
        if not isinstance(repo_rel, str) or not isinstance(want, str):
            continue
        src = repo / repo_rel
        try:
            got = hashlib.sha256(src.read_bytes()).hexdigest()
        except Exception:
            # An SSOT file the bundle was built from and disk no longer has is
            # a real staleness signal.
            drifted.append(repo_rel)
            continue
        if got != want:
            drifted.append(repo_rel)
    return sorted(drifted), None


# ---------------------------------------------------------------------------
# Memo ordering + the since-last-dream marker
# ---------------------------------------------------------------------------


def _memo_sort_key(rec: dict) -> tuple[str, str]:
    """(timestamp, relpath) ordering key.  Prefer the memo's stable
    `reflectedAt` (kept from the first reflection); fall back to the path's
    <date>/<HH-MM-SS> when absent.  ISO strings sort lexicographically, so this
    is a total order; the relpath breaks ties on identical timestamps."""
    ts = (rec.get("reflectedAt") or "").strip()
    if not ts:
        # <date>/<HH-MM-SS>-<skill>.md → date + "T" + HH:MM:SS
        parts = rec["path"].split("/")
        date = parts[-2] if len(parts) >= 2 else "0000-00-00"
        tm = parts[-1].split("-")[:3]
        ts = f"{date}T{':'.join(tm)}" if len(tm) == 3 else f"{date}T00:00:00"
    return (ts, rec["path"])


def _last_marker(digests_root: Path) -> tuple[tuple[str, str] | None, Path | None]:
    """The highest recorded high-water marker, and the LATEST digest's path.

    Returns ((markerTs, markerMemo) | None, path | None); the latest digest is
    the one with the greatest (dreamedAt, filename).

    THE TWO HALVES ARE ANSWERED INDEPENDENTLY, and that is the whole point.  A
    digest that recorded no marker -- which `_advance_marker` writes on any night
    whose window is empty and whose inherited marker is itself empty, i.e. the
    bootstrap zero-memo night -- is still a REAL, DATED artifact.  Reading its
    existence off its marker field conflates "no dream has recorded a high-water
    mark" with "no dream has ever run", and the second is the load-bearing one:
    `path` is what `_digest_dreamed_at` turns into `_advance_marker`'s
    `prior_digest_at`, and that argument is what ARMS the trailing-self-memo hold.

    So an empty marker used to disarm the hold guard, silently.  Measured
    2026-08-23 against this tree: with the digest's marker blank the marker
    advances ONTO the unread `skill: dream` self-reflection and `markerHeld` is
    empty; with the same tree and the same digest carrying any marker, the memo
    is held back correctly.  That inverts `_advance_marker`'s stated failure
    direction -- it is written to fail toward a redundant RE-READ, and an empty
    marker made it fail toward LOSING a reflection outright, which is exactly the
    2026-08-17 loss its guard was added (and hand-corrected) to retire.

    This is the third instance of one conflation class in the dream's own
    scripts, after `drift`/`driftChecked` and the absent memo sink: an empty
    value standing for both "nothing" and "could not say".  The rule the other
    two settled on is the rule here -- publish the condition separately; never
    re-derive it from the empty value."""
    if not digests_root.is_dir():
        return None, None
    best_rank: tuple[str, str] | None = None
    best_marker: tuple[str, str] | None = None
    best_digest_rank: tuple[str, str] | None = None
    best_path: Path | None = None
    for p in sorted(digests_root.rglob("*.md")):
        try:
            fm, _ = _parse_memo(p.read_text(encoding="utf-8")[:2000])
        except OSError:
            continue
        rank = ((fm.get("dreamedAt") or "").strip(), p.name)
        # The digest EXISTS regardless of what it recorded -- rank it first.
        if best_digest_rank is None or rank > best_digest_rank:
            best_digest_rank = rank
            best_path = p
        marker = (fm.get("marker") or "").strip()
        if not marker:
            continue
        if best_rank is None or rank > best_rank:
            best_rank = rank
            best_marker = (marker, (fm.get("markerMemo") or "").strip())
    return best_marker, best_path


def _digest_dreamed_at(digest_path: Path | None) -> str:
    """The `dreamedAt` of the most recent digest, or "" when there is none."""
    if digest_path is None or not digest_path.is_file():
        return ""
    try:
        fm, _ = _parse_memo(digest_path.read_text(encoding="utf-8")[:2000])
    except OSError:
        return ""
    return (fm.get("dreamedAt") or "").strip()


def _nights_since_last_digest(
        digest_path: Path | None) -> tuple[int | None, str | None]:
    """Calendar nights between the newest digest and tonight — the BLACKOUT
    measure — and, when it cannot be taken, WHY not.

    The loop is nightly, so a healthy run answers 0 (a second run today) or 1
    (last night, as scheduled). Anything above 1 means nights were MISSED, and
    that is the one no-signal condition none of the existing flags can report:
    a dark night writes no digest, so the next run that does happen inherits a
    perfectly ordinary-looking window — `memoCount: 0`, `memoSinkPresent: true`,
    `selfReferentialOnly: true` — and calls four silent nights a quiet one.
    Measured 2026-08-27 → 08-30 on this machine: the host slept, the worker, the
    dream and the nightly deploy all stopped together, and the first run back
    reported a healthy no-op over the gap.

    A NEGATIVE answer is not a blackout; it is a clock anomaly (a digest dated
    in the future — a skewed host, a hand-edited `dreamedAt`, a
    `VIRGIL_DREAM_NOW` pin behind the corpus). It is reported raw rather than
    clamped, because clamping would launder an anomaly into a healthy 0.

    Returns `(nights, reason)` with EXACTLY ONE of the two set — the fifth
    member of the conflation class `driftChecked` (2026-08-17), the absent memo
    sink (08-22), the empty `marker` (08-23) and `everCapturedNonDream` (08-26)
    each closed: never let one empty value stand for two conditions. `None` with
    `reason: "bootstrap"` means there is no prior digest to measure FROM (the
    first dream — not a finding); `None` with `reason: "unreadable"` means a
    digest exists but carries no parseable `dreamedAt`, i.e. the run could not
    look. Re-deriving either from a bare `null` would read the first dream and a
    broken artifact as the same state."""
    if digest_path is None:
        return None, "bootstrap"
    raw = _digest_dreamed_at(digest_path)
    if not raw:
        return None, "unreadable"
    try:
        then = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None, "unreadable"
    if then.tzinfo is None:
        then = then.replace(tzinfo=timezone.utc)
    try:
        today = date.fromisoformat(_now_iso_date()[1])
    except ValueError:                      # pragma: no cover - pinned clock
        return None, "unreadable"
    return (today - then.astimezone(timezone.utc).date()).days, None


def _advance_marker(recs: list[dict], inherited: tuple[str, str] | None,
                    prior_digest_at: str) -> tuple[tuple[str, str], list[str]]:
    """The high-water marker this digest may claim, plus any memo it HELD BACK.

    The marker means "the newest memo this dream CONSUMED", so it may only land
    on a memo some digest has actually dreamed over.  Exactly one memo can never
    satisfy that: the dream's OWN step-8 self-reflection.  Step 7 -> 8 is ordered
    digest-then-reflect precisely so that memo lands PAST the marker and the
    NEXT dream reads it -- but step 4 also sanctions a same-day digest RE-RUN,
    and a re-run after step 8 re-selects, finds that self-memo, and advances the
    marker onto a reflection no dream has ever read.  The next dream then selects
    nothing and the whole reflection is lost.  (Measured 2026-08-17 and corrected
    BY HAND in that digest's frontmatter; this guard retires the hand-correction.)

    `_rotate_prior_digest`'s docstring claims the marker survives a re-run
    "(an empty re-select preserves it)" -- true only while the re-select IS
    empty, which step 8 guarantees it is not.  That is the invariant restored
    here, at the one place the marker is computed.

    So: walk newest -> oldest and refuse to settle on a TRAILING `skill: dream`
    memo written after the last digest ran.  A dream self-memo that PREDATES the
    last digest was dreamed over by it and is eligible; a non-dream memo is
    always eligible, and because the marker is a high-water mark, landing on one
    already covers every self-memo before it -- so the hold is narrow in effect
    while being general in statement.

    The failure direction is deliberate.  Holding a marker back costs the next
    dream a redundant RE-READ (bounded -- at most the newest self-memo, and it
    self-heals on the following run); advancing it too far LOSES a reflection
    outright, silently and unrecoverably.  Fail toward re-reading."""
    fallback = inherited or ("", "")
    if not recs:
        return fallback, []
    held: list[str] = []
    for rec in reversed(recs):
        if (prior_digest_at and rec.get("skill") == "dream"
                and _memo_sort_key(rec)[0] > prior_digest_at):
            held.append(rec["path"])
            continue
        return _memo_sort_key(rec), list(reversed(held))
    # Every memo in the window is an unread self-memo -- keep the inherited
    # marker so the next dream still sees them.
    return fallback, list(reversed(held))


# ---------------------------------------------------------------------------
# Reading + grouping the memos
# ---------------------------------------------------------------------------


def _load_memo(path: Path, memos_root: Path) -> dict:
    fm, sections = _parse_memo(path.read_text(encoding="utf-8"))
    try:
        rel = str(path.relative_to(memos_root))
    except ValueError:
        rel = path.name
    pids = [s.strip() for s in (fm.get("paragraphIds") or "").split(",") if s.strip()]
    buckets = {k: v for k in BUCKET_ORDER
               if (v := bucket_body(sections.get(k))) is not None}
    return {
        "path": rel,
        "skill": fm.get("skill", "?"),
        "taskId": fm.get("taskId", "-"),
        "kind": fm.get("kind", "—"),
        "status": fm.get("status", "—"),
        "result": (fm.get("result") or "").strip(),
        "tier": fm.get("tier", TIER_UNREMARKABLE),
        "fixNow": str(fm.get("fixNow", "")).strip().lower() == "true",
        "paragraphIds": pids,
        "reflectedAt": (fm.get("reflectedAt") or "").strip(),
        "buckets": buckets,
    }


def _memo_sink_present(memos_root: Path) -> bool:
    """Does the capture sink the dream READS actually exist?

    `_select` returns `[]` for a sink that does not exist and for one that is
    empty — the same bytes for "the loop recorded nothing" and "the loop cannot
    hear at all". That is the exact conflation `driftChecked`/`driftReason`
    exist to prevent one field over, and this is the loop's PRIMARY input, so
    it gets the same treatment: the SCRIPT computes the condition, the prompt
    reads the flag instead of re-deriving it by eye (an `ls` the prompt never
    asks for).

    Reachable and CONFIG-DEPENDENT, which is what makes it worth a flag rather
    than a comment. `dev_home()` defaulted to `~/.virgil-dev` — HOME-relative
    and machine-global, outside the repo and outside git — so a new machine, a
    new ACCOUNT on the same machine, or an unset/mistyped `VIRGIL_DEV_HOME`
    silently yielded a sink that had never existed. Measured on 2026-08-21,
    after the dev-machine move (28fc58fd) carried the tracked files to a new
    account but not the untracked sink: `~/.virgil-dev` was absent, `select`
    reported `memoCount: 0`, and the documented flow read that as a clean quiet
    night. Left unflagged the failure is SILENT and PERMANENT — every
    subsequent dream reports the same healthy no-op, and the digest, which is
    the only durable record, agrees.

    False alarms are impossible in the direction that matters: `reflect.py`
    creates the sink on its first write, so `False` means precisely "nothing
    has been captured here since the sink last existed" — benign on a machine's
    first day, and the whole story on its thirtieth. The script reports the
    fact; the human reads the calendar.

    Since task 521 the sink is normally the SYNCED `Virgil-Inbox/dev-loop/
    memos`, so `False` also covers "the shared mailbox exists but nothing has
    ever been written into it from EITHER machine" — a first-day fact, and the
    reason the banner reads `memoSinkKind` before advising anything. The older
    causes survive on the `local` rung: a wrong `VIRGIL_REPO_ROOT`, a fresh
    clone, or a `VIRGIL_DEV_HOME` pin at a stale path all still produce the
    same zero, which is why the flag stays."""
    return memos_root.is_dir()


def _scan_sink(memos_root: Path) -> list[dict]:
    """Every memo in ONE sink directory, unsorted. `_read_corpus` is the door."""
    if not memos_root.is_dir():
        return []
    recs = []
    for p in sorted(memos_root.rglob("*.md")):
        try:
            rel = p.relative_to(memos_root)
        except ValueError:
            rel = Path(p.name)
        if p.name == ".gitkeep" or is_sync_conflict_name(str(rel)):
            continue
        try:
            rec = _load_memo(p, memos_root)
            # The file's own mtime, recorded here because two later questions
            # need it and neither can be answered from the memo's CONTENT: which
            # copy of a memo held in two sinks is the live one, and whether a
            # memo ARRIVED after the window that would have selected it closed.
            rec["writtenAt"] = p.stat().st_mtime
        except OSError:
            continue
        recs.append(rec)
    return recs


def _read_corpus(memos_root: Path,
                 extra: list[tuple[str, Path]] | None = None) -> list[dict]:
    """EVERY memo the loop can reach, sorted oldest→newest — the corpus.

    Split out from `_select` so the window question ("what is new since the
    last dream?") and the LIFETIME question ("has this sink ever held a real
    skill run?") are answered from ONE scan. They are different questions and
    must be answered independently — see `_corpus_lifetime` — but the sink is
    read once, not twice.

    The corpus is the UNION of the sink in use and every SUPERSEDED one that
    still exists (`_common.extra_memos_roots`, which states why the fix belongs
    on the read side). A writer resolves its sink from whatever vintage of the
    bundle its paper folder carries, so a sink migration leaves real memos
    landing in the old place for as long as that paper goes un-re-synced — and
    the reader, scanning only its own sink, reports the loop has never been
    fed. Reading all of them is what makes `everCapturedNonDream` mean what it
    says.

    Identity is the memo's path RELATIVE to its sink
    (`<date>/<time>-<skill>.md`, minted from the reflection's own timestamp),
    because a migration may COPY the old sink's contents across: the same memo
    then genuinely exists at the same relative path in both, and a naive union
    double-counts it. The sink in use wins a tie, so a record's `path` is
    stable across the fix.

    Stated residual: that identity is the same one `reflect._find_existing`
    dedupes on, so two GENUINELY different memos collide only when two machines
    ran the same skill in the same second of the same day — in which case the
    sink in use wins and the other is not read. Widening the key to include the
    sink would be worse: it would double-count every memo a migration copied
    across, which is the case this dedupe exists for and the common one.

    Each record carries `sink` — `""` for the sink in use, else the superseded
    sink's label — so a caller can report the split without re-scanning."""
    seen: dict[str, dict] = {}
    for rec in _scan_sink(memos_root):
        rec["sink"] = ""
        seen[rec["path"]] = rec
    for label, root in (extra or []):
        for rec in _scan_sink(root):
            rec["sink"] = label
            prior = seen.get(rec["path"])
            if prior is None:
                seen[rec["path"]] = rec
                continue
            # Both sinks hold this memo. Prefer the copy WRITTEN LAST, not the
            # one in the sink in use: a memo is not write-once — the reflection
            # convention enriches the mechanical floor in place and tallies
            # `runs` — so a stale writer's copy can be the ENRICHED one while
            # the migration-copied twin here is the bare floor. Preferring the
            # sink would then read the poorer of two versions of one memo and
            # report the split as zero. Ties keep the sink in use, so the
            # ordinary copied-across case is unchanged and a record's `path`
            # stays stable.
            if rec.get("writtenAt", 0) > prior.get("writtenAt", 0):
                seen[rec["path"]] = rec
    recs = list(seen.values())
    recs.sort(key=_memo_sort_key)
    return recs


def _corpus_lifetime(corpus: list[dict]) -> tuple[bool, str | None, int]:
    """Has the sink EVER captured a real skill run, and when was the last one?

    `selfReferentialOnly` answers the same shape of question over the WINDOW
    since the last dream, and a window-scoped flag cannot answer a lifetime
    question: night after night it reads as "a quiet night", never as "no real
    skill run has ever been captured here". Those are different diagnoses with
    different remedies, and only one of them is a reason to keep dreaming.

    This is the FOURTH instance of one conflation class in the loop's own
    scripts, after `drift`/`driftChecked` (2026-08-17), the absent memo sink
    (2026-08-22) and the empty `marker` (2026-08-23): one value standing for
    two conditions. It sits one level ABOVE the sink check, and it is the case
    that check cannot see — `_memo_sink_present` asks whether the sink DIRECTORY
    exists, and the dream's own step-8 self-reflection CREATES it. So from the
    second night onward that flag is self-satisfied: true because the reader
    wrote to it, not because anything captured a skill run. A loop whose only
    writer is its own reader reports a healthy preflight forever.

    Measured 2026-08-26: three memos in the sink across its whole life, all
    `skill: dream`, all written by step 8 — while the task pipeline landed ~20
    real editor-skill commits in the same window. The capture floor itself was
    verified healthy that night (a real `create_card.py` writeback lands a
    correctly-classified memo through `spawn_reflection`), so the zero is an
    INPUT famine, not a broken capture layer. Distinguishing those two is
    exactly what this function exists for; the previous flags cannot.

    Returns `(everCapturedNonDream, lastNonDreamMemoAt, nonDreamLifetimeCount)`."""
    non_dream = [r for r in corpus if r.get("skill") != "dream"]
    if not non_dream:
        return False, None, 0
    return True, non_dream[-1].get("reflectedAt") or None, len(non_dream)


def _unreachable_memos(corpus: list[dict], marker: tuple[str, str] | None,
                       prior_digest_at: str | None) -> list[str]:
    """Memos that ARRIVED after the window that would have selected them closed
    — read by no dream, ever, and by construction never selectable again.

    The marker is a TIMESTAMP high-water mark, and `_filter_since` keeps only
    what sorts ABOVE it. That was sound while the writer and the reader shared
    a disk: a memo existed the moment it was written, so "written after the
    last dream" and "sorts above the last dream's marker" were the same fact.
    Task 521 breaks that identity. A memo written on the cowork machine at 09:00
    may not SYNC until 23:00 — after tonight's dream has already advanced the
    marker past 09:00 on a memo it could see — and from then on it sorts below
    the marker forever. It is not lost from disk; it is simply never read, which
    is the more dangerous shape, because every flag reports a healthy night over
    it.

    Detected rather than prevented, and that is a scoping decision rather than a
    shortcut: preventing it means replacing the high-water marker with a
    seen-SET, which renegotiates the discipline every other part of this loop is
    built on (the hold-guard, the digest's `marker`, `_filter_since`) and is a
    design question, not a wiring one. What can be done honestly here is refuse
    to call it a quiet night. The test is `writtenAt` (the file's own mtime, the
    only ARRIVAL evidence there is) newer than the last digest, against a sort
    key at or below the marker — so a memo an earlier dream legitimately read is
    never counted, and neither is one that predates the loop.

    Fails CLOSED: with no marker (bootstrap) nothing is unreachable, and with no
    prior digest to date the arrival against, nothing is claimed."""
    if marker is None or not prior_digest_at:
        return []
    out = []
    for r in corpus:
        if _memo_sort_key(r) > marker:
            continue                     # tonight's window — read
        written = r.get("writtenAt")
        if written is None:
            continue                     # no arrival evidence — claim nothing
        try:
            arrived = datetime.fromtimestamp(written, tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            continue
        if arrived > prior_digest_at:
            out.append(r["path"])
    return out


def _extra_sink_split(corpus: list[dict],
                      recs: list[dict] | None = None) -> tuple[int, int, list[str], int]:
    """How much of the corpus only a SUPERSEDED sink holds — the SEAM question.

    Every no-signal flag before this one asks about the READER's own state: is
    my prompt current (`driftChecked`), does my sink exist (`memoSinkPresent`),
    did I read a marker (the empty `marker`), has my sink ever been fed
    (`everCapturedNonDream`), did I run at all (`nightsSinceLastDigest`). None
    of them asks whether the WRITERS and the reader agree about WHERE the
    mailbox is — a fact about neither end, and the one that can make every
    other flag report healthily over a corpus arriving somewhere else. See
    `_common.extra_memos_roots`.

    Returns `(extraOnlyCount, extraOnlyNonDreamCount, sinkLabels, inWindow)`.
    The second is the number that matters: a superseded sink holding only old
    `skill: dream` self-memos is migration residue, while ONE real skill memo
    there is a live writer this build no longer agrees with.

    The FOURTH is what keeps the banner honest. The first three are LIFETIME
    counts over the whole corpus, and what tonight actually dreams over is the
    marker-filtered window — so a superseded-sink memo older than the inherited
    marker is counted here and read by nobody. Saying "they were read" of that
    memo is the guard-overstating-its-reach failure this file legislates
    against, so the count the banner quotes is this one."""
    extra = [r for r in corpus if r.get("sink")]
    labels = sorted({r["sink"] for r in extra})
    non_dream = sum(1 for r in extra if r.get("skill") != "dream")
    in_window = sum(1 for r in (recs or []) if r.get("sink"))
    return len(extra), non_dream, labels, in_window


def _select(memos_root: Path, marker: tuple[str, str] | None,
            extra: list[tuple[str, Path]] | None = None) -> list[dict]:
    """Every memo strictly after `marker`, sorted oldest→newest.

    An empty result is ambiguous by construction — see `_memo_sink_present`,
    which callers publish alongside it so the two cases can be told apart.

    `extra` is threaded rather than resolved here so `select` and `digest` read
    the SAME corpus: `digest` re-selects to re-derive the marker and the counts
    authoritatively, and a union the two disagreed about would advance the
    marker past a memo the run never reported."""
    return _filter_since(_read_corpus(memos_root, extra), marker)


def _filter_since(corpus: list[dict], marker: tuple[str, str] | None) -> list[dict]:
    """The window half of `_select`, over an already-read corpus."""
    if marker is None:
        return list(corpus)
    return [r for r in corpus if _memo_sort_key(r) > marker]


def _summarize(recs: list[dict]) -> dict:
    by_tier: dict[str, int] = {}
    by_skill: dict[str, int] = {}
    by_result: dict[str, int] = {}
    for r in recs:
        by_tier[r["tier"]] = by_tier.get(r["tier"], 0) + 1
        by_skill[r["skill"]] = by_skill.get(r["skill"], 0) + 1
        key = r["result"] or "(none)"
        by_result[key] = by_result.get(key, 0) + 1

    # flagged read first; fixNow ahead of the rest of the flagged set.
    flagged = [r for r in recs if r["tier"] == TIER_FLAGGED]
    flagged.sort(key=lambda r: (not r["fixNow"],) + _memo_sort_key(r))
    fix_now = [r for r in flagged if r["fixNow"]]

    # noted grouped by skill → bucket (so a recurring friction surfaces).
    noted_grouped: dict[str, dict[str, list[str]]] = {}
    for r in (x for x in recs if x["tier"] == TIER_NOTED):
        per_skill = noted_grouped.setdefault(r["skill"], {})
        for bkey in r["buckets"]:
            per_skill.setdefault(bkey, []).append(r["path"])

    # the result-lenses (filtered by result).
    lenses = {
        lens: [r["path"] for r in recs if r["result"] in results]
        for lens, results in _LENS_RESULTS.items()
    }

    unremarkable = sum(1 for r in recs if r["tier"] == TIER_UNREMARKABLE)
    return {
        "counts": {"byTier": by_tier, "bySkill": by_skill, "byResult": by_result},
        "flagged": flagged,
        "fixNow": fix_now,
        "noted": noted_grouped,
        "unremarkableCount": unremarkable,
        "lenses": lenses,
    }


# ---------------------------------------------------------------------------
# select subcommand
# ---------------------------------------------------------------------------


def cmd_select(_argv: list[str]) -> int:
    memos_root = _memos_root()
    digests_root = _digests_root()
    marker, last_digest = _last_marker(digests_root)
    nights_since, nights_reason = _nights_since_last_digest(last_digest)
    extra_sinks = extra_memos_roots()
    corpus = _read_corpus(memos_root, extra_sinks)
    recs = _filter_since(corpus, marker)
    ever_non_dream, last_non_dream_at, non_dream_lifetime = _corpus_lifetime(corpus)
    extra_only, extra_only_non_dream, extra_seen, extra_in_window = \
        _extra_sink_split(corpus, recs)
    unreachable = _unreachable_memos(corpus, marker, _digest_dreamed_at(last_digest))
    summ = _summarize(recs)

    new_marker, marker_held = _advance_marker(
        recs, marker, _digest_dreamed_at(last_digest))
    # No-real-signal window: NOTHING since the last dream came from a real skill
    # run — the window holds only the dream's OWN self-reflections (step 8), or
    # nothing at all.  Writing another self-reflection here perpetuates an
    # infinite no-op recursion, so surface the fact once here (SSOT) and let the
    # skill suppress step 8 on it.
    #
    # The predicate is `no non-dream memos`, FULL STOP — an EMPTY window counts.
    # It used to carry a `bool(recs)` conjunct, which exempted the zero-memo case
    # and turned the guard into a two-night oscillator: a no-op night with one
    # stale self-memo suppressed correctly, which left the NEXT window empty,
    # which read as "not self-referential" and wrote a fresh contentless memo,
    # which re-primed the cycle.  The 2026-08-06 → 08-07 → 08-08 digests trace
    # exactly that loop.  Zero memos is the STRONGEST no-signal case, not an
    # exemption from the guard that exists to catch it.
    non_dream = [r for r in recs if r["skill"] != "dream"]
    self_referential_only = not non_dream
    drift, drift_reason = _detect_skill_drift_status()
    out = {
        "devMode": True,
        # §1 preflight, computed from source so it survives a stale served prompt:
        # SSOT skills that differ from the built .claude/commands artifact (a
        # landed edit not yet rebuilt). Non-empty => the night's top finding.
        "drift": drift,
        # ...and an EMPTY `drift` is only meaningful when `driftChecked` is true.
        # A gitignored `public/skill-bundle/` means every fresh worktree answers
        # `[]` to every question, so "clean" and "could not look" are the same
        # bytes unless the script says which it was.
        "driftChecked": drift_reason is None,
        "driftReason": drift_reason,
        "selfReferentialOnly": self_referential_only,
        "nonDreamMemoCount": len(non_dream),
        # ...and `selfReferentialOnly` is a WINDOW fact, so it reads as "a quiet
        # night" even when the sink has NEVER held a real skill run. These three
        # answer the lifetime question independently. `everCapturedNonDream:
        # false` means the loop has no input at all and is dreaming purely over
        # its own step-8 output — which `memoSinkPresent` cannot report, because
        # step 8 is what creates the sink it checks. See `_corpus_lifetime`.
        "everCapturedNonDream": ever_non_dream,
        "lastNonDreamMemoAt": last_non_dream_at,
        "nonDreamLifetimeCount": non_dream_lifetime,
        # Canonical UTC date — every dated artifact the night writes keys off
        # THIS, never a separate local `date.today()`, so nothing can split
        # across two calendar dates (`digest` and `file-task` both key off the
        # same `_now_iso_date()`). It used to name the dream BRANCH, which task
        # 522 retired along with every other private landing channel; the rule
        # survives its first consumer because the split it prevents is a
        # property of the clock, not of branches.
        "dreamDate": _now_iso_date()[1],
        "memosRoot": str(memos_root),
        # ...and `memoCount: 0` is only "a quiet night" when this is true. A
        # missing sink means the dream recorded nothing and CANNOT know it —
        # the same "could not look" vs "looked and found nothing" split
        # `driftChecked` draws. See `_memo_sink_present`.
        "memoSinkPresent": _memo_sink_present(memos_root),
        # ...and a sink that EXISTS still cannot say whether a memo written on
        # another machine could ever arrive. All cowork now happens on a
        # different computer from the one this loop runs on, so `local` here is
        # the STRUCTURAL famine (task 521): the writer resolves a checkout the
        # laptop does not have, and no memo is written at all. `synced` means
        # the mailbox is the Dropbox-synced `Virgil-Inbox/dev-loop/memos` both
        # machines reach; `pinned` means a caller said where these go.
        # See `_common.memo_sink_kind`.
        "memoSinkKind": memo_sink_kind(),
        # (There is deliberately no `syncedMemosRoot`: when the rung IS
        # `synced`, `memosRoot` above already names it, and a second field
        # saying the same thing is one nobody reads.)
        "reportsRoot": (str(synced_reports_root())
                        if synced_reports_root() is not None else None),
        # ...and since task 522 the loop's ONE actionable output is a task file,
        # so "can I file at all?" is a preflight question exactly like
        # `memoSinkPresent` — and for the same reason: a night that discovers it
        # cannot file only when it TRIES has already done the detection work it
        # is about to lose. `null` means no queue was found (or a pinned
        # dev-loop sink suppressed discovery, which is the sandbox rule doing
        # its job); the digest is then the night's only record and says so.
        "taskQueueRoot": (str(tasks_root()) if tasks_root() is not None else None),
        # ...and every flag above is about the READER. These four are about the
        # SEAM: a writer resolves its own sink from whatever bundle vintage its
        # paper folder carries, so a sink migration silently routes real memos
        # to a sink the reader has superseded — and `everCapturedNonDream:
        # false` then reads "nobody has ever written" when the truth is
        # "somebody wrote where I no longer look". The corpus above is the UNION
        # over these, so they REPORT a split the reading has already healed.
        # `extraSinkNonDreamMemos > 0` is a live divergent writer and the
        # night's top finding; residue-only is a stale bundle worth re-syncing.
        # See `_extra_sink_split` / `_common.extra_memos_roots`.
        "extraSinksRead": [str(r) for _, r in extra_sinks],
        "extraSinkMemos": extra_only,
        "extraSinkNonDreamMemos": extra_only_non_dream,
        "extraSinksHoldingMemos": extra_seen,
        # ...and the three above are LIFETIME counts, while what tonight dreams
        # over is the marker-filtered window. Quote THIS one when you say a
        # divergent memo was read.
        "extraSinkMemosInWindow": extra_in_window,
        # A memo that ARRIVED after the window that would have selected it
        # closed — read by no dream, ever, and never selectable again. The
        # marker is a timestamp, and syncing broke the identity between
        # "written after the last dream" and "sorts above its marker": a memo
        # written on the cowork machine at 09:00 and synced at 23:00 is behind
        # tonight's marker forever. Non-empty is a REAL loss and outranks every
        # count above; see `_unreachable_memos`.
        "unreachableMemos": unreachable,
        "since": (marker[0] if marker else None),
        "sinceMemo": (marker[1] if marker else None),
        "lastDigest": (str(last_digest.relative_to(_digests_root()))
                       if last_digest and _is_under(last_digest, _digests_root())
                       else (str(last_digest) if last_digest else None)),
        # ...and `lastDigest` alone cannot say whether the loop has been RUNNING.
        # A night the host slept writes no digest at all, so the next run reads a
        # window that looks quiet in every other field. 0 or 1 is healthy; >1 is
        # a blackout and the night's top finding; <0 is a clock anomaly. `null`
        # is never bare — `nightsSinceReason` says which of "no prior digest"
        # (bootstrap) and "could not read one" (unreadable) it was.
        # See `_nights_since_last_digest`.
        "nightsSinceLastDigest": nights_since,
        "nightsSinceReason": nights_reason,
        "bootstrap": marker is None,           # no prior dream → first dream
        "memoCount": len(recs),
        "marker": new_marker[0],
        "markerMemo": new_marker[1],
        # Memos the marker was HELD BACK from (unread step-8 self-memos). READ
        # this rather than re-deriving the condition by eye -- the rule
        # selfReferentialOnly already follows.  Non-empty means the next dream
        # will deliberately RE-READ them; it never means something was lost.
        "markerHeld": marker_held,
        **summ,
        # the full selected set (brief) for the agent's pattern detection
        "memos": recs,
    }
    print(json.dumps(out, indent=2))
    return 0


def _is_under(p: Path, root: Path) -> bool:
    try:
        p.relative_to(root)
        return True
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# digest subcommand
# ---------------------------------------------------------------------------


def _load_report(arg: str | None) -> dict:
    if not arg:
        return {}
    if arg.startswith("@"):
        path = Path(arg[1:]).expanduser()
        if not path.exists():
            print(f"error: --report file not found: {path}", file=sys.stderr)
            sys.exit(2)
        arg = path.read_text(encoding="utf-8")
    try:
        data = json.loads(arg)
    except json.JSONDecodeError as e:
        print(f"error: invalid --report JSON: {e}", file=sys.stderr)
        sys.exit(2)
    if not isinstance(data, dict):
        print("error: --report must be a JSON object", file=sys.stderr)
        sys.exit(2)
    return data


def _fmt_refs(refs) -> str:
    refs = [str(r) for r in (refs or []) if str(r).strip()]
    return f" · from {', '.join(refs)}" if refs else ""


def _task_pointer(entry: dict) -> str:
    """Where the night's finding actually WENT (task 522).

    An entry with no `task` is a finding the night did not file — the digest
    SAYS so rather than reading as an ordinary entry, because since 522 an
    unfiled finding is a lost one: the digest is a courtesy record and
    `~/virgil-tasks/` is the only surface anyone reads."""
    task = (entry.get("task") or "").strip()
    if not task:
        return " · ⚠️ **NOT FILED** (this digest is its only record)"
    queue = (entry.get("queue") or "").strip()
    return f" · task `{task}`" + (f" in `{queue}/`" if queue else "")


def _render_digest(fm: dict, report: dict, summ: dict, recs: list[dict]) -> str:
    acted = report.get("acted") or []
    proposed = report.get("proposed") or []
    refused = report.get("refused") or []
    counts = summ["counts"]
    by_tier = counts["byTier"]

    out: list[str] = ["---"]
    for k in ("dreamedAt", "since", "marker", "markerMemo", "markerHeld",
              "memoCount", "memoSinkPresent", "memoSinkKind",
              "taskQueuePresent", "everCapturedNonDream",
              "extraSinkMemos", "extraSinkNonDreamMemos",
              "extraSinkMemosInWindow", "unreachableMemos",
              "nightsSinceLastDigest", "nightsSinceReason",
              "acted", "proposed", "refused",
              "bootstrap", "dreamSha"):
        v = fm[k]
        if isinstance(v, bool):
            v = "true" if v else "false"
        out.append(f"{k}: {v}")
    out.append("---")
    out.append("")
    out.append(f"# Dream digest — {fm['_date']}")
    out.append("")
    since_h = fm["since"] if fm["since"] != "(bootstrap)" else "the beginning (first dream)"
    out.append(
        f"Read **{fm['memoCount']}** memo(s) since {since_h} — "
        f"flagged {by_tier.get(TIER_FLAGGED, 0)} · noted {by_tier.get(TIER_NOTED, 0)} · "
        f"unremarkable {by_tier.get(TIER_UNREMARKABLE, 0)}. "
        f"Acted on {len(acted)}, proposed {len(proposed)}, refused {len(refused)}."
    )
    out.append("")
    if not fm.get("memoSinkPresent", True):
        out.append(
            f"> **⚠️ The capture sink does not exist — this was not a quiet "
            f"night, it was a deaf one.** `{fm.get('_memosRoot', '?')}` is "
            f"absent, so nothing above came from it — a zero `memoCount` "
            f"means the dream could not look, NOT that nothing was captured, "
            f"and a NON-zero one came entirely from the sinks named below. "
            f"`reflect.py` creates the sink on "
            f"its first write, so this reads as benign on a machine's first "
            f"day and as a broken capture layer on its thirtieth — check the "
            f"calendar and the sink's own resolution before trusting any zero "
            f"here (`memoSinkKind: {fm.get('memoSinkKind', '?')}` says which "
            f"rung answered: `synced` means nothing has yet been written into "
            f"the shared inbox from EITHER machine, `local` means check "
            f"`VIRGIL_REPO_ROOT` and any `VIRGIL_DEV_HOME` pin). "
            f"Left unaddressed, every following digest repeats this same "
            f"healthy-looking no-op."
        )
        out.append("")
    elif not fm.get("everCapturedNonDream", True):
        out.append(
            f"> **⚠️ The sink exists but has NEVER captured a real skill run — "
            f"this loop has no input.** Every memo in `{fm.get('_memosRoot', '?')}` "
            f"is a `skill: dream` self-reflection written by step 8, so the "
            f"dream is reading its own output and nothing else. "
            f"`memoSinkPresent: true` cannot report this: step 8 is what "
            f"CREATES the sink that flag checks, so from the second night on it "
            f"is true because the reader wrote to it. "
            f"The capture floor is automatic (`apply_response` fires "
            f"`reflect.py` after every commit), so this is an INPUT famine, not "
            f"a broken layer — no editor skill has been run on a real paper in "
            f"DEV mode. Until one is, every finding here is necessarily about "
            f"the loop's own procedure, which is `neverSelfMerge` and therefore "
            f"cannot land unattended: the nightly spend accrues to a queue only "
            f"a human can drain."
        )
        out.append("")
    # Independent of the two above, deliberately: with the corpus read as a
    # UNION, a superseded sink holding real memos makes `everCapturedNonDream`
    # TRUE, so the famine banner correctly does not fire — and the split would
    # then go unmentioned entirely if this were another `elif`.
    extra_all = fm.get("extraSinkMemos", 0)
    extra_real = fm.get("extraSinkNonDreamMemos", 0)
    if isinstance(extra_real, int) and extra_real > 0:
        out.append(
            f"> **⚠️ {extra_real} real skill memo(s) sit in a SUPERSEDED "
            f"sink — a live writer disagrees with this build about where the "
            f"mailbox is.** They are in the CORPUS (the reading is a union), so "
            f"they count toward `everCapturedNonDream` and nothing is invisible "
            f"— but only **{fm.get('extraSinkMemosInWindow', 0)}** of them fell "
            f"inside tonight's window; the rest predate the inherited marker and "
            f"were dreamed over by an earlier run or not at all. What it means "
            f"is that some paper folder is "
            f"still running an older skill bundle and resolving "
            f"`{fm.get('_extraSinks', '?')}`. Bundles re-sync on doc-open, so "
            f"a paper the human has not opened since the migration keeps "
            f"writing there indefinitely. Re-sync those folders "
            f"(`python3 editor/scripts/sync_skills.py <paper>`); until then "
            f"every reader-side flag above can read healthy over a corpus "
            f"arriving somewhere else."
        )
        out.append("")
    elif isinstance(extra_all, int) and extra_all > 0:
        out.append(
            f"> **Note — {extra_all} memo(s) in this corpus exist only in a "
            f"superseded sink** (`{fm.get('_extraSinks', '?')}`), all of them "
            f"`skill: dream` self-reflections. That is migration residue rather "
            f"than a live divergent writer: it is in the corpus and counted, "
            f"and the sink can be deleted once nothing writes there — which is "
            f"also what stops this note repeating every night."
        )
        out.append("")
    if not fm.get("taskQueuePresent", True):
        out.append(
            "> **⚠️ No task queue — this night's findings reached NOTHING.** "
            "Since task 522 the loop lands nothing itself: every actionable "
            "output is a task in `~/virgil-tasks/` (`incoming/` for the worker, "
            "`blocked/` for the human), and this digest is a courtesy record, "
            "not an attention surface. With no queue resolvable, whatever is "
            "listed below was detected and then dropped. Either "
            "`~/virgil-tasks/` is missing on this machine, or a pinned dev-loop "
            "sink suppressed discovery — which is the sandbox rule working "
            "correctly and means this was a test run, not a night. Re-file by "
            "hand or re-run with `VIRGIL_TASKS_DIR` set; nothing below is "
            "queued."
        )
        out.append("")
    unreachable = fm.get("unreachableMemos", 0)
    if isinstance(unreachable, int) and unreachable > 0:
        out.append(
            f"> **⚠️ {unreachable} memo(s) ARRIVED after the window that would "
            f"have selected them closed — they have been read by no dream and "
            f"never will be.** The marker is a timestamp, and with the mailbox "
            f"synced across machines a memo can be WRITTEN before the marker and "
            f"ARRIVE after it: written on the cowork machine at 09:00, synced at "
            f"23:00, behind tonight's marker forever. Nothing is lost from disk "
            f"— read them yourself: `{fm.get('_unreachablePaths', '?')}` under "
            f"`{fm.get('_memosRoot', '?')}`. This outranks every count above, "
            f"because every other flag reports a healthy night over it."
        )
        out.append("")
    if fm.get("memoSinkKind") == SINK_LOCAL:
        out.append(
            f"> **⚠️ No SYNCED mailbox — the memo sink is local to this "
            f"machine (`{fm.get('_memosRoot', '?')}`).** All Virgil cowork now "
            f"happens on a different computer, and a reflection written there "
            f"resolves a checkout that machine does not have, so it is never "
            f"written at all"
            + (" — so any famine above is STRUCTURAL, not a quiet night"
               if not fm.get("everCapturedNonDream", True)
               else "; this corpus is being fed from somewhere, so what is "
                    "missing here is only whatever the cowork machine wrote")
            + f". The loop expects "
            f"`~/Dropbox/Virgil-Inbox/dev-loop/memos` (or `$VIRGIL_INBOX`) on "
            f"BOTH machines; create the inbox folder here, and set "
            f"`VIRGIL_DEV=1` (plus `VIRGIL_INBOX` if Dropbox lives elsewhere) "
            f"on the cowork machine. See `_common.memo_sink_kind`."
        )
        out.append("")
    nights = fm.get("nightsSinceLastDigest", "")
    if isinstance(nights, int) and nights > 1:
        out.append(
            f"> **⚠️ The loop went DARK for {nights - 1} night(s) — the last "
            f"digest before this one is {nights} nights old.** Nothing above "
            f"can report that: a night nobody ran writes no digest, so this run "
            f"inherited a window that looks ordinary in every other field "
            f"(`memoCount`, `memoSinkPresent`, `selfReferentialOnly` all read "
            f"as a quiet night). The dream, the task worker and the nightly "
            f"deploy are scheduled together, so the ordinary cause is the HOST — "
            f"asleep, powered off, or the scheduler unloaded — and the other two "
            f"stopped with it: check what did NOT happen on those dates before "
            f"reading anything below as signal."
        )
        out.append("")
    elif isinstance(nights, int) and nights < 0:
        out.append(
            f"> **⚠️ The previous digest is dated {-nights} day(s) in the "
            f"FUTURE.** This is a clock anomaly, not a blackout — a skewed host, "
            f"a hand-edited `dreamedAt`, or a `VIRGIL_DREAM_NOW` pin behind the "
            f"corpus. Marker selection ranks by `dreamedAt`, so until it is "
            f"settled this run's own digest may not rank above the one it read."
        )
        out.append("")
    elif fm.get("nightsSinceReason") == "unreadable":
        out.append(
            f"> **⚠️ A previous digest exists but carries no readable "
            f"`dreamedAt`,** so this run could not measure how long the loop has "
            f"been running — 'no blackout' and 'could not look' are the same "
            f"silence here. Read the file named by `lastDigest` before trusting "
            f"the cadence."
        )
        out.append("")
    if fm.get("_rotated"):
        out.append(
            f"> **Second run today.** The earlier run's digest was preserved as "
            f"`{fm['_rotated']}` — read it too; anything it found is a TASK in "
            f"`~/virgil-tasks/`, which is where the work actually is. This file "
            f"covers only the memos written since that run."
        )
        out.append("")

    # The three buckets are the three CLASSIFIER verdicts and keep their keys
    # (`acted`/`proposed`/`refused` — what `dream_land` calls them). What task
    # 522 changed is what happens to an entry: the dream applies and stages
    # NOTHING now, so every one of them is a filed task and each entry points at
    # its task ID rather than at a branch or a patch.
    out.append(f"## Scoped — filed ({len(acted)})")
    out.append("_Verdict `acts`: a single skill prompt, prose-polish intent. "
               "Filed as a READY task; the worker lands it._")
    for e in acted or []:
        paths = ", ".join(e.get("paths") or [])
        out.append(f"- **{paths or e.get('summary', '?')}** — "
                   f"{e.get('summary', '')}{_task_pointer(e)}"
                   f"{_fmt_refs(e.get('memoRefs'))}")
    if not acted:
        out.append("- None.")
    out.append("")

    out.append(f"## Structural — filed ({len(proposed)})")
    out.append("_Verdict `proposes`: cross-skill / script / manifest / "
               "contract-adjacent. Filed as a READY task unless it touches the "
               "loop's own rulebook, which routes to `blocked/` for a ruling._")
    if proposed:
        for e in proposed:
            paths = ", ".join(e.get("paths") or [])
            out.append(f"- **{e.get('summary', '?')}**{_task_pointer(e)}")
            out.append(f"  - touches: {paths or '—'}{_fmt_refs(e.get('memoRefs'))}")
            if e.get("reason"):
                out.append(f"  - why proposed: {e['reason']}")
    else:
        out.append("- None.")
    out.append("")

    out.append(f"## Refused — filed as questions ({len(refused)})")
    out.append("_Crossed a load-bearing boundary (design §4): never authored, "
               "never worked around. Filed to `blocked/`, because a refusal the "
               "human never reads is a refusal that decides by default._")
    if refused:
        for e in refused:
            out.append(f"- 🚫 **{e.get('boundary', '?')}** — "
                       f"{e.get('summary', '')}{_task_pointer(e)}"
                       f"{_fmt_refs(e.get('memoRefs'))}")
            if e.get("reason"):
                out.append(f"  - {e['reason']}")
    else:
        out.append("- None.")
    out.append("")

    # Counts -----------------------------------------------------------------
    out.append("## Counts")
    out.append("- by tier: " + (", ".join(f"{k} {v}" for k, v in sorted(by_tier.items())) or "—"))
    out.append("- by skill: " + (", ".join(f"{k} {v}" for k, v in sorted(counts['bySkill'].items())) or "—"))
    out.append("- by result: " + (", ".join(f"{k} {v}" for k, v in sorted(counts['byResult'].items())) or "—"))
    lenses = summ["lenses"]
    out.append(f"- lenses: rejection-corpus {len(lenses[LENS_REJECTION])} · "
               f"silent-edit-audit {len(lenses[LENS_SILENT])} · "
               f"refusal-patterns {len(lenses[LENS_REFUSAL])}")
    out.append("")

    # Bootstrap --------------------------------------------------------------
    out.append("## Bootstrap (the dream reflects on itself)")
    boot = (report.get("bootstrap") or "").strip()
    out.append(boot if boot else
               "Reflect on this run via `/editor/reflect <docPath> dream -` "
               "AFTER this digest, so the next dream reads it (skill=dream memo).")
    out.append("")

    out.append(f"_Next dream reads memos after marker `{fm['marker']}` "
               f"({fm['markerMemo'] or '—'})._")
    return "\n".join(out).rstrip() + "\n"


def _rotate_prior_digest(target: Path, new_iso: str) -> Path | None:
    """Move an existing digest for this date aside so tonight's write cannot
    destroy it, returning where it went (or None if there was nothing to move).

    Same-day re-runs are a SUPPORTED mode, not a mistake: this skill documents
    `/loop /editor/dream` on an interval, and a scheduled job can fire twice
    across a retry. But the digest filename is date-keyed, so run N used to
    overwrite runs 1..N-1 — and `cmd_digest` re-derives its marker from the
    latest digest, which after a successful run is TODAY's own. So the second
    run of a day selects 0 memos and rewrites the day's record as an EMPTY one.

    That is worse than losing a summary. Since task 522 the night's WORK lives
    in the task queue and survives an erased digest — which is precisely why
    that change made this rotation cheaper rather than obsolete: what an
    overwritten digest destroys is the night's REASONING (the memo refs, the
    verdicts, the banners), the part a human reads in the morning and the part
    no task file carries. (The rule dates from 2026-08-18, when an unlanded
    entry's exported patch path was the only pointer to the work itself and an
    erased record orphaned it outright. The stake has shrunk; the rotation
    stays.)

    This docstring used to add "the marker itself survives (an empty re-select
    preserves it), so the window does not reopen" — and that was FALSE, in the
    one ordering the skill itself mandates. The re-select is empty only while
    nothing was written between the two digest calls, and step 8 (reflect after
    the digest) guarantees one memo WAS: this run's own self-reflection. A
    re-run therefore consumed it and advanced the marker onto a memo no dream
    had read. `_advance_marker` is the guard that makes the claim true; see its
    docstring for the measured incident.

    Rotation rather than merge, deliberately: `<date>.md` keeps meaning "the
    latest run of that day" (so nothing that looks for it has to change), the
    older run is preserved verbatim under `<date>-runN.md`, and no merge
    semantics have to be invented for three free-form qualitative lists. A
    rotated file keeps its own earlier `dreamedAt`, so `_last_marker` still
    ranks tonight's digest above it and marker selection is unaffected."""
    if not target.is_file():
        return None
    try:
        fm, _ = _parse_memo(target.read_text(encoding="utf-8")[:2000])
    except OSError:
        return None
    if (fm.get("dreamedAt") or "").strip() == new_iso:
        return None          # same run rewriting its own file — nothing to save
    n = 1
    while (dest := target.with_name(f"{target.stem}-run{n}{target.suffix}")).exists():
        n += 1
    target.rename(dest)
    return dest


def _publish_report(text: str, iso: str, date_str: str) -> Path | None:
    """Drop a read-only COPY of tonight's digest into the synced
    `dev-loop/reports/`, so it can be read from the cowork machine.

    A COURTESY channel and nothing more (task 521 §4, scoped down by Gabriel's
    one-place ruling): **nothing requiring attention may live only here.**
    Everything actionable keeps flowing through `~/virgil-tasks/`, which is the
    one attention surface; this is for casual reading from the other machine.

    WRITE-ONCE with a unique name, which is the sync doctrine rather than a
    preference: the authoritative digest is `<date>.md` and it ROTATES in place
    on a same-day re-run, and a file two machines can see being rewritten is a
    conflicted copy waiting to be minted (AGENTS.md → "The daemon half"). So
    the copy is keyed on the RUN (`<date>T<HHMMSS>Z-digest.md`), a second run
    of a day adds a second file rather than replacing the first, and nothing
    here is ever edited afterwards.

    Best-effort: a synced inbox that does not exist, an unwritable mount, or a
    daemon mid-sync yields `None` and no exception — the digest itself has
    already landed durably, and losing a courtesy copy may not fail the run."""
    reports = synced_reports_root()
    if reports is None:
        return None
    # `2026-09-01T023045Z` — sortable, colon-free (portable), unique per run.
    # `_now_iso_date` always renders `isoformat(timespec="milliseconds")` on a
    # UTC datetime, so `iso` is fixed-width and this slice cannot miss; a
    # length guard here would be a branch no input can reach.
    hhmmss = iso.replace("-", "").replace(":", "")[9:15]
    target = reports / f"{date_str}T{hhmmss}Z-digest.md"
    n = 1
    while target.exists():
        target = reports / f"{date_str}T{hhmmss}Z-digest-{n}.md"
        n += 1
    try:
        atomic_write([(target, text)])
    except Exception as e:                      # noqa: BLE001 — courtesy only
        print(f"dream: could not publish the digest copy to {reports}: {e}",
              file=sys.stderr)
        return None
    return target


def cmd_digest(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="dream.py digest")
    p.add_argument("--report", default=None,
                   help="the agent's qualitative entries (acted/proposed/refused/"
                        "bootstrap) as inline JSON or @file")
    a = p.parse_args(argv)
    report = _load_report(a.report)

    memos_root = _memos_root()
    digests_root = _digests_root()
    marker, last_digest = _last_marker(digests_root)
    nights_since, nights_reason = _nights_since_last_digest(last_digest)
    extra_sinks = extra_memos_roots()
    recs = _select(memos_root, marker, extra_sinks)   # re-select → authoritative
    summ = _summarize(recs)
    corpus = _read_corpus(memos_root, extra_sinks)
    extra_only, extra_only_non_dream, _extra_labels, extra_in_window = \
        _extra_sink_split(corpus, recs)
    unreachable = _unreachable_memos(corpus, marker, _digest_dreamed_at(last_digest))

    iso, date_str = _now_iso_date()
    new_marker, marker_held = _advance_marker(
        recs, marker, _digest_dreamed_at(last_digest))
    fm = {
        "dreamedAt": iso,
        "since": (marker[0] if marker else "(bootstrap)"),
        "marker": new_marker[0],
        "markerMemo": new_marker[1],
        "markerHeld": " ".join(marker_held),
        "memoCount": len(recs),
        "acted": len(report.get("acted") or []),
        "proposed": len(report.get("proposed") or []),
        "refused": len(report.get("refused") or []),
        "bootstrap": bool((report.get("bootstrap") or "").strip()),
        "dreamSha": _dream_sha(),
        "memoSinkPresent": _memo_sink_present(memos_root),
        # Which rung of the sink ladder answered — recorded durably for the
        # same reason the blackout measure is: a fact that reached only the
        # prompt is the one a run forgets. `local` is the structural famine.
        "memoSinkKind": memo_sink_kind(),
        # Could the night FILE at all? Durable for that same reason, and here
        # forgetting it means the findings went nowhere (task 522).
        "taskQueuePresent": tasks_root() is not None,
        "everCapturedNonDream": _corpus_lifetime(corpus)[0],
        # The SEAM measure, likewise durable.
        "extraSinkMemos": extra_only,
        "extraSinkNonDreamMemos": extra_only_non_dream,
        "extraSinkMemosInWindow": extra_in_window,
        "unreachableMemos": len(unreachable),
        "_extraSinks": " ".join(str(r) for _, r in extra_sinks),
        "_unreachablePaths": " ".join(unreachable[:8]),
        # The blackout measure, recorded in the DURABLE artifact and not only in
        # `select` — the two other no-signal conditions each render a banner from
        # frontmatter precisely so a run cannot forget to mention them, and a
        # third that reached only the prompt would be the one that is forgotten.
        "nightsSinceLastDigest": ("" if nights_since is None else nights_since),
        "nightsSinceReason": (nights_reason or ""),
        "_memosRoot": str(memos_root),
        "_date": date_str,
    }

    target = digests_root / f"{date_str}.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    rotated = _rotate_prior_digest(target, iso)
    fm["_rotated"] = rotated.name if rotated else ""
    text = _render_digest(fm, report, summ, recs)
    atomic_write([(target, text)])

    published = _publish_report(text, iso, date_str)

    rel = target
    if _is_under(target, digests_root):
        rel = target.relative_to(digests_root)
    tail = f" · copy → {published}" if published else ""
    print(f"Done: dreamed over {len(recs)} memo(s) "
          f"(acted {fm['acted']}, proposed {fm['proposed']}, refused {fm['refused']}). "
          f"wrote {rel}{tail}")
    return 0


# ---------------------------------------------------------------------------
# file-task subcommand — the loop's ONE output channel (task 522)
# ---------------------------------------------------------------------------
# The dream lands nothing. It DETECTS, and every actionable detection becomes a
# task file the worker executes (`incoming/`) or the catcher surfaces
# (`blocked/`). This is the symmetric twin of the worker's own idle-time AUDITS,
# which have had exactly this shape since they shipped: detectors file, one
# executor lands, one catcher surfaces.
#
# The split between this script and the night that calls it is the same split
# `digest` already draws: the NIGHT supplies the qualitative half (title, the
# body sections, the memo refs) and the SCRIPT owns every deterministic fact —
# the minted id, the created stamp, the queue, the status, the priority, the
# `source: dream` provenance — so none of them can drift from run to run or be
# forgotten at 4am.

_TASK_ID_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-(\d{3})\b")

# The schema bar, made structural. `README.md`'s own rule is "Always set a real
# `## Done when`. A task with no acceptance criteria is one the worker can't
# safely finish — it'll just get parked", and a blocked task with no question is
# one the catcher cannot surface. Both were prose asked of the filer; here they
# are conditions of the write, so a night cannot file a task the pipeline will
# only bounce.
_REQUIRED_SECTIONS = ("Description", "Done when")

_TASK_TYPES = {"bug", "feature", "chore", "research", "other"}
_TASK_SIZES = {"small", "large", "unknown"}

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(text: str, limit: int = 60) -> str:
    s = _SLUG_RE.sub("-", (text or "").lower()).strip("-")
    if len(s) > limit:
        s = s[:limit].rsplit("-", 1)[0] or s[:limit]
    return s or "dream-finding"


def _minted_ids(root: Path) -> set[int]:
    """Every `NNN` already minted, across every queue dir, WHATEVER its date.

    The numbering rule has one home — the `id:` line of the queue's `README.md`
    schema — and it is GLOBAL: `NNN` is one past the highest `NNN` anywhere in
    the four queue dirs, and the date is merely the mint date. Until task 540
    this scan kept only ids whose date matched today's, which is the rule two
    prose docs used to state and no human minter ever followed: ~540 files on
    disk ran a single counter across days, so the one minter that followed the
    written rule produced `2026-09-02-001` the night after `…-537`, and ids
    stopped being monotonic. A filter by date here is the fork.

    The scan is by FILENAME rather than by frontmatter: a task is addressed by
    its filename everywhere in the pipeline, the id is its prefix, and reading N
    hundred files to answer a question their names already carry would make the
    immediately-before-each-write rescan too expensive to actually do twice."""
    used: set[int] = set()
    for sub in TASK_ID_DIRS:
        d = root / sub
        if not d.is_dir():
            continue
        try:
            names = [f.name for f in d.iterdir()]
        except OSError:
            continue
        for name in names:
            m = _TASK_ID_RE.match(name)
            if m:
                used.add(int(m.group(2)))
    return used


def _next_id(used: set[int]) -> int:
    """One past the MAX on disk, never the first free hole.

    The protocol the queue's `README.md` states is max+1, and matching the
    other minters (the catcher, the remote-inbox heartbeat, the auditor) is the
    whole point of sharing one protocol — but the reason it is max+1 rather
    than lowest-free is its own: an id can leave the queue (a
    finding ruled wontfix, a task withdrawn) while `log.md`, a `[[2026-09-01-004]]`
    cross-reference and a merge commit message all still name it. Re-issuing a
    retired number would point every one of those at a different task."""
    return max(used) + 1 if used else 1


def _find_conflict(root: Path, task_id: str, mine: Path) -> bool:
    """Did somebody else land the same id while we were writing?"""
    for sub in TASK_ID_DIRS:
        d = root / sub
        if not d.is_dir():
            continue
        try:
            entries = list(d.iterdir())
        except OSError:
            continue
        for f in entries:
            if f.name.startswith(task_id) and f.resolve() != mine.resolve():
                return True
    return False


def _render_task(fm: dict, sections: dict, order: list[str]) -> str:
    out = ["---"]
    for k, v in fm.items():
        # An empty value renders as a bare `key:` — the shape every hand-written
        # task in the queue carries. A trailing space is invisible in a diff and
        # would be the one difference between a dream-filed file and a
        # catcher-filed one.
        out.append(f"{k}: {v}" if str(v) != "" else f"{k}:")
    out.append("---")
    for name in order:
        body = (sections.get(name) or "").strip()
        if not body:
            continue
        out.append("")
        out.append(f"## {name}")
        out.append("")
        out.append(body)
    out.append("")
    out.append("## Progress log")
    out.append("")
    return "\n".join(out)


def cmd_file_task(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="dream.py file-task")
    p.add_argument("--task", default=None,
                   help="the night's qualitative half (title/type/size/sections/"
                        "the finding to route) as inline JSON or @file")
    a = p.parse_args(argv)
    spec = _load_report(a.task)
    if not spec:
        die("file-task needs --task (inline JSON or @file)")

    root = tasks_root()
    if root is None:
        # A night that cannot file has LOST its findings, so this is loud rather
        # than a silent skip: the digest is write-only and would bury it.
        die("no task queue found — set VIRGIL_TASKS_DIR, or run where "
            "~/virgil-tasks/ exists. (A pinned dev-loop sink SUPPRESSES "
            "discovery on purpose: a sandboxed loop may not mint into the "
            "human's live queue.)", code=3)

    title = (spec.get("title") or "").strip()
    if not title:
        die("file-task needs a `title`")

    ttype = (spec.get("type") or "chore").strip().lower()
    if ttype not in _TASK_TYPES:
        die(f"unknown task type {ttype!r} (expected one of {sorted(_TASK_TYPES)})")
    size = (spec.get("size") or "unknown").strip().lower()
    if size not in _TASK_SIZES:
        die(f"unknown task size {size!r} (expected one of {sorted(_TASK_SIZES)})")

    # WHERE it goes is never the night's call — one door answers it, the same
    # door whether the finding is a change or a red gate.
    route = task_route(spec.get("finding") or spec)

    sections = {str(k): str(v) for k, v in (spec.get("sections") or {}).items()}
    missing = [s for s in _REQUIRED_SECTIONS if not sections.get(s, "").strip()]
    if route["questionsRequired"] and not sections.get("Questions", "").strip():
        missing.append("Questions")
    if missing:
        die(f"task is below the pipeline's schema bar — missing section(s): "
            f"{', '.join(missing)} (route: {route['queue']} — {route['reason']})")

    refs = [str(r) for r in (spec.get("memoRefs") or []) if str(r).strip()]
    if refs:
        sections["Description"] = (
            sections["Description"].rstrip()
            + "\n\nSource memos: " + ", ".join(f"`{r}`" for r in refs))

    iso, date_str = _now_iso_date()
    # The queue's `created` is second-resolution and zoneless, which is what
    # every hand-written task in it carries; the loop's clock is UTC throughout,
    # so this is a FORMAT match, not a second clock.
    created = iso.split(".")[0].rstrip("Z")
    slug = _slugify(spec.get("slug") or title)
    queue_dir = root / route["queue"]

    # The collision protocol (README.md `id:` rule), shared by FOUR minters —
    # the catcher, the remote-inbox heartbeat, the auditor (the worker in idle
    # mode) and this loop: scan for the highest NNN on disk (any date)
    # immediately BEFORE the write, re-verify AFTER, rename on a collision. The
    # dream's 22:06 slot overlaps neither the 23:09 heartbeat nor the
    # on-the-hour worker, but a protocol that leans on a schedule is a protocol
    # that breaks the first time one moves. `next-id` below is the same scan
    # published as a door, so a hand minter can ask instead of counting.
    used = _minted_ids(root)
    written: Path | None = None
    task_id = ""
    for _ in range(50):
        nnn = _next_id(used)
        task_id = f"{date_str}-{nnn:03d}"
        target = queue_dir / f"{task_id}-{slug}.md"
        fm = {
            "id": task_id,
            "type": ttype,
            "title": title,
            "priority": route["priority"],
            "size": size,
            "project": str(source_repo_root()),
            "source": "dream",
            "created": created,
            "status": route["status"],
            "after": (spec.get("after") or ""),
            "worktree": "",
        }
        order = ["Questions", "Description", "Done when", "Design", "Verify"]
        text = _render_task(fm, sections, order)
        # Write the NEW file before deleting the superseded one, never the
        # reverse: the two orderings trade a momentary duplicate against a
        # momentary hole, and a crash in the hole loses the night's finding
        # outright. Same instinct as the loop's own "unprovable ⇒ KEEP".
        atomic_write([(target, text)])
        if written is not None and written != target:
            atomic_write([(written, None)])
        written = target
        if not _find_conflict(root, task_id, target):
            break
        used.add(nnn)
    else:  # pragma: no cover — 50 straight collisions is not a race, it's a bug
        die("could not mint a free task id after 50 attempts")

    print(json.dumps({"filed": True,
                      "id": task_id,
                      "path": str(written),
                      "queue": route["queue"],
                      "status": route["status"],
                      "priority": route["priority"],
                      "reason": route["reason"]}, indent=2))
    return 0


# ---------------------------------------------------------------------------
# paths — the loop's roots, as THIS build resolves them
# ---------------------------------------------------------------------------

# `paths <key>` → the JSON field it prints bare. The JSON vocabulary is the one
# `cmd_select`'s preflight block already publishes, so one name means one thing
# whichever door a reader takes.
_PATH_KEYS = {
    "digests": "digestsRoot",
    "memos": "memosRoot",
    "reports": "reportsRoot",
    "tasks": "taskQueueRoot",
}


def cmd_paths(argv: list[str]) -> int:
    """`dream.py paths [key]` — every dev-loop root as THIS build resolves it.

    A pure READ. It resolves the same doors `select` / `digest` resolve and
    prints them; it creates nothing (a resolver answers where a root WOULD be —
    only a write makes the directory), which is why `main` runs it OUTSIDE the
    DEV gate. It exists so a reader that is not the dream — CATCHER.md §2's
    nightly-digest step, run from a session that is not a dev session — asks
    the tool instead of spelling a path: the digest root has moved twice
    (`~/.virgil-dev` → `<primary checkout>/editor/dev`, task 431; the memo sink
    onto the synced inbox, task 521) and the prose copy went stale both times
    (task 538). The stored-copy rule (AGENTS.md, "The stored-copy half"): a live
    answer is resolved at READ time from one authority, never frozen into a doc.

    With a KEY the root is printed bare — one line, no JSON — so a shell can
    `ls` it; a root that does not resolve on this machine (no synced inbox, no
    task queue) prints nothing and exits 1 rather than printing `None` as if it
    were a path.
    """
    p = argparse.ArgumentParser(prog="dream.py paths")
    p.add_argument("key", nargs="?", choices=sorted(_PATH_KEYS),
                   help="print ONE root bare (a path; nothing + exit 1 when "
                        "that root does not resolve here) instead of the JSON")
    a = p.parse_args(argv)
    roots = {
        "digestsRoot": str(_digests_root()),
        "memosRoot": str(_memos_root()),
        "memoSinkKind": memo_sink_kind(),
        "reportsRoot": (str(synced_reports_root())
                        if synced_reports_root() is not None else None),
        "taskQueueRoot": (str(tasks_root()) if tasks_root() is not None else None),
    }
    if a.key is None:
        print(json.dumps(roots, indent=2))
        return 0
    value = roots[_PATH_KEYS[a.key]]
    if value is None:
        print(f"dream: the {a.key} root does not resolve on this machine",
              file=sys.stderr)
        return 1
    print(value)
    return 0


# ---------------------------------------------------------------------------
# next-id — the queue's numbering rule, as ONE executable door
# ---------------------------------------------------------------------------


def cmd_next_id(argv: list[str]) -> int:
    """`dream.py next-id` — the id the next minted task takes, printed bare.

    A pure READ, like `paths`: it runs the SAME scan `file-task` mints with
    (`_minted_ids` → `_next_id`) and prints `YYYY-MM-DD-NNN`, creating and
    reserving nothing — a minter still re-verifies after its own write, which
    is the second half of the protocol and stays theirs. It exists because the
    numbering rule had four implementations (two prose, one python, one habit)
    and the two prose ones said "per day" while every hand minter counted
    globally (task 540); a rule with one executable copy that any minter can
    ask is a rule that cannot be half-followed. The date is the mint date on
    the loop's UTC clock (`VIRGIL_DREAM_NOW` honoured, as `file-task` does);
    under the global rule the date carries no ordering — `NNN` does. A queue
    that does not resolve on this machine prints nothing and exits 1 rather
    than inventing an id.
    """
    p = argparse.ArgumentParser(prog="dream.py next-id")
    p.parse_args(argv)
    root = tasks_root()
    if root is None:
        print("dream: no task queue resolves on this machine — set "
              "VIRGIL_TASKS_DIR, or run where ~/virgil-tasks/ exists",
              file=sys.stderr)
        return 1
    _, date_str = _now_iso_date()
    print(f"{date_str}-{_next_id(_minted_ids(root)):03d}")
    return 0


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

_SUBCOMMANDS = {"select": cmd_select, "digest": cmd_digest,
                "file-task": cmd_file_task, "paths": cmd_paths,
                "next-id": cmd_next_id}

# Doors that run WITHOUT the DEV gate. The gate exists to keep the dream from
# RUNNING — and writing — outside a dev session; a resolver that writes nothing
# has nothing for it to protect, and gating it would hand an outside reader
# (the catcher, asking `paths digests` from an ordinary session) the no-op line
# where it needs a path. Membership is a claim that the door WRITES NOTHING —
# `test_dream_synced_sink.PathsDoor` pins it for `paths`;
# `test_dream_task_filing.NextIdDoor` for `next-id` (a hand minter — the
# catcher, the auditor, the heartbeat — asks it from an ordinary session).
_UNGATED = frozenset({"paths", "next-id"})


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in _SUBCOMMANDS:
        print(f"usage: dream.py {{{'|'.join(_SUBCOMMANDS)}}} [options]",
              file=sys.stderr)
        return 2

    # The gate. OFF (the default) → do nothing, succeed. The dream is a dev
    # affordance; it never runs — or writes — outside a DEV session.
    if argv[0] not in _UNGATED and not dev_mode_enabled():
        print("dream: DEV mode off (no VIRGIL_DEV, no <repo>/editor/dev/dev-mode marker) — no-op.")
        return 0

    return _SUBCOMMANDS[argv[0]](argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
