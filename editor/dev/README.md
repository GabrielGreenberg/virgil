# Virgil editor dev-loop — the self-improvement subsystem

This is the **single source of truth** for `editor/dev/` — the developer-only
loop that refines Virgil's editor skill set over time. It is a *developer*
affordance, never an end-user feature.

Design source: [MEMO_DEV_DREAM_DESIGN.md](../../MEMO_DEV_DREAM_DESIGN.md) ·
frozen spec: `EDITOR_SKILLS_V1.html` §14 · conceptual home:
[docs/architecture/VIRGIL.md → Cowork pattern](../../docs/architecture/VIRGIL.md).

> **Status.** Both halves are built, and the two entry points are **unified**.
> The **day half** (the capture layer — this doc's main subject) is chip 17; the
> **night half** (`/editor/dream`) is chip 18 (see
> [The dream phase](#the-dream-phase-night-half)). Chip 19 put `/editor/iterate-virgil-editor`
> on the **same engine** — one critique-memo shape, one reader, one boundary
> guard — see [The unified engine](#the-unified-engine-iterations-and-memos-chip-19).
> The **cowork-capture** pass wired the capture layer to actually fire for
> *paper-directed cowork sessions* (cwd = a paper folder, **not** the repo, which
> is where most editing happens and where nothing was captured before): an
> `apply_response` tail-trigger writes the memo mechanically for every writeback,
> and all three streams resolve **one machine-global sink** (`~/.virgil-dev`), so
> the repo-side dream reads exactly where a paper-folder `reflect` wrote — see
> [The dev-loop sink](#the-dev-loop-sink) and
> [Capture without the agent remembering](#capture-without-the-agent-remembering-the-tail-trigger).
> The remaining work is the Phase-8 UI.

## The loop, in one picture

```
   Day (DEV mode ON)                        Night (dream phase)
   skill runs ─► /editor/reflect                 /editor/dream
                 writes a tiered memo to    ├─ read all memos since last dream
                 editor/dev/memos/          ├─ detect cross-memo patterns
                 <date>/<time>-<skill>.md   ├─ route each → acts / proposes / refused
   you: "put this in the memo" ──┘          ├─ apply acts; stage proposes; refuse boundaries
                                            └─ write a morning dream-digest
```

The day half is the **ambient, always-on** generalization of the manual
`/editor/iterate-virgil-editor` stress-test: instead of synthesized test cases
it captures *real* invocations passively.

## The toggle — `VIRGIL_DEV`

DEV mode is a **per-session env var**: `VIRGIL_DEV=1` (truthy = `1|true|yes|on`,
case-insensitive). The single read is
[`_common.dev_mode_enabled()`](../scripts/_common.py); every gate consults it,
nothing re-implements the rule.

Why an env var and not a `document-settings.json` flag (the spec left it open):
it has **no UI surface and no on-disk presence**, and so **cannot ship to an end
user**. The `reflect` skill + script AND the `apply_response` tail-trigger ship
to every paper folder via the normal bundle sync, but the runtime gate stays off
unless `VIRGIL_DEV` is truthy — so **no memo is ever written outside a dev
session.** OFF is the default and the safe failure mode (a typo'd export never
silently turns capture on).

```bash
VIRGIL_DEV=1 claude        # a one-off dev session: skills reflect
claude                     # a normal session: reflection is a no-op
```

**Making every session a dev session — the config for cowork capture.** A
paper-directed cowork session's cwd is a *paper folder outside the repo*, so the
repo's project `.claude/settings.local.json` toggle never reaches it. To capture
those sessions (where most real editing happens), set the toggle **and** the sink
pin at **user scope** — the only settings scope that reaches an out-of-repo cwd —
in `~/.claude/settings.json`:

```jsonc
"env": {
  "VIRGIL_DEV": "1",
  "VIRGIL_DEV_HOME": "/Users/<you>/.virgil-dev",   // the one machine-global sink
  "VIRGIL_REPO_ROOT": "/Users/<you>/…/virgil"       // best-effort skillSha lookups
}
```

`VIRGIL_`-namespaced and read **only** by these dev-loop scripts, so it is inert
in every non-Virgil session and, via the runtime gate, in end-user Virgil
sessions too.

## The capture mechanism — one shared seam

Reflection is **one** skill plus **one** convention — deliberately *not* a
"now write a memo" step bolted onto each of the ~20 skill files (that would
drift; it is the exact superficial-patch anti-pattern). So the whole skill set
inherits reflection from a single edit, and any future skill inherits it free.

- **[`/editor/reflect`](../skills/reflect.md)** — the memo-writer skill. The
  agent supplies the qualitative four-bucket reflection; the script does the
  mechanical work.
- **[`reflect.py`](../scripts/reflect.py)** — gates on `VIRGIL_DEV`, reads the
  Task's already-stamped `result`, derives the tier, and writes/merges the memo.
  Read-only on the paper (it only reads the Task queue) — it writes **only** to
  the machine-global sink (below), so it needs no pen and no `apply_response`
  contract.
- **The convention** lives once in
  [editor/AGENTS.md → Skill conventions](../AGENTS.md) ("Reflection (DEV
  mode)"): *in DEV mode, reflect after completing any skill.* The umbrella
  [`/editor/review`](../skills/review.md) **enforces** it for every subskill it
  dispatches. But a convention only fires when the agent (or the umbrella)
  remembers — which a **direct** skill invocation in a paper-cowork session does
  not. So the convention is now the *enrichment ceiling*, not the floor; the
  floor is the tail-trigger.

### Capture without the agent remembering (the tail-trigger)

The one place **every** mutating skill passes through is
[`apply_response.py`](../scripts/apply_response.py) — the sanctioned writeback
chokepoint. So its two commit finalizers, **`cmd_write`** (every write path,
incl. `complete-only`) and **`_mutation_commit`** (every card mutation), are the
one place to guarantee a memo. Right after `commit_under_pen`, each fires
`_reflect_tail` → [`_common.spawn_reflection`](../scripts/_common.py) —
**DEV-gated, best-effort** (the commit already succeeded and is never undone).
This is the deep-unified seam, *not* a per-skill bolt-on: two calls at the two
finalizers, and every current and future skill inherits capture free.

- **The finalizers, NOT `main()`.** Placing the trigger in the CLI entry would
  miss `create_card.py`, which calls `run_write_subcommand` **in-process**
  (never spawning the CLI) — so the entire card-creation responder family
  (footnote/citation/note/todo/report) would get no memo. Both the CLI and the
  in-process path funnel through `cmd_write`, so that is where it lives.
- **It sidesteps the skills' markdown script-paths.** `spawn_reflection` invokes
  `reflect.py` by its **sibling path** (`Path(__file__).parent / "reflect.py"`),
  so it resolves from a synced paper's `.virgil/scripts/editor/` copy — even
  though 21 of 23 skill markdowns still hardcode the repo-root `editor/scripts/`
  form (a separate, pre-existing robustness item the floor does not depend on).
- **The skill name comes from the Task, not the op.** A write names its skill
  from the **Task's `kind`** (`_KIND_SKILL`: `suggestion → draft-suggestion`,
  `footnote → draft-footnote`, …) — reliably present on the request row, unlike
  a top-level op key that direct-CLI ops omit. A mutation names it from the op
  label every caller stamps in `extra` (`_OP_SKILL`: `archive → archive-card`).
  Both match the name the umbrella/convention reflection uses (the umbrella
  dispatches by the *same* request kind), so the two **merge** into the *same*
  `(skill, taskId)` memo (idempotent — tier only rises, buckets fill,
  `reflectedAt` kept) rather than duplicating it.
- **Two independent gates keep it inert for end users**: `spawn_reflection`
  returns before spawning unless `VIRGIL_DEV` is on, and `reflect.py` itself
  re-checks the gate. A shipped-but-inert trigger writes nothing for a user.

> **Known granularity artifact.** A skill that makes *two* writebacks for one
> logical action (draft-footnote's revise-existing = `update` then
> `complete-task`) yields two memos — one `edit-card` (the mechanical update leg,
> Task-less) plus the correctly-labelled `draft-footnote` (which merges with the
> umbrella). Both are individually true; the `edit-card` entry is minor
> dev-corpus granularity, not a mislabel. Collapsing it would require the skill
> to complete in one writeback — a skill-markdown change, tracked separately.

The tail-trigger writes the correctly-classified **frontmatter floor** (skill /
taskId / result / tier / paragraphIds); the four qualitative buckets are filled
in later by the convention when the agent reflects. Floor + ceiling, one memo.

### The dev-loop sink

Memos (reflect), digests (dream), and iterations (iterate) resolve **one
machine-global home**, `~/.virgil-dev/` (override the base with `VIRGIL_DEV_HOME`;
each stream also has its own `VIRGIL_DEV_MEMOS_DIR` / `VIRGIL_DREAM_DIGESTS_DIR` /
`VIRGIL_DEV_ITERATIONS_DIR` pin). Resolved once in
[`_common`](../scripts/_common.py) (`dev_home` / `memos_root` / `digests_root` /
`iterations_root`) — reflect and dream import the **same** resolver, never a
duplicated default. This is the load-bearing invariant: **the writer (reflect)
and the reader (dream) must resolve identically**, or the dream reads an empty
dir with no error. A machine-global *absolute* default (not a `REPO_ROOT`-
relative one) is what makes them agree from **any** cwd — a repo checkout, a git
worktree, or a synced paper's `.virgil/scripts/editor/` copy (where a
`__file__`-relative root would otherwise land *inside* the paper's `.virgil/`).
That decoupling from any one checkout is exactly what lets a paper-directed
session's memo reach the dream.

### It consumes the contract — it does not re-derive the outcome

The two-field `status`/`result` vocabulary (EDITOR_SKILLS_V1 §7, built by chips
3–16) already classifies each Task's outcome. Reflection **reads** `result` and
maps it to the tier floor and the dream's filter key — the rejection corpus is
`result: rejected`, the silent-edit audit is `result: silent-applied`, the
refusal patterns are `result: refused`. The capture layer is a thin seam on top
of the contract, not new per-skill machinery.

## The memo

Path: `~/.virgil-dev/memos/<YYYY-MM-DD>/<HH-MM-SS>-<skill>.md` (the machine-global
[sink](#the-dev-loop-sink); `VIRGIL_DEV_MEMOS_DIR` overrides). It is the sibling
of `~/.virgil-dev/iterations/` and is **distinct** from the per-paper cowork memo
stream (`<docPath>/.virgil/memos/`) and the library memo stream
(`~/Virgil-Library/.virgil/memos/`). The three streams never mix — different
audience, different consumer. (The home moved off the old repo-side
`editor/dev/memos/` — whose `REPO_ROOT`-relative default diverged between a
paper-folder writer and the repo-side reader — to the machine-global sink both
now share. The in-repo `editor/dev/{memos,dream-digests,iterations}/` `.gitkeep`
dirs are retained only as the documented shape; they are no longer the resolved
root.)

### Frontmatter (what the dream reads mechanically)

```yaml
skill: draft-suggestion       # the skill that ran
taskId: <id>                  # ai-request id / bibKey / virtual:… / "-" (Task-less)
kind: suggestion              # the request kind
status: complete              # the contract's status
result: rejected              # the contract's result — the dream's filter key
tier: noted                   # unremarkable | noted | flagged
fixNow: false                 # the fast-path flag
paragraphIds: 6612            # the Task's anchor(s)
reflectedAt: <iso>            # first reflection's timestamp (stable on re-run)
skillSha: <short>             # git HEAD:editor/skills/<skill>.md
```

### Four buckets (the qualitative layer the agent supplies)

| Bucket | What goes here |
|---|---|
| **Issues / ambiguities / errors** | unclear prompt; where it asked the user; a mid-task correction; a low-confidence A/B; a near-miss Don't-rule |
| **Streamlining / repetition** | inline ops that should be a helper; re-discovered facts; awkward call sequences; cross-skill duplication |
| **Alignment / fit** | default ≠ what the user wanted; a principle that felt wrong; a concept the manifest doesn't cover |
| **User-tagged** | the maintainer's "put this in the memo" notes (`--tag`) — always promotes to `flagged` |

### Three tiers (so the dream isn't drowned — most runs are noise)

| Tier | When | Dream treatment |
|---|---|---|
| `unremarkable` | clean run, no friction (the routine default) | counted for stats, not read individually |
| `noted` | friction / a non-obvious choice / a turned-down draft | read individually, grouped by skill + bucket |
| `flagged` | user-tagged, low self-confidence, an error, a near-miss | read first; `fix-now` queues an immediate narrow pass |

The class is set **at write time** by the script. The DEV user **promotes** a
memo's tier after the fact by appending a `--tag` (always → `flagged`); tier
only ever rises.

### `result` → tier floor

| `result` | floor | dream lens |
|---|---|---|
| `silent-applied` · `auto-applied` · `direct-created` · `accepted` | `unremarkable` | silent-edit audit (the silent ones) |
| `rejected` | `noted` | the rejection corpus |
| `refused` · `impossible` | `noted` | the refusal patterns |
| `errored` | `flagged` | something broke |
| none (a Level-3 draft awaiting review, or a Task-less op) | `unremarkable` | the accept/reject reflection comes later |

The floor is a *floor*: agent `confidence: "low"` → `flagged`; an explicit
`--tier`/`--tag`/`--fix-now` can raise it; nothing lowers it.

### Idempotency

Re-running the same skill for the same `<taskId>` updates the **one** memo
(keyed on **skill + Task**, not the time-stamped filename): the three analytic
buckets take the latest reflection (or keep the prior bodies on a pure `--tag`
run), user tags accumulate deduped, and the tier only rises. A *different* skill
on the same Task gets its own memo — the propose→accept lifecycle
(`draft-suggestion` then `accept-`/`reject-suggestion`) shares a taskId but
yields one memo per skill, so the draft's reflection is never clobbered by the
accept/reject one. A Task-less op (`taskId = -`) is never deduped — each gets a
fresh file.

## The dream phase (night half)

[`/editor/dream`](../skills/dream.md) is the overnight pass that **consumes**
the memos. Like reflect, it splits an agent-facing skill from deterministic
scripts; unlike reflect, it also *acts* — so the riskier landing decisions are
made by a guard, not by feel.

- **[`dream.py`](../scripts/dream.py)** — `select` (find + group the memos since
  the last dream) and `digest` (write the morning summary + the next marker).
  Gated on `VIRGIL_DEV`; reuses `reflect._parse_memo` (no second parser).
- **[`dream_land.py`](../scripts/dream_land.py)** — `classify_change` →
  `acts` / `proposes` / `refused`. The shared landing-mode helper **and** the
  three-boundary guard, in one pure, dry-run-safe module.

**The flow:** `select` → detect cross-memo patterns → route each change through
`dream_land` → apply the `acts`, stage the `proposes`, record the `refused` →
`digest` → reflect on the run itself (bootstrap).

### Since-last-dream selection

Each digest records a high-water `marker` (the greatest memo timestamp it
processed, with the memo path as the tie-break). The next `select` reads only
memos **strictly after** it, so an already-digested memo is never re-processed.
No prior digest → the bootstrap dream reads every memo. (A re-`--tag`'d old memo
keeps its original `reflectedAt`, so it is not re-selected — matching "don't
re-process"; re-selecting a re-tagged memo via a future `updatedAt` channel
remains a forward item, deferred past the chip-19 unification.)

### The two landing modes (scope-determined)

| Mode | When | Where it lands |
|---|---|---|
| **acts** | a single skill-prompt `.md`, prose-polish intent (`tighten-wording` / `add-example` / `fix-typo` / `expand-guidance` / `clarify`), no contract token | committed directly on the dream branch — the user merges/reverts via git |
| **proposes** | cross-skill · any `.py` script · the manifest (`docs/workspace/`) · rename/merge/split · any contract-adjacent change | staged in a `dream/<date>` worktree; the digest carries a `git merge dream/<date>` hint for review |
| **refused** | crosses a boundary (below) | recorded only — never applied, never proposed |

Precedence is **refused > proposes > acts**: the boundary guard runs first, and
an unspecified intent on a lone skill prompt defaults to *propose* (acts is the
privileged fast lane, asked for explicitly). The **fast-path** — a memo that is
`flagged` **and** `fixNow` — gets an immediate narrow single-memo pass, but
acts-directly only; if its change classifies as `proposes`/`refused` it drops
back to the batch.

### The three enforced boundaries (the guard, not convention)

`classify_change` returns `refused` — by construction, derived from the change's
content — for any change that would:

1. **(B1)** edit the architectural Don't-rules in `editor/AGENTS.md` (also the
   DEV-reflection convention living there — touching it unwires capture).
2. **(B2)** change the `apply_response.py` contract shape — subcommands,
   `RESULT_*`/`STATUS_*` vocab, or the op-json schema.
3. **(B3)** disable DEV mode itself — the `VIRGIL_DEV` gate /
   `dev_mode_enabled` or its enforcement in `reflect.py`/`dream.py`.

A boundary-sensitive file edited with no content to adjudicate is refused (a
blind edit can't be proven safe). These are the load-bearing invariants the
loop runs *inside*.

### The digest

`editor/dev/dream-digests/<YYYY-MM-DD>.md` — **gitignored**, the sibling of
`memos/` and `iterations/` (with a checked-in `.gitkeep`). Written **every**
run, even a no-op night. Frontmatter carries `dreamedAt` / `since` / `marker` /
`markerMemo` / the acted/proposed/refused counts / `dreamSha`; the body lists
the ACTED, PROPOSED (each with its merge hint), and REFUSED (each with its
boundary) entries, the counts by tier/skill/lens, and a bootstrap note. The
clock is pinnable via `VIRGIL_DREAM_NOW` (mirroring reflect's `VIRGIL_REFLECT_NOW`).

### Bootstrap / recursion

The dream is itself a Virgil skill, so it reflects on its **own** run via
`/editor/reflect <docPath> dream -` **after** the digest — that `skill=dream`
memo lands past this run's marker, so the next dream reads it first (it's the
dream's own track record). "The first dreams will be the worst."

### Scheduling (wired — two Claude scheduled tasks)

`editor-skill-base-dream` (cron `0 22 * * *`) runs `/editor/dream` nightly from
the repo, and `virgil-update` (cron `0 0 * * *`) runs `/cleanup-virgil` — merge
sweep, version bump, push, deploy — after it. Green dream branches merge to
`main` at the end of the run (dream.md step 6) and ship with that update;
decisions and red-gate work are filed into `~/virgil-tasks/inbox/` for the
catcher. `/loop /editor/dream` on an interval remains a supported manual mode —
same since-last-dream selection, and a same-day re-run rotates the prior digest.

## The unified engine: `iterations/` and `memos/` (chip 19)

There is **one** dev-loop engine — { read a structured critique memo → derive
proposed skill-markdown changes → route each through the boundary guard → land
it → record } — with **two entry points** into it:

| Entry point | Input | Skills | Cadence | Lands edits |
|---|---|---|---|---|
| [`/editor/iterate-virgil-editor`](../skills/iterate-virgil-editor.md) | **synthesized** + sandboxed | single skill | **synchronous** (you watch) | **inline** in the working tree (no commit) |
| [`/editor/reflect`](../skills/reflect.md) + [`/editor/dream`](../skills/dream.md) | **real** invocations (chip-17 memos) | cross-skill | **ambient** overnight batch | acts-on-branch / **proposes-via-worktree** / digest |

What the two **genuinely share** — and now use by construction, not convention:

1. **One critique-memo shape + one reader.** Both streams' memos carry reflect's
   frontmatter + the four buckets + a tier, and **both are read by the one
   reader** [`reflect._parse_memo`](../scripts/reflect.py) — there is no second
   parser. iterate's old `[block]`/`[nice-to-have]` critique maps onto it:
   `[block]` → `flagged` + the `issues` bucket; `[nice-to-have]` → `noted` +
   `streamlining`; ambiguities → `issues`; judgment calls → `alignment`.
2. **One boundary guard.** Both route every proposed change through
   [`dream_land.classify_change`](../scripts/dream_land.py) → `acts` / `proposes`
   / `refused` — the same three boundaries (B1/B2/B3) the loop cannot cross.
3. **The read→derive→route spine**, [`dev_loop.py`](../scripts/dev_loop.py),
   composes the reader + the vocabulary + the guard. `dream` consumes the reader
   + guard directly (`dream.py`/`dream_land.py`); `iterate` consumes them through
   `dev_loop`'s two iterate-facing seams — `write_iteration_memo` (the unified
   writer for the `iterations/` stream) and `route_edits` (the guard-adoption
   partition: `acts` → land inline · `proposes` → land inline **and flag for a
   separate pass** · `refused` → block + log). No second reader, no second guard.

What stays **specialized** (and is deliberately *not* merged):

- **Input acquisition + cadence.** iterate synthesizes its own requests, clones a
  sandbox, and spawns a runner subagent per attempt; reflect/dream select real
  memos since the last dream and batch them. iterate converges per-case; dream
  digests once a night.
- **⚠ The autonomy layer is `dream`-only.** Because `dream` runs **unattended**,
  its `proposes` verdict means *stage it in a `dream/<date>` worktree for review*.
  `iterate` runs **synchronously with the maintainer watching the diff**, so it
  adopts `dream_land` purely as a **boundary guard**: it honors `refused` (the
  safety net it previously lacked), **surfaces** a `proposes`-class verdict as
  "extra scrutiny / consider a separate pass," and lands every non-refused edit
  **inline** — it never stands up a worktree and never commits. iterate did **not**
  inherit dream's acts-on-branch / propose-via-worktree machinery.

So `iterations/` and `memos/` are **two labeled streams, one shape** — kept
separate on purpose (the dream consumes only `memos/`; iterate consumes only
`iterations/`, inline) because their *input class* differs (synthesized stress
tests vs real ambient captures), while sharing the one memo shape, the one
reader, and the one guard. The iterate memo is stream-labeled `stream: iterations`
and carries iterate-only frontmatter (`case`, `attempt`, `sandbox`, `blockCount`,
`niceCount`) + the per-attempt actions log as body sections the shared reader
tolerates.

| Dir | Written by | Input | Shape |
|---|---|---|---|
| `editor/dev/iterations/` | `/editor/iterate-virgil-editor` (via `dev_loop.py`) | **synthesized** requests, single skill, synchronous | unified: frontmatter + 4 buckets + 3 tiers |
| `editor/dev/memos/` | `/editor/reflect` (via `reflect.py`) | **real** invocations, every skill, ambient | unified: frontmatter + 4 buckets + 3 tiers |
| `editor/dev/sandboxes/` | `/editor/iterate-virgil-editor` | per-attempt sample clones | (scratch) |

One nuance on gating: the **`memos/` stream is DEV-gated** (ambient capture must
never run for an end user), but the **`iterations/` stream is not** — iterate is
an explicit, synchronous test a maintainer invoked, so `dev_loop.write_iteration_memo`
writes regardless of `VIRGIL_DEV` (it never runs in an end-user session anyway —
it requires the repo + the sample fixture).

### What the dream consumes (chip 18 — built)

The dream reads the chip-17 memos since the last dream, keying on the
frontmatter: `flagged` first (and any `fixNow: true` on the fast-path),
`noted` grouped by skill + bucket, `unremarkable` only counted. It filters by
`result` for its audits (rejection corpus / silent-edit audit / refusal
patterns). It then routes each change (`acts` lands single-skill-prompt polish
directly; `proposes` stages cross-skill / script / manifest / contract changes
in a worktree; `refused` blocks a boundary crossing) and writes a morning
digest to `editor/dev/dream-digests/` — all detailed under
[The dream phase](#the-dream-phase-night-half) above. Forward-compat: the §15
rules still hold — reserved overlay paths stay in the sync deny-list,
`result: rejected` rows are kept indefinitely (rejection-fidelity for future
retro-learning), and there is no user-dream (v2).

## Tests

`editor/scripts/tests/test_reflect_capture_slice.py` — the **capture** slice:
each `result` value → the right tier/bucket; DEV-off → no memo; the user-tag
tier promotion; idempotent re-run.

`editor/scripts/tests/test_dream_slice.py` — the **dream** slice: acts-vs-
proposes routing by scope; boundary-refusal for each of the three; the
flagged+fix-now fast-path; the since-last-dream selector (already-digested memos
skipped); the digest with ACTED+PROPOSED+REFUSED entries; and the bootstrap
(a `skill=dream` memo the next dream reads).

`editor/scripts/tests/test_unify_slice.py` — the **unification** slice (chip 19):
the one engine has no forks (`dev_loop` reuses `reflect._parse_memo` +
`dream_land.classify_change` + `reflect._render_buckets` by identity); a reflect
memo and an iterate memo parse via the **one** reader into the same structure;
the `[block]`→`flagged`/`[nice-to-have]`→`noted` + bucket mapping; iterate's
boundary-refusal (the three boundaries → blocked + not landed); a normal
single-skill prose edit lands inline; a cross-skill survey edit is surfaced
(`proposes`, landed inline + flagged) and **not** auto-worktree'd; the
iterations stream is DEV-ungated.

Run the whole editor suite with:

```bash
for t in editor/scripts/tests/test_*.py; do python3 "$t"; done
```
