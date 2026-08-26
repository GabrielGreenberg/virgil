/**
 * The SHARED view-aware empty state for a card panel (task 478) — the copy half
 * of the rule declared in `card-archive-view.tsx`.
 *
 * It lives in its own file for a load-bearing reason rather than tidiness:
 * `card-archive-view.tsx` is an import-LIGHT leaf (React + two types), read by
 * every card panel and by pure node-env suites, and rendering `PANEL.empty`
 * means importing `panel-primitives` — which drags the whole storage barrel in
 * behind it and breaks those suites at import time. So the RULE (pure, total,
 * testable without a DOM) stays in the leaf, and the COPY lives here, beside
 * the only thing that needs a renderer.
 */

import { PANEL } from "@/components/panel-primitives";
import type { ArchiveEmptyReason } from "./card-archive-view";

/**
 * The shared view-aware empty state. Deliberately says nothing about what KIND
 * of card the panel holds — the panel header already names that, and a noun
 * threaded in from `PANEL_REGISTRY[kind].label` ("Every Todo List card is
 * archived") reads worse than the neutral one while buying nothing.
 *
 * Neither sentence instructs an action the current view would hide: the way out
 * of the view is the way forward.
 */
export function ArchiveViewEmptyState({ reason }: { reason: ArchiveEmptyReason }) {
  if (reason.kind === "all-archived") {
    return (
      <div className={PANEL.empty}>
        Every card here is archived. Switch to View Archives in the ⋮ menu to see
        them.
      </div>
    );
  }
  const hidden = reason.kind === "nothing-archived" ? reason.hidden : 0;
  return (
    <div className={PANEL.empty}>
      {hidden > 0 ? (
        <span className="block mb-1">
          {hidden === 1 ? "1 card is" : `${hidden} cards are`} hidden by this
          view.
        </span>
      ) : null}
      Nothing archived yet. Switch to View Active in the ⋮ menu.
    </div>
  );
}
