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

<!-- CENTRAL DESIGN PRINCIPLE — read first, honor on every skill edit this pass.
     Verbatim from editor/skills/_dev-loop-principle.md (SSOT). The editor bundle
     does not transclude, so this is inlined; the drift guard
     editor/skills/__tests__/dev-loop-principle.test.ts keeps it in sync — edit
     the SSOT, not this copy. -->
> **(CENTRAL DESIGN PRINCIPLE)** I want unified, deep, architectural solutions that capture a range of related phenomena--- avoid superficial, surgical patches.  Whenever reasonable, consider the deepest possible solution to the problem that will also improve the app.

Every fix this pass ripples into the skill set: prefer the **deepest unified
change that retires the whole pattern class**, not a surgical per-skill patch —
*within* the scope guard, the acts-vs-proposes routing, and the three hard
boundaries below (they are never weakened by this principle).

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
and it reflects on its **own** run (the bootstrap, step 8).

A real overnight dream runs **in a fresh git worktree off `main`** — its
acts-directly edits become commits on the dream branch; a branch whose gates
come back green merges to `main` at the end of the run (step 6) and ships with
the next nightly update. You do not need a live worktree to exercise the logic
(the routing + the guard + the digest are all script-driven), but a true
scheduled run should branch first.

### How it is scheduled (wired)

Two Claude scheduled tasks drive the loop, both cwd'd at the repo:
`editor-skill-base-dream` (cron `0 22 * * *`) runs `/editor/dream` nightly, and
`virgil-update` (cron `0 0 * * *`) runs `/cleanup-virgil` — merge sweep, version
bump, push, GitHub Pages deploy — a couple of hours later. The dream lands
before the update sweeps, so a green night is LIVE (deployed, and re-synced into
paper folders on their next doc-open or `sync_skills.py` run) the following day
with no human step. `/loop /editor/dream` on an interval remains a supported
manual mode — same since-last-digest selection, and a same-day re-run rotates
the prior digest rather than erasing it.

## Args

```
/editor/dream                 # dream over the memos (docPath defaults to a sample paper)
/editor/dream <docPath>       # use <docPath> for paragraph-context lookups + the self-reflect
```

`<docPath>` is only needed so step 2 can ground a finding in the worked-on text
(`get_para_context.py`) and so step 8's self-reflection has a `virgil/` folder
to satisfy `reflect.py` — it is **not** the subject of the dream. Default it to
`samples/annotation-history` when the user names none.

## The flow

```
sync ─► read ─► detect ─► route ─► act ─► land ─► digest ─► reflect-on-self
 §0      §1      §2       §4/§5    §3+§4   §6      §7         §8
```

### 0. Reconcile with existing dream work FIRST

Before you author anything, reconcile with what is already in flight on this
shared checkout — the human drives it live and prior dream runs leave work here.
This was hard-won lore across several nights; it is now an explicit step.

