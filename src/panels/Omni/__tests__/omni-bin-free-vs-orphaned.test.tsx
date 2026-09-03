// @vitest-environment jsdom
//
// The no-anchor bin's RENDER contract, renegotiated twice.
//
// Task 422: the `AnchorState` SSOT separates `free` (a card deliberately
// parked without an anchor — "a normal, non-error state (plain card, no red
// badge)") from `orphaned` (the anchor DIED: the recoverable-error state, red
// BadgeOrphaned). The pre-422 surface SUMMED them into one error-badged
// "N unanchored" pill, so a parked card was announced as an error; 422 split
// the surface into two pills.
//
// Task 544 (Gabriel, from a real paper: "there is no conceptual distinction
// between unanchored and unplaced, so these can be merged") merges them BACK
// into ONE pill — and keeps what 422 was protecting, one level down: the
// distinction lives on each expanded ROW (BadgeOrphaned beside an orphan,
// the dashed-circle `◌` beside a parked card), and the PILL announces the
// strongest state it holds (error tone iff any member is orphaned). What
// went away is the two-pill split, which stacked two problems over the deck
// where the user sees one: "cards with no place in the text".
//
// Legs (measured by neutering — restoring the 422 two-pill split fails 1, 2,
// 3, 5 and 6; dropping the per-row glyph fails 3 and 4):
//   1. free-only → ONE pill, NEUTRAL tone, `◌` glyph, no BadgeOrphaned
//      anywhere, label "N unanchored" (never "unplaced");
//   2. orphaned-only → ONE pill, ERROR tone, BadgeOrphaned glyph;
//   3. mixed → ONE pill counting the SUM, error tone; expanded, the orphaned
//      rows come FIRST and carry BadgeOrphaned, the free rows carry `◌`;
//   4. the row glyph is the ONLY place the states differ — a free card's row
//      never carries the error badge;
//   5. task-127 ordering: the merged pill still sits above the outside-focus
//      pill in one flex column, and expanding it pushes that pill down;
//   6. census: the word "unplaced" is gone from the omni surface, the bin
//      spells exactly one pill, and every pill call site states its tone.

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

