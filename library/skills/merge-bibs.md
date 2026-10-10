---
description: |
  Walk every deep-indexed library paper and fold each one's
  `references.bib` into `master.bib`. Per-entry rules:
  (1) Duplicate of an already-authenticated master entry → defer to
  master. (2) Duplicate of an UNAUTH master entry → authenticate using
  the collective field info from both; if they prove distinct, split.
  (3) No duplicate → authenticate and add. Adds even if auth comes back
  `unverified`/`failed` (the work is real, just hard to look up), but
  SKIPS entries that read as transient (manuscript / forthcoming /
  in press / to appear / submitted / under review / draft) since
  authenticating them is doomed for non-content reasons.

  Triggers on: "merge library bibs", "consolidate references into
  master.bib", "fold all the paper bibs into master", "Virgil, do a
  library-wide bib merge", "drain references.bib files into master".

  Heavy operation — spawns multiple per-paper subagents in parallel
  via the `Agent` tool so the orchestrator's context stays small.
  Self-defending: takes a pre-run snapshot of master.bib + catalog +
  inbox to `~/Library/Application Support/Virgil/backups/` (outside
  any sync folder), refuses to start if another writer is active,
  and forces `--batch 1` in cloud-synced libraries unless
  `--allow-parallel-sync` is passed. Must run from inside the library
  folder (or any folder with the Virgil library-path resolver). Does
  NOT trigger for syncing one paper's bibliography against the
  library — that's `/editor/sync-bib-to-library`. Does NOT trigger
  for verifying a single bib entry — that's
  `/library/authenticate-bib`.

  Args: `[--batch N] [--filter <glob>] [--force] [--dry-run]
        [--allow-parallel-sync]`.
---

# /library/merge-bibs $ARGUMENTS

> **Shared doctrine — find-or-surface, never fabricate.** Read
> [_find-or-surface.md](_find-or-surface.md). This is the whole-library
> arm of the same per-entry authenticate engine as `/library/import-bib`,
> so it can add many sourced rows in one sweep. Never fake one: an entry
> that only reaches `unverified` / `failed` is added as such (the work is
> real) — that terminal state IS the surfaced gap; do not hand-upgrade a
> low-confidence match to `authenticated`.

## Bootstrap (run this first)

This skill operates on the user's Virgil Library. Resolve the library
root and cd into it before running anything else — that way the skill
works from any Virgil-managed folder (paper folder, library folder, or
anywhere with the Virgil sync bundle).

```bash
# Find library_path.py — synced PWA folders have it under .virgil/scripts/,
# the Virgil source repo has it under editor/scripts/. Either is fine.
library_path_py=""
for candidate in .virgil/scripts/editor/library_path.py editor/scripts/library_path.py; do
  [ -f "$candidate" ] && { library_path_py="$candidate"; break; }
done
if [ -z "$library_path_py" ]; then
  echo "No library set up. Pick a library in Virgil first."
  exit 1
fi
library_root="$(python3 "$library_path_py" --get 2>/dev/null)" || {
  echo "No library set up. Pick a library in Virgil first."
  echo "  (Or run: python3 $library_path_py --set <abs-path>)"
  exit 1
}
cd "$library_root"
export VIRGIL_LIBRARY_ROOT="$library_root"
```

All paths in the rest of this skill resolve against the library root.

> **Every step is a separate Bash call — the shell does not carry over.**
> Your Bash tool keeps neither exported variables nor `cd` between calls,
> and the steps below are separated by whole subagent waves. So nothing is
> handed between steps through the shell: Step 0's preflight writes the
> run's state (library root, snapshot dir, filter/force/dry-run, batch) to
> **`/tmp/merge-bibs-run.json`** plus a sourceable
> **`/tmp/merge-bibs-run.json.env`**, and every later fenced block begins
> with `. /tmp/merge-bibs-run.json.env && cd "$VIRGIL_LIBRARY_ROOT"`. A
> value you `export` in one block is EMPTY in the next — which is exactly
> how the postflight once compared master.bib with itself and said "clean"
> (task 798).

---

## Args parsing

The `$ARGUMENTS` string carries optional flags:

