/**
 * ACTION_REGISTRY — the single source of truth for every editing
 * "action / tool" Virgil exposes across its FOUR action surfaces.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * STATUS (CHIP 7a — REGISTRY IS THE COMPLETE SSOT). EVERY `ActionId` now has a
 * row — the card vocabulary (CHIP 2/3, rendered by the live menus via
 * `cardActionRows`), the slash/typed citation + footnote (CHIP 4), the heading /
 * tex / example / block-atom / format grid slices (CHIP 5/6), and — landing in
 * THIS chip — the final two slices: `ref` (the `\ref` cross-reference, slash +
 * the NEW lightning 'Cross-ref' cell, via the `openRefPopover` seam) and the
 * `title`/`author`/`date` title fields (pure-PM `titleFieldRun`, SLASH-ONLY by
 * design — a doc-top singleton has no menu twin). The coverage assertion asserts
 * **ZERO pending ids** (covered == `EXPECTED_ACTION_IDS`, both directions) — a
 * new union member without a row trips CI. Wired via a vitest
 * (`action-coverage-assertion.test.ts`).
 * ──────────────────────────────────────────────────────────────────────────
 *
 * # Why this registry exists
 *
 * Today the "vocabulary" of editing actions (highlight, footnote, cite,
 * `\section`, bold, …) is scattered across FOUR independent surfaces, each
 * with its own list, its own dispatch, and — critically — its own side of
 * the React-land / ProseMirror-plugin-land boundary:
 *
 *   1. **Grab-bar menu** — `DragHandleMenu` / `MENU_ENTRIES`
 *      ([src/components/DragHandleMenu.tsx]). React-land. The
 *      `DragHandleAction` union + per-kind `actions` filter from
 *      `TEXT_OBJECT_REGISTRY`.
 *   2. **Lightning-bolt menu** — `ActionsMenuPanel`
 *      ([src/components/ActionsMenuPanel.tsx]). React-land. Re-uses
 *      `MENU_ENTRIES` for its action list and adds a formatting grid
 *      (bold/italic/…, lists, blockquote, color, math, example, tex,
 *      figure, image).
 *   3. **Slash commands** — `VIRGIL_COMMANDS` / `VIRGIL_COMMAND_NAMES`
 *      ([src/lib/tiptap/commands.ts]). A ProseMirror plugin running with an
 *      `EditorView` ONLY — **no React context**. Two routes, BOTH off the
 *      registry: the card/atom commands that need React (`\cite` 4a-ii,
 *      `\footnote` 4b, `\ex` 5c, `\ref` 7a) reach their `run()` via the typed
 *      `EditorActionsHandle` bridge (`runAction(id, seed)`); the pure-PM commands
 *      (`\chapter`…`\subsubsection` 5a, `\tex` 5b, `\title`/`\author`/`\date` 7a)
 *      take the view-only path (`runViewOnlyAction`). NO command rides a `window`
 *      CustomEvent anymore — they are all retired through CHIP 7a.
 *   4. **Typed-LaTeX input rules** — `\cite{…}` / `\cite ` in
 *      ([src/lib/tiptap/citation.ts] ~line 125) and `\footnote{…}` in
 *      ([src/lib/tiptap/footnote.ts] ~line 96). Also ProseMirror plugins; same
 *      no-React-context constraint. Both now register their CARD via the bridge
 *      (the atom is still inserted synchronously in plugin-land).
 *
 * The same logical action (e.g. "make a footnote") is implemented up to four
 * times with subtly different behavior and four different code paths. This
 * registry is the SSOT that the four surfaces will eventually read off of —
 * exactly the way `TEXT_OBJECT_REGISTRY` and `CARD_REGISTRY` already drive
 * their parallel implementations from one shape.
 *
 * # The React-land vs ProseMirror-plugin-land boundary (the crux)
 *
 * An `ActionSpec.run()` lives in **React-land** — it closes over the
 * `cardCreation` / `cardLifecycle` APIs, panel state, confirm dialogs, etc.
 * Surfaces 1 & 2 are React components, so they call `run()` directly.
 *
 * Surfaces 3 & 4 are ProseMirror plugins with only an `EditorView`. They
 * **cannot** call React-land `cardCreation`. The architecture (wired for
 * `\cite` in CHIP 4a-ii and `\footnote` in CHIP 4b; the remaining PM commands
 * still ride the legacy CustomEvents):
 *
 *   - The React tree publishes ONE imperative handle, `EditorActionsHandle`,
 *     into a ref (`editorActionsRef`) — the PM→React bridge.
 *   - A slash command / input rule, instead of `window.dispatchEvent(new
 *     CustomEvent("virgil-footnote-input"))`, calls
 *     `getEditorActionsHandle()?.runAction("footnote", { surface: "slash" })`.
 *   - The bridge resolves the spec, **supplies the React APIs**
 *     (`cardCreation` / `cardLifecycle`) into the `ActionContext`, and invokes
 *     `spec.run(ctx)` in React-land.
 *
 * So `ActionContext.cardCreation` / `.cardLifecycle` are populated DIRECTLY by
 * the React caller for surfaces 1 & 2, and BY THE BRIDGE for surfaces 3 & 4.
 * The plugin never touches React; the bridge is the one seam.
 *
 * `EditorActionsHandle` is the typed replacement for the scattered
 * `window` CustomEvents listed above (and the two citation listeners in
 * `command-input.ts` / `citations-host.tsx`). See its JSDoc.
 *
 * # Shape conventions
 *
 * Mirrors the established Virgil registries:
 *   - `TEXT_OBJECT_REGISTRY` ([src/text-objects/text-object-registry.ts]) —
 *     the per-kind `actions` arrays + `applies`-style gating.
 *   - `CARD_REGISTRY` ([src/cards/card-registry.tsx]) — the cleanest
 *     declarative-row pattern with a dev coverage assertion.
 *   - `ATOM_REGISTRY` ([src/lib/tiptap/atom-registry.ts]) — detection
 *     metadata only.
 *   - the drop-spec registry ([src/components/drop-mode/registry.ts]) —
 *     prefix lookup.
 *
 * React-LIGHT: the React API types are imported **type-only** (erased at
 * compile time), so populating a `run()` later does not pull React into
 * non-DOM consumers. The one concrete React reference is `icon?:
 * React.ReactNode`, matching `MenuEntry.icon`; that type is erased too.
 */

import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
// VALUE import: `exampleRun` (CHIP 5c) parks the caret inside the freshly
// inserted example's first paragraph via `TextSelection.create`. A plain PM
// state primitive — no React/DOM — so the value import is free for every
// consumer of this registry.
import { TextSelection } from "@tiptap/pm/state";
// Type-only (erased): the PM slice/fragment shapes `extractInlineFromSlice`
// (the CHIP 5c example-wrap harvest, SSOT for the grid + slash + the DA-1 test)
// walks. No runtime — erased at compile time.
import type { Slice, Fragment, Node as PMNode } from "@tiptap/pm/model";
// VALUE import: the canonical collision-free short-id minter. `texRun` (the
// raw-LaTeX block creator) mints a fresh `uuid` for the new `texBlock` the SAME
// way every other node creator does (slash `\cite`/`\title`, the grid's
// `freshTexBlockAttrs`). A plain string-id leaf — no React/DOM/TipTap — so the
// value import is free for every consumer of this registry.
import { generateShortId } from "@/lib/uuid";
// VALUE import: the ONE container-aware block-atom insert helper (CHIP 6a, DA-2).
// `figureRun` / `graphicsRun` insert their block through `smartInsertBlock` so
// the grid cell and any future figure/graphics FILE-DROP path converge on one
// creator. Pure ProseMirror (operates on `editor.view`) — no React/DOM — so the
// value import is free for every consumer of this registry.
import { smartInsertBlock } from "@/lib/tiptap/smart-insert";
// VALUE imports: the figure/graphics fresh-attrs builders + the figure raw
// synthesizer. `figureRun` / `graphicsRun` seed the new block with the SAME stub
// attrs the former `insertFigureBlock` / `insertGraphicsBlock` did (so the empty
// `\includegraphics` shape is byte-identical), and `figureRun` synthesizes the
// popover's `raw` seed from the new figure's attrs via `synthesizeFigureRaw`.
// Imported from `figure-attrs.ts` (the React-free leaf, CHIP 6a) — NOT from
// `figure-block.ts` / `graphics-block.ts`, whose React NodeView + `@/lib/storage`
// graph must NOT be pulled into this registry (it's imported in node-env /
// jsdom vitests without the storage mock).
import {
  freshFigureBlockAttrs,
  freshGraphicsBlockAttrs,
  synthesizeFigureRaw,
} from "@/lib/tiptap/figure-attrs";
// Type-only (erased at compile time): the React-land APIs an action's
// `run()` reaches for. Importing the TYPES does NOT instantiate them and
// does NOT pull React into this module's runtime.
import type { CardCreationApi } from "@/components/editor-layout/card-actions/card-creation";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
// Type-only (erased): the panel-id + prefs shape the citation soft-route
// inspects to decide whether to surface OMNI. Importing the TYPE pulls no
// prefs runtime into this module.
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
// The existing resolved-ref union the grab-bar dispatcher already speaks.
// `DragHandleRef = TextObjectRef | SelectionRef`. We extend it below with a
// `CursorRef` for the collapsed-caret (slash / typed) case.
import type { DragHandleRef } from "@/components/editor-layout/card-actions/drag-handle-actions";
// VALUE import (not type-only): the assertion reconciles the live slash
// vocabulary against the action ids. `commands.ts` is a plain TS module with
// no React/DOM at import — pulling it in does not bloat any consumer that
// imports the registry types. (Tree-shaking drops it for type-only importers.)
import { VIRGIL_COMMAND_NAMES } from "@/lib/tiptap/commands";
// The grab-bar action union — what `ctx.dispatch` and `MENU_ENTRIES` speak.
// `CardActionId` is its registry-side twin (same 11 string literals); the
// coverage assertion pins them equal so they cannot drift.
import type { DragHandleAction } from "@/components/DragHandleMenu";

// ── Card-row presentation (CHIP 3: the registry now OWNS this) ──
// The 11 card rows take their presentation (label / letter / icon /
// separator / destructive) from `CARD_ACTION_PRESENTATION`. CHIP 2 derived
// these FROM `MENU_ENTRIES` (the menu was the SSOT, the registry mirrored
// it); CHIP 3 INVERTS that — the icon JSX now lives in `action-icons.tsx`,
// this registry is the SSOT, and the two live menus render off these rows.
// `MENU_ENTRIES` is deleted. The presentation module carries React JSX at
// runtime, so the registry carries React for its row consumers — acceptable:
// the only runtime consumers are the React menu surfaces. The assertion path
// stays importable in node-env vitest; `action-icons` resolves to the icon
// barrel, which the menu tests already pull cleanly.
import {
  CARD_ACTION_PRESENTATION,
  CARD_ACTION_ORDER,
} from "./action-icons";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
} from "@/text-objects/text-object-registry";
import {
  getSectionRangeByUuid,
  getHeadingLineRangeByUuid,
} from "@/lib/section-range";
// VALUE import: the typed-LaTeX citation input-rule patterns. The PARSER, the
// `citation.ts` input rule, AND this registry row all reference the SAME
// regexes from `cite-commands` so the four surfaces can never recognize a
// different cite vocabulary. `cite-commands` is a plain regex module (no
// React/DOM), so importing the values here is free for every consumer.
import { CITE_RE_FULL, CITE_RE_BARE } from "@/lib/cite-commands";
// VALUE import: the typed-LaTeX footnote trigger pattern — the footnote twin of
// `CITE_RE_FULL`. The `footnote.ts` input rule AND this registry row reference
// the SAME regex from `footnote-commands` (a plain regex leaf, no React/DOM/
// TipTap) so the typed surface and the registry can never recognize a different
// footnote vocabulary. Re-exported below as `FOOTNOTE_INPUT_RULE_PATTERN`.
import { FOOTNOTE_RE_FULL as FOOTNOTE_INPUT_RULE_PATTERN } from "@/lib/footnote-commands";
// VALUE import: the canonical float-key builder. The citation soft-route
// focuses the new card's library-picker input via the SAME key the card
// itself stamps — `cardPopKey("citation", id)` === `buildFloatKey({domain:
// "card", kind: "citation", id})` (see `panel-registry.cardPopKey`). We import
// the lower-level `buildFloatKey` (a pure key-string module, no React) rather
// than `cardPopKey` to keep this registry importable in node-env vitest
// without pulling the `panel-registry` → `card-registry` (React JSX) graph in.
import { buildFloatKey } from "@/floats/float-key";

// ---------------------------------------------------------------------------
// ActionId — the closed vocabulary of every editing action.
//
// Grouped by `category`. The union is the master list; a row in
// `VIRGIL_ACTION_REGISTRY` declares which `surfaces` each id appears on. The
// ids are chosen to cover, between them, every entry across all four
// surfaces (see `assertActionCoverage`).
// ---------------------------------------------------------------------------

/** Card-producing actions — the 11 entries of `MENU_ENTRIES`
 *  (`DragHandleAction`). Each lands a card via `cardCreation.create*`. */
export type CardActionId =
  | "highlight"
  | "note"
  | "footnote"
  | "citation"
  | "todo"
  | "suggest-edit" // Revisions: drafts a revision-comment card
  | "cutter" // Cutter: drafts a cutter-comment card ("Suggest cut")
  | "report" // files a report-REQUEST from the quick gesture
  | "duplicate"
  | "archive"
  | "delete";

/** Inline-Atom actions. Only `ref` (`\ref{}`) is an action surface today —
 *  it is created from the `\ref` slash command. The other atoms (footnote /
 *  citation / inline-math) are spelled under their own categories: footnote
 *  and citation are CARD actions (they own a Card); inline-math is a BLOCK
 *  action (a format/insert). See `ATOM_REGISTRY` for the detection side. */
export type AtomActionId = "ref";

/** Block / structural insert-or-convert tools.
 *
 *  HEADING ID SCHEME (documented choice): headings are spelled as FOUR
 *  discrete ids — `heading-chapter` / `heading-section` / `heading-subsection`
 *  / `heading-subsubsection` — NOT one parametric `heading` id with a `level`
 *  payload. Rationale: the slash surface IS four distinct command NAMES
 *  (`\chapter` `\section` `\subsection` `\subsubsection`, each
 *  `setBlockType(heading, { level })`), the lightning surface's BlockType
 *  dropdown lists them as four discrete choices, and the keyboard layer (if
 *  any) would bind them separately. One id per command name keeps the
 *  `slashName` / `keybinding` fields scalar (no payload threading) and lets
 *  `assertActionCoverage` map each `VIRGIL_COMMAND_NAMES` entry to exactly one
 *  row. The `level` is recoverable from the id by a tiny lookup if a consumer
 *  needs it. A downstream chip that prefers a parametric `heading` + payload
 *  should flag it at merge — see the deliver note. */
export type BlockActionId =
  // Headings (one id per `\`-command name — see scheme note above).
  | "heading-chapter" // \chapter   → level 1
  | "heading-section" // \section   → level 2
  | "heading-subsection" // \subsection → level 3
  | "heading-subsubsection" // \subsubsection → level 4
  // Structural / atom-block inserts.
  | "example" // \ex / "ex" / the stray insertExampleAtCursor MenuBar control
  | "tex" // \tex raw-LaTeX block
  | "figure" // figure block
  | "graphics" // \includegraphics image block
  | "inline-math" // $x$ wrap/insert
  | "display-math"; // $$…$$ wrap/insert

/** Title-field tools (`\title` / `\author` / `\date` slash commands; the
 *  `titleField` node). Singletons hoisted to the doc top. */
export type TitleActionId = "title" | "author" | "date";

/** Formatting marks + list/quote toggles (the lightning-bolt formatting
 *  grid). `text-color` opens the color popover; the rest are TipTap mark /
 *  wrapping toggles with StarterKit keybindings (Mod-b, …). */
export type FormatActionId =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "bullet-list"
  | "ordered-list"
  | "blockquote"
  | "text-color";

/** The closed union of every action id. */
export type ActionId =
  | CardActionId
  | AtomActionId
  | BlockActionId
  | TitleActionId
  | FormatActionId;

/** The `ActionSpec.category` discriminant. */
export type ActionCategory = "card" | "atom" | "block" | "format";

/**
 * The DECLARATIVE selection-mode taxonomy (CHIP 7b, DA-5). Says how an action
 * relates to a live TEXT RANGE — the ONE place cursor-mode greying is decided,
 * replacing the ad-hoc per-action range checks scattered across `cardApplies`
 * (highlight) + the placeholder `formatApplies`. `applies()` routes EVERY row
 * through `applySelectionMode` so the rule lives once.
 *
 *   - `"required"` — the action NEEDS a non-empty range to act on, so it greys
 *     out at a collapsed caret / cursor mode. The action WRAPS its selection
 *     and has nothing to wrap when empty. Only `highlight` (it wraps the live
 *     range in a `linkedAnchor` mark — a caret has nothing to wrap). Mirrors the
 *     existing `ActionsMenuPanel` `mode === "cursor"` highlight grey-out + the
 *     `cardApplies` `refHasLiveRange` check, now declared rather than special-cased.
 *
 *   - `"optional"` — the action can USE a selection but does NOT need one: at a
 *     collapsed caret it inserts a placeholder / empty shell instead. NEVER greys
 *     on range. The footnote/citation atoms (collapse-and-insert at the caret),
 *     the math WRAP cells (insert a placeholder `latex` on empty — `mathRun`),
 *     example/tex (wrap-if-selection-else-insert), figure/graphics/ref (insert at
 *     the caret), and every card LIFECYCLE action (they act on a persistent node,
 *     not a transient range). This is the default for a row that omits `selection`.
 *
 *   - `"ignored"` — the action is a stateful TOGGLE / block conversion that is
 *     fully valid at a collapsed caret: it flips the pending/stored mark, wraps
 *     the current block, or converts the block type. NEVER greys on range. The
 *     mark toggles (bold/italic/strike/code — they toggle the STORED mark at a
 *     caret), list/blockquote wrappers, headings, and text-color. This is the
 *     real `formatApplies`: a mark toggle is `"ok"` at a collapsed caret, exactly
 *     matching how the grid renders the format cells today (always enabled).
 *
 * `applySelectionMode` reads `refHasLiveRange(ctx.ref)` (false for a collapsed
 * caret / `cursor` ref / empty selection): a `"required"` action with no live
 * range → `"disabled"`; `"optional"` / `"ignored"` → unaffected by range.
 */
export type ActionSelectionMode = "required" | "optional" | "ignored";

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * The five invocation surfaces (4 menus/inputs + the keyboard layer). Note
 * `keyboard` is a fifth invocation path, distinct from the four *menus*: the
 * formatting marks (bold/…) are also reachable via global keybindings, and
 * the grab-bar/lightning menus expose single-letter shortcuts WHILE OPEN
 * (those are menu-scoped, not global — they ride the `grab`/`lightning`
 * surface, not `keyboard`).
 */
export type ActionSurface = "grab" | "lightning" | "slash" | "typed" | "keyboard";

