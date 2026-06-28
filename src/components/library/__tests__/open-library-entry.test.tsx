// @vitest-environment jsdom
//
// Bib-card refactor — the modular "open library entry" primitive + the
// status layer. Pins:
//   1. <OpenEntryLink> dispatches `virgil-open-library` with target "tab".
//   2. useLibraryBridge routes target "tab" → openPaperTab(citekey), and the
//      default/"library" target → activateLibraryOuterPane (legacy reveal).
//   3. <LibraryStatusRow> renders the Verified badge + the readable index
//      tier + the Open link, gated on inLibrary.
//   4. indexTierLabel covers every LibraryIndexTier.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

// Defensive: the event bridge transitively pulls `@/lib/doc-index`, which can
// drag in the `@/lib/storage` barrel (the known vitest resolver gotcha).
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy({}, { get: () => noop });
});

import {
  OPEN_LIBRARY_EVENT,
  OpenEntryLink,
  type OpenLibraryEventDetail,
} from "@/components/library/open-library-entry";
import { useLibraryBridge } from "@/components/editor-layout/event-bridges/library";
import {
  LibraryStatusRow,
  indexTierLabel,
} from "@/components/library/library-entry-status";
import type { LibraryIndexTier } from "@/lib/library/library-types";

afterEach(() => cleanup());

function captureNextEvent(): Promise<OpenLibraryEventDetail> {
  return new Promise((resolve) => {
    window.addEventListener(
      OPEN_LIBRARY_EVENT,
      (e) => resolve((e as CustomEvent<OpenLibraryEventDetail>).detail),
      { once: true },
    );
  });
}

describe("OpenEntryLink", () => {
  it("dispatches virgil-open-library with target 'tab' and the citekey", async () => {
    const got = captureNextEvent();
    render(<OpenEntryLink citekey="asher2003" />);
    fireEvent.click(screen.getByRole("button"));
    const detail = await got;
    expect(detail).toEqual({ citekey: "asher2003", itemId: undefined, target: "tab" });
  });
});

describe("useLibraryBridge routing", () => {
  function Harness({
    openPaperTab,
    activateLibraryOuterPane,
  }: {
    openPaperTab: (citekey: string) => void;
    activateLibraryOuterPane: (libId: string) => void;
  }) {
    useLibraryBridge({ openPaperTab, activateLibraryOuterPane });
    return null;
  }

  it("routes target 'tab' to openPaperTab and never to the library pane", () => {
    const openPaperTab = vi.fn();
    const activate = vi.fn();
    render(<Harness openPaperTab={openPaperTab} activateLibraryOuterPane={activate} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(OPEN_LIBRARY_EVENT, {
          detail: { citekey: "asher2003", target: "tab" },
        }),
      );
    });
    expect(openPaperTab).toHaveBeenCalledWith("asher2003");
    expect(activate).not.toHaveBeenCalled();
  });

  it("routes the default (no target) to activateLibraryOuterPane", () => {
    const openPaperTab = vi.fn();
    const activate = vi.fn();
    render(<Harness openPaperTab={openPaperTab} activateLibraryOuterPane={activate} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(OPEN_LIBRARY_EVENT, { detail: { citekey: "asher2003" } }),
      );
    });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(openPaperTab).not.toHaveBeenCalled();
  });
});

describe("LibraryStatusRow", () => {
  it("shows '✓ Authenticated' for an authenticated entry plus its index tier and the Open link", () => {
    render(
      <LibraryStatusRow
        bibState="authenticated"
        indexTier="deep-indexed"
        citekey="bringhurst1992"
        inLibrary
      />,
    );
    expect(screen.getByText("✓ Authenticated")).toBeTruthy();
    expect(screen.getByText("Deep-indexed PDF")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open bringhurst1992 in a new tab/ })).toBeTruthy();
  });

  it("labels a bib-only entry and still offers the Open link", () => {
    render(
      <LibraryStatusRow
        bibState="unverified"
        indexTier="bib-only"
        citekey="asher2003"
        inLibrary
      />,
    );
    expect(screen.getByText("Bib only")).toBeTruthy();
    expect(screen.getByText("Unverified")).toBeTruthy();
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("renders nothing for an entry not in the library with no auth state", () => {
    const { container } = render(
      <LibraryStatusRow citekey="local-only" inLibrary={false} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("indexTierLabel", () => {
  it("maps every tier to a readable label", () => {
    const expected: Record<LibraryIndexTier, string> = {
      "bib-only": "Bib only",
      processing: "Indexing…",
      indexed: "Indexed PDF",
      "deep-indexed": "Deep-indexed PDF",
      failed: "Index failed",
    };
    for (const [tier, label] of Object.entries(expected)) {
      expect(indexTierLabel(tier as LibraryIndexTier)).toBe(label);
    }
  });
});