- `--batch N` — number of papers processed in parallel per wave.
  Default is set by preflight (Step 0): `5` in local libraries, `1`
  in cloud-synced ones. If the user explicitly passes `--batch >1`
  inside a sync-mounted library, the skill bails unless
  `--allow-parallel-sync` is also passed. Keep modest (3–10) in
  local libraries; each subagent's helper script makes ~10–50 HTTP
  calls to Crossref/OpenAlex/Semantic Scholar/arXiv, so a high batch
  can hit rate-limits.
- `--allow-parallel-sync` — explicit opt-in to parallel writes inside
  a cloud-synced library. **Dangerous.** A 2026-05-17 run with
  `--batch 5` inside a Dropbox folder spawned ~4000 conflict copies
  and silently truncated master.bib. Only use this flag if you have
  paused sync at the OS level for the duration of the run.
- `--filter <glob>` — only process citekeys matching the shell glob
  (e.g. `barthes*`, `*2019*`). Default: no filter (all deep-indexed).
- `--force` — re-merge papers even if their report exists and is
  newer than `references.bib`.
- `--dry-run` — produce reports without writing `master.bib`,
  `catalog.json`, or `inbox.json`. Its reports and worklist go to
  `.virgil/merge-reports/_dry-run/`, never the real report directory: a
  real run reads a paper's report as "already merged", so a dry run that
  wrote there would make the next real run skip every never-imported
  paper (task 1037).

Do not parse them into shell variables (they would not survive to the
next step). Pass them **straight through to the preflight in Step 0**, which
records them in the run-state file and applies the batch policy: pass
`--batch N` only if the user gave it (its absence is what lets preflight
choose the default), and pass each of `--allow-parallel-sync`,
`--filter <glob>` (quoted), `--force`, `--dry-run` only if given.

---

## Step 0 — Preflight (snapshot + safety checks)

This step prevents a recurrence of the 2026-05-17 Dropbox conflict
explosion. It snapshots the critical state files to a location
**outside** any sync folder, detects whether the library is sync-
mounted, and refuses to start if another writer is mutating the
library. **Always run this step.**

Run it in the same Bash call as the `cd` above (or `cd "$library_root"`
again), substituting the user's flags for `<user flags>`:

```bash
# stdout is the JSON; stderr (retention-prune warnings etc.) goes to its OWN
# file — merged into stdout it corrupts the JSON and json.load crashes,
# silently skipping the writer check and the batch policy (task 798).
python3 .virgil/scripts/library/merge_bibs_preflight.py \
  --run-state /tmp/merge-bibs-run.json <user flags> \
  > /tmp/merge-bibs-preflight.json 2> /tmp/merge-bibs-preflight.err
preflight_rc=$?
if [ $preflight_rc -ne 0 ]; then
  echo "preflight failed (rc=$preflight_rc):"
  cat /tmp/merge-bibs-preflight.err /tmp/merge-bibs-preflight.json
  exit 1
fi
[ -s /tmp/merge-bibs-preflight.err ] && { echo "preflight warnings:"; cat /tmp/merge-bibs-preflight.err; }
```

Parse the JSON and apply the policy:

```bash
python3 - <<'PY'
import json, os, sys
pf = json.load(open("/tmp/merge-bibs-preflight.json"))
# Surface a short status line for the user.
print(f"Snapshot:       {pf['snapshot_dir']}")
print(f"Sync mounted:   {pf['sync_mounted']} ({pf['sync_kind'] or 'n/a'})")
print(f"Batch:          {pf['run']['batch']} (recommended {pf['recommended_batch']})")
print(f"Filter/force/dry-run: {pf['run']['filter'] or '-'} / {pf['run']['force']} / {pf['run']['dry_run']}")
print(f"Refuse:         {pf['refuse'] or 'no'}")
w = pf["other_writers"]
if pf["any_writers"]:
    print("Other writers detected:")
    for p in w["processes"]:
        print(f"  process pid={p['pid']} pattern={p['pattern']}")
    for lk in w["queue_locks"]:
        print(f"  queue lock: {lk}")
    for r in w["recent_mods"]:
        print(f"  recent mod: {r['path']} (mtime {r['mtime_age_s']}s ago)")
PY
```

Now decide whether to bail. The policy is computed by the preflight itself
(`refuse` and `run.batch` in the JSON) — read it, don't re-derive it:

