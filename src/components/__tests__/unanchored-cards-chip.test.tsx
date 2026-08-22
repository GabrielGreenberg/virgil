// @vitest-environment jsdom
//
// Task 410 — the unanchored set LEAVES the margin lane.
//
// Pre-410 a card whose anchor had died docked in the margin column itself:
// `OrphanDock`, a `position:absolute; top:6; zIndex:12` box with
// `pointer-events-auto`, rendered as the LAST child of the same column that
// holds the marker cells. `computeMarkerPositions` — the one walk that packs
// this lane (task 366) — could not see it, so it was a second owner in a lane
// with one author. Three costs, and they are what these legs pin:
//
//   1. OVERLAP + STOLEN CLICKS. The dock's band is `6 … 12 + 26n`; the first
//      block's first cell sits at ≈83 under the default 40px top margin (the
//      prose root sits below a 40px `doc-prose-leadin::before`), ≈43 at
//      `MARGIN_MIN.top`. So n ≥ 3 (default) / n ≥ 2 (min) covered marker cells
//      — and being an opaque `pointer-events-auto` surface ABOVE them, it took
//      their clicks too. The click half is why a geometry-only leg is not
//      enough: an implementation can paint correctly and still eat the click.
//   2. CULLED WITH THE CELLS. `laneCols[side] <= 0` (cramped margin, zen, the
//      read-only reader) dropped the dock along with the grid — so the one
//      surface that exists to stop an anchor-less card vanishing could itself
//      vanish. Pinned in `marginalia-lane-regime.test.ts`, renegotiated there.
//   3. SCROLL-INVISIBLE. `top: 6` inside a naturally tall, non-scrolling pod
//      (`.editor-pane-pod` is `overflow: clip`) means the re-pin entry point
//      was unreachable on any scrolled document.
//
// The fix is a relocation, not a nudge: an unanchored card is a fact about the
// CARD (no metrics, no side, no lane regime), so it is derived at the marker
// source and surfaced in the pane's STICKY chrome header
// (`UnanchoredCardsChip`). The lane is left with exactly one kind of occupant.
//
// The leg with teeth is the SWEEP + the source CENSUS: the grid was never the
// part that could misbehave — a second owner rendered into the column is, and
// that owner is invisible to every test of the packer.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Marginalia transitively pulls panel theming; stub storage defensively
// (the barrel/storage gotcha) so nothing tries to touch a sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

const beginDropSession = vi.fn((..._args: unknown[]) => true);
const commitDropSession = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/components/drop-mode/controller", () => ({
  beginDropSession: (...args: unknown[]) => beginDropSession(...args),
  commitDropSession: (...args: unknown[]) => commitDropSession(...args),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MarginColumn } from "@/components/Marginalia";
import { UnanchoredCardsChip } from "@/components/UnanchoredCardsChip";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import {
  resolveMarkerCols,
  type AnchorNodeMetrics,
  type MarginaliaMarker,
} from "@/lib/marginalia";

afterEach(cleanup);
beforeEach(() => {
  beginDropSession.mockClear();
  beginDropSession.mockReturnValue(true);
});

const SRC = (rel: string) =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");

/**
 * The FIRST block's metrics, with the lead-in included. `--doc-title-leadin`
 * is set nowhere in the repo, so the shipped value is the 40px fallback
 * (`phantom-css-var.test.ts` records it); the prose root sits below it, which
 * is why the first cell lands at ≈83 rather than ≈41 and why the pre-410 dock
 * needed n ≥ 3 to bite at the default margin. A fixture without the lead-in
 * produces FALSE POSITIVES at n = 1.
 */
const LEAD_IN = 40;
const FIRST_BLOCK: AnchorNodeMetrics = {
  id: "p1",
  top: LEAD_IN + 43,
  domTop: LEAD_IN + 43,
  height: 24,
  lineHeight: 24,
  lineCount: 1,
  isAtom: false,
};

function anchored(i: number, side: "left" | "right"): MarginaliaMarker {
  return {
    id: `a${i}:p1`,
    entityId: `a${i}`,
    entityKind: "note",
    type: "note",
    textObjectId: "p1",
    side,
    title: `anchored ${i}`,
  };
}

function unanchored(i: number, side: "left" | "right"): MarginaliaMarker {
  return {
    id: `u${i}:pdead`,
    entityId: `u${i}`,
    entityKind: "note",
    type: "note",
    textObjectId: "pdead",
    side,
    title: `unanchored ${i}`,
    unanchored: true,
  };
}