/**
 * Per-action surface membership. A `true` flag means "this id has a row on
 * that surface." Optional/absent ⇒ false. `assertActionCoverage` cross-checks
 * these flags against the live source lists (`MENU_ENTRIES`,
 * `VIRGIL_COMMAND_NAMES`, the input-rule patterns) so a flag can't drift from
 * the surface it claims.
 */
export interface ActionSurfaces {
  /** Grab-bar menu (`DragHandleMenu` / `MENU_ENTRIES`). */
  grab?: boolean;
  /** Lightning-bolt menu (`ActionsMenuPanel`: action list + formatting grid). */
  lightning?: boolean;
  /** Slash command (`VIRGIL_COMMANDS`). `slashName` names the command. */
  slash?: boolean;
  /** Typed-LaTeX input rule (`\cite{}` / `\footnote{}`). `inputRulePattern`
   *  names the trigger. */
  typed?: boolean;
  /** Reachable via a global keybinding (`keybinding`). */
  keyboard?: boolean;
}

// ---------------------------------------------------------------------------
// Refs & position — the "what does this act on" inputs
// ---------------------------------------------------------------------------

/**
 * The collapsed-caret reference. Surfaces 3 & 4 (slash / typed) fire with NO
 * selection — the user typed `\cite ` or `/footnote` and there is just a
 * cursor. Neither a `TextObjectRef` (a persistent node) nor a `SelectionRef`
 * (a non-empty range) fits, so we add this third ref variant.
 *
 * `pos` is the collapsed caret position. `paragraphId` is the uuid of the
 * containing paragraph (for Mode-A anchoring), best-effort — empty string if
 * the caret isn't inside an anchorable block. This mirrors the
 * gesture-vs-textobject split in `src/text-objects/types.ts`: like
 * `SelectionRef`, a `CursorRef` is gesture-input, NOT a TextObject.
 */
export interface CursorRef {
  kind: "cursor";
  pos: number;
  /** Containing-paragraph uuid, or "" if the caret isn't in an anchorable
   *  block. */
  paragraphId: string;
}

/**
 * The full resolved-ref union an action can act on. Extends the existing
 * grab-bar union (`DragHandleRef = TextObjectRef | SelectionRef`) with the
 * collapsed-caret `CursorRef`. Reusing `DragHandleRef` keeps surfaces 1 & 2
 * byte-compatible with the dispatcher they already call.
 */
export type ActionRef = DragHandleRef | CursorRef;

/**
 * Where an action's insertion/anchor lands relative to the ref.
 *
 *   - `"cursor"` — at the collapsed caret (the slash/typed default; also the
 *     lightning "insert at cursor" path).
 *   - `"passage-end"` — at the END of the resolved passage. The grab-bar
 *     footnote/citation actions collapse the selection to `range.to` before
 *     inserting the marker; this names that policy declaratively.
 */
export type ActionPosition = "cursor" | "passage-end";

// ---------------------------------------------------------------------------
// ActionContext — the bundle passed to applies() / resolveScope() / run()
// ---------------------------------------------------------------------------

/**
 * Everything an action needs to decide applicability, resolve its scope, and
 * run. Built per-invocation by the calling surface (or, for surfaces 3 & 4,
 * by the bridge — which is the ONLY supplier of `cardCreation` /
 * `cardLifecycle` for those surfaces).
 */
export interface ActionContext {
  /** The live editor (React-land surfaces hold the `Editor`; the bridge has
   *  it too). Present whenever a React API is available. */
  editor: Editor;
  /** The live PM view. Always present — surfaces 3 & 4 have ONLY this (no
   *  `editor`-derived React state), so view-only code paths must be reachable
   *  from `view` alone. (For a TipTap editor, `view === editor.view`; both
   *  are carried so a plugin-land caller that only has the view can populate
   *  the context without reaching for the React `Editor` wrapper.) */
  view: EditorView;
  /** What the action acts on: a TextObject, a live selection, or a collapsed
   *  caret (slash / typed). */
  ref: ActionRef;
  /** Which surface invoked the action. Lets a `run()` branch policy by
   *  origin (e.g. slash-created cards do not hard-open their panel — see
   *  `command-input.ts`). */
  surface: ActionSurface;
  /**
   * Whether THIS user may currently edit the main text — the UNIFORM
   * collab-read-only gate (CHIP 7b, the user-APPROVED new behavior).
   *
   * AUTHORITATIVE SIGNAL: the live editor's `editable` flag. Virgil mounts the
   * main editor `editable: true` ALWAYS and flips it via
   * `editorInstance.setEditable(collab.canEditMainText)` ([EditorLayout.tsx:946])
   * whenever collab is enabled and the partner holds the pen — so
   * `editor.isEditable` is the in-editor mirror of `collab.canEditMainText`
   * (`!sidecar.enabled || iHavePen`, [useCollab.ts:618], the SSOT for "can this
   * user edit the .tex"). The same `editableRef` drives the `readOnlyEnforcer`
   * plugin's `filterTransaction` ([editor-extensions.ts:1839]), which is what
   * actually rejects doc-mutating transactions in collaborator read-only mode.
   *
   * Every surface supplies this from that ONE signal:
   *   - grab / lightning (React) — read `editor.isEditable` when building the
   *     ctx (DragHandleMenu / ActionsMenuPanel);
   *   - slash / typed (PM)        — the bridge / `runViewOnlyAction` read
   *     `ed.isEditable`.
   *
   * `applies()` returns `"disabled"` for EVERY action (create + lifecycle +
   * format) when this is `false`, and the shared `run()` paths guard no-op.
   *
   * **`undefined` ⇒ editable** — the no-over-gating default. A caller that
   * doesn't supply its collab state, or a NON-collab doc (the common case),
   * leaves this unset and NOTHING is gated, exactly as today. Only an explicit
   * `false` (collab on AND partner holds the pen) gates.
   */
  canEdit?: boolean;
  /** Where the insertion/anchor should land. Defaults are surface-specific
   *  (slash/typed ⇒ "cursor"; grab footnote/citation ⇒ "passage-end"). */
  position?: ActionPosition;
  /**
   * React-land card creation API. **Supplied directly by surfaces 1 & 2**
   * (they are React components that already hold it) and **by the bridge for
   * surfaces 3 & 4** (a slash command / input rule cannot reach it). Absent
   * only on a pure view-only path that needs no card creation. Type-only
   * import — this module never instantiates it.
   */
  cardCreation?: CardCreationApi;
  /**
   * React-land per-CardKind clone/delete API. Same supply rule as
   * `cardCreation`: direct for 1 & 2, via the bridge for 3 & 4. Used by the
   * lifecycle actions (duplicate / archive / delete) to fork/remove sidecar
   * entries for atoms/anchors in the captured passage.
   */
  cardLifecycle?: CardLifecycleApi;
  /**
   * Optional free-form seed payload the bridge threads from the plugin-land
   * caller (e.g. a `\cite`'s pre-allocated `citationId`, or a partial command
   * string). Kept loose on purpose — the typed slots above cover the common
   * inputs; this is the escape hatch for kind-specific seeds without widening
   * the context for every action.
   */
  payload?: Record<string, unknown>;
  /**
   * The legacy grab-bar dispatcher (`useDragHandleActions().dispatch`).
   *
   * ── CHIP 2 (delegation seam) ── the 11 card-action `run()` bodies are
   * thin wrappers that FORWARD to this existing React-hook dispatcher
   * rather than re-implementing the dispatch cases inline — so the registry
   * becomes the source of truth for the action *vocabulary* (ids / labels /
   * letters / surfaces / applicability) while live *behavior* stays
   * byte-identical to today. Surfaces 1 & 2 (grab / lightning) already hold
   * this value (it's the same `dispatch` the `DragHandleMenuContext`
   * exposes), so they supply it directly; the bridge would supply it for
   * surfaces 3 & 4. Typed as the grab-bar signature on purpose — only
   * `DragHandleRef`-shaped refs (`TextObjectRef | SelectionRef`) route
   * through it. A `run()` that receives a `CursorRef` (slash / typed) cannot
   * forward here and must take its own path; the card rows never do (they
   * are grab/lightning-only this chip).
   *
   * REMOVED by a LATER chip: once each action's dispatch case is relocated
   * INTO its `run()` body, this forwarding slot disappears and `run()`
   * closes over `cardCreation` / `cardLifecycle` directly. Until then it is
   * the one seam that lets the registry delegate without copying logic.
   */
  dispatch?: (action: DragHandleAction, ref: DragHandleRef) => void;
  /**
   * Panel-routing wiring the citation soft-route needs (CHIP 4a-ii). The
   * slash/typed `citation.run` registers the card via `cardCreation` and then
   * SOFT-ROUTES it into OMNI — surfacing the omni view ONLY when the citations
   * side is currently collapsed/blank, never clobbering a panel the user has
   * covering omni (backlog #2). That decision reads `prefs` (which side the
   * citations panel docks + what's active there) and toggles it via
   * `setActiveLeft`/`setActiveRight`; `focusCard` drops the caret into the new
   * card's library-picker input once it mounts. Supplied by EditorPane (which
   * holds prefs + the setters) through the bridge for surfaces 3 & 4. Absent
   * for grab/lightning (they delegate to `ctx.dispatch`, which owns its own
   * `ensureOmniActiveForPanel`) and on any pure view-only path.
   */
  /**
   * Open the figure/graphics SOURCE popover for a freshly-inserted block (CHIP
   * 6a). `figureRun` / `graphicsRun` insert the block via `smartInsertBlock`,
   * then call THIS to pop the `FigurePopover` so the user can fill in the empty
   * `\includegraphics` path immediately — REPLACING the insert-time
   * `virgil-figure-click` CustomEvent (the event bus hack). It is the React
   * twin of how the EDIT-existing-figure path still rides `virgil-figure-click`
   * (the dual-use event's edit half stays; only the insert-time emit is retired).
   *
   * Supplied by `ActionsMenuPanel` (the grid surface) — which threads
   * EditorLayout's `setActiveFigure` down — and absent on any pure view-only
   * path (the insert still lands; only the popover-pop is skipped). The shape
   * mirrors EditorLayout's `activeFigure` state EXACTLY so the popover renders
   * identically whether opened via this callback (insert) or the
   * `virgil-figure-click` listener (edit).
   */
  openFigurePopover?: (figure: {
    kind: string;
    raw: string;
    pos: number;
    rect: DOMRect;
  }) => void;
  /**
   * Open the text-color popover (CHIP 6b). The `text-color` format row is the
   * one format action that is NOT a fire-and-forget `editor.chain()` toggle —
   * it pops the `SelectionColorPopover` so the user can pick a color (the swatch
   * palette + native picker). Its `run()` calls THIS instead of mutating the
   * doc directly, threaded down from `ActionsMenuPanel` (which owns the popover
   * state + the selection-stash). The `anchorRect` is the color cell's bounding
   * rect (the popover anchors to it). Supplied only on the lightning/grid
   * surface; absent on any view-only path (the row then no-ops — there is no
   * popover to open without React state).
   */
  openColorPopover?: (anchorRect: DOMRect) => void;
  /**
   * Open the `LabelRef` create-mode popover at the caret (CHIP 7a). The `ref`
   * (`\ref{}` cross-reference) action is NOT a fire-and-forget insert — the
   * popover IS the creator: it lists every `\label{…}` site in the doc and
   * `useRefActions.handleInsertRef` lands the chosen `labelRef` atom at the
   * cursor when the user picks/types a label. So `refRun()` calls THIS rather
   * than mutating the doc directly.
   *
   * Supplied by EditorPane's bridge handle (for the slash surface) and by
   * `ActionsMenuPanel` (for the new lightning `\ref` cell) — both compute the
   * live caret rect and route to EditorLayout's `LabelRefPopover` create mode
   * (`setActiveRefLabel("")` + `setActiveRefRect(rect)`), REPLACING the retired
   * `virgil-ref-create` CustomEvent. Absent on any pure view-only path (the row
   * then no-ops — there is no popover to open without React state). The EDIT-
   * existing-`\ref` path (`virgil-label-ref-click`, marker-clicks.ts) is
   * untouched.
   */
  openRefPopover?: () => void;
  panelRouting?: {
    prefs: ViewPrefs;
    setActiveLeft: (id: PanelId) => void;
    setActiveRight: (id: PanelId) => void;
    focusCard: (cardKey: string) => void;
    /**
     * Select a newly-created example in the Examples panel (CHIP 5c). The
     * example "card" is NOT a `cardCreation`-minted float keyed by a float key
     * — it is an in-doc `exampleBlock` whose panel row is selected via the
     * Examples panel's `selectedExampleId` state. So `exampleRun`'s soft-route
     * uses THIS callback (mapping to `setSelectedExampleId`) rather than
     * `focusCard`. Backlog #2: selecting the example only makes an ALREADY-open
     * Examples panel scroll to it — it never force-opens the panel. Supplied by
     * EditorPane through the bridge for the slash surface; absent on
     * grab/lightning (the grid inserts inline without a panel hop) and on any
     * pure view-only path.
     */
    selectExample?: (exampleId: string) => void;
  };
}

// ---------------------------------------------------------------------------
// ActionSpec — one row per ActionId
// ---------------------------------------------------------------------------

/**
 * The declarative row for a single action. One per `ActionId`. The four
 * surfaces read off this shape:
 *   - menus render `label` / `icon` / `letter` and gate on `applies(ctx)`;
 *   - slash dispatch matches on `slashName`;
 *   - input rules match on `inputRulePattern`;
 *   - the keyboard layer binds `keybinding`;
 *   - every surface ultimately calls `run(ctx)`.
 *
 * `run()` is the SINGLE implementation each action needs — replacing the up-
 * to-four parallel code paths the surfaces carry today.
 */
