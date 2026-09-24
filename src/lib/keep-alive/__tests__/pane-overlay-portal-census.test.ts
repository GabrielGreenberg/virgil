// Task 753 — the leg with TEETH for "a pane-owned overlay portaled out of its
// pane".
//
// A kept-alive pane is hidden with `display:none` on its KeepAliveSlot, which
// hides only the slot's own subtree. A `createPortal(…, document.body)` from a
// component mounted per pane escapes that hide: the ⚡ margin bolt and the
// pending-change pill stayed painted — and live — over the shown doc after a
// tab switch, dispatching into the hidden one.
//
// The door is `PaneOverlayPortal` (keep-alive/PaneOverlayPortal.tsx): it
// renders nothing unless its pane is shown. It calls `createPortal` itself, so
// its call sites need no ledger row. Every OTHER `createPortal(` in the pane's
// import closure must be declared here with a scope, exactly (a count per
// file: a new portal fails, a removed one fails as stale). A scope carries a
// source check the file must pass where one is expressible.
//
// STATED LIMITS: the needle is a literal `createPortal(`; an aliased import
// passes unseen. The closure is IMPORT reachability, which over-approximates
// "mounted per pane" — app-wide singletons appear and are declared as such.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { paneImportClosure, relToSrc, SRC } from "./_pane-closure";

type Scope =
  /** The portal target is an element INSIDE the pane's own DOM, so the
   *  slot's `display:none` hides it. */
  | "in-pane"
  /** Already returns null while its pane is hidden (reads `useIsVisible`). */
  | "visible"
  /** Rendered only for the length of a pointer gesture (drag / lift / drop)
   *  that the pane started; a gesture cannot survive a pane switch. */
  | "gesture"
  /** Rendered only while a popup/menu/dialog is open; opening it took a
   *  click in the shown pane, and the click that switches panes dismisses it. */
  | "open-state"
  /** Mounted once app-wide, or app-global by design (not per pane). */
  | "app-wide";

interface Row {
  scope: Scope;
  count: number;
  why: string;
}

const SCOPE_TEETH: Partial<Record<Scope, RegExp>> = {
  visible: /if\s*\(\s*!isVisible\b[^)]*\)\s*return null/,
};

/** An `in-pane` file must not name `document.body` as a portal target. */
const BODY_TARGET = /\n\s*document\.body,?\s*\n\s*\)/;

const LEDGER: Record<string, Row> = {
  "lib/keep-alive/PaneOverlayPortal.tsx": {
    scope: "visible",
    count: 1,
    why: "the door itself",
  },
  "components/Marginalia.tsx": {
    scope: "in-pane",
    count: 1,
    why: "portals into the editor's own scroll container",
  },
  "text-objects/TextObjectGrabHandle.tsx": {
    scope: "in-pane",
    count: 1,
    why: "portals into the paper element's [data-grab-handle-portal] host",
  },
  "panels/Omni/OmniViewPanel.tsx": {
    scope: "in-pane",
    count: 1,
    why: "the bin stack portals into the omni frame's own bin slot",
  },
  "components/RichTextField.tsx": {
    scope: "in-pane",
    count: 1,
    why: "the format toolbar portals into its own card's toolbar slot",
  },
  "components/FloatingPanel.tsx": {
    scope: "visible",
    count: 1,
    why: "a hidden pane's floats return null (task 598)",
  },
  "text-objects/LiftedTextOverlay.tsx": {
    scope: "gesture",
    count: 1,
    why: "the lift overlay lives for one text-lift drag",
  },
  "components/drop-mode/Indicator.tsx": {
    scope: "gesture",
    count: 1,
    why: "drop indicator of a live drop-mode session",
  },
  "components/drop-mode/InlineAtomGhost.tsx": {
    scope: "gesture",
    count: 1,
    why: "the dragged atom's ghost, for one drag",
  },
  "components/CardLiftOutline.tsx": {
    scope: "gesture",
    count: 1,
    why: "one-shot lift-off flash while a card is dragged",
  },
  "components/editor-layout/DockOutline.tsx": {
    scope: "gesture",
    count: 1,
    why: "dock-target outline while a float is dragged",
  },
  "components/SlashCommandPopup.tsx": {
    scope: "open-state",
    count: 1,
    why: "rendered only for THIS editor's open slash popup (task 750)",
  },
  "components/menu/MenuProvider.tsx": {
    scope: "open-state",
    count: 1,
    why: "an open menu; the tab click that hides the pane dismisses it",
  },
  "components/system-dialog.tsx": {
    scope: "app-wide",
    count: 2,
    why: "app-modal system dialogs, not per pane",
  },
};

const PORTAL = /\bcreatePortal\(/g;

describe("pane-owned body portals go through PaneOverlayPortal (task 753)", () => {
  const closure = paneImportClosure();
  const found = new Map<string, { count: number; code: string }>();
  for (const [file, code] of closure) {
    const count = (code.match(PORTAL) ?? []).length;
    if (count) found.set(relToSrc(file), { count, code });
  }

  it("every createPortal in the pane closure is declared, exactly", () => {
    const undeclared = [...found]
      .filter(([rel, { count }]) => LEDGER[rel]?.count !== count)
      .map(([rel, { count }]) => `${rel} ×${count} (ledger: ${LEDGER[rel]?.count ?? 0})`);
    expect(
      undeclared,
      "route the portal through PaneOverlayPortal, or declare it in LEDGER with a scope",
    ).toEqual([]);
  });

  it("no stale ledger rows", () => {
    expect(Object.keys(LEDGER).filter((rel) => !found.has(rel))).toEqual([]);
  });

  it("each scope's teeth hold", () => {
    const bad: string[] = [];
    for (const [rel, row] of Object.entries(LEDGER)) {
      const hit = found.get(rel);
      if (!hit) continue;
      const teeth = SCOPE_TEETH[row.scope];
      if (teeth && !teeth.test(hit.code)) bad.push(`${rel}: ${row.scope}`);
      if (row.scope === "in-pane" && BODY_TARGET.test(hit.code)) {
        bad.push(`${rel}: in-pane but targets document.body`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the bolt and the pending-change pill ride the door", () => {
    for (const rel of ["components/SelectionActionsMenu.tsx", "components/PendingChangePill.tsx"]) {
      const src = readFileSync(path.join(SRC, rel), "utf8");
      expect(src, rel).toMatch(/<PaneOverlayPortal>/);
      expect(src, rel).not.toMatch(PORTAL);
    }
  });
});
