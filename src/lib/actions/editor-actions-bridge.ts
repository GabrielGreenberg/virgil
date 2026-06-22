/**
 * editor-actions-bridge — the ONE module-level seam ProseMirror-plugin-land
 * (slash commands / typed-LaTeX input rules) uses to reach React-land actions.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * STATUS (LIVE). The React tree publishes an `EditorActionsHandle` here on
 * mount (`EditorPane.tsx`). CONSUMERS: the `\cite` slash command + `\cite{}` /
 * `\cite ` typed input rules (CHIP 4a-ii), the `\footnote` slash command +
 * `\footnote{}` typed input rule (CHIP 4b), the `\ex` slash command (CHIP 5c),
 * and the `\ref` slash command all call
 * `getEditorActionsHandle()?.runAction(id, seed)` to reach their React-land
 * `run()` (register a CARD, or — for `\cite` / `\ref` — open the SHARED create
 * popover via the `openAtomCreate` seam; the inline atom for a typed `\cite{key}`
 * / `\footnote` is still inserted synchronously in plugin-land). The pure-PM
 * slash commands
 * (`\chapter`…`\subsubsection`, `\tex`, `\title`/`\author`/`\date`) take the
 * view-only path (`runViewOnlyAction`), NOT this bridge. NO PM command rides a
 * legacy `virgil-*` CustomEvent anymore.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * # Why a module singleton (not React Context)
 *
 * The producer (the React `EditorPane`, which holds `cardCreation` /
 * `cardLifecycle` / the live editor) and the consumers (ProseMirror plugins,
 * which run with an `EditorView` ONLY — no React context) sit on opposite
 * sides of the React-land / PM-plugin-land boundary. A plugin cannot read a
 * React Context, so the handle is parked at module scope. This mirrors the
 * established Virgil pattern in
 * [src/components/editor-layout/dock-drag.ts](src/components/editor-layout/dock-drag.ts):
 * a module-scoped `{ current }` cell with a `set*` / `get*` pair the two
 * disconnected parts of the tree share.
 *
 * # What it REPLACED (all now retired through CHIP 7a)
 *
 * This ONE typed entrypoint superseded the scattered `window` CustomEvents the
 * PM plugins used to cross the boundary — see the `EditorActionsHandle` JSDoc in
 * [action-registry.ts](./action-registry.ts). All are now RETIRED (the
 * `command-input.ts` hook that bound them is DELETED):
 *   - `virgil-citation-create`   (CHIP 4a-ii)
 *   - `virgil-footnote-input`    (CHIP 4b)
 *   - `virgil-footnote-created`  (dead event, zero listeners — CHIP 4b)
 *   - `virgil-ex-create`         (CHIP 5c)
 *   - `virgil-ref-create`        (`\ref` rides this bridge; the create popover
 *                                  open hops the shared rect+pos-carrying
 *                                  `virgil-atom-create-popover` event — kind
 *                                  "ref" — from the surface to EditorLayout)
 * plus the two citation listeners (`command-input.ts` + `citations-host.tsx`
 * both bound `virgil-citation-create`). Those untyped string events collapsed to
 * `getEditorActionsHandle()?.runAction(id, seed)` calls with a typed id + seed.
 *
 * # Lifecycle contract
 *
 * EXACTLY ONE main editor is mounted at a time, so the cell holds at most one
 * handle. `EditorPane` publishes on mount and clears (`null`) on unmount, so a
 * plugin firing after teardown reads `null` and no-ops. A consumer MUST treat
 * the handle as nullable — `getEditorActionsHandle()?.runAction(...)`.
 */

import type { EditorActionsHandle } from "./action-registry";

// Re-export so a PM-plugin consumer (4a-ii) can import the contract type from
// the same module it imports the getter from — one import site for the seam.
export type { EditorActionsHandle } from "./action-registry";

/**
 * The single published handle, or `null` when no editor is mounted. Module
 * scope, NOT React state — the PM plugins that read it have no React context.
 * Wrapped in a `{ current }` cell (mirroring `dock-drag.ts`) so the value is
 * mutable without re-binding the export.
 */
const handleCell: { current: EditorActionsHandle | null } = { current: null };

/**
 * Publish (or clear) the editor-actions handle. Called by the React tree:
 * `EditorPane` builds an `EditorActionsHandle` and publishes it on mount,
 * then passes `null` on unmount to retract the seam.
 *
 * @param handle The handle to publish, or `null` to clear it.
 */
export function setEditorActionsHandle(handle: EditorActionsHandle | null): void {
  handleCell.current = handle;
}

/**
 * Read the currently-published editor-actions handle, or `null` when no editor
 * is mounted. THE entrypoint a ProseMirror plugin (slash command / input rule)
 * calls to reach a React-land action — always null-guard the result:
 *
 *   getEditorActionsHandle()?.runAction("citation", { surface: "typed", payload });
 *
 * Returns `null` until `EditorPane` publishes (and again after it unmounts), so
 * a plugin firing outside an editor's lifetime no-ops cleanly.
 */
export function getEditorActionsHandle(): EditorActionsHandle | null {
  return handleCell.current;
}
