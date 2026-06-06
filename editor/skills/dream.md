---
description: |
  Developer-only — the overnight "night" half of the dev-dream self-improvement
  loop (EDITOR_SKILLS_V1 §14; design MEMO_DEV_DREAM_DESIGN.md §4). Triggers ONLY
  in a DEV-mode session (VIRGIL_DEV=1): on "run the dream", "dream over the
  memos", "do the overnight pass", or on a schedule (/loop or a scheduled task).
  Reads the reflection memos the chip-17 capture layer accumulated since the
  last dream, detects cross-memo patterns, and ripples improvements back into
  the editor skill set via two scope-determined landing modes (acts-directly /
  proposes-via-worktree), with a flagged+fix-now fast-path, a morning digest,
  and THREE hard boundaries it cannot cross. NO-OP outside DEV mode. Does NOT
  trigger for end-user requests ("review my doc" → /editor/review) and never
  edits a paper file. Args: [<docPath>].
---

# /editor/dream $ARGUMENTS

The **night** half of the dev-dream loop. The day half — [`/editor/reflect`](reflect.md),
chip 17 — drops a tiered memo into `editor/dev/memos/` after every skill that
runs under DEV mode. This skill is the overnight pass that **consumes** those
memos: read everything since the last dream, find the cross-memo patterns, and
ripple fixes back into the skill set — landing safe single-skill polish
directly and proposing everything bigger for review, while **refusing** to
cross three load-bearing boundaries.

You are the loop driver. Two scripts do the deterministic work so you can spend
your judgment on the patterns and the edits:

- **[`dream.py`](../scripts/dream.py)** — `select` (find + group the memos
  since the last dream, reusing reflect.py's memo reader) and `digest` (write
  the morning summary + the marker the next dream reads). Gated on `VIRGIL_DEV`.
- **[`dream_land.py`](../scripts/dream_land.py)** — `classify_change` routes one
  proposed change → **acts** / **proposes** / **refused**, and **is** the
  three-boundary guard. Pure and dry-run-safe; you call it for *every* change
  before you make it.

Design: [MEMO_DEV_DREAM_DESIGN.md §4](../../MEMO_DEV_DREAM_DESIGN.md) · subsystem
SSOT: [editor/dev/README.md](../dev/README.md).

## When this runs

Only in **DEV mode** (`VIRGIL_DEV=1`). Both scripts no-op without it, so an
accidental invocation in a non-dev (or end-user) session writes nothing. The
dream is itself a Virgil skill, so it runs in DEV mode like everything else —
and it reflects on its **own** run (the bootstrap, step 7).

A real overnight dream runs **in a fresh git worktree off `main`** — its
acts-directly edits become commits on the dream branch, which the user merges in
the morning; its proposed changes get their own `dream/<date>` worktrees. You do
not need a live worktree to exercise the logic (the routing + the guard + the
digest are all script-driven), but a true scheduled run should branch first.

### Two ways to schedule it (document both; wire neither here)

1. **`/loop /editor/dream <docPath>`** on a long interval — simplest to start.
   The loop fires the dream every N hours; each run reads only the memos written
   since the previous digest, so back-to-back runs with no new memos are cheap
   no-ops.
2. **A scheduled task / cron** — the steady state. A nightly job runs
   `/editor/dream` once. Same skill, same since-last-dream selection; the only
   difference is the trigger. (See `mcp__scheduled-tasks__create_scheduled_task`
   / the `/schedule` skill for the mechanism — do not stand one up as part of
   this skill.)

## Args

```
/editor/dream                 # dream over the memos (docPath defaults to a sample paper)
/editor/dream <docPath>       # use <docPath> for paragraph-context lookups + the self-reflect
```

`<docPath>` is only needed so step 2 can ground a finding in the worked-on text
(`get_para_context.py`) and so step 7's self-reflection has a `virgil/` folder
to satisfy `reflect.py` — it is **not** the subject of the dream. Default it to
`samples/annotation-history` when the user names none.

## The flow

```
read ─► detect ─► route ─► act ─► digest ─► reflect-on-self
 §1      §2       §4/§5    §3+§4   §6         §7
```

### 1. Read the memos since the last dream

```bash
python3 editor/scripts/dream.py select
```

This gates on DEV, finds the previous digest's high-water `marker`, selects
every memo written **after** it (no prior digest → the bootstrap dream reads
all of them), and emits one JSON blob:

- `bootstrap` / `since` / `memoCount` / `marker` — the run's frame.
- `flagged` — the `flagged` memos, **read these first**; `fixNow` is the subset
  on the fast-path (step 3).
- `noted` — grouped by **skill → bucket** (a bucket that recurs across a skill's
  noted memos is a pattern).
- `unremarkableCount` — counted only, never read individually (most runs are
  noise; this keeps you from drowning).
