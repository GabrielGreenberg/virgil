import type { EditorView } from "@tiptap/pm/view";
import { generateShortId } from "@/lib/uuid";
// CHIP 4a-ii: the PM→React bridge the slash `\cite` uses to register the
// citation CARD (the atom is still inserted synchronously below). Replaces the
// `virgil-citation-create` CustomEvent — one typed entrypoint into the
// registry's `citation.run`. CHIP 7a: `\ref` rides the same bridge (the
// `LabelRef` create-mode popover is the creator → `refRun` → `openRefPopover`).
import { getEditorActionsHandleFor } from "@/lib/actions/editor-actions-bridge";
// CHIP 5a: the canonical heading transform lives in the action registry
// (`headingRun` → SET + numbered:true). The 4 `\chapter`/`\section`/
// `\subsection`/`\subsubsection` slash commands call the registry row's `run()`
// directly — heading is PURE ProseMirror (`setBlockType` on the view), so NO
// bridge is needed (unlike `\cite`/`\footnote`, which need React-land
// `cardCreation`). The dropdown ([MenuBar.tsx] BlockTypeDropdown) calls the
// SAME `run()`, so the two surfaces can never diverge on the verb.
//
// CHIP 7a: `\title`/`\author`/`\date` ALSO route through `runViewOnlyAction` —
// the title-field creator (idempotent find-existing-or-insert; canonical order;
// date pre-fills today) moved INTO the registry's `titleFieldRun` and is pure
// ProseMirror (a `titleField` insert on the view), so NO bridge is needed. The
// former `titleFieldCommand` factory here is GONE; the registry row is the SSOT.
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
} from "@/lib/actions/action-registry";
import { paragraphUuidAt } from "@/links/links";
// Task 061: the cross-surface applicability SSOT — the slash `/cite` · `/footnote`
// commands honor the SAME curated per-kind set the menus consult. `/cite` also
// rides the bridge's `applies()` gate, but bail HERE too (symmetry with the
// `view.editable` early-return); `/footnote` inserts its atom synchronously
// BEFORE the bridge call, so its gate MUST be here to prevent an orphan atom.
import {
  blockKindAllowsAction,
  posHostsInlineAtom,
} from "@/text-objects/text-object-registry";

export interface VirgilCommand {
  /** The command name without backslash (e.g. "section") */
  name: string;
  /** Action to run. The typed text has already been deleted from the doc. */
  action: (view: EditorView, cmdText: string) => void;
}

/**
 * Run a PURE-ProseMirror registry action from a slash command (CHIP 5a; CHIP 7a
 * extends it to the title fields).
 *
 * A view-only action's `run()` needs ONLY the `EditorView` — no React-land
 * `cardCreation`, so NO bridge. We build a minimal `ActionContext` from the live
 * `view` (synthesizing the `CursorRef` from the caret) and invoke `spec.run(ctx)`
 * directly. Used by `heading-*` (a `setBlockType` transform; the dropdown calls
 * the SAME `run()`) and `title`/`author`/`date` (the idempotent `titleFieldRun`,
 * which reads the live doc/selection off `ctx.view.state`).
 *
 * Only safe for view-only actions: `cardCreation` /
 * `panelRouting` / `openAtomCreate` are intentionally absent — a card/atom action
 * (`\cite` / `\footnote` / `\ref`) would no-op here and must route through the
 * bridge (`getEditorActionsHandle`) instead.
 */
