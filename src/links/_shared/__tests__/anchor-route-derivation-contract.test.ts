import { describe, it, expect } from "vitest";
import {
  ANCHOR_CLICK_KINDS,
  ANCHOR_CLICK_ROUTES,
} from "@/components/editor-layout/event-bridges/marker-clicks";
import { MODE_B_CARD_KINDS } from "@/cards/mode-b-collections";
import { MARGIN_MARKER_SOURCES } from "@/cards/margin-markers";
import { cardEntrySelector } from "@/components/editor-layout/panel-selection";
import { cardDomSelector } from "@/panels/panel-registry";

/**
 * A2 Commit D pin-test. `ANCHOR_CLICK_ROUTES` (marker-clicks) was a hand-kept
 * literal table; A2 DERIVES it from the registry (`panelForCardKind`). The
 * per-kind `entrySelectorBase` carve-outs it used to carry are gone (task
 * 1172): the entry address is `cardEntrySelector(kind, id)` — the ONE owner
 * `panel-selection.ts` also reads — pinned in the second block below.
 *
 * This pins the derived output to the exact pre-A2 literals so the derivation
 * can't silently drift. (The sibling entity-kind→anchor-kind half was deleted
 * in A10 Commit G — that mapper had no remaining consumers.)
 */

// The pre-A2 literals plus the margin's kinds A6 added (R15), plus
// `highlight` — a Mode-B kind whose span became live in task 666 but which the
// old hand-kept union omitted, so its click was swallowed (task 1296).
const EXPECTED_ROUTES = {
  note: { panelId: "notes", cardKind: "note" },
  highlight: { panelId: "notes", cardKind: "highlight" },
  "cutter-comment": { panelId: "cutter", cardKind: "cutter-comment" },
  "cutter-suggestion": { panelId: "cutter", cardKind: "cutter-suggestion" },
  "revision-comment": { panelId: "revisions", cardKind: "revision-comment" },
  "revision-suggestion": { panelId: "revisions", cardKind: "revision-suggestion" },
  // A6/R15: the margin's Mode-A paragraph-anchored kinds.
  archive: { panelId: "archive", cardKind: "archive" },
  todo: { panelId: "todo", cardKind: "todo" },
  report: { panelId: "reports", cardKind: "report" },
  "report-request": { panelId: "reports", cardKind: "report-request" },
} as const;

describe("ANCHOR_CLICK_ROUTES derived ≡ the frozen literals", () => {
  it("matches the frozen table exactly (panelId via panelForCardKind, cardKind = key)", () => {
    expect(ANCHOR_CLICK_ROUTES).toEqual(EXPECTED_ROUTES);
  });

  it("exactly the ten routed kinds (no extra/missing keys)", () => {
    expect(Object.keys(ANCHOR_CLICK_ROUTES).sort()).toEqual(
      Object.keys(EXPECTED_ROUTES).sort(),
    );
  });

  // Task 1296: the routed set ≡ the union of what the two dispatchers can
  // send — every Mode-B span kind (the hover bridge's SSOT) and every kind a
  // margin marker source paints. A newly-live span or marker kind can no
  // longer be dispatched into a route table that does not know it.
  it("routes every kind either dispatcher can send — and nothing else", () => {
    const marginKinds = Object.values(MARGIN_MARKER_SOURCES).flatMap((s) => s.kinds);
    const dispatchable = new Set<string>([...MODE_B_CARD_KINDS, ...marginKinds]);
    expect([...ANCHOR_CLICK_KINDS].sort()).toEqual([...dispatchable].sort());
    for (const kind of dispatchable) expect(ANCHOR_CLICK_ROUTES).toHaveProperty(kind);
  });
});

// The legacy hook attributes the retired `entrySelectorBase` table routed to.
// They must still resolve — the ONE address ORs them with `data-card-key`.
const LEGACY_ENTRY_ATTR: Partial<Record<keyof typeof EXPECTED_ROUTES, string>> = {
  note: "data-note-entry",
  archive: "data-archive-entry",
  todo: "data-todo-entry",
  report: "data-report-entry",
  "report-request": "data-report-request-entry",
};

describe("every routed kind's entry address is the ONE cardEntrySelector (task 1172)", () => {
  for (const kind of Object.keys(EXPECTED_ROUTES) as (keyof typeof EXPECTED_ROUTES)[]) {
    it(`${kind}: canonical data-card-key, plus its legacy attribute where it had one`, () => {
      const sel = cardEntrySelector(kind, "x1");
      expect(sel).toContain(cardDomSelector(kind, "x1"));
      const legacy = LEGACY_ENTRY_ATTR[kind];
      if (legacy) expect(sel).toContain(`[${legacy}="x1"]`);
    });
  }
});
