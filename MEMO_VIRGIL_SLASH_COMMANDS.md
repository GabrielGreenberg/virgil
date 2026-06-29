# Feature: add `\list` / `\itemize` / `\enumerate` / `\quote` / `\quotation` slash commands (+ omissions audit)

> **STATUS: LANDED** — branch `bugsweep-2026-06-26`, commit `ac530271` (+ SSOT-contract followup `7e28f3c3`). 5 entries in `VIRGIL_COMMANDS` routed through the bridge (`getEditorActionsHandleFor(view)`, NOT `runViewOnlyAction`); aliases mapped in `SLASH_NAME_TO_ACTION_ID` (list/itemize→bullet-list, enumerate→ordered-list, quote/quotation→blockquote); rows stay lightning-only (reconciliation skips). Data-loss-safe on non-listable blocks via `wrapperApplies`/`selectionIsListable`. Depended on #1 (done first). tsc 0, vitest green. NOT pushed/merged.

**Status:** `FIX-READY` (scoped, exact code below) — diagnosis/spec only, NOT implemented (user chose memo-only, 2026-06-26). Bug-catcher session 2026-06-26.
**Confidence:** HIGH (routing + registry rows verified against code).
**Worktree:** TBD (single file: `src/lib/tiptap/commands.ts`; a fresh worktree when implemented).

---

## Request

> "Add `\list` and `\enumerate` to the virgil commands. And check if there are any other obvious omissions."

User chose the **clean set**: `\list` + `\itemize` (bullet), `\enumerate` (numbered), `\quote` + `\quotation` (blockquote). `\figure`/`\graphics` and math deferred (see "Deferred").

---

## Current slash command set (the gap)

[commands.ts](src/lib/tiptap/commands.ts) `VIRGIL_COMMANDS` (12): `title` `author` `date` · `chapter` `section` `subsection` `subsubsection` · `ref` `ex` `cite` `footnote` `tex`. Missing: every **structural wrapper** (lists, blockquote) and **figure/graphics**, though all exist as SSOT registry rows the lightning grid already uses.

## Routing — must use the BRIDGE, not `runViewOnlyAction` (the gotcha)

`bullet-list` / `ordered-list` / `blockquote` are `formatToggleRow(...)` registry rows whose `run()` is `chainCmd(ctx.editor.chain().focus()).run()` ([action-registry.ts:2330-2337](src/lib/actions/action-registry.ts:2330); rows at [:2348-2349](src/lib/actions/action-registry.ts:2348) + the blockquote wrapper). They need the **real TipTap `editor`** for `.chain()`.

`runViewOnlyAction(id, view)` (the path `\tex`/headings use, [commands.ts:52-82](src/lib/tiptap/commands.ts:52)) synthesizes a **fake editor stub** `{ view, state }` with **no `.chain()`** — so mirroring `\tex` would throw/no-op. These commands must route through the **bridge** (`getEditorActionsHandle()?.runAction(id, { surface: "slash" })`), exactly like `\ex` — the bridge's `runAction` supplies the real editor via `innerRef.current?.getEditor()` ([EditorPane.tsx:2995](src/components/EditorPane.tsx:2995)). The registry comment even anticipates this: *"the SAME SSOT a future slash/keyboard surface would reach"* ([ActionsMenuPanel.tsx:246-247](src/components/ActionsMenuPanel.tsx:246)).

