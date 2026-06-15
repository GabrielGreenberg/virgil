# Appendix — Surface-driver recipes (`preview_eval`)

Faithfully triggering Virgil's 5 action surfaces from `preview_eval`. "Faithful" means each recipe drives the **real surface code path** (the actual dispatcher / plugin / input rule / keymap), not a shortcut that bypasses the wiring under test.

## Preconditions / handles

These recipes assume the live debug handle is wired on `window.__v` (see [`_harness.js`](_harness.js); inject it via `preview_eval` after every reload):

- `window.__v.main` — the main-pane TipTap `Editor` instance (`editor.view`, `editor.state`, `editor.commands`, `editor.chain()`).
- `window.__v.dh` — the shared **grab + lightning** dispatcher object: `{ dispatch(action, ref) }` (the `dispatch` returned by `useDragHandleActions` in `drag-handle-actions.ts`, the SAME function `ActionsMenuPanel` and `DragHandleMenu` call).
- `window.__v.cc` — `cardCreation` (the `CardCreationApi`); rarely needed directly — prefer `dh.dispatch` so you exercise the dispatcher.

If `window.__v` is not present, reach the editor via the documented fiber walk (`preview_editor_internals_access` memo) and obtain `dh`/`cc` from the same `EditorPane` fiber that holds them. On a read-only/collab doc, every surface refuses (the uniform CHIP-7b `canEdit`/`view.editable` gate) — apply edits with `tr.setMeta('ignoreReadOnly', true)` only if you explicitly want to bypass that gate for a non-action probe.

Important: **a real surface always plants/uses a selection.** Before any range-based recipe, set the editor selection so the surface "sees" the passage. The dispatcher does this for you from the `ref`, but slash/typed/keyboard read the live selection.

---

## Surface 1 — GRAB (drag-handle menu → `dh.dispatch`)

### What the real wiring is
The grab handle opens `DragHandleMenu` (`src/components/DragHandleMenu.tsx`). Each menu item is a `<button>` whose `onClick` (line ~219) calls `onSelect(row.id as DragHandleAction)`. `onSelect` is wired to `useDragHandleActions().dispatch` (i.e. `dh.dispatch`). So **per-cell behavior IS `dh.dispatch(actionId, ref)`** — the menu only resolves which `row.id` and constructs the `ref`.

`dispatch(action, ref)` lives in `drag-handle-actions.ts`. It (1) resolves the ref to a `{from,to}`/NodeSelection via `resolveRefRange`, (2) **plants the editor selection** over it, (3) calls the matching `cardCreation.createX(...)` / lifecycle path with `mode:"omni"`, (4) routes the panel.

### Action IDs (the `DragHandleAction` union)
`"footnote" | "citation" | "note" | "highlight" | "todo" | "suggest-edit" | "cutter" | "report" | "duplicate" | "archive" | "delete"`.

### Ref shapes (from `drag-handle-actions.ts` `DragHandleRef = TextObjectRef | SelectionRef`)
- **Block ref** (paragraph, heading, listItem, atom blocks, …): `{ kind: <TextObjectKind>, id: <uuid> }`. `kind` is the PM node name (`"paragraph"`, `"heading"`, `"listItem"`, `"texBlock"`, …); `id` is the node's `uuid` attr. For `"heading"`, annotation actions (note/footnote/…) act on the heading LINE, lifecycle actions (duplicate/archive/delete) on the whole SECTION (`actionClass` split).
- **Selection (range) ref**: `{ kind: "selection", from: <pos>, to: <pos>, paragraphId: <uuid> }`. This is gesture-input, not a TextObject.
- **Linked-range ref**: `{ kind: "linkedRange", id: <anchorId> }`. NOTE: the field is **`id`**, not `anchorId` — `TextObjectRef` is `{kind, id}` and for `linkedRange` the `id` holds the `linkedAnchor.anchorId` (see `types.ts:77` and `findLinkedRangeBounds(doc, ref.id, …)`). The grab menu never opens for this kind in practice, but `dispatch` handles it.

### Faithful eval recipes

