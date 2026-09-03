---
description: |
  Developer-only — the overnight "night" half of the dev-dream self-improvement
  loop (EDITOR_SKILLS_V1 §14; design MEMO_DEV_DREAM_DESIGN.md §4). Triggers ONLY
  in a DEV-mode session (VIRGIL_DEV=1): on "run the dream", "dream over the
  memos", "do the overnight pass", or on a schedule (/loop or a scheduled task).
  Reads the reflection memos the chip-17 capture layer accumulated since the
  last dream, detects cross-memo patterns, and FILES each finding as a task in
  ~/virgil-tasks/ — the worker lands it, the catcher surfaces anything needing
  a ruling. The dream is a DETECTOR: it writes no code, opens no branch and
  merges nothing (task 522). Flagged+fix-now fast-path, a nightly gate sweep, a
  morning digest, and THREE hard boundaries it cannot cross. NO-OP outside DEV
  mode. Does NOT trigger for end-user requests ("review my doc" →
  /editor/review) and never edits a paper file. Args: [<docPath>].
---

# /editor/dream $ARGUMENTS

<!-- CENTRAL DESIGN PRINCIPLE — read first, honor on every skill edit this pass.
     Verbatim from editor/skills/_dev-loop-principle.md (SSOT). The editor bundle
     does not transclude, so the sentence AND its refinements are inlined here;
     the drift guard editor/skills/__tests__/dev-loop-principle.test.ts keeps
     every one of them in sync byte-for-byte — edit the SSOT, not this copy. -->
> **(CENTRAL DESIGN PRINCIPLE)** I want unified, deep, architectural solutions that capture a range of related phenomena--- avoid superficial, surgical patches.  Whenever reasonable, consider the deepest possible solution to the problem that will also improve the app.

Refinement (learned): "deep" ≠ "broadest blast radius." Match the fix to
the *true* scope of the phenomenon; verify a phenomenon is actually
general before generalizing the fix.

