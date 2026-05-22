# Resume prompt — TextObject refactor (next session)

Paste the body of this file into the next session as the opening prompt.

---

We're closing out the **TextObject refactor** of Virgil — a β-scope
architectural unification that consolidates every parallel implementation
of "graspable text unit" into a single canonical pathway: `TextObject`,
with its kind registry at `src/text-objects/`.

**Branch: `text-object-refactor`** (off `main`). Eight commits landed;
three remain. **The entire architectural shape is in.** What's left is
extensions (selection hydration), migration sweep, sample extension,
and docs. None of it changes the data model further.

## Landed

- `c705d3e` **Phase A1+A3** — `exampleItem` uuid + `\vxid` round-trip;
  deprecated anchor sets retired.
- `8b2fa20` **Phase B+C1** — `textObject` schema group on every
  persistent TextObject node; `listItem`/`exampleItem` content widened
  so `graphicsBlock` may sit mid-item end-to-end.
- `f089f95` **Phase C2** — `src/text-objects/` skeleton: types,
  registry, drop adapters, hydration helper, handle-layout utility.
  21 new tests.
- `69a4680` **Phase D2+D3+D4** — grab-handle unification. Six
  scattered grip implementations collapsed into ONE editor-mounted
  `TextObjectGrabHandle` backed by the registry. Net –1749/+256.
  After D4, "is this graspable?" is answered by
  `nodeType.isInGroup("textObject")` — one predicate, one component.
- `af301fa` **Phase D10** — popout-key migration. Every block-popout
  key collapses onto `textobject:<kind>:<id>` emitted by
  `textObjectPopoutKey`. Pre-D10 keys migrate in
  `useViewPrefs.ts.loadPrefs()`. Transitional `case "list"` deferred
  to F (needs doc walk); `case "selection"` until E.
- `167c26f` **Phase D7** — `paragraphId` → `textObjectId` rename.
  `MarginaliaMarker.textObjectId` + drop-ctx APIs
  (`addTextObjectLink`, `removeTextObjectLink`,
  `getAnchorTextObjectIds`, `textObjectSideReanchorSpec` + the file
  rename) + per-hook variants + `getLinkedTextObjectIds` (98 sites).
- `5ad274d` **Phase D8** — `Link.anchor` full restructure.
  `type: "anchor"` → `"textObject"`; add `targetKind`; rename
  `paragraphIds` → `textObjectIds`. `isModeB(link)` becomes a derived
  check (`targetKind === "linkedRange"`). `migrateCardLinks` extended
  to upgrade legacy sidecar links on read. After D8 the Mode A/B
  distinction is fully collapsed; cards can in principle anchor to
  any TextObject kind.
- `6c8041d` **Phase D5+D6** — float chrome unification + drop-spec
  collapse. Five per-kind floats deleted; one `TextObjectFloat`
  chrome + 5 per-kind bodies in `src/text-objects/floats/`. One
  `drop-mode/specs/textobject.ts` replaces `paragraph.ts` +
  `heading.ts`, dispatching through `meta.dropAdapter` and
  `meta.collectMoveSource`. Dispatcher case "textobject" reduced from
  33-line switch to 9 lines. Dead MIMEs deleted. Net +1724/−1371.
  Adding a new TextObject kind is now one registry entry + one
  `registerFloatBody` call.

Typecheck clean. Full suite 157 passing / 8 pre-existing
`usePersistentState.test.ts` failures (unrelated baseline).

## Read these first

1. **`TEXT-OBJECT-REFACTOR.md`** at the repo root — the working memo.
   The Progress section at the top (updated 2026-05-22, session 3)
   summarizes everything that's landed; the rest is the original
   design memo. Read end-to-end at least once.

2. **`/Users/gabriel/.claude/plans/we-re-undertaking-a-major-quizzical-truffle.md`**
   — the full implementation plan with verification findings, ordering
   dependencies, critical files, and the commit-by-commit checkpoint
   sequence. Treat this as the authoritative ordering for the
   remaining three commits.

