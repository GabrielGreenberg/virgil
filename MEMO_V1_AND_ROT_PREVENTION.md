# Memo: Virgil v1 skill set + rot-prevention discipline

**Purpose:** orient the next session — a management session that will spin off chips, starting with rot-prevention work. This memo is the comprehensive primary context. Detailed designs live in linked artifacts.

**Status:** v1 spec frozen. Rot-prevention discipline articulated. Nothing built yet.

---

## Part 1: Rot-prevention strategy

### The diagnosis

Virgil has (or will have) 7–9 layers describing "what Virgil is." Without discipline they will drift independently and the system will turn to mush.

Current layers:

| Layer | Where it lives | Maintained by |
|---|---|---|
| Code (operational truth) | `src/`, `library/`, `editor/` | Day-to-day work |
| Type definitions (schema truth) | `src/lib/types.ts` | Day-to-day work |
| Dev-facing agent docs | `docs/agents/*.md`, `AGENTS.md` | `/cleanup-virgil` step 2 at release (existing mechanism) |
| Design intent record | `EDITOR_SKILLS_BRAINSTORM.html` | Hand-edited; frozen once a decision is made |
| Build target spec | `EDITOR_SKILLS_V1.html` | Hand-edited; frozen at start of v1 build |
| README | `README.md` | Currently stale |
| **Future:** workspace manifest | `docs/workspace/` → `.claude/virgil/` | Not yet built |
| **Future:** UX library | `docs/ux/` → `.claude/virgil-ux/` | Not yet built |
| **Future:** skill prompts | `editor/skills/*.md` → `.claude/commands/editor/` | Hand-edited per skill |

The mechanism in `/cleanup-virgil` step 2 is the right shape but narrow:

- Each doc carries `<!-- last-verified: <sha> <date> -->`.
- Each doc has a known set of code paths it covers.
- At every release, cleanup-virgil diffs the code against the last-verified sha and updates docs where drift appears.
- Headers get bumped to certify the check.

This works for the 6 agent docs it currently covers. The challenge is extending it to the new layers without proliferating duplicate sources of truth.

### The three-layer model

```
Layer 1 — OPERATIONAL TRUTH (the code)
   src/lib/types.ts, registries, hooks, TipTap extensions, parsers
   ↓ verifies against ↓
Layer 2 — CANONICAL ARCHITECTURE (hand-crafted, conceptual)
   docs/architecture/VIRGIL.md         ← THE source of truth
   docs/architecture/ontology.md
   docs/architecture/cowork-pattern.md
   docs/architecture/...
   ↓ derives ↓
Layer 3 — DERIVATIVE DOCS (some auto-generated, some hand-crafted)
   docs/workspace/  ← manifest source (ships to .claude/virgil/)
   docs/ux/         ← UX library source (ships to .claude/virgil-ux/)
   editor/skills/*  ← skill prompts (consume manifest at runtime)
   README.md
   AGENTS.md
```

**Layer 1 (code)** — existing ground truth for behavior. What the code does is what Virgil does.

**Layer 2 (architecture doc)** — the new piece. A canonical, hand-crafted, conceptual description of Virgil. When anyone asks "what is Virgil," this is THE answer. Exists once and only once.

**Layer 3 (derivatives)** — everything else. Each derivative has a clear upstream source:

- `docs/workspace/` → derives from Layer 2 + Layer 1 (types.ts)
- `docs/ux/` → derives from Layer 2 (concepts) + UI inspection
- `editor/skills/*` → consume Layer 3's manifest at runtime; don't carry duplicate knowledge
- `README.md` → derives from Layer 2 (overview) + the v1 spec (what ships)

### The four enforcement points

1. **`last-verified` + `derives-from` headers everywhere.** Every doc carries both:
   - `<!-- derives-from: ARCHITECTURE.md#section -->` names the upstream source.
   - `<!-- last-verified: <sha> <date> -->` names the last release this was checked against.