export interface ActionSpec {
  /** The id this row implements. Must equal its key in the registry. */
  id: ActionId;
  /** Human label for menus / omni / tooltips. */
  label: string;
  /** Menu icon. `React.ReactNode`, matching `MenuEntry.icon` — erased at
   *  compile time so this module stays React-runtime-free. Optional: format
   *  actions in the grid carry inline SVG at the render site rather than a
   *  registry icon, and slash/typed-only actions have no menu presence. */
  icon?: React.ReactNode;
  /** Single-letter shortcut shown + active WHILE a menu is open (the
   *  grab-bar / lightning letter hints: H/N/F/C/T/E/X/R/D/A/⌫). Menu-scoped,
   *  NOT a global keybinding — that is `keybinding`. */
  letter?: string;
  /** Draw a divider line ABOVE this entry in the menu list. Menu-chrome
   *  only (the former `MenuEntry.separator`); the grab-bar / lightning menus
   *  render the rule when set (above Duplicate + Archive). */
  separator?: boolean;
  /** Render this entry with destructive (red) styling. Menu-chrome only
   *  (the former `MenuEntry.destructive`); set on `delete`. */
  destructive?: boolean;
  /** Coarse category — also the union-member family of `id`. */
  category: ActionCategory;
  /**
   * The DECLARATIVE selection-mode (CHIP 7b, DA-5) — how this action relates to
   * a live text RANGE, and thus whether it greys out at a collapsed caret. This
   * is the ONE place cursor-mode greying is decided; `applies()` routes through
   * `applySelectionMode(spec, ctx, base)`. See `ActionSelectionMode`:
   *   - `"required"` → greys at a collapsed caret (only `highlight`);
   *   - `"optional"` → caret OK, inserts a placeholder (atoms / inserts / lifecycle);
   *   - `"ignored"`  → caret OK, a stateful toggle / block conversion (marks /
   *     lists / quote / headings / text-color).
   * Optional in the type for back-compat, but EVERY row declares it explicitly so
   * the taxonomy is exhaustive and visible. Absent ⇒ treated as `"optional"`
   * (the no-grey default) by `applySelectionMode`.
   */
  selection?: ActionSelectionMode;
  /**
   * The "backbone" the action's `run()` reaches through to produce its effect —
   * a DECLARED field recording HOW the action acts, so a row can never silently
   * hide its implementation strategy:
   *
   *   - `"card-creation"` — routes through React-land `cardCreation` /
   *     `cardLifecycle` (the card actions; citation/footnote).
   *   - `"prosemirror"`   — a pure PM transaction on `ctx.view` (heading / tex /
   *     example / the block-atom inserts) — no React, no bridge.
   *   - `"tiptap-chain"`  — a pure `editor.chain()…run()` call, with NO bridge
   *     and NO canonical Virgil SSOT (the format marks + list/quote toggles +
   *     text-color, CHIP 6b). This value is a DELIBERATE record that these
   *     actions are intentionally backbone-LESS: they are thin wrappers over
   *     TipTap StarterKit commands, not routed through any Virgil SSOT. Declaring
   *     it (rather than leaving the field unset) is exactly the point — the
   *     registry STATES the absence of a backbone instead of hiding it.
   *
   * Optional: rows that predate this field (the card slice, the heading/tex/
   * example/block-atom slice) leave it unset. The CHIP 6b format rows set it to
   * `"tiptap-chain"`. Descriptive only — nothing dispatches on it today.
   */
  backbone?: "card-creation" | "prosemirror" | "tiptap-chain";
  /** Which surfaces expose this action. Cross-checked by
   *  `assertActionCoverage`. */
  surfaces: ActionSurfaces;
  /** Slash-command name WITHOUT the backslash (e.g. "section", "cite"),
   *  present iff `surfaces.slash`. Matches a `VIRGIL_COMMAND_NAMES` entry. */
  slashName?: string;
  /** The typed-LaTeX input-rule trigger, present iff `surfaces.typed`
   *  (citation / footnote). The RegExp the plugin matches against the text
   *  before the caret. */
  inputRulePattern?: RegExp;
  /** Global keybinding string (TipTap/PM form, e.g. "Mod-b"), present iff
   *  `surfaces.keyboard`. */
  keybinding?: string;
  /**
   * Applicability gate. Returns:
   *   - `"ok"` — enabled, render normally;
   *   - `"disabled"` — present but greyed-out (e.g. Highlight on a collapsed
   *     caret; an action a kind's `TEXT_OBJECT_REGISTRY.actions` excludes);
   *   - `"absent"` — not offered on this surface/context at all.
   * Pure; called at menu-open / dispatch time. Mirrors the
   * `MENU_ENTRIES` per-kind `disabled` decoration + the cursor-mode
   * Highlight grey-out in `ActionsMenuPanel`.
   */
  applies(ctx: ActionContext): "ok" | "disabled" | "absent";
  /**
   * Resolve the doc range the action operates on, when it differs from the
   * ref's natural range. Optional — defaults to the dispatcher's
   * `resolveRefRange` behavior (heading → heading-line for annotations / whole
   * section for lifecycle; block → content range; etc.). Named here so a
   * later chip can fold that scattered resolution into the registry. Pure.
   */
  resolveScope?(ctx: ActionContext): { from: number; to: number };
  /**
   * The single implementation. Lives in React-land (closes over
   * `ctx.cardCreation` / `ctx.cardLifecycle`). Surfaces 1 & 2 call it
   * directly; surfaces 3 & 4 reach it through the `EditorActionsHandle`
   * bridge, which supplies the React APIs into `ctx` first. May be async
   * (some paths await a confirm dialog).
   */
  run(ctx: ActionContext): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// EditorActionsHandle — the PM→React bridge CONTRACT
// ---------------------------------------------------------------------------

/**
 * The imperative bridge a ProseMirror plugin (slash command / input rule)
 * uses to invoke a React-land action. The React tree publishes ONE of these
 * into a ref — `editorActionsRef` — and plugin-land consumes it:
 *
 *   editorActionsRef.current?.runAction("footnote", { surface: "slash" });
 *
 * The handle's implementation (a later chip) resolves the `ActionSpec`,
 * builds an `ActionContext` — crucially **supplying `cardCreation` /
 * `cardLifecycle` from React-land** so the plugin never touches React — and
 * invokes `spec.run(ctx)`.
 *
 * ── REPLACED ── this ONE typed entrypoint superseded the scattered `window`
 * CustomEvent seams that used to cross the boundary. All are now RETIRED (the
 * `command-input.ts` hook that bound them is DELETED through CHIP 7a):
 *   - `virgil-citation-create`   (CHIP 4a-ii — was commands.ts → command-input.ts + citations-host.tsx)
 *   - `virgil-footnote-input`    (CHIP 4b)
 *   - `virgil-footnote-created`  (CHIP 4b — dead event, zero listeners)
 *   - `virgil-ex-create`         (CHIP 5c)
 *   - `virgil-ref-create`        (CHIP 7a — `\ref` now rides this bridge → `refRun`)
 * plus the two citation listeners (`command-input.ts` and `citations-host.tsx`
 * both bound `virgil-citation-create`). Those untyped string events became
 * `runAction(id, seed)` calls with a typed `id` + typed `seed`.
 */
export interface EditorActionsHandle {
  /**
   * Invoke an action from plugin-land (slash command / input rule).
   *
   * @param id    Which action to run. The bridge looks it up in
   *              `VIRGIL_ACTION_REGISTRY`; an absent/empty row is a no-op
   *              (today: the whole registry, so this is inert until CHIP 2+).
   * @param seed  The invocation context the plugin can supply. `surface` is
   *              restricted to the two plugin-land surfaces. `position` and
   *              `payload` thread the same way they do on `ActionContext`
   *              (e.g. a `\cite`'s pre-allocated `citationId`). The bridge
   *              fills in the React APIs + the live editor/view itself.
   */
  runAction(
    id: ActionId,
    seed: {
      surface: "slash" | "typed";
      position?: ActionPosition;
      payload?: Record<string, unknown>;
    },
  ): void;
}

// ---------------------------------------------------------------------------
// CHIP 2 — the 11 card-action rows, as DELEGATING wrappers.
//
// Each row is the SSOT for a card action's VOCABULARY (id / label / letter /
// surfaces / applicability / scope) but its `run()` FORWARDS to the existing
// grab-bar dispatcher (`ctx.dispatch`) so live behavior is byte-identical to
// today. The menus are NOT yet re-pointed at the registry — that is CHIP 3.
// This block is purely additive: it populates + lets the coverage assertion
// go green for the card milestone.
//
// `applies` / `resolveScope` mirror the dispatcher's existing logic so the
// registry tells the SAME story the live menus do:
//   - `applies` = the per-kind `TEXT_OBJECT_REGISTRY[kind].actions` grey-out
//     (`DragHandleMenu`'s `allowed`-set decoration) PLUS the cursor-mode
//     Highlight grey-out (`ActionsMenuPanel`: highlight disabled with no live
//     range).
//   - `resolveScope` = `resolveRefRange` + `actionClass`: a heading yields its
//     LINE for annotation actions and its whole SECTION for lifecycle actions;
//     every non-heading kind yields the same block/range either way.
// ---------------------------------------------------------------------------

/** The lifecycle (structural) card actions — their scope on a heading is the
 *  WHOLE SECTION. Everything else is an annotation action (heading → line).
 *  Mirrors `LIFECYCLE_ACTIONS` / `actionClass` in `drag-handle-actions.ts`. */
const CARD_LIFECYCLE_ACTIONS: ReadonlySet<CardActionId> = new Set<CardActionId>([
  "duplicate",
  "archive",
  "delete",
]);

function isCardLifecycleAction(id: CardActionId): boolean {
  return CARD_LIFECYCLE_ACTIONS.has(id);
}

/**
 * Does the action's ref carry a live, non-empty text range?
 *
 * Mirrors the two cursor-mode grey-outs the live menus already apply:
 *   - `ActionsMenuPanel` opened in `mode: "cursor"` greys Highlight out
 *     (a collapsed caret has nothing to wrap);
 *   - a `CursorRef` (slash / typed) likewise has no range.
 * A `TextObjectRef` (a persistent block / sub-object / linkedRange) always
 * resolves to a range, so it counts as "has range". A `SelectionRef` has a
 * range iff `to > from`.
 */
function refHasLiveRange(ref: ActionRef): boolean {
  if (ref.kind === "cursor") return false;
  if (ref.kind === "selection") return ref.to > ref.from;
  return true; // every TextObjectRef resolves to a block / range
}

// ---------------------------------------------------------------------------
// The TWO shared applicability gates (CHIP 7b) — the ONE place each rule lives.
// Every row's `applies()` runs through `gateApplies(spec, ctx, base)`:
//   (1) COLLAB read-only → disable EVERYTHING (uniform across all 4 surfaces);
//   (2) SELECTION-MODE taxonomy → disable a `"required"` action at a collapsed
//       caret (cursor mode); `"optional"` / `"ignored"` are range-agnostic.
// A row computes its OWN per-kind/per-context base status (e.g. `cardApplies`'s
// `TEXT_OBJECT_REGISTRY.actions` grey-out) and hands it in as `base`; the gates
// can only TIGHTEN it to `"disabled"`, never loosen it.
// ---------------------------------------------------------------------------

/**
 * The UNIFORM collab-read-only gate (CHIP 7b — the user-APPROVED new behavior).
 * When `ctx.canEdit === false` (collab on AND the partner holds the pen — see
 * the `ActionContext.canEdit` JSDoc for the authoritative signal) the action is
 * `"disabled"` on EVERY surface; no create / lifecycle / format action may run
 * while another collaborator holds the pen.
 *
 * CRITICAL — no over-gating: `canEdit` is `undefined` for a non-collab doc or a
 * caller that doesn't supply collab state, so this returns `false` (not gated)
 * and NOTHING changes in normal mode. ONLY an explicit `false` gates.
 */
function isCollabReadOnly(ctx: ActionContext): boolean {
  return ctx.canEdit === false;
}

/**
 * Resolve a row's selection-mode to a boolean grey-out decision. A `"required"`
 * action greys out when the ref has no live range (collapsed caret / empty
 * selection / `cursor`); `"optional"` and `"ignored"` (and an unset `selection`,
 * defaulting to `"optional"`) are range-agnostic. This is the DA-5 taxonomy
 * resolved in ONE place — the only consumer is `gateApplies`.
 */
function selectionModeDisables(mode: ActionSelectionMode | undefined, ctx: ActionContext): boolean {
  if (mode === "required") return !refHasLiveRange(ctx.ref);
  return false; // "optional" | "ignored" | undefined → never grey on range
}

/**
 * The SHARED applicability gate every `applies()` routes through (CHIP 7b). It
 * layers the two cross-cutting rules on top of a row's own per-context `base`:
 *
 *   1. COLLAB read-only (`ctx.canEdit === false`) → `"disabled"` uniformly.
 *   2. SELECTION-MODE (`spec.selection`) → `"disabled"` when a `"required"`
 *      action has no live range.
 *
 * The gates only TIGHTEN: a `base` of `"disabled"`/`"absent"` is returned
 * unchanged (a kind that already excludes the action stays excluded). An
 * `"absent"` base is left absent (the action isn't offered at all on this
 * surface/context — the collab/selection rules don't resurrect it). Pure.
 */
function gateApplies(
  spec: { selection?: ActionSelectionMode },
  ctx: ActionContext,
  base: "ok" | "disabled" | "absent",
): "ok" | "disabled" | "absent" {
  if (base !== "ok") return base; // already disabled/absent — nothing to tighten
  if (isCollabReadOnly(ctx)) return "disabled"; // (1) uniform collab gate
  if (selectionModeDisables(spec.selection, ctx)) return "disabled"; // (2) DA-5
  return "ok";
}

/**
 * The per-kind action filter the live `DragHandleMenu` applies:
 * `TEXT_OBJECT_REGISTRY[kind].actions` is the allow-list; an id NOT in it
 * renders greyed-out (disabled), never removed. A `SelectionRef` / `CursorRef`
 * is gesture-input (no TextObject kind) and exposes the full vocabulary —
 * matching the menu's `kind === "selection"` / no-`kind` "full list" branch.
 */
function kindAllowsCardAction(ref: ActionRef, id: CardActionId): boolean {
  if (ref.kind === "selection" || ref.kind === "cursor") return true;
  // A `TextObjectRef`. `ref.kind` is a TextObjectKind string literal.
  if (!isTextObjectKind(ref.kind)) return true; // defensive: unknown → allow
  return (
    TEXT_OBJECT_REGISTRY[ref.kind].actions as ReadonlyArray<DragHandleAction>
  ).includes(id);
}

/**
 * Shared applicability gate for every card row. Returns:
 *   - `"disabled"` when the kind's `actions` set excludes the id (Class A/B/C/D
 *     grey-out), OR the shared `gateApplies` tightens it (collab read-only, or
 *     a `"required"` selection-mode action with no live range — `highlight`);
 *   - `"ok"` otherwise.
 *
 * Never returns `"absent"`: the card actions are present on every grab /
 * lightning menu (greyed when inapplicable), matching the live "visible-
 * disabled" decoration rather than filtering entries away.
 *
 * CHIP 7b: the highlight-needs-a-range check is NO LONGER special-cased here —
 * it is declared `selection: "required"` on the highlight row and resolved by
 * `gateApplies` (which also layers the uniform collab gate). The kind-allow-list
 * is the row's per-context `base`; `gateApplies` only tightens it.
 */
function cardApplies(
  id: CardActionId,
  ctx: ActionContext,
  selection: ActionSelectionMode | undefined,
): "ok" | "disabled" | "absent" {
  const base: "ok" | "disabled" = kindAllowsCardAction(ctx.ref, id) ? "ok" : "disabled";
  return gateApplies({ selection }, ctx, base);
}

/**
 * Shared scope resolver for every card row — mirrors `resolveRefRange` in
 * `drag-handle-actions.ts`:
 *   - selection ref      → its own clamped range;
 *   - heading + annotation action → the heading LINE
 *     (`getHeadingLineRangeByUuid`);
 *   - heading + lifecycle action  → the whole SECTION
 *     (`getSectionRangeByUuid`);
 *   - any other TextObject kind   → its node content range (same either way);
 *   - cursor ref         → the collapsed caret as a zero-width range.
 *
 * Pure; reads only `ctx.view.state.doc`. Returns `null` when the ref can't be
 * resolved (stale uuid / unmapped mark) — the live dispatcher bails the same
 * way. This is the registry-side SSOT a later chip folds the scattered
 * resolution into; for CHIP 2 the live `run()` path still resolves its own
 * range inside `dispatch`, so this is declarative-only (proven by tests).
 */
function cardResolveScope(
  id: CardActionId,
  ctx: ActionContext,
): { from: number; to: number } | null {
  const doc = ctx.view.state.doc;
  const docSize = doc.content.size;
  const ref = ctx.ref;

  if (ref.kind === "cursor") {
    const pos = Math.max(0, Math.min(ref.pos, docSize));
    return { from: pos, to: pos };
  }
  if (ref.kind === "selection") {
    const from = Math.max(0, Math.min(ref.from, docSize));
    const to = Math.max(0, Math.min(ref.to, docSize));
    return to >= from ? { from, to } : null;
  }
  if (!isTextObjectKind(ref.kind)) return null;
  const meta = TEXT_OBJECT_REGISTRY[ref.kind];

  // linkedRange — walk for the linkedAnchor mark span.
  if (meta.isRange) {
    const markType = ctx.view.state.schema.marks.linkedAnchor;
    if (!markType) return null;
    let from = -1;
    let to = -1;
    doc.descendants((node, pos) => {
      if (!node.isText) return true;
      const has = node.marks.some(
        (m) => m.type === markType && m.attrs.anchorId === ref.id,
      );
      if (has) {
        if (from < 0) from = pos;
        to = pos + node.nodeSize;
      }
      return true;
    });
    return from < 0 ? null : { from, to };
  }

  // Heading: annotation → line, lifecycle → section.
  if (ref.kind === "heading") {
    if (!isCardLifecycleAction(id)) {
      const line = getHeadingLineRangeByUuid(doc, ref.id);
      return line ? { from: line.from, to: line.to } : null;
    }
    const section = getSectionRangeByUuid(doc, ref.id);
    return section ? { from: section.start, to: section.end } : null;
  }

  // Any other block / sub-object / atom-block: its node bounds. Atom blocks
  // return the full node range (NodeSelection territory); text-bearing blocks
  // return the inner content range. Mirrors `resolveRefRange`'s tail.
  let result: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (
      node.type.name === ref.kind &&
      (node.attrs?.uuid as string | null) === ref.id
    ) {
      result = meta.isAtomBlock
        ? { from: pos, to: pos + node.nodeSize }
        : { from: pos + 1, to: pos + node.nodeSize - 1 };
      return false;
    }
    return true;
  });
  return result;
}

/**
 * `run()` for a card row — DELEGATES to the legacy grab-bar dispatcher
 * supplied on `ctx.dispatch`. This is the whole point of CHIP 2: the registry
 * owns the vocabulary, the existing dispatcher owns the behavior, so nothing
 * about live editing changes. A later chip relocates the dispatch CASE into
 * this body and drops `ctx.dispatch`.
 *
 * Only `DragHandleRef`-shaped refs (`TextObjectRef | SelectionRef`) can
 * forward — that is what the dispatcher's signature accepts. A `CursorRef`
 * (slash / typed) cannot route here; the card rows are grab/lightning-only
 * this chip, so a card `run()` never receives one. If `ctx.dispatch` is
 * absent (a misconfigured caller) or the ref is a cursor, this is a no-op —
 * the dispatcher is the single source of behavior and we never re-implement it.
 */
function cardRun(id: CardActionId, ctx: ActionContext): void {
  if (isCollabReadOnly(ctx)) return; // CHIP 7b: uniform collab gate — no-op
  if (ctx.ref.kind === "cursor") return; // not a grab-bar ref — no-op (see JSDoc)
  ctx.dispatch?.(id, ctx.ref);
}

// ---------------------------------------------------------------------------
// citation.run — the FIRST card action whose `run()` handles ALL FOUR surfaces
// (CHIP 4a-ii). It is the join point that makes menu-Citation, slash `\cite`,
// typed `\cite{key}`, and typed `\cite ` land at the SAME destination.
//
//   - grab / lightning (a `DragHandleRef`): DELEGATE to the legacy dispatcher
//     exactly like every other card row — `ctx.dispatch("citation", ref)`
//     inserts the atom + registers the anchored card. BYTE-IDENTICAL to today.
//   - slash / typed (a `CursorRef`): the PM caller ALREADY inserted the `\cite`
//     atom SYNCHRONOUSLY (durability decision — the atom lands even if React is
//     unmounted), passing the atom's `citationId` + `command` in `ctx.payload`.
//     Here we register the matching panel card via `cardCreation.createCitation`
//     and apply the backlog-#2 SOFT-ROUTE. This is the bug fix: typed
//     `\cite{key}` previously made NO card.
// ---------------------------------------------------------------------------

/**
 * The backlog-#2 soft-route, lifted VERBATIM from the retired
 * `command-input.ts` `virgil-citation-create` handler (~60-87). Slash/typed
 * `\cite` needs a completion surface for the new card, so we route it into
 * OMNI — but ONLY surface omni when the citations side is currently collapsed
 * (`null`) or `blank`. If the user has another panel covering omni on that
 * side, we LEAVE IT: the card still lands + selects in omni and reveals itself
 * when the user next views it, rather than clobbering their panel. Honors the
 * citations panel's docked side (left vs right). Never force-opens the
 * dedicated Citations panel.
 */
function softRouteCitationToOmni(routing: NonNullable<ActionContext["panelRouting"]>): void {
  const { prefs, setActiveLeft, setActiveRight } = routing;
  const citPlacement = prefs.placements.find((pl) => pl.id === "citations");
  const side = citPlacement?.side ?? "right";
  const active = side === "left" ? prefs.activeLeft : prefs.activeRight;
  if (active == null || active === "blank") {
    if (side === "left") setActiveLeft("omni");
    else setActiveRight("omni");
  }
}

/**
 * The citation card `run()` — see the block comment above. Returns nothing;
 * may be invoked from any of the four surfaces.
 */
function citationRun(ctx: ActionContext): void {
  // CHIP 7b: uniform collab gate. When the partner holds the pen, the slash /
  // typed callers ALSO no-op before inserting the synchronous atom (the PM
  // surfaces check `runAction`'s gate — see the bridge), so this guard covers
  // the grab/lightning path; it also fail-safes the PM path (the atom-insert tx
  // would be rejected by `readOnlyEnforcer` regardless).
  if (isCollabReadOnly(ctx)) return;
  // Surfaces 1 & 2 (grab / lightning): a `DragHandleRef`. Delegate to the
  // legacy dispatcher — its `case "citation"` inserts the placeholder atom AND
  // registers the anchored card (with its own `ensureOmniActiveForPanel`).
  if (ctx.ref.kind !== "cursor") {
    ctx.dispatch?.("citation", ctx.ref);
    return;
  }
  // Surfaces 3 & 4 (slash / typed): the PM caller inserted the atom already.
  // Register the panel card with the SAME `citationId` so the card and the
  // in-doc atom share an identity (the card renders anchored), mirroring the
  // dispatcher's anchored `createCitation({ unanchored: false, mode: "omni" })`.
  const payload = ctx.payload ?? {};
  const citationId =
    typeof payload.citationId === "string" ? payload.citationId : undefined;
  const command =
    typeof payload.command === "string" && payload.command
      ? payload.command
      : "\\cite{}";
  if (!citationId || !ctx.cardCreation) return; // misconfigured caller — atom already landed; no card
  ctx.cardCreation.createCitation({
    command,
    citationId,
    unanchored: false,
    mode: "omni",
  });
  // Soft-route + focus the new card's library-picker (mirrors the retired
  // citations-host listener's `focusNewCard(cardPopKey("citation", id))`).
  if (ctx.panelRouting) {
    softRouteCitationToOmni(ctx.panelRouting);
    ctx.panelRouting.focusCard(
      buildFloatKey({ domain: "card", kind: "citation", id: citationId }),
    );
  }
}

// ---------------------------------------------------------------------------
// footnote.run — the SECOND card action whose `run()` handles ALL FOUR surfaces
// (CHIP 4b). The footnote join point: menu-Footnote, slash `\footnote`, and
// typed `\footnote{}` all land the SAME pristine + pinned card lifecycle.
//
//   - grab / lightning (a `DragHandleRef`): DELEGATE to the legacy dispatcher
//     exactly like every other card row — `ctx.dispatch("footnote", ref)`
//     inserts the empty footnote atom + registers the pristine+pinned card.
//     BYTE-IDENTICAL to today.
//   - slash / typed (a `CursorRef`): the PM caller ALREADY inserted the
//     `\footnote{}` atom SYNCHRONOUSLY (durability decision — the atom lands
//     even if React is unmounted), passing the atom's `footnoteId` in
//     `ctx.payload`. Here we ADOPT that existing atom: register the matching
//     panel card via `cardCreation.createFootnote({ existingFootnoteId })`,
//     which runs ONLY the pristine + pin + select tail (NO re-insert → no
//     double-insert), then SOFT-ROUTE into OMNI (backlog #2). This is the
//     alignment fix: slash/typed footnotes were "lighter" before — no pristine
//     (a blank one wasn't click-away-discardable), no panel pin, and a DEAD
//     `virgil-footnote-created` event. Now they match the menu.
// ---------------------------------------------------------------------------

