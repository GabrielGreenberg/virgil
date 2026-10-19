/**
 * The shared "inline-atom creation popover" lifecycle contract.
 *
 * Both `\ref` (cross-reference) and `citation` are created the SAME way: a
 * trigger surface (slash / lightning / grab / typed) opens a popover OVER THE
 * TEXT at the caret with the cursor in a search field; the user picks a target
 * (a `\label{…}` for ref; one or more citekeys for citation); and the inline
 * atom is materialized via the no-scroll `insertInlineAtom` primitive only on
 * COMMIT — never up front. This module is the small typed seam the trigger
 * surfaces, the EditorLayout state, and the popover bodies all agree on.
 *
 * The atom node + sidecar card are identical to what the legacy paths produced;
 * this only moves the *creation front door* into one deferred-commit popover so
 * the gutter never flashes a blank pristine card mid-pick. Subsequent edits
 * still happen in the gutter card at its standard position.
 */

import type { Editor } from "@tiptap/core";
import type { RefCommand } from "@/lib/ref-display";
import type { TrackedPos } from "@/lib/tiptap/tracked-pos";

/** The two inline-atom kinds that flow through the shared create popover. */
export type AtomCreateKind = "citation" | "ref";

/** The `\ref`-family command an inserted `labelRef` carries — the ONE
 *  vocabulary (`@/lib/ref-display`), under the name this module's importers
 *  already use. */
export type AtomRefCommand = RefCommand;

/**
 * A request to open the create popover, captured at TRIGGER time.
 *
 * `pos` is the doc position the user invoked at — the **captured-position
 * contract** (`insertInlineAtom`'s `at`), so the atom lands where the user
 * invoked even though the live PM selection may drift while the modal-ish
 * popover is open. It is the TRIGGER-time number only: once the popover opens
 * it becomes an `AtomCreateSession.at` tracker that follows document edits
 * (task 1190). `rect` is the caret's screen rect; the popover anchors to it.
 */
export interface AtomCreateRequest {
  kind: AtomCreateKind;
  rect: DOMRect;
  pos: number;
  /** ref-only: which `\ref`-family command to insert (defaults to `"ref"`). */
  refCommand?: AtomRefCommand;
  /**
   * The editor instance that OWNS this create — the surface whose pos-space
   * `pos` was captured at trigger time. The COMMIT inserts the atom into THIS
   * editor (main OR an embedded footnote/card/float editor), never blindly into
   * MAIN. Mirrors `activeMath.editor` / `activeFigure.editor` exactly: the
   * trigger surface (slash via EditorPane, lightning via ActionsMenuPanel, grab
   * via drag-handle-actions) computes `pos`/`rect` against this editor, so the
   * insert must read `pos` in the same instance's pos-space. Optional only to
   * stay back-compatible with a malformed/legacy detail — the commit falls back
   * to MAIN when absent (CHIP 5 / TYPO #5: `\ref`/`\cite` started inside a
   * focused footnote editor land in the footnote body, not main).
   */
  editor?: Editor;
}

/**
 * The OPEN create popover's state (task 1190). The trigger-time `pos` is
 * replaced by `at`, a `trackPos` tracker in the owning editor: the document can
 * move while the user picks (an agent write, a code-pane re-parse, an embedded
 * card's write-back), so the commit and the live anchor read `at.get()` — the
 * captured spot mapped through every edit since — and the commit REFUSES when
 * it is `null` (the spot was deleted). There is deliberately no `pos` here, so
 * no reader can reach for the stale number. Whoever drops the state disposes
 * `at` (EditorLayout's request effect).
 */
export interface AtomCreateSession extends Omit<AtomCreateRequest, "pos"> {
  at: TrackedPos;
}

/** Options a trigger surface may thread into `openAtomCreate`. */
export interface OpenAtomCreateOpts {
  /** Explicit insertion position. Defaults to the live selection's `from` (the
   *  caret) — grab/lightning pass the captured passage-end here instead. */
  pos?: number;
  /** ref-only command seed. */
  refCommand?: AtomRefCommand;
}

/** The window event a trigger surface dispatches; EditorLayout's marker-clicks
 *  listener consumes it into `atomCreateRequest` state. The detail is an
 *  `AtomCreateRequest`. */
export const ATOM_CREATE_POPOVER_EVENT = "virgil-atom-create-popover";
