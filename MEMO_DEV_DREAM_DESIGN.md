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

---

## Appendix A — Chip 17: ready-to-dispatch prompt
_The next session's first dispatch (spawn_task). The deep framing (§6) is baked in. Chip 18 (the dream phase) firms up after 17 lands — its iterate↔dream unification depth depends on 17's shape._

```
MISSION
Build the DEV-mode CAPTURE LAYER — the "day" half of the dev-dream self-improvement
loop (MEMO_DEV_DREAM_DESIGN.md; EDITOR_SKILLS_V1.html §14). When DEV mode is on, every
editor-skill invocation is followed by a reflection that writes a tiered memo. Build it
as ONE shared mechanism, not a per-skill bolt-on. This chip is the capture layer ONLY —
NOT the dream phase (that's chip 18).

This is part of the management-run "v1 skill-base build". You are chip 17. The v1 spine
(Phase 4 + L3 + manifest + writeback unification, chips 11–16) is complete. Implement on
your own branch, commit, and report back; do NOT push or merge.

WHERE TO BASE
Fresh worktree off `main` (includes chips 11–16 + the DEV design memo). `main` may not be
checked out (concurrent atoms / card-refactor / chrome-geometry sessions hold the main
worktree on their own branches) and/or may have advanced — verify your base includes chip
16 (`git merge-base --is-ancestor 0600625 HEAD`) and self-heal (`git merge --ff-only main`)
if cut from an older base. No npm install — symlink node_modules read-only to run
`npm run check:coherence`, then remove it. Commit to your branch; do NOT push/merge.

REQUIRED READING (in order)
- MEMO_DEV_DREAM_DESIGN.md — the whole design; esp. §3 (what's logged: 4 buckets, 3 tiers,
  the memo location), §6.1 (the deep capture framing: ONE shared /editor/reflect + ONE
  editor/AGENTS.md convention, riding the contract's `result` field), §8 (open Qs: toggle,
  trigger).
- EDITOR_SKILLS_V1.html §14 (frozen spec for DEV mode + the memo) + the §13 I/O table.
- editor/skills/iterate-virgil-editor.md — the existing dev meta-skill; its memos live in
  editor/dev/iterations/ (gitignored). Your memos (editor/dev/memos/) are the sibling —
  note the relationship; chip 18 unifies them. Do NOT refactor iterate here.
- editor/scripts/apply_response.py — the two-field status/result vocab (RESULT_* constants);
  editor/scripts/list_requests.py — how a Task's status/result is read. Reflection CONSUMES
  `result` (the outcome is already classified by the contract); it does not re-derive it.
- editor/AGENTS.md — the skill-conventions section (where the ONE reflect convention lands)
  + the "Done:" one-line reply convention.
- editor/scripts/_common.py — paths/json helpers; the editor/dev/ gitignore.

FRAMING (the deep / unifying angle)
The shallow version bolts a "now write a memo" step onto each of the ~20 skill files →
drift, and the exact superficial-patch anti-pattern. The deep version is ONE shared seam:
a single /editor/reflect skill (the memo-writer) + ONE convention in editor/AGENTS.md
("in DEV mode, reflect after completing any skill"), so the whole skill set inherits
reflection from one edit and any future skill inherits it free. Reflection reads the Task's
two-field `result` (silent-applied / auto-applied / accepted / rejected / refused / … —
ALREADY classified by the contract chips 3–16 built) + the skill's `Done:` line + the
paragraph-context helpers. The capture layer is a thin unified seam on top of the contract,
not new per-skill machinery.

LOCKED DECISIONS (do not relitigate)
- Scope = the CAPTURE LAYER only (toggle + reflect mechanism + memo schema/tiers/location).
  The DREAM phase (/editor/dream, landing modes, digest, boundaries) is chip 18 — do NOT build it.
- ONE shared mechanism: /editor/reflect + ONE editor/AGENTS.md convention. NO per-skill
  memo-writing steps added to individual skill files.
- Reflection reads the Task's two-field status/result (don't re-derive the outcome) + the
  `Done:` stdout + para-context.
- Memos → editor/dev/memos/<YYYY-MM-DD>/<HH-MM-SS>-<skill>.md, GITIGNORED (mirror
  editor/dev/iterations/). Distinct from the library memo stream — never mix.
- Memo schema: 4 buckets (issues/ambiguities/errors · streamlining/repetition · alignment/fit
  · user-tagged) + 3 tiers (unremarkable / noted / flagged) + the `fix-now` flag. Class set
  at write time; the DEV user can promote a tier by appending a tag.
- Toggle = `VIRGIL_DEV=1` env var (simpler, truly per-session, can't ship to users) UNLESS
  you find a strong reason for a document-settings.json flag — justify in the report if you
  deviate. NEVER enabled in end-user sessions.
- Don't violate the §15 forward-compat rules (reserved overlay paths stay in the sync
  deny-list; result:rejected rows kept; etc.) — natural here; just don't break them.

DELIVERABLES (scope IN)
1. editor/skills/reflect.md — the dev-only /editor/reflect <skill> <taskId>: reads the Task's
   status/result + outcome + para-context, classifies the tier, writes the memo (4 buckets)
   to editor/dev/memos/<date>/. Idempotent; no-ops/refuses outside DEV mode.
2. The DEV-mode toggle: VIRGIL_DEV detection (a small _common.py helper) + the gate (reflect
   runs only when DEV is on).
3. The ONE editor/AGENTS.md convention ("in DEV mode, reflect after completing any skill via
   /editor/reflect") — the single seam; have the umbrella /editor/review enforce it for
   dispatched subskills so it's robust, not just hope-the-model-remembers.
4. The memo schema documented in reflect.md + a short editor/dev/README.md (the one SSOT for
   the dev-loop subsystem, per §6.3).
5. editor/dev/ gitignore for memos/ (mirror iterations/).
6. Tests (editor/scripts/tests/): a reflect-capture slice — a completed Task with each
   `result` value → assert the memo lands with the right tier/bucket; DEV-off → no memo;
   user-tag tier-promotion.

SCOPE OUT (hands off)
- The DREAM phase (chip 18). Refactoring iterate-virgil-editor / unifying iterations↔memos
  (chip 18 — the engine extraction; here, just NOTE the relationship). No src/ changes (the
  toggle is read-only env/sidecar detection). No version bump, no release.

DESIGN PRINCIPLE
The unified, deep solution: one shared reflect seam riding the contract's `result` field,
not ~20 per-skill memo steps. Make "every skill reflects" true by construction (one
convention) — a future skill inherits reflection for free.

DOC-GRAPH DISCIPLINE
If editor/dev/README.md (or any docs/workspace doc) becomes a maintained doc, give it the
born-enforced header + keep `npm run check:coherence` at 0 errors. Re-stamp any maintained
doc you edit. Run the full Python suite (editor/scripts/tests/*.py) — all pass; add the
reflect-capture slice.

REPORT BACK (structured)
- The /editor/reflect mechanism + the ONE convention (show the editor/AGENTS.md seam) —
  confirm NO per-skill bolt-ons.
- The toggle (env var vs settings flag + why) + how reflect is gated to DEV-only.
- The memo schema (buckets/tiers/fix-now) + the `result`→signal mapping (how it consumes the
  contract's result).
- editor/dev/README.md (the subsystem SSOT) + the gitignore.
- Coherence (0 errors) + the full Python suite + the new reflect-capture slice.
- The branch name; how chip 18 (dream) will consume these memos; anything flagged for chip 18
  (esp. the iterate↔dream unification).
```

### Chip 18 (sketch — finalize after 17)
`/editor/dream` built as the **generalization of `iterate-virgil-editor`** (shared engine — §6.2): reads the chip-17 memos since the last dream → cross-memo pattern detection → the **two landing modes** (acts-directly on `main` for single-skill-prompt polish · proposes-via-worktree for cross-skill / script / manifest / contract changes) → the `fix-now` fast-path → the dream-digest → the **three enforced boundaries** (can't touch `editor/AGENTS.md` Don't-rules, the `apply_response.py` contract shape, or DEV mode itself). Tests: acts-vs-proposes routing by scope; boundary-refusal; the bootstrap memo-on-itself. (If the iterate↔dream engine extraction proves large, split it into a chip 17.5 first.)
