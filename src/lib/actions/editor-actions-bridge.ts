/**
 * editor-actions-bridge — the ONE module-level seam ProseMirror-plugin-land
 * (slash commands / typed-LaTeX input rules) uses to reach React-land actions.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * STATUS (LIVE). The React tree publishes an `EditorActionsHandle` here on
 * mount (`EditorPane.tsx`). CONSUMERS: the `\cite` slash command + `\cite{}` /
 * `\cite ` typed input rules (CHIP 4a-ii), the `\footnote` slash command +
 * `\footnote{}` typed input rule (CHIP 4b), the `\ex` slash command (CHIP 5c),
 * and the `\ref` slash command all reach their React-land `run()` (register a
 * CARD, or — for `\cite` / `\ref` — open the SHARED create popover via the
 * `openAtomCreate` seam; the inline atom for a typed `\cite{key}` / `\footnote`
 * is still inserted synchronously in plugin-land). The pure-PM slash commands
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
 * a module-scoped cell the two disconnected parts of the tree share.
 *
 * # Lifecycle contract — a REGISTRY, not a single slot (multi-doc keep-alive)
 *
 * The original design parked ONE handle in a single `{ current }` cell under
 * the false invariant "exactly one main editor is mounted at a time". Multi-doc
 * keep-alive (default ON, capacity 3) falsified that: N `EditorPane`s render at
 * once (one visible, the rest `display:none`). A single slot produced two bugs —
 *   (1) MIS-ROUTE: a stale handle routed a typed `\ex`/`\cite` into a hidden
 *       doc; and
 *   (2) CLOBBER: an unmounting/evicted pane blind-nulled the cell, no-op'ing a
 *       still-live pane.
 *
 * The fix is a `Map<EditorView, Entry>` keyed by each pane's live `EditorView`:
 *   - Each `EditorPane` registers ITS OWN entry on mount and removes ONLY its
 *     own key on unmount — an evicted pane can never clobber a live one (kills
 *     bug 2 structurally; no compare-and-clear race).
 *   - A PM consumer fires WITH the live `view` it ran in, so it looks up the
 *     EXACT handle for its own pane via `getEditorActionsHandleFor(view)` (kills
 *     bug 1 — no mis-route).
 *   - A contextless React-land caller (no view) resolves the ACTIVE handle via
 *     `getEditorActionsHandle()`, which uses the SAME `pickProbeEditor`
 *     precedence (focused → visible → single) the dev probes use — collapsing
 *     "which editor is active" onto one resolver.
 *
 * A consumer MUST still treat the handle as nullable (`?.runAction(...)`): a
 * plugin firing outside any editor's lifetime reads `null` and no-ops.
 *
 * The legacy `setEditorActionsHandle(handle | null)` is retained as a thin
 * view-less publish (a single "default" registry entry) for non-view producers
 * and the cross-surface test harnesses; production publishes per-view.
 */

import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { pickProbeEditor } from "@/lib/active-editor-probe";
import type { EditorActionsHandle } from "./action-registry";

// Re-export so a PM-plugin consumer (4a-ii) can import the contract type from
// the same module it imports the getter from — one import site for the seam.
export type { EditorActionsHandle } from "./action-registry";

/** A registered handle plus the live editor that owns it (for active-resolution). */
interface HandleEntry {
  handle: EditorActionsHandle;
  /** The owning TipTap editor; `null` for the view-less legacy "default" entry. */
  editor: Editor | null;
}

/**
 * Sentinel key for the view-less legacy `setEditorActionsHandle` publish — a
 * single shared slot for producers (and tests) that have no `EditorView`.
 */
const DEFAULT_KEY: unique symbol = Symbol("editor-actions-handle:default");
type RegistryKey = EditorView | typeof DEFAULT_KEY;

/**
 * The per-view handle registry. Keyed by each pane's live `EditorView` (plus the
 * one `DEFAULT_KEY` legacy slot). Module scope, NOT React state — the PM plugins
 * that read it have no React context.
 */
