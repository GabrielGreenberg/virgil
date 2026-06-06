---
description: |
  Developer-only — write a dev-dream reflection memo after an editor-skill
  invocation. This is the "day" capture layer of the self-improvement loop
  (EDITOR_SKILLS_V1 §14). Triggers ONLY in a DEV-mode session (VIRGIL_DEV=1):
  as the automatic follow-up the editor/AGENTS.md convention attaches to every
  completed skill, or on an explicit "reflect on that", "capture a dev memo",
  "put this in the memo <note>" from a Virgil maintainer. Reads the Task's
  already-classified status/result, derives the tier, and writes a 4-bucket
  memo to editor/dev/memos/<date>/. NO-OP outside DEV mode. Does NOT trigger
  for end-user requests ("review my doc" → /editor/review) and never edits a
  paper file. Args: <docPath> <skill> <taskId> [--tag <note>] [--fix-now].
---

# /editor/reflect $ARGUMENTS

Write one **dev-dream reflection memo** about a skill invocation you just
completed. This is the capture half of the developer self-improvement loop
(design: [MEMO_DEV_DREAM_DESIGN.md](../../MEMO_DEV_DREAM_DESIGN.md); subsystem
SSOT: [editor/dev/README.md](../dev/README.md)). The overnight `/editor/dream`
pass (chip 18) reads these memos.

You are **not** re-judging the outcome. The two-field `status`/`result`
vocabulary (EDITOR_SKILLS_V1 §7) was already stamped by the `apply_response`
contract when the skill landed. Reflection **consumes** `result` — the script
maps it to the memo's tier floor and the dream's filter key. Your job is the
*qualitative* layer: fill the four buckets from what actually happened.

## When this runs

Only in **DEV mode** (`VIRGIL_DEV=1`). The single convention in
[editor/AGENTS.md](../AGENTS.md) ("Reflection (DEV mode)") attaches this as the
follow-up to every completed skill, and `/editor/review` enforces it for each
subskill it dispatches. The mechanical script is gated too: if `VIRGIL_DEV` is
unset it writes nothing and exits 0, so an accidental invocation in a non-dev
(or end-user) session is a safe no-op. **Never** turn this into a per-skill
step copied into other skill files — the one convention is the whole seam.

## Args

```
/editor/reflect <docPath> <skill> <taskId>            # reflect on a completed invocation
/editor/reflect <docPath> <skill> <taskId> --tag "…"  # after-the-fact "put this in the memo"
/editor/reflect <docPath> <skill> <taskId> --fix-now  # mark the fast-path (flagged + fix-now)
```

- `<docPath>` — the paper folder the skill ran against (read-only here; we only
  read its Task queue).
- `<skill>` — the skill that just ran (e.g. `draft-suggestion`), bare name.
- `<taskId>` — the `ai-requests.json` id, a `bib-review-requests.json` bibKey, a
  `virtual:<panel>:<cardId>` card-flag id, or `-` for a Task-less mechanical op
  (a card-op / writes-only edit that completed no Task).

## Procedure

1. **Reflect on the run.** Before composing, recall: where was the skill
   markdown ambiguous? where did you ask the user or make a low-confidence A/B
   call? did a Don't-rule nearly break? was there inline work that should be a
   helper, or a fact you re-derived? did the default differ from what the user
   wanted? Sort what you find into the **four buckets** (below). A clean,
   frictionless run legitimately has all-empty buckets — that is the common case
   and becomes an `unremarkable` memo; do not invent friction.

   You already have the outcome — the Task's two-field `status`/`result` is
   stamped (reflection reads it, never re-derives it) and the script records it.
   When reflecting on a run you did not personally execute (the umbrella
   dispatched it to a subagent) or after the fact, ground the memo in the
   worked-on text with the para-context helper:
   `python3 editor/scripts/get_para_context.py <docPath> <uuid>` (the Task's
   `paragraphIds`, which the memo also records in frontmatter).

2. **Judge your confidence.** If you were genuinely unsure you did the right
   thing, set `confidence: "low"` — the script promotes the memo to `flagged`.

3. **Write the memo** by handing the qualitative layer to the script, which
   does the gate, the `result`→tier classification, and the write:

   ```bash
   python3 editor/scripts/reflect.py <docPath> <skill> <taskId> \
     --memo-json '{
       "buckets": {
         "issues":       "<ambiguities / where you asked / a near-miss Don'\''t-rule, or empty>",
         "streamlining": "<inline ops that want a helper / re-discovered facts, or empty>",
         "alignment":    "<default ≠ what the user wanted / a principle that felt off, or empty>"
       },
       "confidence": "high",
       "summary": "<the skill'\''s one-line Done: reply>"
     }'
   ```

   Omit a bucket that is empty. The script seeds a canned note for a
   signal-bearing outcome (rejected / refused / impossible / errored) only where
   you left the matching bucket blank, so the memo is never empty when the
   outcome itself is the signal.

