/**
 * ACTION_REGISTRY — the single source of truth for every editing
 * "action / tool" Virgil exposes across its FOUR action surfaces.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * STATUS (CHIP 3 — REGISTRY IS THE SSOT THE LIVE MENUS RENDER FROM). The
 * module defines the TYPES, the coverage assertion, the PM→React bridge
 * CONTRACT, and the 11 CARD-action rows. Each card `run()` DELEGATES to the
 * existing grab-bar dispatcher (`ctx.dispatch`), so live *behavior* is
 * byte-identical to today — ZERO behavior change. CHIP 3 INVERTED the menu
 * dependency: the card rows now OWN their presentation (label / letter / icon
 * / separator / destructive, in `action-icons.tsx`), the former `MENU_ENTRIES`
 * array is deleted, and the two live menus (`DragHandleMenu` /
 * `ActionsMenuPanel`) render their action list via `cardActionRows(surface)`
 * — thin views over this registry. The slash / block / title / format ids are
 * EXPECTED-PENDING (later chips). The coverage assertion is ARMED for the card
 * slice via a vitest (`action-coverage-assertion.test.ts`).
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
 *      `EditorView` ONLY — **no React context**. `\cite` (CHIP 4a-ii) and
 *      `\footnote` (CHIP 4b) now reach React-land via the typed
 *      `EditorActionsHandle` bridge (`runAction(id, seed)`); the remaining
 *      commands still ride `window` CustomEvents (`virgil-ref-create`,
 *      `virgil-ex-create`).
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
// VALUE import: the canonical collision-free short-id minter. `texRun` (the
// raw-LaTeX block creator) mints a fresh `uuid` for the new `texBlock` the SAME
// way every other node creator does (slash `\cite`/`\title`, the grid's
// `freshTexBlockAttrs`). A plain string-id leaf — no React/DOM/TipTap — so the
// value import is free for every consumer of this registry.
import { generateShortId } from "@/lib/uuid";
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
  panelRouting?: {
    prefs: ViewPrefs;
    setActiveLeft: (id: PanelId) => void;
    setActiveRight: (id: PanelId) => void;
    focusCard: (cardKey: string) => void;
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
 * ── REPLACES ── this ONE typed entrypoint supersedes the scattered `window`
 * CustomEvent seams currently used to cross the boundary:
 *   - `virgil-citation-create`   (commands.ts → command-input.ts + citations-host.tsx)
 *   - `virgil-footnote-input`    (commands.ts → command-input.ts)
 *   - `virgil-ex-create`         (commands.ts → command-input.ts)
 *   - `virgil-ref-create`        (commands.ts → command-input.ts)
 *   - `virgil-footnote-created`  (command-input.ts → panel scroll-to-new)
 * plus the two citation listeners (`command-input.ts` and `citations-host.tsx`
 * both bind `virgil-citation-create`). Those untyped string events become
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
 *     grey-out) OR — for `highlight` — the ref has no live range (cursor mode);
 *   - `"ok"` otherwise.
 *
 * Never returns `"absent"`: the card actions are present on every grab /
 * lightning menu (greyed when inapplicable), matching the live "visible-
 * disabled" decoration rather than filtering entries away.
 */