- `lenses` — the result-filtered audits: `rejectionCorpus` (`result: rejected`),
  `silentEditAudit` (`result: silent-applied`), `refusalPatterns` (`result:
  refused`/`impossible`).
- `counts` — by tier / skill / result.
- `memos` — the full selected set (frontmatter + the non-empty buckets) for your
  own pattern detection.

### 2. Detect cross-memo patterns

This is the judgment the scripts can't do. Over the selected memos:

- **Flagged first.** Each `flagged` memo is a near-miss Don't-rule, an error, a
  low-confidence call, or a user `--tag`. Read its buckets; decide if it's a
  real fix or a one-off.
- **Group the `noted`.** A bucket that recurs for one skill (e.g. three
  `draft-suggestion` memos all flagging the same `alignment` mismatch) is a
  pattern worth a skill-prompt fix. A friction that appears across *several*
  skills (e.g. the same anchor-resolution ambiguity in footnote + citation +
  note) is a **cross-skill** pattern — which routes to *propose* (step 4).
- **Apply the lenses.** Walk `rejectionCorpus` (what did users turn down, and
  did the skill mis-read the ask?), `silentEditAudit` (did a silent L1 apply do
  the right thing unsupervised?), `refusalPatterns` (is a skill refusing things
  it should handle?).
- Ground anything unclear in the text: `python3 editor/scripts/get_para_context.py <docPath> <uuid>`
  with the memo's `paragraphIds`.

Turn each pattern into a concrete **proposed change** object:

```json
{ "summary": "tighten the anchor-lookup wording in draft-footnote",
  "paths": ["editor/skills/draft-footnote.md"],
  "intent": "tighten-wording",
  "oldText": "<the exact text you'd replace>",
  "newText": "<the replacement>",
  "memoRefs": ["2026-06-06/10-05-00-draft-footnote.md"] }
```

`intent` ∈ prose-polish `{tighten-wording, add-example, fix-typo,
expand-guidance, clarify}` (acts-eligible) **or** structural `{cross-skill,
script-change, manifest-change, rename, merge-skill, split-skill,
contract-change, new-helper, behavior-change}` (always proposes). Always supply
`oldText`/`newText` so the guard can adjudicate a boundary-sensitive change.

### 3. The fast-path (flagged + fix-now)

For each memo in `fixNow`: handle it **now**, in a narrow single-memo pass,
**acts-directly only**. Build its change object, classify it (step 4); if the
verdict is `acts`, apply it immediately and record it ACTED. If a fix-now memo's
change comes back `proposes` or `refused`, it does **not** get the fast lane —
it joins the batch (proposed) or is refused. The fast-path is for the small,
safe, obvious fix the maintainer explicitly flagged.

### 4. Route each change to a landing mode — BY SCOPE

**Never decide acts-vs-proposes by feel. Ask the guard:**

```bash
python3 editor/scripts/dream_land.py --change @change.json
# → { "mode": "acts" | "proposes" | "refused", "reason": "...", "boundary": "..." }
```

