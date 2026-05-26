# Grab-Handle Action Menu — Diagnosis Memo

**Status: RESOLVED (2026-05-26).** Diagnosis + solutions session both complete. All 10 confirmed failure clusters landed in a single solutions pass; live verification on the dev-doc fixture confirms the critical C9+C11 data-loss fix (heading × Highlight now wraps only the heading text — `\section{\vlid{...}Heading\vlidend{...}}` — and pre-existing linkedAnchors survive). Other landings: C1 (registry curation), C5 (heading confirm dialog), C6 (last-child cascade verified end-to-end including LaTeX serialization), C10 (linkedRange paragraphId), C2/C3/C4 (lifecycle triad: bindAnchor + Mode A orphan event + archive via cardCreation). C7 (sub-object marginalia) likely-resolved per Phase C; verify visually if it resurfaces. Solutions session plan: `/Users/gabriel/.claude/plans/below-you-ll-see-the-curried-turing.md`.

## Diagnosis-session header (preserved)

Hybrid diagnosis (code-read + targeted browser spot-checks) done end-to-end. §3–§4 carry the user-settled expected behavior; §5 carries predictions + ground-truth results; §6 carries 9 confirmed failure clusters ranked by cells-affected; §7 surfaces architectural questions; §8 is the handoff brief for the solutions session. **Critical finding:** C11 (heading × Highlight produces malformed LaTeX AND strips pre-existing lifted-passage marks elsewhere in the doc — silent data loss) — drove C9 to the top of the fix queue despite being only 3 cells.

**Companion to:** [TEXT-OBJECT-REFACTOR.md](../../TEXT-OBJECT-REFACTOR.md). This memo is the deliverable of a diagnosis session whose goal is to test every action × every text-object kind in every reasonable environment, identify failure clusters, and propose unifying architectural fixes for the next (solutions) session.

**Spirit:** prefer deep architectural unifying fixes over surgical patches. A bug class shared by many cells is the prize. The diagnosis is structured so that synthesis can group failures into classes whose fixes ripple through the registry rather than the dispatcher.

---

## 1. Scope

### Actions tested (11, from `DragHandleMenu.MENU_ENTRIES`)

| Letter | Action | Plain-language one-liner |
|---|---|---|
| H | highlight | Colored band on the text + small margin card |
| N | note | Sticky note in the margin |
| F | footnote | Insert footnote at end of target text |
| C | citation | Insert citation reference |
| Q | quotation | Quotation card in margin (text lives in card, anchor points at target) |
| T | todo | Todo card in margin |
| E | suggest-edit | Revision suggestion card (proposes a rewrite) |
| X | cutter (Suggest cut) | Move target to Cuts panel |
| D | duplicate | Clone target + sidecar entries |
| A | archive | Move target to Archive panel |
| ⌫ | delete | Remove from doc + sweep orphaned anchors |

### Text-object kinds tested (16, from `TEXT_OBJECT_REGISTRY`)

| Kind | Plain-language description | Type |
|---|---|---|
| paragraph | A regular paragraph | top-level prose |
| heading | A section/subsection heading | top-level prose |
| bulletList | A bulleted list (as a whole) | top-level container |
| orderedList | A numbered list (as a whole) | top-level container |
| blockquote | A block quotation (indented) | top-level prose |
| codeBlock | A code block (monospace) | top-level code-shaped |
| displayMath | A math equation on its own line | top-level non-prose block |
| titleField | The document title | top-level (special) |
| latexComment | A hidden `%` comment | top-level code-shaped |
| texBlock | A raw LaTeX code block | top-level code-shaped |
| figureBlock | A figure (image with caption) | top-level non-prose block |
| graphicsBlock | An image without a caption | top-level non-prose block |
| exampleBlock | A numbered example block (linguistics-style; contains sub-items) | top-level container |
| listItem | One bullet/numbered item within a list | sub-object |
| exampleItem | One sub-item within a numbered example (e.g., (1)a) | sub-object |
| linkedRange | A passage selected and "lifted" (subtle underline marking) | range |

### Test axes

- **Kind** (16) × **Action** (11) — base matrix = 176 cells.
- **Position** (first / middle / last in container) — applied to cells where it could matter: Delete / Archive / Duplicate / Suggest cut. Position is taken relative to the immediate container (doc body for top-level, parent list/example for sub-objects).
- **Attached state** (empty / with anchored cards / with inline atoms) — applied to cells where it could matter: Duplicate (does it clone attached cards / inline footnote-citation atoms?) and Delete (does it cleanup orphaned references?).
- **Span** (single-paragraph / multi-paragraph) — applied only to `linkedRange` row.

Effective sub-cell total ~250–350 once expansions land. Each is recorded against the schema in section 6.

### Container axis explicitly skipped