- **If `refuse` is `"other-writers"`** (`any_writers` is `true`): print the offending pids/files and
  bail with this message (do not proceed):
  > Library-wide bib merge refused: other writers are touching this
  > library. Pause `/library:index-pending`, kill stale
  > `merge_paper_references.py` / `drain_queue.py` processes, and
  > clear stale `.virgil/queue/*.lock` files. The preflight snapshot
  > at `<snapshot_dir>` is safe.

- **If `refuse` starts with `"parallel-in-sync"`** (`sync_mounted` and
  the user passed `--batch N` with `N > 1` without
  `--allow-parallel-sync`): bail with:
  > Library-wide bib merge refused: this is a `<sync_kind>` library
  > and you asked for `--batch <N>`. Parallel writes inside synced
  > folders caused a ~4000-conflict-file explosion on 2026-05-17.
  > Re-run with `--batch 1`, or re-run with
  > `--batch <N> --allow-parallel-sync` if you've paused sync at the
  > OS level first.

- **If `refuse` is `"bad-batch"`**: the user passed `--batch` below 1;
  bail and ask for a positive batch.

- **If `sync_mounted` is `true` and the user did not pass `--batch`**:
  preflight already chose `run.batch = 1` (the safe default for synced
  libraries); inform the user with a one-liner: *"Sync-mounted library
  detected; defaulting to --batch 1. Estimated runtime ~2 min/paper."*

- **Otherwise**: `run.batch` is the user's `--batch` or the recommended
  default. It, the snapshot path, and the filter/force/dry-run flags are
  now in `/tmp/merge-bibs-run.json.env` — the ONLY way later steps get them.

If you bail in this step, the snapshot has still been taken — surface
its path to the user as something they can roll back to if anything
else has gone wrong.

---

## Step 1 — Build the worklist

Print the list of citekeys to process. Filter to deep-indexed papers,
honor `--filter`, and (unless `--force`) skip papers already imported.
A paper counts as **already imported** when its catalog row has
`bib.imported == true` AND its `references.bib` has gained no new citekey
since import (additions-only — the engine snapshots `bib.importedKeys`
at import time). Libraries imported before the flag existed fall back to
the legacy report-mtime check so they aren't needlessly re-scanned.

```bash
. /tmp/merge-bibs-run.json.env && cd "$VIRGIL_LIBRARY_ROOT"
python3 .virgil/scripts/library/merge_bibs_worklist.py --run-state "$MERGE_RUN_STATE"
```

The rule lives in `merge_bibs_worklist.py` (pinned by
`test_merge_dry_run_isolation.py`), not here — do not re-implement it inline.
A legacy report stamped `"dry_run": true` never counts as "already merged".
The worklist lands in `$MERGE_REPORT_DIR/_worklist.txt` (the run's own report
directory — `_dry-run/` under a dry run).

`MERGE_FILTER` / `MERGE_FORCE` arrive from the sourced run-state `.env` —
never set them by hand in this block (a hand-set name that differs from the
one read here is how `--filter` once merged everything).

If the worklist is empty, print a one-line summary and stop:
```
Library-wide bib merge: nothing to do (0 papers in worklist).
```

---

## Step 2 — Spawn batched subagents

Read `$MERGE_REPORT_DIR/_worklist.txt` into memory, and read the batch
size, dry-run flag and report directory from the run state (`run.batch`,
`run.dry_run`, and `MERGE_REPORT_DIR` in `/tmp/merge-bibs-run.json.env`) —
not from your memory of the args. Walk the worklist in chunks of `BATCH`. **For each chunk, emit `BATCH` `Agent` tool
calls in a single message.** That's how the Claude Code harness
runs them concurrently — sequential `Agent` calls run one at a time.

Wait for all subagents in the chunk to return before moving to the
next chunk. Echo each subagent's one-line reply as it lands so the
user sees progress.

**Per-subagent prompt template** (paste verbatim, substituting
`<library_root>`, `<citekey>`, `<dry_run_flag>`, and `<report_dir>`):

