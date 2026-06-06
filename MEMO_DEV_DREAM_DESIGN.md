# MEMO — DEV-mode + dev-dream: design hand-off

_Written 2026-06-05 for the next skill-base manager session. This is the **design source** for the **DEV-mode self-improvement loop** (v1 roadmap "Phase 7" / item #4) — the agreed **first task** of the next session. It is **designed, not built.** Sources: `EDITOR_SKILLS_V1.html §14` (frozen v1 spec) + `EDITOR_SKILLS_BRAINSTORM.html §18` (fuller rationale + the day/night diagram). The closest already-built analogue is `editor/skills/iterate-virgil-editor.md`._

---

## ⭐ Central design principle (the user's, restated — honor in every chip)
> Prefer **unified, deep, architectural solutions that capture a range of related phenomena** — avoid superficial, surgical patches. Whenever reasonable, take the deepest solution that *also improves the app.*

For dev-dream this has real teeth (see §6): the reflection capture must **not** be a per-skill bolt-on copy-pasted into ~20 skill files, and the dream phase should **generalize** the existing `iterate-virgil-editor`, not duplicate it.

---

## 1. What it is
A self-improving loop for the **developer** (not the end user): every skill invocation under DEV mode is followed by a **reflection memo**; overnight, a **dream** pass reads the accumulated memos and refines the skill set. v1 ships **dev-dream only** — the *user-dream* layer (per-user voice/preference learning) is deferred to v2, with forward-compat preserved (§9).

```
   Day (DEV mode ON)                       Night (dream phase)
   skill runs ─► reflection memo                /editor/dream
                 editor/dev/memos/         ├─ read all memos since last dream
                 <date>/<time>-<skill>.md  ├─ detect cross-memo patterns
   you: "put this in the memo" ───┘        ├─ edit skill markdown / write helpers /
                                              refactor skills / update the manifest
                                           └─ write a dream-digest for the morning
```

It is the **ambient, always-on, overnight-batch evolution** of the manual `/editor/iterate-virgil-editor` stress-test loop.

---

## 2. DEV mode (the toggle)
- A **per-session developer toggle** — spec says *"probably `VIRGIL_DEV=1` env var or a flag in `document-settings.json`"* (exact mechanism is an **open question**, §8).
- When on, every skill invocation gets a follow-up reflection pass that writes a memo.
- **Never enabled in end-user sessions** — there is no UI surface for users to flip it, and users can't save lasting skill changes anyway. Strictly a dev affordance.

---

## 3. What gets logged
Reflection memo → `editor/dev/memos/<YYYY-MM-DD>/<HH-MM-SS>-<skill>.md` (**gitignored**, repo-side, like the existing `editor/dev/iterations/`). **Distinct** from the library's memo stream (`~/Virgil-Library/.virgil/memos/`) — different audience + consumer; the two streams never mix.

**Four buckets:**
| Bucket | Examples |
|---|---|
| Issues / ambiguities / errors | unclear prompt; where it asked the user for help; where the user corrected it mid-task; low-confidence A-vs-B choices; where a Don't-rule almost broke |
| Streamlining / repetition | inline multi-step ops that should be a helper; facts re-discovered inline; awkward call sequences; cross-skill duplication |
| Alignment / fit | default ≠ what the user wanted; principles felt wrong/under-specified; concepts the manifest doesn't cover |
| User-tagged | "put this in the memo" → appended with full context (skill, paragraph, what happened, what you said) |

**Three tiers** (so the dream phase isn't drowned — 20+ memos/day, most noise):
| Tier | When written | Dream treatment |
|---|---|---|
| `unremarkable` | clean run, no friction (default for routine invocations) | counted for stats, not individually read |
| `noted` | friction / non-obvious choice / asked a clarifying question | read individually, grouped by skill + bucket |
| `flagged` | user-tagged, or low self-confidence, or a Don't-rule almost broke | read first; may trigger fast-path if marked `fix-now` |

Class is set at write time; the DEV user can **promote** a memo's tier after the fact by appending a tag.

**The signal is already half-built (a key unification).** The brainstorm notes the dream's outcome classification falls out of the contract's two-field `result` (which chips 3–16 built): rejection corpus = `result: rejected`; silent-edit audit = `result: silent-applied`; refusal patterns = `result: refused`. Reflection **consumes** the `result` field — it does not re-derive the outcome.

---

## 4. The dream phase
`/editor/dream` — an autonomous overnight pass (trigger: a scheduled job/cron, or `/loop /editor/dream` on a long interval).
- **Inputs:** all memos since the last dream + current skill markdown (`editor/skills/*.md`) + the script library (`editor/scripts/`) + the brainstorm/architecture docs + **git history** (to avoid undoing fresh work).
- **Process:** read all memos → detect cross-memo patterns → act → write a digest.
- **Two landing modes (scope-determined):**
  - **Acts directly** (lands on `main`): single-skill-prompt changes that don't change a behavior contract — tighten a Don't-rule, add a clarifying example, fix a typo, expand guidance. "ACTED" in the digest; user reverts via git.
  - **Proposes via worktree:** anything cross-skill, any script change, anything touching the manifest, any skill rename/merge/split, any behavior-contract change → runs in a git worktree, "PROPOSED" diff + a `git merge dream/<date>` hint; user reviews before landing.
- **Fast-path:** a memo marked `flagged` **and** `fix-now` → an immediate single-memo pass (acts-directly only, narrow scope). Anything bigger queues for the overnight run.
- **Digest:** always writes `editor/dev/dream-digests/<YYYY-MM-DD>.md` — the morning summary (ACTED + PROPOSED entries).
- **Bootstrap / recursion:** dream is itself a Virgil skill → it runs **in DEV mode itself**, writing memos about its own performance; the next dream reads the previous digest. "The first dreams will be the worst"; it improves at dreaming over time.
- **Boundaries — the load-bearing invariants the loop CANNOT cross:** dream **cannot** edit the architectural Don't-rules in `editor/AGENTS.md`; **cannot** change the `apply_response.py` contract shape; **cannot** disable DEV mode itself. (Enforce these in the dream skill, not just by convention.)

---

## 5. Relationship to `iterate-virgil-editor` (already built)
`iterate-virgil-editor` is the manual, narrow precursor: it synthesizes representative AI requests, clones the sample paper into a sandbox, runs a target skill via a fresh subagent, reads a structured critique memo from `editor/dev/iterations/`, edits the skill markdown, and loops until clean. **dev-dream is the generalization:** instead of synthesized test cases it captures *real* invocations passively (DEV-mode memos), and instead of a tight per-skill loop it runs a periodic cross-skill pattern-detecting pass. The deep move (§6.2) is to build dream so the two **share an engine** — `iterate` becomes the "synthesized-input, single-skill, synchronous" special case — rather than standing up a parallel duplicate.

---

## 6. The deep / unifying implementation framing (per the central principle)
Three places where the shallow approach would be a per-skill / parallel patch and the deep approach unifies:

1. **Reflection capture = ONE shared mechanism, not ~20 bolt-ons.** Do **not** append a "now write a reflection memo" step to each skill markdown file — that drifts and is exactly the superficial-patch anti-pattern. Instead: a single **`/editor/reflect <skill> <taskId>`** skill (the memo-writer) + **one shared convention** in `editor/AGENTS.md`'s skill-conventions section ("in DEV mode, reflect after completing any skill"), so the whole skill set inherits reflection from one edit. The reflection **reads the Task's two-field `status`/`result`** (outcome already classified by the contract) + the skill's `Done:` stdout line + the paragraph-context helpers — it consumes existing signal.
2. **Dream = generalize `iterate-virgil-editor`, don't duplicate it.** Extract the shared core (run/observe a skill · read a critique memo · edit skill markdown · the two landing modes) so both the manual stress-test (`iterate`) and the ambient overnight pass (`dream`) are entry points to one engine. This also folds the latent duplication between `editor/dev/iterations/` (iterate's memos) and `editor/dev/memos/` (dream's memos) into one reflection-memo shape.
3. **One coherent `editor/dev/` subsystem** with one SSOT (a short `editor/dev/README.md` or a `docs/workspace/`-style "dev-loop" manifest doc) — the toggle, the reflect mechanism, the memo schema+tiers, the dream pass, the digests, and the boundaries described once, not scattered across skill files.

---

## 7. Proposed chip decomposition (~2 chips; the manager finalizes)
- **Chip 17 — DEV-mode capture layer.** The toggle (decide env-var vs settings-flag) + the shared `/editor/reflect` mechanism + the one `editor/AGENTS.md` convention + the memo schema (4 buckets · 3 tiers · the `fix-now` flag) + the `editor/dev/memos/` location (gitignored). **Deep:** reflection rides the contract's `result` field; one convention, not per-skill edits. Deliverable: with DEV mode on, running any skill produces a correctly-classified memo. Editor-side, **no `src/`** (except possibly reading the toggle). Tests: a reflect-capture slice (each tier; the `result`→bucket mapping; user-tag promotion).
- **Chip 18 — the dream phase.** `/editor/dream` built as the **generalization of `iterate-virgil-editor`** (shared engine) + the two landing modes (acts-directly / proposes-via-worktree) + the fast-path + the dream-digest + the **boundaries enforced** (the three invariants). Deliverable: a dream run over a memo corpus produces ACTED edits + PROPOSED worktree diffs + a digest, and **refuses** to cross the boundaries. Tests: a dream slice (acts-vs-proposes routing by scope; boundary-refusal; the bootstrap memo-on-itself).
- *(Possible 3rd chip:* if the `iterate`↔`dream` engine-extraction (§6.2) proves large, split "extract the shared engine + refactor `iterate` onto it" into its own chip **before** chip 18. Decide once chip 17's shape is known.)*

---

## 8. Open questions (resolve in the chips / with the human)
- **Toggle mechanism:** `VIRGIL_DEV=1` env var vs a `document-settings.json` flag (spec: "probably"). Env var is simpler, truly per-session, and can't ship to users — lean that way unless an in-app dev toggle is wanted.
- **Reflection trigger:** the shared-convention approach (§6.1) is the recommendation; confirm it's robust — does the model reliably reflect after every skill, or does the umbrella `/editor/review` enforce it for dispatched subskills while a convention covers direct invocations?
- **Scheduling:** cron / a scheduled task vs `/loop /editor/dream` on a long interval. (`/loop` is simplest to start; a scheduled task is the steady-state.)
- **`iterate`↔`dream` unification depth (§6.2):** how much to refactor `iterate-virgil-editor` now (one shared engine — deepest) vs. share just the memo shape + a landing-mode helper (pragmatic).

---

## 9. Forward-compatibility (v1 = dev-dream only; user-dream is v2)
v1 ships **dev-dream**; **user-dream** (per-user voice/preference learning) is v2. `EDITOR_SKILLS_V1.html §15`'s forward-compat rules already protect this and the DEV chips must not violate them: reserved overlay paths (`~/.virgil-user/`, `<doc>/.virgil/user-overrides/`) stay in the sync deny-list; the Inbox keeps `result: rejected` rows indefinitely (rejection-fidelity for future retro-learning); skill prompts phrased so an overlay clause is a one-line addition; `apply_response` subcommands stay overlay-agnostic; no `revise-with-feedback` skill in v1.

---

## Sources
- `EDITOR_SKILLS_V1.html` — §14 (DEV mode + dev-dream, the frozen v1 spec), §13 (the `/editor/dream` skill row + the per-skill I/O table), §15 (forward-compat).
- `EDITOR_SKILLS_BRAINSTORM.html` — §18 (Self-improving skill base — DEV mode + two dreams; the day/night diagram, the memo buckets/tiers, the landing-mode rationale).
- `editor/skills/iterate-virgil-editor.md` — the built precursor (the manual special case dream generalizes).
- `editor/AGENTS.md` — the skill-conventions section (where the shared reflect convention lands) + the Don't-rules (a dream boundary).
