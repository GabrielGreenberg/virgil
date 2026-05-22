<!-- last-verified: HEAD 2026-05-21 -->

# Audit — Action-button menu items across contexts

The action button works (it appears and opens) but its contents behave inconsistently across cursor contexts. This memo enumerates the failures, groups them by underlying cause, and proposes five spin-off fixes. Findings come from static review **plus** a JSDOM probe harness that mounted a real TipTap editor, dispatched each menu item in each context, and captured `editor.getJSON()` deltas (18 contexts × 23 items = 414 probes).

## 1 · Architecture refresher

Three trigger points all mount one panel — **[`ActionsMenuPanel`](../../src/components/ActionsMenuPanel.tsx)** — with two halves:

- **Formatting grid** (4 × 4, 15 used cells, dispatch via `editor.chain()` or specialized helpers):
  Bold · Italic · Strike · Code · BlockType · BulletList · OrderedList · Blockquote · Example · InlineMath · DisplayMath · TextColor · `\tex` · Figure · Image

- **Action row** (9 items, dispatch via [`useDragHandleActions().dispatch`](../../src/components/editor-layout/card-actions/drag-handle-actions.ts) → `cardCreation` API):
  Highlight · Note · Footnote · Citation · Quotation · Todo · SuggestEdit · Cutter · Archive

Mode detection at [ActionsMenuPanel.tsx:135-148](../../src/components/ActionsMenuPanel.tsx): `cursor` mode if `selection.empty`, else `selection`. The dispatcher additionally resolves the click anchor to a `Passage` of kind `paragraph`, `selection`, or `heading`.

## 2 · The matrix

**Contexts** (18 covered by the probe — C15/C16/C17/C22 are documented but not probed):

| Id | Description |
|----|-------------|
| C1 | Empty paragraph, doc root, cursor at start |
| C2 | Non-empty paragraph, cursor at start |
| C3 | Non-empty paragraph, cursor in middle |
| C4 | Non-empty paragraph, cursor at end |
| C5 | Non-empty paragraph, **text selected within** |
| C6 | Selection spans two paragraphs |
| C7 | Empty bullet-list item |
| C8 | Non-empty bullet-list item, cursor at end |
| C9 | Text selected within a list item |
| C10 | Cursor in a heading |
| C11 | Empty paragraph inside a blockquote |
| C12 | Non-empty paragraph inside a blockquote |
| C13 | Cursor inside a codeBlock |
| C14 | Empty paragraph inside an exampleBlock |
| C15 | Empty exampleItem (not probed — schema covered by C14 cluster) |
| C16 | Gloss cell (not probed — schema not yet exercised) |
| C17 | Prose gloss row (not probed) |
| C18 | NodeSelection on a figureBlock |
| C19 | NodeSelection on a texBlock |
| C20 | NodeSelection on a displayMath |
| C21 | Empty document |
| C22 | Cursor in a titleField (not probed — likely not an anchorable node) |