> You are merging one Virgil Library paper's `references.bib` into the
> library's `master.bib`. Library root: `<library_root>`. Paper
> citekey: `<citekey>`.
>
> Steps:
> 1. `cd <library_root>`
> 2. Confirm `papers/<citekey>/references.bib` exists. If it doesn't,
>    write the stub `{"citekey":"<citekey>","status":"no-references"}`
>    to `<report_dir>/<citekey>.json` and reply
>    `Done: <citekey> (no-references)`; do not continue.
> 3. Run the merge:
>    ```
>    python3 .virgil/scripts/library/merge_paper_references.py <citekey> <dry_run_flag>
>    ```
>    The script does the dedup → authenticate → transient-skip work
>    and writes `<report_dir>/<citekey>.json`. It also writes
>    a one-line summary to stdout (`+A ~D ⇄U ⤬T ⚠F ?M`).
> 4. Read the report. If `manual_review[]` is non-empty, briefly look at
>    each item — reading the relevant master.bib entries when useful —
>    and add a `manual_review_decisions` array to the report file with
>    one entry per item shaped `{paper_entry, master_entry, decision,
>    reason}` where `decision` ∈ `"accept_master"`, `"prefer_paper"`,
>    `"split"`, `"defer_to_user"`. Save the file in place. For items
>    of type `split_paper_unauthenticatable` or
>    `split_citekey_collision`, default to `"defer_to_user"` unless
>    the case is obvious.
> 5. Reply with EXACTLY ONE line:
>    `Done: <citekey> +<added> ~<dup> ⇄<unauth-dup-handled> ⤬<transient> ⚠<failed> ?<manual>`
>    using the counters from the report you wrote.
>
> Hard rules:
> - You operate on the user's real library. Do not create test fixtures.
> - Do not edit any file under `library/skills/` or `library/scripts/`.
> - Do not invoke any other library skill (`/library/...`) from inside
>   this subagent — your single job is to run the merge helper and
>   surface its output.
> - Do not parallelize within this subagent (no nested `Agent` calls).
>   The orchestrator is responsible for parallelism across papers.

`<dry_run_flag>` is `--dry-run` if the run state's `run.dry_run` is
`true`, otherwise the empty string. `<report_dir>` is the run state's
`MERGE_REPORT_DIR` — the engine picks the same directory from the flag, so
the two always agree.

After each chunk completes, optionally print a one-line progress
indicator so the user knows how far the run has progressed:
`Wave <i>/<total_waves> complete (<n_papers>/<total>).`

---

## Step 3 — Aggregate

Once every chunk finishes, read every per-paper report and produce a
single library-wide summary.

**Bucket by the literal the engine wrote — never a hand-enumerated ladder.**
The engine owns the report vocabulary and grows it (`would-auth` and
`would-collective-auth` under `--dry-run`; whatever a later state adds). An
aggregator that `if state == "authenticated" … elif …` silently scores every
unrecognized literal as zero, so the summary reads "nothing happened" for a run
that did plenty. Count into a `Counter` keyed on the raw string and render every
key you find — an unknown state then shows up as an extra line, which is visible
and fixable, instead of vanishing.