3. **`/Users/gabriel/.claude/plans/i-m-resuming-the-textobject-proud-dusk.md`**
   — the session-3 plan that produced the D8 and D5+D6 commits.
   Contains the file-by-file detail for both of those phases. Useful
   as a model for E's per-file design.

4. **`AGENTS.md`**, **`docs/agents/main-text.md`**,
   **`docs/agents/architecture.md`** for codebase orientation. Do NOT
   re-do the codebase exploration that produced the plan — it's all
   captured in those docs and the memo's "Verification findings" table.

## What's left (3 commits)

Per the plan's commit-by-commit checkpoint sequence:

### 9. **E — selection hydration + multi-paragraph `linkedAnchor` LaTeX round-trip**

The biggest remaining piece. Today's selection floats are session-only
(held in `selection-floats.ts`), and Mode B `linkedAnchor` marks have
no LaTeX representation — they round-trip only via the sidecar
`textSnapshot`. After E:

- **Wire `hydrateSelectionToTextObject`** (already exists at
  `src/text-objects/hydrate-selection.ts`, unused) at three commit
  sites:
  - **Popout commit** — `TextObjectGrabHandle`'s SelectionRef lift
    (currently emits `selection:<id>`) hydrates to a `linkedRange`
    TextObject and emits `textobject:linkedRange:<anchorId>`.
  - **Card-anchor commit** — drag-handle menu (or actions menu)
    creating a Mode B card from a live selection → hydrate → store
    `targetKind: "linkedRange"` + `textObjectIds: [anchorId]`.
  - **Drop-mode commit on a selection source** — hydrate at commit.
- **Delete the session-only category entirely.** Once hydration is
  wired, `SelectionFloat.tsx`, `selection-floats.ts`,
  `drop-mode/specs/selection.ts`, `case "selection"` in
  `floating-cards.tsx`, and TextObjectGrabHandle's `selection:<id>`
  fallback all go.
- **Build a `linkedRange` float body** at
  `src/text-objects/floats/linked-range-body.tsx` (the body reads its
  range from the live mark, not from an in-memory map) and register
  it via `registerFloatBody("linkedRange", LinkedRangeBody)` in
  `src/text-objects/floats/index.ts`.
- **Paired markers `\vlid{anchorId}…\vlidend{anchorId}`** introduced
  in `src/lib/latex-parser.ts` + `src/lib/latex-serializer.ts`. This
  is a **NEW LaTeX-level round-trip** — pre-E, `linkedAnchor` marks
  lived only in app state.
  - Parser tracks open markers in a stack so nested anchors work.
  - Defensive: unmatched `\vlid{x}` (no matching `\vlidend{x}` before
    EOF / before another `\vlid{x}`) stamps the mark to
    end-of-paragraph and logs a `console.warn`. The sidecar's
    `textSnapshot` re-anchoring (existing `applyLinkedAnchors` /
    `reanchorByText`) provides recovery.
  - `\vlidend{x}` with no opener is dropped silently.
  - `ensureVirgilCommands` (in `latex-serializer.ts`) gets
    `\providecommand{\vlid}[1]{}` and `\providecommand{\vlidend}[1]{}`.
- **Sidecar `paragraphId` (single) → `paragraphIds` (array).** For
  pre-multi-paragraph cards, `paragraphIds = [paragraphId]`. Defensive
  read in the linkedAnchor-sidecar persistence hook.
- **Paste policy unchanged.** `LinkedAnchorGuard.transformPasted`
  stays as-is: strip `linkedAnchor` marks on paste. Document this in
  the linked-range body component's README/header comment.
- **Reaping:** when a `linkedRange`'s popout is dismissed AND no card
  anchors remain, remove the linkedAnchor mark (audit
  `useLinkedAnchorReconciler` for the reaper hook; extend if it only
  handles single-paragraph today).