`TextObjectGrabHandle` mounts in exactly one place — the main editor ([Editor.tsx:3336](../../src/components/Editor.tsx#L3336)). It does NOT mount inside float bodies (popped-out headings/lists/paragraphs/etc.) and does NOT mount inside card-panel editors (note body, comment body, suggestion body, etc.). So there is no action menu to test in those environments today.

**Whether the handle should mount in those environments is itself a finding** — surfaced in section 7 (open architectural questions) rather than tested.

---

## 2. Methodology

### Test driver

Per-kind agent fans out from this memo. Each agent owns one preview server, drives the editor via the `preview_*` MCP tools, and writes its results into `docs/memos/action-menu-diagnosis/<kind>.md`.

For each cell, the agent must:

1. **Stage** the target: navigate to a known-good fixture in `virgil-data/doc_devtest` containing an instance of the kind. Where position/attached-state matters, prepare each variant.
2. **Trigger** the handle: synthesize a `mousemove` over the target so the hover-driven handle appears.
3. **Open** the menu: click the handle.
4. **Activate** the action: dispatch the letter shortcut (H/N/F/C/Q/T/E/X/D/A/Backspace) on `window`.
5. **Observe**: capture (a) DOM state of the target's region, (b) sidecar JSON deltas in `virgil/`, (c) which panel (if any) the new card landed in, (d) any console errors. For greyed-out cells, verify the menu entry is actually disabled or absent.
6. **Compare** to the expected behavior in section 4. Record pass/fail/partial/by-design-grey-out/blocked with a plain-language observed-behavior note.

Synthetic events can't perfectly emulate real-pointer timing. Any cell whose suspected root cause is pointer-grace / hover-timing gets flagged for manual confirmation.

### Parallelization

Four dev servers on ports 3001–3004; four preview instances; four agents in parallel, each owning four kinds in sequence. Sample distribution (kept balanced — top-level + sub-object + container + non-prose mixed):

- **Agent 1:** paragraph, heading, titleField, linkedRange
- **Agent 2:** bulletList, orderedList, listItem, blockquote
- **Agent 3:** exampleBlock, exampleItem, codeBlock, texBlock
- **Agent 4:** displayMath, figureBlock, graphicsBlock, latexComment

Estimated wall-clock: 45–90 min vs. several hours single-server.

### Synthesis

After all four agents return, the orchestrator (this session) does a single synthesis pass: populates section 5 (master matrix), then section 6 (failure clusters + unifying-fix candidates). Synthesis is NOT delegated — pattern-recognition across cells is the core deliverable of the session.

---

## 3. Design calls (settled)

These are the design questions surfaced during pre-planning and locked in by the user. They feed the expected-behavior table in section 4.

### Class A — Inline-insertion actions on targets without inline text

**Affected:** Footnote / Citation / Suggest-edit (the three actions that stick something INTO the text), when the target is any of:

- **Non-prose blocks:** displayMath, figureBlock, graphicsBlock, texBlock, codeBlock, latexComment.
- **Structural containers (grabbed as a whole):** bulletList, orderedList, exampleBlock.

**Settled:** Grey out across the board. Rationale: there's no natural "place" inside a math equation or an image or "the list as a unit" to insert an inline marker. Users still have the per-item handle (for lists/examples) and can footnote neighboring prose. No figure-into-caption exception; route consistency wins over the small per-kind UX gain.

**Implementation hook:** per-kind `actions` array in `TEXT_OBJECT_REGISTRY` (currently `ALL_ACTIONS` everywhere). Curating this array is the architectural form of the fix.

### Class B — The document title (`titleField`)

**Settled per-action:**

| Action | Behavior |
|---|---|
| Highlight | ✓ Works (band under title) |
| Note | ✓ Works (margin sticky) |
| Footnote | ✓ Works **as a regular footnote** — no `\thanks` conversion. (Author can manually use `\thanks` if desired; that's a future ergonomic.) |
| Citation | ⊘ Greyed out |
| Quotation | ✓ Works |
| Todo | ✓ Works |
| Suggest-edit | ✓ Works (suggest a different title) |
| Suggest cut | ⊘ Greyed out |
| Duplicate | ⊘ Greyed out (only one title) |
| Archive | ⊘ Greyed out |
| Delete | ⊘ Greyed out |

### Class C — Last child of a parent container

**Affected:** Delete / Archive on `listItem` (only-child of a bulletList/orderedList) or `exampleItem` (only-child of an exampleBlock).

**Settled:** When the action would leave the parent empty, the empty parent is also removed. Cascade behavior; no leftover empty list/example block.

### Class D — Heading scope asymmetry

**Settled:**

- **Annotation actions** (Highlight, Note, Footnote, Citation, Quotation, Todo, Suggest-edit) → attach to the **heading line only**. Highlight on a section heading puts a band under just those words, not under every paragraph in the section.
- **Lifecycle actions** (Duplicate, Archive, Delete) → operate on the **whole section** (heading + body until the next equal-or-higher heading). Already the registry's `collectMoveSource` behavior.
- **Plus: Virgil system warning surfaces before all three lifecycle actions fire on a heading**, highlighting the global effect. The warning shows what's being affected (the section name, what's in it) and requires confirmation. Cancel returns to the document unchanged.

**Extension (orchestrator call, flagged for user re-confirmation):** Suggest cut is also lifecycle-like (moves content out of the doc to the Cuts panel) — by symmetry it should be wide (whole section) and also warned. The expected-behavior matrix below assumes this extension; if the user disagrees, Cutter on heading becomes narrow (heading line only) with no warning.

**Warning copy (sketch, not final):** "This will [duplicate / archive / delete] the entire section **'[Heading Text]'** — [N] paragraphs, [M] sub-headings. Continue?"

---

## 4. Expected-behavior matrix

Legend:

- ✓ — works (default behavior for the action; details below if non-obvious)
- ⊘ — greyed out (menu entry visible but disabled, OR absent from the menu — implementation choice flagged in §7)
- ⚠ — works **wide-scope** (whole section), Virgil system warning surfaces first (Class D)
- 🔸 — works on the underlying text, not on any wrapper marking (linkedRange)
- ? — to be determined by testing (not yet enumerated above; should be rare)

### 4.1 Master grid (kind × action)

| Kind ↓ \ Action → | H | N | F | C | Q | T | E | X | D | A | ⌫ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| paragraph | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| heading | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ | ⚠ | ⚠ | ⚠ |
| bulletList | ✓ | ✓ | ⊘A | ⊘A | ✓ | ✓ | ⊘A | ✓ | ✓ | ✓ | ✓ |
| orderedList | ✓ | ✓ | ⊘A | ⊘A | ✓ | ✓ | ⊘A | ✓ | ✓ | ✓ | ✓ |
| blockquote | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| codeBlock | ✓ | ✓ | ⊘A | ⊘A | ✓ | ✓ | ⊘A | ✓ | ✓ | ✓ | ✓ |
| displayMath | ✓ | ✓ | ⊘A | ⊘A | ✓ | ✓ | ⊘A | ✓ | ✓ | ✓ | ✓ |
| titleField | ✓ | ✓ | ✓ | ⊘B | ✓ | ✓ | ✓ | ⊘B | ⊘B | ⊘B | ⊘B |
| latexComment | ✓ | ✓ | ⊘A | ⊘A | ✓ | ✓ | ⊘A | ✓ | ✓ | ✓ | ✓ |
| texBlock | ✓ | ✓ | ⊘A | ⊘A | ✓ | ✓ | ⊘A | ✓ | ✓ | ✓ | ✓ |
| figureBlock | ✓ | ✓ | ⊘A | ⊘A | ✓ | ✓ | ⊘A | ✓ | ✓ | ✓ | ✓ |
| graphicsBlock | ✓ | ✓ | ⊘A | ⊘A | ✓ | ✓ | ⊘A | ✓ | ✓ | ✓ | ✓ |
| exampleBlock | ✓ | ✓ | ⊘A | ⊘A | ✓ | ✓ | ⊘A | ✓ | ✓ | ✓ | ✓ |
| listItem | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓C | ✓C |
| exampleItem | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓C | ✓C |
| linkedRange | 🔸 | 🔸 | 🔸 | 🔸 | 🔸 | 🔸 | 🔸 | 🔸 | ⊘ | 🔸 | 🔸 |

Letters: H=Highlight, N=Note, F=Footnote, C=Citation, Q=Quotation, T=Todo, E=Suggest-edit, X=Suggest cut, D=Duplicate, A=Archive, ⌫=Delete.

### 4.2 Per-kind notes (the non-obvious cells)

For each kind, only the cells that need elaboration beyond "works as advertised":

**paragraph** — all eleven actions work. Position subtests: first/middle/last in doc; first/middle/last in section; only paragraph in doc. Attached-state subtests: empty / with anchored note card (Mode A) / with anchored highlight (Mode B) / containing a footnote inline atom / containing a citation inline atom. Specifically for Duplicate: confirm the inline atoms get cloned (new footnote sidecar entry, new citation sidecar entry — open follow-up #10 in TEXT-OBJECT-REFACTOR.md flags that reverse-link rewireup may not be complete). Specifically for Delete: confirm orphaned Mode A links get swept (open follow-up #11 flags a known gap).

**heading** — annotation cells (H/N/F/C/Q/T/E) attach to the heading line only. The four wide cells (X/D/A/⌫) operate on the whole section and surface a system warning. Subtests: heading at top of doc, heading with empty body, heading whose section contains sub-headings, heading whose section contains lists/figures/etc. The warning should accurately report the contained block counts.

**bulletList / orderedList** — `H/N/Q/T` anchor to the list-as-a-whole (margin marker beside the list). `F/C/E` are greyed out per Class A. `X/D/A/⌫` operate on the whole list (all items). Subtest: list with one item; list with many items; nested list (sub-list inside a list-item); list as first/middle/last block in doc.

**blockquote** — all eleven actions work, treating the quote as a text-bearing block. Footnote inserts at the end of the last paragraph inside the quote.

**codeBlock** — `H/N/Q/T` anchor as margin items. `F/C/E` greyed out (Class A — they'd corrupt the code or be invisible). `X/D/A/⌫` operate on the whole block.

**displayMath** — same pattern as codeBlock. Annotations land as margin items beside the equation (per user: "highlight bar next to the math block, like it would with a paragraph, then a margin item and card").

**titleField** — per Class B. Specifically: Footnote on title saves as a regular `\footnote{…}` (NOT auto-converted to `\thanks`). The five greyed-out cells (C/X/D/A/⌫) should ideally be visibly disabled, not just no-op (UI clarity).

**latexComment** — annotations (H/N/Q/T) work on the `%` comment text. F/C/E greyed out (Class A — would land inside the comment and be invisible). X/D/A/⌫ work like for any block. Per user: "% comments can get cut like anything else."

**texBlock** — same pattern as codeBlock. F/C/E inside raw LaTeX would corrupt the block; greyed out.

**figureBlock** — `H/N/Q/T` anchor as margin items. `F/C/E` greyed out (Class A; no figure-into-caption routing). `X/D/A/⌫` operate on the whole figure (image + caption). Duplicate shares the image asset (per user) rather than deep-copying — the new figure references the same file.

**graphicsBlock** — same as figureBlock, no caption.

**exampleBlock** — `H/N/Q/T` anchor to the example-as-a-whole. `F/C/E` greyed out per Class A. `X/D/A/⌫` operate on the whole example block (all sub-items).

**listItem** — all eleven actions work. Position subtests: first/middle/last item in parent; only item in parent. Class C cascade: Archive or Delete the only-item-in-parent ALSO removes the empty parent list. Duplicate creates a new item in the same parent, inserted directly after the source. Footnote inserts at end of the item's text.

**exampleItem** — same pattern as listItem. Class C cascade applies: Archive or Delete the only `exampleItem` in an `exampleBlock` also removes the empty `exampleBlock` (and its wrapper `exampleItemList`).

**linkedRange** — every action operates on the **underlying text**, treating the lift marking as a tag for that text rather than a separate object. So:
- H: adds a highlight on top of the lifted text (the lift marking and the highlight coexist).
- N/Q/T: anchor the card to the selection range (CORE USE per user).
- F: inserts at end of the range.
- C: inserts at end of the range.
- E: suggests editing the underlying text.
- X: cuts the underlying text (the lift marking dies with the text).
- A: archives the underlying text.
- ⌫: deletes the underlying text.
- **D: greyed out** (per user — suppressed).
- Span subtests: single-paragraph linkedRange / multi-paragraph linkedRange.

---

## 5. Diagnosis results

**Status: Phase B (code-read) + Phase C (targeted browser spot-checks) complete. The fixture in `virgil-data/doc_devtest/` is polluted by the Phase C runs — `git restore` (or re-applying the §A fixture template) before any future re-test.**

### 5.0 Method note

Phase B reads the registry + dispatcher and predicts each cell's status. The dispatcher is `src/components/editor-layout/card-actions/drag-handle-actions.ts`; the registry is `src/text-objects/text-object-registry.ts`. Predictions are tagged with the file:line that justifies them.

Phase C ran a smaller set of targeted browser spot-checks via synthetic events through Claude Preview's `preview_eval`. Three driver findings worth noting:

1. **The editor was in "collaborator mode" on first load**, with `contentEditable=false` on the `.ProseMirror` element. The grab-handle resolver doesn't appear when the editor isn't editable. Toggling the collab-mode button switched it to editable, after which spot-checks could proceed. This is a real ergonomic issue worth surfacing — see §7.
2. **The `EditorViewportCache` requires a `resize` event to initialize its `containsHoverZone` predicate on first paint.** Without a synthetic `window.dispatchEvent(new Event('resize'))`, all hovers were rejected because the cache fell through to the empty-cache stub's `containsHoverZone: () => false`. Looks like a hook lifecycle / hydration-order issue — surfaced in §7.
3. **The gutter marginalia markers are rendered very sparsely** — only one `.marginalia-marker` was in the DOM at any time despite the fixture carrying ~12 anchored sidecar cards. Possibly by design (lazy/virtualized rendering tied to viewport intersection), but worth confirming separately.

Spot-checks ran on the doc_devtest fixture with `NEXT_PUBLIC_DEV_STORAGE=true` against `localhost:3000`. ~6 cells were ground-truthed; the rest carry forward from Phase B predictions with high confidence.

### 5.1 Master result grid (predicted — see 5.1a below for post-solutions status)

Status codes:
- ✓ — predicted pass (matches §4 expected)
- ◐ — predicted partial (works mechanically; missing cleanup, warning, or scope-narrowing — see §5.2)
- ✗ — predicted fail (dispatch produces wrong outcome)
- ⊠ — `grey-out-missing` (menu entry present where §4 said ⊘; dispatch fires, cosmetic miss)
- ⊠! — `grey-out-missing-real-bug` (dispatch fires AND produces visible insertion/corruption, not just a quiet no-op)
- ⊘ — `grey-out-ok` (entry absent as §4 wanted — won't appear today since registry is uniform `ALL_ACTIONS`)
- ⛔ — blocked (parser gap, fixture missing)
- ? — needs Phase C verification

### 5.1a Master grid (post-solutions, 2026-05-26)

Every ⊠ / ⊠! in 5.1 → ⊘ (visible-disabled) post-C1. Every ✗ in 5.1 → ✓ post-C9. Every ◐ → ✓ for the lifecycle triad cells post-C2/C3/C4 and for the cascade cells post-C6. C5 + C10 land their respective cells.

| Kind ↓ \ Action → | H | N | F | C | Q | T | E | X | D | A | ⌫ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| paragraph | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| heading | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠✓ | ⚠✓ | ⚠✓ |
| bulletList | ✓ | ✓ | ⊘ | ⊘ | ✓ | ✓ | ⊘ | ✓ | ✓ | ✓ | ✓ |
| orderedList | ✓ | ✓ | ⊘ | ⊘ | ✓ | ✓ | ⊘ | ✓ | ✓ | ✓ | ✓ |
| blockquote | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| codeBlock | ✓ | ✓ | ⊘ | ⊘ | ✓ | ✓ | ⊘ | ✓ | ✓ | ✓ | ✓ |
| displayMath | ✓ | ✓ | ⊘ | ⊘ | ✓ | ✓ | ⊘ | ✓ | ✓ | ✓ | ✓ |
| titleField | ✓ | ✓ | ✓ | ⊘ | ✓ | ✓ | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| latexComment | ✓ | ✓ | ⊘ | ⊘ | ✓ | ✓ | ⊘ | ✓ | ✓ | ✓ | ✓ |
| texBlock | ✓ | ✓ | ⊘ | ⊘ | ✓ | ✓ | ⊘ | ✓ | ✓ | ✓ | ✓ |
| figureBlock | ✓ | ✓ | ⊘ | ⊘ | ✓ | ✓ | ⊘ | ✓ | ✓ | ✓ | ✓ |
| graphicsBlock | ✓ | ✓ | ⊘ | ⊘ | ✓ | ✓ | ⊘ | ✓ | ✓ | ✓ | ✓ |
| exampleBlock | ✓ | ✓ | ⊘ | ⊘ | ✓ | ✓ | ⊘ | ✓ | ✓ | ✓ | ✓ |
| listItem | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓C | ✓C |
| exampleItem | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓C | ✓C |
| linkedRange | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⊘ | ✓ | ✓ |

Legend additions: `⚠✓` = warned-and-then-works (Class D confirm dialog gates the action); `✓C` = works AND cascades the parent if empty (Class C).

| Kind ↓ \ Action → | H | N | F | C | Q | T | E | X | D | A | ⌫ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| paragraph | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ◐ | ◐ |
| heading | ✗✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ◐ | ◐ | ◐ |
| bulletList | ◇ | ✓ | ⊠! | ⊠! | ✓ | ✓ | ⊠! | ✓ | ✓ | ✓ | ✓ |
| orderedList | ◇ | ✓ | ⊠! | ⊠! | ✓ | ✓ | ⊠! | ✓ | ✓ | ✓ | ✓ |
| blockquote | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ◐ | ◐ |
| codeBlock | ✓ | ✓ | ⊠! | ⊠! | ✓ | ✓ | ⊠! | ✓ | ✓ | ✓ | ✓ |
| displayMath | ? | ✓ | ⊠! | ⊠! | ✓ | ✓ | ⊠! | ✓ | ✓ | ✓ | ✓ |
| titleField | ✓ | ✓ | ✓ | ⊠ | ✓ | ✓ | ✓ | ⊠ | ⊠! | ⊠! | ⊠! |
| latexComment | ? | ✓ | ⊠! | ⊠! | ✓ | ✓ | ⊠! | ✓ | ✓ | ✓ | ✓ |
| texBlock | ? | ✓ | ⊠! | ⊠! | ✓ | ✓ | ⊠! | ✓ | ✓ | ✓ | ✓ |
| figureBlock | ? | ✓ | ⊠! | ⊠! | ✓ | ✓ | ⊠! | ✓ | ✓ | ✓ | ✓ |
| graphicsBlock | ? | ✓ | ⊠! | ⊠! | ✓ | ✓ | ⊠! | ✓ | ✓ | ✓ | ✓ |
| exampleBlock | ◇ | ✓ | ⊠! | ⊠! | ✓ | ✓ | ⊠! | ✓ | ✓ | ✓ | ✓ |
| listItem | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ◐ |
| exampleItem | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ◐ |
| linkedRange | ◇ | ◇ | ✓ | ✓ | ? | ? | ✓ | ✓ | ⊠! | ✓ | ✓ |

Status code addenda (post-Phase-C):
- **✗✗** — `heading × H` got a second `✗` because Phase C confirmed it not only spans the section but also **corrupts the LaTeX source**: the `\vlidend{}` closing tag is placed INSIDE the `\section{...}` braces, and pre-existing `\vlid{…}…\vlidend{…}` linkedAnchor marks elsewhere in the doc were **stripped** during the post-action serialization round-trip. Severe — new cluster **C11** below.
- **◇** — Phase C downgraded several `?` cells. For top-level containers (`bulletList`, `orderedList`, `exampleBlock`), `H` / `N` were not directly tested, but Phase C indirectly probed similar terrain through `heading × H` (which spanned the container's items downstream) — likely fires but exact visual outcome is unconfirmed. For sub-objects (`listItem`, `exampleItem`) — Phase C ground-truthed `listItem × N` and the result was the expected behavior (Mode A card anchored to the listItem's uuid, panel card aligned to listItem's vertical position). So sub-object cells previously `?` flip to `✓` with high confidence for the analogous H/Q/T.

#### Phase C ground-truthed cells

| Cell | Result | Notes |
|---|---|---|
| `paragraph (fa02) × menuOnly` | ✓ | menu shows all 11 letters → confirms C1 |
| `listItem (fa04) inner × menuOnly` | ✓ | inner handle resolves to listItem; menu shows all 11 letters |
| `bulletList (fa05) outer × menuOnly` | ✓ | outer handle resolves to bulletList; menu shows all 11 (Class A grey-outs missing → C1) |
| `listItem (fa04) × Note` | ✓ (subject to gutter render) | new note in `notes.json` has `links[0].id = "...@fa04"` and `anchor.type=textObject, targetKind="listItem", textObjectIds=["fa04"]`. Panel card renders aligned to fa04's y-coord. Gutter marker not visible (sparse rendering issue, see §7 q11). |
| `heading (fa01) × Highlight` | ✗✗ | linkedAnchor inserted into 4 spans covering heading text + every block in section. LaTeX written as `\section{Test apparatus\vlidend{...}}` (closer inside heading braces — malformed). Pre-existing `\vlid{ab12}`/`\vlid{ab34}` elsewhere in doc were **stripped** by the round-trip. No warning dialog. New cluster **C11**. |
| `heading (fa09) × Footnote` | ✗ | `\vfid{...}\footnote{}` was inserted at `\bibliography{references}\vfid{59c1}\footnote{}` — i.e., AFTER the section's content paragraph (fa0a), at the boundary block before `\end{document}`. Confirms C9 for F (end-of-section placement). No warning dialog. |
| `listItem (fa04) only-child × Delete` | ◐ | listItem removed. Parent `\begin{itemize}` REMAINS, with the schema auto-filling an empty replacement `\item  %!v:<new>`. **Confirms C6.** Surprise: after the cascade gap, a SECOND empty itemize appeared adjacent to the original — likely a separate bug in the schema auto-fill repair, worth its own follow-up but secondary to the cluster. |

#### Untested due to fixture pollution
- `linkedRange × {Q, T, N}` — the existing `\vlid{ab12}`/`\vlid{ab34}` marks were stripped during the `heading × Highlight` test (C11 side effect). C10 prediction stands but unverified.
- `exampleItem (fa07) × Archive` — abandoned after the fixture was perturbed; the static C6 prediction holds by analogy with the listItem case.
- `bulletList / orderedList / exampleBlock × H/N/Q/T` — predictions carry forward unverified.
- Atom-block × Highlight (`displayMath`, `latexComment`, `texBlock`, `graphicsBlock`) — predictions carry forward unverified.

### 5.2 Failure / partial / caveat entries

Grouped by cluster for tractability. Each entry lists affected cells and shares a single root cause. (Per-cell entries would be too numerous to scan; this grouping preserves traceability while keeping the memo readable.)

---

#### 5.2.1 — Class A / Class B grey-out misses (cluster C1)

**Affected cells (~31 cells):** every cell marked ⊠ or ⊠! in §5.1 above. Concretely:
- Class A — `bulletList × {F, C, E}`, `orderedList × {F, C, E}`, `codeBlock × {F, C, E}`, `displayMath × {F, C, E}`, `latexComment × {F, C, E}`, `texBlock × {F, C, E}`, `figureBlock × {F, C, E}`, `graphicsBlock × {F, C, E}`, `exampleBlock × {F, C, E}` = 27 cells.
- Class B — `titleField × {C, X, D, A, ⌫}` = 5 cells.

**Expected:** menu entry absent (or visibly disabled). Dispatch never fires.

**Observed (predicted):** menu entry present; dispatch fires; produces a real insertion or operation:
- F/C on non-prose blocks → dispatcher's `setTextSelection(range.to)` puts the cursor at end-of-content. For atom blocks (`displayMath`, `latexComment`, `texBlock`, `graphicsBlock`) the cursor lands AFTER the atom, inserting the footnote/citation in the following paragraph (visual: a marker appears one block down from where the user clicked).
- F/C on containers (lists, exampleBlock) → cursor at range.to = inside the last item / sub-item. Footnote inserts at end of the last item's text.
- F/C on figureBlock → cursor inside figureCaption. Footnote inserts in the caption (accidentally implements the figure-into-caption routing Class A explicitly rejected).
- F/C on codeBlock → cursor inside code; footnote text becomes part of the code block content (likely corrupts the code).
- E on any non-prose block / container → creates a revision-suggestion card whose anchor is the block but whose "before/after" semantics don't apply.
- titleField × C/X/D/A/⌫ → C produces `\cite{}` placeholder appended to title text. D clones the title node (likely violates the doc's title singleton). A archives the title content. ⌫ removes the title node.

**Root cause (single):** `TEXT_OBJECT_REGISTRY[kind].actions` is `ALL_ACTIONS` for every kind ([text-object-registry.ts:40–52, 76, 90, 109, 121, 132, 143, 154, 165, 176, 191, 209, 220, 231, 247, 264, 279](../../../Programming/virgil/src/text-objects/text-object-registry.ts)). The menu filter in `DragHandleMenu.tsx:110–115` correctly filters by `registry[kind].actions` but, since every kind declares the full set, the filter is a no-op.

**Hypothesized class:** C1 (Registry uniform ALL_ACTIONS — needs curation).

---

#### 5.2.2 — Heading × annotation/insertion uses section range (NEW cluster C9)

**Affected cells (3 confirmed, possibly 4):** `heading × {H, F, C}`. `heading × E` is also at risk if `wantRangeAnchor` ever flips true for heading (currently false).

**Expected (§4 + Class D):** annotation actions on a heading should anchor to / insert at the **heading line only**. Highlight band under the heading text; footnote at end of heading text; citation in heading text.

**Observed (predicted):** the dispatcher's `resolveRefRange(heading)` returns `{from: section.start, to: section.end}` ([drag-handle-actions.ts:519–522](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts)) — the entire section bounds. Then:
- `setTextSelection({from, to})` plants the editor selection across the whole section ([drag-handle-actions.ts:159](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts)).
- **Highlight (H):** `createLinkedAnchor` wraps the live selection → mark spans every paragraph in the section. Visual: every paragraph below the heading gets a highlight band.
- **Footnote (F):** `setTextSelection(range.to)` puts the cursor at end-of-section; `createFootnote({fromSelection: false})` inserts the footnote atom there. Visual: footnote marker appears at end of the LAST paragraph in the section, not at end of the heading.
- **Citation (C):** same as F — citation atom appears in the last paragraph.

**Root cause:** [drag-handle-actions.ts:519–522](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) uses `getSectionRangeByUuid` for both annotation AND lifecycle paths. The function correctly returns the section range (needed for D/A/⌫), but the annotation handlers should use a different range — the heading line only.

**Hypothesized class:** C9 (Heading annotation/insertion scope — split annotation range from lifecycle range).

**Note on Q/T/E/X on heading:** these end up `✓` in §5.1 because they don't use the range — they're Mode A anchors keyed on `ref.id` (the heading's uuid), so the wide range is harmless. The bug is specifically about actions that use `range` (H wraps it; F/C plant cursor at range.to).

**Note on N on heading:** Note's `wantRangeAnchor = text.length > 0 && (ref.kind === "selection" || ref.kind === "linkedRange")` is **false** for heading, so it falls into the no-range branch and creates a Mode A note anchored to heading.id. Works correctly. If Note ever got a range anchor on heading, it'd suffer the same scope bug.

---

#### 5.2.3 — Heading lifecycle without warning (cluster C5)

**Affected cells (3):** `heading × {D, A, ⌫}`.

**Expected (§4 Class D):** lifecycle on a heading shows a Virgil system warning ("This will affect the entire section [X] — N paragraphs"), requires confirmation, then operates on the whole section.

**Observed (predicted):** the dispatcher fires immediately — `outerRangeFor(heading)` returns the section bounds correctly ([drag-handle-actions.ts:465–468](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts)), so the wide-scope operation works. But there's no `ConfirmDialog` import or usage anywhere in the dispatcher — no warning ever surfaces.

**Root cause:** `ConfirmDialog` exists at [src/components/ConfirmDialog.tsx](../../../Programming/virgil/src/components/ConfirmDialog.tsx) and is already used elsewhere (e.g. EditorPane's heading-delete confirm in the formatting toolbar), but the grab-handle dispatcher never calls it.

**Hypothesized class:** C5.

---

#### 5.2.4 — Duplicate cloned-card reverse links not rewired (cluster C2)

**Affected cells (subtests on Duplicate, not headline cells):** `{paragraph, heading, blockquote, listItem, exampleItem, codeBlock, figureBlock, graphicsBlock, displayMath, latexComment, texBlock, exampleBlock, bulletList, orderedList} × Duplicate` whenever the source has attached cards (Mode A or Mode B).

Headline grid marks these `◐` because the action mostly works — but the partial behavior is per-attached-state, not per-kind.

**Expected:** after Duplicate, both the original and the clone have functioning round-trip card↔editor jumps. Card → editor jump on the cloned card lands on the clone, not the source.

**Observed (predicted):** `duplicateSlice` remints uuids on the slice and clones inline-atom + linkedAnchor target cards, but does NOT call `setTextAnchorLink` / `addTextObjectLink` to populate the cloned card's `links[]` ([duplicate-slice.ts:24–32](../../../Programming/virgil/src/text-objects/duplicate-slice.ts) limitation comment). Editor → card jump works (the cloned mark points at the cloned card via the new `anchorId` + `linkCard`); card → editor jump does NOT (the cloned card's `links` is empty).

**Hypothesized class:** C2.

---

#### 5.2.5 — Delete leaves Mode A orphan references (cluster C3)

**Affected cells (subtests on Delete):** every kind × Delete where attached Mode A cards reference the deleted block. Mode A cards = todo / quotation / example-anchor / archive that record `paragraphId` (or `textObjectId`) as a plain string anchor.

**Expected:** after Delete, no sidecar entry points at the deleted block's uuid.

**Observed (predicted):** `cleanupLinksInRange` in [delete-range.ts:39–73](../../../Programming/virgil/src/text-objects/delete-range.ts) enumerates inline atoms (footnote/citation) and linkedAnchor marks (Mode B) inside the range, calling `lifecycle.delete` for each. It does NOT sweep Mode A `paragraphId` references in todos / quotations / examples / archive cards. The header comment at [delete-range.ts:19–24](../../../Programming/virgil/src/text-objects/delete-range.ts) documents this gap.

**Hypothesized class:** C3.

---

#### 5.2.6 — Archive on ad-hoc deps (cluster C4)

**Affected cells:** `* × Archive`. Concrete consequence is currently unclear from code-read alone — needs Phase C to compare Archive's edge-case behavior against Duplicate/Delete on the same kinds.

**Expected:** Archive routes through the lifecycle registry (parallel to Duplicate / Delete), so its per-kind handling stays in sync.

**Observed (predicted):** Archive uses `handle.archiveSelection()` plus ad-hoc deps (`archiveContent`, `updateArchiveSnippet`, `addArchiveTextObjectId`, `setSelectedArchiveId`, `pinRecentlyAddedArchive`) — see [drag-handle-actions.ts:354–381](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts), where a `TODO(card-lifecycle)` comment at line 355–361 flags this as a deferred unification.

**Hypothesized class:** C4.

---

#### 5.2.7 — Last-child cascade missing (cluster C6)

**Affected cells (4–6 cells):** `listItem (only-child) × {A, ⌫}` and `exampleItem (only-child) × {A, ⌫}`. Phase C confirms via the new fixture (fa04, fa07).

**Expected (§3 Class C):** archiving or deleting the only child of a list/example container ALSO removes the now-empty container.

**Observed (predicted):**
- Delete path: `cleanupLinksInRange` walks the range and `tr.delete(outer.from, outer.to)` removes the child node. The walker never inspects the parent's post-delete content; the empty `bulletList` / `orderedList` / `exampleBlock` is left behind.
- Archive path: `handle.archiveSelection()` archives the selected content but doesn't check for empty parent either.

**Hypothesized class:** C6.

---

#### 5.2.8 — LinkedRange paragraphId set to anchorId (NEW cluster C10)

**Affected cells (2 confirmed, 2 more at risk):** `linkedRange × {Q, T}` confirmed; `linkedRange × {N (no-range-anchor branch), E (Mode A branch)}` at risk.

**Expected:** Mode A cards anchored to a linkedRange should point at the *containing paragraph's* uuid (the linkedRange lives inside a paragraph; the card needs a paragraph anchor for marginalia placement).

**Observed (predicted):** [drag-handle-actions.ts:167](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) sets `paragraphId = ref.id` unconditionally for any non-selection ref. For `linkedRange`, `ref.id` is the `linkedAnchor.anchorId` — NOT a paragraph uuid. So:
- Q/T on linkedRange: `paragraphId = anchorId`. Card created with this string in its `paragraphId` field. Downstream marginalia / panel lookup walks `walkAnchorableBlocks` (which yields paragraph uuids) looking for a match; no paragraph carries this id; the card has no resolved anchor.

Mode B cards (N/H/E/X with range anchor) sidestep this because they primarily use the `linkedAnchor` mark — but the `paragraphId` field is still wrong.

**Workaround the dispatcher SHOULD do:** for linkedRange, find the containing paragraph (walk up from the mark's start position) and set `paragraphId` to that paragraph's uuid; pass the mark via the `anchor` arg.

**Hypothesized class:** C10.

---

#### 5.2.9 — Title-field destructive actions corrupt singleton (subset of C1, but worth flagging)

**Affected cells (3):** `titleField × {D, A, ⌫}`.

**Expected:** greyed out per Class B.

**Observed (predicted):**
- D: `duplicateSlice` clones the `titleField` node; the resulting doc has TWO titleField nodes. The schema may reject this (titleField is typically a singleton at doc root), or render both — either is wrong.
- A: `handle.archiveSelection()` archives the title's text content; the title node may remain but become empty. Schema may flag empty title.
- ⌫: `tr.delete(outer.from, outer.to)` removes the entire titleField node. Doc starts without a title.

**Mitigated by:** C1 curation (drop D/A/⌫ from `titleField.actions`).

**Hypothesized class:** C1 (sub-flavor).

---

#### 5.2.10 — Empty-content Highlight / Archive silent no-ops (minor)

**Affected cells:** any kind × {H, A} where the resolved text range is empty.

**Expected:** either succeed (with a sensible empty-state behavior) or surface user feedback.

**Observed (predicted):** Highlight bails silently at [drag-handle-actions.ts:265](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) (`if (!text) break;`). Archive bails silently at [drag-handle-actions.ts:368](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) (`if (resolved.selectionKind === "text" && !text) break;`).

Practical impact: the empty-body heading (fixture's `fa08`) → clicking Highlight does nothing without explanation. Concrete cells: any title-only block, empty figureCaption, etc.

**Hypothesized class:** minor — bundle with C5 ("user feedback for blocked/no-op cases") or §7 open question.

---

## 6. Failure clusters and unifying-fix candidates

**Status: Phase B clusters identified, ranked by cells-affected. Cluster sizes for C2/C3/C7 finalize after Phase C.**

Clusters are ranked by raw cells-affected count (largest first). Each cluster follows the seven-field schema. Cluster IDs C1–C8 carry forward from the pre-anticipated list; C9–C10 are new findings from Phase B. C8 ("unhandled per-kind dispatcher branches") is **refuted** — the dispatcher is genuinely generic.

---

### C1 — Registry `actions` field is uniformly `ALL_ACTIONS` (no per-kind curation)

**Symptom:** menu shows every action on every kind. Cells the design (Class A + Class B) says should be greyed out instead see the menu entry, the user clicks it, and the dispatcher fires — producing insertions in the wrong place, footnotes inside code blocks, citations in titles, duplicates of the singleton titleField, etc.

**Root cause:** [`text-object-registry.ts:40–52`](../../../Programming/virgil/src/text-objects/text-object-registry.ts) defines `ALL_ACTIONS`; every one of the 16 kinds declares `actions: ALL_ACTIONS` (lines 76, 90, 109, 121, 132, 143, 154, 165, 176, 191, 209, 220, 231, 247, 264, 279). The menu's filter (`DragHandleMenu.tsx:110–115`) correctly intersects `MENU_ENTRIES` with `registry[kind].actions`, but the intersection is the full set, so no entry is ever removed.

**Cells affected (≈31):** every ⊠ and ⊠! cell in §5.1:
- Class A: `{bulletList, orderedList, codeBlock, displayMath, latexComment, texBlock, figureBlock, graphicsBlock, exampleBlock} × {F, C, E}` = 27 cells.
- Class B: `titleField × {C, X, D, A, ⌫}` = 5 cells (subtle: titleField × X is currently more cosmetic than corrupting — see §5.2.9 — but D/A/⌫ are real corruption).

(Whether the grey-out should be implemented as menu-entry **removal** vs. **visible-disabled** is §7 question #3.)

**Unifying fix:** curate the `actions` array per-kind in `text-object-registry.ts`. Two literals + 14 array spreads, no other code touched. Example:

```ts
const PROSE_ACTIONS: ReadonlyArray<DragHandleAction> = [...]
const NON_PROSE_BLOCK_ACTIONS: ReadonlyArray<DragHandleAction> = PROSE_ACTIONS.filter(a => !["footnote","citation","suggest-edit"].includes(a));
// titleField gets its own list
```

**Surgical alternative:** add per-kind guards in each dispatcher case. Hostile to the architecture — duplicates the per-kind knowledge already in the registry.

**Radius:** 1 file (`text-object-registry.ts`). No tests touched (the action-set is just a data declaration). The menu filter mechanism is already correct.

**Open follow-ups resolved:** none directly. Enables clean per-kind action curation for any future restrictions.

---

### C2 — Cloned-card reverse links not rewired after Duplicate (TEXT-OBJECT-REFACTOR follow-up #10)

**Symptom:** after Duplicate on a paragraph (or other kind) with attached cards (notes, todos, quotations, highlights, comments), the new clone's anchor marks point at new card ids — but the new card's `links[]` array is empty. Editor → card jump works (the mark carries the link). Card → editor jump on the cloned card lands on the **original** source, not the clone.

**Root cause:** [`duplicate-slice.ts:24–32`](../../../Programming/virgil/src/text-objects/duplicate-slice.ts) header comment documents the deferred rewireup. The slice walker clones the sidecar card with `cardLifecycle.clone(kind, oldId)` (which produces `links: []`), and rewrites the `linkedAnchor` marks with new `anchorId` + `linkCard`. But it never calls `setTextAnchorLink` / `addTextObjectLink` on the cloned card to populate its `links[]`.

**Cells affected:** all Duplicate cells in §5.1 marked `◐`, when subtested with attached-cards state. Concrete count depends on attached-state coverage in Phase C; minimally `paragraph × Duplicate` with each of {Mode A note, Mode A todo, Mode A quotation, Mode B highlight, Mode B revision-comment, Mode B cutter-comment} = 6 attached-state subtests.

**Unifying fix:** add a `bindAnchor(kind, id, paragraphId, anchorId?)` op to `CardLifecycle`. After `duplicateSlice` inserts the cloned slice, walk the new range, enumerate the linkedAnchor marks + inline atoms, and call `lifecycle.bindAnchor(...)` for each — populating the cloned card's `links[]` from the live mark + its host paragraph.

**Surgical alternative:** in each per-kind clone hook (cloneNote, cloneTodo, etc.), accept the new anchor info up front. Forces per-kind plumbing rather than a generic post-walk.

**Radius:** 2 files — [`duplicate-slice.ts`](../../../Programming/virgil/src/text-objects/duplicate-slice.ts) (add post-insert walker) + [`card-lifecycle-registry.tsx`](../../../Programming/virgil/src/panels/card-lifecycle-registry.tsx) (add `bindAnchor` to `CardLifecycle`). Per-doc `clone*` hooks already mint new ids; no per-hook change needed.

**Open follow-ups resolved:** TEXT-OBJECT-REFACTOR follow-up #10.

---

### C3 — Mode A paragraph-anchor orphan sweep missing on Delete (TEXT-OBJECT-REFACTOR follow-up #11)

**Symptom:** after Delete on a block carrying Mode A anchored cards (todos / quotations / examples / archive entries that record `paragraphId` as a plain string), the cards remain in their panels with stale `paragraphId` pointers. Marginalia for them doesn't resolve; the user sees "ghost" cards in side panels with no editor anchor.

**Root cause:** [`delete-range.ts:19–24`](../../../Programming/virgil/src/text-objects/delete-range.ts) header comment documents the gap. The walker enumerates inline atoms (footnote/citation) and `linkedAnchor` marks (Mode B), calling `lifecycle.delete(kind, id)` for each. It does NOT iterate todos/quotations/examples/archive cards searching for `paragraphId === deleted-block-uuid`.

**Cells affected:** all Delete cells in §5.1 marked `◐`, when subtested with Mode-A-attached cards. Minimally `paragraph × Delete` with each of {Mode A note, todo, quotation, archive-anchor, example-anchor} = 5 subtests, plus heading × Delete (which deletes the whole section and likely orphans MANY Mode A cards). For headings, the cardinality is multiplied by section size.

**Unifying fix:** add a `virgil-paragraph-orphaned` (rename to `virgil-textobject-orphaned`?) event dispatched at the end of `cleanupLinksInRange`. The walker collects the set of `uuid`s of nodes about to be deleted; emits the event with that set; the per-doc card hooks listen for it and sweep their own sidecar entries for matching `paragraphId` / `textObjectId` references. Symmetric with the existing `virgil-anchor-orphaned` event that handles Mode B.

**Surgical alternative:** lift each card hook's "find by paragraphId" capability into a shared registry and call them from the walker directly. More tightly coupled; loses the event-bus decoupling.

**Radius:** 3 files — [`delete-range.ts`](../../../Programming/virgil/src/text-objects/delete-range.ts) (emit event), per-doc hooks for todos/quotations/examples/archive (add listener), plus the event-name constants module.

**Open follow-ups resolved:** TEXT-OBJECT-REFACTOR follow-up #11.

---

### C4 — Archive on ad-hoc deps, not through `CardLifecycle` (TEXT-OBJECT-REFACTOR follow-up #9)

**Symptom:** Archive's edge-case handling diverges from Duplicate/Delete on the same kind. Not always user-visible; manifests as subtle inconsistencies (which selection mode it uses, how it cascades panel focus, whether it cleans up attached marks).

**Root cause:** [`drag-handle-actions.ts:354–381`](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) uses `handle.archiveSelection()` + five ad-hoc deps (`archiveContent`, `updateArchiveSnippet`, `addArchiveTextObjectId`, `setSelectedArchiveId`, `pinRecentlyAddedArchive`). The `TODO(card-lifecycle)` comment at lines 355–361 documents the shape mismatch: archive's "create" takes content (not a sourceId), and the path cascades into panel-selection side effects.

**Cells affected:** every Archive cell (16 kinds × 1 = 16 cells), behaviorally subtle. Likely shows up as: cleanup walker doesn't run on Archive (so attached cards stay tied to text that's now in the archive panel); selection state after Archive sits weirdly; orphan sweep doesn't fire.

**Unifying fix:** extend `CardLifecycle` with `create(kind, content): id` (parallel to `clone`/`delete`). Refactor archive to route through `cardLifecycle.create("archive", text)`, then run the same `cleanupLinksInRange` walker that Delete uses (with the source range bounds), so Archive gets symmetric C2/C3 cleanup for free. Panel-selection side effects move to a separate `useArchivePanelFocus` ergonomic hook.

**Surgical alternative:** add the cleanup walker call to the existing ad-hoc archive path. Patches the symptom; leaves the architectural asymmetry.

**Radius:** 3 files — [`drag-handle-actions.ts`](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) (the archive branch), [`card-lifecycle-registry.tsx`](../../../Programming/virgil/src/panels/card-lifecycle-registry.tsx) (add `create` to the interface), [`useArchive.ts`](../../../Programming/virgil/src/hooks/useArchive.ts) (implement `create`).

**Open follow-ups resolved:** TEXT-OBJECT-REFACTOR follow-up #9.

---

### C7 — Sub-object marginalia placement (TEXT-OBJECT-REFACTOR follow-up #1, **likely-resolved per Phase C**)

**Symptom (suspected):** anchored cards on `listItem` or `exampleItem` may have their marginalia markers placed at the parent (bulletList / exampleBlock) position rather than the sub-object's own row.

**Root cause hypothesis:** the dispatcher correctly records `targetKind: TextObjectKind` and `paragraphId: ref.id` (= sub-object uuid). Whether the marginalia placement code reads `targetKind` to position by sub-object vs. parent is the open question — documented as TEXT-OBJECT-REFACTOR follow-up #1 ("the marginalia gutter positioning for non-top-level anchors hasn't been exercised end-to-end").

**Cells affected (potential):** `{listItem, exampleItem} × {H, N, Q, T}` = 8 cells.

**Phase C will:** drop a note (kind=N) on `fa04` (the only-child listItem) and inspect the marginalia marker's position. Similarly for `fa07` (only-child exampleItem). If the marker lands next to the item, C7 is empty. If it lands next to the parent list/example block, C7 is real.

**Unifying fix (provisional, pending Phase C):** the marginalia placement code (in [src/components/Marginalia.tsx](../../../Programming/virgil/src/components/Marginalia.tsx) or its hooks) walks `walkAnchorableBlocks(editor)` looking for `paragraphId` matches. Post-H1, sub-objects ARE in the walker. So the lookup probably finds them. The remaining work is at the layout level — does it use the sub-object's DOM rect via `data-uuid`, or the parent's? Per the H1 commit notes, sub-objects get `data-uuid` decorations now, so the lookup should resolve correctly. The fix radius is small if the gap is just a forgotten `targetKind` switch in a single position computation.

**Open follow-ups resolved:** TEXT-OBJECT-REFACTOR follow-up #1.

---

### C9 — Heading × annotation/insertion uses section range, not heading line (NEW)

**Symptom:** Highlight on a section heading produces a band that spans the entire section's text (every paragraph below the heading). Footnote on a section heading places the marker at the end of the LAST paragraph in the section, not at the end of the heading line. Citation behaves the same as Footnote.

**Root cause:** [`drag-handle-actions.ts:519–522`](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) — `resolveRefRange(heading)` returns `{from: section.start, to: section.end}`, the full section bounds. This is correct for D/A/⌫ (which collect the section per `outerRangeFor`'s heading branch) but wrong for annotation/insertion actions that need a heading-line range.

**Cells affected (3):** `heading × {H, F, C}`. Possibly `heading × E` and `heading × X` would join if their range usage changed — currently both fall into the no-range-anchor branch and dodge the bug.

**Unifying fix:** split the resolve into `resolveRefRangeForAnnotation(ref)` vs. `resolveRefRangeForLifecycle(ref)`. For heading specifically, the annotation variant returns the heading line bounds (the heading node's content range without its descendants); the lifecycle variant returns the section range. Other kinds: both variants return the same thing, so the split is essentially heading-only at first. The dispatcher checks which kind of action it's about to run and picks the right resolver.

**Surgical alternative:** add a `kind === "heading"` branch inside each affected action handler (H, F, C) that overrides the range with heading-line bounds. Hostile — duplicates heading-specific knowledge across handlers; future heading-narrow actions would need their own branch.

**Radius:** 1–2 files — [`drag-handle-actions.ts`](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) (split the resolver and route per action) and possibly [`section-range.ts`](../../../Programming/virgil/src/lib/section-range.ts) (add a `getHeadingLineRange` helper if not already present).

**Open follow-ups resolved:** none (this is a Phase B discovery).

**Possible deeper formulation:** the registry could declare `annotationRange?: (doc, uuid) => Range | null` per-kind in addition to `collectMoveSource`. Then the dispatcher simply asks the registry. Only `heading` would override; all other kinds get a default that returns the node's own bounds. This is the same dual-resolver shape, just declared per-kind in the registry rather than dispatched per-kind in the action handler.

---

### C5 — Heading lifecycle without warning

**Symptom:** clicking Duplicate / Archive / Delete on a section heading fires immediately and operates on the whole section, with no warning surfaced about the wide scope.

**Root cause:** [`drag-handle-actions.ts`](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) does not import [`ConfirmDialog`](../../../Programming/virgil/src/components/ConfirmDialog.tsx) and has no `await confirm(...)` step before the destructive heading actions. The `outerRangeFor(heading)` returns the section bounds correctly, so the wide-scope operation works mechanically — the warning UI is the missing piece.

**Cells affected (3):** `heading × {D, A, ⌫}`. (Cutter excluded per Phase B finding that cutter is an annotation, not a lifecycle action — see §7 question #4.)

**Unifying fix:** the dispatcher consumes a `confirm(options): Promise<boolean>` from `useConfirmDialog()` at hook-mount time. Before each of {duplicate, archive, delete}, check `if (ref.kind === "heading")` and `await confirm({title, message: dynamic-section-summary, tone: "danger", confirmLabel})`. Cancel = early return. Message text uses [`getSectionRangeByUuid`](../../../Programming/virgil/src/lib/section-range.ts) to count contained nodes (paragraphs, sub-headings) for the summary.

**Surgical alternative:** browser `confirm()`. Native, but inconsistent with Virgil's panel chrome and skips the design tone (`danger` styling).

**Radius:** 1 file — [`drag-handle-actions.ts`](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) (add hook usage + three `if (kind === "heading") await confirm()` checks) — though the cleanest shape is one shared helper `confirmIfWideScope(ref, action)` that returns a Promise<boolean>, called by all three branches.

**Open follow-ups resolved:** none new (this is Class D's implementation).

**Generalization:** the "wide scope warning" concept could be a registry field — `meta.requiresWideScopeWarning?: boolean` — true only on heading. The dispatcher reads it and triggers the confirm. Future kinds that grow wide-scope semantics (e.g. exampleBlock if a sub-skill ever introduced "operate on whole block from a sub-item") would just flip the flag.

---

### C6 — Last-child cascade missing on Delete / Archive

**Symptom:** archiving or deleting the only `listItem` in a `bulletList` (or only `exampleItem` in an `exampleBlock`) leaves the empty parent container behind in the document.

**Root cause:** [`delete-range.ts:39–73`](../../../Programming/virgil/src/text-objects/delete-range.ts) — `cleanupLinksInRange` walks the range to clean sidecars, and the dispatcher's own `tr.delete(outer.from, outer.to)` removes the child node. Neither inspects the parent's post-delete content. Archive's path (via `handle.archiveSelection`) is parallel; no cascade either.

**Cells affected (4):** `{listItem (only-child), exampleItem (only-child)} × {A, ⌫}`. Phase C confirms via fixture `fa04` (only-child listItem) and `fa07` (only-child exampleItem).

**Unifying fix:** wrap the Delete / Archive transaction logic in a `withParentCascade(tr, doc, outer)` helper that, after the child is removed, resolves the parent at `outer.from - 1`, checks if its content is now empty (or contains only an empty placeholder), and if so extends the deletion to include the parent node.

**Surgical alternative:** add the check inline in each of Delete and Archive's case branches. Two copies of the same check; the helper avoids drift.

**Radius:** 1–2 files — [`delete-range.ts`](../../../Programming/virgil/src/text-objects/delete-range.ts) (expose the helper or inline it) and [`drag-handle-actions.ts`](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) (the archive branch, until C4 folds archive into the lifecycle registry).

**Open follow-ups resolved:** none new (Class C implementation).

**Generalization:** the cascade is currently container→sub-object, but the same shape applies to "delete the last paragraph in a blockquote" (leaving an empty blockquote) and "delete the last node in any wrapper kind." The helper should query the registry — `meta.removeOnEmptyChildren?: boolean` — true for bulletList / orderedList / exampleBlock / blockquote, false elsewhere.

---

### C11 — Heading × Highlight corrupts LaTeX and strips pre-existing linkedAnchors (NEW, discovered Phase C)

**Symptom:** Clicking Highlight on a section heading produces TWO simultaneous failures:
1. The serializer writes `\vlidend{...}` INSIDE the `\section{...}` braces: e.g. `\section{Test apparatus\vlidend{64ff5583-...}}`. The resulting `.tex` is malformed — the `\section{}` argument is no longer balanced as the typesetter expects.
2. Pre-existing `\vlid{X}…\vlidend{X}` linkedAnchor pairs ELSEWHERE in the document (not within the highlighted range) are **stripped** during the post-action save → reload round-trip. In Phase C testing, both `ab12` (multi-paragraph linkedRange) and `ab34` (single-paragraph linkedRange) — neither under the highlighted heading's section — disappeared after the highlight action committed.

**Root cause hypothesis:** the second issue (data loss) likely follows from the first — the parser, on reading back the malformed `.tex`, fails to correctly track open `\vlid{}` brackets and discards anchors whose open/close pairing is ambiguous. The first issue stems from the dispatcher's section-wide range (`resolveRefRange(heading)` → section bounds) being handed to `createLinkedAnchor`, which then asks the serializer to write `\vlidend` at `range.to` — which coincides with the heading-line's `}` boundary.

**Cells affected:** `heading × H` directly. Side effects collide with **every other linkedAnchor in the document** if the heading happens to be highlighted.

**Severity:** highest single-finding severity. Beyond a UX bug, this is **data loss** — user-authored lifted passages elsewhere in the doc vanish silently the first time anyone highlights a section heading.

**Unifying fix:** the C9 fix (split annotation-range from lifecycle-range, narrow heading annotations to the heading line) **resolves this automatically**. If annotations on a heading only operate on the heading line (not section), then the `\vlid{...}\vlidend{...}` markers stay inside the heading text and never cross the `\section{}` boundary, and the parser's round-trip stays clean.

**Surgical alternative:** in the serializer, detect when a `\vlid` mark spans a `\section{}` boundary and emit close-and-reopen at the boundary (matching the existing multi-paragraph close-and-reopen logic from Phase E). This patches the symptom but doesn't fix the design call (annotations on heading shouldn't be section-wide).

**Radius:** if folded into C9: same 1–2 files (`drag-handle-actions.ts` for range split + possibly `section-range.ts`). Standalone surgical: 1 file (`latex-serializer.ts`) but architecturally weaker.

**Open follow-ups resolved:** confirms the value of fixing C9 — without it, this corruption is a ticking time bomb.

---

### C10 — LinkedRange `paragraphId` wired to anchorId instead of containing paragraph (NEW)

**Symptom (suspected):** Quotation / Todo (and possibly Note / Suggest-edit's Mode A field) created from a `linkedRange` grab handle get their `paragraphId` set to the `linkedAnchor`'s anchorId — not a paragraph uuid. Downstream marginalia placement looks up `paragraphId` in `walkAnchorableBlocks` (which yields paragraph uuids), fails to match, and renders the card with no anchor — either invisibly or at position 0.

**Root cause:** [`drag-handle-actions.ts:167`](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) — `const paragraphId = ref.kind === "selection" ? ref.paragraphId : ref.id;`. For a `linkedRange` ref, `ref.id` is the anchorId. The dispatcher never finds the containing paragraph.

**Cells affected (likely 2–4):** `linkedRange × {Q, T}` confirmed; `linkedRange × {N, E}` partially affected — Mode B cards lean on the mark for primary anchoring, so the `paragraphId` field is silently wrong but not user-visible.

**Phase C will:** drop a Todo on the new fixture's `ab34` (single-paragraph linkedRange) and inspect the resulting `todos.json` entry to confirm `paragraphId` is `ab34` (the anchorId) rather than `fa0a` (the containing paragraph).

**Unifying fix:** in `paragraphId` resolution, when `ref.kind === "linkedRange"`, walk up from the mark's start position to the containing block and use that block's uuid. For non-paragraph containers (a linkedRange inside a listItem, for example), use the immediate `textObject` ancestor — set `targetKind` to match.

**Surgical alternative:** an `if (ref.kind === "linkedRange") { paragraphId = lookupContainingParagraph(ed, ref.id); }` patch inline in the dispatcher. Forward-compatible enough; not architecturally weak.

**Radius:** 1 file — [`drag-handle-actions.ts`](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts) (line 167 + a small helper).

**Open follow-ups resolved:** none new (Phase B discovery).

---

### Cluster ranking summary (updated post-Phase-C)

| Rank | Cluster | Cells | Confidence | Files touched |
|---|---|---|---|---|
| 1 | C1 — Registry curation | ~31 | **Confirmed** | 1 |
| 2 | C9 — Heading annotation scope (NEW) | 3 | **Confirmed** + DATA LOSS via C11 | 1–2 |
| 3 | C11 — Heading×Highlight LaTeX corruption (NEW, Phase C) | 1 cell, doc-wide data loss | **Confirmed** | folds into C9 |
| 4 | C7 — Sub-object marginalia placement | ~8 → likely 0 at data layer | **Likely-resolved** | TBD (gutter render only) |
| 5 | C2 — Cloned-card reverse links | per-attached-state | High | 2 |
| 6 | C3 — Mode A orphan sweep | per-attached-state | High | 3 |
| 7 | C4 — Archive ad-hoc lifecycle | ~16 (subtle) | High | 3 |
| 8 | C6 — Last-child cascade | 4 | **Confirmed** | 1–2 |
| 9 | C5 — Heading warning UI | 3 | **Confirmed** | 1 |
| 10 | C10 — LinkedRange paragraphId wiring (NEW) | 2–4 | High (untestable — fixture polluted) | 1 |

**Recommended order for the solutions session:**

1. **C9 first** — not C1. C11's data-loss severity escalates C9 above the larger-but-cosmetic C1. A user highlighting any section heading risks losing every lifted passage in their document. Land C9's split-resolver fix first; C11 falls out for free.
2. **C1 second** — the largest-cells-affected cluster. Single-file curation in `text-object-registry.ts`.
3. **C5** — pair with C9, lands the heading row in one polished pass. ConfirmDialog already exists.
4. **C6** — single-file fix; landing it gives clean cascade UX for the most common destructive case (deleting the last item in a list).
5. **C2 + C3 + C4** — the lifecycle-symmetry triad. Best done together since their fixes share architectural shape (lifecycle-registry routing + walker hooks).
6. **C10** — independent, small radius.
7. **C7** — re-verify the gutter marker rendering after the fixture is reset; if real, it's likely a separate fix in `Marginalia.tsx`'s rendering logic.

**C8 — refuted.** Phase B confirmed the dispatcher is genuinely generic: zero per-kind switch arms in the main flow ([drag-handle-actions.ts:192–400](../../../Programming/virgil/src/components/editor-layout/card-actions/drag-handle-actions.ts)). The only ref-kind branching is at the range-resolution boundary (`resolveRefRange` / `outerRangeFor`), which correctly delegates to registry metadata + special cases for `selection` / `heading` / `linkedRange` / atom blocks. The post-refactor architecture is sound.

**C7 — likely-resolved.** Phase C ground-truthed `listItem × Note` and the result was the expected behavior: the new note's sidecar entry correctly records `targetKind: "listItem"` and `textObjectIds: ["fa04"]`, and the note's panel card renders at the listItem's vertical position. The gutter marker question separately surfaces as §7 q11 — the DOM shows only ONE `.marginalia-marker` element at any time despite ~12 anchored sidecar cards, suggesting a separate (and pre-existing) marker-rendering issue, not a sub-object anchoring failure. The TEXT-OBJECT-REFACTOR follow-up #1 can be marked resolved.

---

## 7. Open architectural questions surfaced by the diagnosis

Updated by Phase B; Phase C may add to this list.

1. **Should `TextObjectGrabHandle` mount inside float bodies?** Today it doesn't ([Editor.tsx:3336](../../../Programming/virgil/src/components/Editor.tsx) is the only mount site). Lifecycle ops on a popped-out heading or list are accessible only by going back to the main editor. Argument for: cohesion. Argument against: the float is meant to be a focused-editing view, not a structural-edit view. **Recommendation:** defer; revisit if users surface the friction.

2. **Should it mount inside card-panel editors?** (Note body, comment body, suggestion body, etc.) These contain TipTap editors with paragraphs that ARE technically TextObjects. Per user's prior signal: probably not — adding margin-cards-on-margin-card-paragraphs gets recursive. **Recommendation:** confirm: no.

3. **Grey-out implementation: disabled-visible vs. absent-entry.** Current implementation is absent-entry (`MENU_ENTRIES.filter(...)` in `DragHandleMenu.tsx:113`). Visibly disabled entries preserve menu shape across kinds; absent entries vary menu height per kind. **Recommendation:** disabled-visible. Users can see "ah, this doesn't apply here" rather than "wait, where's the Footnote option?". Plumbing change: add a `disabled?: boolean` per `MenuEntry` and let the filter switch from `.filter(...)` to mapping `{...entry, disabled: !allowed.has(entry.action)}`.

4. **"Suggest cut" is not actually a lifecycle action.** Class D's extension (Cutter on heading also wide + warned) was based on misreading "suggest cut" as destructive. In fact `cardCreation.createCutterComment` just creates an annotation card; the text is NOT moved. So Cutter is annotation-style — narrow scope on heading (just attaches a card by id), no warning needed. The §4 grid's `heading × Cutter = ⚠` mark should be **`✓`**, and the §3 Class D entry should drop Cutter from the extension. *Heads-up to user: confirm or correct.*

5. **`titleField × Cutter` similarly resolves.** If Cutter doesn't actually remove content, then `titleField × Cutter` doesn't violate "doc requires a title." It just attaches a card. The §4 Class B entry should flip `Suggest cut = ⊘` to **`✓`**. *Heads-up to user.*

6. **Per-kind insertion targets for greyed-out cells.** Could a future ergonomics pass re-introduce some Class A cells with smarter routing (e.g., figure-into-caption)? **Status:** explicitly rejected for this round; revisit later if real users ask.

7. **Annotation vs. lifecycle range as a registry concept.** C9's fix needs a per-kind "annotation range" distinct from `collectMoveSource` ("lifecycle range"). The cleanest formulation makes both registry-declared: `meta.collectMoveSource` (already exists) for lifecycle; `meta.collectAnnotationRange?` for annotations (default = node bounds, heading overrides to heading-line bounds). The dispatcher routes per-action to the right resolver. **Status:** propose as part of the C9 solution.

8. **`titleField` singleton enforcement.** If C1 doesn't grey out `titleField × Duplicate`, the schema needs to enforce singleton (reject doc state with > 1 titleField) — currently unverified. **Status:** check during C1 implementation.

9. **Atom-block highlight behavior.** `?` cells for `{displayMath, latexComment, texBlock, graphicsBlock, figureBlock} × Highlight` — the dispatcher's `createLinkedAnchor` over a NodeSelection probably no-ops silently (linkedAnchor is an inline mark; atom NodeSelections can't carry it). If true, this is benign — the menu entry fires and nothing happens. But the user expected "highlight bar in the margin next to the block." Either the linkedAnchor mark needs an atom-block variant (a node-level marking?), or Highlight on atom blocks needs a different path (e.g., a sidebar marker keyed to the atom's uuid, no linkedAnchor needed). **Phase C will determine.**

10. **`?` cells for containers × annotations.** `{bulletList, orderedList, exampleBlock} × {H, N, Q, T}` — Phase C didn't ground-truth these (the fixture got polluted before they were reached). Predictions carry forward from Phase B (likely fires, visual outcome uncertain).

11. **Gutter marginalia markers render sparsely.** During Phase C, the DOM had at most ONE `.marginalia-marker` element at a time despite the fixture carrying ~12 anchored sidecar cards (notes, todos, highlights, quotations, etc.). Whether this is by design (lazy/virtualized rendering tied to intersection observer) or a regression is unclear. **Separate question** from the action-menu diagnosis but worth flagging: the gutter is the user's primary affordance for "what's anchored where" — sparse marker rendering would be a UX issue independent of every cluster above.

12. **Collaborator mode gates the grab handle.** On first load, the editor was in collaborator mode (`.ProseMirror[contenteditable=false]`), and the grab handle simply didn't appear on any hover. After toggling collaborator mode off, the handle appeared normally. **Ergonomic question:** if a user reads their own doc in collab mode and tries to use the gutter, the handle silently absents itself. Should the collab toggle button surface a hint? Or should the handle render in collab mode and have certain actions greyed (Duplicate / Delete / Archive can't fire in collab, but Highlight / Note can — they're commentary, not edits)? Out of scope for the action-menu diagnosis but architecturally adjacent.

13. **EditorViewportCache requires a resize event to initialize.** The cache's `containsHoverZone` predicate fell through to the empty-cache stub `() => false` on first paint; only a `window.dispatchEvent(new Event('resize'))` populated the cache and unblocked hover-driven discovery. This is a hook-lifecycle / hydration-order issue — likely the cache effect runs before the editor view's DOM is sized. Real users may not hit this because of natural resize/scroll activity, but it's worth a check.

---

## 8.1 Resolution log (post-solutions session, 2026-05-26)

Solutions session landed all 10 clusters in seven landings. Architecture follows the §6 unifying proposals; the dispatcher and registry now route per *action type* (annotation vs lifecycle) AND per kind, via two parallel registry resolvers (`collectMoveSource` and `collectAnnotationRange`) plus the unified `cardCreation` factory.

**Files touched (final):**

- `src/text-objects/types.ts` — added `collectAnnotationRange` slot and `removeOnEmptyChildren` flag to `TextObjectMeta`.
- `src/text-objects/text-object-registry.ts` — per-kind `actions` curated into `PROSE_ACTIONS` / `NON_PROSE_BLOCK_ACTIONS` / `TITLE_FIELD_ACTIONS` / `LINKED_RANGE_ACTIONS`; `collectAnnotationRange` declared on heading; `removeOnEmptyChildren: true` on bulletList / orderedList / exampleBlock.
- `src/lib/section-range.ts` — new `getHeadingLineRangeByUuid` helper (heading-line bounds for annotation actions).
- `src/components/editor-layout/card-actions/drag-handle-actions.ts` — split `resolveRefRange` to take `forAction: "annotation" | "lifecycle"`; added `confirmHeadingLifecycle` for C5; added `rewireClonedAnchors` post-insert walker for C2; refactored archive branch to use `cardCreation.createArchiveSnippet` + `expandCascadeRange` + `cleanupLinksInRange` + `tr.delete` (C4); dropped five ad-hoc archive deps; fixed `paragraphId` for linkedRange via `paragraphUuidAt` (C10).
- `src/components/DragHandleMenu.tsx` — `MenuEntry.disabled` field; filter→map for visible-disabled rendering; keyboard handler gates on `!hit.disabled`.
- `src/components/ConfirmDialog.tsx` — used as-is (already had `useConfirmDialog`).
- `src/components/EditorPane.tsx` — added second `useConfirmDialog` instance for drag-handle actions; dropped ad-hoc archive deps from `useDragHandleActions` call; added archive deps to `useCardCreation`; wired `bindAnchor` into `cardLifecycleRegistry` for 6 Mode B kinds (note / highlight / comment / suggestion / cutter-comment / cutter-suggestion).
- `src/components/editor-layout/card-actions/card-creation.ts` — new `createArchiveSnippet` peer alongside the other `create*` factories.
- `src/text-objects/delete-range.ts` — new `expandCascadeRange` helper with `INVISIBLE_WRAPPERS` set (`exampleItemList`) and registry-flag consultation.
- `src/text-objects/duplicate-slice.ts` — unchanged (the C2 rewire walker lives in the dispatcher).
- `src/panels/card-lifecycle-registry.tsx` — extended `CardLifecycle` with optional `bindAnchor(id, paragraphId, anchorId, anchorText)`.
- `src/links/links.ts` — exported `paragraphUuidAt` (used by dispatcher's linkedRange paragraphId resolution and the C2 rewire walker).
- `src/hooks/useNotes.ts`, `src/hooks/useRevisions.ts`, `src/hooks/useCutter.ts` — implemented `bindAnchor` (idempotent re-attach of Mode B text-range anchor on cloned cards).
- `src/hooks/useTodos.ts`, `src/hooks/useQuotations.ts`, `src/hooks/useArchive.ts` — added `virgil-textobject-orphaned` listeners that sweep Mode A links when the source uuid vanishes from the doc.
- `src/lib/tiptap/linked-anchor.ts` — new `TextObjectOrphanGuard` PM extension (sibling of `LinkedAnchorGuard`); reads `diff.removedBlocks` from `DocStructureObserver`, dispatches `virgil-textobject-orphaned` events with `{uuid, typeName}` payload.
- `src/lib/tiptap/index.ts` + `src/components/Editor.tsx` — exported and registered `TextObjectOrphanGuard` in the editor extension list (right after `LinkedAnchorGuard`).

**Live verification (this session, 2026-05-26):**

- Highlight on §A "Test apparatus" heading → ONE linkedAnchor span wrapping only the heading text. Serialized as `\section{\vlid{...}Test apparatus\vlidend{...}}` — well-formed; no other linkedAnchors stripped. **C9 + C11 confirmed.**
- Delete on §A "Empty section" heading → confirm dialog appeared with section summary. Cancel returned silently; section still in doc. **C5 confirmed.**
- Delete on §A only-child exampleItem fa07 → parent exampleBlock fa06 also removed; LaTeX source shows the entire `\vexid{fa06}\pex ... \xe` block gone. No placeholder leak. **C6 confirmed.**

**Architectural notes worth keeping:**

- `LIFECYCLE_ACTIONS` (set in `drag-handle-actions.ts`) is the new SSOT for which actions count as lifecycle (D/A/⌫). Annotation actions (H/N/F/C/Q/T/E/X) get the heading-line range; lifecycle actions get the full section. Plan agent confirmed this is the right axis — Cutter is annotation-shaped (just attaches a card), so it stays narrow on heading and visible on titleField.
- `cardCreation` is now the SSOT for "create a sidecar card from the dispatcher"; `CardLifecycle` is the SSOT for "operate on an existing card's lifecycle" (clone, delete, bindAnchor). Plan agent push-back on overloading `CardLifecycle` with `create(payload: unknown)` was the right call — payload types stay symmetric.
- The `TextObjectOrphanGuard` plugin pattern mirrors `LinkedAnchorGuard` exactly — both read `readPendingDiff(newState)` (O(1) typed delta from `DocStructureObserver`), bail when their relevant diff list is empty, dispatch events via `setTimeout(0)`. Mode A hooks listen, Mode B hooks already listened. No per-keystroke doc walks added.

---

## 8. Handoff

**To solutions session** (post-diagnosis):

1. Read this memo end-to-end. Section 5 is the per-cell predictions + grouped failure log; section 6 is the architectural recipe with concrete unifying fixes.
2. **C9 is the highest-priority fix** despite affecting only 3 cells — it carries **C11 as a side effect, which produces silent data loss** (user-authored lifted passages elsewhere in the doc disappear when anyone highlights a section heading). Land C9's split-resolver fix first; C11 resolves automatically.
3. **Then C1** — the largest cluster (~31 cells) and a single-file curation in `text-object-registry.ts`. After C1, half the §5.1 grid resolves automatically (every ⊠ / ⊠! becomes ⊘).
4. **Then C5** — pair with C9 for heading-row coherence in one polished pass. `ConfirmDialog` already exists at `src/components/ConfirmDialog.tsx`.
5. **Then C6** — single-file cascade fix; gives clean UX for the common destructive case (deleting the last item in a list/example).
6. **Then C2 / C3 / C4** — the lifecycle-symmetry triad. Best done together since their fixes share architectural shape (lifecycle-registry routing + walker hooks). C4 (folding Archive into the lifecycle registry) unlocks C3 (orphan sweep on Archive paths) for free.
7. **Then C10** — independent, small radius. Will need fixture restoration first since Phase C polluted the linkedRange marks.
8. **Re-verify C7** after the fixture is reset. The gutter marker rendering question (§7 q11) is separately worth checking; not part of C7's data layer.

**Before re-running Phase C** (whether to verify fixes or to ground-truth the untested cells):

- Restore `virgil-data/doc_devtest/document.tex` to its post-Phase-A state (re-apply the §A fixture template). Phase C polluted the fixture — the original ab12 / ab34 linkedRange markers were stripped, fa04 listItem was deleted (with a residual empty replacement), and several `\vlid{64ff5583-...}` highlight spans were left in. The fixture additions (`\section{Test apparatus}` block, fa01–fa0a, etc.) should be preserved.
- Restore `virgil-data/doc_devtest/virgil/notes.json`, `todos.json`, and possibly `footnotes.json` to remove the spot-check cards.
- These are all gitignored (`/virgil-data` is in `.gitignore`), so `git restore` won't help. The cleanest reset is to copy `samples/annotation-history/` over `virgil-data/doc_devtest/` and then re-apply the §A fixture additions.

**To TEXT-OBJECT-REFACTOR.md** (post-solutions):

- Mark open follow-ups #1 (sub-object marginalia → resolved via diagnosis; C7 likely-resolved at data layer), #9 (Archive ad-hoc → C4), #10 (cloned-card reverse links → C2), #11 (Mode A orphan sweep → C3) — bump to "resolved in session N" once their fixes land.
- Add a session entry describing the action-menu work + the registry-curation pattern (C1 → `actions` field becomes a real per-kind concept) + the annotation/lifecycle-range split (C9's `annotationRange` / `collectMoveSource` parallel registry slot).
- Note the architectural shape change: post-fixes, the dispatcher routes per action TYPE (annotation vs. lifecycle vs. inline-insertion) AND per kind, via two parallel registry resolvers. This is a clean evolution of the post-refactor abstraction.

**Heads-up to user (pending confirmation):**

- §7 q4: Cutter is annotation-shaped, not lifecycle-shaped. `heading × Cutter = ✓ narrow` (not ⚠ wide+warned). The §4 grid's heading row needs correction.
- §7 q5: Cutter on titleField could be allowed (just adds an annotation card; doesn't remove the title). The §4 Class B table needs correction.
- §7 q3: Recommended grey-out implementation is **disabled-visible** (not absent — current implementation is absent).
- §7 q11: Gutter marginalia markers may be rendering sparsely (only 1 in DOM at any time). Separate from this diagnosis but architecturally adjacent — flag for a focused review.
- §7 q12: Collaborator mode silently disables the grab handle. Worth a separate ergonomic pass.
- §7 q13: EditorViewportCache may have a hydration-order issue requiring a resize event to populate. Real users may not hit this; flag for a check.

These corrections affect the §4 grid's expected behavior for a handful of cells; the §6 cluster sizes don't change materially.

**Diagnosis session deliverable status: complete.**