function runViewOnlyAction(id: ActionId, view: EditorView): void {
  const spec = VIRGIL_ACTION_REGISTRY[id];
  if (!spec) return;
  // CHIP 7b: the UNIFORM collab read-only gate for the pure-PM slash commands
  // (heading / tex / title-fields). `view.editable` is the in-editor mirror of
  // `collab.canEditMainText` (EditorLayout flips it via `setEditable` when the
  // partner holds the pen). When read-only the command no-ops — no block insert /
  // conversion. (In practice PM already suppresses `handleTextInput` on a
  // non-editable view, so the slash popup won't even fire; this makes the refusal
  // EXPLICIT + uniform with the other surfaces.) No over-gating: a non-collab
  // editor is always editable.
  const canEdit = view.editable;
  if (!canEdit) return;
  const pos = view.state.selection.head;
  const ctx: ActionContext = {
    // For a TipTap editor `view === editor.view`; the slash plugin has only the
    // view, so `editor` is filled with the same view-bearing object the registry
    // heading `run()` reads `state.schema` / `selection` off of. (`headingRun`
    // touches ONLY `ctx.view`.)
    editor: { view, state: view.state } as unknown as ActionContext["editor"],
    view,
    ref: {
      kind: "cursor",
      pos,
      paragraphId: paragraphUuidAt(view.state.doc, pos) ?? "",
    },
    surface: "slash",
    canEdit,
  };
  // Task 149: honor the applicability SSOT before running — mirroring the bridge
  // path (`EditorPane.tsx`, `if (spec.applies(ctx) === "disabled") return`). The
  // view-only slash surface previously called `spec.run(ctx)` DIRECTLY, skipping
  // `applies()` entirely — so a gate-tightening (e.g. heading-* greyed inside a
  // titleField / codeBlock / latexComment via task 149's `selectionCanHostHeading`
  // fix) leaked past the slash surface and `/section` still corrupted the block.
  // This is the UNIFIED move (central principle): EVERY view-only slash command
  // now honors its gate, so no future gate can ever again slip past this path.
  // No over-gating of the existing rows: `\title`/`\author`/`\date` use
  // `blockApplies` (→ "ok" at a caret) and `\tex` uses `blockInsertApplies`
  // (already "disabled" in a titleField, where `texRun`'s own bail already
  // no-ops it) — so behavior is unchanged for everything but the heading fix.
  if (spec.applies(ctx) === "disabled") return;
  void spec.run(ctx);
}

/**
 * Run a BRIDGE-dispatched registry action from a slash command (the sibling of
 * `runViewOnlyAction` for the actions that need React-land wiring — a card /
 * atom-create popover / panel soft-route the synthesized view-only stub can't
 * supply). Used by `\ref`, `\ex`, the five structural wrappers, and (for the
 * trailing dispatch) `\cite`.
 *
 * It owns the two steps every bridge-dispatched slash command shares, ONCE:
 *
 *   1. CHIP 7b — the UNIFORM collab read-only gate. `view.editable` is the
 *      in-editor mirror of `collab.canEditMainText` (EditorLayout flips it via
 *      `setEditable` when the partner holds the pen). When read-only the command
 *      no-ops. The bridge's own `runAction` ALSO no-ops on `!isEditable`
 *      (`EditorPane.tsx`), so this is an EXPLICIT, uniform early refusal — not
 *      the only guard — mirroring `runViewOnlyAction`'s gate for the pure-PM
 *      commands and the typed surface's `refuseTypedInsertWhenReadOnly`. No
 *      over-gating: a non-collab editor is always editable.
 *   2. the bridge dispatch itself — `getEditorActionsHandleFor(view)?.runAction`,
 *      routed via the EXACT live `view` so it reaches THIS pane's handle under
 *      multi-doc keep-alive, not a hidden keep-alive pane's.
 *
 * This folds the seven byte-near-identical `if (!view.editable) return; getEditor
 * ActionsHandleFor(view)?.runAction(<id>, { surface: "slash" })` closures onto
 * one helper, so the slash surface's collab gate lives in exactly two places
 * (`runViewOnlyAction` + here), and `\ref`/`\ex` — previously missing the gate
 * entirely — now refuse uniformly with the rest.
 */
function runBridgeAction(
  id: ActionId,
  view: EditorView,
  payload?: Record<string, unknown>,
): void {
  if (!view.editable) return;
  getEditorActionsHandleFor(view)?.runAction(id, {
    surface: "slash",
    ...(payload ? { payload } : {}),
  });
}

