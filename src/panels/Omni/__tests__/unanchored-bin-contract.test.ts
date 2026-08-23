// @vitest-environment jsdom
//
// A5 Commit C contract for the unanchored-card bin. Three guards:
//   1. Classification — free + orphaned render in the bin (collapsed shows a
//      count pill; expanded lists them); orphaned rows carry a BadgeOrphaned;
//      an anchored item never enters the bin.
//   2. Zero-flow / no-overlap — the shared `OmniBinStack` wrapper is the single
//      `position: absolute` host (so the bin subtree takes no flow space and
//      can't displace the cascade pod's top the way the deleted flow <div>
//      did); the individual bins flow in normal layout inside it (task 127), so
//      the outside-focus bin sits below the unanchored bin collapsed OR
//      expanded. Neither wrapper nor bin carries `data-omni-entry-wrapper`, so
//      the cascade ResizeObserver never measures them → expand/collapse can't
//      bump measureVersion.
//   3. Cascade-purity — the panel split that feeds `inTextItems` never lets a
//      `pos == null` item into the natural cascade map.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { createElement } from "react";

// Importing OmniViewPanel pulls the omni builders' card components, whose
// barrel transitively `require()`s `@/lib/storage` (an unaliasable path under
// vitest). Stub it. (memory: vitest_extension_barrel_storage_mock.md)
vi.mock("@/lib/storage", () => {
  const stub = () => undefined;
  const names = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib", "createDocFromPicker",
    "createDocInFolder", "pickProjectFolder", "registerDocInFolder",
    "openExistingDocFromPicker", "listDocs", "renameDoc", "deleteDocFromIndex",
    "flushDoc", "drainDoc", "detectBibPackage", "readPaperFolder", "getTexFilename",
    "writePdf", "readPdf", "getPdfFilename", "pdfFilenameFromTex", "readFigureSource",
    "readFigureRaster", "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: () => false };
  for (const n of names) mod[n] = stub;
  return mod;
});

import { OmniUnanchoredBin, OmniBinStack } from "@/panels/Omni/OmniViewPanel";
import type { OmniItem } from "@/panels/_shared/types";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const freeItem: OmniItem = {
  id: "float:card:note:free-1",
  pos: null,
  anchorState: "free",
  content: createElement("div", { "data-test-card": "free-1" }, "free note body"),
};
const orphanItem: OmniItem = {
  id: "float:card:footnote:orphan-1",
  pos: null,
  anchorState: "orphaned",
  content: createElement("div", { "data-test-card": "orphan-1" }, "orphan footnote body"),
};

describe("OmniUnanchoredBin — classification + render", () => {
  it("renders nothing when there are no unanchored cards", () => {
    const { container } = render(
      createElement(OmniUnanchoredBin, { free: [], orphaned: [] }),
    );
    expect(container.querySelector("[data-omni-unanchored-bin]")).toBeNull();
  });

  it("collapsed by default: shows a count pill, hides the card bodies", () => {
    const { container } = render(
      createElement(OmniUnanchoredBin, { free: [freeItem], orphaned: [orphanItem] }),
    );
    const bin = container.querySelector("[data-omni-unanchored-bin]")!;
    expect(bin).not.toBeNull();
    // RENEGOTIATED (task 422): one pill per AnchorState, never a sum — a
    // free card must not be counted under the error badge.
    expect(bin.textContent).toContain("1 unanchored");
    expect(bin.textContent).toContain("1 unplaced");
    // Bodies are not rendered while collapsed.
    expect(container.querySelector('[data-test-card="free-1"]')).toBeNull();
    expect(container.querySelector('[data-test-card="orphan-1"]')).toBeNull();
  });

  it("expanded: lists exactly the free + orphaned bodies; orphaned row carries BadgeOrphaned", () => {
    const { container } = render(
      createElement(OmniUnanchoredBin, { free: [freeItem], orphaned: [orphanItem] }),
    );
    for (const b of Array.from(container.querySelectorAll("button"))) fireEvent.click(b);
    expect(container.querySelector('[data-test-card="free-1"]')).not.toBeNull();
    expect(container.querySelector('[data-test-card="orphan-1"]')).not.toBeNull();

    // The orphaned row carries the bin-level BadgeOrphaned marker; the free
    // row does not.
    const orphanMarker = container.querySelector("[data-omni-bin-orphan-marker]");
    expect(orphanMarker).not.toBeNull();
    // BadgeOrphaned renders an aria-label="No anchor in document".
    expect(
      within(orphanMarker as HTMLElement).getByLabelText("No anchor in document"),
    ).not.toBeNull();
    // Exactly one bin-level orphan marker (only the orphaned row gets one).
    expect(container.querySelectorAll("[data-omni-bin-orphan-marker]").length).toBe(1);
  });
});

describe("OmniBinStack — zero-flow wrapper / measurement exclusion", () => {
  it("wrapper is the single position:absolute host; bins flow inside it; no data-omni-entry-wrapper", () => {
    const { container } = render(
      createElement(
        OmniBinStack,
        null,
        createElement(OmniUnanchoredBin, { free: [freeItem], orphaned: [orphanItem] }),
      ),
    );
    const stack = container.querySelector("[data-omni-bin-stack]") as HTMLElement;
    // The WRAPPER carries the load-bearing zero-flow guard (absolute → no flow
    // space → cannot displace the cascade pod's top). RENEGOTIATED (task 421):
    // this leg used to pin `top: 4px` — a DOCUMENT coordinate on a pod that is
    // as tall as the paper, i.e. the defect asserted as the contract. The
    // in-pod host is now `inset: 0` with a STICKY inner, and a real column
    // portals the stack into its band frame instead (omni-bin-posture.test).
    expect(stack.style.position).toBe("absolute");
    expect(stack.style.top).toBe("");
    expect(stack.style.inset).toBe("0px");
    // The individual bin now flows in NORMAL layout inside the wrapper (task
    // 127) — it is NOT its own absolute sibling, so the outside-focus bin can
    // stack below it whether it is collapsed or expanded.
    const bin = container.querySelector("[data-omni-unanchored-bin]") as HTMLElement;
    expect(bin.style.position).not.toBe("absolute");
    // The cascade ResizeObserver measures `[data-omni-entry-wrapper]`. Neither
    // wrapper nor bin may appear under that selector (collapsed OR expanded),
    // or their height changes would feed back into measureVersion.
    expect(container.querySelectorAll("[data-omni-entry-wrapper]").length).toBe(0);
    fireEvent.click(container.querySelector("button")!);
    expect(container.querySelectorAll("[data-omni-entry-wrapper]").length).toBe(0);
  });
});

// The cascade-purity invariant (the panel split never feeds a pos:null item
// to the cascade) used to be pinned here via a hand-copied mirror of
// OmniViewPanel's split useMemo — a mirror can't fail when the component
// drifts. It is now pinned against the REAL default-exported component in
// `omni-view-panel-split-contract.test.tsx` (test-hardening rewire), which
// captures the actual `inTextItems` argument via the useInTextPositions mock.
