/**
 * The cursor-following write channel — ONE shape for every overlay that moves
 * with a held pointer (task 773).
 *
 * A drag ghost moves by an imperative `transform` on its own portal node(s),
 * never by React state and never by `left`/`top`: a raw mousemove arrives
 * several times per frame on a high-rate mouse, and a render + layout write per
 * EVENT is the class the pane-drag law killed (`docs/agents/laws/
 * pane-drag-stability.md`, "The tag half"). The channel's three obligations:
 *
 *  - **COALESCE** — `set()` records the live value and queues at most ONE
 *    animation frame however many events arrive before it runs.
 *  - **BAIL** — a frame at an unchanged value, over the SAME target nodes,
 *    writes nothing (a hold over a drop target, or the drop controller's
 *    edge-zone auto-scroll re-running its hit-test at a parked cursor).
 *    The record carries the target IDENTITIES, so a node swapped under an
 *    unchanged value is still written.
 *  - **MISS NOTHING** — a frame that finds no target mounted records nothing,
 *    so the value is not claimed as applied before a portal commits. A caller
 *    that mounts its node LATER calls `flush()` from the ref to write the live
 *    value synchronously (before paint).
 *
 * `cancel()` drops a queued frame, so a gesture's end path leaves no stale
 * write behind it. `format` owns the CSS spelling (and each caller's rest
 * value), so the channel stays agnostic to delta-vs-absolute placement.
 *
 * Consumers: the block lift overlay (`LiftHost`, delta from a frozen base) and
 * the inline-atom ghost (`inline-atom-ghost.ts`, absolute cursor placement).
 */

export interface TransformChannel {
  /** Record the live value; queue a frame if none is pending. */
  set(x: number, y: number): void;
  /** Apply the live value NOW (dropping any queued frame) — the mount path. */
  flush(): void;
  /** Drop a queued frame without writing — the gesture's end path. */
  cancel(): void;
  /** Forget what was applied, so the next frame writes unconditionally. */
  reset(): void;
}

export function createTransformChannel(opts: {
  /** The nodes to write, read at frame time (a ref may not be mounted yet). */
  targets: () => ReadonlyArray<HTMLElement | null>;
  /** The `transform` value for a live (x, y). */
  format: (x: number, y: number) => string;
}): TransformChannel {
  let x = 0;
  let y = 0;
  let raf = 0;
  let applied: {
    x: number;
    y: number;
    targets: ReadonlyArray<HTMLElement | null>;
  } | null = null;

  const apply = () => {
    raf = 0;
    const targets = opts.targets();
    if (!targets.some(Boolean)) return; // nothing mounted — nothing applied
    const prev = applied;
    if (
      prev &&
      prev.x === x &&
      prev.y === y &&
      prev.targets.length === targets.length &&
      prev.targets.every((t, i) => t === targets[i])
    ) {
      return;
    }
    applied = { x, y, targets: [...targets] };
    const t = opts.format(x, y);
    for (const el of targets) if (el) el.style.transform = t;
  };

  const cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  return {
    set(nx, ny) {
      x = nx;
      y = ny;
      if (raf) return;
      raf = requestAnimationFrame(apply);
    },
    flush() {
      cancel();
      apply();
    },
    cancel,
    reset() {
      applied = null;
    },
  };
}