**Dependency note:** routing through the bridge means these inherit the multi-pane bridge bug logged this session (`MEMO_VIRGIL_CMD_BRIDGE_MULTIPANE.md`, backlog item #1) — under multi-doc keep-alive they could no-op / hit the wrong pane until that's fixed. Adding them adds weight to fixing the bridge. (A pure-PM alternative — reimplement list/quote toggles via `prosemirror-schema-list` `wrapInList`/`liftListItem` so they ride `runViewOnlyAction` and dodge the bridge — avoids the bug but DUPLICATES the toggle logic off the SSOT; NOT recommended. Use the bridge, fix the bridge once.)

## Exact change — append to `VIRGIL_COMMANDS` ([commands.ts](src/lib/tiptap/commands.ts), grouped with the block toggles, e.g. after `tex`)

```ts
// Structural wrapper toggles — route through the bridge (tiptap-chain run()
// needs the real editor's .chain(), so NOT runViewOnlyAction). Mirror \ex.
// The registry rows are `wrapper: true` → they grey + no-op on non-listable
// blocks (heading / titleField / atom block) via wrapperApplies +
// selectionIsListable, so \list on a heading is a safe no-op.
{
  name: "list",        // \list — bullet list (Virgil-ism; \itemize is the LaTeX name)
  action: (view) => {
    if (!view.editable) return;           // collab gate, mirror \cite/\footnote
    getEditorActionsHandle()?.runAction("bullet-list", { surface: "slash" });
  },
},
{
  name: "itemize",     // \itemize — LaTeX-idiomatic alias → bullet list
  action: (view) => {
    if (!view.editable) return;
    getEditorActionsHandle()?.runAction("bullet-list", { surface: "slash" });
  },
},
{
  name: "enumerate",   // \enumerate — numbered list (matches the LaTeX env name)
  action: (view) => {
    if (!view.editable) return;
    getEditorActionsHandle()?.runAction("ordered-list", { surface: "slash" });
  },
},
{
  name: "quote",       // \quote — blockquote
  action: (view) => {
    if (!view.editable) return;
    getEditorActionsHandle()?.runAction("blockquote", { surface: "slash" });
  },
},
{
  name: "quotation",   // \quotation — blockquote alias (LaTeX has both quote & quotation envs)
  action: (view) => {
    if (!view.editable) return;
    getEditorActionsHandle()?.runAction("blockquote", { surface: "slash" });
  },
},
```

**No other wiring needed:** `COMMAND_MAP`, `VIRGIL_COMMAND_NAMES`, the slash popup ([slash-popup.ts](src/lib/tiptap/slash-popup.ts)), and the typed-`\name`+Return handler ([latex-command.ts:150-164](src/lib/tiptap/latex-command.ts:150)) all derive from `VIRGIL_COMMANDS` automatically. `getEditorActionsHandle` is already imported in `commands.ts`.

**Verify "blockquote" is the registry id** before implementing (the lightning grid calls `runGridAction("blockquote")` at [ActionsMenuPanel.tsx:616](src/components/ActionsMenuPanel.tsx:616), and it's one of the three wrapper toggles per [action-registry.ts:2202-2203](src/lib/actions/action-registry.ts:2202)) — confirm the `BLOCKQUOTE_ACTION_ROW` exists in the registry index like `BULLET_LIST_ACTION_ROW`/`ORDERED_LIST_ACTION_ROW`.

## Naming note
`\enumerate` matches the LaTeX environment exactly. `\list` does NOT — a LaTeX bullet list is `\begin{itemize}`; `\list` is a low-level LaTeX primitive. Hence add **both** `\list` (user-requested, intuitive) and `\itemize` (LaTeX-correct) → bullet-list, and both `\quote`/`\quotation` → blockquote.

## Tests
- Extend the slash-command coverage (cf. existing cross-surface tests): `\list`/`\itemize`/`\enumerate`/`\quote`/`\quotation` each reach `runAction("bullet-list" | "ordered-list" | "blockquote")` on the bridge. Assert the typed-`\name`+Return path (latex-command handleKeyDown) deletes the text and dispatches the same. Assert collab read-only (`view.editable === false`) no-ops.
- Behavior: `\enumerate` on a paragraph wraps it in an ordered list; on a heading it no-ops (wrapper `selectionIsListable` guard).

## Deferred (obvious omissions, but bigger lifts — NOT in this pass)
- **`\figure`, `\graphics` / `\includegraphics`** → the `figure`/`graphics` registry rows insert via `smartInsertBlock` then open a **source popover** through `ctx.openFigurePopover` ([action-registry.ts:1984-2011](src/lib/actions/action-registry.ts:1984)). The grid threads that callback ([ActionsMenuPanel.tsx:283](src/components/ActionsMenuPanel.tsx:283)); the bridge would need to thread it onto the slash surface too. Obvious + wanted, but needs popover wiring.
- **`\equation` / `\display`** → `display-math`, **`\inlinemath`** → `inline-math`. Lower priority — math is already reachable via `$$`/`$` input rules; add if a typed-command surface is wanted.
- **Marks** (`\textbf`→bold, `\emph`→italic, `\texttt`→code): inline marks are normally toggled via markdown input rules (`**`, `*`) or selection; a slash/Enter command (which inserts/wraps at a block boundary) is an awkward fit. Skip unless explicitly requested.