- **Wire MIME_TEXTOBJECT emission** in `TextObjectGrabHandle`'s
  `onDragStart` for SelectionRef lifts post-hydration. The payload
  shape is already typed (`TextObjectTransportPayload` in
  `src/text-objects/types.ts:140`). StackIcon's consumer side gets a
  one-line addition to read `MIME_TEXTOBJECT`.

D8 must have landed before E starts — it has (commit `5ad274d`).

### 10. **F — final migration audits + legacy-key sweep**

- **Doc-aware sweep of remaining legacy popout keys** that D10
  deferred:
  - `list:<uuid>` — walk doc for the actual list kind → emit
    `textobject:bulletList:<uuid>` or `textobject:orderedList:<uuid>`.
    Missing nodes dropped with `console.warn`.
  - `example:<uuid>` (the in-editor popout collision, distinct from
    the panel-card prefix) — disambiguate by walking the doc; if a
    matching exampleBlock exists, migrate to
    `textobject:exampleBlock:<uuid>`.
  - After this sweep, `case "list"` in `floating-cards.tsx` can be
    DELETED. The panel-card `case "example"` (the
    `note:`/`todo:`/`bib:` family member) stays — it's a separate
    stable contract.
- **`targetKind` inference upgrade** (deferred from D8). The default
  in `migrateCardLinks` is `"paragraph"` for non-`linkedRange` legacy
  anchors. Pre-D9 data has no sub-object anchors, so this is
  forward-looking defense, but the upgrade is straightforward: on
  first load (or via a reconciliation pass when the doc is ready),
  walk each link's `textObjectIds`, look up the matching node, and
  upgrade `targetKind` to its actual kind. Missing nodes log a
  `console.warn`.
- **`migrateCardLinks` coverage audit** — confirm every link-bearing
  card hook (useNotes, useTodos, useArchive, useCutter, useRevisions,
  useQuotations) routes through it. Already verified during D8; F
  reconfirms and surfaces any orphans with `console.warn`.
- **`\vxid` lazy-assign verification** for legacy docs without
  exampleItem ids. Already wired in A1; F confirms it still works
  after the rest of the refactor.
- **Orphan-link surfacing** — any anchor link whose `textObjectId` no
  longer resolves in the doc should emit a `console.warn` (or a
  toast). No silent data loss.
- **Optional rename audit** — function-parameter `paragraphId` names
  in card-creation APIs (`addNote(paragraphId, …)`,
  `addTodo(paragraphId, …)`, etc.) and `EditorHandle
  .ensureParagraphUuid` / `.ensureParagraphUuidAtCoords` methods.
  They're kind-agnostic now (the value is just a TextObject UUID) and
  could rename for consistency. Deferred per D7's DO-NOT list; F is
  the natural place if it happens.
- **Smaller items to fold in:**
  - Move `PER_KIND_FLOAT_SIZE` from `TextObjectGrabHandle.tsx` into a
    `meta.initialFloatSize?: { width: number; height: number }`
    registry field. One-liner per kind.
  - Extend `SourceMissingBanner`'s `FloatSourceKind` union to cover
    more kinds, or make it derived from `TextObjectKind`. (Today it's
    `"paragraph" | "section" | "selection" | "list" | "example"` —
    a strict subset.)
  - `LinkResolution.paragraph.paragraphId` stays as-is — single
    resolved match, distinct concept. Documented asymmetry.

- **No doc-format version sentinel needed** — migration is additive
  (new attrs, new markers, new schema group, new key shapes).
  Confirmed by user; revisit only if migration testing reveals an
  irreversible delta.

### 11. **G — sample extension + agent-docs refresh + dev-preview walkthrough**

Bundled into this PR per the original plan.

- **Refresh the dev doc:**
  ```
  rm -rf virgil-data/doc_devtest && cp -R samples/annotation-history virgil-data/doc_devtest
  ```
- **Extend `samples/annotation-history/`** with test cases that
  exercise the new capabilities:
  - A graphic inside a list item (`\includegraphics` mid-`itemize`).
  - A graphic inside an example item (`\includegraphics` mid-`\a`).
  - A linkedAnchor spanning two paragraphs (for multi-paragraph range
    testing — depends on E).
  - A sub-object popout target (sample card anchored to a list item;
    sample card anchored to an example item — depends on D9 via D8).
  - Commit the extended sample as part of this PR.