```bash
. /tmp/merge-bibs-run.json.env && cd "$VIRGIL_LIBRARY_ROOT"
python3 - <<'PY'
import json, os, sys
from collections import Counter
from pathlib import Path
library = Path(os.environ["VIRGIL_LIBRARY_ROOT"])
report_dir = Path(os.environ["MERGE_REPORT_DIR"])
worklist_file = report_dir / "_worklist.txt"
citekeys = [ck for ck in (worklist_file.read_text().splitlines() if worklist_file.exists() else []) if ck]

totals = {
    "papers": 0, "entries": 0,
    "deferred_dup": 0, "skipped_transient": 0, "manual_review": 0,
}
# Keyed on the raw report literal, so no state can be silently dropped.
added_by_state: Counter[str] = Counter()        # report.added[].state
auth_failed_by_state: Counter[str] = Counter()  # report.auth_failed[].state — ALSO written to master.bib
unauth_dup_by_action: Counter[str] = Counter()  # report.unauth_dup_handled[].action
manual_papers: list[str] = []
dry_run_seen = False
for ck in citekeys:
    rpt_path = report_dir / f"{ck}.json"
    if not rpt_path.exists():
        continue
    r = json.loads(rpt_path.read_text())
    totals["papers"] += 1
    totals["entries"] += r.get("entries_total", 0)
    for row in r.get("added", []):
        added_by_state[row.get("state", "") or "(unstated)"] += 1
        dry_run_seen |= bool(row.get("dry_run"))
    for row in r.get("auth_failed", []):
        auth_failed_by_state[row.get("state", "") or "(unstated)"] += 1
    for row in r.get("unauth_dup_handled", []):
        unauth_dup_by_action[row.get("action", "") or "(unstated)"] += 1
        dry_run_seen |= bool(row.get("dry_run"))
    totals["deferred_dup"] += len(r.get("deferred_dup", []))
    totals["skipped_transient"] += len(r.get("skipped_transient", []))
    n_manual = len(r.get("manual_review", []))
    totals["manual_review"] += n_manual
    if n_manual:
        manual_papers.append(ck)

out = {
    "totals": totals,
    "dry_run": dry_run_seen,
    "added_by_state": dict(added_by_state),
    "auth_failed_by_state": dict(auth_failed_by_state),
    "unauth_dup_by_action": dict(unauth_dup_by_action),
    "added_total": sum(added_by_state.values()),
    "auth_failed_total": sum(auth_failed_by_state.values()),
    "manual_papers": manual_papers,
}
print(json.dumps(out, indent=2))

# Step 4 sources these instead of hand-transcribing them into the env.
env_path = Path("/tmp/merge-bibs-totals.env")
# `export` matters: the Step 4 memo heredoc reads MANUAL_PAPERS via os.environ,
# so a plain shell assignment would not reach it.
env_path.write_text(
    f"export MANUAL_REVIEW={totals['manual_review']}\n"
    f"export MANUAL_PAPERS='{' '.join(manual_papers)}'\n"
    f"export DRY_RUN_SEEN={1 if dry_run_seen else 0}\n"
)
PY
```

`auth_failed[]` entries **were written to master.bib** — the engine routes
`unverified`/`failed` there instead of `added[]` (`merge_paper_references.py`
`:621-630`), so they are additions that need attention, not skips. That is what
the skill's headline promise ("Adds even if auth comes back
`unverified`/`failed`") looks like in the aggregate, so it gets its own row.

Print the summary table in the orchestrator's reply:

```
Library-wide bib merge complete
───────────────────────────────
Papers processed:                  <papers>
Entries seen:                      <entries>
+ Added (authenticated):           <added_by_state["authenticated"]>
+ Added (canonical):               <added_by_state["canonical"]>
+ Added (unverified/failed):       <auth_failed_total>
⇄ Unauth-dup → merged into master: <unauth_dup_by_action["merged"]>
⇄ Unauth-dup → split (both kept):  <unauth_dup_by_action["split"]>
~ Deferred — dup of terminal master: <deferred_dup>
⤬ Skipped — transient:             <skipped_transient>
? Manual review pending:           <manual_review>  in <list-of-citekeys-or-"none">
```

Two rules on top of the template:

- **Any leftover key gets its own line.** If `added_by_state`,
  `auth_failed_by_state`, or `unauth_dup_by_action` holds a key the template
  doesn't name, append `+ Added (<state>): <n>` / `⇄ Unauth-dup → <action>: <n>`
  rather than dropping it. Omit template rows whose count is 0 *and* whose state
  never appeared, so the table stays short.
- **`dry_run: true` → relabel, don't zero.** A dry run reports the sentinels
  `would-auth` (in `added[]`) and `would-collective-auth` (in
  `unauth_dup_handled[]`) and writes nothing. Head the table
  `Library-wide bib merge — DRY RUN (no writes)` and phrase the rows as
  *would-add* / *would-collective-auth*, e.g.
  `+ Would add: <added_by_state["would-auth"]>`. The point of a dry run is
  seeing the magnitude, so it must never print an all-zeros table.

---

## Step 3.5 — Postflight verification

Compare the post-run library state against the preflight snapshot. The merge
helper's contract is "only add, never delete" **to the canonical store** —
`master.bib`. `catalog.json` is a derived index under the F#4 holdings-only
model, so parts of it legitimately shrink. `merge_bibs_postflight.py` alerts on
exactly three things; treat its `alerts[]`/`clean` as authoritative rather than
re-deriving a verdict from the raw counts:

