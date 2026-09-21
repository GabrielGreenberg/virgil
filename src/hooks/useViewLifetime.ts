"use client";

/**
 * # A COMPONENT owns its timers' lifetime — the React half of the law
 *
 * `docs/agents/laws/a-nodeview-owns-its-timers-lifetime.md` states the rule for
 * vanilla ProseMirror NodeViews: *every timer a view arms is scheduled through
 * its ONE `ViewLifetime`, and `destroy()` disposes it — so no timer can outlive
 * the view.* The law was written in the medium where it was first paid for, and
 * a React card is the identical medium with a different teardown verb.
 *
 * `CitationCard.tsx` was the measurement (task 686): 1,723 lines, two ref-held
 * timers, and `grep -n "return () =>"` over the whole file returned ZERO hits —
 * no effect cleanup anywhere. Its Code field (the raw `\cite{…}` editor)
 * commits on a 250 ms debounce, so an unmount inside that window — a pop-out
 * re-parent, a panel re-sort, a document switch, all ordinary while the field
 * is open — left an orphan timer that fired against a dead component and wrote
 * the half-typed command into `citations.json` and, through the atom mirror,
 * into the user's `.tex`. React does not dispatch `blur` on unmount, so the
 * edit session ended ZERO times: not committed, not cancelled, and the
 * session's `codeOriginalRef` — the only record of what the half-typed command
 * replaced — died with the instance. The half-typed `\cite` became the
 * document's truth with nothing left that knew how to take it back.
 *
 * > **The component owns its timers' lifetime.** Every timer a component arms
 * > is scheduled through its ONE `ViewLifetime`, and UNMOUNT disposes it. A
 * > wall-clock bound is still allowed; the unmount is the OUTER bound, and a
 * > scheduling call made after disposal arms nothing.
 *
 * Why the same scope object rather than a React-shaped twin: a lifetime is not
 * a React idea. `createViewLifetime` already owns the three kinds (timeout,
 * interval, frame), reads the platform at CALL time so vitest's fake timers
 * cannot be captured stale, mints opaque handles so a post-disposal call still
 * returns something `clear()` accepts, and carries `onDispose` for the
 * non-timer things a session leaves behind. Two spellings of one rule is one
 * too many — the lesson task 486 earned for the refocus door and task 529 for
 * the edit-session door. This hook is the MOUNT, not a second scope.
 *
 * ## `onDispose` is where an unmount's edit session ends
 *
 * The teardown half of task 529 ("an edit session ends exactly once") has no
 * other home in React. `blur` is the event every other ending rides, and it is
 * the one event unmount does not produce. A component whose field holds an
 * uncommitted draft registers that field's ENDING on `onDispose` and gets the
 * guarantee by construction — and registers it through the field's own
 * `FieldEditSession` rather than calling the commit/cancel directly, so the
 * unmount is one of the session's endings rather than a second door beside it.
 *
 * ## Call it FIRST
 *
 * React runs a component's effect cleanups in declaration order, so the
 * lifetime's disposal runs before the cleanups of effects declared below it —
 * which is what lets an `onDispose` hook read state those effects have not yet
 * torn down. Declare `useViewLifetime()` above anything that schedules on it.
 */

import { useEffect, useMemo, useRef } from "react";
import { createViewLifetime, type ViewLifetime } from "@/lib/tiptap/view-lifetime";

/**
 * The ONE timer scope a React component arms through, disposed on unmount.
 *
 * The returned object is STABLE for the component's life (safe in a dependency
 * array) and always delegates to the live scope, so a handler that captured it
 * in an early render can never arm a timer on a scope that has been replaced.
 */
export function useViewLifetime(): ViewLifetime {
  const scopeRef = useRef<ViewLifetime | null>(null);
  if (scopeRef.current === null) scopeRef.current = createViewLifetime();

  useEffect(() => {
    // StrictMode's mount → cleanup → mount (and an offscreen/Suspense remount)
    // run with NO render in between, so the scope this pass owns may be the
    // disposed one the previous pass tore down. The replacement is minted HERE,
    // where "a mount happened" is the fact being observed — never in render,
    // which would hand two concurrent renders two different scopes.
    if (scopeRef.current === null || scopeRef.current.disposed) {
      scopeRef.current = createViewLifetime();
    }
    const scope = scopeRef.current;
    return () => {
      scope.dispose();
    };
  }, []);

  return useMemo<ViewLifetime>(() => {
    // A disposed scope is left in place rather than nulled: that is what makes
    // a post-unmount scheduling call INERT instead of silently reviving the
    // leak this hook exists to close.
    const live = (): ViewLifetime => scopeRef.current ?? (scopeRef.current = createViewLifetime());
    return {
      setTimeout: (cb, ms) => live().setTimeout(cb, ms),
      setInterval: (cb, ms) => live().setInterval(cb, ms),
      requestAnimationFrame: (cb) => live().requestAnimationFrame(cb),
      clear: (handle) => live().clear(handle),
      onDispose: (fn) => live().onDispose(fn),
      get disposed() {
        return live().disposed;
      },
      get pending() {
        return live().pending;
      },
      dispose: () => live().dispose(),
    };
  }, []);
}
