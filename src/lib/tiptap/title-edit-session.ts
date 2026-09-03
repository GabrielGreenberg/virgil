/**
 * # ONE paragraph-title edit session, not three shapes (task 552)
 *
 * Three vanilla NodeViews let the user type a title above a block — the
 * paragraph and the list (`editor-extensions.ts`) and the expex example block
 * (`expex.ts`) — and each carried its own copy of the edit session: how the
 * `<input>` is placed, how the session is re-entered, how it ends, and what
 * `update()` may repaint while it is open. The copies had drifted in the way
 * copies do:
 *
 *   - The paragraph's RE-ENTRY guard read `titleAnnot.querySelector("input")`
 *     — a container its input never enters (the input is appended to
 *     `document.body`, positioned over the strip). Dead by construction: a
 *     second click on the strip (anywhere the input does not cover — the strip
 *     spans the full width) opened a SECOND input, whose focus blurred the
 *     first; the first then committed, ran the view's render, and repainted
 *     the `+T` / title strip UNDER the still-open second input, dropping
 *     `is-editing-title` off the wrapper mid-edit. The same dead probe gated
 *     `update()`, so a structural change landing mid-edit repainted the strip
 *     under the input too. The list carried the identical dead probe and was
 *     reachable only by accident — its click-away overlay eats the second
 *     click. The expex block's probe was TRUE, because its input really is
 *     inside the container it checks.
 *   - The paragraph committed on blur after a 150 ms deferral; the list
 *     committed immediately, behind a full-screen click-away overlay.
 *   - The paragraph and the list dispatched a commit whose value had not
 *     changed (a history entry and an autosave arm for a no-op); the
 *     paragraph did not.
 *
 * > **A session is a per-VIEW fact, not a DOM-containment fact.** The door
 * > holds `editing` and is the ONE place that flips it; the click handler
 * > asks `begin()` (a no-op while a session is open) and `update()` asks
 * > `editing`, so neither can be answered by probing a container the input
 * > may not be in. And the session has exactly two endings — COMMIT and CANCEL
 * > — of which exactly one happens (task 529's latch, in the vanilla idiom):
 * > `end()` records the ending BEFORE the input leaves the DOM, so the blur a
 * > removal or a re-focus can dispatch finds the session already over.
 *
 * What the door owns: the input (and, for body placement, the click-away
 * overlay), the `is-editing-title` class on the wrapper, `autoSizeInput`
 * through the view's lifetime, the Enter / Escape / blur / overlay wiring,
 * the arming window, and `lifetime.onDispose` — a view destroyed mid-edit
 * takes the body-appended elements with it and does NOT commit (the editor
 * the title would be written to is the one being torn down; task 548).
 *
 * What it does NOT own: the strip's render (the view's own `renderAnnot`,
 * handed in as `render`) and the WRITE (`commit`, the view's `setTitle`,
 * which resolves the node by live position on main and by uuid in a float).
 * A commit reaches `commit` only when the value CHANGED; an unchanged value
 * — Enter on the same title, a click-away with nothing typed — restores the
 * strip and dispatches nothing (task 470's zero-move rule: a gesture that
 * produced no net change has nothing to persist).
 *
 * ## Placement
 *
 * `placement` says where the `<input>` lives, and it is the ONE thing that
 * legitimately differs between the three callers:
 *
 *   - `"body"` (paragraph, list): appended to `document.body`, `position:
 *     fixed` over the strip. The untitled paragraph strip is an absolutely-
 *     positioned overlay of the inter-paragraph gap that fades to opacity 0
 *     off hover, so an input inside it would fade with it; the strip is left
 *     holding an nbsp placeholder for its own row's height. A full-screen
 *     click-away overlay sits under the input: a mousedown anywhere else ENDS
 *     the session (commit), and — because every other strip's mousedown is
 *     `preventDefault`ed and would otherwise open a second session on ANOTHER
 *     block without blurring this one — the overlay is what makes "one title
 *     session on screen" structural rather than lucky.
 *   - `"inline"` (expex block): appended INSIDE the strip, which sits in
 *     normal flow. Focus is taken in a FRAME (a synchronous focus inside the
 *     editor DOM loses to ProseMirror's mouseup selection sync) and there is no
 *     overlay: a body overlay would paint OVER an input nested inside the
 *     editor's stacking contexts. Click-away is the blur.
 *
 * ## Who is NOT in this population
 *
 * Two REACT surfaces also render a `par-title-input`: `SourcePodNodeView`'s
 * `+T` (the tex / forest pod) and `float-title-field` (a popped-out block's
 * title). Neither is a vanilla NodeView — they cannot call this door, because
 * their input is JSX React owns rather than an element a `begin()` appends,
 * and their re-entry is a `useState` flag no DOM probe was ever standing in
 * for. Each already holds task 529's law in the idiom available to it (the
 * `useFieldEditSession` hook and the draft door's `revert()`), so they are
 * deliberately left where they are — named here so the next reader knows the
 * door's population is the VANILLA strips and not "everything that shows a
 * title input", and the census that polices it is scoped to `addNodeView`
 * bodies for exactly that reason.
 *
 * Both placements ARM the blur commit after `PAR_TITLE_BLUR_ARM_MS`: a blur
 * inside a freshly-mounted input's first window is a focus STEAL (a competing
 * focus frame, the selection sync — the reason the heading strip's keeper
 * exists, task 548), not the user leaving. An overlay mousedown is never
 * gated on it — the user clicked away, and that is the session ending.
 *
 * The 150 ms DEFERRED commit is retired: it existed so a click on something
 * else could run before the blur committed, and with the overlay nothing else
 * is clickable.
 */