- **`master.bib` shrank** — real data loss; the merge only appends to it.
- **An `indexed.state` regression** — a holding lost its indexed status. Only
  the *real* work states count (`_REAL_INDEX_STATES`:
  `indexed`, `deepIndexed`, `richIndexed`, `running`, `queued`, `failed`).
  A drop in `none` is skipped in `_check_catalog` — those are the expected F#4
  reference-row prunes.
- **A `present: true` holdings row disappeared** (`present_dropped`, F4W-2) —
  data loss that shows up in neither of the above.

A **bare `catalog.json` total decline with no state regression is expected and
clean**, not an alert: the merge removes/never-mints reference-only rows whose
auth state has moved into the `% bib.state` comment in `master.bib`. The script
records it as `catalog_shrank_expected: true` and still reports `clean: true`
(`catalog_shrank_expected` / `clean` in `main`). Do **not** tell the user to roll back on that signal
alone — it would abandon a correct merge.

Roll back only when `alerts[]` is non-empty; the script hands you the exact
commands in `restore_commands`.

```bash
. /tmp/merge-bibs-run.json.env && cd "$VIRGIL_LIBRARY_ROOT"
python3 .virgil/scripts/library/merge_bibs_postflight.py \
  --snapshot-dir "$SNAPSHOT_DIR" > /tmp/merge-bibs-postflight.json
echo "postflight rc=$?"
```

The postflight **fails closed**: an empty or bogus `--snapshot-dir` (no
preflight `manifest.json`, or the library itself) exits 2 with
`clean: false` and an `error` — it never compares master.bib with itself.
Treat an `error` exactly like an alert: tell the user the safety check
could NOT run, and give them the snapshot path from the run state.

Inspect the result:

```bash
python3 - <<'PY'
import json
p = json.load(open("/tmp/merge-bibs-postflight.json"))
if p.get("error"):
    print(f"Postflight: COULD NOT RUN — {p['error']}")
elif p.get("clean"):
    print("Postflight: clean")
else:
    print("Postflight: ALERT")
    for a in p.get("alerts", []):
        print(f"  ! {a}")
    print()
    print("Restore commands (copy-paste to roll back):")
    for c in p.get("restore_commands", []):
        print(f"  {c}")
PY
```

If postflight is **not clean**, include the ALERT block and the
restore commands in your final reply to the user, prominently — they
need to decide whether to roll back. Do NOT silently move on.

If postflight is **clean**, mention the snapshot path in the final
reply (one line) so the user knows where the rollback option lives:
> Pre-run snapshot at `$SNAPSHOT_DIR` (keep for ~24h before deleting).

---

## Step 4 — Inbox notification + optional memo

Append one summary notification to the library inbox (skip if
`--dry-run`):

```bash
. /tmp/merge-bibs-run.json.env && cd "$VIRGIL_LIBRARY_ROOT"
if [ "$DRY_RUN" != "1" ]; then
  now="$(python3 -c 'import time; print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))')"
  cat > /tmp/merge-bibs-notify.json <<EOF
{
  "kind": "authenticated",
  "at": "$now",
  "summary": "Library-wide bib merge: +<added_total> added, ~<dup> deferred, ⤬<trans> transient skipped, ?<manual> need review"
}
EOF
  python3 .virgil/scripts/library/append_inbox_item.py --item-file /tmp/merge-bibs-notify.json
  rm /tmp/merge-bibs-notify.json
fi
```

If `manual_review > 0`, write a library memo so the user can find the
items later. Skip the memo entirely otherwise.

