# Resume prompt — TextObject refactor (next session)

Paste the body of this file into the next session as the opening prompt.

---

We're mid-flight on the **TextObject refactor** of Virgil — a β-scope
architectural unification that consolidates every parallel implementation
of "graspable text unit" (paragraph 6-dot lift, per-node-view grips on
atom blocks, float-internal grips, scattered drop-mode specs, parallel
popout-key prefixes, parallel MIMEs, the Mode A/B distinction on links,
the deprecated `ANCHORABLE_NODES` set) into a single canonical pathway:
`TextObject`, with its kind registry at `src/text-objects/`.

**Branch: `text-object-refactor`** (off `main`). Four commits landed:

- `c705d3e` Phase A1+A3 — `exampleItem` uuid + `\vxid` round-trip;
  deprecated anchor sets retired.
- `8b2fa20` Phase B+C1 — `textObject` schema group on every persistent
  TextObject node; `listItem`/`exampleItem` content widened so
  `graphicsBlock` may sit mid-item end-to-end.
- `f089f95` Phase C2 — `src/text-objects/` skeleton: types, registry,
  drop adapters, hydration helper, handle-layout utility. 21 new tests.
- `f8f374a` Memo update — progress through C2 + spirit reminder.

Typecheck clean. Full suite 151/159 passing (8 failures are pre-existing
in `usePersistentState.test.ts`, unrelated).

## Read these first

1. **`TEXT-OBJECT-REFACTOR.md`** at the repo root — the working memo.
   The Progress section at the top (added 2026-05-22) summarizes what's
   landed and what remains; the rest is the original design memo. Read
   end-to-end.

2. **`/Users/gabriel/.claude/plans/we-re-undertaking-a-major-quizzical-truffle.md`**
   — the full implementation plan with verification findings, ordering
   dependencies, critical files, and the commit-by-commit checkpoint
   sequence. Treat this as the authoritative ordering.

3. **`AGENTS.md`**, **`docs/agents/main-text.md`**, **`docs/agents/architecture.md`**
   for codebase orientation. Do NOT re-do the codebase exploration that
   produced the plan — it's all captured in those two documents and the
   memo's "Verification findings" table.

## What's left (8 commits)

Per the plan's commit-by-commit checkpoint sequence:

4. **D2 + D3 + D4 — grab-handle unification.** Refactor
   `src/components/SelectionDragHandle.tsx` (~630 lines) into
   `src/text-objects/TextObjectGrabHandle.tsx` backed by the registry.
   Replace the 4-variant `DragHandlePassage` union in
   `src/components/editor-layout/card-actions/drag-handle-actions.ts`
   with `TextObjectRef | SelectionRef`. Delete the per-node-view grips
   on `texBlock`/`figureBlock`/`graphicsBlock`/`exampleBlock`. The
   editor mounts one canonical grab handle; the schema group is the
   predicate.

5. **D7 — `paragraphId` → `textObjectId` code-mod.** ~159 sites across
   `useNotes`/`useTodos`/`useArchive`/`useCutter`/`useRevisions`/
   `useQuotations`, drop specs, drop-ctx APIs. Mechanical. Read the
   "Do NOT rename" list in the plan before sweeping — `data-link-*`
   DOM attrs, `LinkResolution.paragraph.paragraphId`, and
   `migrate-card.ts` deliberately keep the legacy names.

6. **D8 — Link.anchor full restructure.** Rename `type: "anchor"` →
   `"textObject"`; add `targetKind: TextObjectKind`; rename
   `paragraphIds` → `textObjectIds`. Extend `migrateCardLinks` to map
   legacy shape forward (infer `targetKind` from the doc; missing →
   `"paragraph"` + console.warn). `isModeB(link)` becomes a derived
   check.

7. **D10 — popout-key migration.** Every block popout uses
   `textobject:<kind>:<id>` (via the `textObjectPopoutKey` helper
   already in place in C2). One `case "textobject"` in
   `floating-cards.tsx`. One-time read-side migration in
   `useViewPrefs.ts`. **Lands before D5+D6** so the dispatcher swap
   and float deletions land in one coherent diff.