/**
 * The backlog-#2 soft-route for footnote, the footnote twin of
 * `softRouteCitationToOmni`. Slash/typed `\footnote` needs a surface for the
 * new card, so we route it into OMNI — but ONLY surface omni when the footnotes
 * side is currently collapsed (`null`) or `blank`. If the user has another
 * panel covering omni on that side, we LEAVE IT: the card still lands + selects
 * in omni and reveals itself when the user next views it, rather than
 * clobbering their panel. Honors the footnotes panel's docked side (left vs
 * right). Never force-opens the dedicated Footnotes panel.
 */
function softRouteFootnoteToOmni(routing: NonNullable<ActionContext["panelRouting"]>): void {
  const { prefs, setActiveLeft, setActiveRight } = routing;
  const fnPlacement = prefs.placements.find((pl) => pl.id === "footnotes");
  const side = fnPlacement?.side ?? "left";
  const active = side === "left" ? prefs.activeLeft : prefs.activeRight;
  if (active == null || active === "blank") {
    if (side === "left") setActiveLeft("omni");
    else setActiveRight("omni");
  }
}

/**
 * The footnote card `run()` — see the block comment above. Returns nothing;
 * may be invoked from any of the four surfaces.
 */
function footnoteRun(ctx: ActionContext): void {
  // CHIP 7b: uniform collab gate (same rationale as `citationRun`).
  if (isCollabReadOnly(ctx)) return;
  // Surfaces 1 & 2 (grab / lightning): a `DragHandleRef`. Delegate to the
  // legacy dispatcher — its `case "footnote"` collapses the selection, inserts
  // the empty footnote atom AND registers the pristine+pinned card.
  // BYTE-IDENTICAL to today.
  if (ctx.ref.kind !== "cursor") {
    ctx.dispatch?.("footnote", ctx.ref);
    return;
  }
  // Surfaces 3 & 4 (slash / typed): the PM caller inserted the atom already
  // (passing its `footnoteId`). ADOPT it — register the panel card with the
  // SAME `footnoteId` so the card and the in-doc atom share an identity, and
  // run the pristine + pin + select tail WITHOUT re-inserting (no double
  // insert). Mirrors the menu's `createFootnote({ fromSelection: false })`
  // lifecycle, minus the insert the PM caller already did.
  const payload = ctx.payload ?? {};
  const footnoteId =
    typeof payload.footnoteId === "string" ? payload.footnoteId : undefined;
  if (!footnoteId || !ctx.cardCreation) return; // misconfigured caller — atom already landed; no card
  // Pristine iff the PM caller inserted a BLANK footnote (slash `\footnote`
  // → empty body → pristine, matching the menu). A typed `\footnote{body}`
  // carries real content, so its caller passes `pristine:false` to keep the
  // click-away watcher from reaping a non-blank footnote. Defaults to `true`.
  const pristine = payload.pristine !== false;
  ctx.cardCreation.createFootnote({
    existingFootnoteId: footnoteId,
    pristine,
    mode: "omni",
  });
  // Soft-route + focus the new card (mirrors the dispatcher's
  // `cardPopKey("footnote", id)` focus key). Backlog #2: surface omni only
  // when the footnotes side is collapsed/blank — never force-open Footnotes.
  if (ctx.panelRouting) {
    softRouteFootnoteToOmni(ctx.panelRouting);
    ctx.panelRouting.focusCard(
      buildFloatKey({ domain: "card", kind: "footnote", id: footnoteId }),
    );
  }
}

// ---------------------------------------------------------------------------
// heading.run — the FIRST PURE-ProseMirror block action (CHIP 5a). Unlike
// citation/footnote (which need a React `cardCreation` → the bridge), a heading
// is a pure `setBlockType` needing only the `EditorView`. So `headingRun`
// operates on `ctx.view` and is callable DIRECTLY from BOTH the slash command
// (PM-side, has the view) and the BlockType dropdown (React, has the editor) —
// NO bridge. This is the model for pure-PM block/format actions generally.
//
// THE DIVERGENCE THIS FIXES (MEMO_ACTION_ALIGNMENT.md §3 heading row): the slash
// `\chapter/\section/\subsection/\subsubsection` always SET (`setBlockType` +
// `numbered:true`), while the dropdown TOGGLED (`toggleHeading` → clicking
// 'Section' on an existing level-2 heading reverted it to a paragraph). Both now
// route through this ONE helper: the canonical heading verb is **always SET +
// numbered:true**. The dropdown stops toggling-off; its separate 'Body' item
// still does `setParagraph` (the explicit way back out of heading-hood).
// ---------------------------------------------------------------------------

/** The heading level each heading `ActionId` sets. The id is the SSOT (one id
 *  per `\`-command name — see the HEADING ID SCHEME note on `BlockActionId`);
 *  this lookup recovers the scalar `level` for the `setBlockType` attrs. */
const HEADING_ID_LEVEL: Readonly<Record<BlockActionId & `heading-${string}`, number>> = {
  "heading-chapter": 1,
  "heading-section": 2,
  "heading-subsection": 3,
  "heading-subsubsection": 4,
};

/**
 * The canonical heading transform — always SET + `numbered:true`, on
 * `ctx.view`. Mirrors the slash command's `tr.setBlockType(from, to, heading,
 * { level, numbered:true })` VERBATIM so the four heading commands and the
 * dropdown can never diverge on the verb. Pure PM — no React, no bridge.
 *
 * `numbered:true` is passed explicitly (it also IS the schema default, so this
 * is belt-and-suspenders, matching the slash command).
 */
function headingRun(level: number): (ctx: ActionContext) => void {
  return (ctx: ActionContext) => {
    if (isCollabReadOnly(ctx)) return; // CHIP 7b: uniform collab gate — no-op
    const { state } = ctx.view;
    const heading = state.schema.nodes.heading;
    if (!heading) return;
    const tr = state.tr.setBlockType(
      state.selection.from,
      state.selection.to,
      heading,
      { level, numbered: true },
    );
    ctx.view.dispatch(tr);
  };
}

// ---------------------------------------------------------------------------
// titleFieldRun — the `\title` / `\author` / `\date` slash actions (CHIP 7a).
// Like heading/tex/example (and unlike citation/footnote), a titleField insert
// is a pure ProseMirror transform needing ONLY the `EditorView` — NO React
// `cardCreation`, so NO bridge. `titleFieldRun` operates on `ctx.view` and is
// invoked from the slash command via `runViewOnlyAction` (commands.ts).
//
// THESE ARE SLASH-ONLY BY DESIGN. A titleField is a STRUCTURAL singleton hoisted
// to the doc top — NOT a card, and the menus offer no "insert title" affordance.
// So the rows declare `surfaces: { slash: true }` ONLY; there is no menu twin to
// align (a legitimate asymmetry the registry MODELS rather than forcing).
//
// IDEMPOTENT (the one asymmetry among the slash commands — these are the only
// ones that don't ALWAYS insert): if a titleField of the requested kind already
// exists, place the cursor at the end of its content rather than inserting a
// duplicate. Lifted VERBATIM from the retired `titleFieldCommand` factory
// (commands.ts) so the behavior is byte-identical:
//   - find-existing-or-insert (dedupe),
//   - canonical order (title=0 / author=1 / date=2; always BEFORE any
//     non-titleField, incl. `\maketitle`, since `\maketitle` reads `\title` at
//     expansion time),
//   - `\date` pre-fills today (pretty-printed `\today`; `isToday: true` so the
//     serializer emits `\date{\today}`).
// ---------------------------------------------------------------------------
function titleFieldRun(field: "title" | "author" | "date"): (ctx: ActionContext) => void {
  return (ctx: ActionContext) => {
    if (isCollabReadOnly(ctx)) return; // CHIP 7b: uniform collab gate — no-op
    const view = ctx.view;
    const { state } = view;
    const titleFieldType = state.schema.nodes.titleField;
    if (!titleFieldType) return;

    // 1. Find an existing titleField of this kind. We only look at top-level
    //    doc children — that's where the parser puts them and where
    //    `hoistTitleFieldsToTop` keeps them.
    let foundPos: number | null = null;
    let foundNode: PMNode | null = null;
    let offset = 0;
    state.doc.forEach((child) => {
      if (
        foundPos === null &&
        child.type.name === "titleField" &&
        child.attrs?.field === field
      ) {
        foundPos = offset;
        foundNode = child;
      }
      offset += child.nodeSize;
    });
    if (foundPos !== null && foundNode !== null) {
      // IDEMPOTENT: cursor at end of the existing field's content — no node
      // mutation, no duplicate. nodeSize = 2 (open+close) + content size; +1 is
      // the opening token, then we add content size to land before the close.
      const node: PMNode = foundNode;
      const endOfContent = foundPos + 1 + node.content.size;
      const tr = state.tr.setSelection(
        TextSelection.create(state.doc, endOfContent),
      );
      view.dispatch(tr.scrollIntoView());
      return;
    }

    // 2. Insert at canonical position. Order: title=0, author=1, date=2.
    //    Anything else (including `maketitleMarker`) sorts after all titles, so
    //    the new node lands before the first non-title and before any titleField
    //    with a larger field order.
    const order: Record<string, number> = { title: 0, author: 1, date: 2 };
    const insertOrder = order[field];
    let insertPos = 0;
    let walkOffset = 0;
    state.doc.forEach((child) => {
      const childOrder =
        child.type.name === "titleField"
          ? order[child.attrs?.field as string] ?? 99
          : 99;
      if (childOrder < insertOrder) {
        walkOffset += child.nodeSize;
        insertPos = walkOffset;
      }
    });

    // Build the new node. Pre-stamp a UUID so the in-memory id matches what
    // will land on disk (matches the `cite` / `tex` pattern).
    const existingUuids = new Set<string>();
    state.doc.descendants((n) => {
      if (n.attrs?.uuid) existingUuids.add(n.attrs.uuid as string);
    });
    const attrs = {
      field,
      rawPrefix: null,
      isToday: field === "date",
      uuid: generateShortId(existingUuids),
    };
    let nodeContent = null;
    if (field === "date") {
      // Mirror the parser's pretty-printed `\today` rendering so the lozenge
      // shows the date immediately. The `isToday: true` flag tells the
      // serializer to emit `\date{\today}` rather than the expanded string.
      const now = new Date();
      const pretty = now.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      nodeContent = state.schema.text(pretty);
    }
    const node = titleFieldType.create(attrs, nodeContent);

    const tr = state.tr.insert(insertPos, node);
    // Cursor at end of inserted content (or just inside, for empty).
    const cursorPos = insertPos + 1 + node.content.size;
    tr.setSelection(TextSelection.create(tr.doc, cursorPos));
    view.dispatch(tr.scrollIntoView());
  };
}

/**
 * Build one titleField row (`title` / `author` / `date`). `category: "block"`
 * (a structural node insert; there is no dedicated `"title"` category in
 * `ActionCategory` and these behave like the other pure-PM block inserts),
 * SLASH-ONLY surface (`\title` / `\author` / `\date`), `slashName` reconciled
 * against `VIRGIL_COMMAND_NAMES`. No menu/typed/keyboard twin by design — a
 * titleField is a doc-top singleton, not a card.
 *
 * `applies` mirrors heading/tex: a selection / caret can always insert (the node
 * hoists to the top regardless of where the caret sits); a non-text atom-block
 * ref has no meaningful invocation → "disabled" via the shared `blockApplies`.
 * In practice these are only invoked from a caret (the slash command), so "ok"
 * everywhere reachable.
 */
function titleFieldRow(field: "title" | "author" | "date"): ActionSpec {
  const label = field.charAt(0).toUpperCase() + field.slice(1);
  return {
    id: field,
    label,
    category: "block",
    // selection-`"ignored"`: a titleField is a doc-top singleton — the
    // idempotent find-existing-or-insert never reads the selection range, so a
    // caret is always valid (no DA-5 grey). Range-agnostic, like a block convert.
    selection: "ignored",
    surfaces: { slash: true },
    slashName: field,
    applies: (ctx) => blockApplies(ctx),
    run: titleFieldRun(field),
  };
}

/** The 3 title-field ids, in canonical doc-top order. The registry + the
 *  coverage assertion iterate this list; the slash commands look up the row by
 *  id via `runViewOnlyAction`. */
const TITLE_ACTION_IDS: readonly TitleActionId[] = ["title", "author", "date"];

// ---------------------------------------------------------------------------
// texRun — the SECOND pure-ProseMirror block action (CHIP 5b), modeled on
// `headingRun`. Like heading (and unlike citation/footnote), a raw-LaTeX block
// is a pure `texBlock` insert needing ONLY the `EditorView` — NO React
// `cardCreation`, so NO bridge. `texRun` operates on `ctx.view` and is callable
// DIRECTLY from BOTH the slash command (PM-side, has the view) and the lightning
// grid `\tex` cell (React, has the editor → editor.view).
//
// THE DIVERGENCE THIS FIXES (MEMO_ACTION_ALIGNMENT.md §3 tex row): there were
// TWO creators with different behavior —
//   - slash `\tex` (commands.ts): `replaceSelectionWith(texBlock.create({code:
//     ''}))` — ALWAYS empty code, DISCARDED any selected text;
//   - lightning grid (tex-block.ts `insertTexBlock`): SEEDED `code` from the
//     selected plain text (`textBetween`, hardBreak→\n) via
//     `deleteSelection()+insertContent`.
// Each re-implemented the uuid-collision scan. SETTLED DECISION: unify on the
// RICHER behavior — **seed code from the selection**. Both surfaces now route
// through this ONE helper; the slash creator gains seed-from-selection (a minor
// improvement — it previously threw the selection away), and the duplicated
// uuid-scan collapses to one (`generateShortId` over the doc's existing
// `texBlock` uuids).
// ---------------------------------------------------------------------------

/**
 * The canonical raw-LaTeX-block transform — seed `code` from the current
 * selection (empty if collapsed), mint a collision-free `uuid`, insert the
 * `texBlock`. Operates purely on `ctx.view` (no React, no bridge), so the slash
 * command and the lightning grid cell can never diverge on the creator.
 *
 * Seeding mirrors the grid's former `insertTexBlock` VERBATIM: `textBetween`
 * with `\n` between block boundaries, and a `leafText` callback that turns
 * Shift+Enter `hardBreak` nodes into `\n` (the default drops them). Tabs survive
 * automatically (TabIndent inserts literal `\t` into text content). The
 * `deleteSelection()`-before-`insertContent()` dance is required: without the
 * explicit delete, `insertContent` silently no-ops when placing a block-level
 * atom across an active range inside a paragraph.
 */
export function texRun(ctx: ActionContext): void {
  if (isCollabReadOnly(ctx)) return; // CHIP 7b: uniform collab gate — no-op
  const { state } = ctx.view;
  const texBlockType = state.schema.nodes.texBlock;
  if (!texBlockType) return;
  const { from, to, empty } = state.selection;
  const seedCode = empty
    ? ""
    : state.doc.textBetween(from, to, "\n", (node) =>
        node.type.name === "hardBreak" ? "\n" : "",
      );
  // DATA-LOSS GUARD: a non-empty selection that carries an inline atom but no
  // text (a citation pill / `$\lambda$` / `\ref` selected alone) has
  // `seedCode === ""` yet a non-empty slice — the `deleteSelection()` /
  // `replaceSelectionWith` below would DESTROY the atom and drop a placeholder
  // texBlock in its place. Preserve the atom: a `\tex` block is a caret-insert
  // gesture; selecting an atom to convert is not supported. (Same content-aware
  // emptiness as the archive fix — atoms count as content.)
  if (!empty && seedCode.length === 0 && state.doc.slice(from, to).content.size > 0) {
    return;
  }
  // The ONE uuid-collision scan (was duplicated across slash + grid).
  const existing = new Set<string>();
  state.doc.descendants((node) => {
    if (node.type.name === "texBlock" && node.attrs.uuid) {
      existing.add(node.attrs.uuid as string);
    }
    return true;
  });
  const attrs = { uuid: generateShortId(existing), code: seedCode };
  let tr = state.tr;
  if (!empty) tr = tr.deleteSelection();
  // After deleteSelection the range collapsed; replaceSelectionWith places the
  // atom at the caret (matching the grid's `insertContent` block-atom path).
  tr = tr.replaceSelectionWith(texBlockType.create(attrs));
  ctx.view.dispatch(tr.scrollIntoView());
}

/**
 * The single `tex` registry row — `category: "block"`, exposed on the slash
 * surface (`\tex`) AND the lightning surface (the grid `\tex` cell). No
 * grab/typed/keyboard surface (a raw-LaTeX block is not a grab-handle action,
 * and there is no `\tex{}`-style input rule). Both surfaces call `texRun`.
 *
 * `applies` mirrors heading's (the grid cell / slash command only fire from the
 * body text): a selection / caret is always insertable; a non-text atom-block
 * ref has no caret to insert at → "disabled". In practice tex is only invoked
 * from a selection or caret, so this is "ok" everywhere it is reachable.
 */
const TEX_ACTION_ROW: ActionSpec = {
  id: "tex",
  label: "Raw LaTeX",
  category: "block",
  // selection-`"optional"`: `texRun` seeds `code` from a selection when present,
  // else inserts an empty block at the caret — so a caret is fine (no DA-5 grey).
  selection: "optional",
  surfaces: { slash: true, lightning: true },
  slashName: "tex",
  // Shared block-atom gate (CHIP 6a: `blockApplies`). A function declaration, so
  // it is hoisted above this row's definition.
  applies: (ctx) => blockApplies(ctx),
  run: texRun,
};

// ---------------------------------------------------------------------------
// refRun — the `\ref` cross-reference action (CHIP 7a). The LAST inline-Atom id
// to migrate. Unlike citation/footnote (the atom is inserted synchronously in
// plugin-land, the CARD registered via the bridge), `\ref` has NO card: the
// `LabelRef` POPOVER is the creator. So `refRun` is a one-liner that opens that
// popover at the caret via the `ctx.openRefPopover` seam — the SAME create-mode
// open the retired `virgil-ref-create` CustomEvent triggered (label="" +
// caret-rect → `setActiveRefLabel("")` / `setActiveRefRect`). The user then
// picks/types a label and `useRefActions.handleInsertRef` lands the `labelRef`
// atom at the cursor.
//
// THE DIVERGENCE THIS FIXES (MEMO_ACTION_ALIGNMENT.md §3 `\ref` row): `\ref` was
// SLASH-ONLY — no menu route to insert a cross-reference, despite `labelRef`
// being a first-class atom in `ATOM_REGISTRY`. SETTLED: ADD a lightning cell.
// Both the slash `\ref` (PM-land → bridge) and the new grid 'Cross-ref' cell
// (React) now route through THIS one `run()`, so the two surfaces share ONE
// creator (the popover) by construction.
//
// React-touch ONLY (the popover open). The seam is supplied per-surface:
// EditorPane's bridge handle for slash, `ActionsMenuPanel` for lightning. On a
// pure view-only caller (`runViewOnlyAction`) the seam is absent and `refRun`
// no-ops — there is no popover to open without React state.
// ---------------------------------------------------------------------------
export function refRun(ctx: ActionContext): void {
  if (isCollabReadOnly(ctx)) return; // CHIP 7b: uniform collab gate — no popover
  ctx.openRefPopover?.();
}

