#!/usr/bin/env python3
r"""The dev-dream NIGHT engine — the mechanical half of /editor/dream (chip 18).

The "day" capture layer (/editor/reflect, chip 17) drops tiered memos into
editor/dev/memos/ as real skill invocations run under DEV mode.  This script is
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

It does NOT route changes — that is dream_land.classify_change (the shared
landing-mode helper + the three-boundary guard).  It does NOT itself edit a
skill or run git: the skill applies the ACTS edits and stages the PROPOSES
worktree; this script only accounts for them in the digest.

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

Usage:
  dream.py select
  dream.py digest [--report <inline|@file>]
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
    synced_memos_root,
    synced_reports_root,
)

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
    # The one sink (shared with reflect.py), under the PRIMARY checkout —
    # resolves the same from a repo checkout, a worktree, OR a synced paper's
    # .virgil/scripts/editor/ copy (via VIRGIL_REPO_ROOT), so the dream reads
    # exactly where reflect wrote. Unresolvable is a loud refusal (task 431).
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

    Since task 431 the home is `<primary checkout>/editor/dev` (gitignored),
    so the sink travels with the clone — but a wrong `VIRGIL_REPO_ROOT`, a
    fresh clone, or a `VIRGIL_DEV_HOME` pin at a stale path still produce the
    same zero, which is why the flag stays."""
    return memos_root.is_dir()


def _scan_sink(memos_root: Path) -> list[dict]:
    """Every memo in ONE sink directory, unsorted. `_read_corpus` is the door."""
    if not memos_root.is_dir():
        return []
    recs = []
    for p in sorted(memos_root.rglob("*.md")):
        if p.name == ".gitkeep" or is_sync_conflict_name(p.name):
            continue
        try:
            recs.append(_load_memo(p, memos_root))
        except OSError:
            continue
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
            if rec["path"] in seen:
                continue          # the sink in use holds it too — same memo
            rec["sink"] = label
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


def _extra_sink_split(corpus: list[dict]) -> tuple[int, int, list[str]]:
    """How much of the corpus only a SUPERSEDED sink holds — the SEAM question.

    Every no-signal flag before this one asks about the READER's own state: is
    my prompt current (`driftChecked`), does my sink exist (`memoSinkPresent`),
    did I read a marker (the empty `marker`), has my sink ever been fed
    (`everCapturedNonDream`), did I run at all (`nightsSinceLastDigest`). None
    of them asks whether the WRITERS and the reader agree about WHERE the
    mailbox is — a fact about neither end, and the one that can make every
    other flag report healthily over a corpus arriving somewhere else. See
    `_common.extra_memos_roots`.

    Returns `(extraOnlyCount, extraOnlyNonDreamCount, sinkLabels)`. The second
    is the number that matters: a superseded sink holding only old
    `skill: dream` self-memos is migration residue, while ONE real skill memo
    there is a live writer this build no longer agrees with."""
    extra = [r for r in corpus if r.get("sink")]
    labels = sorted({r["sink"] for r in extra})
    non_dream = sum(1 for r in extra if r.get("skill") != "dream")
    return len(extra), non_dream, labels


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
    extra_only, extra_only_non_dream, extra_seen = _extra_sink_split(corpus)
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
        # Canonical UTC date — the branch name (step 4) keys off THIS, never a
        # separate local date.today(), so branch and digest can't split across
        # two calendar dates (dream.py digest keys off the same _now_iso_date()).
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
        "syncedMemosRoot": (str(synced_memos_root())
                            if synced_memos_root() is not None else None),
        "reportsRoot": (str(synced_reports_root())
                        if synced_reports_root() is not None else None),
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