import { autoSizeInput } from "@/lib/autoSizeInput";
import { chromeOnly } from "@/lib/view-only-chrome";
import type { ViewLifetime } from "@/lib/tiptap/view-lifetime";
import { claimGestureKey } from "@/lib/pane-resize/pointer-invariants";

/** The input's own class — the ONE spelling; CSS and every suite read it. */
export const PAR_TITLE_INPUT_CLASS = "par-title-input";
/** The body-placed session's click-away overlay. */
export const PAR_TITLE_OVERLAY_CLASS = "par-title-edit-overlay";
/** Stamped on the wrapper for the life of a session (CSS: the untitled strip
 *  keeps its own row instead of overlaying the inter-paragraph gap). */
export const PAR_TITLE_EDITING_CLASS = "is-editing-title";
/** A blur inside this window after opening is a focus steal, not a leave. */
export const PAR_TITLE_BLUR_ARM_MS = 200;

export type ParTitlePlacement = "body" | "inline";

export interface ParTitleSessionOptions {
  /** The NodeView's outer element; carries `is-editing-title` while open. */
  wrapper: HTMLElement;
  /** The title strip (`.par-title-annotation`). */
  titleAnnot: HTMLElement;
  /** The view's lifetime — every timer and the body-appended elements are
   *  bounded by it (task 548). */
  lifetime: ViewLifetime;
  placement: ParTitlePlacement;
  placeholder: string;
  /** The title the node currently carries (null = untitled). */
  getTitle: () => string | null;
  /** Repaint the strip from the node — the view's own `renderAnnot`. */
  render: () => void;
  /** Persist a CHANGED title (null = cleared). Never called for an unchanged
   *  value, and never from a view teardown. */
  commit: (next: string | null) => void;
}

export interface ParTitleSession {
  /** Open the input. A no-op while a session is already open — the
   *  re-entry rule, keyed on the session, never on DOM containment. */
  begin(): void;
  /** True while an input owns the strip; `update()` must not repaint it. */
  readonly editing: boolean;
}

