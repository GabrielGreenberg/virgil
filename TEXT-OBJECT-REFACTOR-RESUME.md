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

**Branch: `text-object-refactor`** (off `main`). Six commits landed; five
remain. The biggest single architectural moves are now behind us.

## Landed

- `c705d3e` **Phase A1+A3** — `exampleItem` uuid + `\vxid` round-trip;
  deprecated anchor sets retired.
- `8b2fa20` **Phase B+C1** — `textObject` schema group on every persistent
  TextObject node; `listItem`/`exampleItem` content widened so
  `graphicsBlock` may sit mid-item end-to-end.
- `f089f95` **Phase C2** — `src/text-objects/` skeleton: types, registry,
  drop adapters, hydration helper, handle-layout utility. 21 new tests.
- `69a4680` **Phase D2+D3+D4** — grab-handle unification. Six scattered
  grip implementations (paragraph/list/heading 6-dot lifts inline in
  Editor.tsx, exampleBlock popout button in expex.ts, TexBlockNodeView
  grip, SelectionDragHandle) collapsed into ONE editor-mounted
  `TextObjectGrabHandle` backed by the registry. `DragHandlePassage`
  4-variant union → `TextObjectRef | SelectionRef`. Sub-objects
  (listItem, exampleItem) get handles for the first time; atom blocks
  reachable via mouse hover. Net –1749 / +256 lines across 13 files.
  After D4, "is this graspable?" is answered by
  `nodeType.isInGroup("textObject")` — one predicate, one component.
- `af301fa` **Phase D10** — popout-key migration. Every block-popout
  key collapses onto `textobject:<kind>:<id>` emitted by
  `textObjectPopoutKey`. The dispatcher in `floating-cards.tsx` gets
  one `case "textobject"`. Pre-D10 `paragraph:` / `heading:` /
  `texBlock:` keys migrate in `useViewPrefs.ts.loadPrefs()`;
  `selection:<id>` keys dropped with console.warn (session-only).
  Transitional `case "list"` kept pending Phase F's doc-aware sweep
  (the legacy `list:<uuid>` keys need a doc walk to disambiguate
  bullet vs ordered). Transitional `case "selection"` kept until
  Phase E's hydration. `case "example"` stays (panel-card prefix,
  stable contract in the `note:`/`todo:`/`bib:` family).
- `167c26f` **Phase D7** — `paragraphId` → `textObjectId` rename.
  `MarginaliaMarker.paragraphId` + the drop-ctx APIs
  (`addParagraphLink` → `addTextObjectLink`, `removeParagraphLink`,
  `getAnchorParagraphIds`, `paragraphSideReanchorSpec` + the file
  rename to `text-object-side-reanchor.ts`) + the per-hook variants
  (`addNoteParagraphId` etc. across the 6 anchored-card hooks) +
  `getLinkedParagraphIds` → `getLinkedTextObjectIds` (98 sites). +290
  / –284 across 46 files. The DO-NOT-rename list preserved
  (data-link-* DOM attrs, LinkResolution.paragraph.paragraphId, the
  migration shim, SelectionRef.paragraphId, Link.anchor.paragraphIds
  which D8 restructures).

Typecheck clean. Full suite 151/159 passing (the 8 reds are pre-existing
in `usePersistentState.test.ts`, unrelated).

## Read these first

1. **`TEXT-OBJECT-REFACTOR.md`** at the repo root — the working memo.
   The Progress section at the top (updated 2026-05-22, session 2)
   summarizes everything that's landed and what's left; the rest is the
   original design memo. Read end-to-end.

2. **`/Users/gabriel/.claude/plans/we-re-undertaking-a-major-quizzical-truffle.md`**
   — the full implementation plan with verification findings, ordering
   dependencies, critical files, and the commit-by-commit checkpoint
   sequence. Treat this as the authoritative ordering for the remaining
   five commits.

3. **`AGENTS.md`**, **`docs/agents/main-text.md`**,
   **`docs/agents/architecture.md`** for codebase orientation. Do NOT
   re-do the codebase exploration that produced the plan — it's all
   captured in those docs and the memo's "Verification findings" table.

## What's left (5 commits)

Per the plan's commit-by-commit checkpoint sequence:

7. **D8 — Link.anchor full restructure.** Rename `Link.anchor.type:
   "anchor"` → `"textObject"`; add `targetKind: TextObjectKind`;
   rename `paragraphIds` → `textObjectIds`. Extend `migrateCardLinks`
   for on-disk JSON: `anchor.type "anchor"` → `"textObject"`,
   `paragraphIds` → `textObjectIds`, infer `targetKind` by resolving
   the node id in the doc on first load (sub-objects get their actual
   kind; missing → `"paragraph"` + console.warn). `isModeB(link)`
   becomes `link.anchor.type === "textObject" && link.anchor.targetKind
   === "linkedRange"` — a derived check, not a stored shape. After D8
   the Mode A/B distinction is collapsed everywhere; cards can anchor
   to any TextObject kind. Critical files: `src/links/_shared/types.ts`,
   `src/links/links.ts`, every drop spec that examines `link.anchor`
   shape, marginalia placement (`marginalia-grid.ts`),
   `useLinkedAnchorReconciler`, `useAnchorHighlightReconciler`,
   `useTextHoverBridge`, `src/lib/cards/migrate-card.ts`.