(Or `from dream_land import classify_change` if you're scripting the loop.)

- **`acts`** — a single skill-prompt `.md`, prose-polish intent, no
  behavior-contract token. **Apply it directly** (edit the skill markdown on the
  dream branch) and record it under `acted` for the digest. The user reverts via
  git if they disagree.
- **`proposes`** — anything cross-skill, any `.py` script, anything under
  `docs/workspace/` (the manifest), any rename/merge/split, or anything
  contract-adjacent. **Do not apply it on the dream branch.** Stage it in a
  worktree and record it under `proposed` with a `git merge dream/<date>` hint:

  ```bash
  DATE=$(python3 -c "import datetime;print(datetime.date.today())")   # or pin via the run
  git worktree add -b dream/$DATE ../virgil-dream-$DATE main
  # …make the change in ../virgil-dream-$DATE…, commit it there…
  ```

  The user reviews the diff and merges (or doesn't). One worktree per dream run
  is fine; group the run's proposals onto the one `dream/<date>` branch.
- **`refused`** — the change crosses a boundary (step 5). **Do not apply it and
  do not propose it.** Record it under `refused` with the `boundary` + `reason`.

### 5. The three boundaries (the guard refuses — by construction)

`classify_change` returns `refused` — and you must honor it, never working
around it — for any change that would:

1. **(B1) edit the architectural Don't-rules in `editor/AGENTS.md`** — the
   "`apply_response.py` is the only writeback path" / "no backend" rules. (The
   guard also refuses a change to the DEV-mode **reflection convention** that
   lives in the same file — undoing it would unwire capture.)
2. **(B2) change the `apply_response.py` contract shape** — its subcommands, the
   `RESULT_*`/`STATUS_*` vocabulary, or the op-json schema (`texEdit`/`bibEdit`/
   `renameCitekey`/`settingsEdit`/`annotationEdit`).
3. **(B3) disable DEV mode itself** — the `VIRGIL_DEV` gate /
   `_common.dev_mode_enabled` or its enforcement in `reflect.py`/`dream.py`.

These are the load-bearing invariants the loop runs *inside*. A pattern that
seems to call for crossing one is a signal to surface to the human in the
digest, **not** to act on. The guard enforces this from the change's content (a
boundary-file edit with no content to adjudicate is refused), so it cannot be
sidestepped by leaving the intent vague.

### 6. Write the digest

Always — even on a no-op night. Hand the script your qualitative entries; it
re-derives the deterministic facts (memo count, counts, the next marker) so they
can't drift:

```bash
python3 editor/scripts/dream.py digest --report @report.json
```

`report.json`:

```json
{ "acted":    [ { "summary": "...", "paths": ["editor/skills/x.md"], "memoRefs": ["..."] } ],
  "proposed": [ { "summary": "...", "paths": ["editor/scripts/y.py"], "branch": "dream/2026-06-06",
                  "reason": "touches a .py script", "memoRefs": ["..."] } ],
  "refused":  [ { "summary": "...", "boundary": "B1:agents-dont-rules", "reason": "...", "memoRefs": ["..."] } ],
  "bootstrap": "<one line on how this dream went — feeds step 7>" }
```

It writes `editor/dev/dream-digests/<YYYY-MM-DD>.md` (gitignored, the sibling of
`memos/`), recording ACTED + PROPOSED + REFUSED, the counts by tier/skill/lens,
and the `marker` the next dream reads.

### 7. Reflect on this dream (bootstrap / recursion)

The dream is a Virgil skill, so it reflects on itself like any other —
**after** the digest, so the memo lands past this run's marker and the **next**
dream reads it:

```bash
python3 editor/scripts/reflect.py <docPath> dream - \
  --memo-json '{"buckets":{...how the dream itself went: bad groupings, a
  pattern you were unsure about, a routing call that felt wrong...},
  "confidence":"low"}'
```

Be honest and unsparing — "the first dreams will be the worst," and the only way
the dream improves at dreaming is by reading its past self-critiques. A
`skill=dream` memo is read first by the next dream (it's your own track record).

## Relationship to `/editor/iterate-virgil-editor` (and the chip-19 unification)

`iterate` is the **manual, synthesized-input, single-skill, synchronous**
precursor: it injects test cases, runs a skill in a sandbox, reads a `[block]`/
`[nice-to-have]` critique, and edits the skill markdown in a tight loop. `dream`
is its **ambient, real-input, cross-skill, batch** generalization — same
read-a-critique → edit-skill spine, but over passively-captured real memos.

As of **chip 19** the two are **one engine**, sharing exactly the
**genuinely-common** seams: the memo reader (`reflect._parse_memo`), the
critique-memo shape, and this skill's landing-mode helper + boundary guard
(`dream_land.py`). `iterate` routes its skill edits through `dream_land` via
[`dev_loop.py`](../scripts/dev_loop.py) (the shared read→derive→route spine) and
writes its critique in the same unified memo shape — `iterations/` and `memos/`
are now two *labeled* streams of one shape, not two shapes.

**The one thing that stays `dream`-specific is this skill's autonomy layer.**
`dream` runs unattended, so its `proposes` verdict stages a change in a
`dream/<date>` worktree. `iterate` runs synchronously, so it adopts `dream_land`
as a **boundary guard only** — honoring `refused`, surfacing `proposes` for
scrutiny, and landing non-refused edits inline. iterate did **not** inherit
acts-on-branch / propose-via-worktree; that machinery is `dream`'s alone. See
[editor/dev/README.md](../dev/README.md).

## Hard rules

- **DEV mode only.** Both scripts no-op without `VIRGIL_DEV=1`. Never hand-write
  a memo or digest to dodge the gate.
- **The guard is law.** Route *every* change through `dream_land.classify_change`
  and honor the verdict. Never apply a `proposes`/`refused` change on the dream
  branch; never work around a `refused`.
- **Never edit a paper file.** The dream rewrites Virgil's *skill set*
  (`editor/skills/`, and via *propose* the scripts/manifest) — never a user's
  `.tex`/`.bib`/sidecar. It needs no pen and no `apply_response` contract.
- **The digest is the only durable output you author.** Acts-directly edits are
  git-revertable; proposed changes live on their worktree branch; refusals are
  recorded, not acted. Always write the digest.
- **One seam, not a fork.** Reuse `reflect._parse_memo` and `dream_land` — do not
  write a second memo parser or a parallel routing rule.

## Reply format

Echo `dream.py digest`'s one-line `Done:` reply (counts + digest path), then a
≤5-line summary: the memo count + tier split, what you ACTED on, what you
PROPOSED (with the `git merge dream/<date>` hint), and any REFUSED items with
their boundary. If DEV mode is off, say so in one line and stop.