/**
 * The single `ref` registry row — `category: "atom"` (a `labelRef` inline atom;
 * the only `AtomActionId`), exposed on the slash surface (`\ref`) AND the
 * lightning surface (the new 'Cross-ref' grid cell, CHIP 7a). No grab/typed/
 * keyboard surface (a cross-reference is not a grab-handle action, and there is
 * no `\ref{}`-style typed input rule — `\ref` is a slash command, and the popover
 * is the creator). Both surfaces call `refRun` → `ctx.openRefPopover()`.
 *
 * `applies`: a `\ref` is insertable at any caret / selection (the popover lands
 * the atom at the cursor). A non-text atom-block ref (figure / displayMath) has
 * no caret to insert at → "disabled", via the shared `blockApplies` gate (the
 * same gate tex/example/math use). In practice `ref` is only invoked from a
 * caret/selection (the slash command or the grid bolt), so it is "ok" everywhere
 * it is reachable.
 */
const REF_ACTION_ROW: ActionSpec = {
  id: "ref",
  label: "Cross-ref",
  category: "atom",
  // selection-`"optional"`: the popover lands the `labelRef` atom at the caret —
  // a caret is the normal case, no range needed (no DA-5 grey).
  selection: "optional",
  surfaces: { slash: true, lightning: true },
  slashName: "ref",
  applies: (ctx) => blockApplies(ctx),
  run: refRun,
};

// ---------------------------------------------------------------------------
// exampleRun — the THIRD pure-ProseMirror block action (CHIP 5c), modeled on
// `texRun`. Like tex/heading (and unlike citation/footnote), an expex example
// is a pure `exampleBlock` insert needing ONLY the `EditorView` — NO React
// `cardCreation`, so the INSERT takes NO bridge. The only React touch is the
// soft panel-select (`ctx.panelRouting?.selectExample`), which is optional and
// surface-supplied; the insert runs view-only and lands even with no routing.
//
// THE DIVERGENCE THIS FIXES (MEMO_ACTION_ALIGNMENT.md §3 example row): there
// were THREE creators for one intent —
//   - grid `ex` cell (ActionsMenuPanel.wrapSelectionInExample → MenuBar's
//     `buildExampleTemplate("single", …)`): WRAPS the selection's inline content
//     into the first exampleItem paragraph;
//   - slash `\ex` (commands.ts → `virgil-ex-create` CustomEvent → command-input.ts
//     → `editorRef.insertExample("single")` in Editor.tsx): INSERTS an empty block;
//   - the STRAY MenuBar `insertExampleAtCursor` (a third, now-dead creator).
// Two template builders ALSO diverged on the dormant `multi` shape:
// `insertExample`'s multi wrapped its items in an `exampleItemList` (the
// schema-correct shape the serializer reads — latex-serializer.ts
// `serializeExampleBlock` walks `exampleItemList`), while `buildExampleTemplate`'s
// multi emitted BARE `exampleItem`s as direct `exampleBlock` children (a shape no
// surface ever produced). SETTLED DECISION: ONE canonical builder here; `multi`
// resolves to the `exampleItemList` wrapper.
//
// SETTLED DECISION (wrap-if-selection-else-insert): `exampleRun` WRAPS the
// selection into the example when non-empty, INSERTS an empty single example when
// collapsed. The wrap preserves CHIP 0's DA-1 inline-only safety
// (`extractInlineFromSlice` over the selection slice → only inline nodes reach
// the `inline*` item paragraph; block scaffolding is flattened to its inline
// leaves).
// ---------------------------------------------------------------------------

/**
 * Extract ONLY inline content (as ProseMirror JSON) from a selection slice,
 * suitable for dropping into an `inline*` slot (the example template's first
 * `exampleItem` paragraph). This is the CHIP 0 DA-1 safety, hoisted here as the
 * SSOT so `exampleRun` (grid + slash) AND the DA-1 lock test exercise the SAME
 * harvest — the grid's old private `extractInlineJSON` (ActionsMenuPanel) now
 * delegates here, so the two can never diverge.
 *
 * A `slice` between two positions yields top-level *block* nodes whenever the
 * selection spans a block boundary, so the raw fragment JSON can't be trusted to
 * be inline. We walk the fragment and collect inline nodes:
 *   - an inline node (text, inline atom)            → kept as-is;
 *   - any block node                                 → recurse into its content to
 *                                                      harvest the inline leaves,
 *                                                      discarding the block wrapper
 *                                                      (block boundaries collapse
 *                                                      to nothing — NO spaces are
 *                                                      injected, matching how `\ex`
 *                                                      reads as one continuous line).
 *
 * Returns a (possibly empty) array of inline-node JSON. An empty result (a
 * collapsed / whitespace-only / pure-block-boundary selection) is the caller's
 * signal to use the empty-template fallback rather than wrapping a blank line.
 * Runs on a user gesture, not per keystroke — a bounded walk over the selection
 * slice only, never the whole document. Pure (no React/DOM), so the registry
 * stays node-env-importable.
 */
export function extractInlineFromSlice(slice: Slice): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let hasUsable = false; // any non-whitespace text OR any inline atom?
  const walk = (fragment: Fragment) => {
    fragment.forEach((child) => {
      if (child.isInline) {
        if (child.isText) {
          if ((child.text ?? "").trim().length > 0) hasUsable = true;
        } else {
          hasUsable = true; // an inline atom (inline math, citation, \ref, …)
        }
        out.push(child.toJSON() as Record<string, unknown>);
      } else {
        walk(child.content);
      }
    });
  };
  walk(slice.content);
  return hasUsable ? out : [];
}

/**
 * Build a fresh `exampleBlock` JSON template (the ONE canonical example
 * builder, CHIP 5c). `kind: "single"` → a one-paragraph `\ex`; `kind: "multi"`
 * → a `\pex` whose items are wrapped in an `exampleItemList` (the schema-correct
 * shape — the bare-`exampleItem` variant the old `buildExampleTemplate` emitted
 * is GONE). Stamps a collision-free `uuid` so the caller can locate the node
 * after insertion. The `single` shape is byte-identical to the prior
 * `buildExampleTemplate("single")` / `insertExample("single")` output, so the
 * common single case round-trips to the SAME `.tex`.
 *
 * `inlineContent`, when supplied, seeds the first item paragraph (the wrap
 * path) — it MUST be inline-only JSON (the caller guarantees this via
 * `extractInlineFromSlice`; an empty array ⇒ the empty-template fallback).
 */
function buildExampleNode(
  kind: "single" | "multi",
  existing: Set<string>,
  inlineContent?: Record<string, unknown>[],
): { uuid: string; node: Record<string, unknown> } {
  const uuid = generateShortId(existing);
  const baseAttrs = {
    uuid,
    tag: "",
    label: "",
    exnoOverride: null,
    suppressSpace: false,
    number: 0,
  };
  if (kind === "single") {
    const firstParagraph: Record<string, unknown> =
      inlineContent && inlineContent.length
        ? { type: "paragraph", content: inlineContent }
        : { type: "paragraph" };
    return {
      uuid,
      node: {
        type: "exampleBlock",
        attrs: { ...baseAttrs, kind: "single" },
        content: [firstParagraph],
      },
    };
  }
  // multi → the `exampleItemList`-wrapped shape (schema-correct; the dormant
  // bare-item divergence is resolved here). Two blank items + a one-row gloss,
  // matching `insertExample("multi")` verbatim.
  return {
    uuid,
    node: {
      type: "exampleBlock",
      attrs: { ...baseAttrs, kind: "multi" },
      content: [
        {
          type: "exampleItemList",
          content: [
            {
              type: "exampleItem",
              attrs: { tag: "", label: "", subLabel: "" },
              content: [{ type: "paragraph" }],
            },
            {
              type: "exampleItem",
              attrs: { tag: "", label: "", subLabel: "" },
              content: [{ type: "paragraph" }],
            },
          ],
        },
        {
          type: "exampleGloss",
          attrs: { glossId: null, colCount: 1 },
          content: [
            {
              type: "alignedGlossRow",
              attrs: { tier: "gla" },
              content: [{ type: "glossCell", content: [] }],
            },
            {
              type: "proseGlossRow",
              attrs: { tier: "glft" },
              content: [],
            },
          ],
        },
      ],
    },
  };
}

/**
 * The canonical example creator — wrap-if-selection-else-insert (CHIP 5c).
 * Operates purely on `ctx.view` (no React, no bridge for the INSERT); the
 * optional `ctx.panelRouting?.selectExample` soft-selects the new block in an
 * already-open Examples panel (backlog #2 — never force-opens it). Both the grid
 * `ex` cell and the slash `\ex` route through THIS, so they can never diverge.
 *
 *   - selection non-empty → WRAP: harvest the selection's inline content via
 *     `extractInlineFromSlice` (the CHIP 0 DA-1 safety — only inline nodes ever
 *     reach the `inline*` item paragraph; block scaffolding is flattened to its
 *     inline leaves), build a SINGLE example seeded with it, `deleteSelection()`
 *     then insert. A whitespace-only/empty harvest ⇒ the empty-template fallback
 *     (a blank single example).
 *   - collapsed caret → INSERT an empty single example at the caret.
 *
 * After insertion the caret is parked inside the new block's first editable
 * paragraph (matching the former `insertExample`/`insertExampleAtCursor` tail) so
 * the user can type immediately — `insertContent` doesn't do this for an
 * `isolating` block.
 */
export function exampleRun(ctx: ActionContext): void {
  if (isCollabReadOnly(ctx)) return; // CHIP 7b: uniform collab gate — no-op
  const { state } = ctx.view;
  const exampleBlockType = state.schema.nodes.exampleBlock;
  if (!exampleBlockType) return;
  const { from, to, empty } = state.selection;

  // Harvest inline-only content from the selection (the WRAP path) via the SSOT
  // `extractInlineFromSlice` — a bounded walk over the selection slice (never the
  // whole doc), run on a user gesture, not per keystroke. An empty result (no
  // usable text/atoms) ⇒ the empty-template fallback below.
  const inlineContent = empty
    ? []
    : extractInlineFromSlice(state.doc.slice(from, to));

  const existing = new Set<string>();
  state.doc.descendants((node) => {
    if (node.type.name === "exampleBlock" && node.attrs.uuid) {
      existing.add(node.attrs.uuid as string);
    }
    return true;
  });
  const { uuid, node } = buildExampleNode("single", existing, inlineContent);

  // Build the example block on the live schema and insert it. `deleteSelection`
  // before insert is required when wrapping a non-empty range so the new block
  // replaces the selection (mirrors the grid's
  // `deleteSelection().insertContent(node)` and tex's delete-then-insert dance).
  const exampleNode = state.schema.nodeFromJSON(node);
  let tr = state.tr;
  if (!empty) tr = tr.deleteSelection();
  tr = tr.replaceSelectionWith(exampleNode);

  // Park the caret inside the new block's first editable paragraph. We locate
  // the just-inserted block by its uuid in the resulting doc (the insert position
  // shifts under deleteSelection), then descend to its first paragraph.
  let target = -1;
  tr.doc.descendants((n, pos) => {
    if (target >= 0) return false;
    if (n.type.name === "exampleBlock" && n.attrs.uuid === uuid) {
      n.descendants((child, relPos) => {
        if (target >= 0) return false;
        if (child.type.name === "paragraph") {
          target = pos + 1 + relPos + 1; // +1 into block, +1 into paragraph content
          return false;
        }
        return true;
      });
      return false;
    }
    return true;
  });
  if (target >= 0) {
    tr = tr.setSelection(TextSelection.create(tr.doc, target));
  }
  ctx.view.dispatch(tr.scrollIntoView());

  // Soft-select the new example so an ALREADY-open Examples panel scrolls to it
  // (backlog #2: never force-opens the panel). Supplied only on the slash
  // surface (via the bridge); the grid inserts inline without a panel hop.
  ctx.panelRouting?.selectExample?.(uuid);
}

/**
 * The single `example` registry row — `category: "block"`, exposed on the slash
 * surface (`\ex`) AND the lightning surface (the grid `ex` cell). No
 * grab/typed/keyboard surface (an example is not a grab-handle action, and there
 * is no `\ex{}`-style input rule — the `\ex `/`\pex ` LaTeX is parsed at load,
 * not via an inline input rule). Both surfaces call `exampleRun`.
 *
 * `applies` mirrors tex/heading: a selection / caret is always insertable; a
 * non-text atom-block ref has no caret to insert at → "disabled". In practice
 * example is only invoked from a selection or caret, so this is "ok" everywhere
 * it is reachable.
 */
const EXAMPLE_ACTION_ROW: ActionSpec = {
  id: "example",
  label: "Example",
  category: "block",
  // selection-`"optional"`: `exampleRun` WRAPS a selection when present, else
  // inserts an empty single example at the caret — a caret is fine (no DA-5 grey).
  selection: "optional",
  surfaces: { slash: true, lightning: true },
  slashName: "ex",
  applies: (ctx) => blockApplies(ctx),
  run: exampleRun,
};

// ---------------------------------------------------------------------------
// Shared block-row applicability (CHIP 6a). The block-atom rows (tex / example /
// figure / graphics / inline-math / display-math) all share the SAME gate: a
// selection / caret is always insertable; a non-text atom-block ref (figure /
// displayMath) has no caret to insert at → "disabled". In practice these are
// only invoked from a selection or caret (the grid bolt / a slash command), so
// it is "ok" everywhere they are reachable. Factored out so the six rows can't
// drift. (tex/example kept their inline copies pre-6a; they now delegate here.)
//
// CHIP 7b: routes its kind-base through the shared `gateApplies` so the uniform
// collab read-only gate layers on. The block/atom rows are selection-`"optional"`
// (they WRAP a selection when present, else insert an empty shell / placeholder —
// `texRun` / `exampleRun` insert empty on a collapsed caret; `mathRun` seeds a
// placeholder `latex`), so the DA-5 range check never greys them — only the
// `isAtomBlock` kind-base and collab read-only can.
// ---------------------------------------------------------------------------
function blockApplies(ctx: ActionContext): "ok" | "disabled" | "absent" {
  const ref = ctx.ref;
  let base: "ok" | "disabled";
  if (ref.kind === "selection" || ref.kind === "cursor") base = "ok";
  else if (!isTextObjectKind(ref.kind)) base = "ok"; // defensive: unknown → allow
  else base = TEXT_OBJECT_REGISTRY[ref.kind].isAtomBlock ? "disabled" : "ok";
  // selection-`"optional"`: caret OK; only the kind-base + collab gate can grey.
  return gateApplies({ selection: "optional" }, ctx, base);
}

// ---------------------------------------------------------------------------
// mathRun — the inline/display-math grid cells (CHIP 6a). Unlike figure/graphics
// (a cursor-INSERT of an opaque atom), math WRAPS the selection: the selected
// text becomes the atom's `latex`. This preserves the grid's prior
// `wrapSelectionInMath` semantics EXACTLY — `deleteSelection().insertContent({
// type, attrs: { latex } })` — just lifted into a registry `run()` so the cell
// renders from the SSOT. Pure ProseMirror (operates on `ctx.editor`), no bridge.
//
// WRAP semantics (preserved verbatim from the former grid helper):
//   - latex = the selected plain text, or a placeholder when the selection is
//     empty ("x" for inline, "\int f(x)\,dx" for display);
//   - inline → `inlineMath` (no uuid attr); display → `displayMath` (uuid hydrated
//     lazily by `ensureAnchorUuid` on first interaction, same as before — we do
//     NOT pre-mint it, matching the prior `insertContent` behavior).
// ---------------------------------------------------------------------------
function mathRun(kind: "inline" | "display"): (ctx: ActionContext) => void {
  return (ctx: ActionContext) => {
    if (isCollabReadOnly(ctx)) return; // CHIP 7b: uniform collab gate — no-op
    const editor = ctx.editor;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, " ");
    // DATA-LOSS GUARD: a non-empty selection holding an inline atom but no text
    // (a citation pill / `$\lambda$` / `\ref` selected alone) has `text === ""`
    // yet a non-empty slice — `deleteSelection()` below would DESTROY the atom
    // and drop a placeholder math node in its place. Preserve the atom: math-
    // wrap needs real selected text (or a collapsed caret to insert a
    // placeholder). Atoms count as content (mirrors the archive fix).
    if (from < to && text.length === 0 && editor.state.doc.slice(from, to).content.size > 0) {
      return;
    }
    const latex = text || (kind === "inline" ? "x" : "\\int f(x)\\,dx");
    const type = kind === "inline" ? "inlineMath" : "displayMath";
    editor
      .chain()
      .focus()
      .deleteSelection()
      .insertContent({ type, attrs: { latex } })
      .run();
  };
}

// ---------------------------------------------------------------------------
// figureRun / graphicsRun — the figure/image grid cells (CHIP 6a). These INSERT
// an opaque block atom at the caret (replacing a non-empty selection per the
// `smartInsertBlock` documented policy — an atom can't absorb inline content),
// then open the SOURCE popover so the user can fill in the empty
// `\includegraphics` path. They are the SSOT the standalone `insertFigureBlock`
// / `insertGraphicsBlock` helpers DELEGATE to (so the grid path, the helper
// path, and any future FILE-DROP path all share `smartInsertBlock`, DA-2).
//
// Popover-open (the dual-use `virgil-figure-click` split): when `ctx.
// openFigurePopover` is supplied (the grid cell threads EditorLayout's
// `setActiveFigure` down), we open the popover DIRECTLY through that React
// callback — the INSERT-time `virgil-figure-click` emit is RETIRED. When it is
// absent (a pure view-only caller), we fall back to the legacy CustomEvent so
// the popover still pops. The EDIT-existing-figure `virgil-figure-click`
// listener (marker-clicks.ts) is UNTOUCHED either way.
//
// The popover opens one rAF after insert (the NodeView DOM must exist to measure
// its rect — matches the prior timing). Pure ProseMirror for the insert; the
// only React touch is the optional `openFigurePopover` callback.
// ---------------------------------------------------------------------------

/** Open the figure/graphics source popover for a freshly-inserted block: prefer
 *  the threaded React callback (`ctx.openFigurePopover`, grid surface), else the
 *  legacy `virgil-figure-click` CustomEvent (the insert-time fallback — the EDIT
 *  listener is the same event and stays wired). */
function openInsertPopover(
  ctx: ActionContext,
  seed: { kind: string; raw: string; pos: number; rect: DOMRect },
): void {
  if (ctx.openFigurePopover) {
    ctx.openFigurePopover(seed);
  } else if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("virgil-figure-click", { detail: seed }));
  }
}