8. **D5 + D6 — float + drop-spec collapse.** Delete
   `ParagraphFloat.tsx`, `HeadingFloat.tsx`, `ListFloat.tsx`,
   `SelectionFloat.tsx`, `TexBlockFloat.tsx`. Bodies relocate as
   registry-registered components via `registerFloatBody`. Chrome
   unified via `TextObjectFloat`; body sync stays per-kind (do NOT try
   to abstract CodeMirror-vs-TipTap sync — false unification).
   `cardContext` becomes a body-component concern. Same commit:
   collapse `drop-mode/specs/paragraph.ts`/`heading.ts`/`selection.ts`
   into one `textobject.ts` consuming `TextObjectTransportPayload` and
   dispatching through `dropAdapterFor`. After D5+D6 the
   `case "textobject"` dispatcher reads `meta.floatBodyComponent`
   directly (the legacy routing in `floating-cards.tsx` from D10 goes
   away), and the transitional `case "list"` can finally be deleted.

9. **E — selection hydration + multi-paragraph `linkedAnchor` LaTeX
   round-trip.** Wire `hydrateSelectionToTextObject` (already exists
   in C2) at the three commit sites: popout commit, card-anchor
   commit, drop-mode commit. The session-only "selection float"
   category is gone — `selection-floats.ts` deleted, `case "selection"`
   removed from `floating-cards.tsx`, `selection:<id>` removed from
   `TextObjectGrabHandle.popoutKeyForLift`. Add paired markers
   `\vlid{anchorId}…\vlidend{anchorId}` in `latex-parser.ts` +
   `latex-serializer.ts` — this is a NEW LaTeX round-trip (the mark
   was app-state-only before). Parser is defensive: unmatched `\vlid`
   logs and recovers via the sidecar `textSnapshot`. Sidecar
   `paragraphId` (single) → `paragraphIds` (array). MUST land after
   D8 (hydration writes the new anchor shape).

10. **F — final migration audits.** Lazy `\vxid` for legacy docs
    (verify); `migrateCardLinks` covers every consumer; orphan link
    surfacing; no silent data loss. **Doc-aware sweep of remaining
    legacy popout keys** that D10 deferred — `list:<uuid>` resolved by
    walking the doc; `example:<uuid>` disambiguated from the Examples
    panel-card keys; missing nodes dropped with console.warn. After F,
    no transitional legacy cases remain in the dispatcher. Optional
    audit pass: function-parameter `paragraphId` uses in card-creation
    APIs (`addNote(paragraphId, …)` etc.) and `EditorHandle
    .ensureParagraphUuid` / `.ensureParagraphUuidAtCoords` — they are
    kind-agnostic now and could rename for consistency.

11. **G — sample extension + agent-docs refresh + dev-preview
    walkthrough.** Extend `samples/annotation-history/` with
    graphic-in-list-item, graphic-in-example-item, multi-paragraph
    `linkedAnchor`, sub-object card anchors. Walk the §13 checklist
    end-to-end. Refresh `docs/agents/main-text.md`,
    `docs/agents/architecture.md`, `docs/agents/glossary.md`,
    `docs/agents/overview.md`.

## The spirit (non-negotiable)

**Deep architectural fixes. NOT surgical patches.**

The whole reason this refactor exists is that the existing consistency
is enforced by team vigilance, not by design. Every patch-shaped
instinct is the wrong instinct here. The agenda is structural: every
reported phenomenon (this grip is misaligned, that popout key isn't
migrating, this anchor field doesn't apply to lists) is a *symptom* of
the unified-pathway gap. The fix is to close that gap such that the
phenomenon — and every analogous sibling — becomes impossible to
re-introduce, not just temporarily resolved.

When you encounter a reported case, identify the class of bug and fix
every analogous sibling. When you find drift during the work, fold the
fix into the refactor. Every parallel implementation §4 of the memo
enumerates is something to delete or merge through the new pathway,
not patch around.

The extensions to previously-patchy functionality — sub-object popout,
multi-paragraph `linkedAnchor`, `graphicsBlock`-in-list, cards-on-any-
text-object — are *tests* of whether the abstraction is right. If
they're not trivial after the refactor lands, the abstraction isn't
right yet. The first three sessions confirmed this pattern: each
landed commit made the next phase smaller and more obvious because the
preceding shape was the right one. Trust the pattern.

Don't ship as a series of small patches. The architectural shape is
the deliverable. All other code edits halt until it ships.

## Working pattern

- Read the memo, then the authoritative plan, then `AGENTS.md` /
  `docs/agents/*.md` for orientation. Don't re-explore — the plan
  captures all the verifications already.
- Walk the commit-by-commit sequence in order. The strict dependency
  is **D8 before E** (hydration writes the new anchor shape).
- Run `npx tsc --noEmit` and `npm test -- --run` after each commit.
  Stay green (151/159 baseline — the 8 reds are pre-existing
  `usePersistentState.test.ts` failures, unrelated).
- Verify in the dev preview with `virgil-data/doc_devtest` (refresh
  from `samples/annotation-history` if it gets choppy). Phase G is
  the full walkthrough.
- Turbopack module cache occasionally serves stale exports after a
  broad rename sweep — if console errors persist after a Fast Refresh,
  hard-restart the preview server (matches the
  `turbopack_watcher_stale` memory note).
- The plan file at
  `/Users/gabriel/.claude/plans/we-re-undertaking-a-major-quizzical-truffle.md`
  has the full per-phase detail. Trust it.

Start with `git checkout text-object-refactor`, then read the memo,
then begin **Phase D8** (the Link.anchor restructure — D8 is the
last structural reshape of the data model; everything after it
follows from it).