/** Every element in the rendered column that can TAKE a click. */
function clickTakers(root: HTMLElement): HTMLElement[] {
  const col = root.querySelector("[data-marginalia-margin]") as HTMLElement;
  return [...col.querySelectorAll<HTMLElement>("*")].filter((el) =>
    el.className.toString().split(/\s+/).includes("pointer-events-auto"),
  );
}

// ===========================================================================
// The sweep — n = 1..4 unanchored × margins 0..200 × both sides
// ===========================================================================

describe("the margin lane has exactly ONE kind of occupant", () => {
  it("no unanchored marker reaches the lane, and nothing but a marker button can take a click there — swept n=1..4 × margin 0..200 × both sides", () => {
    let hostedRegime = 0;
    let crampedRegime = 0;

    for (const side of ["left", "right"] as const) {
      for (let n = 1; n <= 4; n++) {
        for (let available = 0; available <= 200; available += 4) {
          const markers = [
            anchored(0, side),
            ...Array.from({ length: n }, (_, i) => unanchored(i, side)),
          ];
          const laneCols = {
            left: resolveMarkerCols("left", side === "left" ? available : null),
            right: resolveMarkerCols("right", side === "right" ? available : null),
          };
          const { positioned, overflowGroups } = computeMarkerPositions(
            (uuid) => (uuid === "p1" ? FIRST_BLOCK : null),
            markers,
            {},
            laneCols,
          );
          if (laneCols[side] > 0) hostedRegime++;
          else crampedRegime++;

          // (a) not a lane occupant — in neither bucket, at any margin.
          const inLane = [
            ...positioned,
            ...overflowGroups.flatMap((g) => g.hidden),
          ].map((m) => m.entityId);
          expect(inLane.filter((id) => id.startsWith("u"))).toEqual([]);

          // (b) …and the rendered column holds no click-taking surface that
          // is not a marker button. This is the interception half: the
          // pre-410 dock was an opaque `pointer-events-auto` DIV above the
          // cells, which a geometry-only assertion cannot see.
          const { container, unmount } = render(
            <MarginColumn
              side={side}
              markers={positioned.filter((p) => p.side === side)}
              overflow={overflowGroups.filter((g) => g.side === side)}
              dragEnabled
            />,
          );
          expect(
            container.querySelector("[data-marginalia-orphan-dock]"),
          ).toBeNull();
          for (const el of clickTakers(container)) {
            expect(
              el.className.toString().includes("marginalia-marker"),
            ).toBe(true);
          }
          unmount();
        }
      }
    }

    // The sweep crossed BOTH regimes with markers up, so it cannot have
    // passed by rendering nothing anywhere.
    expect(hostedRegime).toBeGreaterThan(0);
    expect(crampedRegime).toBeGreaterThan(0);
  });

  it("NON-REGRESSION: N unanchored markers never fold the first block's markers into a '+K' pill", () => {
    // Pinned because task 366's drift bound is what the source memo wrongly
    // blamed for blocking this fix. Nothing feeds orphans into the frontier
    // then or now, and the relocation must not introduce it.
    for (let n = 1; n <= 4; n++) {
      const { positioned, overflowGroups } = computeMarkerPositions(
        (uuid) => (uuid === "p1" ? FIRST_BLOCK : null),
        [
          anchored(0, "right"),
          ...Array.from({ length: n }, (_, i) => unanchored(i, "right")),
        ],
        {},
        { left: 1, right: 2 },
      );
      expect(overflowGroups).toEqual([]);
      expect(positioned).toHaveLength(1);
      // …and it is placed on its own line, not pushed down by a phantom owner.
      expect(positioned[0].cell.y).toBe(
        FIRST_BLOCK.top + (FIRST_BLOCK.lineHeight - 22) / 2,
      );
    }
  });
});

// ===========================================================================
// The chip — the relocated affordance
// ===========================================================================

