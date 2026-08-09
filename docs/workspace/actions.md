<!-- last-verified: 891c066a 2026-08-10 -->
<!-- derives-from: docs/architecture/VIRGIL.md#ontology, docs/architecture/VIRGIL.md#code-organization -->
<!-- covers-code: src/lib/actions/action-registry.ts, src/lib/actions/editor-actions-bridge.ts, src/lib/actions/action-icons.tsx, src/lib/tiptap/smart-insert.ts, src/components/menu, src/components/DragHandleMenu.tsx, src/components/ActionsMenuPanel.tsx, src/components/SelectionActionsMenu.tsx, src/components/editor-layout/card-actions, src/lib/editor-extensions.ts, src/lib/tiptap/tab-indent.ts, src/lib/tiptap/expex.ts, src/lib/tiptap/latex-comment.ts, src/lib/section-folding.ts, src/lib/focus-view.ts, src/lib/tiptap/uuid-attr.ts, src/lib/tiptap/anchor-highlight-deco.ts, src/lib/tiptap/pgmark.ts, src/lib/tiptap/latex-command.ts, src/text-objects/text-object-registry.ts, src/text-objects/TextObjectGrabHandle.tsx, src/text-objects/LiftHost.tsx, src/text-objects/drop-adapters.ts, src/components/drop-mode, src/cards/drop-specs, src/lib/tiptap/atom-registry.ts, src/lib/tiptap/structural-edit.ts, src/lib/tiptap/insert-inline-atom.ts, src/lib/tiptap/chrome-scroll-margin.ts -->

# Actions (the editing surface) — operational manifest