Block ref — note on a paragraph (grab the paragraph's real uuid first):
```js
const ed = window.__v.main;
let pid = null;
ed.state.doc.descendants(n => { if (!pid && n.type.name === "paragraph" && n.attrs.uuid) pid = n.attrs.uuid; return !pid; });
window.__v.dh.dispatch("note", { kind: "paragraph", id: pid });
```

Selection (range) ref — highlight a live range (set `from/to` to a real text span):
```js
const ed = window.__v.main;
const from = 1, to = 10;                       // a real text range
let pid = null;
const $f = ed.state.doc.resolve(from);
for (let d = $f.depth; d >= 0; d--) { const n = $f.node(d); if (n.attrs && n.attrs.uuid) { pid = n.attrs.uuid; break; } }
window.__v.dh.dispatch("highlight", { kind: "selection", from, to, paragraphId: pid });
```

Linked-range ref (mark already present in the doc):
```js
window.__v.dh.dispatch("note", { kind: "linkedRange", id: "<existing-anchorId>" });
```

### To prove the MENU calls dispatch (wiring, not just the cell)
Spy on `dh.dispatch` before opening the menu, then drive the real menu button:
```js
const real = window.__v.dh.dispatch.bind(window.__v.dh);
window.__v.dh.dispatch = (...a) => { window.__lastDispatch = a; return real(...a); };
// now open the grab handle gesture and click "Note"; then read window.__lastDispatch
```
For **per-cell behavior** verification, calling `dh.dispatch(id, ref)` directly is the canonical shared path — that is exactly what the menu's onClick reduces to.

---

## Surface 2 — LIGHTNING (`ActionsMenuPanel` → `dh.dispatch` for cards; registry `run()` for formatting)

### What the real wiring is (`src/components/ActionsMenuPanel.tsx`)
TWO families:

1. **Card actions** (Footnote/Note/Highlight/Todo/…): `runAction(action)` (line 169) builds the `ref` and calls `dragHandleMenu.dispatch(action, ref)` — **the same `dh.dispatch`** as grab. The `ref`:
   - `mode === "cursor"` → `{ kind: "paragraph", id: paragraphUuid }`
   - `mode === "selection"` → `{ kind: "selection", paragraphId: paragraphUuid, from: range.from, to: range.to }`
   So lightning card cells are byte-identical to grab — **drive them via `dh.dispatch` with those exact ref shapes.**

2. **Formatting cells** (bold/italic/strike/code, lists, blockquote, math, figure/graphics, text-color, `\ref`, `\ex`): `runGridAction(id, payload?)` (line 202) builds a view-only `ActionContext` off the live selection (`surface:"lightning"`, `canEdit`, the `openFigurePopover`/`openColorPopover`/`openRefPopover` seams) and calls `VIRGIL_ACTION_REGISTRY[id].run(ctx)` directly. These do NOT go through `dispatch`.

### Faithful eval recipes

Lightning CARD cell (cursor mode):
```js
const ed = window.__v.main;
let pid = null;
const $h = ed.state.selection.$head;
for (let d = $h.depth; d >= 0; d--) { const n = $h.node(d); if (n.attrs && n.attrs.uuid) { pid = n.attrs.uuid; break; } }
window.__v.dh.dispatch("footnote", { kind: "paragraph", id: pid });
```

Lightning CARD cell (selection mode) — same as grab's selection ref:
```js
window.__v.dh.dispatch("note", { kind: "selection", from, to, paragraphId: pid });
```

Lightning FORMATTING cell — replicate `runGridAction`: focus, build the `surface:"lightning"` ctx, invoke the registry row's `run()`:
```js
// requires access to VIRGIL_ACTION_REGISTRY; if exposed on __v, e.g. window.__v.reg
const ed = window.__v.main;
ed.chain().focus().run();
const ctx = {
  editor: ed, view: ed.view,
  ref: { kind: "selection", from: ed.state.selection.from, to: ed.state.selection.to, paragraphId: "" },
  surface: "lightning", canEdit: true,
  openFigurePopover: () => {}, openColorPopover: () => {}, openRefPopover: () => {},
};
window.__v.reg["bold"].run(ctx);   // toggles bold via editor.chain().focus().toggleBold().run()
```
If `VIRGIL_ACTION_REGISTRY` isn't on `__v`, the bold/italic/etc. format rows are pure `editor.chain().focus().toggleX().run()` — so `ed.chain().focus().toggleBold().run()` reproduces the cell's effect (but skips the registry collab guard — see the keyboard surface for the distinction).

To assert the MENU→dispatch edge for card cells, spy on `dh.dispatch` as in the grab section and click a real lightning cell.

---

## Surface 3 — SLASH (`slash-popup.ts` `executeSelection` → `commands.ts`)

### What the real wiring is
`SlashPopupExtension` (`src/lib/tiptap/slash-popup.ts`):
- `handleTextInput` fires when the user types `"\"` at a "fresh position" → opens the popup (sets meta state; the `\` IS inserted into the doc, `return false`).
- Subsequent letters re-sync the query via `reSync`.
- **Enter / Tab** in `handleKeyDown` calls `executeSelection(view, cur)` (line 49): `delete(slashPos, cursor)` (removes the typed `\name`), sets the popup CLOSED meta, dispatches, then `cmd.action(view, "\\" + name)` where `cmd = COMMAND_MAP.get(name)` from `commands.ts`.

`VIRGIL_COMMANDS` (`commands.ts`) routes each command:
- **Pure-PM** (`\chapter/\section/\subsection/\subsubsection`, `\tex`, `\title/\author/\date`) → `runViewOnlyAction(id, view)` → builds a `surface:"slash"` `ActionContext` and calls `VIRGIL_ACTION_REGISTRY[id].run(ctx)` directly (no bridge).
- **Bridge-routed** (`\ref`, `\ex`, `\cite`, `\footnote`) → `getEditorActionsHandle()?.runAction(id, { surface:"slash", payload })`. For `\cite`/`\footnote` the atom is inserted **synchronously** in `commands.ts` first, then the CARD registration rides the bridge.

### Faithful eval recipes

The cleanest faithful recipe that exercises `commands.ts` (the slash command's `run()` destination) — drive the command's `action` exactly as `executeSelection` does after it deletes the `\name`:
```js
const ed = window.__v.main;
const view = ed.view;
const cmd = window.__v.commands?.COMMAND_MAP?.get("section"); // if exposed
cmd.action(view, "\\section");   // → runViewOnlyAction("heading-section", view)
```

If `COMMAND_MAP` is not exposed on `__v`, exercise the **full popup wiring** by simulating the typed sequence so the plugin's own `handleTextInput`/`handleKeyDown` run:
```js
const view = window.__v.main.view;
const from = view.state.selection.from;
view.dispatch(view.state.tr.insertText("\\section", from));
view.dispatch(view.state.tr.setMeta("slashPopup", {
  open: true, slashPos: from, query: "section", selectedIndex: 0,
  filtered: ["section"]   // must be a non-empty filtered list incl. the target
}));
view.dom.focus();
view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
```
This runs the REAL `executeSelection` → `cmd.action` → `runViewOnlyAction`/bridge. Verify by reading `main.state.doc` (heading converted) or, for `\cite`/`\footnote`, the inserted atom + sidecar card after autosave.

For `\cite`/`\footnote` via slash, the atom-insert is synchronous in `commands.ts` and the card rides `runAction(..., {surface:"slash"})` → bridge → registry `citation.run`/`footnote.run`.

---

## Surface 4 — TYPED (input rules in `citation.ts` / `footnote.ts`)

### What the real wiring is
A ProseMirror `handleTextInput` prop on each node's extension. It matches the text-before-cursor against a shared regex, inserts the atom synchronously, then registers the card via `getEditorActionsHandle()?.runAction(id, {surface:"typed", payload})`.

**Citation** (`citation.ts`, `citationInput` plugin): acts on terminators `"}"`, `" "`, or `"\n"`.
- `\cite{key}` + the typed **`}`** → matches `CITE_RE_FULL` → inserts atom with the full `command`, registers card.
- `\cite` + a typed **space**/newline → the "bare" branch (`CITE_RE_BARE`) → inserts an empty `\cite{}` atom, registers card.

**Footnote** (`footnote.ts`, `footnoteInput` plugin): only acts on terminator **`}`**. `\footnote{...}` + the typed `}` → matches `FOOTNOTE_RE_FULL = /\\footnote\{([^}]*)\}$/` → inserts footnote atom (body = the captured group), renumbers, registers card with `payload:{footnoteId, pristine}` (pristine only when the body is empty).

Critical: `handleTextInput(view, from, to, text)` receives the **terminator char as `text`**, NOT yet in the doc. Put the *prefix* in the doc and deliver the terminator as the `text` argument.

### Faithful eval recipes

Deliver the terminator through PM's real input pipeline via `view.someProp("handleTextInput", …)`:

```js
const ed = window.__v.main, view = ed.view;
const start = ed.state.selection.from;
view.dispatch(view.state.tr.insertText("\\cite{smith2020", start));
const caret = ed.state.selection.from;
const handled = view.someProp("handleTextInput", f => f(view, caret, caret, "}"));
// handled === true → input rule fired, inserted the citation atom,
// and called runAction("citation", {surface:"typed", payload:{citationId, command}})
```

Footnote (terminator `}`):
```js
const ed = window.__v.main, view = ed.view;
const start = ed.state.selection.from;
view.dispatch(view.state.tr.insertText("\\footnote{my note", start));
const caret = ed.state.selection.from;
view.someProp("handleTextInput", f => f(view, caret, caret, "}"));
```

Bare citation (terminator space):
```js
const ed = window.__v.main, view = ed.view;
const start = ed.state.selection.from;
view.dispatch(view.state.tr.insertText("\\cite", start));
const caret = ed.state.selection.from;
view.someProp("handleTextInput", f => f(view, caret, caret, " "));
```

`view.someProp("handleTextInput", fn)` walks every plugin's `handleTextInput` (slash popup's, citation's, footnote's) in order and stops at the first that returns true — **exactly** how ProseMirror dispatches the event, the faithful entrypoint. These reach `run()` via the bridge. Note the collab gate: `handleTextInput` returns `false` early if `!view.editable`.

---

## Surface 5 — KEYBOARD (StarterKit / mark keybindings)

### What the real wiring is
Marks ship their own keymaps via `addKeyboardShortcuts`. E.g. `@tiptap/extension-bold/dist/index.js:65`: `"Mod-b": () => this.editor.commands.toggleBold()`, `"Mod-i"` (Italic), `"Mod-Shift-s"`/`"Mod-e"` etc. These are **plain TipTap commands on the editor** — they do NOT go through `VIRGIL_ACTION_REGISTRY`, `dh.dispatch`, or the bridge. The keyboard mark surface is the raw editor command, while the lightning formatting cell wraps the **same** `toggleBold()` inside a registry `run()` (`backbone:"tiptap-chain"`).

### Faithful eval recipes

Most faithful — dispatch a keydown the editor's keymap handles, via `someProp("handleKeyDown")`:
```js
const ed = window.__v.main, view = ed.view;
ed.commands.setTextSelection({ from, to });    // select the text to bold
view.dom.focus();
const evt = new KeyboardEvent("keydown", { key: "b", code: "KeyB", metaKey: true, bubbles: true, cancelable: true });
const handled = view.someProp("handleKeyDown", f => f(view, evt));
// handled === true → the Bold extension's "Mod-b" binding ran toggleBold()
```
(Use `ctrlKey:true` instead of `metaKey` on non-mac keymaps; TipTap's `Mod` maps to Cmd on mac, Ctrl elsewhere — match the platform the preview reports.)

Equivalent (the command the binding maps to), if you only need the effect:
```js
window.__v.main.commands.toggleBold();   // exactly what "Mod-b" invokes
```

### Distinguishing keyboard from a registry `run()`
- **Keyboard mark binding**: `editor.commands.toggleBold()` directly. No `ActionContext`, no `surface`, no `canEdit` gate beyond the editor's own editability, no bridge, no registry lookup.
- **Lightning/registry format `run()`**: `VIRGIL_ACTION_REGISTRY["bold"].run(ctx)` with `surface:"lightning"`, `canEdit`, the popover seams. It ALSO ends in `editor.chain().focus().toggleBold().run()`, so the **doc effect is identical** — the difference is whether the registry/`ActionContext` machinery ran. To assert the keyboard path, spy on the registry row's `run` and confirm it was NOT called; to assert the registry path, spy and confirm it WAS.

---

## Observing results

### A. In-memory (immediate, synchronous)
The doc mutation is visible on `window.__v.main.state.doc` the instant the transaction dispatches — no wait needed:
```js
window.__v.main.state.doc.toJSON();                      // full doc JSON
window.__v.main.getJSON();                               // same, via TipTap
let fns = 0; window.__v.main.state.doc.descendants(n => { if (n.type.name === "footnote") fns++; });
```
Atoms (footnote/citation), heading conversions, mark toggles, inserted blocks all appear here immediately. Fastest, most reliable assertion for atom/marker/structure changes; avoids the autosave + dev-doc-refresh complications.

### B. Sidecar JSON on disk (after the ~1500 ms autosave)
Card registrations (note/todo/citation card/footnote card/highlight/cutter/report/suggestion/archive) land in `virgil-data/doc_devtest/virgil/*.json` only after the `useDocument.ts` autosaver's **1500 ms** debounce settles. Files per kind (in `virgil-data/doc_devtest/virgil/`): `footnotes.json`, `citations.json`, `notes.json` (+ highlights), `todos.json`, `cutter.json`, `reports.json`, `revisions.json`, `suggestions.json`, `archive.json`, `annotations.json`, `examples.json`, `ai-requests.json`, …

Wait at least ~1600 ms after the action. Prefer a Monitor/until-loop polling the file over a fixed `sleep`. Caveat: a dev-doc refresh (`rm -rf … && cp -R samples/annotation-history …`) resets these; don't run it mid-verification.

### C. `document.tex` markers (after autosave + serialize)
The `.tex` round-trip serializes atoms via `latex-serializer.ts`: footnote → `\footnote{<body>}`; citation → the node's `command` attr verbatim (`\cite{key}` / `\cite{}`); headings → `\section{…}` etc. Read `virgil-data/doc_devtest/document.tex` after the autosave/serialize cycle. In-memory (A) is preferred for atom assertions since it skips the serialize timing.

### D. Keystroke-sanctity / bus probe
`window.__virgilBusStats()`: `emitCount` stays flat on plain typing; `version` advances on docChanged. Use to confirm a recipe produced a structural event (or didn't).

---

## Async ConfirmDialog handling (archive / delete / heading-duplicate)

`dispatch("archive", …)` / `dispatch("delete", …)` are **async**. When the resolved ref carries content, `resolveDestructiveConfirm` returns a descriptor and `dispatch` does `const proceed = await confirm({...})` — `confirm` renders a `ConfirmDialog` on a **later React tick** and resolves only when the user clicks Confirm/Cancel. The destructive mutation runs **after** that await resolves.

1. **The dialog renders in a separate frame.** `dh.dispatch("delete", ref)` will NOT mutate the doc synchronously — it awaits the user. Click the dialog's Confirm button in a **separate `preview_eval` call** (after the dialog has mounted), by its label (`confirmLabel`, e.g. "Delete passage" / "Archive passage" / "Duplicate section"):
   ```js
   // SECOND eval, after dispatch — the dialog is now in the DOM:
   const btn = [...document.querySelectorAll("button")]
     .find(b => /Delete|Archive|Duplicate section/i.test(b.textContent || ""));
   btn?.click();   // resolves the confirm() promise → dispatch proceeds with the delete
   ```
2. **When NO confirm is shown:** if `resolveDestructiveConfirm` returns `null` (empty selection, nothing at stake, or the kind opts out), `dispatch` proceeds synchronously — no dialog, no second eval needed.
3. **Duplicate-on-heading** also confirms (`confirmHeadingLifecycle`, label "Duplicate section") — same two-eval pattern.
4. To **bypass** the dialog entirely for a non-interactive test, pre-stub `confirm`/`notify` in the deps — but that is NOT faithful; prefer the two-eval click so you exercise the real ConfirmDialog path.

After a delete routed through the dialog, `dispatch` re-focuses the editor (`ed.view.focus()`) so Cmd-Z reaches the doc (B4) — observable as the editor regaining selection.

---

## Quick reference table

| Surface | Faithful entrypoint | Reaches `run()` via | Refs / args |
|---|---|---|---|
| 1. Grab | `dh.dispatch(actionId, ref)` | dispatcher (cardCreation/lifecycle directly) | `{kind:<TOKind>,id}` \| `{kind:"selection",from,to,paragraphId}` \| `{kind:"linkedRange",id:<anchorId>}` |
| 2. Lightning | cards: `dh.dispatch(actionId, ref)`; format: `reg[id].run(ctx)` (`surface:"lightning"`) | dispatcher (cards) / registry direct (format) | cursor `{kind:"paragraph",id}` or `{kind:"selection",…}` |
| 3. Slash | drive popup `handleTextInput("\")`+letters+Enter keydown → `executeSelection` → `cmd.action` | `runViewOnlyAction` (pure-PM) or bridge `runAction(id,{surface:"slash"})` | command name (`section`, `cite`, `footnote`, …) |
| 4. Typed | `view.someProp("handleTextInput", f => f(view, caret, caret, terminator))` after inserting prefix | bridge `runAction(id,{surface:"typed",payload})` | `\cite{key}`+`}`, `\cite`+`" "`, `\footnote{..}`+`}` |
| 5. Keyboard | `view.someProp("handleKeyDown", f => f(view, kbEvent))` (Mod-b/Mod-i) | raw `editor.commands.toggleBold()` — NOT registry/bridge | KeyboardEvent with `metaKey`/`ctrlKey` |

**Key discrepancy flagged:** the linkedRange ref field is **`id`** (holding the `anchorId`), not a literal `anchorId` key — confirmed against `types.ts` `TextObjectRef = {kind, id}` and `findLinkedRangeBounds(doc, ref.id, …)` in `drag-handle-actions.ts`.
