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
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from _common import (
    atomic_write,
    dev_mode_enabled,
    digests_root as _shared_digests_root,
    memos_root as _shared_memos_root,
    source_repo_root,
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
    # The one machine-global sink (shared with reflect.py) — resolves the same
    # from a repo checkout OR a synced paper's .virgil/scripts/editor/ copy, so
    # the dream reads exactly where reflect wrote.
    return _shared_memos_root()


def _digests_root() -> Path:
    return _shared_digests_root()


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


def _paper_script_prefixes(repo: Path) -> list[tuple[str, str]] | None:
    """The builder's `PAPER_SCRIPT_PREFIXES`, READ from the builder rather than
    re-spelled here.

    A skill source invokes its helpers repo-relative (`python3
    editor/scripts/X.py`); the paper bundle rewrites that prefix at the bundle
    boundary, so the shipped bytes differ from the SSOT bytes BY DESIGN. A drift
    check must apply the same rewrite before diffing or it reports every command
    markdown as drifted — a false positive on every file, every night, which is
    the fastest way to make the check ignorable.

    Those prefixes are a token two layers must agree on byte-for-byte, so they
    get ONE spelling (build-editor-bundle.mjs) and this side parses it out.

    The parse is keyed on the SILO TOKEN, not on the builder's container
    syntax — it collects the `"<silo>/scripts/"` and `".virgil/scripts/<silo>/"`
    string literals anywhere in the file and pairs them by silo. That is
    deliberate: the constant has already changed shape once (task 158 replaced a
    single `REPO_SCRIPT_PREFIX`/`PAPER_SCRIPT_PREFIX` pair with a two-silo
    `PAPER_SCRIPT_PREFIXES` array when `find-citation` began reaching for a
    library helper), and a regex pinned to either container would have gone
    quietly None — i.e. disarmed this whole check — the day it changed. The silo
    token is the actual invariant: it is what `skill-sync.ts diskPathFor` keys
    on.

    A parse failure returns None and the caller yields no drift — fail CLOSED,
    because a guessed prefix produces exactly the all-files false positive
    above. `test_dream_drift.test_real_builder_constant_is_still_parseable` is
    the canary that keeps a fail-closed parse from failing SILENTLY forever."""
    src = repo / "editor" / "build" / "build-editor-bundle.mjs"
    try:
        text = src.read_text()
    except Exception:
        return None
    targets = {m: f".virgil/scripts/{m}/"
               for m in re.findall(r'"\.virgil/scripts/(\w+)/"', text)}
    sources = {m: f"{m}/scripts/" for m in re.findall(r'"(\w+)/scripts/"', text)}
    pairs = [(sources[silo], targets[silo])
             for silo in sorted(targets) if silo in sources]
    return pairs or None


def _detect_skill_drift() -> list[str]:
    """Repo paths whose SSOT differs from the bytes the editor skill bundle
    actually SHIPPED — i.e. a landed edit not yet published by
    `npm run build:skill-bundles`.

    Keyed on the bundle's own `bundle-manifest.json`, because **the bundle is
    the artifact that reaches an agent** and the manifest is its record of what
    it shipped. Membership in `files` IS the shipped-ness test, which is what
    lets this ask the question uniformly over every carrier: the command
    markdowns, the `_`-prefixed shared includes, AND the `.py`/`.json` helpers
    the skills invoke.

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
    source repo, an unbuilt bundle (e.g. a synced paper copy), or an unparseable
    rewrite table yields `[]`.

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
    prefixes = _paper_script_prefixes(repo)
    if prefixes is None:
        return [], "unparseable-rewrite-table"
    try:
        files = json.loads(manifest.read_text()).get("files", [])
    except Exception:
        return [], "unreadable-manifest"

    # bundlePath → repoPath, the inverse of build-editor-bundle.mjs buildSources.
    roots = (("claude-commands/", "editor/skills/"), ("scripts/", "editor/scripts/"))
    drifted: list[str] = []
    for bundle_path in files:
        if not isinstance(bundle_path, str):
            continue
        repo_rel = next(
            (dst + bundle_path[len(src):] for src, dst in roots
             if bundle_path.startswith(src)),
            None,
        )
        if repo_rel is None:
            continue  # a bundle member with no SSOT twin (e.g. the manifest)
        try:
            raw = (repo / repo_rel).read_text()
            shipped = (bundle_dir / bundle_path).read_text()
        except Exception:
            # An SSOT file the manifest lists but disk no longer has is a real
            # staleness signal; an unreadable shipped file is not diffable.
            if not (repo / repo_rel).is_file():
                drifted.append(repo_rel)
            continue
        # isPaperCommandMarkdown(bundlePath) — the command markdowns are the
        # only members rewritten on the way into the bundle.
        if bundle_path.startswith("claude-commands/") and bundle_path.endswith(".md"):
            for a, b in prefixes:
                raw = raw.replace(a, b)
        if raw != shipped:
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
    """The most recent digest's recorded high-water marker, or (None, None) if
    none exists (the bootstrap dream).  Returns ((markerTs, markerMemo), path).
    The latest digest is the one with the greatest (dreamedAt, filename)."""
    if not digests_root.is_dir():
        return None, None
    best_rank: tuple[str, str] | None = None
    best_marker: tuple[str, str] | None = None
    best_path: Path | None = None
    for p in sorted(digests_root.rglob("*.md")):
        try:
            fm, _ = _parse_memo(p.read_text(encoding="utf-8")[:2000])
        except OSError:
            continue
        marker = (fm.get("marker") or "").strip()
        if not marker:
            continue
        rank = ((fm.get("dreamedAt") or "").strip(), p.name)
        if best_rank is None or rank > best_rank:
            best_rank = rank
            best_marker = (marker, (fm.get("markerMemo") or "").strip())
            best_path = p
    return best_marker, best_path


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


def _select(memos_root: Path, marker: tuple[str, str] | None) -> list[dict]:
    """Every memo strictly after `marker`, sorted oldest→newest."""
    if not memos_root.is_dir():
        return []
    recs = []
    for p in sorted(memos_root.rglob("*.md")):
        if p.name == ".gitkeep":
            continue
        try:
            recs.append(_load_memo(p, memos_root))
        except OSError:
            continue
    recs.sort(key=_memo_sort_key)
    if marker is not None:
        recs = [r for r in recs if _memo_sort_key(r) > marker]
    return recs


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
    recs = _select(memos_root, marker)
    summ = _summarize(recs)

    new_marker = _memo_sort_key(recs[-1]) if recs else (marker or ("", ""))
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
        # Canonical UTC date — the branch name (step 4) keys off THIS, never a
        # separate local date.today(), so branch and digest can't split across
        # two calendar dates (dream.py digest keys off the same _now_iso_date()).
        "dreamDate": _now_iso_date()[1],
        "memosRoot": str(memos_root),
        "since": (marker[0] if marker else None),
        "sinceMemo": (marker[1] if marker else None),
        "lastDigest": (str(last_digest.relative_to(_digests_root()))
                       if last_digest and _is_under(last_digest, _digests_root())
                       else (str(last_digest) if last_digest else None)),
        "bootstrap": marker is None,           # no prior dream → first dream
        "memoCount": len(recs),
        "marker": new_marker[0],
        "markerMemo": new_marker[1],
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
    for k in ("dreamedAt", "since", "marker", "markerMemo", "memoCount",
              "acted", "proposed", "refused", "bootstrap", "dreamSha"):
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
    record and the patch sits orphaned in `~/virgil-tasks/attachments/`. The marker itself survives (an empty
    re-select preserves it), so the window does not reopen; the loss is confined
    to the record, which is exactly the part a human reads in the morning.

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


def cmd_digest(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="dream.py digest")
    p.add_argument("--report", default=None,
                   help="the agent's qualitative entries (acted/proposed/refused/"
                        "bootstrap) as inline JSON or @file")
    a = p.parse_args(argv)
    report = _load_report(a.report)

    memos_root = _memos_root()
    digests_root = _digests_root()
    marker, _ = _last_marker(digests_root)
    recs = _select(memos_root, marker)        # re-select → authoritative facts
    summ = _summarize(recs)

    iso, date_str = _now_iso_date()
    new_marker = _memo_sort_key(recs[-1]) if recs else (marker or ("", ""))
    fm = {
        "dreamedAt": iso,
        "since": (marker[0] if marker else "(bootstrap)"),
        "marker": new_marker[0],
        "markerMemo": new_marker[1],
        "memoCount": len(recs),
        "acted": len(report.get("acted") or []),
        "proposed": len(report.get("proposed") or []),
        "refused": len(report.get("refused") or []),
        "bootstrap": bool((report.get("bootstrap") or "").strip()),
        "dreamSha": _dream_sha(),
        "_date": date_str,
    }

    target = digests_root / f"{date_str}.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    rotated = _rotate_prior_digest(target, iso)
    fm["_rotated"] = rotated.name if rotated else ""
    atomic_write([(target, _render_digest(fm, report, summ, recs))])

    rel = target
    if _is_under(target, digests_root):
        rel = target.relative_to(digests_root)
    print(f"Done: dreamed over {len(recs)} memo(s) "
          f"(acted {fm['acted']}, proposed {fm['proposed']}, refused {fm['refused']}). "
          f"wrote {rel}")
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
        print("dream: DEV mode off (VIRGIL_DEV unset) — no-op.")
        return 0

    return _SUBCOMMANDS[argv[0]](argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