8. **D5 + D6 — float + drop-spec collapse.** Delete
   `ParagraphFloat.tsx`, `HeadingFloat.tsx`, `ListFloat.tsx`,
   `SelectionFloat.tsx`, `TexBlockFloat.tsx`, `selection-floats.ts`.
   Bodies relocate as registry-registered components via
   `registerFloatBody`. Chrome unified via `TextObjectFloat`; body
   sync stays per-kind (do NOT try to abstract CodeMirror-vs-TipTap
   sync — false unification). Collapse `paragraph.ts`/`heading.ts`/
   `selection.ts` from `drop-mode/specs/` into one `textobject.ts`.

9. **E — selection hydration + multi-paragraph `linkedAnchor` LaTeX
   round-trip.** Wire `hydrateSelectionToTextObject` (already exists
   in C2) at the three commit sites: popout, card-anchor, drop-mode.
   Add paired markers `\vlid{anchorId}…\vlidend{anchorId}` in
   `latex-parser.ts` + `latex-serializer.ts` — this is a NEW LaTeX
   round-trip (the mark was app-state-only before). Parser is
   defensive: unmatched `\vlid` logs and recovers via the sidecar
   `textSnapshot`. Sidecar `paragraphId` (single) → `paragraphIds`
   (array). **Lands after D8.**

10. **F — final migration audits.** Lazy `\vxid` for legacy docs
    (already in A1, verify); `migrateCardLinks` covers every
    consumer; orphan link surfacing; no silent data loss. No
    doc-format version sentinel.

11. **G — sample extension + agent-docs refresh + dev-preview
    walkthrough.** Extend `samples/annotation-history/` with
    graphic-in-list-item, graphic-in-example-item, multi-paragraph
    linkedAnchor, sub-object card anchors. Walk the §13 checklist.
    Refresh `docs/agents/main-text.md`, `docs/agents/architecture.md`,
    `docs/agents/glossary.md`, `docs/agents/overview.md`.

## The spirit (non-negotiable)

**Deep architectural fixes. NOT surgical patches.**

The whole reason this refactor exists is that the existing consistency
is enforced by vigilance, not by design. Every patch-shaped instinct is
the wrong instinct here. When you encounter a reported case, identify
the class of bug and fix every analogous sibling. When you find drift
during the work (like the deprecated `ANCHORABLE_NODES` set omitting
`figureBlock`/`graphicsBlock`, or the `EntityKind`/`TextObjectKind`
name collision around `example`), fold the fix into the refactor.

The extensions to patchy functionality — sub-object popout, multi-
paragraph `linkedAnchor`, `graphicsBlock`-in-list, cards-on-any-text-
object — are tests of whether the abstraction is right. If they're
not trivial after the refactor lands, the abstraction isn't right yet.

Don't ship as a series of small patches. The architectural shape is
the deliverable. All other code edits halt until it ships.

## Working pattern

- Read the memo, then the plan, then `AGENTS.md` / `docs/agents/*.md`
  for orientation. Don't re-explore — the plan captures all the
  verifications already.
- Walk the commit-by-commit sequence in order. The strict
  dependencies are: **D10 before D5+D6** (dispatcher swap precedes
  float deletions); **D8 before E** (hydration writes the new anchor
  shape). Otherwise the order is flexible.
- Run `npx tsc --noEmit` and `npm test -- --run` after each commit.
  Stay green.
- Verify in the dev preview with `virgil-data/doc_devtest` (refresh
  from `samples/annotation-history` if it gets choppy). Phase G is
  the full walkthrough.
- The plan file at
  `/Users/gabriel/.claude/plans/we-re-undertaking-a-major-quizzical-truffle.md`
  has the full per-phase detail. Trust it.

Start with `git checkout text-object-refactor`, then read the memo,
then begin Phase D2+D3+D4 (the grab-handle unification — the biggest
single architectural move in the remaining work).