function cardApplies(id: CardActionId, ctx: ActionContext): "ok" | "disabled" {
  if (!kindAllowsCardAction(ctx.ref, id)) return "disabled";
  // Highlight needs a range to wrap (the one cursor-mode grey-out among the
  // card actions — F/C etc. collapse-and-insert at a caret, so they stay
  // enabled). Mirrors `ActionsMenuPanel`'s `mode === "cursor"` highlight gate.
  if (id === "highlight" && !refHasLiveRange(ctx.ref)) return "disabled";
  return "ok";
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
  const { state } = ctx.view;
  const texBlockType = state.schema.nodes.texBlock;
  if (!texBlockType) return;
  const { from, to, empty } = state.selection;
  const seedCode = empty
    ? ""
    : state.doc.textBetween(from, to, "\n", (node) =>
        node.type.name === "hardBreak" ? "\n" : "",
      );
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
  surfaces: { slash: true, lightning: true },
  slashName: "tex",
  applies: (ctx) => {
    const ref = ctx.ref;
    if (ref.kind === "selection" || ref.kind === "cursor") return "ok";
    if (!isTextObjectKind(ref.kind)) return "ok"; // defensive: unknown → allow
    return TEXT_OBJECT_REGISTRY[ref.kind].isAtomBlock ? "disabled" : "ok";
  },
  run: texRun,
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
    surfaces: { slash: true, lightning: true },
    slashName,
    applies: (ctx) => {
      const ref = ctx.ref;
      // A selection / caret always sits in a text block → convertible.
      if (ref.kind === "selection" || ref.kind === "cursor") return "ok";
      // A TextObjectRef: only text-bearing blocks convert to a heading. An
      // atom block (figure / displayMath / texBlock) has no text → disabled.
      if (!isTextObjectKind(ref.kind)) return "ok"; // defensive: unknown → allow
      const meta = TEXT_OBJECT_REGISTRY[ref.kind];
      return meta.isAtomBlock ? "disabled" : "ok";
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
  return {
    id,
    label: p.label,
    letter: p.letter,
    icon: p.icon,
    separator: p.separator,
    destructive: p.destructive,
    category: "card",
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
    applies: (ctx) => cardApplies(id, ctx),
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
 * Provenance of each entry (the four surfaces + the strays):
 *   - 11 card ids       ← the card vocabulary (grab + lightning menus)
 *   - ref               ← `\ref` slash command
 *   - 4 heading ids     ← `\chapter/\section/\subsection/\subsubsection`
 *   - example           ← `\ex` slash + the STRAY `insertExampleAtCursor`
 *                          MenuBar control (an as-yet-UN-unified surface —
 *                          flagged here so CHIP 2 folds it in)
 *   - tex               ← `\tex` slash + lightning grid
 *   - figure / graphics ← lightning grid (no slash today)
 *   - inline/display-math ← lightning grid math buttons
 *   - title/author/date ← `\title/\author/\date` slash
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
 * The non-heading block ids covered so far — CHIP 5b adds `tex`. Each owns the
 * slash surface (`\tex`) AND the lightning surface (the grid `\tex` cell),
 * routes through the canonical pure-PM `texRun` (seed-from-selection), and
 * carries a `slashName` the assertion reconciles against `VIRGIL_COMMAND_NAMES`.
 * Moves these ids from EXPECTED-PENDING to COVERED so step (4) doesn't flag the
 * new rows as out-of-order. Typed against `BlockActionId` so a drift trips the
 * typechecker. (`example` / `figure` / `graphics` / `inline-math` /
 * `display-math` stay pending for later chips.)
 */
const COVERED_BLOCK_IDS: readonly BlockActionId[] = ["tex"];

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
 * Each chip migrates a slice of the vocabulary onto the registry; this
 * assertion checks ONLY the slice that is supposed to be live, and reports
 * the rest as expected-pending (not as failures). The live slice is the 11
 * CARD actions on grab + lightning, PLUS — as of CHIP 4a-ii — `citation` on
 * the slash + typed surfaces.
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
 * And, for the still-PENDING vocabulary (everything in `EXPECTED_ACTION_IDS`
 * NOT in `COVERED_CARD_IDS`):
 *   4. it must NOT yet have a row (a premature row means a chip landed out of
 *      order). The slash reconciliation against `VIRGIL_COMMAND_NAMES` checks,
 *      for the migrated slash ids, that the target row exists + opted into the
 *      slash surface; for not-yet-migrated names it only checks the mapping
 *      table is complete (a pure-data check independent of population order).
 *
 * Returns a list of GENUINELY-UNEXPECTED problems (empty ⇒ the covered slice
 * is sound and nothing pending leaked in). Returns `[]` in production.
 *
 * WIRED: invoked from a vitest (`action-coverage-assertion.test.ts`),
 * mirroring `lifecycle-coverage-assertion.test.ts`, so a missing / mis-flagged
 * card row trips CI. A later chip widens `COVERED_*` /
 * `CARD_IDS_WITH_PM_SURFACES` as each surface migrates.
 */
export function assertActionCoverage(): string[] {
  if (process.env.NODE_ENV === "production") return [];
  const problems: string[] = [];
  const covered = new Set<ActionId>([
    ...COVERED_CARD_IDS,
    ...COVERED_HEADING_IDS,
    ...COVERED_BLOCK_IDS,
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

  // (3c) the non-heading BLOCK slice (CHIP 5b: `tex`) is fully + correctly
  // covered. Each block row must be `category: "block"`, claim the slash AND
  // lightning surfaces, and carry a `slashName` (the PM-land join key reconciled
  // below against `VIRGIL_COMMAND_NAMES`). Like headings, these have NO
  // grab/typed/keyboard surface (a raw-LaTeX block is not a grab-handle action
  // and has no `\tex{}`-style input rule).
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
    if (!row.surfaces.slash || !row.surfaces.lightning) {
      problems.push(
        `[actions] block id "${id}" must set surfaces.slash AND surfaces.lightning`,
      );
    }
    if (row.surfaces.grab || row.surfaces.typed) {
      problems.push(
        `[actions] block id "${id}" claims a grab/typed surface it does not expose`,
      );
    }
    if (!row.slashName) {
      problems.push(
        `[actions] block id "${id}" sets surfaces.slash but is missing slashName`,
      );
    }
  }

  // (4) nothing PENDING has leaked in ahead of its chip.
  for (const id of EXPECTED_ACTION_IDS) {
    if (covered.has(id)) continue;
    if (VIRGIL_ACTION_REGISTRY[id]) {
      problems.push(
        `[actions] id "${id}" has a registry row but is not yet in the covered set ` +
          `— a chip populated it out of order (widen COVERED_* or remove the row)`,
      );
    }
  }

  // (data + slash reconciliation) every live slash command name resolves to a
  // known target id (the mapping table is complete — a population-order-
  // independent check that stays armed regardless of which chip we're on).
  //
  // For a slash command whose target row has ALREADY MIGRATED its slash surface
  // (today: only `citation`), additionally pin the row ↔ name correspondence
  // so a typed `\cite` can never silently land on a row that forgot to claim
  // slash OR named a different command. A row is considered migrated iff it
  // sets `surfaces.slash` — so a card row that exists for grab/lightning only
  // (e.g. `footnote`, whose `\footnote` migrates in a LATER chip) is correctly
  // treated as expected-pending and skipped here.
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
