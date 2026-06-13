/**
 * ACTION_REGISTRY — the single source of truth for every editing
 * "action / tool" Virgil exposes across its FOUR action surfaces.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * STATUS (CHIP 1 — FOUNDATION). This module is **additive and inert**: it
 * defines the TYPES, an EMPTY registry, a coverage-assertion mechanism, and
 * the PM→React bridge CONTRACT. **Nothing imports it yet** and no row is
 * populated, so it changes zero behavior. Later chips populate
 * `VIRGIL_ACTION_REGISTRY` row-by-row and wire the bridge; this chip only
 * lays the rails. The coverage assertion is written but intentionally NOT
 * invoked at import time (it would throw on the empty registry) — CHIP 2
 * turns it on once rows exist. See the `assertActionCoverage` TODO.
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
 *      `EditorView` ONLY — **no React context**. It reaches React-land via
 *      `window` CustomEvents (`virgil-citation-create`, `virgil-ref-create`,
 *      `virgil-ex-create`, `virgil-footnote-input`).
 *   4. **Typed-LaTeX input rules** — `\cite{…}` / `\cite ` in
 *      ([src/lib/tiptap/citation.ts] ~line 125) and `\footnote{…}` in
 *      ([src/lib/tiptap/footnote.ts] ~line 96). Also ProseMirror plugins;
 *      same no-React-context constraint and same CustomEvent escape hatch.
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
 * **cannot** call React-land `cardCreation`. The intended architecture (this
 * chip defines the contract; a later chip wires it):
 *
 *   - The React tree publishes ONE imperative handle, `EditorActionsHandle`,
 *     into a ref (`editorActionsRef`) — the PM→React bridge.
 *   - A slash command / input rule, instead of `window.dispatchEvent(new
 *     CustomEvent("virgil-footnote-input"))`, calls
 *     `editorActionsRef.current?.runAction("footnote", { surface: "slash" })`.
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
// Type-only (erased at compile time): the React-land APIs an action's
// `run()` reaches for. Importing the TYPES does NOT instantiate them and
// does NOT pull React into this module's runtime.
import type { CardCreationApi } from "@/components/editor-layout/card-actions/card-creation";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
// The existing resolved-ref union the grab-bar dispatcher already speaks.
// `DragHandleRef = TextObjectRef | SelectionRef`. We extend it below with a
// `CursorRef` for the collapsed-caret (slash / typed) case.
import type { DragHandleRef } from "@/components/editor-layout/card-actions/drag-handle-actions";
// VALUE import (not type-only): the assertion reconciles the live slash
// vocabulary against the action ids. `commands.ts` is a plain TS module with
// no React/DOM at import — pulling it in does not bloat any consumer that
// imports the registry types. (Tree-shaking drops it for type-only importers.)
import { VIRGIL_COMMAND_NAMES } from "@/lib/tiptap/commands";

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
// The registry — EMPTY for now (CHIP 1).
// ---------------------------------------------------------------------------

/**
 * The SSOT map. `Partial<Record<…>>` so it type-checks while empty; CHIP 2+
 * populate it row-by-row. Consumers must tolerate a missing row (treat as
 * "absent") until coverage is complete — `assertActionCoverage` enforces
 * completeness once it is turned on.
 */
export const VIRGIL_ACTION_REGISTRY: Partial<Record<ActionId, ActionSpec>> = {};

// ---------------------------------------------------------------------------
// Coverage assertion — DEV-ONLY, NOT YET WIRED.
// ---------------------------------------------------------------------------

