// @vitest-environment jsdom
//
// A6/WS7 morph-gate CALL-SITE pins (test-hardening chip). The predicate
// `canMorphNoteToHighlight` is already unit-pinned (note-morph-gate.test.ts);
// these tests pin the REAL render sites that consume it — what the user can
// actually click:
//
//   1. NoteCard: the kind-chevron ("Change card type" dropdown) renders ONLY
//      for a Mode-B (text-range) note; a Mode-A paragraph-only note and an
//      orphaned note show the static kind label instead (blocked morph).
//   2. NoteCard without `onConvert` never offers the chevron, even Mode-B.
//   3. HighlightCard: ungated — every highlight offers the chevron when
//      `onConvert` is wired (a highlight always has a range; a note can
//      always hold one).
//   4. The dropdown options at the call sites are `cardKindsForPanel(panel)`
//      — pinned to frozen literals per polymorphic panel so a registry edit
//      that re-buckets a kind trips here, not in production.

import { describe, it, expect, vi, afterEach } from "vitest";

// panel-primitives transitively pulls `@/lib/storage` (the known barrel/
// storage gotcha) — stub it; nothing here touches a sidecar.
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

// Keep the suite light: the rich-text body mounts a real TipTap editor —
// irrelevant to the header-chevron gate.
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
import { NoteCard } from "@/panels/Notes/NoteCard";
import { HighlightCard } from "@/panels/Notes/HighlightCard";
import { cardKindsForPanel } from "@/cards/predicates";
import type { UserNote, HighlightCard as HighlightCardData } from "@/lib/types";
import type { Link } from "@/links/_shared/types";

afterEach(cleanup);

const CHEVRON = '[aria-label="Change card type"]';

function modeALink(): Link {
  return {
    id: "l1",
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: ["p1"],
      margin: { side: "right" },
      // No textRange — Mode A paragraph anchor only.
    },
    target: { type: "card", ref: { kind: "note", id: "n1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function modeBLink(): Link {
  return {
    id: "l2",
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: ["p1"],
      margin: { side: "right" },
      textRange: { anchorId: "a1", textSnapshot: "some linked text" },
    },
    target: { type: "card", ref: { kind: "note", id: "n1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function noteWith(links: Link[]): UserNote {
  return {
    kind: "note",
    id: "n1",
    title: "",
    content: { type: "doc", content: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    aiRequest: false,
    links,
  };
}

const noop = () => {};

function renderNote(note: UserNote, withConvert = true) {
  return render(
    <NoteCard
      note={note}
      selected={false}
      onUpdate={noop}
      onUpdateTitle={noop}
      onConvert={withConvert ? noop : undefined}
      onDelete={noop}
      onSelect={noop}
    />,
  );
}

describe("NoteCard morph gate (WS7 call site)", () => {
  it("Mode-B note: offers the kind-chevron", () => {
    const { container } = renderNote(noteWith([modeBLink()]));
    expect(container.querySelector(CHEVRON)).not.toBeNull();
  });

  it("Mode-A paragraph-only note: chevron GATED OFF (static label, no dropdown)", () => {
    const { container } = renderNote(noteWith([modeALink()]));
    expect(container.querySelector(CHEVRON)).toBeNull();
  });

  it("orphaned note (no links): chevron GATED OFF", () => {
    const { container } = renderNote(noteWith([]));
    expect(container.querySelector(CHEVRON)).toBeNull();
  });

  it("no onConvert wired: no chevron even for a Mode-B note", () => {
    const { container } = renderNote(noteWith([modeBLink()]), false);
    expect(container.querySelector(CHEVRON)).toBeNull();
  });
});

describe("HighlightCard morph gate (ungated sibling)", () => {
  function highlight(): HighlightCardData {
    return {
      kind: "highlight",
      id: "h1",
      createdAt: "2026-01-01T00:00:00.000Z",
      highlightColor: null,
      aiRequest: false,
      links: [
        {
          ...modeBLink(),
          target: { type: "card", ref: { kind: "highlight", id: "h1" } },
        },
      ],
    };
  }

  it("offers the chevron whenever onConvert is wired (every highlight has a range)", () => {
    const { container } = render(
      <HighlightCard
        card={highlight()}
        selected={false}
        onConvert={noop}
        onSetAiRequest={noop}
        onDelete={noop}
        onSelect={noop}
      />,
    );
    expect(container.querySelector(CHEVRON)).not.toBeNull();
  });

  it("no onConvert: static label", () => {
    const { container } = render(
      <HighlightCard
        card={highlight()}
        selected={false}
        onSetAiRequest={noop}
        onDelete={noop}
        onSelect={noop}
      />,
    );
    expect(container.querySelector(CHEVRON)).toBeNull();
  });
});

describe("the chevron option sets are the registry panel buckets (frozen)", () => {
  // Every call site passes `cardKindsForPanel(<panel>)` (or the revision pair
  // literal, which must stay equal to its bucket). Freeze the buckets so a
  // registry `panel:` edit that silently changes a dropdown trips here.
  it("notes / cutter / revisions / reports buckets", () => {
    expect(cardKindsForPanel("notes")).toEqual(["note", "highlight"]);
    expect(cardKindsForPanel("cutter")).toEqual([
      "cutter-comment",
      "cutter-suggestion",
    ]);
    expect(cardKindsForPanel("revisions")).toEqual([
      "revision-comment",
      "revision-suggestion",
    ]);
    expect(cardKindsForPanel("reports")).toEqual(["report", "report-request"]);
  });
});
