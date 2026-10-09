"use client";

/**
 * The drop-mode overlays — the blue placement bar (`DropModeIndicator`) and the
 * inline-atom drag ghost (`InlineAtomGhost`). Mounted ONCE, at app level
 * (`src/app/page.tsx`, beside `HintLayer`), never per pane (task 1027).
 *
 * Both render from APP-GLOBAL state — the one drop session (`useDropSession`)
 * and the one ghost module store — and portal to `document.body`. They used to
 * be rendered by `DropModeProvider`, which mounts once per `EditorPane`
 * (keep-alive capacity 3, the Library Reader up to 4 more), so N panes painted N
 * stacked identical bars and N ghost hosts, every one re-rendering on every
 * session edge. Worse, the ghost store has ONE node slot: each host's ref
 * overwrote it, last mount won, and a non-last pane unmounting mid-drag (LRU
 * eviction / tab close — the drop-ctx registry keeps the gesture alive for
 * unrelated panes) nulled the slot, so the ghost stopped following the cursor.
 *
 * The per-DOCUMENT half stays per pane: `DropModeProvider` registers its pane's
 * `DropCtx` and owns that pane's confirm dialog. The app-global half lives
 * here, with exactly one mount site — `drop-overlays-single-mount.test.ts`
 * holds both counts.
 */

import { DropModeIndicator } from "./Indicator";
import { InlineAtomGhost } from "./InlineAtomGhost";

export function DropModeOverlays() {
  return (
    <>
      <DropModeIndicator />
      <InlineAtomGhost />
    </>
  );
}
