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

# /merge-bibs $ARGUMENTS

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
  `catalog.json`, or `inbox.json`.

Parse the args yourself in shell. Track whether `--batch` was given
explicitly (so preflight can supply the default if not):

```
BATCH_EXPLICIT=0  # set to 1 if user passed --batch
BATCH=""          # final value, set after preflight
FILTER=""
FORCE=0
DRY_RUN=0
ALLOW_PARALLEL_SYNC=0
```

---

## Step 0 — Preflight (snapshot + safety checks)

This step prevents a recurrence of the 2026-05-17 Dropbox conflict
explosion. It snapshots the critical state files to a location
**outside** any sync folder, detects whether the library is sync-
mounted, and refuses to start if another writer is mutating the
library. **Always run this step.**

```bash
preflight_json="$(python3 .virgil/scripts/library/merge_bibs_preflight.py 2>&1)"
preflight_rc=$?
if [ $preflight_rc -ne 0 ]; then
  echo "preflight failed (rc=$preflight_rc):"
  echo "$preflight_json"
  exit 1
fi
echo "$preflight_json" > /tmp/merge-bibs-preflight.json
```

Parse the JSON and apply the policy:

```bash
python3 - <<'PY'
import json, os, sys
pf = json.load(open("/tmp/merge-bibs-preflight.json"))
# Surface a short status line for the user.
print(f"Snapshot:       {pf['snapshot_dir']}")
print(f"Sync mounted:   {pf['sync_mounted']} ({pf['sync_kind'] or 'n/a'})")
print(f"Recommended batch: {pf['recommended_batch']}")
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

Now decide whether to bail:

- **If `any_writers` is `true`**: print the offending pids/files and
  bail with this message (do not proceed):
  > Library-wide bib merge refused: other writers are touching this
  > library. Pause `/library:index-pending`, kill stale
  > `merge_paper_references.py` / `drain_queue.py` processes, and
  > clear stale `.virgil/queue/*.lock` files. The preflight snapshot
  > at `<snapshot_dir>` is safe.

- **If `sync_mounted` is `true` and the user passed `--batch N` with
  `N > 1` without `--allow-parallel-sync`**: bail with:
  > Library-wide bib merge refused: this is a `<sync_kind>` library
  > and you asked for `--batch <N>`. Parallel writes inside synced
  > folders caused a ~4000-conflict-file explosion on 2026-05-17.
  > Re-run with `--batch 1`, or re-run with
  > `--batch <N> --allow-parallel-sync` if you've paused sync at the
  > OS level first.

- **If `sync_mounted` is `true` and the user did not pass `--batch`**:
  set `BATCH=1` (the safe default for synced libraries) and inform
  the user with a one-liner: *"Sync-mounted library detected;
  defaulting to --batch 1. Estimated runtime ~2 min/paper."*

- **Otherwise**: set `BATCH=$preflight_recommended_batch` if the user
  didn't pass `--batch`, or `BATCH=$user_provided_batch` if they did.

- Always: stash the snapshot path in an env var for postflight.

```bash
SNAPSHOT_DIR="$(python3 -c 'import json; print(json.load(open("/tmp/merge-bibs-preflight.json"))["snapshot_dir"])')"
export SNAPSHOT_DIR
```

If you bail in this step, the snapshot has still been taken — surface
its path to the user as something they can roll back to if anything
else has gone wrong.

---

## Step 1 — Build the worklist

Print the list of citekeys to process. Filter to deep-indexed papers,
honor `--filter`, and (unless `--force`) skip papers whose merge report
is newer than their `references.bib`.

```bash
python3 - <<'PY'
import fnmatch, json, os, sys
from pathlib import Path
library = Path(os.environ["VIRGIL_LIBRARY_ROOT"])
FILTER = os.environ.get("MERGE_FILTER") or ""
FORCE  = os.environ.get("MERGE_FORCE") == "1"

cat = json.loads((library / ".virgil" / "catalog.json").read_text())
# `richIndexed` is the legacy spelling kept on read; new writes use `deepIndexed`.
DEEP_STATES = {"deepIndexed", "richIndexed"}
report_dir = library / ".virgil" / "merge-reports"

todo: list[str] = []
skipped_uptodate = 0
for e in cat.get("entries", []):
    ck = e.get("citekey", "")
    if not ck:
        continue
    if (e.get("indexed") or {}).get("state") not in DEEP_STATES:
        continue
    if FILTER and not fnmatch.fnmatch(ck, FILTER):
        continue
    refs = library / "papers" / ck / "references.bib"
    if not refs.exists():
        continue
    if not FORCE:
        rpt = report_dir / f"{ck}.json"
        if rpt.exists() and rpt.stat().st_mtime >= refs.stat().st_mtime:
            skipped_uptodate += 1
            continue
    todo.append(ck)

(library / ".virgil" / "merge-reports").mkdir(parents=True, exist_ok=True)
worklist = library / ".virgil" / "merge-reports" / "_worklist.txt"
worklist.write_text("\n".join(todo) + ("\n" if todo else ""))

print(f"worklist={len(todo)} skipped_uptodate={skipped_uptodate}")
print(f"worklist_file={worklist}")
PY
```

Set shell env vars before running so the Python block sees them:
`MERGE_FILTER`, `MERGE_FORCE`, etc.

If the worklist is empty, print a one-line summary and stop:
```
Library-wide bib merge: nothing to do (0 papers in worklist).
```

---

## Step 2 — Spawn batched subagents

Read `<library>/.virgil/merge-reports/_worklist.txt` into memory. Walk
it in chunks of `BATCH`. **For each chunk, emit `BATCH` `Agent` tool
calls in a single message.** That's how the Claude Code harness
runs them concurrently — sequential `Agent` calls run one at a time.

Wait for all subagents in the chunk to return before moving to the
next chunk. Echo each subagent's one-line reply as it lands so the
user sees progress.

**Per-subagent prompt template** (paste verbatim, substituting
`<library_root>`, `<citekey>`, and `<dry_run_flag>`):

> You are merging one Virgil Library paper's `references.bib` into the
> library's `master.bib`. Library root: `<library_root>`. Paper
> citekey: `<citekey>`.
>
> Steps:
> 1. `cd <library_root>`
> 2. Confirm `papers/<citekey>/references.bib` exists. If it doesn't,
>    write the stub `{"citekey":"<citekey>","status":"no-references"}`
>    to `.virgil/merge-reports/<citekey>.json` and reply
>    `Done: <citekey> (no-references)`; do not continue.
> 3. Run the merge:
>    ```
>    python3 .virgil/scripts/library/merge_paper_references.py <citekey> <dry_run_flag>
>    ```
>    The script does the dedup → authenticate → transient-skip work
>    and writes `.virgil/merge-reports/<citekey>.json`. It also writes
>    a one-line summary to stdout (`+A ~D ⤬T ⚠F ?M`).
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

`<dry_run_flag>` is `--dry-run` if the orchestrator was invoked with
`--dry-run`, otherwise the empty string.

After each chunk completes, optionally print a one-line progress
indicator so the user knows how far the run has progressed:
`Wave <i>/<total_waves> complete (<n_papers>/<total>).`

---

## Step 3 — Aggregate

Once every chunk finishes, read every per-paper report and produce a
single library-wide summary.

```bash
python3 - <<'PY'
import json, os, sys
from pathlib import Path
library = Path(os.environ["VIRGIL_LIBRARY_ROOT"])
report_dir = library / ".virgil" / "merge-reports"
worklist_file = report_dir / "_worklist.txt"
citekeys = [ck for ck in (worklist_file.read_text().splitlines() if worklist_file.exists() else []) if ck]

totals = {
    "papers": 0, "entries": 0,
    "added_auth": 0, "added_canonical": 0, "added_unverified": 0, "added_failed": 0,
    "deferred_dup": 0, "skipped_transient": 0,
    "auth_failed": 0, "manual_review": 0,
    "unauth_dup_merged": 0, "unauth_dup_split": 0,
}
manual_papers: list[str] = []
for ck in citekeys:
    rpt_path = report_dir / f"{ck}.json"
    if not rpt_path.exists():
        continue
    r = json.loads(rpt_path.read_text())
    totals["papers"] += 1
    totals["entries"] += r.get("entries_total", 0)
    for row in r.get("added", []):
        state = row.get("state", "")
        if state == "authenticated":
            totals["added_auth"] += 1
        elif state == "canonical":
            totals["added_canonical"] += 1
        elif state == "unverified":
            totals["added_unverified"] += 1
        elif state == "failed":
            totals["added_failed"] += 1
    totals["deferred_dup"] += len(r.get("deferred_dup", []))
    totals["skipped_transient"] += len(r.get("skipped_transient", []))
    totals["auth_failed"] += len(r.get("auth_failed", []))
    for row in r.get("unauth_dup_handled", []):
        if row.get("action") == "merged":
            totals["unauth_dup_merged"] += 1
        elif row.get("action") == "split":
            totals["unauth_dup_split"] += 1
    n_manual = len(r.get("manual_review", []))
    totals["manual_review"] += n_manual
    if n_manual:
        manual_papers.append(ck)

print(json.dumps({"totals": totals, "manual_papers": manual_papers}, indent=2))
PY
```

Print the summary table in the orchestrator's reply (≤10 lines):

```
Library-wide bib merge complete
───────────────────────────────
Papers processed:                  <papers>
Entries seen:                      <entries>
+ Added (authenticated):           <added_auth>
+ Added (canonical):               <added_canonical>
+ Added (unverified/failed):       <added_unverified + added_failed>
⇄ Unauth-dup → merged into master: <unauth_dup_merged>
⇄ Unauth-dup → split (both kept):  <unauth_dup_split>
~ Deferred — dup of terminal master: <deferred_dup>
⤬ Skipped — transient:             <skipped_transient>
? Manual review pending:           <manual_review>  in <list-of-citekeys-or-"none">
```

---

## Step 3.5 — Postflight verification

Compare the post-run library state against the preflight snapshot.
The merge helper's contract is "only add, never delete" — any
shrinkage in `master.bib`, `catalog.json`'s entry count, or any
`indexed.state` distribution means a sync race ate writes and the
user needs to roll back.

```bash
postflight_json="$(python3 .virgil/scripts/library/merge_bibs_postflight.py \
  --snapshot-dir "$SNAPSHOT_DIR")"
echo "$postflight_json" > /tmp/merge-bibs-postflight.json
```

Inspect the result:

```bash
python3 - <<'PY'
import json
p = json.load(open("/tmp/merge-bibs-postflight.json"))
if p.get("clean"):
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

If `manual_review > 0`, write a dev memo so the user can find the
items later. Skip the memo entirely otherwise.

```bash
if [ "$MANUAL_REVIEW" -gt 0 ] && [ "$DRY_RUN" != "1" ]; then
  date="$(date +%Y-%m-%d)"
  memo=".virgil/memos/${date}-bib-merge.md"
  mkdir -p .virgil/memos
  python3 - <<'PY' > "$memo"
import json, os
from pathlib import Path
library = Path(os.environ["VIRGIL_LIBRARY_ROOT"])
report_dir = library / ".virgil" / "merge-reports"
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

Pass `MANUAL_PAPERS="<space-separated-citekeys>"` and `RUN_AT="<iso>"`
into the env first.

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
