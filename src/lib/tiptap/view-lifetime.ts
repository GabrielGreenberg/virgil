/**
 * # A NodeView owns its timers' lifetime
 *
 * A vanilla ProseMirror NodeView arms timers for the chrome it renders: the
 * heading strip's label input keeps a 30 ms refocus keeper alive for its
 * first 250 ms (something steals focus from a freshly-mounted input — a
 * competing focus frame, the ProseMirror selection sync), arms a blur guard
 * at 200 ms, and focuses in a frame; the paragraph / list / example title
 * inputs do the same. Every one of those was bounded by a WALL CLOCK — the
 * keeper cleared itself "after 250 ms" — and by nothing else.
 *
 * That is a PRODUCT lifetime, not the VIEW's. When the view is torn down
 * inside the window — ProseMirror re-creating it after a `update()` that
 * returned false, a document switch, a float closing, or the test
 * environment finishing its file — the ticks still queued on the timer heap
 * fire against a view that no longer exists. In the app that is a `focus()`
 * on a detached input; under vitest it is a `ReferenceError: document is not
 * defined` thrown into nobody's handler after jsdom has been torn down, and
 * vitest exits 1 on an unhandled error with every assertion green — which
 * failed the v0.1.104 release gate (task 548), load-dependently, presenting as
 * "the deploy failed" over a passing test summary.
 *
 * > **The NodeView owns its timers' lifetime.** Every timer a NodeView arms is
 * > scheduled through its ONE `ViewLifetime`, and `destroy()` disposes it, so
 * > no timer can outlive the view. A wall-clock bound is still allowed — the
 * > keeper still expires at 250 ms — but it is the view's teardown that is the
 * > OUTER bound, and a scheduling call made after disposal arms nothing.
 *
 * Why a scope and not a widened guard: `if (typeof document !== "undefined")`
 * inside the callback silences the symptom, leaves the timer running against a
 * dead environment, and puts a test-shaped condition into product code. Why a
 * scope and not "clear the interval on destroy" by hand: this input carried
 * TWO timers plus a frame, three sibling NodeViews carry the same shape, and a
 * hand-cleared handle is a per-timer obligation the next timer forgets. The
 * scope makes the obligation structural — a NodeView that spells the scope
 * cannot arm a timer the scope does not know about, and the census
 * ([nodeview-timer-lifetime.test.ts](__tests__/nodeview-timer-lifetime.test.ts))
 * forbids a bare timer verb inside any NodeView body.
 *
 * `onDispose` is the same rule for the NON-timer things an edit session
 * leaves behind: a `<input>` the paragraph title appended to `document.body`
 * (it positions over the strip), the click-away overlay a list title mounts.
 * Those outlive a destroyed view exactly as a timer does, and their edit
 * session's own cleanup is the thing to run.
 *
 * Handles are OPAQUE and minted here rather than the platform's own — Node
 * returns a `Timeout` object where the DOM returns a number, and a scheduling
 * call made after disposal has to return SOMETHING a caller can hand to
 * `clear` without a branch. `clear` is one door for all three kinds.
 */

export type ViewTimerKind = "timeout" | "interval" | "frame";

/** An opaque handle for a timer the lifetime owns. */
export interface ViewTimer {
  readonly kind: ViewTimerKind;
}

export interface ViewLifetime {
  /** `setTimeout` bounded by the view: fires once, or never if disposed first. */
  setTimeout(cb: () => void, ms: number): ViewTimer;
  /** `setInterval` bounded by the view: ticks until cleared or disposed. */
  setInterval(cb: () => void, ms: number): ViewTimer;
  /** `requestAnimationFrame` bounded by the view. */
  requestAnimationFrame(cb: FrameRequestCallback): ViewTimer;
  /** Cancel one timer of any kind. Idempotent; a foreign handle is ignored. */
  clear(handle: ViewTimer | null | undefined): void;
  /**
   * Run `fn` when the view is disposed (once). Returns an unregister function
   * for a session that ends on its own before the view does.
   */
  onDispose(fn: () => void): () => void;
  /** True once `dispose()` has run; every scheduling call is then inert. */
  readonly disposed: boolean;
  /** How many timers are currently armed — a probe for tests, never a gate. */
  readonly pending: number;
  /**
   * Cancel every armed timer, run every `onDispose` hook, and refuse all
   * later scheduling. Idempotent. Call it from the NodeView's `destroy()`.
   */
  dispose(): void;
}

type Platform = {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
  requestAnimationFrame: typeof globalThis.requestAnimationFrame;
  cancelAnimationFrame: typeof globalThis.cancelAnimationFrame;
};

/**
 * The platform is read at CALL time, not at module load: vitest's fake
 * timers swap the globals after this module is evaluated, and a lifetime that
 * captured the real ones would arm real timers under a fake clock — which is
 * exactly the shape that hides a leak from a `getTimerCount()` probe.
 */
function platform(): Platform {
  return {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
}

class Handle implements ViewTimer {
  constructor(readonly kind: ViewTimerKind) {}
}

export function createViewLifetime(): ViewLifetime {
  // handle → the platform's own id (a Timeout object under Node, a number
  // under the DOM); `unknown` because both are cleared by the same verb.
  const armed = new Map<Handle, unknown>();
  const disposers = new Set<() => void>();
  let disposed = false;

  const clear = (handle: ViewTimer | null | undefined): void => {
    if (!(handle instanceof Handle)) return;
    const id = armed.get(handle);
    if (id === undefined) return;
    armed.delete(handle);
    const p = platform();
    if (handle.kind === "timeout") p.clearTimeout(id as ReturnType<typeof setTimeout>);
    else if (handle.kind === "interval") p.clearInterval(id as ReturnType<typeof setInterval>);
    else p.cancelAnimationFrame(id as number);
  };

  return {
    setTimeout(cb, ms) {
      const h = new Handle("timeout");
      if (disposed) return h;
      const id = platform().setTimeout(() => {
        armed.delete(h);
        cb();
      }, ms);
      armed.set(h, id);
      return h;
    },
    setInterval(cb, ms) {
      const h = new Handle("interval");
      if (disposed) return h;
      armed.set(h, platform().setInterval(cb, ms));
      return h;
    },
    requestAnimationFrame(cb) {
      const h = new Handle("frame");
      if (disposed) return h;
      const id = platform().requestAnimationFrame((t) => {
        armed.delete(h);
        cb(t);
      });
      armed.set(h, id);
      return h;
    },
    clear,
    onDispose(fn) {
      if (disposed) {
        fn();
        return () => {};
      }
      disposers.add(fn);
      return () => {
        disposers.delete(fn);
      };
    },
    get disposed() {
      return disposed;
    },
    get pending() {
      return armed.size;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const h of Array.from(armed.keys())) clear(h);
      const fns = Array.from(disposers);
      disposers.clear();
      for (const fn of fns) fn();
    },
  };
}