const registry = new Map<RegistryKey, HandleEntry>();

/**
 * Register (production) the editor-actions handle for a specific pane's editor,
 * keyed by its live `EditorView`. Called by `EditorPane` on mount, cleared via
 * `unregisterEditorActionsHandle(editor)` on unmount / editor-swap. Re-registering
 * the same view (HMR remount, StrictMode double-invoke) simply overwrites — no
 * clobber of any OTHER pane.
 */
export function registerEditorActionsHandle(editor: Editor, handle: EditorActionsHandle): void {
  registry.set(editor.view, { handle, editor });
}

/**
 * Remove a pane's own entry (by its `EditorView`). Removes ONLY this editor's
 * key, so an unmounting/evicted pane can never null out a still-live pane.
 */
export function unregisterEditorActionsHandle(editor: Editor): void {
  registry.delete(editor.view);
}

/**
 * Legacy view-less publish: park a single handle in the shared `DEFAULT_KEY`
 * slot (or clear it with `null`). Retained for non-view producers and the
 * cross-surface test harnesses; production uses the per-view register API.
 */
export function setEditorActionsHandle(handle: EditorActionsHandle | null): void {
  if (handle) registry.set(DEFAULT_KEY, { handle, editor: null });
  else registry.delete(DEFAULT_KEY);
}

/**
 * EXACT lookup: the handle for `view`'s own pane, falling back to the ACTIVE
 * handle (`getEditorActionsHandle()`) when `view` isn't registered (e.g. a
 * nested sub-editor, or a brief HMR remount window where the reactive editor and
 * the live PM view differ). THE entrypoint a PM plugin (slash command / input
 * rule) calls — it always has the live `view` it fired in:
 *
 *   getEditorActionsHandleFor(view)?.runAction("citation", { surface: "typed", payload });
 */
export function getEditorActionsHandleFor(
  view: EditorView | null | undefined,
): EditorActionsHandle | null {
  if (view) {
    const exact = registry.get(view);
    if (exact) return exact.handle;
  }
  return getEditorActionsHandle();
}

/**
 * Read the ACTIVE editor-actions handle, or `null` when no editor is mounted.
 * For a contextless React-land caller (no `EditorView` in hand). Resolution:
 *   - 0 entries → null;
 *   - 1 entry → that one (the common single-doc case, incl. the legacy slot);
 *   - N entries → the FOCUSED-then-VISIBLE pane via `pickProbeEditor` (the same
 *     precedence the dev probes use); if genuinely ambiguous, the legacy default
 *     slot if present, else `null` (don't guess).
 *
 * Always null-guard the result: `getEditorActionsHandle()?.runAction(...)`.
 */
export function getEditorActionsHandle(): EditorActionsHandle | null {
  if (registry.size === 0) return null;
  if (registry.size === 1) {
    return registry.values().next().value?.handle ?? null;
  }
  // Multiple panes mounted (keep-alive). Resolve the active one among the
  // editor-bearing entries via the shared focused→visible→single precedence.
  const withEditors = [...registry.values()].filter(
    (e): e is HandleEntry & { editor: Editor } => e.editor != null,
  );
  if (withEditors.length === 0) {
    // Only view-less/default entries — return any (single shared slot in practice).
    return registry.values().next().value?.handle ?? null;
  }
  const picked = pickProbeEditor(withEditors.map((e) => e.editor));
  if (picked) {
    const match = withEditors.find((e) => e.editor === picked);
    if (match) return match.handle;
  }
  // Ambiguous among live editors — prefer the legacy default slot if any, else
  // don't guess.
  return registry.get(DEFAULT_KEY)?.handle ?? null;
}

/**
 * TEST-ONLY: clear the entire registry (all per-view entries + the default
 * slot). Lets a test harness reset module-global state between cases.
 */
export function __resetEditorActionsRegistry(): void {
  registry.clear();
}
