// @vitest-environment jsdom
//
// Task 422 — the AnchorState SSOT separates `free` (a card deliberately
// parked without an anchor: "a normal, non-error state (plain card, no red
// badge)") from `orphaned` (the anchor DIED: the recoverable-error state,
// red BadgeOrphaned). OmniViewPanel classified them apart and the RENDER
// surface summed them back into one error-badged "N unanchored" pill — so a
// parked card was announced as an error, and "unanchored" named a different
// set in the gutter than on the pane-chrome chip (orphan-only, task 410).
//
// Now one pill per state: "N unanchored" (error tone, BadgeOrphaned — the
// same word and badge as the chip, for the same set) and "N unplaced"
// (neutral tone, dashed-circle cue). Legs (measured by neutering — restoring
// the summed pill fails 1, 2, 3 and 5):
//   1. free-only → exactly one pill, NEUTRAL tone, no BadgeOrphaned anywhere,
//      label says "unplaced", never "unanchored";
//   2. orphaned-only → exactly one pill, ERROR tone, BadgeOrphaned, label
//      says "unanchored";
//   3. mixed → two pills, each counting ITS OWN set, error above neutral;
//   4. task-127 ordering: expanding the upper pill pushes the lower one down
//      (same flex column, document order), for all three pills;
//   5. the word "unanchored" is reserved for the orphan set in this file —
//      the free pill's copy never spells it;
//   6. census: every pill in the file is an `OmniBinPill` call site, and each
//      declares its tone explicitly (no defaulted tier).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

import { OmniBinStack, OmniUnanchoredBin, OmniOutsideFocusBin } from "@/panels/Omni/OmniViewPanel";
import type { OmniItem } from "@/panels/_shared/types";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const free = (n: number): OmniItem => ({
  id: `float:card:note:free-${n}`,
  pos: null,
  anchorState: "free",
  content: createElement("div", { "data-test-card": `free-${n}` }, "free"),
});
const orphan = (n: number): OmniItem => ({
  id: `float:card:footnote:orphan-${n}`,
  pos: null,
  anchorState: "orphaned",
  content: createElement("div", { "data-test-card": `orphan-${n}` }, "orphan"),
});
const ORPHAN_BADGE = '[aria-label="No anchor in document"]';

function pills(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("button.omni-bin-pill"));
}

describe("OmniUnanchoredBin — one pill per AnchorState", () => {
  it("leg 1: free-only reads NEUTRAL — no error badge, 'unplaced', never 'unanchored'", () => {
    const { container } = render(<OmniUnanchoredBin free={[free(1), free(2)]} orphaned={[]} />);
    const ps = pills(container);
    expect(ps.length).toBe(1);
    expect(ps[0].getAttribute("data-omni-bin-tone")).toBe("neutral");
    expect(ps[0].textContent).toContain("2 unplaced");
    expect(container.querySelector(ORPHAN_BADGE)).toBeNull();
    expect(container.textContent).not.toMatch(/unanchored/i);
    expect(container.querySelector("[data-omni-free-bin]")).not.toBeNull();
    expect(container.querySelector("[data-omni-orphaned-bin]")).toBeNull();
  });

  it("leg 2: orphaned-only reads as the recoverable ERROR — BadgeOrphaned, 'unanchored'", () => {
    const { container } = render(<OmniUnanchoredBin free={[]} orphaned={[orphan(1)]} />);
    const ps = pills(container);
    expect(ps.length).toBe(1);
    expect(ps[0].getAttribute("data-omni-bin-tone")).toBe("error");
    expect(ps[0].textContent).toContain("1 unanchored");
    expect(ps[0].querySelector(ORPHAN_BADGE)).not.toBeNull();
    expect(container.querySelector("[data-omni-free-bin]")).toBeNull();
  });

  it("leg 3: mixed → two pills, each counting ITS OWN set, error above neutral", () => {
    const { container } = render(
      <OmniUnanchoredBin free={[free(1), free(2), free(3)]} orphaned={[orphan(1)]} />,
    );
    const ps = pills(container);
    expect(ps.length).toBe(2);
    expect(ps.map((p) => p.getAttribute("data-omni-bin-tone"))).toEqual(["error", "neutral"]);
    expect(ps[0].textContent).toContain("1 unanchored");
    expect(ps[1].textContent).toContain("3 unplaced");
    // The pre-422 sum ("4 unanchored") appears nowhere.
    expect(container.textContent).not.toContain("4 unanchored");
    // Expanding each lists exactly its own cards.
    fireEvent.click(ps[0]);
    expect(container.querySelectorAll('[data-test-card^="orphan-"]').length).toBe(1);
    expect(container.querySelectorAll('[data-test-card^="free-"]').length).toBe(0);
    fireEvent.click(ps[1]);
    expect(container.querySelectorAll('[data-test-card^="free-"]').length).toBe(3);
  });

  it("leg 4: task-127 ordering holds across all three pills — one flex column, document order", () => {
    const { container } = render(
      <OmniBinStack host="frame">
        <OmniUnanchoredBin free={[free(1)]} orphaned={[orphan(1)]} />
        <OmniOutsideFocusBin items={[{ ...free(9), anchorState: "anchored", pos: 5, outsideFocus: true }]} />
      </OmniBinStack>,
    );
    const orph = container.querySelector("[data-omni-orphaned-bin]") as HTMLElement;
    const fr = container.querySelector("[data-omni-free-bin]") as HTMLElement;
    const out = container.querySelector("[data-omni-outside-focus-bin]") as HTMLElement;
    const follows = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(orph, fr) && follows(fr, out)).toBe(true);
    for (const el of [orph, fr, out]) expect(el.style.position).not.toBe("absolute");
    // Expanding the top pill mounts its list INSIDE its own block, so the
    // lower pills are pushed down by flow rather than painted over.
    fireEvent.click(orph.querySelector("button")!);
    expect(orph.contains(container.querySelector('[data-test-card="orphan-1"]')!)).toBe(true);
    expect(follows(orph, fr)).toBe(true);
    expect(container.querySelectorAll("[data-omni-entry-wrapper]").length).toBe(0);
  });
});

describe("census — vocabulary and primitive", () => {
  const src = readFileSync(join(process.cwd(), "src/panels/Omni/OmniViewPanel.tsx"), "utf8");

  it("leg 5: 'unanchored' is reserved for the ORPHAN set — the free pill never spells it", () => {
    const freeBin = src.slice(src.indexOf("data-omni-free-bin"), src.indexOf("</OmniBinPill>", src.indexOf("data-omni-free-bin")));
    expect(freeBin).not.toMatch(/unanchored/i);
    const orphBin = src.slice(src.indexOf("data-omni-orphaned-bin"), src.indexOf("</OmniBinPill>", src.indexOf("data-omni-orphaned-bin")));
    expect(orphBin).toContain("unanchored");
    expect(orphBin).toContain('tone="error"');
    expect(freeBin).toContain('tone="neutral"');
  });

  it("leg 6: every pill is an OmniBinPill call site with an explicit tone", () => {
    // The pill class is spelled once (inside the primitive)…
    expect(src.match(/omni-bin-pill/g)?.length).toBe(1);
    // …and every call site states its tier: as many `tone=` as `<OmniBinPill`.
    const calls = (src.match(/<OmniBinPill\b/g) ?? []).length;
    const tones = (src.match(/\btone="(neutral|error)"/g) ?? []).length;
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(tones).toBe(calls);
    // Tone is REQUIRED on the primitive — a defaulted tier is a decision
    // nobody made.
    expect(src).toMatch(/tone: "neutral" \| "error";/);
  });
});