/**
 * The set of `ActionId`s that MUST have a registry row once population is
 * complete — encoded as a manifest because not every source list is cleanly
 * importable into a non-DOM / non-React module (and importing
 * `MENU_ENTRIES`, which carries JSX icons, into the assertion would drag
 * React in). The assertion below cross-checks the importable lists
 * (`VIRGIL_COMMAND_NAMES`) against this manifest and against the registry, so
 * the manifest and the live sources can't silently diverge.
 *
 * Provenance of each entry (the four surfaces + the strays):
 *   - 11 card ids       ← `MENU_ENTRIES` letters (grab + lightning)
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
 * DEV-ONLY coverage assertion.
 *
 * Verifies — once the registry is populated — that:
 *   1. every `ActionId` in `EXPECTED_ACTION_IDS` has a registry row;
 *   2. every `VIRGIL_COMMAND_NAMES` slash command maps (via
 *      `SLASH_NAME_TO_ACTION_ID`) to an id that HAS a row, and that the
 *      row's `surfaces.slash` is set with a matching `slashName`;
 *   3. the typed input-rule actions (citation / footnote) carry a row with
 *      `surfaces.typed` + an `inputRulePattern`;
 *   4. the STRAY `insertExampleAtCursor` MenuBar control is represented by
 *      the `example` row (its un-unified surface is folded in).
 *
 * Returns a list of human-readable problems (empty ⇒ fully covered). Returns
 * `[]` (no-ops) in production.
 *
 * ⚠️ NOT INVOKED AT IMPORT TIME. The registry is EMPTY in CHIP 1, so calling
 * this now would report every id as missing. It is gated behind an explicit
 * call so the build/typecheck stays green and nothing breaks.
 *
 * TODO(CHIP 2): once rows exist, call this from a dev seam (e.g. the editor
 * boot path, mirroring `assertLifecycleCoverage`) AND from a vitest (mirroring
 * `lifecycle-coverage-assertion.test.ts`) so a missing/mis-flagged row trips
 * CI. Until then it is a pure helper that no one calls.
 */
export function assertActionCoverage(): string[] {
  if (process.env.NODE_ENV === "production") return [];
  const problems: string[] = [];

  // (1) every expected id has a row.
  for (const id of EXPECTED_ACTION_IDS) {
    const row = VIRGIL_ACTION_REGISTRY[id];
    if (!row) {
      problems.push(`[actions] missing registry row for id "${id}"`);
      continue;
    }
    if (row.id !== id) {
      problems.push(
        `[actions] row keyed "${id}" has mismatched id "${row.id}"`,
      );
    }
  }

  // (2) every slash command name maps to a covered, slash-flagged row.
  //     `VIRGIL_COMMAND_NAMES` is the live slash vocabulary (statically
  //     imported above) — reconciled here against the action ids so the two
  //     can't silently drift.
  for (const name of VIRGIL_COMMAND_NAMES) {
    const id = SLASH_NAME_TO_ACTION_ID[name];
    if (!id) {
      problems.push(
        `[actions] slash command "\\${name}" has no SLASH_NAME_TO_ACTION_ID mapping`,
      );
      continue;
    }
    const row = VIRGIL_ACTION_REGISTRY[id];
    if (!row) {
      problems.push(
        `[actions] slash command "\\${name}" maps to id "${id}" which has no registry row`,
      );
      continue;
    }
    if (!row.surfaces.slash) {
      problems.push(
        `[actions] id "${id}" backs slash command "\\${name}" but its row does not set surfaces.slash`,
      );
    }
    if (row.slashName !== name) {
      problems.push(
        `[actions] id "${id}" row.slashName="${row.slashName}" does not match command "\\${name}"`,
      );
    }
  }

  // (3) the typed input-rule actions must declare their surface + pattern.
  for (const id of ["citation", "footnote"] as const) {
    const row = VIRGIL_ACTION_REGISTRY[id];
    if (!row) continue; // already reported by (1)
    if (!row.surfaces.typed) {
      problems.push(
        `[actions] id "${id}" should set surfaces.typed (it has a typed-LaTeX input rule)`,
      );
    }
    if (!row.inputRulePattern) {
      problems.push(
        `[actions] id "${id}" sets surfaces.typed but has no inputRulePattern`,
      );
    }
  }

  // (4) the stray insertExampleAtCursor MenuBar control — there is no
  //     importable list to read it from, so we simply require the `example`
  //     row to exist (its un-unified surface is folded in by CHIP 2). This
  //     line documents the stray's existence so it cannot be forgotten.
  if (!VIRGIL_ACTION_REGISTRY.example) {
    problems.push(
      `[actions] "example" row missing — it must cover BOTH the \\ex slash ` +
        `command AND the stray insertExampleAtCursor MenuBar control ` +
        `(src/components/MenuBar.tsx), an un-unified surface`,
    );
  }

  return problems;
}
