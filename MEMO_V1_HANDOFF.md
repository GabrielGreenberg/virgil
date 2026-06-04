# Virgil v1 skill-base build — session handoff

_Last updated: 2026-06-04, after releasing **v0.1.49**._

## How to use this doc
You are the **manager** of Virgil's v1 AI-cowork skill-base build. Work proceeds as **chips** — self-contained implementation tasks, each dispatched via the `spawn_task` tool, each run by a fresh agent in its own git worktree off `main`. Your job is to **scope each chip's prompt, dispatch it, verify its output, and merge it** — *not* to implement directly. The user spins the chip off (one click), pastes back its report; you review, merge, and recommend the next chip.

**If the user says "what's next?"** → read *Where we are* + *What's next* below and recommend the next chip. Default recommendation: the **existing-skill migration** (see the ranked list).

## ⭐ CENTRAL DESIGN PRINCIPLE (honor in every chip)
Prefer **unified, deep, architectural solutions that capture a range of related phenomena** — avoid superficial, surgical patches. Whenever reasonable, take the deepest solution that *also improves the app*. This is why the writeback contract is kind-agnostic, the manifest is one knowledge base, and the doc-graph has a single rooted source. Bake this framing into every chip prompt.

## Where we are
**Released v0.1.49** (first release shipping the v1 cowork stack). `main` is clean and **fully green**: `npm run check:coherence` → `0 errors, 0 warnings`.

Ten chips landed (each verified — tests + coherence — then merged):

| Chip | Delivered |
|---|---|
| 1 | Rot-prevention discipline + canonical `docs/architecture/VIRGIL.md`; the `last-verified`/`derives-from`/`covers-code` header convention (the rooted doc-graph) |
| 2 | Phase 0 archaeology — stable subsystems (markers, LaTeX vocab, reserved names) |
| 3 | `apply_response.py` **v1 contract** — named subcommands, atomic N-file write, editing-pen lock, two-field `status`/`result`, safety levels 1/2/3 — proven via the footnote slice |
| 4 | Phase 0 — card layer → **Phase 0 complete** (VIRGIL.md fully filled) |
| 5 | `tools/check-coherence.mjs` — the discipline **enforced** (5 checks; CI on push + npm script + wired into `/cleanup-virgil` step 2) |
| 6 | Operational manifest — foundational half (`docs/workspace/` ontology/identity/structure/atoms/latex + INDEX) |
| 7 | Operational manifest — card half (cards/sidecars/anchoring/gardening) |
| 8 | `create-card` fan-out — all createable kinds (note/todo/footnote/citation/report/report-request/example) on the contract; reconciled `ALL_KINDS`; cleared the last shadow warnings |
| 9 | Card-ops — `edit`/`move`/`archive`/`restore`/`link` (existing-card mutation ops on the contract) + `card_by_id.py` |
| 10 | Retire Phase-0 seed reports, rewire VIRGIL.md → manifest, **ship the manifest to `.claude/virgil/`** |

**The four pillars are built:** (1) rot-prevention discipline (built, enforced, demonstrated clearing real drift); (2) Phase 0 (VIRGIL.md is the canonical filled doc); (3) the kind-agnostic writeback contract; (4) the operational manifest (content-complete except `actions.md`, *and shipping*). Plus the full card-mechanics skill set (create + edit/move/archive/restore/link).