- **Walk the §13 checklist end-to-end** in dev preview (the §13
  reference is in `TEXT-OBJECT-REFACTOR.md`):
  - Pop out: paragraph, heading, list, list item, example item,
    example block, tex block, figure, graphic, displayMath,
    latexComment, blockquote, codeBlock, titleField,
    multi-paragraph selection.
  - Pop out: graphic inside a list, graphic inside an example.
  - Drop each into: same-parent context, incompatible context
    (wraps), top level (wraps for sub-objects).
  - Anchor notes/todos/quotations to: paragraph, heading, list
    item, example item, atom block, linkedRange.
  - Grab-handle placement: top-level handles in gutter; sub-object
    handles indented by `decorationSafety`.
  - Reload the doc: all popouts and anchors survive.
- **Phase D9 functionality verification** belongs here. D8's
  `targetKind: TextObjectKind` field already supports cards on any
  kind in the data model. G's walkthrough is the first time
  sub-object anchoring gets exercised end-to-end. Verify:
  - `MarginaliaAnchorGuard`'s populator iterates by
    `isInGroup("textObject")` rather than node-name (see
    `linked-anchor.ts:189` + `EditorPane.tsx:1781`'s
    `anchoredUuidsRef` population).
  - Marginalia layout positions correctly when anchoring to a
    sub-object (next to the item's first line, not the surrounding
    container's top).
- **Add unit tests for `drop-mode/specs/textobject.ts`** (deferred
  from D6). Cover the source-kind × target-context matrix:
  - listItem at top-level → wraps in bulletList/orderedList per
    `sourceContext.parentKind`.
  - listItem inside list → drop-direct.
  - exampleItem at top-level → wraps in exampleBlock.
  - exampleItem inside exampleBlock → drop-direct.
  - paragraph at top-level → drop-direct.
  - heading at top-level → uses `collectMoveSource` to move the
    whole section.
- **Refresh agent docs:**
  - `docs/agents/main-text.md`: rewrite the "Block nodes" + "Link
    architecture" sections to describe the new TextObject model.
    Update Mode A/B description to the unified `targetKind`. Add a
    section on the `textObject` schema group.
  - `docs/agents/architecture.md`: add `src/text-objects/` to the
    registries table (SSOT alongside `panel-registry.ts` and
    `link-registry.ts`). Update the "Drag/drop MIME map" section to
    describe `MIME_TEXTOBJECT`. Update "Popout key prefixes" to
    describe `textobject:<kind>:<id>`. Note the float collapse.
  - `docs/agents/glossary.md`: add "TextObject" entry. Update "Mode
    A"/"Mode B" entries to describe the collapse.
  - `docs/agents/overview.md`: brief mention of text-objects in the
    core concepts list.

## The spirit (non-negotiable)

**Deep architectural fixes. NOT surgical patches.**

The remaining work is mostly extension and polish, but the same
discipline applies. When E builds the linkedRange body, it should be
*just another body component* registered via `registerFloatBody` —
no new chrome, no new dispatcher case, no parallel routing. When F
sweeps legacy keys, the goal is **deletion**, not preservation —
after F's sweep, the dispatcher has no transitional cases left
except `case "example"` (stable panel-card prefix).

When you find drift during the work, fold the fix into the same
commit. Every parallel implementation §4 of the memo enumerates that
hasn't been deleted yet is still something to delete.

The extensions to previously-patchy functionality —
**multi-paragraph `linkedAnchor`** (E), **cards-on-sub-objects** (G),
**graphic-in-list-item / graphic-in-example-item** (G) — are tests of
whether the abstraction is right. If they're not trivial after the
refactor, the abstraction isn't right yet. So far the pattern has
held: each commit has made the next phase smaller. Trust it.

Don't ship as a series of small patches inside E or F. Each of the
three remaining commits is one coherent architectural step.

## Working pattern

- Read the memo, then the authoritative plan, then the session-3
  plan (`i-m-resuming-the-textobject-proud-dusk.md`) for the file-by-
  file detail style. Don't re-explore — the plan captures all the
  verifications already.
- Walk the commit sequence in order: E → F → G. E unblocks F (deleting
  selection-related code clears the way for F's dispatcher cleanup),
  F unblocks G (extended sample needs the new capabilities working).
- Run `npx tsc --noEmit` and `npm test -- --run` after each commit.
  Stay green (157 passing / 8 pre-existing — the 8 reds are
  `usePersistentState.test.ts`, unrelated).
- Verify in the dev preview with `virgil-data/doc_devtest` (refresh
  from `samples/annotation-history` if it gets choppy). Phase G is
  the full walkthrough.
- Turbopack module cache occasionally serves stale exports after a
  broad rename sweep — if console errors persist after a Fast
  Refresh, hard-restart the preview server (matches the
  `turbopack_watcher_stale` memory note).

Start with `git checkout text-object-refactor`, then read the memo,
then begin **Phase E** (selection hydration — the biggest remaining
piece; F and G build on it).

## Tactical hints for Phase E

- **`hydrateSelectionToTextObject`** is at
  `src/text-objects/hydrate-selection.ts`. Its current signature
  (verify before depending) returns `{ kind: "linkedRange", id:
  anchorId }`. It stamps the `linkedAnchor` mark, generates a fresh
  `anchorId`, and returns the TextObjectRef. The three commit sites
  consume this return value to swap the popout key from
  `selection:<id>` to `textobject:linkedRange:<anchorId>` and to
  store the right `targetKind` on the card link.
- **TextObjectGrabHandle's `popoutKeyForLift`** is the SelectionRef
  emission point. Today it returns `selection:${generateShortId()}`
  for SelectionRef. Replace with: hydrate first → return
  `textObjectPopoutKey({ kind: "linkedRange", id: anchorId })`.
- **`SelectionFloat.tsx` body content** doesn't disappear — it
  becomes (essentially) the `linkedRange` body, but it reads from
  the linkedAnchor mark in the live editor instead of from
  `selection-floats.ts`. The file may be renamed/moved or rewritten;
  the *behavior* migrates.
- **`drop-mode/specs/selection.ts`** today reads from
  `getSelectionFloatData(id)`. After E, selections are linkedRanges
  and the textobject drop spec handles them (kind: "linkedRange").
  The selection spec file can be deleted; `case "selection"` in the
  dispatcher disappears.
- **LaTeX round-trip** for `\vlid` is the riskiest piece. The
  parser/serializer in `src/lib/latex-parser.ts` /
  `src/lib/latex-serializer.ts` are deeply familiar territory — the
  `\vfid` / `\vcid` / `\vxid` / `\vexid` family are precedents. Walk
  one of those (`\vxid` from A1's commit `c705d3e` is the most
  recent) before writing `\vlid`. Round-trip tests live alongside in
  `src/lib/__tests__/`.

## Definition of done

When all three commits land:
- `case "selection"` and `case "list"` are gone from the dispatcher
  (only `case "textobject"` + `case "example"` panel-card + the
  card-kind cases remain).
- `SelectionFloat.tsx`, `selection-floats.ts`,
  `drop-mode/specs/selection.ts` are deleted.
- `\vlid` / `\vlidend` round-trip works on multi-paragraph
  selections, with defensive recovery.
- The dev doc walkthrough exercises every kind + every drop context
  + sub-object anchoring + multi-paragraph linkedRange, and reload
  preserves state.
- Agent docs reflect the new model.
- The memo gets a final "session 4: complete" stamp; the resume
  prompt file gets deleted (no more sessions needed).

The architectural shape — the whole point of this refactor — is
already shipped (commit `6c8041d` was the last structural reshape).
The remaining three commits ship the **extensions** that prove the
shape was right.
