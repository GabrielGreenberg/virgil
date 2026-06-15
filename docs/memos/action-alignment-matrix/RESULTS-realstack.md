# CHIP 8 — Real-Stack Verification Results

Cross-surface action-alignment verification run against the **real editor stack** (`buildEditorExtensions("main")`, real commands/registry/serializer/parser — no product mocks). Each category drives the actual slash, lightning/registry-run, and drag-handle dispatch paths and asserts byte-identical cross-surface behavior plus per-kind applicability/effect.

## Summary table

| Category | Test file | Status | #Cases | What it covers |
|---|---|---|---|---|
| citation-footnote-align | `src/lib/actions/__tests__/chip8-citation-footnote-crosssurface.test.ts` | GREEN | 17 | Citation + footnote cross-surface byte-identity: slash vs typed produce identical atom attrs (modulo minted id) and identical `createCitation`/`createFootnote` calls; id-join holds; typed cite-with-key fix codified; footnote pristine alignment (empty=true, with-body=false); registry creator destination; `DragHandleRef` delegates to dispatch; durability with bridge cleared. |
| lifecycle-perkind | `src/lib/tiptap/__tests__/chip8-lifecycle-perkind.test.ts` | GREEN | 38 | Real delete-range helpers (`cleanupAndComputeDeleteRange`/`cleanupLinksInRange`/`expandCascadeRange`) + `duplicateSlice` mirroring the drag-handle dispatcher. F2 block-survival across 12 atom×block cells (+3 buggy controls); atom-only emptiness bail keys on slice size not textContent; citation-vs-footnote delete asymmetry (citation shrinks doc, footnote sidecar-only); cascade collapse (last list/example item); duplicate remints distinct uuids across 8 block kinds + sub-objects + whole-section; delete/archive doc-JSON alignment. |
| heading-blockinsert | `src/lib/actions/__tests__/chip8-heading-blockinsert-crosssurface.test.ts` | GREEN | 42 | 5 parts. Heading SET (convert-in-place, numbered, no-toggle) byte-identical slash⇄registry across kinds/levels + DA-1 atom survival + listItem/exampleItem no-op; Example `\ex` insert/wrap/atom-only-WRAP; Tex `\tex` seed + atom-only BAIL; inline/display-math wrap/placeholder + atom-only BAIL; Figure/Graphics via `smartInsertBlock` insert/replace/seed-popover. Cross-surface identity asserted wherever two surfaces exist. |
| ref-title | `src/lib/actions/__tests__/chip8-ref-title-crosssurface.test.ts` | GREEN | 53 | REF: `refRun → openRefPopover` fires once from slash + lightning, zero docDelta, byte-identical, collab read-only gate no-ops both surfaces, per-kind applies() taxonomy (ok on non-atom blocks, disabled on atom blocks), labelRef round-trips `\ref/\getref/\getfullref`. TITLE/AUTHOR/DATE: insert mints field+uuid; idempotency (no dup on second insert); find-existing dedupe; canonical order title/author/date; `\date` prefills today + serializes `\date{\today}` + round-trips + doesn't overwrite user-edited date; slash-only surface; SSOT rows. |
| format-marks | `src/lib/actions/__tests__/chip8-format-marks.test.ts` | GREEN | 50 | 4 mark toggles + 3 wrapper toggles + text-color. Registry `run()` byte-identical to StarterKit keymap binding + reversibility; DA-5 taxonomy (format=selection:ignored, ok at caret, contrasted vs highlight=required→disabled); uniform collab gate greys + no-ops; cursor-mode stored-mark; text-color opens popover with zero docDelta; code mark excludes others; per-kind landing; markdown input-rule second surface produces same node type. |

**Totals:** 200 cases across 5 categories — **5 GREEN / 0 RED**.

## PRODUCT BUGS FOUND

Sorted by severity (DATA-LOSS first). Note: in this run **live code is treated as truth** — tests *characterize* current behavior (all GREEN) rather than assert an idealized oracle, so several "bugs" below are doc/oracle discrepancies flagged for the manager rather than failing assertions.

