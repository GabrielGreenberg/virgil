/**
 * InlineAtomGrab — the direct in-text grab gesture for Virgil's Atoms.
 *
 * Realizes the Ontology's "text-bound mobility" affordance: the user
 * grabs an Atom (footnote / citation / \ref / inline math) in the prose
 * and drags it to a new inline-cursor position. The atom itself is the
 * grab handle — the inline cousin of the block `TextObjectGrabHandle`,
 * minus the popout mode (an atom's "float" is its Card, a separate thing).
 *
 * It is a ProseMirror plugin (a view-level `handleDOMEvents.mousedown`),
 * NOT a React component, so the single insertion point in
 * `buildEditorExtensions` lights up EVERY editor surface (main + each
 * card-body float). Keystroke-sanctity: pure `handleDOMEvents`, no
 * `state`/`appendTransaction` — zero per-keystroke and per-transaction
 * cost; the source is captured once at grab, so there is no doc walk per
 * mousemove.
 *
 * Gesture: mousedown on an atom (read-only-gated) → return `true` so PM
 * skips its own NodeSelection (killing the ~100px scroll-jump uniformly)
 * → on movement past an 8px threshold, capture the source and
 * `beginDropSession({inPlace, externalCommit})`, arm a one-shot
 * capture-phase click suppressor, and lift a cursor-following ghost
 * (`inline-atom-ghost.ts` → `<InlineAtomGhost>`) while clearing the native
 * text-selection → on mouseup, `commitDropSession()`. A
 * no-drag press arms no suppressor, so the atom's own click handler fires
 * (opens the Card / edit popover). The shared drop-mode controller drives
 * the inline-cursor hit-test, the indicator, and Esc-to-cancel.
 */

import { Extension } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { RefObject } from "react";
import {
  isMissedRelease,
  isPrimaryDragStart,
} from "@/lib/pane-resize/pointer-invariants";
import {
  ATOM_DOM_SELECTOR,
  atomMetaForDomType,
  type AtomMeta,
} from "./atom-registry";
import {
  beginDropSession,
  commitDropSession,
} from "@/components/drop-mode/controller";
import {
  stashInlineAtomSource,
  clearInlineAtomSource,
} from "@/components/drop-mode/util/inline-atom-source";
import {
  setGhost,
  updateGhostCursor,
  clearGhost,
} from "@/components/drop-mode/inline-atom-ghost";

export interface InlineAtomGrabOptions {
  /** Read-only mirror (library reader keeps `view.editable=true`, gates
   *  edits via this ref). Null in editors without one (card bodies). */
  editableRef: RefObject<boolean> | null;
}

/** Px the cursor must move before a press becomes a drag. Larger than the
 *  block grip's 5px because atoms are tiny targets and a mis-fire moves a
 *  footnote (and renumbers). */
const DRAG_THRESHOLD = 8;

/**
 * The affordance attribute — the ONE fact both halves of the grab read.
 *
 * The atoms' `cursor: grab` in `globals.css` is scoped to
 * `.ProseMirror[data-atoms-graspable="true"]`, so the pointer offers a
 * drag exactly where this plugin will accept one — *what the hover OFFERS
 * is what the commit ACCEPTS* (tasks 258 / 321 / 332 / 396). Before task
 * 524 the CSS rule was unconditional while the gesture was read-only-gated,
 * so every read-only surface said "grab", said "grabbing" on the press, and
 * did nothing: a collab non-pen-holder, every non-active keep-alive pane,
 * the Library Reader, and — sharpest — a live cowork-pen hold, where the
 * topbar's amber badge is at that moment saying the document is read-only.
 *
 * It is stamped on the editor root rather than read off `contenteditable`
 * because the two disagree by design: MAIN pins `view.editable = true`
 * (and therefore `contenteditable="true"`) whatever the user-facing state,
 * gating instead through `editableRef` (`Editor.tsx` — PM's own
 * `contenteditable="false"` broke selection routing in the Reader), while a
 * float / card body has no `editableRef` and gates on `view.editable`
 * alone. One attribute, computed from `atomsAreGraspable`, hides that fork
 * from every reader.
 *
 * A surface that does not MOUNT this plugin never carries the attribute, so
 * its atoms keep their base `cursor: pointer` — which is the honest answer
 * there too: `RichTextField` card bodies render citations and footnote
 * markers and have no grab gesture at all.
 */
export const ATOMS_GRASPABLE_ATTR = "data-atoms-graspable";

/**
 * Both layers that enforce read-only: collab toggles `view.editable`
 * (EditorLayout setEditable); the library reader keeps it true and gates via
 * `editableRef`. A move transaction is also filtered by `readOnlyEnforcer`,
 * but gating the gesture means no dead affordance — and the CSS reads this
 * same predicate through `stampAtomsGraspable`, so the two cannot drift.
 */
