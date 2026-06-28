// @vitest-environment jsdom
//
// F#11 — BibEntryChrome is the leaf-pure header stack consumed by the Library
// PaperHeader (and, later, the editor Bibliography panel). Pins:
//   1. The structured headline renders author / year / title.
//   2. A membership chip renders from membershipChips.
//   3. The status row renders the ✓Authenticated chip + index-tier chip.
//   4. The headline region is a copy-effect drag SOURCE that writes the
//      ENTRY_DT_TYPE + ENTRIES_DT_TYPE MIME payloads (zero drop-side change).
//   5. showOpenLink={false} hides the "Open" link but keeps the chips.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { BibEntryChrome } from "@/components/library/bib-entry-chrome";
import {
  ENTRY_DT_TYPE,
  ENTRIES_DT_TYPE,
} from "@library/lib/dnd-types";

afterEach(() => cleanup());

const baseProps = {
  citekey: "smith2020",
  author: "Smith, J.",
  year: "2020",
  title: "On the theory of widgets",
  indexTier: "deep-indexed" as const,
  bibState: "authenticated" as const,
  inLibrary: true,
  membershipChips: [
    { kind: "central" as const },
    { kind: "custom" as const, id: "lib1", label: "Reading list" },
  ],
};

describe("BibEntryChrome", () => {
  it("renders the structured headline (author / year / title)", () => {
    render(<BibEntryChrome {...baseProps} />);
    expect(screen.getByText("Smith, J.")).toBeTruthy();
    expect(screen.getByText("2020")).toBeTruthy();
    expect(screen.getByText("On the theory of widgets")).toBeTruthy();
  });

  it("renders a membership chip", () => {
    render(<BibEntryChrome {...baseProps} />);
    // membershipChipsFor → "central" chip text is "central"; custom is its label.
    expect(screen.getByText("Reading list")).toBeTruthy();
    expect(screen.getByText("central")).toBeTruthy();
  });

  it("renders the authentication + index-tier status chips", () => {
    render(<BibEntryChrome {...baseProps} />);
    expect(screen.getByText("✓ Authenticated")).toBeTruthy();
    expect(screen.getByText("Deep-indexed PDF")).toBeTruthy();
  });

  it("is a copy-effect drag source writing both entry MIME payloads", () => {
    render(<BibEntryChrome {...baseProps} />);
    const handle = screen
      .getByText("On the theory of widgets")
      .closest("[draggable]") as HTMLElement;
    expect(handle).toBeTruthy();

    const writes: Record<string, string> = {};
    const dataTransfer = {
      setData: (type: string, val: string) => {
        writes[type] = val;
      },
      setDragImage: vi.fn(),
      effectAllowed: "" as string,
    };
    fireEvent.dragStart(handle, { dataTransfer });

    expect(writes[ENTRY_DT_TYPE]).toBe("smith2020");
    expect(writes[ENTRIES_DT_TYPE]).toBe(JSON.stringify(["smith2020"]));
    expect(dataTransfer.effectAllowed).toBe("copy");
  });

  it("hides the Open link with showOpenLink=false but keeps the chips", () => {
    render(<BibEntryChrome {...baseProps} showOpenLink={false} />);
    expect(screen.queryByText("Open")).toBeNull();
    // Chips still render — the tier/auth chips are independent of the link.
    expect(screen.getByText("✓ Authenticated")).toBeTruthy();
    expect(screen.getByText("Deep-indexed PDF")).toBeTruthy();
  });

  it("shows the Open link by default (in-library reader)", () => {
    render(<BibEntryChrome {...baseProps} />);
    expect(screen.getByText("Open")).toBeTruthy();
  });
});