- **Check-first, don't fork.** Run `git worktree list` and `git branch --list 'dream/*'`. If a `dream/<date>` branch/worktree already holds the complementary half of what you were about to do, **compose onto it** rather than opening a competing branch — two dream branches editing the same script produce merge conflicts and split provenance.
- **Composing onto a prior branch inherits its BASE — refresh it before you reason.** §4 branches a fresh dream off `main`, so it reads current code; the bullet above composes onto a *prior* dream branch, whose base is whatever `main` was on that earlier night — and nothing ever advances it, so a stack's staleness compounds one night per night. (Measured 2026-08-11: the 08-03 → 08-09 → 08-10 stack sat **227 commits** behind `main`, eight days out.) The visible cost is merge risk, which git will at least tell you about. The dangerous one is silent: the dream **justifies** a change by reading code `main` has already moved — on 2026-08-10 that nearly shipped a regex pinned to a builder constant `main` had already reshaped, caught only because that run happened to add a canary. So before authoring on an inherited branch, merge `main` into it and re-run the editor suite; then read every premise — every constant, signature and call site your reasoning leans on — from the refreshed tree, never from the inherited one. If the merge conflicts, that *is* the night's finding: surface it in the digest and stop, rather than resolving another run's work blind.
- **Preserve provenance of a prior run's uncommitted change.** If the existing dream worktree has an *uncommitted* change from an earlier run (a finished, dream-voiced proposal left in the working tree), commit **that** as its own commit first — attributing it to the run that authored it — *then* stack your own change on top. Never fold another run's work into your commit; it conflates authorship on a shared checkout. The committed branch keeps its original `dream/<prior-date>` name, so tonight's digest points its `git merge dream/<prior-date>` hint at an *earlier* date than the digest itself — that date skew is correct, not staleness: a finished proposal's rightful home is the branch that authored it, and a prior-date `dream/*` branch carrying its own completed work should never be read as orphaned.
- **Never rebuild the skill bundle unattended** (`npm run build:skill-bundles`) — it mutates the live checkout's mirrors mid-session. This now costs the loop nothing: the nightly deploy regenerates the served bundle from source (CI's `prebuild`), the repo-local mirrors regenerate on the next `predev`/`prebuild`, and the freshness guard ([skill-bundle-freshness.test.ts](../skills/__tests__/skill-bundle-freshness.test.ts)) catches a stale mirror. The old standing "ruling owed to the human" on this is retired — nothing is lost by not rebuilding.

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

**Preflight — are you running the current prompt?** This skill is *distributed*:
the copy that actually runs is a built artifact — the skill BUNDLE that
skill-sync writes into a paper's `.virgil/`, mirrored for dev convenience under
`.claude/commands/editor/` — regenerated only by `npm run build:skill-bundles`
(`predev`/`prebuild`). So a skill edit — including one a past dream authored and
landed — is **not live until the bundle is rebuilt**, and the gap is invisible
from inside the prompt.

`select` already computed it for you: read its **`drift`** field, a list of repo
paths whose source differs from the bytes the bundle shipped. Don't re-derive it
in the shell — `select` runs from source rather than from the served text, so
it is immune to the very drift it reports, and it asks the **bundle's own
manifest**, which covers every carrier: the command markdowns, the `_`-prefixed
shared includes, and the `.py`/`.json` helpers the skills invoke. A check keyed
on the `.claude/commands/` mirror instead sees only non-underscore markdown and
reports green for the rest — on 2026-08-10 that hid a stale `create_card.py`
sitting behind seven stale skills from the same commit.

**An empty `drift` is only an answer when `driftChecked` is true.** `[]` also
means *"I could not look,"* byte-identical to `[]` meaning *"in sync."* Read
`driftChecked` / `driftReason` (`unbuilt-bundle`, `no-source-repo`,
`unparseable-rewrite-table`, `unreadable-manifest`), never the list alone — the
same rule `selfReferentialOnly` follows: the script computes the condition, you
read the flag. If it could not run, say so in the digest rather than reporting a
green preflight you never performed.

The reachable case is **config-dependent**, so it works on the dev box and goes
quiet exactly where the environment is thinner. The check needs a BUILT bundle
and `public/skill-bundle/` is gitignored, so no fresh `git worktree add` carries
one; whether that matters turns on `VIRGIL_REPO_ROOT`, which `source_repo_root()`
prefers before walking up from the script. With the pin set (this machine's
`~/.zshenv`) a worktree run resolves to the PRIMARY checkout and checks its
bundle correctly; with it absent — a clean-env cron, another machine, a synced
paper copy — the walk lands on the bundle-less tree and answers `[]` to
everything. Prefer running the preflight from the primary checkout anyway.

If anything drifted — **that is the night's top finding**, ahead of anything in
the memos. Record it in the digest with the rebuild command. Then **read the
SSOT (`editor/skills/…`), not your own served text, for the rest of the run**:
the fixes the memos seem to call for may already exist upstream, and proposing
them again re-authors work that already landed. Treat memos written under a
drifted prompt as evidence about the *stale* version — `skillSha` records the
SSOT blob at HEAD, so it silently attests to a version that may never have run.

**But date the drift before you discount anything.** Drift means the SSOT and
the served copy disagree *now*; it says nothing about when they started to. If
the SSOT edit is NEWER than the memos — someone edited a skill this evening,
after the day's runs — those memos were written under the version that was
served at the time, and they are honest evidence about it. Compare the SSOT
file's mtime against the memo timestamps before deciding which side of the gap
a memo sits on; discounting a whole night's evidence for a drift that opened
after it was recorded throws away the only real signal the run has. Both
readings still end at the same digest entry — the bundle is stale and a human
must rule on the rebuild — so the cost of confusing them is paid entirely in
the *detection* step, which is the one that cannot be redone later.

### 2. Detect cross-memo patterns

This is the judgment the scripts can't do. Over the selected memos:

- **Flagged first.** Each `flagged` memo is a near-miss Don't-rule, an error, a
  low-confidence call, or a user `--tag`. Read its buckets; decide if it's a
  real fix or a one-off.
- **Date the premise, not just the evidence.** A memo is a *dated observation*,
  and the code moves between the run that wrote it and the dream that reads it —
  so a memo's observation can be accurate while its proposed FIX has already
  gone stale. Before acting on any recommendation, re-verify the premise it
  rests on against the CURRENT tree: read the constant, run the function, check
  `git log` on the files the premise names against the memo's `reflectedAt`.
  Read the mechanism; never reason forward from the memo's own account of it.
  This is step 1's *"date the drift before you discount anything"* generalized —
  the same rule, applied there to a memo's evidence and here to its
  recommendation. When a premise HAS gone stale, record that as the finding and
  move on: re-authoring a fix `main` already carries is the costliest way to
  spend a night, and baking a dead premise into a prompt is permanent.
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

Turn each pattern into a concrete **proposed change** object. Honor the CENTRAL
DESIGN PRINCIPLE at this exact step: reach for the **deepest unified fix that
retires the whole pattern class** (the shared fork behind the cluster, the one
SSOT the scattered wording should collapse to) rather than a surgical
one-memo/one-skill patch — while still routing it through the scope guard and
the three boundaries below, which the principle never overrides. (Refinement:
"deep" ≠ "broadest blast radius"; match the fix to the pattern's *true* scope.)

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
  # Key the branch off select's canonical UTC dreamDate — the SAME clock
  # dream.py digest uses — so branch/digest never split across two dates.
  # (Never local date.today(): at night in a US timezone it lands a day behind
  #  the UTC digest, forking dream/<D> from the <D+1>.md digest.)
  DATE=$(python3 editor/scripts/dream.py select | python3 -c "import sys,json;print(json.load(sys.stdin)['dreamDate'])")
  # INSIDE the repo (.claude/worktrees/, gitignored) — not a sibling dir — so
  # node module resolution walks up to the repo's node_modules and step 6's
  # gates (tsc/vitest) can actually run in the worktree.
  git worktree add -b dream/$DATE .claude/worktrees/dream-$DATE main
  # …make the change in .claude/worktrees/dream-$DATE…, commit it there…
  ```

  One worktree per dream run is fine; group the run's proposals onto the one
  `dream/<date>` branch. Step 6 then lands it when its gates are green; the
  `git merge dream/<date>` hint in the digest covers only a PARKED branch.
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

### 6. Land the night's work — green merges, red files a task

The loop's learning goes live through the ordinary daily update (the nightly
`virgil-update` task runs `/cleanup-virgil`: merge sweep, push, deploy), so a
branch merged to `main` tonight ships tomorrow with no human step. The merge
gate is **green, not human review** — Gabriel's standing ruling (2026-08-15):
*"no cap, go with green."* Key decisions still reach him, through the task
pipeline (below), never through the digest alone.

For **every** `dream/<date>` branch present after steps 3–5 (tonight's and any
inherited branch you composed onto):

1. **Run the gates in the worktree** (`.claude/worktrees/dream-<date>`):
   `npx tsc --noEmit` · `npx vitest run` · every
   `editor/scripts/tests/test_*.py`. All three families, no shortcuts.
2. **All green AND the primary checkout is clean on `main`**
   (`git -C /Users/gabriel/Programming/virgil status --porcelain` empty of
   tracked changes, `branch --show-current` = `main`) → **land-and-clean**, the
   task worker's own discipline (`~/virgil-tasks/PROFILE.md`):
   `git -C /Users/gabriel/Programming/virgil merge --no-ff dream/<date>`, remove
   the worktree, delete the branch. Record **LANDED** in the digest entry.
3. **Green but the primary tree is dirty** (the human mid-edit) → leave the
   branch and worktree standing; the nightly sweep merges green work. Record
   **PARKED** with the `git merge dream/<date>` hint.
4. **Any gate red** → the branch must **not** survive the run: the nightly
   sweep (`/cleanup-worktrees`) merges *every* surviving branch blindly, so a
   red branch left standing ships anyway. Export the diff
   (`git diff main...dream/<date>` →
   `~/virgil-tasks/attachments/<UTC-date>-dream-<slug>.patch`), file an
   UNMINTED work task into `~/virgil-tasks/inbox/` naming the patch, the
   failing gate and its output tail — then remove the worktree AND delete the
   branch. Record **FILED**.

**Never self-merge — route to the human instead** (the "key decisions" half of
the autonomy ruling):

- a proposal touching the loop's own operating procedure (`DEV_LOOP_SKILLS`:
  `dream.md` / `reflect.md` / `iterate-virgil-editor.md`) stays staged whatever
  its gates say, and gets a DECISION task;
- every `refused` verdict that names a ruling owed gets a DECISION task too —
  digests are write-only, the task queue is what the human actually reviews.

**Filing conventions** (`~/virgil-tasks`; the catcher is the ONLY id-minter):
drop an unminted file `inbox/<UTC-date>-from-dream-<slug>.md` — never mint an
id (a non-catcher mint has already collided with a live catcher session once;
unminted inbox drops are the worker's own precedent). A DECISION item leads
with `## Questions`, a **bold recommendation**, and the sentence *"I cannot
just take my own recommendation here because ___"* (the auditor's routing-test
discipline), and notes `source: dream` in the body. A red-gate WORK item
carries `## Description` / `## Done when` / `## Design` / `## Verify`, the
patch path, and the gate output tail.

### 7. Write the digest

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
  "bootstrap": "<one line on how this dream went — feeds step 8>" }
```

It writes `editor/dev/dream-digests/<YYYY-MM-DD>.md` (gitignored, the sibling of
`memos/`), recording ACTED + PROPOSED + REFUSED, the counts by tier/skill/lens,
and the `marker` the next dream reads. Note each proposed entry's landing
outcome from step 6 — **LANDED / PARKED / FILED** — at the head of its
`summary`, so the digest reads as what actually happened, not what was staged.

### 8. Reflect on this dream (bootstrap / recursion)

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

**Recursion guard — skip step 8 on a no-signal no-op.** `select` emits
`selfReferentialOnly: true` whenever **no** memo since the last dream came from a
real skill run (`nonDreamMemoCount == 0`) — that covers a window holding only the
dream's OWN prior self-reflections *and* an **empty** window, which is the
strongest no-signal case, not an exemption. (Read the flag; never re-derive the
condition by eye from `memoCount`. The empty window is precisely where a
by-eye reading goes wrong, and doing so re-opens the two-night oscillator:
suppress on the self-memo night → empty window next night → write a fresh
contentless memo → suppress again → …) When that flag is
true **and** this run acted/proposed/refused **nothing** (a pure no-op), do
**not** write a step-8 memo — a self-reflection with no real skill signal to
reflect on is exactly what perpetuates the infinite self-referential recursion
(dream reads its own note → no-ops → writes another note → …). Still write the
digest (step 7, always) and flag the cadence in its `bootstrap` line so the next
dream reads zero new memos until a **real** skill runs. Reflect normally
whenever the run did real work (acted/proposed/refused > 0) — even in a
self-referential window — since then there is something worth recording.

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
PROPOSED and its landing outcome (LANDED / PARKED with the `git merge
dream/<date>` hint / FILED with the task filename), any REFUSED items with
their boundary, and any DECISION tasks filed. If DEV mode is off, say so in one
line and stop.