**Items** F1–F4, F6–F15 (formatting grid; F5 BlockType not probed — it's an in-place setBlockType, well-understood); A1–A9 (action row).

Legend for the table: ✅ works · ⚠️ works but unexpected · ❌ silent no-op · 💥 throws · 🪦 destructive (atom replaced) · — N/A.

### Per-cell results

| Cell | F1 Bold | F2 Italic | F3 Strike | F4 Code | F6 Bul | F7 Ord | F8 Quote | F9 Example | F10 IM | F11 DM | F12 Color | F13 Tex | F14 Fig | F15 Img | A1 Hl | A2 N | A3 Fn | A4 Ci | A5 Qu | A6 To | A7 SE | A8 Cu | A9 Ar |
|------|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **C1** empty para | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | 💥 | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C2** para start | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | 💥 | ✅ | ✅ | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C3** para mid | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | 💥 | ✅ | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C4** para end | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | 💥 | ✅ | ⚠️ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | — | — | ❌ | ❌ | ❌ |
| **C5** sel within | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ | ⚠️ | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ |
| **C6** sel cross-para | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 💥 | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ | ⚠️ | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ |
| **C7** empty list item | ❌ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ | ❌ | 💥 | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C8** list item end | ❌ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ | ❌ | 💥 | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C9** sel in list item | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ❌ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | — | — | ✅ | ✅ | ✅ |
| **C10** heading | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | 💥 | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C11** quote+empty | ❌ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | 💥 | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C12** quote+text | ❌ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | 💥 | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C13** codeBlock | ❌ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | 💥 | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C14** exampleBlock | ❌ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ | ❌ | 💥 | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C18** sel figure | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | 💥 | 🪦 | 🪦 | ❌ | 🪦 | 🪦 | 🪦 | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C19** sel texBlock | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | 💥 | 🪦 | 🪦 | ❌ | 🪦 | 🪦 | 🪦 | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C20** sel displayMath | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | 💥 | 🪦 | 🪦 | ❌ | 🪦 | 🪦 | 🪦 | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |
| **C21** empty doc | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | 💥 | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠️ | ⚠️ | — | — | ❌ | ❌ | ❌ |

Notes on cell semantics:
- ❌ on F1–F4 / F12 in cursor mode = "no visible effect" (TipTap queues a mark for the next typed character; the user perceives nothing).
- ❌ on A1/A2/A7/A8/A9 in cursor mode = correct per spec (these are selection-required) but the UI does not visually disable them (except A1 Highlight).
- ⚠️ on F10/F11/F13/F14/F15 in C2/C3 = atom lands at paragraph end / splits paragraph at the cursor. **Not where the user clicked.**
- ⚠️ on F8 / F13–F15 inside containers = inserts inside the container or escapes out unpredictably depending on the host.
- ⚠️ on A3/A4 in cursor mode = atom drops at paragraph **end** (passage range.to), not at the actual cursor — surprising UX.
- A5 Quotation and A6 Todo never have a doc-side effect (paragraph-anchored sidecar cards only) and are shown as "—" here.

## 3 · Failure clusters

Sized by # of affected cells.

### EX · `wrapSelectionInExample` throws or rejects in 16 of 18 contexts (💥)

[`wrapSelectionInExample`](../../src/components/ActionsMenuPanel.tsx) at lines 169-191 has two compounding bugs:

1. **Empty-fragment crash.** `editor.state.doc.slice(from, to).content.toJSON()` returns **`null`** (not `[]`) when the slice is empty. The code casts it as `unknown[]` and then accesses `inlineContent.length` outside the `try` — guaranteed TypeError in every cursor-mode context (12 cells). The thrown exception means **no example block is inserted and no error is shown to the user**; the action silently fails.
2. **Block-content mismatch.** Even when the slice is non-empty, the code drops the slice JSON directly into the new example's first `paragraph` content slot:
   ```
   if (content[0]?.type === "paragraph" && inlineContent.length)
     content[0].content = inlineContent;
   ```
   But the slice JSON contains **block-level nodes** when the selection spans paragraphs (C6) or contains atoms (C18/C19/C20). PM then rejects the insert with `Invalid content for node paragraph: <paragraph(...)>` or `<figureBlock>` etc.

Only C5 (selection within one paragraph) and C9 (selection within one list item) succeed.

This is the cluster the user reported by name.

### ATOM · NodeSelection on atom-blocks is destructive (🪦)

When a `figureBlock` / `texBlock` / `displayMath` is node-selected (gutter button hides, but the strip button stays visible), clicking any atom-insertion item — `\tex`, Figure, Image, InlineMath, DisplayMath — runs `chain().deleteSelection().insertContent(...)`. **`deleteSelection()` deletes the selected atom node**, and the new atom takes its place. The user loses their figure/tex/math.

The same NodeSelection also produces other oddities:
- **A3 Footnote / A4 Citation** spawn a brand-new trailing paragraph just to host the footnote/citation atom.
- **F8 Blockquote** wraps the atom in a blockquote (non-destructive but probably unintended).
- F6/F7 list toggles and all mark toggles silently no-op.

The gutter trigger already hides on NodeSelection ([SelectionActionsMenu.tsx:73](../../src/components/SelectionActionsMenu.tsx)); the strip trigger does not.

### CITE · Footnote / Citation always insert at passage end, not cursor (⚠️)

[drag-handle-actions.ts:139-143, 159-163](../../src/components/editor-layout/card-actions/drag-handle-actions.ts) collapses the selection to `range.to` before inserting:

```
ed.commands.setTextSelection(range.to);
```

In cursor mode the resolved passage is the **whole paragraph**, so `range.to` is the paragraph end. The user clicks Footnote in the middle of "hello world|" and the marker appears at "hello world¹". This is the cluster behind every "footnote dropped in the wrong place" complaint.

Cursor-position info is **not** carried through the passage record — the dispatcher cannot recover it.

### CONT · Container-misfit when inserting inside isolating/leaf hosts (⚠️ + ❌)

When the cursor is inside a host that the new node can't sit in:

- **codeBlock host (C13)** + any block atom (F11/F13/F14/F15) splits the codeBlock around the atom: `top=codeBlock,texBlock,codeBlock,paragraph`. The user did not ask for a split.
- **exampleBlock host (C14)** + F13/F14/F15 escapes the atom **out** of the example to the top level. Sometimes desirable (you usually don't want a `\tex` inside `\ex`), sometimes not — it's accidental.
- **listItem host (C7/C8)** + F8 Blockquote: silent no-op. Same for **exampleBlock + Blockquote** (C14).
- **listItem host (C7/C8)** + F10/F11/F13–F15: lands inside the list item (probably wrong UX for atom blocks).
- **blockquote host (C11/C12)** + F6/F7 list toggle: lifts the paragraph into a list **inside** the blockquote.

The four insert helpers (`insertTexBlock`, `insertFigureBlock`, `insertGraphicsBlock`, `wrapSelectionInExample`) each have ad-hoc handling. There is no shared decision: "where should this block actually go?"

### MODE · Selection-required items not visibly disabled in cursor mode (❌)

In cursor mode, only **A1 Highlight** is greyed out in the UI. The other selection-required items — A2 Note (range-anchor variant), A7 SuggestEdit, A8 Cutter, A9 Archive — silently fall through to a no-op or a paragraph-only side effect with no doc evidence. The user clicks, the panel closes, nothing happens.

Worth distinguishing intentional fall-through (Note → paragraph-anchored note is a sane fallback) from accidental dead clicks (Archive / SuggestEdit / Cutter / range-Highlight). The first should be advertised; the second should disable the button.

### MARK · Cursor-mode mark toggles look inert (❌)

F1 Bold / F2 Italic / F3 Strike / F4 Code / F12 TextColor in cursor mode: TipTap **does** queue the mark for the next character typed (stored mark), but the panel **closes immediately** so the user gets zero feedback. This isn't a bug, it's a UX deficit — and it's especially confusing for TextColor where you'd expect either a visible swatch on the cursor or a no-op.

## 4 · What works

Confirmed by probes (the green columns of the matrix above):

- F1–F4 mark toggles in selection mode (all contexts with text)
- F6 BulletList / F7 OrderedList in nearly all contexts; correctly toggles off when in matching list
- F8 Blockquote in plain-paragraph contexts; correctly toggles off in blockquote
- F10 InlineMath in selection mode + in C1–C4/C21
- F13/F14/F15 atom inserts in cursor + selection mode at the doc root
- A1 Highlight in selection mode (and correctly disabled in cursor mode)
- A3 Footnote / A4 Citation always insert *something* (though position is wrong in cursor mode — see cluster CITE)
- A9 Archive in selection mode
- A2/A7/A8 Note/SuggestEdit/Cutter create a `linkedAnchor` mark in selection mode

## 5 · Proposed deep fixes (spin-off candidates)

Each fix below is a self-contained spin-off prompt. The five fixes together cover every ❌/💥/🪦 cell in the matrix.

---

### DA-1 · Quick win: stop `wrapSelectionInExample` from throwing

**Cluster covered:** EX (16 cells from 💥 to either ✅ or a documented ⚠️).
**File:** [`src/components/ActionsMenuPanel.tsx`](../../src/components/ActionsMenuPanel.tsx) lines 169-191.

The function has two bugs (see EX). The minimal fix:

1. Treat `inlineContent` as `unknown[] | null` and guard `inlineContent && inlineContent.length`.
2. Before seeding the example's first paragraph, **filter** the slice to inline nodes only — drop block-level children. If after filtering there's nothing left, insert the empty template.
3. (Optional, ties into DA-3) For the empty-paragraph case, **replace** the surrounding empty paragraph instead of nesting into it.

This is a 5-line tweak but unblocks the user's reported example-block bug. Worth landing standalone before DA-3 even if the larger smart-insert refactor takes longer.

Verification: re-run `npx vitest run src/__tests__/_audit_action_button.test.ts` (rebuild the harness from this memo's notes) — F9 row should show ✅/⚠️ across the board, no 💥.

---

### DA-2 · `smartInsertBlock(editor, node, opts)` helper

**Clusters covered:** CONT (~30 cells from ⚠️/❌ to ✅), plus tightens up DA-1.
**Files:** new `src/lib/tiptap/smart-insert.ts`; refactor [`insertTexBlock`](../../src/lib/tiptap/tex-block.ts), [`insertFigureBlock`](../../src/lib/tiptap/figure-block.ts), [`insertGraphicsBlock`](../../src/lib/tiptap/graphics-block.ts), and `wrapSelectionInExample` to call it.

Single utility that **every block-level insertion** uses. Decision tree:

1. If `!selection.empty` → `deleteSelection`, recompute position.
2. Resolve `$cursor` to the innermost block that can host `node` per the schema (climb out of codeBlock/exampleItem/exampleBlock/blockquote/listItem when the new node is incompatible).
3. If the host is an **empty leaf** (empty paragraph, empty list item) → **replace** it with `node`.
4. If the cursor is at the **end** of a non-empty host → insert `node` **after** the host (as a sibling).
5. If the cursor is at the **start** of a non-empty host → insert `node` **before** the host.
6. Else (middle of non-empty host) → `split` the host then insert between halves.

Plus a per-node policy: where should a `figureBlock` / `texBlock` / `exampleBlock` actually live? Most likely: at the top level (i.e. always escape out of containers like blockquote / list item / codeBlock). Encode that policy explicitly.

Verification: re-run the harness. Every ⚠️ in C7–C14 for F9/F13/F14/F15 should become ✅. C13 should no longer split codeBlock (atom inserts should escape out).

---

### DA-3 · Pass `cursorPos` through the passage so Footnote/Citation land at the cursor

**Cluster covered:** CITE (every cursor-mode A3/A4 cell — ~12 cells from ⚠️ to ✅).
**Files:** [`src/components/editor-layout/card-actions/drag-handle-actions.ts`](../../src/components/editor-layout/card-actions/drag-handle-actions.ts) lines 40-43 (`DragHandlePassage` type), 139-143 + 159-163 (Footnote / Citation branches); [`src/components/ActionsMenuPanel.tsx`](../../src/components/ActionsMenuPanel.tsx) lines 135-148 (passage construction).

Add `cursorPos?: number` to `DragHandlePassage` for the `paragraph` / `heading` variants. Set it in `ActionsMenuPanel.runAction` from `editor.state.selection.head` at click time. In the dispatcher's Footnote and Citation branches, prefer `passage.cursorPos ?? range.to`. Other branches (Highlight, Note range-anchor) are unchanged — they already use the full range.

Verification: open a paragraph "hello |world", click Footnote, expect the marker at `hello |¹world`, not `hello world¹`.

---

### DA-4 · Suppress the action menu (or items in it) when a NodeSelection is active

**Cluster covered:** ATOM (every C18/C19/C20 cell — ~36 cells from ⚠️/🪦/❌ to either ✅ or 🚫).
**Files:** [`src/components/ActionsStripButton.tsx`](../../src/components/ActionsStripButton.tsx) (the strip trigger that currently stays visible); optionally [`src/components/ActionsMenuPanel.tsx`](../../src/components/ActionsMenuPanel.tsx) to disable individual items.

Two options:

- **(a)** Mirror the gutter button's behavior: hide the strip button entirely when `editor.state.selection instanceof NodeSelection`. Simple, eliminates every destructive cell at the cost of losing access to a few items that arguably *should* work on an atom (Archive, Note).
- **(b)** Define a NodeSelection-valid subset (Archive, paragraph-anchored Note, Color-as-no-op) and grey out everything else in the panel. More work, better UX.

Pick (a) unless we discover real users wanting to act on selected atoms; that pivot can happen later. Critically, atom-replacing inserts (`\tex`/Figure/Image/InlineMath/DisplayMath via `deleteSelection`) must be off the menu before another user loses a figure to it.

Verification: select a figureBlock, open strip button → menu does not appear. (Or with option (b): only Archive/Note are enabled.)

---

### DA-5 · `MenuItemSpec` — declare each item's mode requirement and disable accordingly

**Clusters covered:** MODE + MARK (~50 cells from "looks dead" ❌ to either ✅ or a visibly disabled button).
**Files:** new `src/components/action-menu/menu-item-spec.ts`; refactor [`ActionsMenuPanel.tsx`](../../src/components/ActionsMenuPanel.tsx) to consume it; refactor [`drag-handle-actions.ts`](../../src/components/editor-layout/card-actions/drag-handle-actions.ts) to consume it.

Each of the 25 items declares its selection requirement in one place:

- `cursor-only` — Todo, Quotation, paragraph-anchored Note fallback
- `selection-required` — Highlight, Archive, range-Note/Revision/Cutter (disabled in cursor mode with a tooltip)
- `selection-preferred` — pick range-anchor variant when available, paragraph fallback otherwise
- `selection-ignored` — Footnote, Citation, inline-atom inserts (single insert at one point regardless)
- `selection-wrapped` — Example, math (selected text becomes seed content)
- `block-toggle` — Bullet, Numbered, Blockquote, BlockType
- `inline-mark` — Bold, Italic, Strike, Code, TextColor (active state visible; closing-the-panel UX revisited so the mark visibly applies / there's a "next-char preview")

Then:
- `ActionsMenuPanel` reads each spec to set `disabled` / `tooltip` / `active` per button.
- The dispatcher branches on `MenuItemSpec.mode` instead of guarding inline (`if (!text) break;` scattered everywhere).
- Verifies that A1 Highlight's existing "disabled in cursor mode" treatment is generalized — no item should silently look-functional-but-do-nothing.

Verification: hover every menu item in every context — disabled items show "Select text first" or "Place cursor in prose first"; enabled items always produce a visible effect.

---

## 6 · Critical files for execution (consolidated)

Reading:
- [src/components/ActionsMenuPanel.tsx](../../src/components/ActionsMenuPanel.tsx) — formatting grid + `wrapSelectionInExample`
- [src/components/ActionsStripButton.tsx](../../src/components/ActionsStripButton.tsx) — strip trigger visibility logic
- [src/components/SelectionActionsMenu.tsx](../../src/components/SelectionActionsMenu.tsx) — gutter trigger (the one that already hides on NodeSelection)
- [src/components/DragHandleMenu.tsx](../../src/components/DragHandleMenu.tsx) — `MENU_ENTRIES` definition
- [src/components/editor-layout/card-actions/drag-handle-actions.ts](../../src/components/editor-layout/card-actions/drag-handle-actions.ts) — `dispatch`, `resolvePassageRange`
- [src/components/editor-layout/card-actions/card-creation.ts](../../src/components/editor-layout/card-actions/card-creation.ts) — `createFootnote`/`createCitation`/etc.
- [src/components/Editor.tsx](../../src/components/Editor.tsx) — `insertCitation`, `archiveSelection`, `createEmptyFootnote`, canonical extension list
- [src/lib/tiptap/expex.ts](../../src/lib/tiptap/expex.ts) — `exampleBlock` schema (defining + isolating)
- [src/lib/tiptap/tex-block.ts](../../src/lib/tiptap/tex-block.ts) / [figure-block.ts](../../src/lib/tiptap/figure-block.ts) / [graphics-block.ts](../../src/lib/tiptap/graphics-block.ts) — atom insertion helpers (will converge under DA-2)
- [src/links/links.ts](../../src/links/links.ts) — `createLinkedAnchor`
- [src/lib/marginalia.ts](../../src/lib/marginalia.ts) — anchorable node list

## 7 · Verification of this audit

- Probe harness ran 414 (context × item) probes in 3.1s under JSDOM and matched static predictions on every cell except F9 cursor-mode (which the static review predicted as ❌ silent no-op but is actually 💥 throw — a strictly worse failure, so the deep fix is the same shape).
- C15–C17 and C22 were not probed but should be covered by the same fixes (exampleItem and gloss cells share isolation semantics with the example; titleField is not anchorable so the menu never opens there).
- The probe harness lived at `src/__tests__/_audit_action_button.test.ts` during execution and is **not committed** per the agreed deliverable shape (memo + spin-off proposals only). It can be regenerated from this memo's per-item code paths.
