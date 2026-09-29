import type { EditorView } from "@tiptap/pm/view";
import { generateShortId } from "@/lib/uuid";
import { collabReadOnly } from "@/lib/tiptap/collab-read-only-gate";
// CHIP 4a-ii: the PM→React bridge the slash `\cite` uses to register the
// citation CARD (the atom is still inserted synchronously below). Replaces the
// `virgil-citation-create` CustomEvent — one typed entrypoint into the
// registry's `citation.run`. CHIP 7a: `\ref` rides the same bridge (the
// `LabelRef` create-mode popover is the creator → `refRun` → `openRefPopover`).
import { runEditorAction } from "@/lib/actions/editor-actions-bridge";
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
  SLASH_NAME_TO_ACTION_ID,
  VIRGIL_ACTION_REGISTRY,
  type ActionId,
} from "@/lib/actions/action-registry";
import { CARD_ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";
// Task 398: the slash surface's applicability DOOR. `runViewOnlyAction` builds
// its ctx here rather than inline, so the OFFER (the popup's greyed rows +
// `executeSelection`'s pre-delete refusal) and this COMMIT ask the registry the
// same question through the same constructor — the two halves cannot come to
// answer from two tables.
import {
  buildSlashActionContext,
  slashCommandEnabled,
} from "./slash-applicability";
import type { Transaction } from "@tiptap/pm/state";
// Task 061: the cross-surface applicability SSOT — the slash `/cite` · `/footnote`
// commands honor the SAME curated per-kind set the menus consult. `/cite` also
// rides the bridge's `applies()` gate, but bail HERE too (symmetry with the
// `view.editable` early-return); `/footnote` inserts its atom synchronously
// BEFORE the bridge call, so its gate MUST be here to prevent an orphan atom.
import {
  inlineRangeAllowsAtom,
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
  if (collabReadOnly(view)) return;
  // Task 398: ONE ctx constructor, shared with the popup's OFFER. It was inline
  // here; the popup then had no way to ask the same question without re-deriving
  // it, which is exactly how the offer and the commit came to disagree.
  const ctx = buildSlashActionContext(view);
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
 *      commands and the typed surface's `collabReadOnly`. No
 *      over-gating: a non-collab editor is always editable.
 *   2. the bridge dispatch itself — `runEditorAction(view, …)`, routed via the
 *      EXACT live `view` so it reaches THIS pane's handle under multi-doc
 *      keep-alive, not a hidden keep-alive pane's — and (task 642) carries that
 *      view as the invocation's ORIGIN, so the action's `ref` is built from the
 *      document the command fired in rather than from whichever pane is active.
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
  if (collabReadOnly(view)) return;
  runEditorAction(view, id, {
    surface: "slash",
    ...(payload ? { payload } : {}),
  });
}

/**
 * The registry action a slash command name runs — read from
 * `SLASH_NAME_TO_ACTION_ID`, the SAME map `slashCommandVerdict` asks the
 * applicability question through (task 843).
 *
 * Every row below used to spell its action id a SECOND time inside its closure
 * (`runBridgeAction("bullet-list", …)`), while the popup decided whether to
 * OFFER the command from the map's copy. `assertActionCoverage` reconciles the
 * two NAME keysets, but nothing compared the ids — so an edit to one copy would
 * have re-opened task 398's bug by a new road: the popup gates on action A's
 * `applies()`, the commit door deletes the typed `\name`, and action B runs.
 * The rows now name only the COMMAND; the id is looked up here, so there is
 * one copy and the offer and the run cannot disagree about which action this is.
 *
 * Resolved at CALL time, never at module evaluation: `action-registry.ts`
 * imports `VIRGIL_COMMAND_NAMES` from this module, so the map may not exist yet
 * while this table is being built. An unmapped name returns `undefined` and the
 * row no-ops (both run helpers bail on a missing id) — unreachable in a shipped
 * build, since `assertActionCoverage` pins the map total over the names.
 */
function slashActionId(name: string): ActionId | undefined {
  return SLASH_NAME_TO_ACTION_ID[name];
}

/** A slash command that runs a PURE-ProseMirror registry row through
 *  `runViewOnlyAction` (no React-land wiring needed). */
function viewRow(name: string): VirgilCommand {
  return {
    name,
    action: (view) => {
      const id = slashActionId(name);
      if (id) runViewOnlyAction(id, view);
    },
  };
}

/**
 * A slash command that runs its registry row through the BRIDGE
 * (`runBridgeAction`). `prepare`, when given, runs first on the live view: it
 * returns `false` to refuse (nothing is dispatched), or the payload the bridge
 * call carries (`undefined` = none). It is the slot for a row's bespoke
 * pre-work — `\cite`'s atom-placement gate, `\footnote`'s synchronous atom
 * insert — so even those rows never name their action id.
 */
function bridgeRow(
  name: string,
  prepare?: (view: EditorView) => Record<string, unknown> | undefined | false,
): VirgilCommand {
  return {
    name,
    action: (view) => {
      const payload = prepare ? prepare(view) : undefined;
      if (payload === false) return;
      const id = slashActionId(name);
      if (id) runBridgeAction(id, view, payload);
    },
  };
}

/** `\cite`'s pre-gate (task 061): refuse when the caret's containing block
 *  greys `citation` out. See the row. */
function citePrepare(view: EditorView): undefined | false {
  const { doc, selection, schema } = view.state;
  const citationType = schema.nodes[CARD_ATOM_REGISTRY.citation.nodeName];
  if (
    !citationType ||
    !inlineRangeAllowsAtom(doc, selection.from, selection.to, citationType)
  )
    return false;
  return undefined;
}

/** `\footnote`'s pre-work: gate, then insert the atom SYNCHRONOUSLY and hand
 *  its id to the bridge call as the payload. See the row. */
function footnotePrepare(view: EditorView): Record<string, unknown> | false {
  // CHIP 7b: collab read-only gate. Unlike the other bridge-dispatched
  // commands, `\footnote` inserts its atom SYNCHRONOUSLY below (BEFORE the
  // bridge dispatch), so this refusal MUST run here as a bespoke pre-gate —
  // deferring to `runBridgeAction`'s gate alone would land an orphan atom on a
  // read-only view. (`runBridgeAction`'s gate re-checks harmlessly afterwards.)
  if (collabReadOnly(view)) return false;
  const { state } = view;
  // Task 843: the node name and its id attr come off the registry row (task
  // 645's SSOT), never hand-paired here.
  const { nodeName, idAttr } = CARD_ATOM_REGISTRY.footnote;
  const footnoteNodeType = state.schema.nodes[nodeName];
  if (!footnoteNodeType) return false;
  // The ONE inline-atom door (task 740): the policy half (061 — a non-prose
  // block greys `footnote` out) and the schema half (396) together. MUST
  // gate here — the atom is inserted below BEFORE the bridge's `applies()`
  // gate runs, so relying on the bridge alone would leave an orphan atom.
  // RANGE form (task 428): `replaceSelectionWith` below REPLACES the live
  // selection, so every textblock it reaches must host the atom.
  if (
    !inlineRangeAllowsAtom(
      state.doc,
      state.selection.from,
      state.selection.to,
      footnoteNodeType,
    )
  )
    return false;
  const existing = new Set<string>();
  state.doc.descendants((node) => {
    const id = node.type === footnoteNodeType ? node.attrs[idAttr] : null;
    if (id) existing.add(id as string);
    return true;
  });
  const footnoteId = generateShortId(existing);
  // Empty body — the panel card hosts the editable footnote text.
  const content = { type: "doc", content: [{ type: "paragraph" }] };
  // Insert the atom SYNCHRONOUSLY — it must land even if React is
  // unmounted (durability decision, matching `\cite`). Only the CARD
  // registration routes through the bridge.
  const tr = state.tr.replaceSelectionWith(
    footnoteNodeType.create({ [idAttr]: footnoteId, content, number: 0 }),
  );
  view.dispatch(tr);
  // The bridge payload key is the bridge's own contract (`footnote.run` reads
  // `payload.footnoteId`), not the node attr — it happens to share the spelling.
  return { footnoteId };
}

export const VIRGIL_COMMANDS: VirgilCommand[] = [
  // CHIP 7a: the 3 title-field commands route through the SINGLE canonical
  // `titleFieldRun` (idempotent find-existing-or-insert; canonical doc-top order;
  // date pre-fills today) in the action registry. Pure ProseMirror (a
  // `titleField` insert on the view), so NO bridge — `runViewOnlyAction`
  // synthesizes the view-only ActionContext. SLASH-ONLY by design (no menu twin
  // — a titleField is a doc-top singleton, not a card).
  viewRow("title"),
  viewRow("author"),
  viewRow("date"),
  // CHIP 5a: the 4 heading commands route through the SINGLE canonical
  // `headingRun` (SET + numbered:true) in the action registry — the SAME `run()`
  // the BlockType dropdown calls. Each name fans out to its discrete heading id
  // (`section` → `heading-section`) through `SLASH_NAME_TO_ACTION_ID`.
  viewRow("chapter"),
  viewRow("section"),
  viewRow("subsection"),
  viewRow("subsubsection"),
  // `\ref` routes through the SINGLE canonical `refRun` — the SAME `run()` the
  // lightning 'Cross-ref' grid cell calls. `refRun` opens the SHARED create
  // popover (the same deferred-commit controller citation uses) in ref mode at
  // the caret — the popover IS the creator: `useRefActions.handleInsertRef`
  // lands the `labelRef` atom when the user picks/types a label. Opening the
  // popover is a React-land side-effect (EditorLayout's `atomCreateRequest`), so
  // `\ref` rides the bridge; it carries the SAME CHIP 7b collab gate as the rest
  // (task 297) and is routed via the EXACT live `view` (multi-doc keep-alive).
  bridgeRow("ref"),
  // CHIP 5c: `\ex` routes through the SINGLE canonical `exampleRun`
  // (wrap-if-selection-else-insert) — the SAME `run()` the lightning grid `ex`
  // cell calls. The INSERT is pure ProseMirror, but the slash surface ALSO wants
  // the soft panel-select (surface omni's Examples row, backlog #2 — never
  // force-opens), a React-land side-effect, so `\ex` rides the bridge so
  // `exampleRun` receives `ctx.panelRouting.selectExample` (→ `example`).
  bridgeRow("ex"),
  // Citation creation popover (deferred-commit): `/cite` does not insert a blank
  // `\cite{}` atom + pristine card up front. It routes through the registry's
  // `citation.run` (surface "slash") with NO payload, which opens the create
  // popover at the caret (`openAtomCreate("citation")`); the atom + card
  // materialize only on commit (OK / click-away with ≥1 key), via a second
  // `runAction` carrying the payload. Task 061's pre-gate (`citePrepare`) is a
  // pure read asked through the ONE inline-atom door (task 740), so — unlike
  // `\footnote`'s synchronous insert — it needn't precede the collab gate.
  bridgeRow("cite", citePrepare),
  // `\footnote` inserts its atom SYNCHRONOUSLY (`footnotePrepare`), then
  // registers the panel card via the registry's `footnote.run` (surface
  // "slash"): the bridge synthesizes the CursorRef + supplies cardCreation + the
  // soft-route wiring; `footnote.run` ADOPTS the just-inserted atom via
  // `createFootnote({ existingFootnoteId })` (pristine + pinned, NO re-insert)
  // and soft-routes into omni (backlog #2 — never force-opens the panel).
  bridgeRow("footnote", footnotePrepare),
  // CHIP 5b: `\tex` routes through the SINGLE canonical `texRun` (seed `code`
  // from the selection, mint a collision-free uuid, insert the `texBlock`) — the
  // SAME `run()` the lightning grid `\tex` cell calls. Pure ProseMirror, so NO
  // bridge (`texRun` reads the live selection off `ctx.view.state`).
  viewRow("tex"),
  // Task 385: `\forest` routes through the SINGLE canonical `forestRun` — the
  // SAME `run()` the lightning grid's tree cell calls. Pure ProseMirror, so NO
  // bridge (`forestRun` carries the CHIP 7b collab gate itself, as `texRun` does).
  viewRow("forest"),
  // Bug sweep #6: the 5 structural WRAPPER toggles. `\list`/`\itemize` → bullet
  // list, `\enumerate` → numbered list, `\quote`/`\quotation` → blockquote (the
  // many-to-one alias group in `SLASH_NAME_TO_ACTION_ID`).
  //
  // Unlike the pure-PM rows above, the wrapper rows run
  // `editor.chain().toggleBulletList()` / … — which the view-only path's
  // SYNTHESIZED `{ view, state }` stub lacks (`.chain()` is undefined there). So
  // they MUST route through the BRIDGE, which builds the ctx from the LIVE
  // TipTap editor. Data-loss is impossible on a non-listable block (titleField /
  // heading / atom): the registry rows grey via `wrapperApplies` AND no-op in
  // `run()` via `selectionIsListable` (action-registry.ts).
  bridgeRow("list"),
  bridgeRow("itemize"),
  bridgeRow("enumerate"),
  bridgeRow("quote"),
  bridgeRow("quotation"),
];

/** Fast lookup by command name (without backslash). */
export const COMMAND_MAP = new Map(VIRGIL_COMMANDS.map((c) => [c.name, c]));

/**
 * The slash surface's ONE COMMIT DOOR (task 398).
 *
 * Two Enter-time executors reach the same vocabulary and each used to own a
 * private copy of the same three steps — resolve the name, DELETE the typed
 * `\name`, run the action:
 *
 *   • `slash-popup.ts`'s `executeSelection` (the popup's Enter / Tab / click);
 *   • `latex-command.ts`'s `virgilCommands` plugin, which matches a trailing
 *     `\[a-zA-Z]+` on Enter and fires even when the popup was never opened
 *     (dismissed with Escape, or suppressed by `isFreshPosition`).
 *
 * Both deleted FIRST and let the action refuse afterwards, so a command that
 * cannot run at this caret ate the user's characters and said nothing. Two
 * doors, one defect, and a fix applied to one of them would have left the other
 * live — which is why the door is here, beside the vocabulary both read, rather
 * than in either caller.
 *
 * **Ask before you delete.** The verdict is the registry row's own `applies()`
 * (through `slashCommandEnabled` — the same door the popup greys its rows
 * from), so what the popup OFFERS is what this ACCEPTS. A refusal returns
 * `false` having dispatched NOTHING: the document is byte-identical and the
 * caller decides whether to consume the key or let it through.
 *
 * `mutate` lets the popup fold its own close-meta into the delete transaction,
 * so a successful command still costs exactly the transactions it did before.
 */
export function commitSlashCommand(
  view: EditorView,
  name: string,
  from: number,
  to: number,
  mutate?: (tr: Transaction) => void,
): boolean {
  const cmd = COMMAND_MAP.get(name);
  if (!cmd) return false;
  // ASK FIRST — this ordering IS the fix. Nothing below runs on a refusal.
  if (!slashCommandEnabled(view, name)) return false;
  const tr = view.state.tr.delete(from, to);
  mutate?.(tr);
  view.dispatch(tr);
  cmd.action(view, "\\" + name);
  return true;
}

/** Names of all native Virgil commands (without the leading backslash). */
export const VIRGIL_COMMAND_NAMES: readonly string[] = VIRGIL_COMMANDS.map((c) => c.name);

// Dev-only: expose the slash command map for the live-harness verification
// sweep (CHIP 8), mirroring the existing `window.__virgil` / `__virgilBusStats`
// dev hooks. Lets a preview_eval driver invoke a slash command's `action`
// directly — the ACTION's destination, deliberately BELOW the slash surface's
// applicability door (task 398), so a harness can exercise a `run()` without
// the popup's verdict in front of it. The same reason the cross-surface suites
// call `.action` rather than driving the popup. Gated on the dev-storage flag
// so it never ships in a production (static-export) build.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (
    window as unknown as { __virgilSlashCommands?: unknown }
  ).__virgilSlashCommands = COMMAND_MAP;
}