> **When to load.** Any task that needs to know *what a user can DO* in the
> editor — which button/key/gesture creates a Card, formats text, moves a
> block, or drags an Atom — and *where each action is defined*. This is the
> editing-surface **vocabulary**, not a per-Card schema ([cards.md](cards.md))
> nor the write path a skill takes ([structure.md → the write path](structure.md#the-write-path)).
> A skill rarely drives the UI; load this to recognize what the *user* did
> (what produced the Task you're draining) or to mirror a UI action's effect on
> the `.tex` / sidecars.

Operational cut of two [VIRGIL.md](../architecture/VIRGIL.md) sections: the
[Ontology](../architecture/VIRGIL.md#ontology) (the five primitives and their
**mobility** — "all TextObjects and Cards can be moved, popped out, and dropped
back freely; Atoms have only text-bound mobility") and
[Code organization](../architecture/VIRGIL.md#code-organization) (the
**single-source-of-truth registries**). The editing surface is the *operational
realization* of those primitives' affordances — so this doc stays in the
manifest (per the [conceptual-doc-vs-manifest scope boundary](../architecture/VIRGIL.md#conceptual-doc-vs-operational-manifest--the-scope-boundary))
and roots every action in the registry / keymap / decoration plugin that
**defines** it, rather than enumerating the rendered UI.

## The four families at a glance

| Family | What it is | SSOT that defines it |
|---|---|---|
| **Card actions** | The action + formatting vocabulary reached from the gutter button, the block grab handle, slash commands, and typed-LaTeX input rules | `VIRGIL_ACTION_REGISTRY` ([action-registry.ts](../../src/lib/actions/action-registry.ts)) — the single SSOT every surface reads off; the two live menus ([DragHandleMenu.tsx](../../src/components/DragHandleMenu.tsx) / [ActionsMenuPanel.tsx](../../src/components/ActionsMenuPanel.tsx)) RENDER FROM it, *through* the `<Menu>` primitive ([src/components/menu/](../../src/components/menu)) |
| **Structural ops** | Block move / duplicate / delete / convert; the grab-handle lift; the three drag-drop flavors | `TEXT_OBJECT_REGISTRY` ([text-object-registry.ts](../../src/text-objects/text-object-registry.ts)) + the drop-spec registry ([drop-mode/registry.ts](../../src/components/drop-mode/registry.ts)) + `ATOM_REGISTRY` ([atom-registry.ts](../../src/lib/tiptap/atom-registry.ts)) |
| **Keyboard** | Custom keymaps + the inherited TipTap defaults that survive | `addKeyboardShortcuts` in [tab-indent.ts](../../src/lib/tiptap/tab-indent.ts) / [expex.ts](../../src/lib/tiptap/expex.ts) / [latex-comment.ts](../../src/lib/tiptap/latex-comment.ts) + the assembled set in [editor-extensions.ts](../../src/lib/editor-extensions.ts) |
| **Decorations** | The visual overlays that style/annotate without mutating the doc | The seven `DecorationSet` plugins (table below) |

The deep structure to keep in mind: **one action vocabulary behind three
triggers, one dispatch path** (Family 1), and **one drop-spec registry behind
three drag flavors** (Family 2). Where surfaces share machinery, it's documented
once below and the variants point at it.

---

## Family 1 — Card actions

### The action vocabulary: `VIRGIL_ACTION_REGISTRY`

The SSOT for the action vocabulary is **`VIRGIL_ACTION_REGISTRY`** in
[action-registry.ts:2718](../../src/lib/actions/action-registry.ts) — the single
registry every surface reads off (CHIP 3 inverted the old dependency: the array
`MENU_ENTRIES` is **deleted**, and the two live menus now render FROM the
registry via `cardActionRows("grab" | "lightning")`). The card-action slice is
**11** rows; the `DragHandleAction` union ([DragHandleMenu.tsx:39](../../src/components/DragHandleMenu.tsx))
stays as the shared action-id union the dispatcher + the per-kind
`TEXT_OBJECT_REGISTRY[kind].actions` lists speak. Each row's menu presentation
(label, single-`letter` shortcut, `icon`, `separator` / `destructive` flags)
lives in [action-icons.tsx](../../src/lib/actions/action-icons.tsx); each carries
an `applies()` gate + `run()`.

| # | `action` | Label | Letter | Class | Dispatch endpoint |
|---|---|---|---|---|---|
| 1 | `highlight` | Highlight | `H` | annotation | `cardCreation.createHighlight` |
| 2 | `note` | Note | `N` | annotation | `cardCreation.createNote` |
| 3 | `footnote` | Footnote | `F` | atom + card | `cardCreation.createFootnote` |
| 4 | `citation` | Citation | `C` | atom + card | `citationRun` (cursor/slash front-door → `openAtomCreate("citation")`; grab/lightning ref → legacy `dispatch("citation")`; commit → `cardCreation.createCitation`) — see [below](#the-unified-inline-atom-create-popover) |
| 5 | `todo` | Todo | `T` | annotation | `cardCreation.createTodo` |
| 6 | `suggest-edit` | Request edit | `E` | annotation | `cardCreation.createRevisionComment` |
| 7 | `cutter` | Request cut | `X` | annotation | `cardCreation.createCutterComment` |
| 8 | `report` | Request report | `R` | annotation | `cardCreation.createReportRequest` (files the *ask*) |
| 9 | `duplicate` | Duplicate | `D` | lifecycle | `cardLifecycle` clone + slice insert |
| 10 | `archive` | Archive | `A` | lifecycle | `cardCreation.createArchiveSnippet` |
| 11 | `delete` | Delete | `⌫` | lifecycle | `cardLifecycle` delete + range cut |

The `CardCreationApi` ([card-creation.ts:142](../../src/components/editor-layout/card-actions/card-creation.ts))
is the SSOT for the create endpoints; the `cardLifecycle`
(`CardLifecycleApi`, the per-`CardKind` clone/delete registry) drives Duplicate
and Delete. Three actions deliberately create the *request/comment* end of a
pair, not the authored kind: `suggest-edit` → a `revision-comment`, `cutter` →
a `cutter-comment`, and `report` → a `report-request` (the quick gesture files
the ask). The authored `revision-suggestion` / `cutter-suggestion` / `report`
kinds are AI/responder outputs (see [cards.md](cards.md)). Footnote and Citation
collapse the selection to the passage end before inserting their atom
([drag-handle-actions.ts:271](../../src/components/editor-layout/card-actions/drag-handle-actions.ts),
[:291](../../src/components/editor-layout/card-actions/drag-handle-actions.ts)) —
the audit's CITE behavior, below.

**No-scroll create (two halves).** Creating any card must NOT jump the viewport —
the new card is already surfaced at its anchor (float/panel). (1) The shared
`finishCreate` tail calls `suppressNextPlacement()`
([usePlacement](../../src/links/_shared/usePlacement.ts)) before `setSelected`, so
selecting the fresh card doesn't trip `usePlacement`'s card→text `alignEntryToY`
scroll (one call covers all card kinds — footnote/citation were the reported
jumps). (2) Inline-atom creates (footnote/citation/`\ref`/inline-math) route
through the unified no-scroll primitive **`insertInlineAtom`**
([insert-inline-atom.ts](../../src/lib/tiptap/insert-inline-atom.ts)) — `focus(null,
{ scrollIntoView: false })` + `insertContent`, never `.focus().scrollIntoView()`,
the inline-atom sibling of `smartInsertBlock`. Deliberate scrolls (block inserts,
jump-to-link) get a chrome-aware `scrollMargin`
([chrome-scroll-margin.ts](../../src/lib/tiptap/chrome-scroll-margin.ts)) so they
land below the sticky MenuBar + reading-mask instead of beneath them. `displayMath`
stays on the block-insert (scrolling) path — bringing a block into view is intended.

#### The unified inline-atom create popover

Citation and `\ref` now share **one deferred-commit create controller** — the
**`openAtomCreate(kind, opts?)`** seam on `ActionContext`
([action-registry.ts](../../src/lib/actions/action-registry.ts)). `citationRun`
and `refRun` call it instead of inserting an atom up front; the bridge /
`ActionsMenuPanel` compute the caret rect + captured insertion `pos` and hop the
`virgil-atom-create-popover` event `EditorLayout` consumes. The popover IS the
creator: it searches candidate targets (citekeys / `\label{…}` sites) and
materializes the atom via the no-scroll `insertInlineAtom` **only on commit** (OK
/ click-away for citation; pick for ref) at the captured `pos`. Nothing lands up
front, so the gutter never flashes a blank pristine card (the same defer-until-OK
pattern `\ref` introduced, now covering citation too). Typed `\cite{key}` /
`\footnote{…}` still insert synchronously in plugin-land (Family 3) — the popover
is the *menu/grid/slash* front door, not the typed one.

**Per-kind subset.** The registry's card-action rows are the *global*
vocabulary; the per-kind allowed subset is `TEXT_OBJECT_REGISTRY[kind].actions`
([text-object-registry.ts](../../src/text-objects/text-object-registry.ts)),
which each row's `applies()` gate consults. When the menu opens for a given
TextObject kind, the entries outside that set render **greyed-out**
(visible-disabled), not filtered away, so the menu shape is stable across kinds.
The five action sets are `PROSE_ACTIONS` / `NON_PROSE_BLOCK_ACTIONS` /
`MARKLESS_BLOCK_ACTIONS` (drops Highlight — a `marks: ""` node like `latexComment`
and `codeBlock` rejects the `linkedAnchor` mark; task 066 / task 146) / `TITLE_FIELD_ACTIONS` /
`LINKED_RANGE_ACTIONS`.

### The formatting vocabulary: the 4×4 grid

The grid in [ActionsMenuPanel.tsx](../../src/components/ActionsMenuPanel.tsx) is
now **16 used cells** (the former spacer is filled by the new `\ref` cell,
CHIP 7a). CHIP 6a/6b folded the FORMAT mark / list / blockquote / math /
text-color / block-atom cells INTO the registry: each cell dispatches via
`runGridAction(id)` → `VIRGIL_ACTION_REGISTRY[id].run(ctx)` (a view-only
`ActionContext` off the live selection — the SAME SSOT the slash/typed surfaces
reach). Two cells are still direct local calls (`\tex` → `insertTexBlock`,
`ex` → `exampleRun`).

| Cell | Effect | Dispatch |
|---|---|---|
| Bold / Italic / Strike / Code | toggle inline mark | `runGridAction("bold")` … → registry row (`backbone: "tiptap-chain"`) |
| BlockType | set paragraph/heading level | `<BlockTypeDropdown>` (`setBlockType`) |
| Bullet list / Numbered list / Blockquote | toggle block wrapper | `runGridAction("bullet-list")` … → registry row |
| Example (`ex`) | wrap selection in an `exampleBlock` | `exampleRun` (the canonical registry creator, shared with slash `\ex`) |
| Inline math (`$x$`) / Display math (`$$`) | wrap selection in math | `runGridAction("inline-math" / "display-math")` → registry row |
| Text color (`A`) | apply/clear text color | `runGridAction("text-color")` → `openColorPopover` → `SelectionColorPopover` → `setTextColor` / `unsetTextColor` |
| `\tex` | insert a raw-LaTeX block | `insertTexBlock` ([tex-block.ts](../../src/lib/tiptap/tex-block.ts)) — grid cell still calls it directly; the slash `\tex` uses the registry's `texRun` |
| Cross-ref (`\ref`) | open the shared inline-atom create popover in `\ref` mode | `runGridAction("ref")` → registry `refRun` → `openAtomCreate("ref")` (the unified seam — see [the create popover](#the-unified-inline-atom-create-popover), below) |
| Figure (`fig.`) | insert a figure block | `runGridAction("figure")` → registry `figureRun` → `smartInsertBlock` ([smart-insert.ts](../../src/lib/tiptap/smart-insert.ts)) |
| Image | insert a graphics block | `runGridAction("graphics")` → registry `graphicsRun` → `smartInsertBlock` ([smart-insert.ts](../../src/lib/tiptap/smart-insert.ts)) |

**The container gate (tasks 147–150, 153, 229).** An insert at a caret must honor the
**containing block** — a block-type can refuse a child it can't host without
corrupting the doc. Two SSOT predicates in [text-object-registry.ts](../../src/text-objects/text-object-registry.ts)
decide, read straight from the schema (no hardcoded kind list): `blockTypeHostsBlockInsert`
(pos entry `posHostsBlockInsert`) greys BLOCK-atom inserts (display-math / figure /
graphics / `\ex` / `\tex`) inside markless verbatim blocks (`codeBlock` / `latexComment`,
`spec.marks === ""`) and the `titleField` preamble singleton — the split those inserts
force there would corrupt the source. Since task 229 `posHostsBlockInsert` also takes the
inserted block's `NodeType` and adds a schema-precise **container** layer: it greys an
insert whose containing block can't host that block as a sibling (via `canReplaceWith`),
so a caret inside a `figureCaption` — whose non-isolating `figureBlock` parent hosts no
block child, and would otherwise split into dup-uuid copies — is rejected too, name-
agnostically (and type-precisely for `exampleItem`). `blockTypeHostsInlineAtom` (pos entry
`posHostsInlineAtom`) greys INLINE-atom inserts (inline-math `$x$`, `\ref`) inside the
`text*` verbatim blocks only (`contentMatch.matchType`), leaving them valid in a
`titleField`. The same gate is consulted by the slash/menu heading conversion (`headingRun` in
[action-registry.ts](../../src/lib/actions/action-registry.ts)), the typed-math input
rules ([math.ts](../../src/lib/tiptap/math.ts)), and the MenuBar `BlockTypeDropdown`'s
out-of-scope heading levels ([MenuBar.tsx](../../src/components/MenuBar.tsx)).

### Four surfaces, one registry

The registry is read off **four** surfaces (CHIP 3/4/5/6/7): the two React
**menus** (below), plus **slash commands** ([commands.ts](../../src/lib/tiptap/commands.ts))
and **typed-LaTeX input rules** (Family 3). The PM-plugin surfaces (slash /
typed) cross into React-land via the **`editor-actions-bridge`**
([editor-actions-bridge.ts](../../src/lib/actions/editor-actions-bridge.ts)): a
plugin calls `getEditorActionsHandle()?.runAction(id, seed)`, the bridge supplies
the React APIs (`cardCreation` / `cardLifecycle`) into the `ActionContext`, and
invokes `spec.run()` in React-land. Pure-PM commands (`\chapter`…`\subsubsection`,
`\tex`, `\title`/`\author`/`\date`) take the view-only `runViewOnlyAction` path
instead. The deleted `command-input.ts` event-bridge and the scattered
`virgil-*` `window` CustomEvents are all retired by this one typed seam.

The two React menus: both mount off the registry. The **gutter button** mounts
the full `ActionsMenuPanel` (grid + action list); the **block grab handle**
mounts the leaner `DragHandleMenu` (action list only). Both now PRESENT through
the shared **`<Menu>` primitive** ([src/components/menu/](../../src/components/menu),
design [menu-system-design.md](../agents/menu-system-design.md)): `DragHandleMenu`
renders `<MenuProvider layout="list">` + `<MenuItemsFromRegistry rows={cardActionRows("grab")}>`;
`ActionsMenuPanel` renders `<MenuProvider layout="composite">` with a `<MenuGrid cols={4}>`
above a `<MenuList>` carrying `<MenuItemsFromRegistry rows={cardActionRows("lightning")}>`.
The primitive owns positioning, arrow-key/letter nav, the roving "selection
square" highlight (CSS token `--menu-roving-bg`), and a container-mousedown
`preventDefault` so a menu click can't blur the editor — but the action vocabulary
is still `VIRGIL_ACTION_REGISTRY`, unchanged. The same primitive backs the
migrated `SelectionColorPopover`, `LabelRefPopover`, `HeadingTypeMenu`,
`TabPlusMenu`, `BibEntryPickerMenu` (combobox path), and MenuBar's
`BlockTypeDropdown` + `ViewMenu`. The slash popup is a **documented exception**
(not migrated).

| Trigger | Component | Mounts | Visibility |
|---|---|---|---|
| **Gutter button** | [SelectionActionsMenu.tsx](../../src/components/SelectionActionsMenu.tsx) | `ActionsMenuPanel` | A lightning bolt in the far-right gutter at the selection-head line; appears when the cursor is in the editor. `Mod-/` is the keyboard twin (opens / toggles the menu — Family 3) |
| **Block grab handle** | [TextObjectGrabHandle.tsx](../../src/text-objects/TextObjectGrabHandle.tsx) | `DragHandleMenu` (per-kind filtered) | The left-gutter grip on hover / selection; a *no-drag click* opens the menu (a drag lifts the block — Family 2) |

(The redundant MenuBar strip-button trigger, `ActionsStripButton`, was removed as backlog #6.)

Both menus route through one context, **`useDragHandleMenu()`**
([drag-handle-menu-context.tsx](../../src/components/editor-layout/card-actions/drag-handle-menu-context.tsx)),
whose value is wired in `EditorPane` as
`{ open: openDragHandleMenu, dispatch: dragHandleActions.dispatch }`:

- `open(ref, anchorRect)` mounts the `DragHandleMenu` popover (the grab-handle path).
- `dispatch(action, ref)` runs an action with no popover step (the toolbar path; both `ActionsMenuPanel` triggers call it directly).

`dispatch` is owned by **`useDragHandleActions`**
([drag-handle-actions.ts:115](../../src/components/editor-layout/card-actions/drag-handle-actions.ts)) —
the single `switch (action)` over all 11 actions
([drag-handle-actions.ts:264](../../src/components/editor-layout/card-actions/drag-handle-actions.ts)).
It receives `DragHandleActionsDeps` (`cardCreation`, `cardLifecycle`, `confirm`,
`notify`, view-prefs) and resolves the ref before acting:

- **Mode** is computed by the trigger from the live selection: `selection.empty`
  → `cursor` mode; else `selection` mode (ref `{ kind: "selection", from, to }`).
  In cursor mode the dispatch ref now carries the **real anchorable node kind**
  at the caret (`{ kind: nodeKind, id }` — heading / listItem / blockquote /
  codeBlock / … else `paragraph`), resolved ONCE at menu-open by
  `resolveAnchorUuidAndKind` ([anchor-uuid.ts](../../src/lib/anchor-uuid.ts)) and
  threaded `SelectionActionsMenu → ActionsMenuPanel` on the `menuTarget`. A
  flattened `"paragraph"` ref was the BUG2 no-op (a heading/listItem caret emitted
  `{kind:"paragraph", id:<headingUuid>}`, which `resolveRefRange` could never match
  → silent annotation bail; `56e904a`, docs/memos/action-menu-anchor-bugs/). The
  grey-out PROBE stays a `{kind:"cursor"}` ref on purpose — both derive from the
  one `menuTarget`, so probe and dispatch can't diverge on identity. In cursor mode
  the Highlight action is greyed out (it needs a range).
- **Ref class** — a `DragHandleRef` is a `TextObjectRef | SelectionRef`. The
  dispatcher plants a `TextSelection` over text-bearing refs and a
  `NodeSelection` on atom-blocks before the create helper runs.
- **Scope by action class** (`resolveRefRange` + `actionClass`): annotation
  actions (`H N F C T E X R`) act on the heading *line* for headings; lifecycle
  actions (`D A ⌫`) act on the whole *section*. Non-heading kinds yield the same
  range either way.
- **Destructive confirm** — Archive / Delete consult the kind's
  `confirmDestructive` registry slot; Heading × Duplicate warns via
  `confirmHeadingLifecycle` (a whole-section copy is wide enough to disorient).
  Atom-only lines (math / `\ref` / figure / `\tex` / citation-only) now
  archive/delete cleanly AND surface the confirm — they were previously
  silently no-op'd or deletable (`f4c830f` / `80170b3` / `63ccace`).
- **Uniform collab read-only gate** (CHIP 7b) — every card row's `applies()`
  routes through the shared gate keyed on `ActionContext.canEdit` (the SSOT
  mirror of `collab.canEditMainText` / `editor.isEditable`). When the partner
  holds the pen, every action greys out declaratively across all surfaces.

The lower-level action hooks the dispatcher / `useCardCreation` compose live
beside it in [editor-layout/card-actions/](../../src/components/editor-layout/card-actions):
`useCitationActions`, `useCommentActions` (cutter/revision), `useRefActions`
(`\ref`), `useFocusActions`, `useFileActions`, and the
block-level `useEditorOps` (Family 2). (Orphaned-footnote handlers no longer
live here: the old `useOrphanActions` / `orphans.ts` were retired for the
per-doc [`useOrphanedFootnotes`](../../src/hooks/useOrphanedFootnotes.ts) sidecar
hook + the per-pane [`useFootnoteOrphanBridges`](../../src/components/editor-layout/event-bridges/footnote-sync.ts) writer, FN-A2-03.) The footnote, note/highlight, and
selection-to-card paths have no standalone hooks — they're endpoints on the
`CardCreationApi` itself (`createFootnote` delegates to the editor handle's
`createFootnoteFromSelection`; `createNote` / `createHighlight` wrap the
injected store `add*` deps).

### Reconciliation with the action-button audit

[docs/agents/audit-action-button.md](../agents/audit-action-button.md) (the
414-probe archaeology, dated **2026-05-21**) is the prior art for this family,
but it predates two changes — verified against the current code:

- **`Quotation` is gone.** The audit's action row listed a 9th item,
  "Quotation"; it was removed in the card-system refactor. The current card
  vocabulary has **no `quotation`** (and no `Q` letter). Its conceptual
  successor is **`report`** (`R`), tracking the Quotations→Reports panel rename.
  **`duplicate`** (`D`) and **`delete`** (`⌫`) were also added. Net: the action
  row is now 11 entries, not 9.
- **The strip trigger is gone; the grab handle has its own menu.** The audit
  said all three triggers mount `ActionsMenuPanel`. The MenuBar strip trigger
  was removed (backlog #6); now only the **gutter** mounts `ActionsMenuPanel`,
  and the **block grab handle** mounts its own `DragHandleMenu` (action-list-only,
  per-kind filtered). The shared root is now `VIRGIL_ACTION_REGISTRY` (the
  former `MENU_ENTRIES` is deleted) + the `useDragHandleMenu` dispatch.

The audit's 18-context × 23-item **behavior matrix** (the ✅/⚠️/❌/💥/🪦 table)
was a *known-issues* catalog (clusters EX / ATOM / CITE / CONT / MODE / MARK,
with spin-off fixes DA-1…DA-5). The action-alignment effort (the CHIP run that
built this registry) **landed those fixes** — DA-1 (no block nodes in the
inline-only example slot), DA-5 (applicability/mode taxonomy), the atom-only
archive/delete + destructive-confirm fixes, and the uniform collab read-only
gate are all shipped. Treat the matrix as historical, not a live follow-up list.

---

## Family 2 — Structural ops & drop-mode

### Block-level ops

Whole-block (TextObject) operations come from two places:

- **`useEditorOps`** ([editor-ops.ts](../../src/components/editor-layout/card-actions/editor-ops.ts))
  — the structured block edits: `handleReorderBlocks` (move a contiguous block
  range), `handleRenameHeading`, `handleUpdateLabel`, `handleRenameParTitle`,
  plus the outline/scroll plumbing (`handleScrollToHeading`, debounced
  `handleUpdate`). The three rename mutators no longer flatten a heading to
  plaintext by integer block-index; they route through the UUID-anchored,
  atom-preserving primitive `editStructuredNodeByUuid`
  ([structural-edit.ts](../../src/lib/tiptap/structural-edit.ts)) — via
  `renameHeadingByUuid` / `renameParTitleByUuid` / `updateHeadingLabelByUuid`,
  which splice the new label around the heading's inline atoms (math/cite/ref)
  and gate the label commit on the same `isLabelTaken` predicate the live
  warning reads.
- **The `DragHandleMenu` lifecycle actions** — `duplicate` (clone the captured
  passage, forking any contained atoms' sidecars via `cardLifecycle`),
  `archive`, and `delete` (Family 1).

### The grab handle (lift / pop / drop)

**`TextObjectGrabHandle`** ([TextObjectGrabHandle.tsx](../../src/text-objects/TextObjectGrabHandle.tsx))
is the single canonical grip for every persistent TextObject *and* live text
selections. It realizes the [Ontology](../architecture/VIRGIL.md#ontology)
"move / pop / drop freely" affordance:

- **Hover / selection** → a handle appears in the left gutter (innermost-to-outermost per nesting level).
- **No-drag click** → opens the `DragHandleMenu` (Family 1).
- **Drag past the lift threshold** → hands off to the shared **`LiftHost`** (below), which mounts a lifted-overlay ghost and begins a drop session. Two modes by cursor location: **ghost mode** (cursor in the content zone → release commits a placement via drop-mode) and **popout mode** (cursor outside → spawns a real floating window).

The grab handle now keeps only the **shell** — the `is-pressed` toggle, the 5px
lift-threshold gate, the no-drag → menu fallback, and `SelectionRef`→`TextObjectRef`
hydration. The post-threshold core (the lifted overlay, the drop-session /
popout-spawn logic, anchor-DOM resolution, float-policy chrome) was extracted
into **`LiftHost`** ([LiftHost.tsx](../../src/text-objects/LiftHost.tsx)), a
provider mounted in `EditorPane` as the lowest common ancestor of both the grab
handle and `FloatHost`. At threshold-cross the handle calls
`useLiftHost().beginLift({ terminalPolicy: "grab", ref, cardKey, origin })`. A
`terminalPolicy` of `"grab"` gives the grab-handle terminal (ghost-commit or
popout); `"float"` is the other producer — the **drop button on popped-out
text-object floats** (the lifted-overlay drop gesture, shared via the same host).

### `TEXT_OBJECT_REGISTRY` — what is graspable

[text-object-registry.ts](../../src/text-objects/text-object-registry.ts) is the
SSOT for *which* blocks are graspable/movable and how each behaves. **16 kinds**:
14 top-level (`paragraph`, `heading`, `bulletList`, `orderedList`, `blockquote`,
`codeBlock`, `displayMath`, `titleField`, `latexComment`, `texBlock`,
`figureBlock`, `graphicsBlock`, `exampleBlock`, `linkedRange`) and 2 sub-objects
(`listItem`, `exampleItem`). Per-kind slots the gesture reads: `actions` (the
menu subset, Family 1), `dropAdapter`, `chromeAnchor`, `collectMoveSource`
(heading widens to the whole section), `confirmDestructive`, and the lift-overlay
hooks (`renderGhost` / `liftSourceRect` / `computeLabel`, overridden only by
`heading` and `linkedRange`).

### Drop-mode — three drag flavors, one registry

"Drop-mode" ([drop-mode/](../../src/components/drop-mode)) is the drag-drop
engine. `DropModeProvider` holds the session (the lifted payload + the live drop
indicator) and mounts the `DropModeIndicator` + `InlineAtomGhost`. Every drag is
dispatched by **`cardKey`** through `lookupSpec`
([drop-mode/registry.ts](../../src/components/drop-mode/registry.ts)) — there is
**no DOM MIME map**; the `cardKey` (`"<prefix>:<id>"` / `"float:<domain>:<kind>:<id>"`)
*is* the routing key. `lookupSpec` parses the key, then: text-objects → the two
text-object specs; **card kinds → the folded `CARD_REGISTRY[kind].dropSpec`**
(no longer a parallel prefix table — the per-panel specs register via
[src/cards/drop-specs/](../../src/cards/drop-specs), and `assertDropFacetCoverage`
pins each kind's `droppable` / `dropPlacement` CardMeta facet to its
`dropSpec.allowedPlacements`); transient `atom-grab` / `stack-pull` → a small
`TRANSIENT_SPECS` table. Three flavors:

| Flavor | Lifted from | `cardKey` prefix → spec | Placement | Effect |
|---|---|---|---|---|
| **Block / TextObject** | grab handle | `textobject:` → `textObjectDropSpec` (`textobject:linkedRange:` → `textRangeMoveDropSpec`) | between-blocks | Move the block; `dropAdapter` decides drop-direct vs. wrap (e.g. into a fresh list / `exampleItem`) |
| **Inline Atom** | the atom itself, or a card's **drop button** (docked header / float chrome) | `atom-grab:` → `inTextAtomGrabSpec`; `footnote:` / `citation:` → `inlineAtomMoveSpec` (with an opt-in `createAtom` branch) | inline-cursor | Move the marker to a new inline caret (same editor only) — OR, for an **unanchored** footnote/citation card (no marker yet), CREATE the atom at the drop point carrying the card's existing id (citation reads the card's `\cite{…}` via `DropCtx.citations.commandFor`) |
| **Panel card** | a card's **drop button** in a panel / Omni (or its popped-out float's drop button) | `note:` `highlight:` `todo:` `archive:` `cutter-*:` `revision-*:` `report:` `report-request:` → `textObjectSideReanchorSpec`; `example:` → `blockMoveSpec` (all folded onto `CARD_REGISTRY[kind].dropSpec`) | paragraph-side / between-blocks | Re-anchor the card to the dropped-on paragraph; a selection-origin (Mode-B) note is CONVERTED to a clean Mode-A `paragraph` link (`clearModeB`, RC1) and the new link carries a self-healing paragraph-text snapshot; highlights are intrinsically Mode-B and skip the conversion. Move the example block |

(A fourth registry prefix, `stack-pull` → `stackPullDropSpec`, materializes a
Library stack entry into the doc — a cross-document feature outside the
single-doc editing surface, noted here only so the registry reads complete.)

**Drop-mode entry — the drop button.** A card enters drop-mode (to anchor /
re-anchor) via a neutral **drop button** (the double-chevron `DropChevrons`
glyph) shown per `CardMeta.droppable`, mounted on both the docked card header
and the popped-out card float's chrome. One shared mousedown→session helper,
**`beginCardDropGesture`** ([drop-mode/card-drop-gesture.ts](../../src/components/drop-mode/card-drop-gesture.ts)),
drives every drop-button surface (docked header, float chrome, and the
gutter-pin re-anchor, now folded onto the controller). The legacy **Shift-grab**
on a float header is **retired** (req-7), and the panel→gutter **native HTML5
drag-and-drop** was **removed** (the `panel-drops.ts` / `anchor-rebind.ts`
event-bridges + `Revisions/mime.ts` are deleted) — the drop button is now the
single entry. The block grab handle (above) and the in-text inline-atom grab
remain their own producers.

**Inline-Atom drag** is rooted in **`ATOM_REGISTRY`**
([atom-registry.ts](../../src/lib/tiptap/atom-registry.ts)) — the four drag-able
inline atoms: `footnote`, `citation`, `ref` (`labelRef`), `inline-math`. The
direct in-text gesture is the `InlineAtomGrab` extension
([inline-atom-grab.ts](../../src/lib/tiptap/inline-atom-grab.ts)): mousedown on an
atom + drag past threshold lifts a ghost; release moves the atom; a press
without drag falls through to the atom's own click (open/edit its Card). This is
the operational form of the Atom's "text-bound mobility"
([atoms.md → mobility](atoms.md#mobility-and-editing-rules)).

**Block drop adapters** ([drop-adapters.ts](../../src/text-objects/drop-adapters.ts))
— `topLevelDropAdapter`, `listItemDropAdapter`, `exampleItemDropAdapter`,
`blockIntoExpexDropAdapter` — decide, per source kind and target, whether a
dropped block lands directly, is wrapped, or is **rejected** (a `{ kind: "no-op" }`
DropAction — task 065). The three sub-object wrap adapters share one
wrap-validity gate, `DropTarget.canPlaceHere(kind)` (computed once in
`textObjectDropSpec.applyDrop` via `canDropDirectAt`), and no-op the drop when the
fabricated wrapper would be invalid at the TRUE immediate parent — killing the
cross-kind-into-foreign-container-gap duplicate-uuid corruption. The expex case
lets `paragraph` / `displayMath` / `graphicsBlock` land inside an `exampleItem`
(schema-driven via the drop target's `canDropDirect` / `canPlaceHere`).

---

## Family 3 — Keyboard

Two classes: **custom** keymaps Virgil defines, and **inherited** TipTap
defaults that survive the StarterKit configuration. The whole extension set is
assembled in [editor-extensions.ts](../../src/lib/editor-extensions.ts).

### Custom keymaps (Virgil-defined)

| Key | Action | Context | SSOT |
|---|---|---|---|
| `Mod-/` | open / toggle the actions menu at the live cursor or selection (the keyboard twin of clicking the gutter ⚡) | editor focused, no `NodeSelection` | window-level handler in [SelectionActionsMenu.tsx](../../src/components/SelectionActionsMenu.tsx) |
| `Tab` | insert a literal tab | plain prose (priority 50 — defers to list/expex `Tab`) | [tab-indent.ts](../../src/lib/tiptap/tab-indent.ts) |
| `Escape` | blur the editor | any | [tab-indent.ts](../../src/lib/tiptap/tab-indent.ts) |
| `Enter` | escape / create the next sibling `exampleBlock` | trailing/empty para in an example | [expex.ts](../../src/lib/tiptap/expex.ts) |
| `Tab` / `Shift-Tab` | nest a para into a sub-item / dissolve an empty example | inside an `exampleBlock` | [expex.ts](../../src/lib/tiptap/expex.ts) |
| `Enter` / `Tab` / `Shift-Tab` | split / sink / lift (lift promotes the outermost tier to a new block) | inside an `exampleItem` | [expex.ts](../../src/lib/tiptap/expex.ts) |
| `Tab` / `Shift-Tab` | move to the next / previous gloss cell (append a cell at the end) | inside a gloss row (`ExpexNumbering`) | [expex.ts](../../src/lib/tiptap/expex.ts) |
| `Enter` | exit the comment — insert a paragraph after it and move the caret there (a comment is one `%` source line, never multi-line) | caret inside a `latexComment` | [latex-comment.ts](../../src/lib/tiptap/latex-comment.ts) |
| `Delete` / `Backspace` | delete the whole `latexComment` block; `Backspace` at the start of an EMPTY comment dissolves it back to a plain paragraph | node-selected `latexComment` (delete) / empty-comment caret (dissolve) | [latex-comment.ts](../../src/lib/tiptap/latex-comment.ts) |

### Inherited TipTap defaults (enabled in StarterKit)

`StarterKit.configure({…})` ([editor-extensions.ts:1652](../../src/lib/editor-extensions.ts))
**disables** the block nodes (`heading`, `paragraph`, `bulletList`,
`orderedList`, `listItem`, `blockquote`, `codeBlock`) and replaces each with a
Virgil builder that `.extend()`s the base — so they keep the inherited keymaps
while adding UUID attrs / labels. The marks and history are **not** disabled, so
their default bindings survive:

| Key | Action | Source |
|---|---|---|
| `Mod-B` / `Mod-I` / `Mod-Shift-S` / `Mod-E` / `Mod-U` | Bold / Italic / Strike / Code / Underline | StarterKit marks |
| `Mod-Z` / `Mod-Shift-Z`, `Mod-Y` | Undo / Redo | StarterKit history |
| `Shift-Enter`, `Mod-Enter` | hard line break | StarterKit `HardBreak` |
| `Mod-Alt-1…6` | set heading level | `createHeadingWithLabel` (extends `Heading`) |
| `Mod-Shift-8` / `Mod-Shift-7` / `Mod-Shift-B` | toggle Bullet / Numbered list / Blockquote | the list/blockquote builders (extend the base) |
| `Mod-Shift-H` | toggle the highlight **mark** (multicolor text tint) | `Highlight` ([editor-extensions.ts:1742](../../src/lib/editor-extensions.ts)) |

> The `Mod-Shift-H` **mark** (a text-background tint) is distinct from the
> Family-1 **Highlight card** action (`H`), which creates a `HighlightCard`
> annotation. They share a name, not a mechanism.

### Keyboard-adjacent input rules

Not keymaps, but typed triggers that transform text (cite where relevant):

- **Smart quotes** — typing `"` becomes a curly quote ([smart-quotes.ts](../../src/lib/tiptap/smart-quotes.ts)).
- **`% ` → latexComment** — a line-leading `% ` converts a paragraph into an editable comment **block** (native inline content, `% ` non-editable prefix widget — no longer an atom); suppressed on card surfaces ([latex-comment.ts](../../src/lib/tiptap/latex-comment.ts)).
- **Slash popup** — typing `\` opens the command popup (`SlashPopupExtension`; see [SlashCommandPopup.tsx](../../src/components/SlashCommandPopup.tsx)). The command list ([commands.ts](../../src/lib/tiptap/commands.ts)) now routes EVERY command through the action registry — card/atom commands needing React (`\cite`, `\footnote`, `\ex`, `\ref`) **and** the structural-wrapper toggles (`\list`/`\itemize` → bullet-list, `\enumerate` → ordered-list, `\quote`/`\quotation` → blockquote — bug sweep #6; they need the live editor's `.chain()`, which the view-only stub lacks) via the bridge's `runAction(id, { surface: "slash" })`; pure-PM commands (`\chapter`…`\subsubsection`, `\tex`, `\title`/`\author`/`\date`) via `runViewOnlyAction`. The 5 wrapper names are a many-to-one **alias group** in `SLASH_NAME_TO_ACTION_ID` (their target format rows stay lightning-only) and no-op on a non-listable block via `selectionIsListable`. Commands insert **inline only** — `\ex`/`\footnote` insert nodes at the cursor; `\cite` soft-routes to Omni-View (surfaced only if not already covered), not the dedicated Citations panel. No slash command force-opens a panel.
- **Math popover (inline + display math click-to-edit)** — saves on **any** dismissal (Enter / click-away / blur / Escape); a **Cancel** button is the only revert path ([src/components/NodeEditPopover.tsx](../../src/components/NodeEditPopover.tsx)).
- **Ref popover (`\ref` create-mode dropdown)** — the label candidate list is arrow-key navigable; Enter commits the selection ([src/components/LabelRefPopover.tsx](../../src/components/LabelRefPopover.tsx)).
- **Typed-LaTeX atom rules** — typing `\cite{…}` / `\cite ` ([citation.ts](../../src/lib/tiptap/citation.ts)) and `\footnote{…}` ([footnote.ts](../../src/lib/tiptap/footnote.ts)) insert the inline atom synchronously in plugin-land, then register the CARD via the registry bridge (`runAction(id, { surface: "typed", … })`). The shared regexes live in leaf modules ([cite-commands.ts](../../src/lib/cite-commands.ts), [footnote-commands.ts](../../src/lib/footnote-commands.ts)) so the input rule + the registry row recognize the SAME vocabulary.
- **Markdown heading rules are deliberately OFF** — `createHeadingWithLabel` returns `addInputRules() { return [] }`, killing the `#`/`##`+space shortcut (the slash popup + BlockType menu own heading creation, and the level-0 rule had a real bug).

---

## Family 4 — Decorations

Decorations are ProseMirror overlays that render styling/widgets **without**
changing the document. There are exactly **seven** `DecorationSet` plugins (an
exhaustive sweep of `Decoration.*` / `DecorationSet` across `src/` finds no
others — the `code-band.ts` set is CodeMirror, not ProseMirror; marginalia
markers and the Mode-B `linkedAnchor` *text-range* tint are *not* decorations;
see below):

| Decoration | Renders | Kind | SSOT | Keystroke-sanctity |
|---|---|---|---|---|
| **UUID attrs** | `data-uuid` + `data-text-object-kind` on each anchorable block's DOM | node | [uuid-attr.ts](../../src/lib/tiptap/uuid-attr.ts) | Compliant — forward-maps, then adds/removes only for the `DocStructureBus` diff's added/removed blocks |
| **Anchor hover/selection** | the four `data-card-selected` / `data-card-hovered` / `data-paragraph-kind` / `data-margin-side` attrs on in-editor NODE/ATOM anchor targets (paragraph / Mode-A block + footnote/citation atom) | node | [anchor-highlight-deco.ts](../../src/lib/tiptap/anchor-highlight-deco.ts) (driven by `useAnchorHighlightReconciler`) | Compliant — set rebuilds ONLY on a hover/selection meta tx; every other tx just `map(tr.mapping, tr.doc)`s the existing set (the meta tx is `!tr.docChanged`, so the bus stays silent) |
| **LaTeX command** | grey-monospace `.latex-cmd` on in-progress `\command{…}` spans | inline | [latex-command.ts](../../src/lib/tiptap/latex-command.ts) | Compliant — `map(tr.mapping)` then rebuild only when a changed region holds a `\` |
| **Pagination chip** | the `\pgmark{N}` label + page-break rule | inline + widget | [pgmark.ts](../../src/lib/tiptap/pgmark.ts) | Compliant — `map` + changed-region `\pgmark` scan |
| **Section fold** | `.section-folded` (hides blocks under a collapsed heading) | node | [section-folding.ts](../../src/lib/section-folding.ts) | Rebuilds from a **top-level** `doc.forEach()` when a fold is active; gated to `DecorationSet.empty` when nothing is folded (see note) |
| **Focus view** | `.focus-hidden` (hides out-of-band blocks while a focus band CONFINES the viewer) | node | [focus-view.ts](../../src/lib/focus-view.ts) | Compliant — only a **LOCKED** band confines (the `bandConfines` = `active && locked` gate, CHIP A); an unlocked selection-band bails to `DecorationSet.empty` and hides nothing. Rebuilds only on a band-change meta tx or a top-level block add/remove/boundary-replace; otherwise carries the cached set forward via `DecorationSet.map(tr.mapping)`, so a plain keystroke never rebuilds |
| **Transient highlight** | a partial-block text band (search hit, diagnostics error range, quoted revision) painted as a `Decoration.inline` — a view-only signal that is NEVER a mark/attr (task 120 "transient state is never document content") | inline | [transient-highlight.ts](../../src/lib/tiptap/transient-highlight.ts) (`setTransientHighlights`/`clearTransientHighlights`) | Compliant — rebuilds ONLY on its own meta tx (send the complete desired set per frame; `[]` clears); every other tx just `map(tr.mapping, tr.doc)`s the set, and the meta tx is `!tr.docChanged` so no history/autosave/bus |

**Decoration vs. mark — a load-bearing nuance.** `latexCommand` is *both*: the
`LatexCommandMark` ([latex-command.ts](../../src/lib/tiptap/latex-command.ts))
round-trips committed `\commands` to the `.tex` and styles them via its
`renderHTML` class, while the *decoration* in the same extension styles
*live-typed* commands that don't yet carry the mark. VIRGIL.md's "kept verbatim
under the `latexCommand` mark" and this decoration are two halves of one
feature.

**Not decorations** (so they're not in the table, despite looking like overlays):

- **Marginalia markers** ([Marginalia.tsx](../../src/components/Marginalia.tsx)) — React gutter icons positioned by CSS, driven by the card stores.
- **The `Highlight` mark + the Mode-B `linkedAnchor` text-range tint** — CSS on the `Highlight` mark and (for the Mode-B range only) a raw `setAttribute` of the four hover/selection attrs onto the `.linked-anchor` mark span, reconciled by the link layer ([src/links/](../../src/links)); no ProseMirror decoration. (The in-editor NODE/ATOM anchor hover/selection IS now a decoration — see the `Anchor hover/selection` row above; `useAnchorHighlightReconciler` keeps only the Mode-B text-range and the React panel-card `[data-card-key]` paint on raw `setAttribute`.)
- **Drop-mode indicators** ([drop-mode/Indicator.tsx](../../src/components/drop-mode/Indicator.tsx)) — React, not PM decorations (Family 2).

> **Note (follow-up).** Section fold is the one decoration that doesn't follow
> the canonical `DecorationSet.map(tr.mapping)` forward-map pattern — its
> `decorations(state)` re-derives from a top-level `doc.forEach()` on each
> recompute while a fold is held. The walk is top-level-only (not full-depth)
> and short-circuits to `DecorationSet.empty` when nothing is folded, so the
> per-keystroke cost is bounded by the top-level block count, but it's a soft
> deviation from the [keystroke-sanctity](../architecture/VIRGIL.md#code-organization)
> rule worth tightening.

---

## Rules for skills

- **You almost never drive these actions.** A skill writes through the
  [apply_response contract](structure.md#the-write-path), not by simulating a
  keystroke or a menu click. This doc is for *recognizing* what the user did and
  *mirroring* its effect on the `.tex` / sidecars.
- **The action → Card mapping is the bridge.** A user's `F` / `C` / `N` / `T` /
  `R` (and the AI-flag on a note/todo/comment) is what becomes a **Task** in
  `ai-requests.json` ([VIRGIL.md → Cowork pattern](../architecture/VIRGIL.md#cowork-pattern)).
  When you drain a Task, the originating action tells you the kind to produce —
  route via [cards.md](cards.md).
- **Atoms move with text.** An inline atom dragged via `InlineAtomGrab` changes
  its `.tex` position but not its identity (the `\vfid`/`\vcid` marker travels
  with it — [identity.md](identity.md)); a footnote/citation Card's Atom link
  survives the move.
- **Don't hand-fold or hand-decorate.** Folds, UUID attrs, and lint state are
  app-managed view state, never paper content — leave them to the editor
  ([gardening.md](gardening.md)).