2. **Build-time regeneration where mechanical.** Some things are mechanically derivable and shouldn't be hand-crafted at all:
   - `sidecars.md` auto-generates from `types.ts`.
   - `cards.md` auto-generates from `types.ts` + the architecture doc's card-kind taxonomy.
   - `latex.md` auto-generates from `src/lib/latex-parser.ts`'s allowed-command list.
   - Parts of the README auto-generate from the architecture doc's overview section.
   
   Build script runs on `npm run dev` / `npm run build` and as part of cleanup-virgil. Diffs visible in git.

3. **`/cleanup-virgil` is the audit ratchet.** Every release, the cleanup skill walks the dependency chain:
   - Has the code changed in areas the architecture doc covers? → architecture doc gets reviewed/updated.
   - Has the architecture doc changed? → derivative docs get regenerated.
   - Derivative docs changed? → skill prompts consume new manifest at next sync.
   - README's sources changed? → README gets bumped.
   
   All of this happens in one place, at one boundary (release). No constant maintenance burden; no per-developer discipline; one ratcheted check.

4. **A coherence test.** A simple script (e.g., `tools/check-coherence.py`) that:
   - Verifies every concept named in the architecture doc appears in the code.
   - Verifies every public type in `types.ts` is documented in the architecture doc.
   - Verifies every cross-doc `derives-from:` reference points to something that exists.
   - Flags drift candidates.
   
   Runs on every PR. Won't catch everything, but catches the obvious cases.

### Why the brainstorm and v1 spec are not in the rot-prevention scope

These are *frozen artifacts* at different abstraction levels:

- **Brainstorm** = design intent record. Captures the conversation that produced the design. Future Claude or future you reads it to understand *why* decisions were made. NOT maintained against the code — it's a record of decisions.
- **V1 spec** = build target for the first shipping version. Frozen once the build starts. Future versions get their own spec.
- **Architecture doc** = the *living* description of what currently exists. Maintained against the code in perpetuity. Replaces and supersedes the v1 spec's role once the system is stable.

Lifecycle:

1. Brainstorm produces design intent.
2. V1 spec freezes the build target.
3. Build happens; v1 ships.
4. Architecture doc gets written (mirrors v1 spec at first, then maintained against code).
5. Future versions: brainstorm → vN spec → architecture doc updates → ship.

Brainstorm and v1 spec are project artifacts; the architecture doc is the living source of truth.

### Path forward — concrete steps

1. **Decide the canonical location.** Probably `docs/architecture/VIRGIL.md` + supporting sub-docs. Could be `docs/architecture/` or `docs/canonical/` or similar.

2. **Define the `derives-from` header convention.** What does the comment look like exactly? What's the contract? How is it enforced?

3. **Write the canonical architecture doc.** This is the substantial piece of work — covering Virgil's ontology, cowork pattern, code organization, etc. Happens after Phase 0 (code archaeology) of the brainstorm's §19 method plan, but BEFORE Phase 2 (manifest).

4. **Extend `/cleanup-virgil` step 2** to cover the new layers. Today it covers 6 agent docs; after this work it covers architecture doc + manifest + UX library + skill prompts + README.

5. **Build the coherence script** (`tools/check-coherence.py`) and wire to PR CI.

6. **Establish the build-time regeneration** for the mechanical layers — `sidecars.md`, `cards.md`, `latex.md`, parts of README. Hook into `npm run build` / cleanup-virgil.

### Open questions to resolve in the next session

- Exact path for the architecture doc (`docs/architecture/` vs. `docs/canonical/` vs. something else).
- Relationship between this and the existing `docs/agents/` — does the new architecture doc supersede the agent docs entirely, or do they coexist with different audiences (architecture = canonical truth; agents = how-to-work-on-the-codebase)?
- Should regeneration run in `npm run build` or only in cleanup-virgil? (Build = every dev cycle catches drift early; cleanup-virgil = only at release.)
- How does the architecture doc bootstrap? It depends on Phase 0 archaeology to extract current truth. Probably Phase 0 produces a "current-state report" that feeds the architecture doc's first draft.
- Does the brainstorm's §19 method plan need a new Phase 0.5 ("write the canonical architecture doc") between Phase 0 (archaeology) and Phase 2 (manifest)?