export function figureRun(ctx: ActionContext): void {
  if (isCollabReadOnly(ctx)) return; // CHIP 7b: uniform collab gate — no-op
  const editor = ctx.editor;
  const figureType = editor.state.schema.nodes.figureBlock;
  if (!figureType) return;
  const attrs = freshFigureBlockAttrs(collectBlockUuids(editor, "figureBlock"));
  const { uuid, pos } = smartInsertBlock({
    editor,
    type: figureType,
    attrs: { ...attrs },
    content: [{ type: "figureCaption" }],
  });
  if (pos < 0) return;
  // One rAF so the NodeView's DOM exists to measure its rect (matches the prior
  // `insertFigureBlock` timing).
  requestAnimationFrame(() => {
    const found = relocateBlock(editor, "figureBlock", uuid) ?? pos;
    const dom = editor.view.nodeDOM(found);
    if (!(dom instanceof HTMLElement)) return;
    openInsertPopover(ctx, {
      kind: "figureBlock",
      raw: synthesizeFigureRaw(attrs.extras, "", attrs.label),
      pos: found,
      rect: dom.getBoundingClientRect(),
    });
  });
}

export function graphicsRun(ctx: ActionContext): void {
  if (isCollabReadOnly(ctx)) return; // CHIP 7b: uniform collab gate — no-op
  const editor = ctx.editor;
  const graphicsType = editor.state.schema.nodes.graphicsBlock;
  if (!graphicsType) return;
  const attrs = freshGraphicsBlockAttrs(collectBlockUuids(editor, "graphicsBlock"));
  const { uuid, pos } = smartInsertBlock({
    editor,
    type: graphicsType,
    attrs: { ...attrs },
  });
  if (pos < 0) return;
  requestAnimationFrame(() => {
    const found = relocateBlock(editor, "graphicsBlock", uuid) ?? pos;
    const dom = editor.view.nodeDOM(found);
    if (!(dom instanceof HTMLElement)) return;
    openInsertPopover(ctx, {
      kind: "graphicsBlock",
      raw: attrs.command,
      pos: found,
      rect: dom.getBoundingClientRect(),
    });
  });
}

/** Collect the existing `uuid`s on nodes of `typeName` (for collision-free
 *  minting). The block-file `collect*Uuids` twins; inlined here so the registry
 *  doesn't import the React block modules. */
function collectBlockUuids(ctx: { state: { doc: PMNodeLike } }, typeName: string): Set<string> {
  const set = new Set<string>();
  ctx.state.doc.descendants((node: { type: { name: string }; attrs: Record<string, unknown> }) => {
    if (node.type.name === typeName && node.attrs.uuid) set.add(node.attrs.uuid as string);
    return true;
  });
  return set;
}

/** Find the position of the `typeName` node carrying `uuid` in the live doc, or
 *  null if absent. */
