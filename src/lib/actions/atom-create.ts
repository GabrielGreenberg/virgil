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

/** The two inline-atom kinds that flow through the shared create popover. */
export type AtomCreateKind = "citation" | "ref";

/** The `\ref`-family command an inserted `labelRef` carries. Mirrors
 *  `RefCommand` in `LabelRefPopover` (re-declared here to keep this lib module
 *  free of a components→lib import inversion). */
export type AtomRefCommand = "ref" | "getref" | "getfullref";

/**
 * A request to open the create popover, captured at TRIGGER time.
 *
 * `pos` is the doc position the atom will land at on commit — the
 * **captured-position contract** (`insertInlineAtom`'s `at`), so the atom lands
 * where the user invoked even though the live PM selection may drift while the
 * modal-ish popover is open. `rect` is the caret's screen rect; the popover
 * anchors to it.
 */
export interface AtomCreateRequest {
  kind: AtomCreateKind;
  rect: DOMRect;
  pos: number;
  /** ref-only: which `\ref`-family command to insert (defaults to `"ref"`). */
  refCommand?: AtomRefCommand;
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