### 1. [DATA-LOSS] Wrapper format toggles destroy heading/titleField structural identity instead of no-op'ing
- **Category:** format-marks
- **Where:** `src/lib/actions/action-registry.ts:2122` — `formatApplies` returns `'ok'` unconditionally for the wrapper rows; effect via `formatToggleRow` `run()` (`toggleBulletList`/`toggleOrderedList`/`toggleBlockquote`).
- **Repro:** Mount a doc with a titleField (`\title`) and run `VIRGIL_ACTION_REGISTRY['bullet-list'].run(ctx)` with a caret in it (codified in test block `(F) wrapper toggle on heading/titleField`). Same for a heading.
- **Expected:** Either the cell is greyed (`applies():'disabled'`) on heading/titleField, OR the toggle is a safe no-op preserving the heading/title identity (oracle drive-live #24/#26/#29 open question — "should the cell be greyed?").
- **Actual:** bullet/ordered-list on a titleField **DESTROYS** it: titleField count 0 → becomes a bulletList wrapping a plain paragraph, silently losing the `\title{}` field. bullet/ordered-list on a heading **CONVERTS** the heading into a list item (heading count 0, `\section{}` semantics lost). blockquote on a titleField nests the titleField inside a blockquote (survives but won't round-trip to LaTeX as a title). Flagged for the manager as the oracle's open applies-vs-effect concern; tests CHARACTERIZE current behavior (GREEN) rather than assert the greyed ideal.

### 2. [cosmetic] EXPECTED-MATRIX stale — displayMath is NOT lazy-uuid in the real main stack
- **Category:** heading-blockinsert
- **Where:** `docs/memos/action-alignment-matrix/EXPECTED-MATRIX.md` (display-math row + drive-live-first #6) vs `src/lib/tiptap/block-uuid-backfill.ts` (the `appendTransaction`) + `src/lib/tiptap/math.ts:224` (uuid default null).
- **Repro:** Mount main stack, place caret, run `VIRGIL_ACTION_REGISTRY['display-math'].run(ctx)` over a collapsed caret; inspect the inserted displayMath attrs.
- **Expected:** Per the oracle: uuid absent/lazy — "hydrated by `ensureAnchorUuid` on first interaction", so a freshly inserted equation serializes WITHOUT a `%!v` anchor until first interaction.
- **Actual:** The displayMath already carries a non-null uuid (e.g. `'5044'`) by the end of the inserting transaction — `BlockUuidBackfill` guarantees every anchorable block has a unique non-null uuid on insert (no orphan window). This is LIVE CODE = truth (more robust, not a defect); the oracle's display-math claim is stale. No product fix needed; the matrix doc should be corrected. Codified in the test "display-math: the inserted equation carries a non-null anchor uuid (BlockUuidBackfill)".

### 3. [cosmetic] heading-section enabled on listItem/exampleItem carets but is a silent no-op
- **Category:** heading-blockinsert
- **Where:** `src/lib/actions/action-registry.ts` `headingRun` (`setBlockType`) — applicability not greyed for list/example item carets; the EXPECTED-MATRIX heading-section 'ok' list omits listItem/exampleItem.
- **Repro:** Mount a `bulletList(listItem(paragraph))` or `exampleBlock(exampleItemList(exampleItem(paragraph)))`, caret in the inner paragraph, run `\section` (slash) or registry `heading-section`.
- **Expected:** Either convert (if intended) or grey-out the cell so the user isn't offered a dead action.
- **Actual:** Doc is UNCHANGED (`countOfType heading === 0`, shape identical before/after) — the action silently does nothing because heading is not a valid listItem/exampleItem child. Benign (no corruption, no data loss) and identical on both surfaces, so it's a low-priority UX nit, not a functional bug. Codified as the NO-OP regression in PART 1 so a future schema change that DID convert (shattering the list) would be caught.

### 4. [cosmetic] REF_ACTION_ROW jsdoc claims figureBlock → 'disabled' but live applies() returns 'ok'
- **Category:** ref-title
- **Where:** `src/lib/actions/action-registry.ts:1541-1546` (REF_ACTION_ROW applies jsdoc) vs `blockApplies` at `:1852-1860` + `TEXT_OBJECT_REGISTRY.figureBlock.isAtomBlock===false` (`src/text-objects/text-object-registry.ts`) — also EXPECTED-MATRIX.md row 52 concern (2).
- **Repro:** `VIRGIL_ACTION_REGISTRY['ref'].applies({editor,view,ref:{kind:'figureBlock',id:'x'},surface:'lightning',canEdit:true})` returns `'ok'` because `blockApplies` keys off `isAtomBlock` (figureBlock=false). The jsdoc on REF_ACTION_ROW says "A non-text atom-block ref (figure / displayMath) … → disabled".
- **Expected:** Per the jsdoc/oracle, figure would be `'disabled'`.
- **Actual:** Live code returns `'ok'` for figureBlock (LIVE CODE IS TRUTH). The discrepancy is in the jsdoc comment + the oracle's REF row note, not in behavior — figureBlock is a non-atom block (it has caption content), so `'ok'` is defensible. The test asserts the live `'ok'` and pins it as a regression; the jsdoc example "figure / displayMath" should drop "figure" (only the `isAtomBlock:true` kinds displayMath/texBlock/graphicsBlock/latexComment are actually disabled). No product fix needed; correct the comment/oracle.

### 5. [cosmetic] Empty cite parses to one-element key array (not empty), defeating pristine check
- **Category:** citation-footnote-align
- **Where:** `bib-parser.ts:203` and `useCitations.ts:174`.
- **Repro:** `parseCiteCommand` of an empty cite returns keys with one empty-string element; `addCitation` only marks pristine when `keys.length` is zero.
- **Expected:** keys empty for empty body, or `addCitation` treats a lone empty key as empty.
- **Actual:** keys length one, so the empty cite skips that pristine branch but still gets the anchored pristine lifecycle via the registry citation run plus soft route; pinned GREEN, no user-facing regression.

### 6. [cosmetic] Sidecar asymmetry — citation shapes a ref on create but footnote does not write footnotes.json
- **Category:** citation-footnote-align
- **Where:** `action-registry.ts:1096` `createCitation` and `:1184` `createFootnote`.
- **Repro:** Typing a footnote with body yields a `createFootnote` call carrying only `existingFootnoteId` mode pristine; the body lives only in the in-doc atom content attr.
- **Expected:** Confirm whether not writing footnotes.json for a new footnote is intended.
- **Actual:** Appears intentional; footnote body serialized into the tex marker and `FootnoteRef` content fills only on card edit; informational, not a bug.

## Test files to commit

- `src/lib/actions/__tests__/chip8-citation-footnote-crosssurface.test.ts`
- `src/lib/tiptap/__tests__/chip8-lifecycle-perkind.test.ts`
- `src/lib/actions/__tests__/chip8-heading-blockinsert-crosssurface.test.ts`
- `src/lib/actions/__tests__/chip8-ref-title-crosssurface.test.ts`
- `src/lib/actions/__tests__/chip8-format-marks.test.ts`
