import type { EditorView } from "@tiptap/pm/view";
import { generateShortId } from "@/lib/uuid";
// CHIP 4a-ii: the PM→React bridge the slash `\cite` uses to register the
// citation CARD (the atom is still inserted synchronously below). Replaces the
// `virgil-citation-create` CustomEvent — one typed entrypoint into the
// registry's `citation.run`. CHIP 7a: `\ref` rides the same bridge (the
// `LabelRef` create-mode popover is the creator → `refRun` → `openRefPopover`).
import { getEditorActionsHandle } from "@/lib/actions/editor-actions-bridge";
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
 * Only safe for view-only actions: `cardCreation` / `cardLifecycle` /
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
  void spec.run(ctx);
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
    action: () => {
      // `\ref` routes through the SINGLE canonical `refRun` in the action
      // registry — the SAME `run()` the lightning 'Cross-ref' grid cell calls.
      // `refRun` opens the SHARED create popover (the same deferred-commit
      // controller citation uses) in ref mode at the caret — the popover IS the
      // creator: `useRefActions.handleInsertRef` lands the `labelRef` atom when
      // the user picks/types a label. Opening the popover is a React-land
      // side-effect (it sets EditorLayout's `atomCreateRequest`), so `\ref` rides
      // the bridge (like `\cite`/`\footnote`) — `refRun` receives
      // `ctx.openAtomCreate` from EditorPane's bridge handle.
      getEditorActionsHandle()?.runAction("ref", { surface: "slash" });
    },
  },
  {
    name: "ex",
    action: () => {
      // CHIP 5c: `\ex` routes through the SINGLE canonical `exampleRun`
      // (wrap-if-selection-else-insert) in the action registry — the SAME
      // `run()` the lightning grid `ex` cell calls. The former `virgil-ex-create`
      // CustomEvent + its command-input.ts listener + `editorRef.insertExample`
      // are retired. The INSERT is pure ProseMirror (an `exampleBlock` insert on
      // the view), but the slash surface ALSO wants the soft panel-select
      // (surface omni's Examples row → scroll to the new block, backlog #2 —
      // never force-opens), which is a React-land side-effect. So `\ex` rides the
      // bridge (like `\cite`/`\footnote`) rather than the view-only path, so
      // `exampleRun` receives `ctx.panelRouting.selectExample`.
      getEditorActionsHandle()?.runAction("example", { surface: "slash" });
    },
  },
  {
    name: "cite",
    action: (view) => {
      // CHIP 7b: uniform collab read-only gate — refuse when the partner holds
      // the pen (the bridge's `runAction` ALSO no-ops on read-only, but bail
      // here too so we never even open the popover). `view.editable` mirrors
      // `collab.canEditMainText`.
      if (!view.editable) return;
      // Citation creation popover (deferred-commit): `/cite` no longer inserts a
      // blank `\cite{}` atom + pristine card up front. It routes through the
      // registry's `citation.run` (surface "slash") with NO payload, which opens
      // the create popover at the caret (`openAtomCreate("citation")`). The user
      // searches citekeys; the atom + card materialize only on commit (OK /
      // click-away with ≥1 key), via a second `runAction` carrying the payload.
      getEditorActionsHandle()?.runAction("citation", { surface: "slash" });
    },
  },
  {
    name: "footnote",
    action: (view) => {
      // CHIP 7b: uniform collab read-only gate (same rationale as `\cite`) —
      // refuse before the synchronous atom insert.
      if (!view.editable) return;
      const { state } = view;
      const footnoteNodeType = state.schema.nodes.footnote;
      if (!footnoteNodeType) return;
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
      getEditorActionsHandle()?.runAction("footnote", {
        surface: "slash",
        payload: { footnoteId },
      });
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