export const VIRGIL_COMMANDS: VirgilCommand[] = [
  // CHIP 7a: the 3 title-field commands route through the SINGLE canonical
  // `titleFieldRun` (idempotent find-existing-or-insert; canonical doc-top order;
  // date pre-fills today) in the action registry. The former `titleFieldCommand`
  // factory is gone; the registry row is the SSOT. Pure ProseMirror (a
  // `titleField` insert on the view), so NO bridge — `runViewOnlyAction`
  // synthesizes the view-only ActionContext (`titleFieldRun` reads the live doc
  // off `ctx.view.state`, not the synthesized CursorRef). SLASH-ONLY by design
  // (no menu twin — a titleField is a doc-top singleton, not a card).
  { name: "title", action: (view) => runViewOnlyAction("title", view) },
  { name: "author", action: (view) => runViewOnlyAction("author", view) },
  { name: "date", action: (view) => runViewOnlyAction("date", view) },
  // CHIP 5a: the 4 heading commands route through the SINGLE canonical
  // `headingRun` (SET + numbered:true) in the action registry — the SAME `run()`
  // the BlockType dropdown calls. The former 4 copy-paste `setBlockType`
  // closures are gone; the registry row is the SSOT for the heading verb.
  { name: "chapter", action: (view) => runViewOnlyAction("heading-chapter", view) },
  { name: "section", action: (view) => runViewOnlyAction("heading-section", view) },
  { name: "subsection", action: (view) => runViewOnlyAction("heading-subsection", view) },
  { name: "subsubsection", action: (view) => runViewOnlyAction("heading-subsubsection", view) },
  {
    name: "ref",
    action: (view) => {
      // `\ref` routes through the SINGLE canonical `refRun` in the action
      // registry — the SAME `run()` the lightning 'Cross-ref' grid cell calls.
      // `refRun` opens the SHARED create popover (the same deferred-commit
      // controller citation uses) in ref mode at the caret — the popover IS the
      // creator: `useRefActions.handleInsertRef` lands the `labelRef` atom when
      // the user picks/types a label. Opening the popover is a React-land
      // side-effect (it sets EditorLayout's `atomCreateRequest`), so `\ref` rides
      // the bridge (like `\cite`/`\footnote`) — `refRun` receives
      // `ctx.openAtomCreate` from EditorPane's bridge handle. Via `runBridgeAction`
      // so `\ref` carries the SAME CHIP 7b collab read-only gate as `\cite` /
      // `\footnote` / the wrappers (previously absent here — task 297), and is
      // routed via the EXACT live `view` (multi-doc keep-alive) so it reaches
      // THIS pane's handle, not a hidden keep-alive pane's.
      runBridgeAction("ref", view);
    },
  },
  {
    name: "ex",
    action: (view) => {
      // CHIP 5c: `\ex` routes through the SINGLE canonical `exampleRun`
      // (wrap-if-selection-else-insert) in the action registry — the SAME
      // `run()` the lightning grid `ex` cell calls. The former `virgil-ex-create`
      // CustomEvent + its command-input.ts listener + `editorRef.insertExample`
      // are retired. The INSERT is pure ProseMirror (an `exampleBlock` insert on
      // the view), but the slash surface ALSO wants the soft panel-select
      // (surface omni's Examples row → scroll to the new block, backlog #2 —
      // never force-opens), which is a React-land side-effect. So `\ex` rides the
      // bridge (like `\cite`/`\footnote`) rather than the view-only path, so
      // `exampleRun` receives `ctx.panelRouting.selectExample`. Via `runBridgeAction`
      // so `\ex` carries the SAME CHIP 7b collab read-only gate as the rest
      // (previously absent here — task 297).
      runBridgeAction("example", view);
    },
  },
  {
    name: "cite",
    action: (view) => {
      // Task 061: refuse when the caret's containing block greys `citation` out
      // (a `titleField` / non-prose block). Mirrors the bridge `applies()` gate;
      // bailing here avoids even opening the create popover. This bespoke
      // pre-gate is a pure read (no doc mutation), so — unlike `\footnote`'s
      // synchronous atom insert — it needn't precede the collab gate: the CHIP 7b
      // `view.editable` refusal lives in `runBridgeAction` (which bails before any
      // dispatch, so the popover never opens on a read-only view either way).
      if (!blockKindAllowsAction(view.state.selection.$from.parent.type.name, "citation")) return;
      // Citation creation popover (deferred-commit): `/cite` no longer inserts a
      // blank `\cite{}` atom + pristine card up front. It routes through the
      // registry's `citation.run` (surface "slash") with NO payload, which opens
      // the create popover at the caret (`openAtomCreate("citation")`). The user
      // searches citekeys; the atom + card materialize only on commit (OK /
      // click-away with ≥1 key), via a second `runAction` carrying the payload.
      runBridgeAction("citation", view);
    },
  },
  {
    name: "footnote",
    action: (view) => {
      // CHIP 7b: collab read-only gate. Unlike the other bridge-dispatched
      // commands, `\footnote` inserts its atom SYNCHRONOUSLY below (BEFORE the
      // bridge dispatch), so this `view.editable` refusal MUST run here as a
      // bespoke pre-gate — deferring to `runBridgeAction`'s gate alone would land
      // an orphan atom on a read-only view. The trailing dispatch still routes
      // through `runBridgeAction` (its gate re-checks harmlessly, already
      // editable here), so the bridge-dispatch boilerplate isn't re-inlined.
      if (!view.editable) return;
      const { state } = view;
      // Task 061: refuse the synchronous footnote-atom insert when the caret's
      // containing block greys `footnote` out (a non-prose block). MUST gate
      // here — the atom is inserted below BEFORE the bridge's `applies()` gate
      // runs, so relying on the bridge alone would leave an orphan atom.
      if (!blockKindAllowsAction(state.selection.$from.parent.type.name, "footnote")) return;
      const footnoteNodeType = state.schema.nodes.footnote;
      if (!footnoteNodeType) return;
      // Task 396 — the SCHEMA half beside the POLICY half above (the twin in
      // `footnote.ts` / `citation.ts` states why both are asked). `\cite` above
      // needs none: it opens a popover whose COMMIT goes through
      // `insertInlineAtom`, which carries the gate at the door.
      if (!posHostsInlineAtom(state.doc, state.selection.from, footnoteNodeType))
        return;
      const existing = new Set<string>();
      state.doc.descendants((node) => {
        if (node.type.name === "footnote" && node.attrs.footnoteId) {
          existing.add(node.attrs.footnoteId as string);
        }
        return true;
      });
      const footnoteId = generateShortId(existing);
      // Empty body — the panel card hosts the editable footnote text.
      const content = { type: "doc", content: [{ type: "paragraph" }] };
      // Insert the atom SYNCHRONOUSLY — it must land even if React is
      // unmounted (durability decision, matching `\cite`). Only the CARD
      // registration routes through the bridge.
      const tr = state.tr.replaceSelectionWith(
        footnoteNodeType.create({ footnoteId, content, number: 0 }),
      );
      view.dispatch(tr);
      // Register the panel card via the registry's `footnote.run` (surface
      // "slash"). The bridge synthesizes the CursorRef + supplies cardCreation
      // + the soft-route wiring; `footnote.run` ADOPTS the just-inserted atom
      // via `createFootnote({ existingFootnoteId })` (pristine + pinned, NO
      // re-insert) and soft-routes into omni (backlog #2 — never force-opens
      // the Footnotes panel). Replaces the retired `virgil-footnote-input`
      // event + its command-input.ts listener (and the dead
      // `virgil-footnote-created` it used to broadcast).
      runBridgeAction("footnote", view, { footnoteId });
    },
  },
  // CHIP 5b: `\tex` routes through the SINGLE canonical `texRun` (seed `code`
  // from the selection, mint a collision-free uuid, insert the `texBlock`) in
  // the action registry — the SAME `run()` the lightning grid `\tex` cell calls.
  // The former hand-rolled uuid-scan + `replaceSelectionWith({code:''})` closure
  // is gone (it ALWAYS emptied the code and DISCARDED any selected text); the
  // slash surface now ALSO seeds from selection, matching the grid. Pure
  // ProseMirror (`texBlock` insert on the view), so NO bridge — `runViewOnlyAction`
  // synthesizes the view-only ActionContext (`texRun` reads the live selection
  // off `ctx.view.state`, not the synthesized CursorRef).
  { name: "tex", action: (view) => runViewOnlyAction("tex", view) },
  // Task 385: `\forest` routes through the SINGLE canonical `forestRun` (mint a
  // collision-free uuid, seed the subset-clean starter tree, insert the
  // `forestBlock`) — the SAME `run()` the lightning grid's tree cell calls. Pure
  // ProseMirror, so NO bridge: `runViewOnlyAction` synthesizes the view-only
  // ActionContext, and `forestRun` reads the live selection off `ctx.view.state`
  // (it carries the CHIP 7b collab gate itself, as `texRun` does).
  { name: "forest", action: (view) => runViewOnlyAction("forest", view) },
  // Bug sweep #6: the 5 structural WRAPPER toggles. `\list`/`\itemize` → bullet
  // list, `\enumerate` → numbered list, `\quote`/`\quotation` → blockquote.
  //
  // Unlike the pure-PM commands above (heading / tex / title-fields, which take
  // `runViewOnlyAction`), the wrapper rows run `editor.chain().toggleBulletList()`
  // / `toggleOrderedList()` / `toggleBlockquote()` — which the view-only path's
  // SYNTHESIZED `{ view, state }` stub lacks (`.chain()` is undefined there). So
  // they MUST route through the BRIDGE (`runBridgeAction`), the same path as
  // `\cite`/`\footnote`/`\ref`/`\ex` — the bridge builds the ctx from the LIVE
  // TipTap editor (`innerRef.getEditor()`), which has `.chain()`. The EXACT
  // `view` reaches THIS pane's handle under multi-doc keep-alive.
  //
  // Data-loss is impossible on a non-listable block (titleField / heading /
  // atom): the registry rows grey via `wrapperApplies` AND no-op in `run()` via
  // `selectionIsListable` (action-registry.ts) — a `\enumerate` typed on a
  // heading simply does nothing. `runBridgeAction`'s `view.editable` gate is the
  // uniform CHIP 7b collab read-only refusal — the SAME one `\cite`/`\footnote`/
  // `\ref`/`\ex` now share (no longer re-inlined per row).
  { name: "list", action: (view) => runBridgeAction("bullet-list", view) },
  { name: "itemize", action: (view) => runBridgeAction("bullet-list", view) },
  { name: "enumerate", action: (view) => runBridgeAction("ordered-list", view) },
  { name: "quote", action: (view) => runBridgeAction("blockquote", view) },
  { name: "quotation", action: (view) => runBridgeAction("blockquote", view) },
];

/** Fast lookup by command name (without backslash). */
export const COMMAND_MAP = new Map(VIRGIL_COMMANDS.map((c) => [c.name, c]));

/** Names of all native Virgil commands (without the leading backslash). */
export const VIRGIL_COMMAND_NAMES: readonly string[] = VIRGIL_COMMANDS.map((c) => c.name);

// Dev-only: expose the slash command map for the live-harness verification
// sweep (CHIP 8), mirroring the existing `window.__virgil` / `__virgilBusStats`
// dev hooks. Lets a preview_eval driver invoke a slash command's `action`
// exactly as `executeSelection` (slash-popup.ts) does after it deletes the
// typed `\name` — the faithful slash-surface destination. Gated on the
// dev-storage flag so it never ships in a production (static-export) build.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (
    window as unknown as { __virgilSlashCommands?: unknown }
  ).__virgilSlashCommands = COMMAND_MAP;
}
