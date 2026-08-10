// @vitest-environment jsdom
//
// Task 316, the citation twin — the parked cue's LOOK and its PROMISE answer to
// different questions, and both are now stated once on the `unanchored` prop.
//
// The citation card carried two divergent predicates for one cue: the dashed
// class on `!isAnchored`, the tooltip on `!isAnchored && !isDraft`, and the
// button's own enablement on `citationCommandOrNull(...) === null`. So a
// keyless UNANCHORED citation — reachable without any draft, since `persist()`
// with no valid rows writes an empty command back to a real citation — promised
// "drag into the editor to anchor it" beside a disabled button. There was no
// citation-side cue test at all (`citation-drop-symmetry.test.tsx` renders with
// `isAnchored` defaulted true), which is why that could not have been caught.
//
// The rule now: LOOK on `!isAnchored` (unchanged), PROMISE on `canAnchor` —
// which is `!isDraft && !dropDisabled`, both facts that mean "this card cannot
// produce its atom yet."

import { describe, it, expect, vi, afterEach } from "vitest";

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

// The draft card mounts CitekeyPicker, which reaches the Library catalog store
// (indexedDB, absent in jsdom). Same stub the sibling suite uses.
vi.mock("@/hooks/useLibrary", () => ({
  useLibraryItems: () => ({ items: [], loading: false }),
  useLibraryMasterBib: () => ({ entries: [], loading: false }),
  useLibraryMemberships: () => ({ memberships: new Map(), loading: false }),
  useLibraryEntryLookup: () => () => undefined,
}));

vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/BorrowedMainText", () => ({
  BorrowedMainText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { unanchoredCardTitle } from "@/components/panel-primitives";
import { cardPopKey } from "@/panels/panel-registry";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { CitationRef } from "@/lib/types";

afterEach(cleanup);

const ID = "cue-cite";
type CitationCardProps = ComponentProps<typeof CitationCard>;

function renderCard(opts: {
  command: string;
  isAnchored: boolean;
  isDraft?: boolean;
}): HTMLElement {
  cardStore.collapse({ kind: "citation", id: ID });
  cardStore.clearSelection();
  const citation: CitationRef = {
    id: ID,
    command: opts.command,
    keys: [],
    createdAt: "2026-08-08T00:00:00.000Z",
  };
  const props: CitationCardProps = {
    citation,
    isAnchored: opts.isAnchored,
    isDraft: opts.isDraft,
    isSelected: false,
    bibEntries: [],
    bibPackage: "natbib",
    getDisplayText: () => "",
    onSelect: vi.fn(),
    onJump: vi.fn(),
    onUpdateCitation: vi.fn(),
  };
  const { container } = render(<CitationCard {...props} />);
  return container.querySelector("[data-card]") as HTMLElement;
}

const parkedLook = (el: HTMLElement) =>
  el.className.includes("border-dashed") && el.className.includes("opacity-80");
const promise = (el: HTMLElement) => el.getAttribute("title");

describe("citation parked cue: look vs promise (task 316)", () => {
  it("keyed + unanchored — the steady parked state: both", () => {
    const el = renderCard({ command: "\\cite{smith2020}", isAnchored: false });
    expect(parkedLook(el)).toBe(true);
    expect(promise(el)).toBe(unanchoredCardTitle("citation"));
  });

  it("KEYLESS + unanchored — parked look, NO promise (the defect leg)", () => {
    // Pre-316 this showed the tooltip beside a disabled button. The LOOK must
    // survive: a citation that cannot anchor is the most parked card there is,
    // and suppressing its cue would render it identically to a healthy one.
    const el = renderCard({ command: "", isAnchored: false });
    expect(parkedLook(el)).toBe(true);
    expect(promise(el)).toBeNull();
  });

  it("a DRAFT never promises, keyed or not", () => {
    // A draft's drop button dispatches on the placeholder draft id, which
    // `commandFor` cannot resolve, so the spec declines — the promise would be
    // false even where the button looks live. `isDraft` stays in `canAnchor`
    // for exactly that reason; `dropDisabled` alone would not have covered it.
    for (const command of ["", "\\cite{smith2020}"]) {
      const el = renderCard({ command, isAnchored: false, isDraft: true });
      expect(parkedLook(el)).toBe(true);
      expect(promise(el)).toBeNull();
      cleanup();
    }
  });

  it("an ANCHORED citation wears neither", () => {
    const el = renderCard({ command: "\\cite{smith2020}", isAnchored: true });
    expect(parkedLook(el)).toBe(false);
    expect(promise(el)).toBeNull();
  });

  it("threads the canonical card key in every state (the mechanism)", () => {
    // The twin has always done this — it is why "anchor the unanchored" worked
    // here and was dead for footnotes. Pin it so the migration onto the cue
    // prop cannot quietly drop the unconditional key an anchored card needs.
    for (const isAnchored of [true, false]) {
      const el = renderCard({ command: "\\cite{smith2020}", isAnchored });
      expect(el.getAttribute("data-card-key")).toBe(cardPopKey("citation", ID));
      cleanup();
    }
  });
});