def _render_digest(fm: dict, report: dict, summ: dict, recs: list[dict]) -> str:
    acted = report.get("acted") or []
    proposed = report.get("proposed") or []
    refused = report.get("refused") or []
    counts = summ["counts"]
    by_tier = counts["byTier"]

    out: list[str] = ["---"]
    for k in ("dreamedAt", "since", "marker", "markerMemo", "markerHeld",
              "memoCount", "memoSinkPresent", "memoSinkKind",
              "everCapturedNonDream",
              "extraSinkMemos", "extraSinkNonDreamMemos",
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
            f"absent, so `memoCount: 0` above means the dream could not look, "
            f"NOT that nothing was captured. `reflect.py` creates the sink on "
            f"its first write, so this reads as benign on a machine's first "
            f"day and as a broken capture layer on its thirtieth — check the "
            f"calendar, `VIRGIL_REPO_ROOT` and any `VIRGIL_DEV_HOME` pin before "
            f"trusting any zero here. "
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
            f"> **⚠️ {extra_real} real skill memo(s) arrived in a SUPERSEDED "
            f"sink — a live writer disagrees with this build about where the "
            f"mailbox is.** They were read (the corpus is the union), so "
            f"nothing is lost; what it means is that some paper folder is "
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
            f"than a live divergent writer: it is read and counted, and the "
            f"sink can be deleted once nothing writes there."
        )
        out.append("")
    if fm.get("memoSinkKind") == "local":
        out.append(
            f"> **⚠️ No SYNCED mailbox — the memo sink is local to this "
            f"machine (`{fm.get('_memosRoot', '?')}`).** All Virgil cowork now "
            f"happens on a different computer, and a reflection written there "
            f"resolves a checkout that machine does not have, so it is never "
            f"written at all — the famine below is structural, not a quiet "
            f"night. The loop expects "
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
            f"`{fm['_rotated']}` — read it too; anything it did not land is a "
            f"patch under `~/virgil-tasks/attachments/`, not a live branch. "
            f"This file covers only the memos written since that run."
        )
        out.append("")

    out.append(f"## Acted ({len(acted)})")
    out.append("_Landed directly on this dream branch — single-skill-prompt "
               "polish; revert with `git revert`/`git checkout`._")
    if acted:
        for e in acted:
            paths = ", ".join(e.get("paths") or [])
            out.append(f"- **{paths or e.get('summary', '?')}** — "
                       f"{e.get('summary', '')}{_fmt_refs(e.get('memoRefs'))}")
    else:
        out.append("- None.")
    out.append("")

    out.append(f"## Proposed ({len(proposed)})")
    out.append("_Staged in a worktree — cross-skill / script / manifest / "
               "contract-adjacent. Step 6 then LANDED it, or EXPORTED it as a "
               "patch and deleted the branch (no `dream/*` branch outlives its "
               "run — the nightly sweep merges every surviving one blindly)._")
    if proposed:
        for e in proposed:
            # An entry that did NOT land points at its PATCH: after step 6 the
            # branch is gone either way, so a merge hint would name nothing.
            patch = (e.get("patch") or "").strip()
            branch = e.get("branch") or f"dream/{fm['_date']}"
            pointer = f"git apply {patch}" if patch else f"git merge {branch}"
            paths = ", ".join(e.get("paths") or [])
            out.append(f"- **{e.get('summary', '?')}** — `{pointer}`")
            out.append(f"  - touches: {paths or '—'}{_fmt_refs(e.get('memoRefs'))}")
            if e.get("reason"):
                out.append(f"  - why proposed: {e['reason']}")
    else:
        out.append("- None.")
    out.append("")

    out.append(f"## Refused ({len(refused)})")
    out.append("_Crossed a load-bearing boundary — never applied, never "
               "proposed (design §4)._")
    if refused:
        for e in refused:
            out.append(f"- 🚫 **{e.get('boundary', '?')}** — "
                       f"{e.get('summary', '')}{_fmt_refs(e.get('memoRefs'))}")
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

    That is worse than losing a summary. The digest is the only durable output
    the dream authors, and an UNLANDED `proposed` entry's patch path is the ONLY
    pointer to that work — since 2026-08-18 the skill's §6 exports and deletes
    rather than parking a branch (a parked branch self-merges via the nightly
    sweep), so there is no surviving worktree to rediscover it from: erase the
    record and the patch sits orphaned in `~/virgil-tasks/attachments/`. The loss
    is confined to the record, which is exactly the part a human reads in the
    morning.

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
    stamp = iso.replace("-", "").replace(":", "")
    # `2026-09-01T023045Z` — sortable, colon-free (portable), unique per run.
    hhmmss = stamp[9:15] if len(stamp) >= 15 else "000000"
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
    extra_only, extra_only_non_dream, _extra_labels = _extra_sink_split(corpus)

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
        "everCapturedNonDream": _corpus_lifetime(corpus)[0],
        # The SEAM measure, likewise durable.
        "extraSinkMemos": extra_only,
        "extraSinkNonDreamMemos": extra_only_non_dream,
        "_extraSinks": " ".join(str(r) for _, r in extra_sinks),
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
# main
# ---------------------------------------------------------------------------

_SUBCOMMANDS = {"select": cmd_select, "digest": cmd_digest}


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in _SUBCOMMANDS:
        print(f"usage: dream.py {{{'|'.join(_SUBCOMMANDS)}}} [options]",
              file=sys.stderr)
        return 2

    # The gate. OFF (the default) → do nothing, succeed. The dream is a dev
    # affordance; it never runs — or writes — outside a DEV session.
    if not dev_mode_enabled():
        print("dream: DEV mode off (no VIRGIL_DEV, no <repo>/editor/dev/dev-mode marker) — no-op.")
        return 0

    return _SUBCOMMANDS[argv[0]](argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
