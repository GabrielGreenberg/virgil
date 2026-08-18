# %comment (latexComment) chrome audit — 2026-06-30

Bug-catcher session. Four items reported on the `%comment` chrome. Research
only — **no code edited**. For the bug-cleaning session. HEAD at diagnosis:
`a69ea9e5` (main, clean).

> **CENTRAL DESIGN PRINCIPLE**: prefer the DEEP UNIFIED fix that captures the
> bug class. These four items are **one root cause with four surfaced edges** —
> the deep fix dissolves all four; the surgical fixes are four separate patches
> each re-coupling the broken seam.

## Running list — comment-chrome audit (4 / 4 diagnosed)

- (a) no selected/unselected distinction — **DIAGNOSED** (dissolves under deep fix)
- (b) type `%` → cursor inside on next key — **ROOT-CAUSE-FOUND** (auto-focus race)
- (c) Enter inside comment → pop out + new paragraph (LaTeX-like) — **ROOT-CAUSE-FOUND**
- (d) lightning bolt absent when caret in comment — **ROOT-CAUSE-FOUND**
- Cluster — **ROOT-CAUSE-CONFIRMED**; deep fix **FEASIBLE** (contained, math untouched)

---

## The single root cause

`latexComment` is a ProseMirror **`atom: true`** node ([latex-comment.ts:28-45](src/lib/tiptap/latex-comment.ts#L28)) whose text lives in **`node.attrs.text`**, not in editable PM content. Its editing happens in a **parallel DOM `contentEditable` channel** created by the shared `editableAtomView()` helper ([editable-atom-view.ts](src/lib/tiptap/editable-atom-view.ts)):

- The text span is born `contentEditable="false"` ([:84](src/lib/tiptap/editable-atom-view.ts#L84)); editing is a DOM-only mode entered on click or via an auto-focus hack ([:98-128](src/lib/tiptap/editable-atom-view.ts#L98)).
- While editing, **all key/input/selection events are deliberately `stopPropagation`'d away from ProseMirror** ([:154-175](src/lib/tiptap/editable-atom-view.ts#L154)).
- `commit()` writes the span's text back into `attrs.text` via `setNodeMarkup` on blur ([:136-150](src/lib/tiptap/editable-atom-view.ts#L136)).

**Consequence: ProseMirror NEVER represents "caret inside a comment" as a TextSelection.** The only PM-visible states are (1) a `NodeSelection` resting on the atom, or (2) an unrelated selection elsewhere. Every one of the four reported symptoms is a direct edge of that one fact. This is the "solve the cluster, surface the deep fork" shape.

---

## Per-item diagnosis

### (a) selected/unselected distinction — `DIAGNOSED`
`selectNode()` adds the `.selected` class on the main surface ([editable-atom-view.ts:182](src/lib/tiptap/editable-atom-view.ts#L182)); the CSS at [globals.css ~3175-3179](src/app/globals.css#L3175) paints a 2px outline (`--heading-annotation-border`, #a8c4de) + darker bg (#e0ecf5 vs #f0f5fa). The distinction exists **only because the atom is selected as a whole node** (NodeSelection) rather than holding a caret. A content-bearing node with a real caret has no whole-node selection at rest, so the chrome simply never paints during editing.
- **Caveat:** the `.selected` chrome is currently the *only* signal that the atom is the keyboard-nav target. Removing it (surgical path) leaves a blind spot during arrow-key navigation. Under the deep fix this is moot.

### (b) type `%`, cursor inside on next key — `ROOT-CAUSE-FOUND`
The input rule creates the atom and sets a **module-global** `_pendingAutoFocusComment` flag ([latex-comment.ts:8, 109](src/lib/tiptap/latex-comment.ts#L8)); the NodeView then polls with `setTimeout(30ms)×5` retrying `enterEditMode()` ([:192-203](src/lib/tiptap/latex-comment.ts#L192)). Because there is **no PM caret** inside the comment, focus is faked — and the first keystroke after `%` arrives **before** the DOM `contentEditable` is focused (and while it's still `contentEditable=false`), so it is dropped/misrouted. (The module-global flag is also shared across all comment NodeViews — a latent multi-comment race.)

### (c) Enter → pop out + new paragraph (LaTeX-like) — `ROOT-CAUSE-FOUND`
The Enter handler ([editable-atom-view.ts:162-165](src/lib/tiptap/editable-atom-view.ts#L162)) only does `preventDefault()` + `textSpan.blur()`. Blur→`commit()` writes the attr but **inserts no paragraph and places no selection**. PM was never told the user is "in" the comment, so it can't run the LaTeX-like exit-to-new-line. The idiomatic PM pattern to copy is in **[expex.ts:1275-1289](src/lib/tiptap/expex.ts#L1275)** (insert a paragraph at `pos + node.nodeSize`, `TextSelection.create` there, dispatch + focus).

### (d) lightning bolt absent in comment — `ROOT-CAUSE-FOUND`
`computePlacement()` bails on its **first line**: `if (sel instanceof NodeSelection) return INVISIBLE_PLACEMENT` ([SelectionActionsMenu.tsx:88](src/components/SelectionActionsMenu.tsx#L88)). While the user types in the parallel `contentEditable`, `editor.state.selection` is the **stale NodeSelection** on the atom, so the bolt stays hidden. There is no alternative DOM-focus signal it gates on. (The `Cmd+/` shortcut has the same NodeSelection guard at ~[:355](src/components/SelectionActionsMenu.tsx#L355).)

---

## The deep unified fix (recommended)

**Remodel `latexComment` from an `atom` (text-in-attr + parallel contentEditable) into a real editable BLOCK node with inline content and a non-editable `% ` widget prefix**, retiring `editableAtomView` for comments. Once the comment text is genuine PM inline content, PM's native selection/command/menu machinery sees the caret and **all four symptoms dissolve natively**.

Migration outline:
1. **Schema** ([latex-comment.ts:28-45](src/lib/tiptap/latex-comment.ts#L28)): drop `atom: true` + the `text` attr; set `content: "inline*"`, keep `uuid`. **Keep it BLOCK-level** (`group: "block textObject"`) to preserve text-object/float identity (see blast radius).
2. **Prefix:** render `% ` as a non-editable NodeView **widget** (contentEditable=false span before the contentDOM) so the caret can't cross into it.
3. **NodeView:** a plain NodeView exposing `contentDOM` + the prefix. No editing-mode flag, no `stopPropagation`, no blur-commit.
4. **Input rule** ([:91-159](src/lib/tiptap/latex-comment.ts#L91)): on `% `, create the node empty and let PM place the TextSelection inside natively. **Retire `_pendingAutoFocusComment` + the setTimeout loop** → fixes (b).
5. **Enter keymap** (`addKeyboardShortcuts`): when the selection is inside a latexComment, insert a paragraph after the node + place TextSelection there (the expex.ts:1275-1289 pattern) → fixes (c).
6. **Serializer + projections** — rewrite each `attrs.text` read to `node.textContent`. The readers (verified): [latex-serializer.ts](src/lib/latex-serializer.ts) ~:420 & ~:1000; [footnote-content.ts](src/lib/footnote-content.ts) :390-391 & :740-742; [useWordCount.ts](src/hooks/useWordCount.ts) :156-159 & :234-237; [inline-content.ts:55](src/lib/inline-content.ts#L55) (`ATOM_TEXT['latexComment']` → content-flatten; [OutlinePanel.tsx:600-603](src/panels/Outline/OutlinePanel.tsx#L600) fixed for free via `atomTextOf`); [latex-comment.ts:177](src/lib/tiptap/latex-comment.ts#L177) (cardContext static view).
7. **Parser** ([latex-parser.ts](src/lib/latex-parser.ts) ~:1745 + the Editor.tsx construction site): emit `{ type:'latexComment', attrs:{uuid}, content:[{type:'text',text:commentText}] }` instead of `attrs.text`.
8. **(a)/(d) fall out:** no whole-node selection at rest → `.selected` never paints during editing (CSS becomes dead, trim or leave harmless); caret is a TextSelection → the bolt's NodeSelection bail no longer triggers. **No bolt change required.** Revisit the Delete/Backspace shortcuts ([latex-comment.ts:62-80](src/lib/tiptap/latex-comment.ts#L62)) that key on NodeSelection (backspace at start of empty comment should lift the node).

### Blast radius — VERIFIED, contained
- **Math is UNTOUCHED.** `editableAtomView`'s **only** consumer is `latexComment`. `math.ts` uses its own `mathNodeView` + KaTeX and does **not** import `editableAtomView` — the "shared with the math nodes / mirroring math.ts" comments in [latex-comment.ts:16-21](src/lib/tiptap/latex-comment.ts#L16) are **aspirational/stale**, describing a parallel pattern, not a shared function. `editableAtomView` can be **deleted** with the remodel.
- **Serializer/projection readers:** 6-7 sites (above), all isolated 1:1 `attrs.text → textContent` swaps; none mutate structure. Must move in the **same commit** or round-trip breaks.
- **text-object/float machinery** (the real cost surface *only if* demoted to inline): [text-object-registry.ts:532-544](src/text-objects/text-object-registry.ts#L532), [single-block-body.tsx](src/text-objects/floats/single-block-body.tsx), `MEANINGFUL_BLOCK_ATOM_NODE_NAMES` ([drag-handle-actions.ts:872-877](src/components/editor-layout/card-actions/drag-handle-actions.ts#L872)), and `isAtomBlock===true` in registry.test.ts. **Keeping block-level preserves all of this** — only the `isAtomBlock` assumption needs review (a content block ≠ an atom block). Demoting to **inline** would void comment popouts/grab-lift and is a *design shift, not a bug fix* — don't do it unless the user asks for comments-as-inline-annotations.

### Must stay
- **Math** (inline + display) keeps its atom + click-edit model and `.selected` float-surface suppression. Do not remodel math in this pass.
- `cardContext` static-render path ([latex-comment.ts:169-179](src/lib/tiptap/latex-comment.ts#L169)) stays — just reads `textContent`.

---

## Surgical fallbacks (if the remodel is deferred — 4 model-fighting patches)

- **(a)** CSS-scope `.latex-comment.selected` to drop the outline/bg (keeps math chrome), or thread a `suppressSelection` flag into `editableAtomView` guarding the `selectNode` class-add. *(Loses keyboard-nav feedback.)*
- **(b)** Remove the module-global flag + setTimeout retry; drive focus from a reliable post-mount/post-transaction signal before the next keystroke. *(Still no PM caret to receive the key.)*
- **(c)** Rewrite the Enter handler to a PM transaction: `commit()` → insert paragraph at `getPos()+node.nodeSize` → `TextSelection.create` → dispatch + `view.focus()` (expex pattern). Needs editor/getPos/node in scope. *(Re-introduces PM coordination from inside the parallel channel.)*
- **(d)** In `computePlacement()` before the NodeSelection bail, detect an active edit (`editor.view.dom.querySelector('[contenteditable="true"]')`) and compute placement from the node's DOM rect; relax the `Cmd+/` guard symmetrically. *(Brittle: placement now derives from a NodeSelection rect, not `coordsAtPos`.)*

These reduce symptoms but each adds a special-case re-coupling the parallel DOM channel back to PM, accruing debt around the exact seam the deep fix dissolves.

---

## Recommendation & live-verify

**Do the DEEP FIX** — it matches the central design principle, is rated FEASIBLE with a mapped/contained blast radius, and leaves math untouched. Sequence: schema+NodeView → input-rule native cursor + Enter keymap → serializer/projection readers (same commit) → parser construction sites → update tests (`registry.test.ts` `isAtomBlock`, `editable-atom-view-surface-gate.test.ts`, any latexComment JSON-shape snapshots).

**Risks:** (1) `.tex` round-trip must be byte-identical — a missed reader silently drops comment text; (2) test snapshots hard-coding `{type:'latexComment',attrs:{text}}` break and must migrate; (3) `isAtomBlock` assumption in text-object machinery needs audit; (4) keystroke-sanctity — a content-bearing comment now joins the doc-structure diff (should be fine: just inline content, no per-keystroke doc-walk); (5) `anchor-uuid.ts` DEFERRING_PARENTS — confirm UUID anchoring still resolves.

**Live-verify in PROD FSA** (atom/anchor behavior masks in the dev preview):
- (b) type `% ` then immediately a char — it must land **inside** the comment (no lost first keystroke).
- (c) caret inside comment + Enter — a new empty paragraph appears **after**, caret in it.
- (d) caret inside comment — lightning bolt appears at that line.
- (a) no jarring selected/unselected box flip while editing.
- Round-trip: edit comment → save .tex → reload — text survives verbatim; external-change badge not falsely tripped.
- **Regression:** MATH (inline + display) editing, float popout, and math `.selected` chrome all UNCHANGED. Comment in a card body still renders the static `% text` row. Word-count / outline / footnote-fallback still include comment text after the textContent rewrite.
