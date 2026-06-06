# Virgil editor dev-loop — the self-improvement subsystem

This is the **single source of truth** for `editor/dev/` — the developer-only
loop that refines Virgil's editor skill set over time. It is a *developer*
affordance, never an end-user feature.

Design source: [MEMO_DEV_DREAM_DESIGN.md](../../MEMO_DEV_DREAM_DESIGN.md) ·
frozen spec: `EDITOR_SKILLS_V1.html` §14 · conceptual home:
[docs/architecture/VIRGIL.md → Cowork pattern](../../docs/architecture/VIRGIL.md).

> **Status.** The **day half** (the capture layer — this doc's main subject) is
> built (chip 17). The **night half** (`/editor/dream`) is chip 18 — described
> here only as the consumer the capture layer feeds.

## The loop, in one picture

```
   Day (DEV mode ON)                        Night (dream phase — chip 18)
   skill runs ─► /editor/reflect                 /editor/dream
                 writes a tiered memo to    ├─ read all memos since last dream
                 editor/dev/memos/          ├─ detect cross-memo patterns
                 <date>/<time>-<skill>.md   ├─ edit skill markdown / helpers /
   you: "put this in the memo" ──┘             refactor / update the manifest
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
it is truly per-session, has **no UI surface and no on-disk presence**, and so
**cannot ship to an end user**. An end-user paper folder may carry the (inert)
`reflect` skill + script via the normal bundle sync, but the gate stays off —
so **no memo is ever written outside a dev session.** OFF is the default and the
safe failure mode (a typo'd export never silently turns capture on).

```bash
VIRGIL_DEV=1 claude        # a dev session: skills reflect
claude                     # a normal session: reflection is a no-op
```

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
  `editor/dev/memos/`, so it needs no pen and no `apply_response` contract.
- **The convention** lives once in
  [editor/AGENTS.md → Skill conventions](../AGENTS.md) ("Reflection (DEV
  mode)"): *in DEV mode, reflect after completing any skill.* The umbrella
  [`/editor/review`](../skills/review.md) **enforces** it for every subskill it
  dispatches, so "every skill reflects" is true by construction, not by hoping
  each subagent remembers.

### It consumes the contract — it does not re-derive the outcome

The two-field `status`/`result` vocabulary (EDITOR_SKILLS_V1 §7, built by chips
3–16) already classifies each Task's outcome. Reflection **reads** `result` and
maps it to the tier floor and the dream's filter key — the rejection corpus is
`result: rejected`, the silent-edit audit is `result: silent-applied`, the
refusal patterns are `result: refused`. The capture layer is a thin seam on top
of the contract, not new per-skill machinery.

## The memo

Path: `editor/dev/memos/<YYYY-MM-DD>/<HH-MM-SS>-<skill>.md` — **gitignored**
(see [.gitignore](../../.gitignore)), repo-side. It is the sibling of
`editor/dev/iterations/` and is **distinct** from the per-paper cowork memo
stream (`<docPath>/.virgil/memos/`) and the library memo stream
(`~/Virgil-Library/.virgil/memos/`). The three streams never mix — different
audience, different consumer.

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

## `iterations/` vs `memos/` — and chip 18

| Dir | Written by | Input | Shape |
|---|---|---|---|
| `editor/dev/iterations/` | `/editor/iterate-virgil-editor` | **synthesized** requests, single skill, synchronous | `[block]`/`[nice-to-have]` critique |
| `editor/dev/memos/` | `/editor/reflect` (this loop) | **real** invocations, every skill, ambient | 4 buckets / 3 tiers |
| `editor/dev/sandboxes/` | `/editor/iterate-virgil-editor` | per-attempt sample clones | (scratch) |

These are two memo shapes for one purpose. **Chip 18 unifies them under one
engine** — `iterate` becomes the "synthesized-input, single-skill, synchronous"
special case of the same reflect→read→edit loop the `dream` phase runs
ambiently. **Do not refactor `iterate` to chase that here** (chip 17 only notes
the relationship).

### What chip 18 (`/editor/dream`) will consume

The dream reads the chip-17 memos since the last dream, keying on the
frontmatter: `flagged` first (and any `fixNow: true` on the fast-path),
`noted` grouped by skill + bucket, `unremarkable` only counted. It filters by
`result` for its audits (rejection corpus / silent-edit audit / refusal
patterns). It then acts (single-skill-prompt polish lands directly; cross-skill
/ script / manifest / contract changes propose via a worktree) and writes a
morning digest to `editor/dev/dream-digests/`.

**Flagged for chip 18** (not built here): the dream's two landing modes, the
`fix-now` fast-path execution, the digest, and the three enforced boundaries
(the dream cannot edit the `editor/AGENTS.md` Don't-rules, change the
`apply_response.py` contract shape, or disable DEV mode itself). Forward-compat:
the §15 rules still hold — reserved overlay paths stay in the sync deny-list,
`result: rejected` rows are kept indefinitely (rejection-fidelity for future
retro-learning).

## Tests

`editor/scripts/tests/test_reflect_capture_slice.py` — the capture slice: each
`result` value → the right tier/bucket; DEV-off → no memo; the user-tag tier
promotion; idempotent re-run. Run the whole editor suite with:

```bash
for t in editor/scripts/tests/test_*.py; do python3 "$t"; done
```