Refinement (Gabriel, 2026-08-31): a QUEUE collision is a queue fact, never
a scope fact — what happens to be queued alongside must not shrink a fix.
Remove a collision **by construction** (relocate the hunk to a seam the
other change doesn't touch); where that is genuinely impossible, the
impossibility is itself a finding to route — never a reason to go shallow.

Every finding you FILE carries this principle into the task you write: propose
the **deepest unified change that retires the whole pattern class**, not a
surgical per-skill patch — *within* the scope guard, the queue routing, and the
three hard boundaries below (they are never weakened by this principle).

The **night** half of the dev-dream loop. The day half — [`/editor/reflect`](reflect.md),
chip 17 — drops a tiered memo into `editor/dev/memos/` after every skill that
runs under DEV mode. This skill is the overnight pass that **consumes** those
memos: read everything since the last dream, find the cross-memo patterns, and
**file each one as a task** — ready work for the task worker, or a question for
Gabriel — while **refusing** to cross three load-bearing boundaries. You write
no code and you land nothing (task 522).

You are the loop driver. Two scripts do the deterministic work so you can spend
your judgment on the patterns and on writing tasks worth working:

- **[`dream.py`](../scripts/dream.py)** — `select` (find + group the memos
  since the last dream, reusing reflect.py's memo reader), `file-task` (mint a
  task into `~/virgil-tasks/` under the three-minter collision protocol), and
  `digest` (write the morning summary + the marker the next dream reads). Gated
  on `VIRGIL_DEV`.
- **[`dream_land.py`](../scripts/dream_land.py)** — `task_route` answers WHICH
  QUEUE a finding goes in, over `classify_change`'s **acts** / **proposes** /
  **refused** verdict, and **is** the three-boundary guard. Pure and
  dry-run-safe; you ask it for *every* finding before you file it.

Design: [MEMO_DEV_DREAM_DESIGN.md §4](../../MEMO_DEV_DREAM_DESIGN.md) · subsystem
SSOT: [editor/dev/README.md](../dev/README.md).

## When this runs

Only in **DEV mode** (`VIRGIL_DEV=1`). Both scripts no-op without it, so an
accidental invocation in a non-dev (or end-user) session writes nothing. The
dream is itself a Virgil skill, so it runs in DEV mode like everything else —
and it reflects on its **own** run (the bootstrap, step 8).

**The dream lands nothing** (task 522). It reads, it detects, and it FILES:
every actionable finding becomes a task in `~/virgil-tasks/` — `incoming/` for
the worker to implement and merge under its own discipline, `blocked/` for the
catcher to put in front of Gabriel. So this run opens no worktree, creates no
branch, applies no edit and exports no patch, and the whole "did the gates go
green?" question moves downstream to the worker, which asks it of the actual
diff rather than of a proposal.

That makes the dream symmetric with the worker's own idle-time AUDITS, which
have had exactly this shape since they shipped: **detectors file, one executor
lands, one catcher surfaces.** The reason is Gabriel's, verbatim — he wants ONE
place to check for things needing his attention, and a loop with private output
channels (a self-merge, a patch in `attachments/`, a decision note in `inbox/`)
is three more places. The night still runs the FULL GATE SWEEP (step 6): it is
the tree's nightly health check whether or not it was designed as one, and its
findings file like everything else.

### How it is scheduled (wired)

Three scheduled routines share the pipeline, all cwd'd at the repo:
`editor-skill-base-dream` (cron `0 22 * * *`) runs `/editor/dream` nightly, the
task worker (`/loop /work`) claims one task per run on the hour, and
`virgil-update` (cron `0 0 * * *`) runs `/cleanup-virgil` — merge sweep, version
bump, push, GitHub Pages deploy. So a finding filed at 22:06 is typically landed
by the worker within the hour and DEPLOYED by the midnight update, which is the
same end-to-end latency the old self-merge had, with a verified diff and a human
review path in the middle of it. `/loop /editor/dream` on an interval remains a
supported manual mode — same since-last-digest selection, and a same-day re-run
rotates the prior digest rather than erasing it.

The three slots are deliberately disjoint (22:06 dream · 23:09 remote-inbox
heartbeat · the worker on the hour), but the id-minting protocol in step 6 does
not lean on that: a protocol that rests on a schedule breaks the first time one
moves.

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
reconcile ─► read ─► detect ─► route ─► FILE ─► gate sweep ─► digest ─► reflect-on-self
   §0        §1      §2      §4/§5     §3+§4       §6          §7          §8
```

### 0. Reconcile with the QUEUE FIRST

Before you author anything, reconcile with what is already in flight — the human
drives this checkout live, the worker lands a task an hour, and re-authoring
already-ruled work is the costliest way to spend a night. Since task 522 there
is exactly ONE place to look, which is the whole point of the merge: the loop
has no private artifacts left to reconcile against (no surviving `dream/*`
branch, no exported patch under `attachments/`, no loose `inbox/` note), so
this step is a queue read and nothing else.

- **Read `~/virgil-tasks/{incoming,in-progress,blocked}/`** and ask each of your
  candidate findings the three questions the patch-reconciliation lore used to
  ask of a patch, which were always questions about *work already ruled on*
  rather than about patches:
  1. **Has it already landed?** Grep `done/` and `log.md` for the finding's
     subject, and confirm against the TREE — read the symbol the task claims to
     have introduced. A dead pointer that nobody confirms gets re-reconciled
     every night forever.
  2. **Is it already filed?** A finding that matches a live task is not a new
     finding. **Update that task** (append to its `## Description`, sharpen its
     `## Done when`) rather than minting a second id for one disease — the
     catcher's own dedupe rule, and the reason the queue clusters instead of
     accumulating.
  3. **Would it COLLIDE with a queued one?** Two tasks whose fixes touch the
     same seam is a real cost the worker pays serially. Prefer removing the
     collision **by construction** — file yours at a seam the other does not
     touch — and where that is genuinely impossible, say so in your task's
     `after:` field or route the choice to Gabriel. (Gabriel's ruling,
     2026-08-31: a queue collision is a queue fact, never a scope fact; what
     happens to be queued alongside must not shrink a fix.)
- **A blocked task is a QUESTION already asked.** If your finding is the answer
  to one, say so in the task rather than filing a rival — and never re-ask a
  question sitting in `blocked/`.
- **Never rebuild the skill bundle unattended** (`npm run build:skill-bundles`)
  — it mutates the live checkout's mirrors mid-session. This costs the loop
  nothing: the nightly deploy regenerates the served bundle from source (CI's
  `prebuild`), the repo-local mirrors regenerate on the next `predev`/`prebuild`,
  and the freshness guard
  ([skill-bundle-freshness.test.ts](../skills/__tests__/skill-bundle-freshness.test.ts))
  catches a stale mirror. A worker landing your task owes that rebuild; you do
  not.

<!-- RETIRED (task 522): this step used to reconcile with surviving `dream/*`
     BRANCHES and with exported PATCHES under `~/virgil-tasks/attachments/` —
     hard-won lore across several nights (the 227-commit stale-base stack of
     2026-08-11; the 08-23 collision near-miss; the 08-25 finding that two of
     three patches on file were already live and nothing pruned them). Every one
     of those rules was correct for a world where the dream produced its own
     durable artifacts. It does not: it files tasks, and a task is reconciled by
     reading the queue. The lore's GENERALIZABLE half — has it landed, is it
     already filed, would it collide — survives above, aimed at the artifact
     that now exists. -->

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

**Preflight 0 — can you hear at all?** Read **`memoSinkPresent`** before you
read a single count. `memoCount: 0` means *"a quiet night"* **only** when that
flag is true; when it is false the sink at `memosRoot` does not exist, so the
zero means the dream **could not look** — nothing was captured and the run
cannot know it. This is the same *"could not look" vs "looked and found
nothing"* split `driftChecked` draws and `selfReferentialOnly` follows, applied
to the loop's **primary input**: read the flag, never re-derive it by eye with
an `ls`.

A false sink outranks drift as the night's top finding, and the asymmetry is
the point — a drifted prompt still *records* (tomorrow's dream reads today's
memos and can still learn), whereas an absent sink records **nothing** and
every subsequent night reports the same healthy-looking no-op over it. The
digest is the only durable output, so unflagged the silence is permanent.

`reflect.py` creates the sink on first write, so `false` means precisely
*"nothing has been captured here since the sink last existed"* — benign on a
machine's first day, a broken capture layer on its thirtieth. Don't guess which:
a fresh clone, a wrong `VIRGIL_REPO_ROOT`, or a stale `VIRGIL_DEV_HOME` pin all
produce it. Record the fact and the calendar in the digest and let the human
rule; the corpus is not yours to reconstruct.

**And `memoSinkPresent: true` is not evidence that anything FEEDS the sink.**
Step 8 writes a self-reflection into it, so from the second night onward that
flag is *self-satisfied* — true because the reader wrote there, not because a
skill run was captured. `selfReferentialOnly` doesn't close the gap either: it
is scoped to the WINDOW since the last dream, so it reads as *"a quiet night"*
however many years the sink has gone without a real memo. Read
**`everCapturedNonDream`** (with `lastNonDreamMemoAt` / `nonDreamLifetimeCount`)
for the lifetime question — the fourth member of the conflation class
`driftChecked`, `memoSinkPresent` and the empty `marker` each closed, one level
above the sink check.

`false` is the strongest no-signal state there is, and it outranks every finding
in the memos: the loop has no input, so every pattern you can detect is
necessarily about the loop's OWN procedure — which is `neverSelfMerge`, cannot
land unattended, and accrues to a queue only the human drains. Say so in the
digest (the renderer emits the banner from the same flag) and prefer routing a
ruling over authoring another self-edit. It does **not** mean capture is broken:
the floor is automatic (`apply_response` fires `reflect.py` after every commit),
so the ordinary cause is simply that no editor skill has been run on a real
paper in DEV mode. Verify before you diagnose — one `create_card.py` write
against a scratch copy of a paper, with `VIRGIL_DEV_MEMOS_DIR` pinned AWAY from
the real sink so the probe cannot pollute tomorrow's corpus, settles which it is.

**And every flag above is a fact about a night that RAN.** The one failure none
of them can see is a night that DIDN'T: a dark night writes no digest, so the
next run that does happen inherits a perfectly ordinary window — `memoCount: 0`,
`memoSinkPresent: true`, `selfReferentialOnly: true`, `lastDigest` present — and
reports a healthy quiet night over the gap. Read
**`nightsSinceLastDigest`**: **0** (a second run today) or **1** (last night, as
scheduled) is healthy; **anything above 1 is a finding and outranks the memos**,
because the nights it names produced no output to reason about. Measured
2026-08-27 → 08-30 on this machine: the host slept, and the first run back
called four dark nights quiet.

Treat it as a fact about the HOST, not about the dream: the dream, the task
worker and the nightly `virgil-update` deploy are scheduled together, so they
stop together — check what else did not happen on those dates (an empty
`~/virgil-tasks/log.md` stretch, no deploy) before reading anything else as
signal, and record the span in the digest so the human can rule on the cause.
The digest renders its own banner from the same field, so this is a reading, not
a re-derivation.

A **negative** value is not a blackout but a clock anomaly — a digest dated in
the future (a skewed host, a hand-edited `dreamedAt`, a `VIRGIL_DREAM_NOW` pin
behind the corpus). Marker selection ranks by `dreamedAt`, so settle it before
trusting tonight's own digest to rank above the one it read.

And `null` is never bare here — the same conflation rule, a fifth time.
**`nightsSinceReason`** separates `bootstrap` (no prior digest exists, so there
is nothing to measure from — not a finding) from `unreadable` (a digest exists
but carries no parseable `dreamedAt`, so the run *could not look*). Read the
reason; never read a bare `null` as "the first dream."

**And a sink that EXISTS still cannot say whether a memo written on ANOTHER
machine could ever arrive.** All Virgil cowork now happens on a different
computer from the one this loop runs on, and the pre-521 sink resolved the
PRIMARY CHECKOUT — which that machine does not have, so a reflection written
there was not merely invisible, it was never written. Read
**`memoSinkKind`**: `synced` is the Dropbox-shared
`Virgil-Inbox/dev-loop/memos` both machines reach (the intended state);
`pinned` is a caller who said where these go; **`local` is the structural
famine** — the mailbox is on this disk only, so `everCapturedNonDream: false`
below is a fact about the transport, not about how much cowork happened. The
renderer banners `local` from the same field. The remedy is one folder and one
env var, not a code change: create `~/Dropbox/Virgil-Inbox/` here, and on the
cowork machine set `VIRGIL_DEV=1` (plus `VIRGIL_INBOX` if its Dropbox lives
elsewhere).

**And even the right mailbox is only the one THIS build writes to.** Every flag
above asks about the READER's own state; **`extraSinkNonDreamMemos`** asks about
the SEAM — whether the WRITERS agree with the reader about where the mailbox
is. A writer resolves its sink from whatever vintage of the skill bundle its
paper folder carries, and bundles re-sync on doc-open, so a paper the human has
not opened since a migration keeps writing to the old place indefinitely.
`select` reads every such sink (`extraSinksRead`) and the corpus is their UNION,
so nothing is invisible and the flags above are honest — but a NON-ZERO
`extraSinkNonDreamMemos` is a live divergent writer and the night's top finding:
name the folders and recommend `python3 editor/scripts/sync_skills.py <paper>`.
Residue-only (`extraSinkMemos > 0`, `extraSinkNonDreamMemos: 0`) is a stale
sink worth deleting, not a finding. **"In the corpus" is not "read tonight"** —
those are LIFETIME counts and the window is marker-filtered, so quote
`extraSinkMemosInWindow` when you say a divergent memo was dreamed over.

**And one flag outranks every count above: `unreachableMemos`.** The marker is a
TIMESTAMP, and syncing broke the identity between "written after the last dream"
and "sorts above its marker": a memo written on the cowork machine at 09:00 and
synced at 23:00 is behind tonight's marker FOREVER — in the corpus, in no
window, read by no dream, ever. Non-empty means real reflections have been
written that this loop will never process. Nothing is lost from disk, so READ
THEM YOURSELF (the digest names the paths) and treat their content as tonight's
input; then say so, because every other flag reports a healthy night over them.
This is a detected condition, not a prevented one — preventing it means
replacing the high-water marker with a seen-SET, which is a design change to the
whole selection discipline and belongs in the task pipeline, not in a night. Measured 2026-09-01, thirteen days after
the 08-23 migration: five of eight bootstrapped paper folders — the
most-worked-on among them — were still writing to the retired home.

*Migration note (task 431, 2026-08-23; task 521, 2026-09-01):* the loop's memory
moved from the machine-global `~/.virgil-dev` — which the dev-machine move left
behind, zeroing it with no signal — to `<primary checkout>/editor/dev`
(gitignored), and the MEMO half then moved again, to the Dropbox-synced
`Virgil-Inbox/dev-loop/memos`, so cowork on any machine reaches it. Digests stay
LOCAL and are not synced: `<date>.md` rotates in place and is the marker store,
and a file two machines can see being rewritten is a conflicted copy waiting to
be minted. What crosses instead is an immutable timestamped COPY under
`dev-loop/reports/` — a courtesy channel for reading from the other machine, and
**nothing that needs attention may live only there**; `~/virgil-tasks/` is the
one attention surface.

**Preflight 1 — are you running the current prompt?** This skill is *distributed*:
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
expand-guidance, clarify}` **or** structural `{cross-skill, script-change,
manifest-change, rename, merge-skill, split-skill, contract-change, new-helper,
behavior-change}`. Always supply `oldText`/`newText` so the guard can adjudicate
a boundary-sensitive change — that is what makes the difference between an
adjudicated verdict and a refusal-by-vagueness.

**`oldText`/`newText` are a PROPOSAL, not an edit.** You write neither into the
tree; they travel into the filed task's `## Design` so the worker can see
exactly what you meant, and the worker authors the real diff against whatever
`main` looks like by then.

### 3. The fast-path (flagged + fix-now)

For each memo in `fixNow`: handle it **now**, in a narrow single-memo pass.
Build its change object, route it (step 4), and file its task with
`"fixNow": true` — which is what raises the task to `priority: high` so the
worker claims it ahead of the batch. A fix-now memo whose change comes back
`refused` or own-rulebook does **not** get the fast lane; it routes to
`blocked/` like any other, because "the maintainer flagged it" is a statement
about urgency and not about who may decide it.

<!-- RETIRED (task 522): this used to read "acts-directly only … apply it
     immediately and record it ACTED". Nothing is applied here now, so the fast
     path is a PRIORITY, not a landing mode — which is all it ever really was. -->

### 4. Route each finding to a QUEUE — ask the door, never decide by feel

The dream lands nothing, so the only landing decision left is **which queue the
task goes in**. One door answers it, for a change and for a red gate alike:

```bash
python3 editor/scripts/dream_land.py --route @finding.json
# → { "queue": "incoming" | "blocked", "status", "priority",
#     "questionsRequired": bool, "mode", "boundary", "neverSelfMerge", "reason" }
```

(Or `from dream_land import task_route` if you're scripting the loop.)
`--route` answers the WHOLE question; `--change` still exists and answers the
`acts`/`proposes`/`refused` verdict alone, which the digest records and which
`/editor/iterate-virgil-editor` consumes. Ask `--route`; it calls `--change`
for you.

- **`incoming/` (ready)** — ordinary work, whatever its verdict. The
  `acts`/`proposes` split no longer changes where the task goes, because the
  worker lands both kinds of diff under the same discipline (worktree → types →
  tests → merge). It still describes the finding, so carry it into the task's
  `## Design`: an `acts` finding is a scoped prose fix, a `proposes` one is
  structural and wants the deeper treatment.
- **`blocked/` (questions)** — the two cases the human decides:
  - a **boundary refusal** (step 5). Pre-522 a refusal was "recorded, not
    acted" — recorded in a digest, which is write-only. File it: a refusal
    nobody reads is a refusal that decides by default.
  - an **own-rulebook** change (`neverSelfMerge: true` — `DEV_LOOP_PROCEDURE`:
    the three skill prompts *and* `dream.py` / `reflect.py` / `dream_land.py` /
    `dev_loop.py`). The membership lives in `dream_land.py` and **only** there;
    the names here are a reader's gloss, not the list, so a fifth procedure file
    joins that set and this clause follows it with no edit.

  A blocked task **leads with `## Questions`**, a **bold recommendation**, and
  the sentence *"I cannot just take my own recommendation here because ___"*
  (the auditor's routing-test discipline). `dream.py file-task` REFUSES to write
  a blocked task without a `Questions` section — a question the catcher cannot
  surface is not a routing, it is a drop.

<!-- RETIRED (task 522): this step used to end in `git worktree add -b
     dream/$DATE` and a "that branch is a WORKSPACE for step 6" clause. There is
     no branch: the dream files a task and the worker opens its own worktree.
     The `dreamDate` rule that keyed the branch name survives in `select` for
     the reason it was written (one UTC clock for every dated artifact), not for
     the branch it used to name. -->

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
seems to call for crossing one is a signal to route to the human — as a
**blocked task with `## Questions`**, not as a digest line (task 522: a digest
is write-only, and "surface it in the digest" was a routing to nowhere). The
guard enforces this from the change's content (a boundary-file edit with no
content to adjudicate is refused), so it cannot be sidestepped by leaving the
intent vague.

The boundaries survive this merge as **detection-time** constraints: they bound
what the dream may PROPOSE, and the worker adds its own safety when it executes.
Above all, the one that is not in the guard at all: **never edit a paper file.**

### 6. FILE the night's work — one task per finding, and the gate sweep

The dream lands nothing. Every actionable finding becomes a task in
`~/virgil-tasks/`; the worker is the one thing that touches `main`, and
`blocked/` is the one surface Gabriel is asked to read.

**File each finding** (routed in step 4) with the script — never by hand-writing
a file into a queue dir, because the id, the queue, the status, the priority and
the `source: dream` stamp are all deterministic and the script owns every one of
them:

```bash
python3 editor/scripts/dream.py file-task --task @finding.json
# → { "filed": true, "id": "2026-09-01-014", "path": "...", "queue": "incoming",
#     "status": "ready", "priority": "normal", "reason": "..." }
```

`finding.json` — you supply the qualitative half, exactly as with the digest:

```json
{ "title": "one imperative, SPECIFIC sentence — this is what Gabriel reads",
  "type": "chore",
  "size": "small",
  "slug": "optional; derived from the title otherwise",
  "after": "optional task id this one must land after",
  "finding": { "kind": "change", "fixNow": false,
               "change": { "paths": ["editor/skills/draft-footnote.md"],
                           "intent": "tighten-wording",
                           "oldText": "…", "newText": "…" } },
  "memoRefs": ["2026-08-30/10-05-00-draft-footnote.md"],
  "sections": { "Description": "…", "Done when": "…",
                "Design": "…", "Verify": "…", "Questions": "…" } }
```

**Write the task to the pipeline's own bar, not to a lower one.** A dream-filed
task is read by the same unattended worker that reads a catcher-filed one, so it
meets the same standard: the schema and what each section is for live in the
queue's own docs — `~/virgil-tasks/README.md` ("Task file schema") and
`~/virgil-tasks/CATCHER.md` ("Writing a task file"). Read them rather than a
restatement here, which is how two descriptions of one schema come to disagree. Three things the script
enforces because they are what a task is *for*:

- **`## Description` and `## Done when` are REQUIRED.** "A task with no
  acceptance criteria is one the worker can't safely finish — it'll just get
  parked" (README). You already write memos at this depth; write the task there.
- **`## Questions` is required on a blocked task.** See step 4.
- **`memoRefs` land in the Description**, so the reasoning behind a finding is
  one grep away six weeks later.

Put the deep layer in `## Design` — the `deepFix` the CENTRAL DESIGN PRINCIPLE
asks for, `file:line` pointers, and for a cluster a `### Members` list of the
symptoms one fix retires. That is the same judgment step 2 already does; the
task file is just where it goes now.

**Id minting — the collision protocol, shared by FOUR minters** (the
interactive catcher, the remote-inbox heartbeat, the auditor — the worker in
idle mode — and this loop). The numbering rule has ONE home, the `id:` line of
the queue's `README.md` schema (global `NNN`, one past the highest on disk in
any queue dir, regardless of date), and `file-task` implements it: scan every
queue dir for that max immediately *before* each write, re-verify *after*,
rename to the next free number on a collision. `dream.py next-id` is the same
scan published as a door for the hand minters. You do not have to do any of
that by hand — but do not hand-write a task file either, because then nobody
does.

**Then run the gates — the tree's nightly health check.** This is the one piece
of the old step 6 that survives whole, because it was never about landing:

1. In the primary checkout on `main`: `npx tsc --noEmit` · `npx vitest run` ·
   every `editor/scripts/tests/test_*.py`. All three families, no shortcuts.
2. **Green** → record it in the digest's `bootstrap` line and stop. The dream is
   the only thing that runs the full sweep unattended every night.
3. **Red** → **attribute it before you file it.** A red gate is evidence about
   the TREE, and the honest artifact depends on whether you can say *which
   commit* broke it: `git log --oneline -20 -- <the failing area>`, then check
   out the suspect's parent and re-run the failing leg. File it with
   `{"kind": "gate-failure", "commit": "<sha>"}` and the door routes it to
   `incoming/` at high priority, with the failing gate's output tail in
   `## Description`.
   **If you cannot attribute it, the door routes it to `blocked/` instead** —
   and that is not a formality. Filing an unattributed break as a work task
   points a worker at a diff nobody has separated from the tree's own state,
   which is the measured 2026-08-25 defect: a markdown edit filed as the suspect
   for two library guards a commit two hours older had broken.

<!-- RETIRED (task 522): this step used to be the loop's landing engine —
     green-merge-or-export, the export recipe (`git diff main...dream/$DATE >
     ~/virgil-tasks/attachments/…patch`, `apply --check`, `worktree remove`,
     `branch -D`), the patch-pruning rule with its two-conjunct proof of
     landing, and the never-self-merge clause with its `--self-merge-check`
     door. All of it existed to answer "may this branch merge itself tonight?",
     and the dream no longer merges anything, so the question is gone rather
     than answered differently. What each rule was PROTECTING survives, aimed at
     the artifact that now exists: never-self-merge is step 4's `blocked/`
     routing (the guard's membership is unchanged and still lives in
     `dream_land.py`); "a branch that survives has already merged" is moot,
     since none is created; "a patch that survives has NOT landed" is moot,
     since a task's own status says which it is; and the attribute-before-filing
     rule is above, now the difference between a work task and a question. -->

### 7. Write the digest

Always — even on a no-op night. Hand the script your qualitative entries; it
re-derives the deterministic facts (memo count, counts, the next marker) so they
can't drift:

```bash
python3 editor/scripts/dream.py digest --report @report.json
```

`report.json` — the three buckets are the three **verdicts** (that is what
`dream_land` calls them), and every entry carries the **task** it was filed as:

```json
{ "acted":    [ { "summary": "...", "paths": ["editor/skills/x.md"],
                  "task": "2026-09-01-014", "queue": "incoming", "memoRefs": ["..."] } ],
  "proposed": [ { "summary": "...", "paths": ["editor/scripts/y.py"],
                  "task": "2026-09-01-015", "queue": "incoming",
                  "reason": "touches a .py script", "memoRefs": ["..."] } ],
  "refused":  [ { "summary": "...", "boundary": "B1:agents-dont-rules",
                  "task": "2026-09-01-016", "queue": "blocked",
                  "reason": "...", "memoRefs": ["..."] } ],
  "bootstrap": "<one line on how this dream went — feeds step 8>" }
```

It writes `editor/dev/dream-digests/<YYYY-MM-DD>.md` (gitignored, the sibling of
`memos/` — a reader OUTSIDE the dream, such as the catcher's nightly-digest
step, finds this root through `dream.py paths digests` rather than by spelling
it: it has moved twice and the prose copy went stale both times, task 538),
recording the three buckets, the counts by tier/skill/lens, and the
`marker` the next dream reads. **Quote each entry's real `task` id and queue** —
the digest then reads as what actually happened rather than as what was
intended, and an entry with no `task` renders as **NOT FILED**, which is exactly
what a finding that reached no queue is. The digest is a RECORD, not a channel:
nothing needing attention may live only here.

<!-- RETIRED (task 522): the summaries used to lead with LANDED / EXPORTED /
     FILED and an unlanded entry carried a `patch` path, because the digest was
     the only pointer to work that had not merged. The work is a task now, so
     the pointer is a task id and its status lives in the queue. -->

It also drops an immutable, timestamped COPY of the same digest into the synced
`Virgil-Inbox/dev-loop/reports/` (the `Done:` line names it), so the morning's
reading is available from the cowork machine. That copy is a **courtesy channel
only** — write-once, never revisited, and **nothing requiring attention may live
there alone**. Everything actionable keeps flowing through `~/virgil-tasks/`,
which is the one surface the human checks. A machine with no synced inbox simply
gets no copy; the durable digest has already landed either way.

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

**The one thing that stays `dream`-specific is its output channel.** `dream`
runs unattended, so it writes NOTHING to the tree: it files a task and the
worker executes it (task 522). `iterate` runs synchronously with a human in the
loop, so it adopts `dream_land` as a **boundary guard only** — honoring
`refused`, surfacing `proposes` for scrutiny, and landing non-refused edits
inline. That asymmetry is the same one it always was, with the dream's half now
much smaller: it used to be acts-on-branch / propose-via-worktree / self-merge,
and it is now one call to `dream.py file-task`. See
[editor/dev/README.md](../dev/README.md).

## Hard rules

- **DEV mode only.** Both scripts no-op without `VIRGIL_DEV=1`. Never hand-write
  a memo or digest to dodge the gate.
- **The guard is law.** Route *every* finding through `dream_land.task_route`
  and honor the answer. Never work around a `refused`, and never file an
  own-rulebook change as ready work.
- **You LAND NOTHING.** No branch, no commit, no merge, no patch, no edit to any
  file in the tree — including the skill prompts your findings are about. The
  worker is the one executor. (The only files a night writes are its digest, its
  step-8 memo, and the task files it mints.)
- **Never edit a paper file.** The dream proposes changes to Virgil's *skill
  set* (`editor/skills/`, the scripts, the manifest) — never a user's
  `.tex`/`.bib`/sidecar. It needs no pen and no `apply_response` contract.
- **A finding that is not FILED is lost.** The digest is a record, the synced
  reports folder is a courtesy, and `~/virgil-tasks/` is the only surface anyone
  reads. Always write the digest — and file first.
- **One seam, not a fork.** Reuse `reflect._parse_memo` and `dream_land` — do not
  write a second memo parser or a parallel routing rule.

## Reply format

Echo `dream.py digest`'s one-line `Done:` reply (counts + digest path), then a
≤5-line summary: the memo count + tier split, every task you FILED (id + queue
+ one clause of what it is), any REFUSED finding with its boundary and the
blocked task id it became, and the gate sweep's verdict. If DEV mode is off, say
so in one line and stop.