function relocateBlock(
  ctx: { state: { doc: PMNodeLike } },
  typeName: string,
  uuid: string,
): number | null {
  let found: number | null = null;
  ctx.state.doc.descendants((node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => {
    if (found !== null) return false;
    if (node.type.name === typeName && node.attrs.uuid === uuid) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/** Minimal structural type for the doc-walk above (a `descendants`-bearing
 *  node). Keeps `collectBlockUuids` / `relocateBlock` PM-version-agnostic without
 *  importing the model types. */
interface PMNodeLike {
  descendants: (
    fn: (
      n: { type: { name: string }; attrs: Record<string, unknown> },
      pos: number,
    ) => boolean | void,
  ) => void;
}

/**
 * The 4 block-ATOM grid rows (CHIP 6a) — `inline-math`, `display-math`,
 * `figure`, `graphics`. All `category: "block"`, `surfaces: { lightning: true }`
 * (grid-only — no slash/typed/grab/keyboard today; those stay false). `applies`
 * follows the tex/example/heading `isAtomBlock → 'disabled'` pattern via the
 * shared `blockApplies`. `run`: math WRAPS the selection (`mathRun(kind)`);
 * figure/graphics INSERT via `smartInsertBlock` then open the source popover
 * (`figureRun` / `graphicsRun`).
 *
 * CHIP 7b: all 4 are selection-`"optional"` — the math cells WRAP a selection
 * but seed a placeholder `latex` ("x" / "\int f(x)\,dx") when empty (`mathRun`),
 * and figure/graphics insert an opaque block at the caret. So a collapsed caret
 * is a valid invocation (no DA-5 grey); only the `isAtomBlock` kind-base + the
 * uniform collab gate can disable them.
 */
const INLINE_MATH_ACTION_ROW: ActionSpec = {
  id: "inline-math",
  label: "Inline math",
  category: "block",
  selection: "optional",
  surfaces: { lightning: true },
  applies: blockApplies,
  run: mathRun("inline"),
};
const DISPLAY_MATH_ACTION_ROW: ActionSpec = {
  id: "display-math",
  label: "Display math",
  category: "block",
  selection: "optional",
  surfaces: { lightning: true },
  applies: blockApplies,
  run: mathRun("display"),
};
const FIGURE_ACTION_ROW: ActionSpec = {
  id: "figure",
  label: "Figure",
  category: "block",
  selection: "optional",
  surfaces: { lightning: true },
  applies: blockApplies,
  run: figureRun,
};
const GRAPHICS_ACTION_ROW: ActionSpec = {
  id: "graphics",
  label: "Image",
  category: "block",
  selection: "optional",
  surfaces: { lightning: true },
  applies: blockApplies,
  run: graphicsRun,
};

// ---------------------------------------------------------------------------
// FORMAT rows (CHIP 6b) — the lightning grid's mark/list/quote toggles +
// text-color. These complete the GRID fold: after this every grid cell (format
// marks + block atoms) renders from the registry. They are `category: "format"`,
// `surfaces: { lightning: true }`, `backbone: "tiptap-chain"` (the DECLARED
// record that they are intentionally backbone-LESS — pure `editor.chain()` calls
// over TipTap StarterKit commands, no bridge, no Virgil SSOT).
//
// Two shapes:
//   - the SIX simple toggles (bold / italic / strike / code mark toggles;
//     bullet-list / ordered-list / blockquote wrapper toggles) — each a pure
//     `editor.chain().focus().toggleX().run()`, lifted VERBATIM from the grid's
//     former inline `runFormat((c) => c.toggleX())` cells.
//   - text-color — NOT a fire-and-forget toggle; it pops the
//     `SelectionColorPopover`. Its `run()` calls `ctx.openColorPopover(rect)`
//     (threaded from `ActionsMenuPanel`, which owns the popover state + the
//     selection-stash + the MRU palette). The rect comes through `ctx.payload`
//     (`{ anchorRect }`) — the cell supplies its bounding rect at click time.
// ---------------------------------------------------------------------------

/**
 * Applicability for the MARK format rows (bold / italic / strike / code /
 * text-color) — REAL as of CHIP 7b (it was a placeholder `() => "ok"` in CHIP
 * 6b). Every mark action is selection-`"ignored"`: a mark toggle is fully valid
 * at a COLLAPSED CARET — it flips the pending/STORED mark, so the next typed
 * character is bold; text-color pops the popover. None need a live range, so the
 * DA-5 range check is a no-op and the cell stays `"ok"` at a caret — EXACTLY
 * matching how the grid renders the mark cells today (always enabled). A mark is
 * harmless on ANY block (you can bold text inside a heading / titleField; on a
 * `marks: ""` codeBlock it's a near-no-op that leaves the text untouched), so
 * the mark base is unconditionally `"ok"`.
 *
 * The only thing that greys a mark cell is the UNIFORM collab read-only gate
 * (`ctx.canEdit === false`): a partner holding the pen disables marks too.
 * Routed through `gateApplies` (base `"ok"`, `selection: "ignored"`).
 *
 * NOTE — the structural WRAPPER rows (bullet-list / ordered-list / blockquote)
 * do NOT use this; they route through `wrapperApplies` (below), which greys on
 * blocks a list/quote wrapper would destroy. Splitting the two keeps the mark
 * applicability byte-identical to CHIP 7b while the wrappers gain the data-loss
 * guard (Bug #1).
 */
function formatApplies(ctx: ActionContext): "ok" | "disabled" | "absent" {
  return gateApplies({ selection: "ignored" }, ctx, "ok");
}

// ---------------------------------------------------------------------------
// WRAPPER applicability + the listable-block guard (Bug #1, DATA-LOSS).
//
// The three structural wrapper toggles — bullet-list / ordered-list /
// blockquote — run `editor.chain().toggleBulletList()` / `toggleOrderedList()` /
// `toggleBlockquote()`, each of which wraps the block(s) the selection spans
// into a `bulletList > listItem` / `orderedList > listItem` / `blockquote`.
// Both targets PRESERVE a `paragraph` and ONLY a paragraph:
//   - `listItem`  content = "paragraph block*"  (must START with a paragraph)
//   - `blockquote` content = "block+"
// So wrapping a `paragraph` is lossless (it stays a paragraph inside the new
// container), but wrapping a STRUCTURAL block silently destroys its identity:
//   - a `titleField` (group "block", content "inline*") is NOT a paragraph, so
//     ProseMirror coerces it into one — the `\title{}`/`\author{}`/`\date{}`
//     field is LOST;
//   - a `heading` is converted into a list item / quoted paragraph — the
//     `\section{}` semantics are LOST;
//   - the atom / opaque blocks (codeBlock, displayMath, texBlock, figureBlock,
//     graphicsBlock, latexComment, maketitleMarker) either can't host a list or
//     round-trip wrong once nested.
//
// The SCHEMA-DRIVEN signal for "listable" is therefore precise: the block the
// wrapper would act on must be a `paragraph` — the one node type both wrapper
// content models accept and preserve — OR a `listItem` (already a list item;
// toggling a list just re-lists it, and its content starts with a paragraph, so
// no identity is lost). We resolve the affected block(s) from the LIVE selection
// (cheap: one `resolve` per endpoint at menu-open, never per keystroke) and grey
// the cell unless EVERY spanned top-level block is listable. The toggle-OFF case
// (caret already inside a blockquote / list) is covered for free — the immediate
// block there is still a `paragraph`.
// ---------------------------------------------------------------------------

/**
 * The schema node-type names a list/quote wrapper can safely wrap WITHOUT
 * destroying structural identity. Centralized (not inlined) so the rule has one
 * home + this comment. `paragraph` is the generic prose container both wrapper
 * content models (`listItem` = "paragraph block*", `blockquote` = "block+")
 * accept and KEEP as a paragraph; `listItem` is already a list item (a list
 * toggle re-lists it losslessly). Every other block — titleField, heading,
 * codeBlock, displayMath, texBlock, figureBlock, graphicsBlock, latexComment,
 * maketitleMarker, exampleBlock, and the list/quote containers themselves — is
 * NON-listable: wrapping it loses or corrupts its identity. These are SCHEMA
 * node names (PM `node.type.name`), not `TextObjectKind`s — the caret may sit in
 * a node (maketitleMarker) that has no TextObject twin.
 */
const LISTABLE_BLOCK_TYPES: ReadonlySet<string> = new Set(["paragraph", "listItem"]);

/**
 * True iff EVERY block a list/quote wrapper would act on for the current
 * selection is listable — i.e. wrapping preserves each block's identity. We take
 * the SAME block range ProseMirror's `wrapInList` / `wrapIn` take (`$from.
 * blockRange($to)`): the contiguous run of sibling blocks at the shared depth
 * that the wrapper would lift into the new container. Each of those siblings
 * must be a listable node (`paragraph` / `listItem`); a single non-listable
 * block (titleField / heading / atom block) greys the cell.
 *
 * A collapsed caret resolves to the single containing block. If no block range
 * resolves (a degenerate selection — e.g. a NodeSelection on an opaque atom),
 * we refuse: there is nothing safely listable to wrap. Cheap — bounded by the
 * selection (O(blocks-in-range)), and only called at menu-open, never per
 * keystroke (keystroke sanctity).
 */
function selectionIsListable(view: EditorView): boolean {
  const { $from, $to } = view.state.selection;
  const range = $from.blockRange($to);
  if (!range) return false; // no wrappable block range → not listable, grey it
  const parent = range.parent;
  for (let i = range.startIndex; i < range.endIndex; i += 1) {
    if (!LISTABLE_BLOCK_TYPES.has(parent.child(i).type.name)) return false;
  }
  // A zero-width range (startIndex === endIndex) means the resolved block isn't
  // a direct child of `parent` at this depth — the caret's own textblock IS the
  // affected block; check it directly.
  if (range.startIndex === range.endIndex) {
    return LISTABLE_BLOCK_TYPES.has($from.parent.type.name);
  }
  return true;
}

/**
 * Applicability for the three structural WRAPPER rows. Same `selection:
 * "ignored"` + uniform-collab base as the mark rows, but with the DATA-LOSS
 * guard: when the caret/selection sits on a non-listable block (titleField,
 * heading, codeBlock, the atom/opaque blocks, …) the cell is `"disabled"`
 * (greyed, never run), so the wrapper can't destroy the block's structural
 * identity. Listable prose (paragraph / listItem / a paragraph inside a
 * blockquote-or-list) stays `"ok"`. The collab gate still layers via
 * `gateApplies`.
 */
function wrapperApplies(ctx: ActionContext): "ok" | "disabled" | "absent" {
  const base: "ok" | "disabled" = selectionIsListable(ctx.view) ? "ok" : "disabled";
  return gateApplies({ selection: "ignored" }, ctx, base);
}

/**
 * Build a simple format-toggle row. `chainCmd` is the StarterKit toggle the
 * cell ran inline (`(c) => c.toggleBold()`, …); `run()` applies it to
 * `ctx.editor.chain().focus()` — the SAME `editor.chain().focus().toggleX().run()`
 * the grid's `runFormat` did, just lifted into the registry so the cell renders
 * from the SSOT. Pure `tiptap-chain` backbone — no bridge.
 *
 * CHIP 7b: declares `selection: "ignored"` — a mark/list/quote toggle is valid
 * at a collapsed caret (it toggles the stored mark / wraps the block). The
 * `run()` GUARDS the uniform collab gate: when `ctx.canEdit === false` it
 * no-ops, so a stray invocation (e.g. a held keyboard shortcut) can't mutate the
 * doc while the partner holds the pen — belt-and-suspenders with the
 * `readOnlyEnforcer` plugin (which would reject the tx anyway).
 *
 * Bug #1 (DATA-LOSS): the WRAPPER toggles (`wrapper: true`) additionally route
 * `applies` through `wrapperApplies` (greying on non-listable blocks) AND guard
 * the `run()` with the SAME `selectionIsListable` check — defense-in-depth, so a
 * future surface that bypasses `applies()` (e.g. a held keyboard shortcut, or a
 * new menu) still can't destroy a titleField / heading / atom block. The mark
 * toggles (`wrapper` unset) keep `formatApplies` + the unconditional run, exactly
 * as before.
 */
function formatToggleRow(
  id: FormatActionId,
  label: string,
  chainCmd: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>,
  opts: { wrapper?: boolean } = {},
): ActionSpec {
  const isWrapper = opts.wrapper === true;
  return {
    id,
    label,
    category: "format",
    selection: "ignored",
    backbone: "tiptap-chain",
    surfaces: { lightning: true },
    applies: isWrapper ? wrapperApplies : formatApplies,
    run: (ctx) => {
      if (isCollabReadOnly(ctx)) return; // uniform collab gate — no-op
      // Bug #1 defense-in-depth: a wrapper toggle on a non-listable block
      // (titleField / heading / atom block) would DESTROY its identity — no-op
      // here even if a surface invoked us without consulting `applies()`.
      if (isWrapper && !selectionIsListable(ctx.view)) return;
      chainCmd(ctx.editor.chain().focus()).run();
    },
  };
}

/** The four MARK toggles + the three list/quote WRAPPER toggles. The wrappers
 *  pass `{ wrapper: true }` so they grey + no-op on non-listable blocks (Bug
 *  #1); the marks stay unconditionally applicable. */
const BOLD_ACTION_ROW = formatToggleRow("bold", "Bold", (c) => c.toggleBold());
const ITALIC_ACTION_ROW = formatToggleRow("italic", "Italic", (c) => c.toggleItalic());
const STRIKE_ACTION_ROW = formatToggleRow("strike", "Strikethrough", (c) => c.toggleStrike());
const CODE_ACTION_ROW = formatToggleRow("code", "Inline code", (c) => c.toggleCode());
const BULLET_LIST_ACTION_ROW = formatToggleRow("bullet-list", "Bullet list", (c) => c.toggleBulletList(), { wrapper: true });
const ORDERED_LIST_ACTION_ROW = formatToggleRow("ordered-list", "Numbered list", (c) => c.toggleOrderedList(), { wrapper: true });
const BLOCKQUOTE_ACTION_ROW = formatToggleRow("blockquote", "Blockquote", (c) => c.toggleBlockquote(), { wrapper: true });

/**
 * The text-color row (CHIP 6b). Unlike the toggles, this opens the
 * `SelectionColorPopover` rather than mutating the doc — its `run()` calls
 * `ctx.openColorPopover(rect)`, the React seam `ActionsMenuPanel` threads down
 * (it owns the popover state, the selection-stash that survives the native
 * picker's focus theft, and the MRU palette). The anchor rect arrives via
 * `ctx.payload.anchorRect` (the color cell's bounding rect at click time). When
 * no `openColorPopover` is supplied (a pure view-only caller) the row no-ops —
 * there is no popover to open without React state. Backbone is still
 * `"tiptap-chain"`: the eventual color apply is `chain.setTextColor()`, a
 * StarterKit-style mark command, just deferred behind the popover's pick.
 */
function textColorRun(ctx: ActionContext): void {
  if (isCollabReadOnly(ctx)) return; // uniform collab gate — no popover, no-op
  const payload = ctx.payload ?? {};
  const anchorRect =
    payload.anchorRect instanceof DOMRect ? payload.anchorRect : undefined;
  if (!ctx.openColorPopover || !anchorRect) return;
  ctx.openColorPopover(anchorRect);
}

const TEXT_COLOR_ACTION_ROW: ActionSpec = {
  id: "text-color",
  label: "Text color",
  category: "format",
  selection: "ignored",
  backbone: "tiptap-chain",
  surfaces: { lightning: true },
  applies: formatApplies,
  run: textColorRun,
};

/** The 8 format ids, in grid render order (the order `ActionsMenuPanel` lays out
 *  the cells). The registry appends these after the block-atom slice; the
 *  coverage assertion + the grid both iterate by id. */
const FORMAT_ACTION_IDS: readonly FormatActionId[] = [
  "bold",
  "italic",
  "strike",
  "code",
  "bullet-list",
  "ordered-list",
  "blockquote",
  "text-color",
];

/** The format rows by id (built above), for the registry assembly + the grid
 *  render. */
const FORMAT_ACTION_ROWS: Readonly<Record<FormatActionId, ActionSpec>> = {
  bold: BOLD_ACTION_ROW,
  italic: ITALIC_ACTION_ROW,
  strike: STRIKE_ACTION_ROW,
  code: CODE_ACTION_ROW,
  "bullet-list": BULLET_LIST_ACTION_ROW,
  "ordered-list": ORDERED_LIST_ACTION_ROW,
  blockquote: BLOCKQUOTE_ACTION_ROW,
  "text-color": TEXT_COLOR_ACTION_ROW,
};

/**
 * Build one heading row. Headings are `category: "block"`, exposed on the slash
 * surface (`\chapter` … `\subsubsection`) and the lightning surface (the
 * BlockType dropdown). No grab/typed/keyboard surface (a heading is not a
 * grab-handle action, and there is no `\heading{}`-style input rule).
 *
 * `applies` mirrors the BlockType dropdown's availability: a heading conversion
 * applies to any text block (paragraph / heading) or a live selection / caret
 * inside one. We keep it simple ("ok" everywhere the dropdown is reachable) —
 * the dropdown is always enabled when the caret is in the body text, and the
 * slash command only fires inside a text block by construction. An atom-block
 * ref (figure / displayMath) has no text to convert → "disabled".
 */
function headingRow(id: BlockActionId & `heading-${string}`): ActionSpec {
  const level = HEADING_ID_LEVEL[id];
  // \chapter → "chapter", … — the slashName WITHOUT the backslash, reconciled
  // against VIRGIL_COMMAND_NAMES by assertActionCoverage.
  const slashName = id.slice("heading-".length);
  const label =
    slashName.charAt(0).toUpperCase() + slashName.slice(1);
  return {
    id,
    label,
    category: "block",
    // selection-`"ignored"`: a heading is a `setBlockType` CONVERSION of the
    // current block — range-agnostic, valid at a collapsed caret (no DA-5 grey).
    selection: "ignored",
    surfaces: { slash: true, lightning: true },
    slashName,
    applies: (ctx) => {
      const ref = ctx.ref;
      // Per-kind base: a selection / caret always sits in a text block →
      // convertible; a TextObjectRef converts iff it's a text-bearing block (an
      // atom block — figure / displayMath / texBlock — has no text → disabled).
      let base: "ok" | "disabled" = "ok";
      if (ref.kind !== "selection" && ref.kind !== "cursor") {
        if (isTextObjectKind(ref.kind)) {
          base = TEXT_OBJECT_REGISTRY[ref.kind].isAtomBlock ? "disabled" : "ok";
        }
      }
      // Layer the collab gate (the DA-5 range check is a no-op for "ignored").
      return gateApplies({ selection: "ignored" }, ctx, base);
    },
    run: headingRun(level),
  };
}

/** The 4 heading ids, in level order. The registry + the coverage assertion
 *  iterate this list; the slash command + the BlockType dropdown look up the
 *  row by id. */
const HEADING_ACTION_IDS: readonly (BlockActionId & `heading-${string}`)[] = [
  "heading-chapter",
  "heading-section",
  "heading-subsection",
  "heading-subsubsection",
];

/**
 * The DA-5 selection-mode (CHIP 7b) for each card action. ONLY `highlight` is
 * `"required"` — it wraps the live range in a `linkedAnchor` mark and has
 * nothing to wrap at a collapsed caret (the single cursor-mode grey-out among
 * the card actions, matching `ActionsMenuPanel`'s `mode === "cursor"` highlight
 * gate). Every other card action is `"optional"`:
 *   - note / footnote / citation / todo / suggest-edit / cutter / report — they
 *     COLLAPSE-and-insert (an annotation anchored to the passage, or an atom at
 *     the caret), so a caret is fine;
 *   - duplicate / archive / delete — LIFECYCLE actions on a persistent node
 *     (the ref is a `TextObjectRef`, never a bare range), range-agnostic.
 * Resolved through `gateApplies` in `cardApplies`.
 */
const CARD_SELECTION_MODE: Readonly<Record<CardActionId, ActionSelectionMode>> = {
  highlight: "required",
  note: "optional",
  footnote: "optional",
  citation: "optional",
  todo: "optional",
  "suggest-edit": "optional",
  cutter: "optional",
  report: "optional",
  duplicate: "optional",
  archive: "optional",
  delete: "optional",
};

/** Build one delegating card row. Presentation (label / letter / icon /
 *  separator / destructive) from `CARD_ACTION_PRESENTATION` — the registry
 *  OWNS it as of CHIP 3; behavior forwarded via `cardRun`; applicability +
 *  scope mirrored from the dispatcher.
 *
 *  CITATION (CHIP 4a-ii) and FOOTNOTE (CHIP 4b) are special-cased: each
 *  additionally exposes the slash + typed surfaces and routes through its own
 *  four-surface `run()` (`citationRun` / `footnoteRun`) instead of the
 *  grab/lightning-only `cardRun`. Their `slashName` + `inputRulePattern` rows
 *  let the coverage assertion reconcile the `\cite` / `\footnote` slash
 *  commands + the typed-LaTeX input rules against these rows. */
function cardRow(id: CardActionId): ActionSpec {
  const p = CARD_ACTION_PRESENTATION[id];
  const isCitation = id === "citation";
  const isFootnote = id === "footnote";
  const hasPmSurfaces = isCitation || isFootnote;
  const selection = CARD_SELECTION_MODE[id];
  return {
    id,
    label: p.label,
    letter: p.letter,
    icon: p.icon,
    separator: p.separator,
    destructive: p.destructive,
    category: "card",
    selection,
    surfaces: hasPmSurfaces
      ? { grab: true, lightning: true, slash: true, typed: true }
      : { grab: true, lightning: true },
    // The slash command name (reconciled against VIRGIL_COMMAND_NAMES):
    // \cite → "cite", \footnote → "footnote".
    ...(isCitation ? { slashName: "cite" } : {}),
    ...(isFootnote ? { slashName: "footnote" } : {}),
    // The typed-LaTeX trigger. For citation, two patterns exist (`\cite{key}`
    // full + `\cite ` bare); we record CITE_RE_FULL as the canonical row
    // pattern (CITATION_INPUT_RULE_PATTERNS below carries the bare form). For
    // footnote, the single `\footnote{…}` rule (FOOTNOTE_INPUT_RULE_PATTERN).
    // All live next to the input rules they drive so the four surfaces can
    // never recognize a different vocabulary.
    ...(isCitation ? { inputRulePattern: CITE_RE_FULL } : {}),
    ...(isFootnote ? { inputRulePattern: FOOTNOTE_INPUT_RULE_PATTERN } : {}),
    applies: (ctx) => cardApplies(id, ctx, selection),
    resolveScope: (ctx) => cardResolveScope(id, ctx) ?? { from: 0, to: 0 },
    run: isCitation ? citationRun : isFootnote ? footnoteRun : (ctx) => cardRun(id, ctx),
  };
}

/**
 * The typed-LaTeX input-rule patterns the citation row recognizes, recorded
 * here as the SSOT join between the registry and `citation.ts`. The row's
 * scalar `inputRulePattern` slot holds the FULL form (`\cite{key}`); the bare
 * form (`\cite ` with no braces yet) is the second trigger. Both are imported
 * from `@/lib/cite-commands` so the registry and the live input rule can never
 * recognize a different cite vocabulary.
 */
export const CITATION_INPUT_RULE_PATTERNS: readonly RegExp[] = [
  CITE_RE_FULL,
  CITE_RE_BARE,
];

/**
 * The typed-LaTeX footnote trigger, re-exported here as the SSOT join between
 * the registry and `footnote.ts`. The footnote row's `inputRulePattern` holds
 * this same `\footnote{…}` regex; `footnote.ts`'s input rule imports it from
 * `@/lib/footnote-commands` (the shared leaf) so the registry and the live
 * input rule can never recognize a different footnote vocabulary. Unlike
 * citation there is no bare form — a footnote has no partial-command path.
 */
export { FOOTNOTE_INPUT_RULE_PATTERN };

/** The 11 card ids, in canonical MENU-DISPLAY order — derived from
 *  `CARD_ACTION_ORDER` (the insertion order of `CARD_ACTION_PRESENTATION`,
 *  which mirrors the former `MENU_ENTRIES` order). Equal to `CardActionId` —
 *  pinned by the coverage assertion. The menus iterate this same order via
 *  `cardActionRows()` so the registry and the live menus can never disagree. */
const CARD_ACTION_IDS: readonly CardActionId[] = CARD_ACTION_ORDER;

/**
 * The SSOT map. `Partial<Record<…>>` so consumers tolerate not-yet-migrated
 * ids (treated as "absent"). CHIP 2 populates the 11 CARD rows as delegating
 * wrappers; the slash / block / format / typed ids are still pending (later
 * chips). `assertActionCoverage` partitions covered (card) vs expected-pending.
 */
export const VIRGIL_ACTION_REGISTRY: Partial<Record<ActionId, ActionSpec>> =
  Object.fromEntries([
    ...CARD_ACTION_IDS.map((id) => [id, cardRow(id)] as const),
    // CHIP 5a: the 4 heading rows (pure-PM block actions; slash + lightning).
    ...HEADING_ACTION_IDS.map((id) => [id, headingRow(id)] as const),
    // CHIP 5b: the single `tex` row (pure-PM block action; slash + lightning).
    ["tex", TEX_ACTION_ROW] as const,
    // CHIP 5c: the single `example` row (pure-PM block insert; slash + lightning).
    ["example", EXAMPLE_ACTION_ROW] as const,
    // CHIP 6a: the 4 block-ATOM grid rows (lightning-only — no slash/typed/grab).
    // math WRAPS the selection; figure/graphics INSERT via `smartInsertBlock`.
    ["inline-math", INLINE_MATH_ACTION_ROW] as const,
    ["display-math", DISPLAY_MATH_ACTION_ROW] as const,
    ["figure", FIGURE_ACTION_ROW] as const,
    ["graphics", GRAPHICS_ACTION_ROW] as const,
    // CHIP 6b: the 8 FORMAT grid rows (lightning-only; `backbone: "tiptap-chain"`).
    // The mark/list/quote toggles + text-color — completing the grid fold (every
    // grid cell now renders from the registry).
    ...FORMAT_ACTION_IDS.map((id) => [id, FORMAT_ACTION_ROWS[id]] as const),
    // CHIP 7a: the FINAL slices — `ref` (atom; slash `\ref` + the NEW lightning
    // 'Cross-ref' cell; `refRun` opens the LabelRef create-mode popover) and the
    // 3 title-field rows (pure-PM block inserts; SLASH-ONLY — no menu twin by
    // design; idempotent find-existing-or-insert; date pre-fills today). With
    // these every `ActionId` has a row — the registry is the COMPLETE SSOT.
    ["ref", REF_ACTION_ROW] as const,
    ...TITLE_ACTION_IDS.map((id) => [id, titleFieldRow(id)] as const),
  ]) as Partial<Record<ActionId, ActionSpec>>;

// ---------------------------------------------------------------------------
// Menu views over the registry — the two live React menus (`DragHandleMenu`,
// `ActionsMenuPanel`) render the CARD action list off THIS (CHIP 3), instead
// of off the deleted `MENU_ENTRIES` array. The registry is the SSOT; the
// menus are thin views.
// ---------------------------------------------------------------------------

/**
 * The CARD action rows, in canonical menu-display order, that a given surface
 * exposes — the SSOT the grab-bar / lightning menus iterate to render their
 * action list. Filters to `category === "card"` rows whose `surfaces[surface]`
 * flag is set, preserving `CARD_ACTION_ORDER` (the former `MENU_ENTRIES`
 * order). Both menus currently pass the same set of card rows (grab and
 * lightning are byte-identical lists); the `surface` arg keeps the view honest
 * if a future row opts off one surface.
 *
 * Pure + cheap (an 11-row filter); called at menu-open, never per keystroke.
 */
export function cardActionRows(
  surface: "grab" | "lightning",
): readonly ActionSpec[] {
  return CARD_ACTION_ORDER.map((id) => VIRGIL_ACTION_REGISTRY[id]).filter(
    (row): row is ActionSpec =>
      !!row && row.category === "card" && !!row.surfaces[surface],
  );
}

/**
 * The FORMAT rows, in grid render order, that the lightning grid exposes (CHIP
 * 6b) — the SSOT the grid's mark/list/quote/text-color cells render from,
 * completing the grid fold. Filters to `category === "format"` rows on the
 * lightning surface, preserving `FORMAT_ACTION_IDS` (the grid layout order).
 * Every format row is lightning-only today, so the surface arg is implicit
 * (lightning); kept as a 0-arg accessor mirroring how the grid consumes it.
 *
 * Pure + cheap (an 8-row lookup); called at menu-open, never per keystroke.
 */
export function formatActionRows(): readonly ActionSpec[] {
  return FORMAT_ACTION_IDS.map((id) => VIRGIL_ACTION_REGISTRY[id]).filter(
    (row): row is ActionSpec =>
      !!row && row.category === "format" && !!row.surfaces.lightning,
  );
}

// ---------------------------------------------------------------------------
// Coverage assertion — DEV-ONLY, NOT YET WIRED.
// ---------------------------------------------------------------------------

/**
 * The set of `ActionId`s that MUST have a registry row once population is
 * complete — encoded as a manifest because not every source list is cleanly
 * importable as a flat string array (the slash names fan out 4→1 for
 * headings; the typed/format/stray surfaces have no single exported list).
 * The assertion below cross-checks the importable lists (`VIRGIL_COMMAND_NAMES`
 * + the populated registry rows) against this manifest, so the manifest and
 * the live sources can't silently diverge. (As of CHIP 3 the card rows OWN
 * their label/letter/icon via `CARD_ACTION_PRESENTATION` — the registry is the
 * SSOT and the two live menus render off it; the former `MENU_ENTRIES` array
 * is gone.)
 *
 * Provenance of each entry (the four surfaces). As of CHIP 7a this manifest is
 * FULLY covered — every id has a registry row (the registry is the COMPLETE
 * SSOT):
 *   - 11 card ids       ← the card vocabulary (grab + lightning menus)
 *   - ref               ← `\ref` slash + the lightning 'Cross-ref' grid cell (CHIP 7a)
 *   - 4 heading ids     ← `\chapter/\section/\subsection/\subsubsection` + dropdown
 *   - example           ← `\ex` slash + lightning grid `ex` cell (CHIP 5c)
 *   - tex               ← `\tex` slash + lightning grid
 *   - figure / graphics ← lightning grid (no slash today)
 *   - inline/display-math ← lightning grid math buttons
 *   - title/author/date ← `\title/\author/\date` slash (SLASH-ONLY by design —
 *                          a titleField is a doc-top singleton, no menu twin; CHIP 7a)
 *   - 8 format ids      ← lightning formatting grid (bold/italic/strike/code/
 *                          bullet-list/ordered-list/blockquote/text-color)
 */
const EXPECTED_ACTION_IDS: readonly ActionId[] = [
  // card (11)
  "highlight", "note", "footnote", "citation", "todo", "suggest-edit",
  "cutter", "report", "duplicate", "archive", "delete",
  // atom (1)
  "ref",
  // block / structural
  "heading-chapter", "heading-section", "heading-subsection",
  "heading-subsubsection", "example", "tex", "figure", "graphics",
  "inline-math", "display-math",
  // title fields (3)
  "title", "author", "date",
  // format marks (8)
  "bold", "italic", "strike", "code", "bullet-list", "ordered-list",
  "blockquote", "text-color",
];

/**
 * Map a `VIRGIL_COMMAND_NAMES` entry (the slash command name, no backslash)
 * to the `ActionId` that should own it. This is the one place the slash
 * vocabulary is reconciled with the action vocabulary — every command name
 * MUST map to a known id, and every mapped id MUST have a registry row.
 *
 * `chapter/section/subsection/subsubsection` fan out to the four discrete
 * heading ids (see the HEADING ID SCHEME note on `BlockActionId`).
 */
const SLASH_NAME_TO_ACTION_ID: Readonly<Record<string, ActionId>> = {
  title: "title",
  author: "author",
  date: "date",
  chapter: "heading-chapter",
  section: "heading-section",
  subsection: "heading-subsection",
  subsubsection: "heading-subsubsection",
  ref: "ref",
  ex: "example",
  cite: "citation",
  footnote: "footnote",
  tex: "tex",
};

/**
 * The 11 card ids — the SUBSET of `EXPECTED_ACTION_IDS` this chip (CHIP 2)
 * actually populates. The remaining ids (atom / block / title / format) are
 * EXPECTED-PENDING: they get rows in later chips (4–7). `assertActionCoverage`
 * partitions on this set so the assertion can be green at the card milestone
 * without falsely flagging the not-yet-migrated surfaces.
 *
 * Equal to `CARD_ACTION_IDS` (the row-population list) but typed against the
 * `CardActionId` union so a drift between the two trips the typechecker.
 */
const COVERED_CARD_IDS: readonly CardActionId[] = CARD_ACTION_IDS;

/**
 * The 4 heading ids — the block slice CHIP 5a populates. Each owns the slash
 * surface (`\chapter` … `\subsubsection`) AND the lightning surface (the
 * BlockType dropdown), routes through the canonical SET+numbered `headingRun`,
 * and carries a `slashName` the assertion reconciles against
 * `VIRGIL_COMMAND_NAMES`. Like the card slice, this set moves these ids from
 * EXPECTED-PENDING to COVERED so step (4) doesn't flag the new rows as
 * out-of-order. Typed against the heading subset of `BlockActionId` so a drift
 * trips the typechecker.
 */
const COVERED_HEADING_IDS: readonly (BlockActionId & `heading-${string}`)[] =
  HEADING_ACTION_IDS;

/**
 * The non-heading block ids covered so far — CHIP 5b adds `tex`; CHIP 5c adds
 * `example`; CHIP 6a adds the 4 block-ATOM ids (`inline-math` / `display-math` /
 * `figure` / `graphics`). The tex/example rows own the slash surface (`\tex` /
 * `\ex`) AND the lightning surface; the 4 block-atom rows are LIGHTNING-ONLY (no
 * slash/typed/grab today — they're grid cells). Each routes through its canonical
 * pure-PM creator (`texRun` / `exampleRun` / `mathRun` / `figureRun` /
 * `graphicsRun`). Moves these ids from EXPECTED-PENDING to COVERED so step (4)
 * doesn't flag the new rows as out-of-order. Typed against `BlockActionId` so a
 * drift trips the typechecker.
 */
const COVERED_BLOCK_IDS: readonly BlockActionId[] = [
  "tex",
  "example",
  "inline-math",
  "display-math",
  "figure",
  "graphics",
];

/**
 * The block ids that own the SLASH surface (tex `\tex`, example `\ex`) — the
 * subset of `COVERED_BLOCK_IDS` whose rows must claim `surfaces.slash` + a
 * `slashName` reconciled against `VIRGIL_COMMAND_NAMES`. The CHIP 6a block-atom
 * rows (`inline-math` / `display-math` / `figure` / `graphics`) are GRID-ONLY:
 * they must claim `surfaces.lightning` and must NOT claim slash/typed/grab. The
 * assertion partitions on this set so a lightning-only row isn't wrongly flagged
 * for missing a slashName.
 */
const BLOCK_IDS_WITH_SLASH: ReadonlySet<BlockActionId> = new Set<BlockActionId>([
  "tex",
  "example",
]);

/**
 * The 8 format ids — the slice CHIP 6b populates, completing the GRID fold. Each
 * is `category: "format"`, `backbone: "tiptap-chain"`, and LIGHTNING-ONLY (the
 * grid; no slash/typed/grab — a mark toggle is not a slash command or an input
 * rule, and the keyboard bindings are owned by StarterKit, not this registry).
 * Moves these ids from EXPECTED-PENDING to COVERED so step (4) doesn't flag the
 * new rows as out-of-order. Typed against `FormatActionId` so a drift trips the
 * typechecker.
 */
const COVERED_FORMAT_IDS: readonly FormatActionId[] = FORMAT_ACTION_IDS;

/**
 * The single ATOM id — `ref` — the slice CHIP 7a populates. `category: "atom"`,
 * exposed on the slash surface (`\ref`) AND the lightning surface (the new
 * 'Cross-ref' grid cell). Routes through `refRun` → `ctx.openRefPopover()` (the
 * LabelRef create-mode popover is the creator). Moves `ref` from EXPECTED-
 * PENDING to COVERED. Typed against `AtomActionId` so a drift trips the
 * typechecker.
 */
const COVERED_ATOM_IDS: readonly AtomActionId[] = ["ref"];

/**
 * The 3 TITLE-field ids — `title` / `author` / `date` — the slice CHIP 7a
 * populates, COMPLETING the registry (every `ActionId` now has a row). Each is
 * `category: "block"` and SLASH-ONLY (`\title` / `\author` / `\date`; no menu/
 * typed/keyboard twin — a titleField is a doc-top singleton, not a card). Routes
 * through the idempotent `titleFieldRun` (find-existing-or-insert; date pre-fills
 * today). Moves these ids from EXPECTED-PENDING to COVERED. Typed against
 * `TitleActionId` so a drift trips the typechecker.
 */
const COVERED_TITLE_IDS: readonly TitleActionId[] = TITLE_ACTION_IDS;

/**
 * The card ids that ALSO own the PM-land surfaces (slash + typed): `citation`
 * (CHIP 4a-ii) and `footnote` (CHIP 4b). The other 9 card actions stay
 * grab/lightning-only (they have no slash/typed surface to migrate). The
 * assertion uses this set to flip the slash/typed checks from "must be absent"
 * (premature) to "must be present + reconciled" for exactly these ids.
 */
const CARD_IDS_WITH_PM_SURFACES: ReadonlySet<CardActionId> =
  new Set<CardActionId>(["citation", "footnote"]);

/**
 * DEV-ONLY coverage assertion — partitioned for the PHASED rollout.
 *
 * ── MILESTONE (CHIP 7a): the registry is the COMPLETE SSOT. ── Each chip
 * migrated a slice of the vocabulary onto the registry; this assertion grew a
 * `COVERED_*` partition per slice. As of CHIP 7a the FINAL slices land —
 * `ref` (atom) + `title`/`author`/`date` (title fields) — so the covered set now
 * EQUALS `EXPECTED_ACTION_IDS`. There are **ZERO pending ids**: every `ActionId`
 * has a registry row, and step (5) below ASSERTS that equality (covered ==
 * expected, both directions) so the registry can never silently fall short of
 * the full vocabulary again. The per-slice loops still run (they pin each row's
 * shape); the old "expected-pending" branch is now vacuous by construction.
 *
 * Verifies, for the CARD slice:
 *   1. every card id in `COVERED_CARD_IDS` has a registry row whose key === id;
 *   2. every card row is `category: "card"` and sets `surfaces.grab` AND
 *      `surfaces.lightning` with a non-empty single-letter `letter`;
 *   3. a card NOT in `CARD_IDS_WITH_PM_SURFACES` must NOT claim the slash/typed
 *      surfaces (still menu-owned); a card IN that set (citation) MUST set
 *      `surfaces.slash` + `surfaces.typed` AND carry a `slashName` +
 *      `inputRulePattern` (the PM-land join keys).
 *
 * And, for the (now-empty) pending vocabulary:
 *   4. nothing has a row outside the covered set (a stray/typo'd row). With the
 *      covered set == `EXPECTED_ACTION_IDS` this catches only an UNEXPECTED row.
 *   5. (CHIP 7a) the covered set EQUALS `EXPECTED_ACTION_IDS` in BOTH directions
 *      — no expected id is left uncovered, and no covered id is unexpected. This
 *      is the COMPLETE-SSOT guard: a new `ActionId` added to the union without a
 *      `COVERED_*` entry (or vice-versa) trips here.
 *
 * The slash reconciliation against `VIRGIL_COMMAND_NAMES` pins, for every live
 * slash command, that its target row exists + opted into the slash surface +
 * named the same command.
 *
 * Returns a list of GENUINELY-UNEXPECTED problems (empty ⇒ the full vocabulary
 * is covered + each row's shape is sound). Returns `[]` in production.
 *
 * WIRED: invoked from a vitest (`action-coverage-assertion.test.ts`),
 * mirroring `lifecycle-coverage-assertion.test.ts`, so a missing / mis-flagged
 * row trips CI.
 */
export function assertActionCoverage(): string[] {
  if (process.env.NODE_ENV === "production") return [];
  const problems: string[] = [];
  const covered = new Set<ActionId>([
    ...COVERED_CARD_IDS,
    ...COVERED_HEADING_IDS,
    ...COVERED_BLOCK_IDS,
    ...COVERED_FORMAT_IDS,
    ...COVERED_ATOM_IDS,
    ...COVERED_TITLE_IDS,
  ]);

  // (1)+(2)+(3) the CARD slice is fully + correctly covered.
  for (const id of COVERED_CARD_IDS) {
    const row = VIRGIL_ACTION_REGISTRY[id];
    if (!row) {
      problems.push(`[actions] missing registry row for covered card id "${id}"`);
      continue;
    }
    if (row.id !== id) {
      problems.push(`[actions] row keyed "${id}" has mismatched id "${row.id}"`);
    }
    if (row.category !== "card") {
      problems.push(
        `[actions] card id "${id}" has category "${row.category}" (expected "card")`,
      );
    }
    if (!row.surfaces.grab || !row.surfaces.lightning) {
      problems.push(
        `[actions] card id "${id}" must set surfaces.grab AND surfaces.lightning`,
      );
    }
    if (!row.letter || row.letter.length < 1) {
      problems.push(`[actions] card id "${id}" is missing its menu letter`);
    }
    if (CARD_IDS_WITH_PM_SURFACES.has(id)) {
      // CHIP 4a-ii: this card owns the slash + typed surfaces. It MUST claim
      // them and carry the PM-land join keys, or the bridge's `runAction` and
      // the `citation.ts` input rule can't reconcile back to this row.
      if (!row.surfaces.slash || !row.surfaces.typed) {
        problems.push(
          `[actions] card id "${id}" must set surfaces.slash AND surfaces.typed (it owns the PM-land surfaces)`,
        );
      }
      if (!row.slashName) {
        problems.push(
          `[actions] card id "${id}" sets surfaces.slash but is missing slashName`,
        );
      }
      if (!row.inputRulePattern) {
        problems.push(
          `[actions] card id "${id}" sets surfaces.typed but is missing inputRulePattern`,
        );
      }
    } else {
      // The remaining card actions do NOT yet own the slash / typed surfaces —
      // those migrate in a later chip. A premature flag here would mean the
      // row got ahead of the surface that actually reads it.
      if (row.surfaces.slash) {
        problems.push(
          `[actions] card id "${id}" prematurely sets surfaces.slash (a later chip owns the slash surface)`,
        );
      }
      if (row.surfaces.typed) {
        problems.push(
          `[actions] card id "${id}" prematurely sets surfaces.typed (a later chip owns the typed-LaTeX surface)`,
        );
      }
    }
  }

  // (3b) the HEADING slice (CHIP 5a) is fully + correctly covered. Each heading
  // row must be `category: "block"`, claim the slash AND lightning surfaces, and
  // carry a `slashName` (the PM-land join key reconciled below against
  // `VIRGIL_COMMAND_NAMES`). Headings have NO grab/typed/keyboard surface.
  for (const id of COVERED_HEADING_IDS) {
    const row = VIRGIL_ACTION_REGISTRY[id];
    if (!row) {
      problems.push(`[actions] missing registry row for covered heading id "${id}"`);
      continue;
    }
    if (row.id !== id) {
      problems.push(`[actions] row keyed "${id}" has mismatched id "${row.id}"`);
    }
    if (row.category !== "block") {
      problems.push(
        `[actions] heading id "${id}" has category "${row.category}" (expected "block")`,
      );
    }
    if (!row.surfaces.slash || !row.surfaces.lightning) {
      problems.push(
        `[actions] heading id "${id}" must set surfaces.slash AND surfaces.lightning`,
      );
    }
    if (row.surfaces.grab || row.surfaces.typed) {
      problems.push(
        `[actions] heading id "${id}" claims a grab/typed surface it does not expose`,
      );
    }
    if (!row.slashName) {
      problems.push(
        `[actions] heading id "${id}" sets surfaces.slash but is missing slashName`,
      );
    }
  }

  // (3c) the non-heading BLOCK slice (CHIP 5b: `tex`; 5c: `example`; 6a: the 4
  // block-ATOM rows) is fully + correctly covered. Each block row must be
  // `category: "block"`, claim `surfaces.lightning` (every block row is on the
  // grid), and never claim grab/typed (a block insert is not a grab-handle
  // action and has no `\block{}`-style input rule). The SLASH surface is
  // PARTITIONED: tex/example (in `BLOCK_IDS_WITH_SLASH`) MUST claim
  // `surfaces.slash` + a `slashName` (reconciled below against
  // `VIRGIL_COMMAND_NAMES`); the CHIP 6a block-atom rows are GRID-ONLY and must
  // NOT claim slash.
  for (const id of COVERED_BLOCK_IDS) {
    const row = VIRGIL_ACTION_REGISTRY[id];
    if (!row) {
      problems.push(`[actions] missing registry row for covered block id "${id}"`);
      continue;
    }
    if (row.id !== id) {
      problems.push(`[actions] row keyed "${id}" has mismatched id "${row.id}"`);
    }
    if (row.category !== "block") {
      problems.push(
        `[actions] block id "${id}" has category "${row.category}" (expected "block")`,
      );
    }
    if (!row.surfaces.lightning) {
      problems.push(
        `[actions] block id "${id}" must set surfaces.lightning (every block row is a grid cell)`,
      );
    }
    if (row.surfaces.grab || row.surfaces.typed || row.surfaces.keyboard) {
      problems.push(
        `[actions] block id "${id}" claims a grab/typed/keyboard surface it does not expose`,
      );
    }
    if (BLOCK_IDS_WITH_SLASH.has(id)) {
      // tex / example own the slash surface (`\tex` / `\ex`).
      if (!row.surfaces.slash) {
        problems.push(
          `[actions] block id "${id}" must set surfaces.slash (it owns the slash surface)`,
        );
      }
      if (!row.slashName) {
        problems.push(
          `[actions] block id "${id}" sets surfaces.slash but is missing slashName`,
        );
      }
    } else {
      // The CHIP 6a block-atom rows are grid-only — slash migrates in a later
      // chip (if ever). A premature slash flag would get ahead of that surface.
      if (row.surfaces.slash) {
        problems.push(
          `[actions] block id "${id}" prematurely sets surfaces.slash (it is grid-only today)`,
        );
      }
    }
  }

  // (3d) the FORMAT slice (CHIP 6b) is fully + correctly covered — this is the
  // milestone that completes the GRID fold (every grid cell now renders from the
  // registry). Each format row must be `category: "format"`, declare
  // `backbone: "tiptap-chain"` (the explicit record that it is backbone-less —
  // a pure `editor.chain()` call, no Virgil SSOT), claim `surfaces.lightning`
  // (every format cell is a grid cell), and never claim slash/typed/grab/keyboard
  // (a mark toggle is not a slash command or an input rule; its keybindings are
  // owned by StarterKit, not this registry).
  for (const id of COVERED_FORMAT_IDS) {
    const row = VIRGIL_ACTION_REGISTRY[id];
    if (!row) {
      problems.push(`[actions] missing registry row for covered format id "${id}"`);
      continue;
    }
    if (row.id !== id) {
      problems.push(`[actions] row keyed "${id}" has mismatched id "${row.id}"`);
    }
    if (row.category !== "format") {
      problems.push(
        `[actions] format id "${id}" has category "${row.category}" (expected "format")`,
      );
    }
    if (row.backbone !== "tiptap-chain") {
      problems.push(
        `[actions] format id "${id}" must declare backbone "tiptap-chain" (it is intentionally backbone-less)`,
      );
    }
    if (!row.surfaces.lightning) {
      problems.push(
        `[actions] format id "${id}" must set surfaces.lightning (every format cell is a grid cell)`,
      );
    }
    if (
      row.surfaces.grab ||
      row.surfaces.slash ||
      row.surfaces.typed ||
      row.surfaces.keyboard
    ) {
      problems.push(
        `[actions] format id "${id}" claims a grab/slash/typed/keyboard surface it does not expose`,
      );
    }
  }

  // (3e) the ATOM slice (CHIP 7a: `ref`) is fully + correctly covered. The `ref`
  // row must be `category: "atom"`, claim the slash (`\ref`) AND lightning (the
  // 'Cross-ref' grid cell) surfaces with a `slashName` (reconciled below against
  // `VIRGIL_COMMAND_NAMES`), and never claim grab/typed/keyboard (a cross-ref is
  // not a grab-handle action and has no `\ref{}`-style typed input rule).
  for (const id of COVERED_ATOM_IDS) {
    const row = VIRGIL_ACTION_REGISTRY[id];
    if (!row) {
      problems.push(`[actions] missing registry row for covered atom id "${id}"`);
      continue;
    }
    if (row.id !== id) {
      problems.push(`[actions] row keyed "${id}" has mismatched id "${row.id}"`);
    }
    if (row.category !== "atom") {
      problems.push(
        `[actions] atom id "${id}" has category "${row.category}" (expected "atom")`,
      );
    }
    if (!row.surfaces.slash || !row.surfaces.lightning) {
      problems.push(
        `[actions] atom id "${id}" must set surfaces.slash AND surfaces.lightning`,
      );
    }
    if (row.surfaces.grab || row.surfaces.typed || row.surfaces.keyboard) {
      problems.push(
        `[actions] atom id "${id}" claims a grab/typed/keyboard surface it does not expose`,
      );
    }
    if (!row.slashName) {
      problems.push(
        `[actions] atom id "${id}" sets surfaces.slash but is missing slashName`,
      );
    }
  }

  // (3f) the TITLE-field slice (CHIP 7a: `title` / `author` / `date`) is fully +
  // correctly covered — the FINAL slice; with it every `ActionId` has a row. Each
  // title row must be `category: "block"`, claim the slash surface ONLY (`\title`
  // / `\author` / `\date`) with a `slashName` (reconciled below against
  // `VIRGIL_COMMAND_NAMES`), and never claim grab/lightning/typed/keyboard — a
  // titleField is a doc-top singleton with NO menu twin by design (a legitimate
  // asymmetry the registry MODELS, not a missing surface).
  for (const id of COVERED_TITLE_IDS) {
    const row = VIRGIL_ACTION_REGISTRY[id];
    if (!row) {
      problems.push(`[actions] missing registry row for covered title id "${id}"`);
      continue;
    }
    if (row.id !== id) {
      problems.push(`[actions] row keyed "${id}" has mismatched id "${row.id}"`);
    }
    if (row.category !== "block") {
      problems.push(
        `[actions] title id "${id}" has category "${row.category}" (expected "block")`,
      );
    }
    if (!row.surfaces.slash) {
      problems.push(
        `[actions] title id "${id}" must set surfaces.slash (it owns the slash surface)`,
      );
    }
    if (
      row.surfaces.grab ||
      row.surfaces.lightning ||
      row.surfaces.typed ||
      row.surfaces.keyboard
    ) {
      problems.push(
        `[actions] title id "${id}" claims a grab/lightning/typed/keyboard surface it does not expose (slash-only by design)`,
      );
    }
    if (!row.slashName) {
      problems.push(
        `[actions] title id "${id}" sets surfaces.slash but is missing slashName`,
      );
    }
  }

  // (4) nothing PENDING has leaked in ahead of its chip. As of CHIP 7a the
  // covered set EQUALS `EXPECTED_ACTION_IDS` — every ActionId has a registry row,
  // so the registry is the COMPLETE SSOT and this loop has ZERO pending ids to
  // skip (it now only catches an unexpected/typo'd row). See the milestone note
  // on `assertActionCoverage`.
  for (const id of EXPECTED_ACTION_IDS) {
    if (covered.has(id)) continue;
    if (VIRGIL_ACTION_REGISTRY[id]) {
      problems.push(
        `[actions] id "${id}" has a registry row but is not yet in the covered set ` +
          `— a chip populated it out of order (widen COVERED_* or remove the row)`,
      );
    }
  }

  // (5) COMPLETE-SSOT guard (CHIP 7a): the covered set EQUALS `EXPECTED_ACTION_IDS`
  // — ZERO pending ids, in BOTH directions.
  //   (a) every expected id is covered (nothing left to migrate); AND
  //   (b) every covered id is expected (no covered id outside the manifest).
  // After this chip these must both be empty. If a future chip adds an `ActionId`
  // to the union, it MUST add it to `EXPECTED_ACTION_IDS` + a `COVERED_*` entry +
  // a row — otherwise this guard trips, keeping the registry a COMPLETE SSOT.
  const expectedSet = new Set<ActionId>(EXPECTED_ACTION_IDS);
  for (const id of EXPECTED_ACTION_IDS) {
    if (!covered.has(id)) {
      problems.push(
        `[actions] expected id "${id}" is NOT covered — the registry is no longer a complete SSOT ` +
          `(add it to a COVERED_* slice + give it a row)`,
      );
    }
  }
  for (const id of covered) {
    if (!expectedSet.has(id)) {
      problems.push(
        `[actions] covered id "${id}" is not in EXPECTED_ACTION_IDS ` +
          `(add it to the manifest, or remove it from its COVERED_* slice)`,
      );
    }
  }

  // (data + slash reconciliation) every live slash command name resolves to a
  // known target id (the mapping table is complete).
  //
  // As of CHIP 7a EVERY slash command's target row has migrated its slash
  // surface, so for each name we pin the row ↔ name correspondence: the target
  // row must exist, claim `surfaces.slash`, and name the same command — so a
  // typed `\<name>` can never silently land on a row that forgot to claim slash
  // OR named a different command. (The `!row || !row.surfaces.slash` skip below
  // is now defensive only — no live name should hit it.)
  for (const name of VIRGIL_COMMAND_NAMES) {
    const id = SLASH_NAME_TO_ACTION_ID[name];
    if (!id) {
      problems.push(
        `[actions] slash command "\\${name}" has no SLASH_NAME_TO_ACTION_ID mapping`,
      );
      continue;
    }
    if (!EXPECTED_ACTION_IDS.includes(id)) {
      problems.push(
        `[actions] slash command "\\${name}" maps to "${id}", which is not an expected action id`,
      );
      continue;
    }
    const row = VIRGIL_ACTION_REGISTRY[id];
    // Not-yet-migrated (no row, or a row that hasn't opted into slash) →
    // expected-pending; its surface checks land with its chip.
    if (!row || !row.surfaces.slash) continue;
    if (row.slashName !== name) {
      problems.push(
        `[actions] slash command "\\${name}" maps to "${id}", whose slashName is "${row.slashName ?? "(unset)"}" (expected "${name}")`,
      );
    }
  }

  return problems;
}