export const atomsAreGraspable = (
  view: EditorView,
  editableRef: RefObject<boolean> | null,
): boolean => view.editable && (editableRef ? editableRef.current : true);

/**
 * Write `atomsAreGraspable` onto the editor root. Idempotence-gated: a
 * `setAttribute` invalidates style even when the value is unchanged (task
 * 430), and this runs once per transaction from the plugin view below.
 *
 * PM ignores attribute mutations whose target is its own `view.dom`
 * (`DOMObserver.registerMutation` returns null for `desc == view.docView`),
 * so this cannot feed back into the editor — the same reason `Editor.tsx`'s
 * long-standing `data-editable` stamp is safe.
 */
export function stampAtomsGraspable(
  view: EditorView,
  editableRef: RefObject<boolean> | null,
): void {
  const next = atomsAreGraspable(view, editableRef) ? "true" : "false";
  if (view.dom.getAttribute(ATOMS_GRASPABLE_ATTR) === next) return;
  view.dom.setAttribute(ATOMS_GRASPABLE_ATTR, next);
}

let tokenCounter = 0;

export const InlineAtomGrab = Extension.create<InlineAtomGrabOptions>({
  name: "inlineAtomGrab",

  addOptions() {
    return { editableRef: null };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    const editableRef = this.options.editableRef;

    // The gesture's gate IS the affordance's gate (see `atomsAreGraspable`).
    const isEditable = (view: EditorView): boolean =>
      atomsAreGraspable(view, editableRef);

    let pending:
      | {
          meta: AtomMeta;
          pos: number;
          atomEl: HTMLElement;
          startX: number;
          startY: number;
          token: string;
          triggered: boolean;
        }
      | null = null;

    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      clearGhost();
      pending = null;
    };

    // One-shot capture-phase click swallow — armed only once a drag is
    // underway. Capture phase + stopImmediatePropagation because each
    // atom's own click handler runs in the bubble phase and itself calls
    // stopPropagation; a no-drag press never arms this, so the click
    // reaches that handler and opens the Card.
    const armClickSuppressor = () => {
      const swallow = (e: MouseEvent) => {
        e.stopImmediatePropagation();
        e.preventDefault();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      // Some platforms emit no click after a drag — drop the guard after a
      // tick so it can never swallow an unrelated later click (idempotent
      // with the one-shot removal above).
      window.setTimeout(
        () => window.removeEventListener("click", swallow, true),
        500,
      );
    };

    const onMove = (e: MouseEvent) => {
      if (!pending) return;
      // Missed-release failsafe (task 185/333) — PRE-threshold only, which is
      // this handler's exclusive ownership window. A swallowed mouseup used to
      // leave `pending` armed with these listeners installed, so the user's
      // next stray movement crossed the threshold and started a whole drop
      // session (ghost, click suppressor and all) from a press they had
      // already released. Post-threshold the drop-mode controller owns the
      // gesture and carries its OWN `isMissedRelease` bail — ending it from
      // here would commit the drop at a stale coordinate.
      if (!pending.triggered && isMissedRelease(e)) {
        clearInlineAtomSource();
        cleanup();
        return;
      }
      if (pending.triggered) {
        // Post-threshold: the controller's own mousemove drives the hit-test
        // + indicator; here we only keep the floating ghost glued to the
        // cursor (cheap — coords only, no doc work).
        updateGhostCursor(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - pending.startX;
      const dy = e.clientY - pending.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      pending.triggered = true;
      stashInlineAtomSource({
        token: pending.token,
        kind: pending.meta.kind,
        nodeName: pending.meta.nodeName,
        editor,
        pos: pending.pos,
      });
      const started = beginDropSession({
        cardKey: `atom-grab:${pending.token}`,
        origin: { x: pending.startX, y: pending.startY },
        inPlace: true,
        externalCommit: true,
        // Exact pane hint: the grab fired inside THIS editor, so the session
        // binds to that document's DropCtx by construction rather than to
        // whichever pane the focused→visible ladder resolves (N panes are
        // mounted at once under multi-doc keep-alive).
        editor,
      });
      if (!started) {
        clearInlineAtomSource();
        cleanup();
        return;
      }
      armClickSuppressor();
      // Lift a translucent ghost of the atom that floats with the cursor (the
      // inline cousin of the block lift's <LiftedTextOverlay>). The grab
      // offset uses the MOUSEDOWN point (startX/startY), not this threshold-
      // event point, so the cursor pins exactly where the user pressed — the
      // atom is tiny relative to the 8px threshold, so the block path's
      // threshold-event offset would sit a full threshold-radius off the
      // glyph. The rect is read HERE (not at mousedown) so a no-drag press
      // pays no forced layout; the gesture is synchronous (no transaction
      // between mousedown and now), so it equals the mousedown-time rect.
      const rect = pending.atomEl.getBoundingClientRect();
      setGhost({
        el: pending.atomEl,
        grabOffsetX: pending.startX - rect.left,
        grabOffsetY: pending.startY - rect.top,
        cursorX: e.clientX,
        cursorY: e.clientY,
      });
      // Clear any native text-selection that formed in the sub-threshold drag.
      // The `user-select:none` keyed on body[data-drop-mode-active] (set by
      // beginDropSession above) prevents NEW selection but can't retract an
      // in-progress one. Cosmetic only — ProseMirror's own selection is left
      // untouched (clearing it would be a transaction = keystroke-sanctity).
      window.getSelection()?.removeAllRanges();
      // From here the controller's own mousemove drives the hit-test +
      // indicator; suppress the native default for the rest of the drag.
      e.preventDefault();
    };

    const onUp = () => {
      const wasTriggered = pending?.triggered ?? false;
      cleanup();
      if (wasTriggered) {
        // Owns the commit (session was started with externalCommit). Safe
        // if Esc already cancelled — commitDropSession no-ops without a
        // session.
        void commitDropSession().finally(clearInlineAtomSource);
      }
    };

    return [
      new Plugin({
        key: new PluginKey("inlineAtomGrab"),
        // Publish the affordance from the gate the gesture reads.
        //
        // [cost: O(1)/tx] Two boolean reads, one getAttribute compare, and an
        // early return on an unchanged answer — no doc walk, no allocation, so
        // a plain keystroke costs a string compare. (A plugin `view()` is not
        // an `editor.on(...)` subscriber, so it is prose-listed in AGENTS.md
        // beside `sectionFoldingPlugin`'s refresher rather than in the
        // keystroke-subscriber allowlist, whose census greps that call form.)
        //
        // This covers every surface PM itself can see the flip on: a float /
        // card body gates on `view.editable`, which only changes through
        // `setEditable` → `updateState` → `update()` here, or through a
        // re-created editor, which runs `view()`. MAIN's answer lives in a
        // React ref PM never observes, so `Editor.tsx` re-stamps from its own
        // `editable` effect — two TRIGGERS, one WRITER, one PREDICATE.
        view(editorView) {
          stampAtomsGraspable(editorView, editableRef);
          return {
            update(updatedView) {
              stampAtomsGraspable(updatedView, editableRef);
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              if (pending) return false;
              // The engine's start gate (SSOT, never re-derived).
              if (!isPrimaryDragStart(event)) return false;
              if (
                event.shiftKey ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey
              ) {
                return false;
              }
              if (!isEditable(view)) return false;
              const target = event.target as HTMLElement | null;
              const atomEl = target?.closest?.(
                ATOM_DOM_SELECTOR,
              ) as HTMLElement | null;
              if (!atomEl) return false;
              const meta = atomMetaForDomType(atomEl.getAttribute("data-type"));
              if (!meta) return false;
              const pos = resolveAtomPos(view, atomEl, meta.nodeName);
              if (pos == null) return false;
              pending = {
                meta,
                pos,
                atomEl,
                startX: event.clientX,
                startY: event.clientY,
                token: `g${++tokenCounter}`,
                triggered: false,
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
              // Return true → PM skips its own mousedown, so it never rests
              // a NodeSelection on the atom (the scrollIntoView jump that
              // selectable:false avoids — uniform across all four kinds).
              //
              // preventDefault is REQUIRED: an atom is a contenteditable=false
              // island, which the browser treats as natively draggable. Without
              // it, a real-mouse press starts a native HTML5 drag whose
              // drag-detection swallows the mousemove/mouseup stream this
              // gesture needs — the Editor.tsx dragstart guard fires too late,
              // and `draggable=false` on the NodeView proved insufficient alone.
              // preventDefault on *mousedown* does NOT suppress the subsequent
              // *click*, so a no-drag press still opens the atom's Card.
              event.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },
});

/** The doc position of the atom whose NodeView DOM is `atomEl`. posAtDOM
 *  on an inline leaf's NodeView lands at/adjacent to the node; verify by
 *  kind, checking the most-likely positions first. Null when it can't be
 *  resolved (the gesture then falls through to a normal click). */
function resolveAtomPos(
  view: EditorView,
  atomEl: HTMLElement,
  nodeName: string,
): number | null {
  let pos: number;
  try {
    pos = view.posAtDOM(atomEl, 0);
  } catch {
    return null;
  }
  const doc = view.state.doc;
  for (const p of [pos, pos - 1, pos + 1]) {
    if (p < 0 || p > doc.content.size) continue;
    const node = doc.nodeAt(p);
    if (node && node.type.name === nodeName) return p;
  }
  return null;
}