describe("OmniUnanchoredBin — ONE pill, the state on the rows (task 544)", () => {
  it("leg 1: free-only reads NEUTRAL — `◌` glyph, no error badge, 'N unanchored', never 'unplaced'", () => {
    const { container } = render(<OmniUnanchoredBin free={[free(1), free(2)]} orphaned={[]} />);
    const ps = pills(container);
    expect(ps.length).toBe(1);
    expect(ps[0].getAttribute("data-omni-bin-tone")).toBe("neutral");
    expect(ps[0].textContent).toContain("2 unanchored");
    expect(ps[0].textContent).toContain("◌");
    expect(container.querySelector(ORPHAN_BADGE)).toBeNull();
    expect(container.textContent).not.toMatch(/unplaced/i);
    expect(container.querySelector("[data-omni-unanchored-pill]")).not.toBeNull();
  });

  it("leg 2: orphaned-only reads as the recoverable ERROR — BadgeOrphaned glyph, error tone", () => {
    const { container } = render(<OmniUnanchoredBin free={[]} orphaned={[orphan(1)]} />);
    const ps = pills(container);
    expect(ps.length).toBe(1);
    expect(ps[0].getAttribute("data-omni-bin-tone")).toBe("error");
    expect(ps[0].textContent).toContain("1 unanchored");
    expect(ps[0].querySelector(ORPHAN_BADGE)).not.toBeNull();
  });

  it("leg 3: mixed → ONE pill counting the sum, error tone; orphaned rows first with the badge, free rows with `◌`", () => {
    const { container } = render(
      <OmniUnanchoredBin free={[free(1), free(2), free(3)]} orphaned={[orphan(1)]} />,
    );
    const ps = pills(container);
    // RENEGOTIATED (task 544): 422 pinned TWO pills here ("1 unanchored" +
    // "3 unplaced"). The sum is the count again — what 422 protected moved
    // to the rows below.
    expect(ps.length).toBe(1);
    expect(ps[0].getAttribute("data-omni-bin-tone")).toBe("error");
    expect(ps[0].textContent).toContain("4 unanchored");
    expect(container.textContent).not.toMatch(/unplaced/i);
    fireEvent.click(ps[0]);
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-omni-bin-row]"),
    );
    expect(rows.map((r) => r.getAttribute("data-omni-bin-row"))).toEqual([
      "orphaned", "free", "free", "free",
    ]);
    expect(container.querySelectorAll('[data-test-card^="orphan-"]').length).toBe(1);
    expect(container.querySelectorAll('[data-test-card^="free-"]').length).toBe(3);
    // The orphaned row carries the badge; every free row carries the parked cue.
    expect(rows[0].querySelector("[data-omni-bin-orphan-marker]")).not.toBeNull();
    expect(rows[0].querySelector(ORPHAN_BADGE)).not.toBeNull();
    for (const r of rows.slice(1)) {
      expect(r.querySelector("[data-omni-bin-free-marker]")).not.toBeNull();
      expect(r.textContent).toContain("◌");
    }
  });

  it("leg 4: a free card's row never wears the error badge — the row glyph is where the states differ", () => {
    const { container } = render(<OmniUnanchoredBin free={[free(1)]} orphaned={[orphan(1)]} />);
    fireEvent.click(pills(container)[0]);
    const freeRow = container.querySelector('[data-omni-bin-row="free"]')!;
    const orphanRow = container.querySelector('[data-omni-bin-row="orphaned"]')!;
    expect(freeRow.querySelector(ORPHAN_BADGE)).toBeNull();
    expect(orphanRow.querySelector(ORPHAN_BADGE)).not.toBeNull();
    expect(container.querySelectorAll("[data-omni-bin-orphan-marker]").length).toBe(1);
    expect(container.querySelectorAll("[data-omni-bin-free-marker]").length).toBe(1);
  });

  it("leg 5: task-127 ordering holds — the merged pill above outside-focus in one flex column", () => {
    const { container } = render(
      <OmniBinStack host="frame">
        <OmniUnanchoredBin free={[free(1)]} orphaned={[orphan(1)]} />
        <OmniOutsideFocusBin items={[{ ...free(9), anchorState: "anchored", pos: 5, outsideFocus: true }]} />
      </OmniBinStack>,
    );
    const bin = container.querySelector("[data-omni-unanchored-bin]") as HTMLElement;
    const out = container.querySelector("[data-omni-outside-focus-bin]") as HTMLElement;
    const follows = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(bin, out)).toBe(true);
    for (const el of [bin, out]) expect(el.style.position).not.toBe("absolute");
    fireEvent.click(bin.querySelector("button")!);
    expect(bin.contains(container.querySelector('[data-test-card="orphan-1"]')!)).toBe(true);
    expect(bin.contains(container.querySelector('[data-test-card="free-1"]')!)).toBe(true);
    expect(follows(bin, out)).toBe(true);
    expect(container.querySelectorAll("[data-omni-entry-wrapper]").length).toBe(0);
  });
});

describe("census — vocabulary and primitive", () => {
  const src = readFileSync(join(process.cwd(), "src/panels/Omni/OmniViewPanel.tsx"), "utf8");

  it("leg 6: 'unplaced' is gone from the omni surface, the bin spells ONE pill, and every pill states its tone", () => {
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    // The retired second pill and its vocabulary.
    expect(code).not.toMatch(/unplaced/i);
    expect(code).not.toContain("data-omni-free-bin");
    expect(code).not.toContain("data-omni-orphaned-bin");
    // ONE pill in the bin.
    expect(code.match(/data-omni-unanchored-pill/g)?.length).toBe(1);
    const binStart = code.indexOf("export function OmniUnanchoredBin");
    const binEnd = code.indexOf("export function OmniOutsideFocusBin");
    const bin = code.slice(binStart, binEnd);
    expect((bin.match(/<OmniBinPill\b/g) ?? []).length).toBe(1);
    // The pill class is spelled once (inside the primitive)…
    expect(code.match(/omni-bin-pill/g)?.length).toBe(1);
    // …and every call site states its tier — a literal or a derivation, never
    // omitted. Tone is REQUIRED on the primitive, so a defaulted tier is a
    // decision nobody made.
    const calls = (code.match(/<OmniBinPill\b/g) ?? []).length;
    // A whitespace-led `tone=` is a JSX prop; `data-omni-bin-tone={tone}`
    // inside the primitive is the attribute it PUBLISHES, not a call site.
    const tones = (code.match(/\stone=(?:"(?:neutral|error)"|\{[^}]+\})/g) ?? []).length;
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(tones).toBe(calls);
    expect(src).toMatch(/tone: "neutral" \| "error";/);
  });
});