export function createParTitleSession(opts: ParTitleSessionOptions): ParTitleSession {
  const { wrapper, titleAnnot, lifetime, placement, placeholder, getTitle, render, commit } = opts;
  let editing = false;

  const begin = (): void => {
    if (editing) return;
    editing = true;
    wrapper.classList.add(PAR_TITLE_EDITING_CLASS);

    const original = getTitle() || null;
    const input = document.createElement("input");
    input.type = "text";
    input.className = chromeOnly(PAR_TITLE_INPUT_CLASS);
    input.value = original ?? "";
    input.placeholder = placeholder;

    let overlay: HTMLDivElement | null = null;
    if (placement === "body") {
      // The strip keeps its own row (nbsp for height) and the input floats
      // over it; the overlay beneath the input catches the click-away.
      wrapper.classList.add("has-add-btn");
      titleAnnot.style.display = "block";
      titleAnnot.textContent = " ";
      const annotRect = titleAnnot.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      overlay = document.createElement("div");
      overlay.className = chromeOnly(PAR_TITLE_OVERLAY_CLASS);
      overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:9998;";
      document.body.appendChild(overlay);
      input.style.cssText = `position:fixed;z-index:9999;left:${wrapperRect.left}px;top:${annotRect.top}px;`;
      document.body.appendChild(input);
    } else {
      titleAnnot.innerHTML = "";
      titleAnnot.appendChild(input);
    }

    // Auto-size to content (must be in the DOM first for the font read); its
    // first measure is a frame the lifetime owns.
    const cleanupSizer = autoSizeInput(input, 2, lifetime);

    // The 529 latch: `ended` is written SYNCHRONOUSLY by whichever ending runs
    // first, before the input leaves the DOM, so the blur a removal or a
    // re-focus can dispatch finds nothing left to end.
    let ended = false;
    const end = (): void => {
      if (ended) return;
      ended = true;
      editing = false;
      unregister();
      cleanupSizer();
      wrapper.classList.remove(PAR_TITLE_EDITING_CLASS);
      input.remove();
      overlay?.remove();
    };
    // A view destroyed mid-edit takes the session with it and commits nothing.
    const unregister = lifetime.onDispose(end);

    const commitSession = (): void => {
      if (ended) return;
      const next = input.value.trim() || null;
      end();
      // Restore the strip before any write: a CHANGED commit's dispatch
      // reaches the view's `update()`, which repaints from the new attr; an
      // unchanged one has nothing to dispatch and this is its whole ending.
      render();
      if (next !== original) commit(next);
    };
    const cancel = (): void => {
      if (ended) return;
      end();
      render();
    };

    input.addEventListener("keydown", (ev) => {
      // The session CLAIMS the keys it answers, and only those (task 552 —
      // the second member of `claimGestureKey`'s law). An open title input is
      // the innermost transient thing on screen, so one press ends exactly one
      // thing: unclaimed, this Escape ALSO reached `useMarginEdit`'s window
      // listener (dropping every guide dragged and not yet Saved),
      // `system-dialog`'s window-BUBBLE Escape (closing a scrimless
      // Preferences or a half-typed bug report), `NodeEditPopover` (committing
      // a math edit or discarding a figure one) and the marginalia overflow
      // pill. Every other key — Cmd-S, Cmd-P, a character — passes through:
      // the session does not answer them, and the paragraph's pre-552 blanket
      // `stopPropagation()` made this the one field in the app where Save did
      // nothing.
      if (ev.key === "Enter") {
        claimGestureKey(ev);
        commitSession();
      } else if (ev.key === "Escape") {
        claimGestureKey(ev);
        cancel();
      }
    });
    let armed = false;
    input.addEventListener("blur", () => {
      if (armed) commitSession();
    });
    lifetime.setTimeout(() => {
      armed = true;
    }, PAR_TITLE_BLUR_ARM_MS);
    overlay?.addEventListener("mousedown", (e) => {
      // STATED RESIDUAL: this claims the DEFAULT, not propagation, so the
      // click-away still reaches `document` — which means clicking away from a
      // title input ALSO dismisses an open scrimless Preferences / bug-report
      // window, a `NodeEditPopover` and the marginalia overflow pill. That is
      // the POINTER axis of the same "one press ends exactly one thing" law the
      // keydown handler above claims, and it is left alone DELIBERATELY: these
      // are the LIST's shipped click-away semantics, which this task adopts for
      // all three strips on the task's own recommendation, and stopping
      // propagation here would change what a click-away dismisses app-wide —
      // a decision about dismissal semantics rather than about the session.
      e.preventDefault();
      commitSession();
    });

    if (placement === "body") {
      input.focus();
      input.select();
    } else {
      lifetime.requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    }
  };

  return {
    begin,
    get editing() {
      return editing;
    },
  };
}
