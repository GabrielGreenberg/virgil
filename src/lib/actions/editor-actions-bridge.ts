/**
 * editor-actions-bridge — the ONE module-level seam ProseMirror-plugin-land
 * (slash commands / typed-LaTeX input rules) uses to reach React-land actions.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * STATUS (CHIP 4a-i — INERT INFRASTRUCTURE). This file is the PM→React bridge
 * *plumbing* only. The React tree publishes an `EditorActionsHandle` here on
 * mount (`EditorPane.tsx`); NOTHING consumes it yet. The PM plugins
 * (`commands.ts` slash dispatch, `citation.ts` / `footnote.ts` input rules)
 * are UNTOUCHED this chip — wiring them to `getEditorActionsHandle()` is the
 * NEXT chip (4a-ii). So publishing this handle changes ZERO user-facing
 * behavior; it just makes the seam available for 4a-ii to call.
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
 * # What it REPLACES (once 4a-ii wires the call sites)
 *
 * This ONE typed entrypoint supersedes the scattered `window` CustomEvents the
 * PM plugins currently use to cross the boundary — see the `EditorActionsHandle`
 * JSDoc in [action-registry.ts](./action-registry.ts):
 *   - `virgil-citation-create`   (commands.ts → command-input.ts + citations-host.tsx)
 *   - `virgil-footnote-input`    (commands.ts → command-input.ts)
 *   - `virgil-ex-create`         (commands.ts → command-input.ts)
 *   - `virgil-ref-create`        (commands.ts → command-input.ts)
 *   - `virgil-footnote-created`  (command-input.ts → panel scroll-to-new)
 * plus the two citation listeners (`command-input.ts` + `citations-host.tsx`
 * both bind `virgil-citation-create`). Those untyped string events collapse to
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