4. **User tag (the "put this in the memo" path).** When the maintainer says
   "put this in the memo: …", re-invoke with `--tag` (repeatable). It is
   additive — it appends to the existing memo for that Task and promotes the
   tier to `flagged`, preserving the analytic buckets:

   ```bash
   python3 editor/scripts/reflect.py <docPath> <skill> <taskId> --tag "<their note>"
   ```

5. **Echo the script's `Done:` line.** It reports the tier and the memo path.

The call is **idempotent**: re-running the same `<skill>` for the same
`<taskId>` updates that one memo (keyed on skill + Task, not the timestamped
filename) — tier only ever rises, tags accumulate deduped. A *different* skill
on the same Task (the propose→accept lifecycle — `draft-suggestion` then
`accept-suggestion`/`reject-suggestion` share a taskId) gets its own memo.

## The memo schema (what the script writes)

Memo → `editor/dev/memos/<YYYY-MM-DD>/<HH-MM-SS>-<skill>.md`, **gitignored**,
repo-side — the sibling of `editor/dev/iterations/` (the `/editor/iterate-virgil-editor`
memos). It is **distinct** from the per-paper cowork memo stream
(`<docPath>/.virgil/memos/`) and the library memo stream
(`~/Virgil-Library/.virgil/memos/`) — the dev-loop stream never mixes with
either.

**Four buckets** (the qualitative layer you supply):

| Bucket | What goes here |
|---|---|
| Issues / ambiguities / errors | unclear prompt; where it asked the user; a mid-task correction; a low-confidence A/B; a near-miss Don't-rule |
| Streamlining / repetition | inline multi-step ops that should be a helper; facts re-discovered inline; awkward call sequences; cross-skill duplication |
| Alignment / fit | default ≠ what the user wanted; a principle that felt wrong/under-specified; a concept the manifest doesn't cover |
| User-tagged | the maintainer's "put this in the memo" notes (via `--tag`) — always promotes to `flagged` |

**Three tiers** (set by the script so the dream isn't drowned — most runs are noise):

| Tier | When | Dream treatment |
|---|---|---|
| `unremarkable` | clean run, no friction (default for a routine outcome) | counted for stats, not read individually |
| `noted` | friction / a non-obvious choice / a turned-down draft (`rejected`, `refused`, `impossible`) | read individually, grouped by skill + bucket |
| `flagged` | user-tagged, low self-confidence, an error, or a near-miss | read first; `--fix-now` queues an immediate narrow pass |

**The `result` → tier floor** (the contract already classified the outcome; the
script only maps it — your `confidence`/`--tier`/`--tag`/`--fix-now` can raise
the floor, never lower it):

| `result` | tier floor | dream lens |
|---|---|---|
| `silent-applied` / `auto-applied` / `direct-created` / `accepted` | `unremarkable` | the silent-edit audit reads the silent-applied ones |
| `rejected` | `noted` | the rejection corpus |
| `refused` / `impossible` | `noted` | the refusal patterns |
| `errored` | `flagged` | something broke |
| none (a Level-3 draft awaiting review, or a Task-less op) | `unremarkable` | the accept/reject reflection comes later |

`fix-now` is the fast-path flag: a `flagged` memo that warrants an immediate
single-memo dream pass rather than waiting for the overnight batch.

## Relationship to `/editor/iterate-virgil-editor`

`iterate` is the **manual, synthesized-input, single-skill** precursor; its
memos live in `editor/dev/iterations/`. `reflect` is the **ambient, real-input,
every-skill** sibling; its memos live in `editor/dev/memos/`. As of **chip 19**
the two are **one engine**: both memo streams share this **one shape** and are
read by the **one** reader (`reflect._parse_memo`); both route skill edits
through the **one** boundary guard (`dream_land`). They stay two *labeled*
streams (different input class — synthesized stress tests vs real ambient
captures), not two shapes. See [editor/dev/README.md](../dev/README.md).

## Hard rules

- **DEV mode only.** The script no-ops without `VIRGIL_DEV=1`. Never write a
  memo by hand to dodge the gate.
- **Read-only on the paper.** Reflection reads the Task queue; it writes **only**
  to `editor/dev/memos/`. It never touches a paper file, so it needs no pen and
  no `apply_response` contract.
- **One seam, no bolt-ons.** Reflection lives in this one skill + the one
  editor/AGENTS.md convention. Do not add "now write a memo" steps to other
  skills.
- **Never route to `<docPath>/.virgil/memos/`** — that channel is cowork dev
  memos *about a paper*, not about Virgil's skill set.

## Reply format

Echo the script's one-line `Done:` reply (tier + memo path). If DEV mode is
off, say so in one line and stop.