```bash
# MANUAL_REVIEW / MANUAL_PAPERS / DRY_RUN_SEEN come from the file Step 3 wrote —
# don't hand-transcribe them into the env, that is how this branch silently
# died (unset MANUAL_REVIEW → `[: : integer expression expected`, rc 2).
# DRY_RUN + VIRGIL_LIBRARY_ROOT come from the run state the same way.
. /tmp/merge-bibs-run.json.env && cd "$VIRGIL_LIBRARY_ROOT"
. /tmp/merge-bibs-totals.env
if [ "${MANUAL_REVIEW:-0}" -gt 0 ] && [ "$DRY_RUN" != "1" ]; then
  date="$(date +%Y-%m-%d)"
  memo=".virgil/memos/${date}-bib-merge.md"
  mkdir -p .virgil/memos
  python3 - <<'PY' > "$memo"
import json, os
from pathlib import Path
library = Path(os.environ["VIRGIL_LIBRARY_ROOT"])
report_dir = Path(os.environ["MERGE_REPORT_DIR"])
print(f"# Library-wide bib merge — manual review")
print()
print(f"Generated {os.environ.get('RUN_AT','')}.")
print()
for ck in os.environ.get("MANUAL_PAPERS","").split():
    r = json.loads((report_dir / f"{ck}.json").read_text())
    items = r.get("manual_review", [])
    if not items:
        continue
    print(f"## {ck}")
    for it in items:
        kind = it.get("type", "")
        pe = it.get("paper_entry", "")
        me = it.get("master_entry", "")
        note = it.get("note", "") or it.get("auth_note", "")
        print(f"- **{kind}** — paper={pe} master={me}  \n  {note}")
    print()
PY
  echo "Wrote $memo"
fi
```

`MANUAL_PAPERS` arrives from the sourced file above; export `RUN_AT="<iso>"`
into the env yourself before the heredoc runs.

---

## Reply format

End with a single human-readable summary. Examples:

> Library-wide bib merge complete: 47 papers, 312 entries. +18 added
> (15 authenticated, 1 canonical, 2 unverified), ~291 deferred to
> master, ⤬3 skipped as transient, ?0 need review.

> Library-wide bib merge: nothing to do — every deep-indexed paper's
> report is current. Re-run with `--force` to remerge.

> Library-wide bib merge: 12 papers processed, 4 items need manual
> review (see `.virgil/memos/2026-05-17-bib-merge.md`): genette1997,
> davidson2024compositionality, beck2018analog, alikhani2019caption.

---

## Concurrency notes

The per-paper helper acquires `lock_master_bib`, `lock_catalog`, and
`lock_inbox` around its writes. These `fcntl.flock` locks serialize
writes **within a single Python process**, and they correctly
prevent the 2026-05-09 truncation incident (two unlocked writers
racing on `master.bib`).

What the locks do **not** protect against:

- **Cloud sync races.** A 2026-05-17 run with `--batch 5` inside a
  Dropbox-mounted library produced ~4000 "conflicted copy" files
  and silently truncated master.bib from 1975 entries to 886. Each
  atomic-rename in the merge helper triggers Dropbox to start an
  upload; the next write lands before that upload finishes; Dropbox
  treats the divergence as a conflict and spawns a copy. Even with
  a single local writer, rapid serial rewrites can produce
  conflicts. **The Step 0 preflight forces `--batch 1` and the
  postflight verifies no shrinkage to handle this.**
- **Other writers on the same library.** A second Claude session
  running `/library:index-pending`, an iterate-skill loop, or a
  stale `drain_queue.py` will happily clobber `master.bib`. **The
  Step 0 preflight refuses to start if any of these are detected.**
- **Cross-machine sync.** Other machines syncing the same Dropbox
  folder generate independent conflict copies through the cloud.
  The user has to pause those manually before running this skill;
  preflight cannot detect them.

If two subagents authenticate the same brand-new citekey in the
narrow window between the first's master.bib write and the second's
re-read, both will write the entry — the in-process lock guarantees
the file isn't corrupted, but the second write replaces the first's
fields. Wasted auth work, not a correctness problem. With
`--batch 1` (the default in synced libraries) this can't happen at
all.

If you need maximum throughput on a local (non-synced) library,
`--batch 5` is fine. For everything else, trust the preflight's
recommendation.

---

## What this skill does NOT do

- It does not migrate `master.bib` schemas, rename citekeys, or
  reflow existing entries — only adds and updates.
- It does not delete entries from `master.bib`. (Cross-paper
  deduplication that retires an existing citekey in favor of another
  is its own future operation.)
- It does not pre-merge entries across papers in memory. If two
  papers cite the same new work and are processed in parallel, the
  second-to-write sees the first's write as a duplicate (correct) or
  may briefly race (harmless — same lock, second-writer's fields
  win). To pre-merge across papers, lower `BATCH` or run with
  `--batch 1`.
- It does not re-run `/library/authenticate-bib` on duplicates that
  are already terminally-stated (`authenticated`, `canonical`,
  `manuscript`). Use `/library/authenticate-bib <citekey>` directly
  to retry one of those.