---

## Part 2: Skill v1

### What v1 is

The Virgil editor plus a Claude session that knows Virgil thoroughly and can mechanically manipulate its structures: cards, paragraphs, atoms, tasks, the bibliography, the preamble. The skill set is small and focused — about fifteen skills, all of them mechanical. They route, dispatch, edit cards, manage tasks, manage the bibliography, swap styles. They don't draft footnotes, write quotations, search for citations, restructure paragraphs, or compress prose. **All generative work happens in chat with Claude on demand, using v1's mechanical primitives as building blocks.**

**Design principle:** build the mechanics solidly first. Once Claude understands Virgil completely and can manipulate cards/atoms/paragraphs reliably, every smart operation a user could want can be composed on the fly in chat. No need to pre-design every smart skill; the mechanical layer is the substrate.

### The full spec

The standalone v1 spec lives at `EDITOR_SKILLS_V1.html` in the repo root. It's a self-contained 15-section document:

1. What v1 is
2. Virgil's ontology
3. What Claude knows about Virgil (the manifest + UX library)
4. Voice & persona
5. The two workflows (UI-initiated note-card-based + Claude chat)
6. Tasks vs Skills
7. Task status & result vocabulary
8. Safety levels (per-Task)
9. The editing lock (pen mechanism)
10. The v1 skill set (16 skills)
11. What's not in v1
12. `apply_response.py` contract (subcommand architecture)
13. Helper scripts
14. DEV mode + dev-dream
15. Forward-compatibility for v2 (user-dream layer)

**Read EDITOR_SKILLS_V1.html for full detail.** This memo gives the orienting summary.

### The 16 v1 skills

**Umbrella:**

- `/editor/review` — walk the unified Task inbox; dispatch each Task to its specialist skill as a subagent.

**Card-ops (new, parameterized + split per Decision C):**

- `/editor/create-card` — create a new card of the specified kind at the given anchor. Parameterized by `--kind=<note|todo|footnote|citation|quotation|example|annotation>`. User-supplied body; chat-Claude composes content for "smart" cases.
- `/editor/edit-card` — modify an existing card's body or fields.
- `/editor/archive-card` — move a card to archive.
- `/editor/restore-card` — restore from archive to prior panel.
- `/editor/move-card` — re-anchor a card to a different paragraph or atom.
- `/editor/link-cards` — create a bidirectional relationship link between two cards.