## The doc graph (the rot-prevention spine — how Virgil's knowledge stays honest)
- **`docs/architecture/VIRGIL.md`** = the single canonical "what Virgil is" (Layer-2 root). `AGENTS.md`'s codebase-guide index points to it.
- **`docs/workspace/*.md`** = the operational manifest (Layer-3; **ships to each paper's `.claude/virgil/`** so a cowork session can read it). `INDEX.md` is a per-task reading protocol.
- **`docs/agents/*.md` + `AGENTS.md`** = how-to-work-on-the-codebase derivatives.
- Every maintained doc carries `<!-- last-verified: <sha> <date> / derives-from: <doc#anchor> / covers-code: <paths> -->`. `tools/check-coherence.mjs` validates the edges (5 checks: edges resolve · types accounted · concepts→code · drift candidates · Python-shadow↔TS-registry). `/cleanup-virgil` step 2 runs the checker and uses its **check-4 drift list** to drive the release-time doc-refresh. **Born-enforced:** every new maintained doc gets the header block and must pass the checker.

## What's next (ranked — recommend #1 by default)
1. **Existing-skill migration (Phase 4) — RECOMMENDED.** The new card-ops are on the v1 contract, but the *old* skills still ride the LEGACY `apply_response` default-apply path: the responders (`answer-note`/`todo`/`cutter`/`revision`/`report-request`), `answer-bib-review`, `sync-bib-to-library`, `style-merge`, `find-citation`, `draft-footnote`/`draft-suggestion`, and the `/editor/review` umbrella. Migrate them onto the v1 contract + two-field status + safety levels. **This is the deep-unifying move** — it dissolves the legacy/v1 split into one contract for every skill. *Dependency:* the propose-flow skills (responders that draft suggestions) want **L3 accept→splice** (#2) complete — so either do L3 first, or migrate the non-propose skills first and circle back.
2. **L3 accept→splice.** Level 3 ("propose a change for review") is the one incomplete safety level: a proposal is *drafted* to the sidecar (chips 3/8) but there is **no accept → splice-into-`.tex`** flow. Deferred originally to avoid the then-volatile suggestion schema; **now unblocked** (card surface settled). Note a **src-side UI dependency** — the "accept" affordance + the "Virgil as author" mark (Phase 8) — so it spans skill + UI.
3. **`actions.md`** — the manifest's last doc (editing surface: decorations, structural ops, card actions, keyboard). Needs its own **user-actions Phase-0 extraction** first (deferred in chips 2 & 4 — never archaeologized). Then write it like the other manifest docs.
4. **DEV mode + dev-dream (Phase 7)** — the self-improvement loop (DEV-mode memo capture + overnight dream pass). See `EDITOR_SKILLS_V1.html` §14.
5. **UI affordances (Phase 8)** — "Virgil as author" mark (also needed for L3 / silent-apply trust), unified inbox view, mode indicator. Src-side; pairs with #2.

## Open items / gotchas (carry forward)
- **⚠ Stale personal-snapshot (prefs) — ACTION NEEDED.** At v0.1.49, `promote-defaults` wanted to ship a stale `tools/personal-snapshot.json` (still had the *removed* "quotations" panel post-refactor) → would have regressed the shipped panel defaults. **Skipped this release.** Before the next `/cleanup-virgil`: the user should refresh the snapshot (run the app / `npm run dev:preview` on current `main` so it captures `reports`), then a future promote cleanly ships the real margin/gutter prefs. **Always run `bash tools/sync-defaults.sh --check` first and eyeball the diff before the full promote.**
- **Concurrent lifted-overlay session.** A parallel session has been advancing `main` (the float/"lift" feature). It keeps moving `main`, so doc-drift re-accrues between releases (the `/cleanup-virgil` doc-refresh clears it each time). It's the user's to coordinate before merging/releasing; at v0.1.49 it had fully landed and `main` was clean.
- **Contract-shape refinements flagged by chip 8** (do them the deep way when convenient): `example` wants a *block-after-paragraph* texEdit mode + a *Task-less* tex-only subcommand. Handled by reusing the contract as-is; a clean refinement would add those modes.
- **`move-card` atom-bearing case deferred** — re-anchoring a footnote/citation = relocating its `.tex` `\v*id` marker, not just a sidecar field. Chip 9 scoped `move-card` to anchor-only (Mode-A) cards.
- **`identity.md` nuance** (chip-8 one-liner): it says atom blocks "always get `%!v:`" but `exampleBlock`s use `\vexid` alone — verify/correct at a future cleanup.

## How to dispatch & verify a chip (the working pattern)
- **Base off `main`** in the chip's own worktree (if it must build on an unmerged chip, base off that branch; have the agent self-heal — `merge --ff-only <branch>` — if its worktree got cut from `main`). The agent **commits to its branch; does not push/merge.**
- **Verify on return — run it yourself, don't just trust the report:** run the tests (Python `editor/scripts/tests/*.py`; TS `npx vitest run <file>`), run `npm run check:coherence` (must stay `0 errors`), spot-check the load-bearing claims against the code, and confirm back-compat. For doc chips, confirm edges resolve + stamps are honest.
- **Merge** to local `main` (clean ff or 3-way — chips are usually disjoint from the concurrent `src/` work), then `git worktree remove` + `git branch -d`. Don't push (the user releases via `/cleanup-virgil`).
- **Chip-prompt shape** (what's worked): mission · where-to-base (+ self-heal) · required reading · **the framing** (the deep/unifying angle for this chip) · locked decisions (do-not-relitigate) · deliverables (scope IN) · **scope OUT** · the design principle · doc-graph discipline · structured report-back. The committed chips (their skills/docs/code on `main`) are concrete examples of the output bar.
- A fresh worktree has no `node_modules`; to run the checker/TS tests, the agents use a read-only `node_modules` symlink to `main` (created, used, removed) — don't `npm install` in a worktree.

## Releasing
`/cleanup-virgil` is the full release (merge worktrees → coherence-driven doc-refresh → promote-defaults → version bump → commit/tag/push → deploy app + website → verify). Run it only when no chips are in flight. **Always `--check` the prefs-promote first** (see the gotcha above). It bumps **patch** by default; the doc-refresh is now coherence-driven (uses the check-4 punch-list + the self-describing `covers-code` headers — no hand-maintained path lists).

## Key files / locations
- Canonical doc: `docs/architecture/VIRGIL.md` (+ `check-coherence.SKETCH.md`, the coherence-script design).
- Manifest (ships to `.claude/virgil/`): `docs/workspace/{INDEX,ontology,identity,structure,atoms,latex,cards,sidecars,anchoring,gardening,footnotes}.md`.
- The contract: `editor/scripts/apply_response.py` (+ `_common.py` atomic-write/pen, `create_card.py`, `card_by_id.py`, `list_requests.py`).
- The skills: `editor/skills/*.md`.
- Coherence + shipping: `tools/check-coherence.mjs`; `library/lib/skill-sync.ts` (`diskPathFor`); `scripts/build-meta-bundle.mjs`.
- Release ratchet: `~/.claude/commands/cleanup-virgil.md` (step 2 = the coherence-driven doc-refresh).
- Design source-of-record (frozen): `EDITOR_SKILLS_V1.html` (§10 skill set · §12 contract · §14 dev-dream), `EDITOR_SKILLS_BRAINSTORM.html` (§19 method plan · §20 decisions), `MEMO_V1_AND_ROT_PREVENTION.md` (the original plan; Part 1 = rot-prevention, done).