describe("UnanchoredCardsChip — the relocated affordance", () => {
  it("renders nothing when nothing is unanchored (no control that does nothing)", () => {
    const { container } = render(
      <UnanchoredCardsChip markers={[]} dragEnabled />,
    );
    expect(container.querySelector("[data-unanchored-cards-chip]")).toBeNull();
  });

  it("shows the count and, on click, one MarkerButton per unanchored card", () => {
    const markers = [unanchored(0, "right"), unanchored(1, "left"), unanchored(2, "right")];
    render(<UnanchoredCardsChip markers={markers} dragEnabled />);
    const pill = screen.getByRole("button", { name: /3 unanchored cards/i });
    expect(pill.textContent).toContain("3 unanchored");
    // Closed by default — the list is not mounted.
    expect(document.querySelector("[data-unanchored-cards-list]")).toBeNull();
    fireEvent.click(pill);
    const list = document.querySelector("[data-unanchored-cards-list]")!;
    expect(list.querySelectorAll("[data-marginalia-marker]")).toHaveLength(3);
    expect(list.textContent).toContain("unanchored 0");
  });

  it("click still opens the card (the panel route) and closes the list", () => {
    const onClick = vi.fn();
    const m = { ...unanchored(0, "right"), onClick };
    render(<UnanchoredCardsChip markers={[m]} dragEnabled />);
    fireEvent.click(screen.getByRole("button", { name: /1 unanchored card/i }));
    fireEvent.click(
      document.querySelector("[data-marginalia-marker]") as HTMLElement,
    );
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-unanchored-cards-list]")).toBeNull();
  });

  it("the re-pin grab still starts a drop-mode session from OUTSIDE the lane", () => {
    // The whole point of reusing `MarkerButton`: nothing about the re-anchor
    // gesture depends on where the button sits.
    render(<UnanchoredCardsChip markers={[unanchored(0, "right")]} dragEnabled />);
    fireEvent.click(screen.getByRole("button", { name: /1 unanchored card/i }));
    fireEvent.mouseDown(
      document.querySelector("[data-marginalia-marker]") as HTMLElement,
      { button: 0, buttons: 1, clientX: 10, clientY: 10 },
    );
    expect(beginDropSession).toHaveBeenCalledTimes(1);
  });

  it("a read-only host (the Reader) still lists them, click-only", () => {
    render(
      <UnanchoredCardsChip markers={[unanchored(0, "right")]} dragEnabled={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /1 unanchored card/i }));
    fireEvent.mouseDown(
      document.querySelector("[data-marginalia-marker]") as HTMLElement,
      { button: 0, buttons: 1, clientX: 10, clientY: 10 },
    );
    expect(beginDropSession).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// CENSUS — the leg with teeth
// ===========================================================================

describe("census — the retired owner cannot come back, and the chip reads the right set", () => {
  it("the margin renders no re-pin dock and the grid declares no second bucket", () => {
    const marginalia = SRC("components/Marginalia.tsx");
    expect(marginalia).not.toContain("OrphanDock");
    expect(marginalia).not.toContain("data-marginalia-orphan-dock");
    const grid = SRC("lib/marginalia-grid.ts");
    // No `orphans` bucket on the result type — the field is what a renderer
    // reaches for, and its absence is what makes the relocation structural
    // rather than a promise.
    expect(grid).not.toMatch(/^\s*orphans:/m);
  });

  it("the chip is fed from `marginaliaMarkers`, NOT the view-filtered set — a lost anchor is not hideable by a layout preference", () => {
    const pane = SRC("components/EditorPane.tsx");
    // The derivation exists and reads the unfiltered source…
    const decl = pane.match(
      /const unanchoredMarkers = useMemo\(([\s\S]{0,400}?)\);\n/,
    );
    expect(decl, "unanchoredMarkers derivation not found").toBeTruthy();
    expect(decl![1]).toContain("marginaliaMarkers.filter");
    expect(decl![1]).not.toContain("visibleMarginaliaMarkers");
    // …and it is what the chip is handed.
    expect(pane).toContain("markers={unanchoredMarkers}");
  });

  it("the chip is mounted in the STICKY chrome header, not inside the marginalia host", () => {
    // The scroll-invisibility half. `<Marginalia>` renders into the pod (the
    // scrolling surface); the chrome header is the sticky band above it. If
    // the chip ever moved next to `<Marginalia`, cost (3) comes straight back.
    const pane = SRC("components/EditorPane.tsx");
    const headerAt = pane.indexOf('data-tool-strip="text"');
    const podAt = pane.indexOf('className="editor-pane-pod"');
    expect(headerAt).toBeGreaterThan(0);
    expect(podAt).toBeGreaterThan(headerAt);
    // Exactly one mount, and it is inside the sticky header element — which
    // ENDS where the scrolling pod begins. A chip rendered anywhere in the pod
    // (the marginalia host) scrolls away with the document, which is cost (3).
    const mounts = pane.split("<UnanchoredCardsChip").length - 1;
    expect(mounts).toBe(1);
    const chipAt = pane.indexOf("<UnanchoredCardsChip");
    expect(chipAt).toBeGreaterThan(headerAt);
    expect(chipAt).toBeLessThan(podAt);
  });
});