**Responders (routing only — strip to mechanical dispatch; don't draft response content):**

- `/editor/answer-note-request` — classify a flagged note's request and surface to chat-Claude.
- `/editor/answer-todo-request` — classify a flagged todo and surface to chat-Claude.
- `/editor/answer-cutter-comment` — classify a flagged Cutter comment and surface.
- `/editor/answer-revision-comment` — classify a flagged Revisions comment and surface.

**Bibliography (mechanical):**

- `/editor/answer-bib-review` — verify and fill bibliography fields against external sources, OR sync from library. (Annotation drafting deferred to chat-Claude.)
- `/editor/sync-bib-to-library` — reconcile the paper's bibliography against the library. **Catastrophic** — triggers a confirmation regardless of Task safety level.

**Style:**

- `/editor/style-merge` — merge user preamble customizations onto a target style. **Catastrophic** — triggers a confirmation regardless of Task safety level.

**Dev-meta (run from the repo by a developer, not by end users):**

- `/editor/iterate-virgil-editor` — stress-test the editor skill set in sandboxed sample papers.
- `/editor/dream` — overnight autonomous self-improvement pass. Reads DEV-mode memos; refactors / edits skills. Acts-directly for small in-place edits; proposes-via-worktree for substantive ones.

### What's NOT in v1

**Smart skills (replaced by chat-Claude using v1 mechanics + reasoning):**

- `draft-footnote` / `find-citation` / `draft-quotation` / `draft-suggestion` — content-generation skills.
- The revision family (`revise-compress`, `revise-cut-hedges`, `revise-flow`, etc. — ~25 skills sketched).
- The research family (`research-paragraph`, `find-source`, `extract-quote`, etc.).
- The file-prep family (`preflight`, `prep-file`, `convert-examples`, etc.).

**User-dream layer (deferred to v2):**

- User-dream skill (per-user voice/preference learning).
- `~/.virgil-user/` overlay storage.
- `<docpath>/.virgil/user-overrides/` per-doc layer.
- Runtime layering (app < user-global < per-doc).
- The `revise-with-feedback` meta-skill.
- Voice profile.

### Decisions locked in (full list in `EDITOR_SKILLS_BRAINSTORM.html` §20)

The brainstorm's decisions log has ~20 architectural decisions locked in. Key ones for v1:

- **Persona:** Claude IS Virgil for first-order users; Claude-as-Claude for dev work.
- **Ontology:** the Document + 5 primitives (TextObjects, Atoms, Cards, Omni-View gutters, Panels). Tasks are a Card kind.
- **Two workflows:** A (UI note-card-based) + B (Claude chat). No keyboard shortcuts.
- **Anchor resolution:** burden on whoever has context. Chat workflow asks if ambiguous; never guesses.
- **Task vs Skill:** Task = user-facing unit; Skill = internal. Reporting is per-Task.
- **Task status + result vocabulary:** two fields. `status` (pending / in-progress / complete / failed) + `result` (accepted / rejected / auto-applied / silent-applied / direct-created / refused / impossible / errored).
- **Safety levels:** per-Task (1: silent, 2: change+comment, 3: propose). User specifies in Workflow A; Claude asks in Workflow B. Catastrophic-op exception always confirms.
- **`apply_response.py` subcommands:** `complete-task` / `write-with-comment` / `write-silent` / `complete-only` / `revert` + `--synthesize-task` flag.
- **Pen-lock:** baked into apply_response. TTL-based crash recovery. Doc-level. Zero token cost.
- **Skill naming:** uniform `<verb>-<noun>`. Old names alias for one release cycle.
- **Granularity:** contextual split-vs-parameterize. Split when commandments differ; parameterize when only output shape differs.
- **Manifest:** focused folder `.claude/virgil/` with `INDEX.md` dispatcher.
- **Inbox is audit log:** every change registers a completed `ai-requests.json` Task. No separate audit file.
- **User-dream deferred to v2:** 5 forward-compat rules in v1.

### What's needed to build v1

The brainstorm's §19 method plan has the full phased build. Brief summary:

1. **Phase 0: Code archaeology** — extract current state from the codebase (XL effort; longest pole).
2. **Phase 0.5: Architecture doc** — (proposed addition) write the canonical architecture doc from Phase 0 findings. The rot-prevention work in Part 1 of this memo gates this.
3. **Phase 1: Blocker decisions** — already done (all four hard blockers resolved in the brainstorm).
4. **Phase 2: Operational manifest** — `docs/workspace/` content.
5. **Phase 3: UX library** — `docs/ux/` content.
6. **Phase 4: Existing-skill prompt updates** — rename, simplify the 13 existing skills.
7. **Phase 5: New-skill drafting** — the 6 new card-ops skills + 2 dev-meta (`dream`).
8. **Phase 6: Helper scripts** — 10 new mechanical primitives.
9. **Phase 7: DEV mode + dev-dream** — the self-improvement loop.
10. **Phase 8: UI affordances** — context menu, "Virgil as author" mark.

### Forward-compatibility for v2 (5 rules)

v1 must preserve architectural optionality so the user-dream layer can land cleanly later:

1. Reserve overlay paths (`~/.virgil-user/`, `<docpath>/.virgil/user-overrides/`) in the skill-bundle sync's deny-list.
2. Preserve inbox rejection-fidelity — no aggressive pruning of completed Tasks.
3. Skill prompts written for overlay-readiness — "these are the base rules unless overlay says otherwise" framing.
4. `apply_response.py` subcommands stay overlay-agnostic.
5. No `revise-with-feedback` skill in v1.

---

## Part 3: Existing artifacts in the repo

Files the next session should know about:

| File | What it is |
|---|---|
| `EDITOR_SKILLS_BRAINSTORM.html` | 20-section design brainstorm with full decision log. Design intent record. |
| `EDITOR_SKILLS_V1.html` | Frozen v1 spec — standalone 15-section build target. |
| `EDITOR_SKILLS_TOUR.html` | Tour of the existing 13 editor skills (current-state reference). |
| `SKILLS_TOUR.html` | Full skill tour covering library + editor. |
| `SKILL_PIPELINE.json` | Structured catalog of all 67 proposed skills (v1 + v2). |
| `SKILL_PIPELINE.csv` | Flat CSV version of the catalog. |
| `MEMO_V1_AND_ROT_PREVENTION.md` | This memo. |
| `editor/AGENTS.md` | Editor-side dev guide (existing). |
| `library/AGENTS.md` | Library-side dev guide (existing). |
| `docs/agents/*.md` | Repo-internal agent docs (maintained via `/cleanup-virgil` step 2). |
| `AGENTS.md` | Top-level index for agent docs. |
| `README.md` | Currently stale; will be regenerated from architecture doc + v1 spec. |

The brainstorm + v1 spec + this memo together give complete context. The TOUR docs and pipeline JSON/CSV are supporting reference.

---

## Part 4: How to use this memo in the next session

The next session is a **management session.** The user will spin off implementation chips via the `spawn_task` MCP tool (or equivalent). The management Claude:

- Holds the big picture (this memo + the linked artifacts).
- Coordinates the chips — decides what gets spun off, in what order, with what scope.
- Reviews chip outputs and integrates them back.
- Does not do implementation directly.

**The first chip will be rot-prevention** (Part 1 of this memo). Specifically:

1. Choose the canonical location for the architecture doc.
2. Write the canonical architecture doc itself (after Phase 0 code archaeology).
3. Extend `/cleanup-virgil` to cover the new layers.
4. Build the coherence script.
5. Establish build-time regeneration for mechanical layers.

The user has explicitly chosen this as the first chip because the rot-prevention discipline gates everything else — v1 building should respect the source-of-truth layering from day one, so every artifact written during v1 starts with the right discipline.

Subsequent chips (in rough order, per the brainstorm's §19 method plan):

- Phase 0: code archaeology → current-state report → seeds the architecture doc.
- Phase 2: write the operational manifest (`docs/workspace/`).
- Phase 3: write the UX library (`docs/ux/`).
- Phase 4: update existing skill prompts (rename + simplify).
- Phase 5: write new card-ops skills.
- Phase 6: write helper scripts.
- Phase 7: build DEV mode + dev-dream.
- Phase 8: src-side UI affordances (context menu, "Virgil as author" mark).

Each chip should be spun off with clear scope, the relevant brainstorm + v1 spec section references, and any preceding chip outputs.

---

## Quick links (read for context, in this order)

1. **This memo** (start here).
2. `EDITOR_SKILLS_V1.html` (full v1 spec).
3. `EDITOR_SKILLS_BRAINSTORM.html` §20 (decisions log) + §19 (method plan) for design intent and phase plan.
4. `SKILL_PIPELINE.json` (full skill catalog with v1/v2 split + scope metadata).
5. `editor/AGENTS.md` + `library/AGENTS.md` (current-state dev guides).
6. `docs/agents/*.md` (existing agent docs that already follow the `last-verified` pattern).
