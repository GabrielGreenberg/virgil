// @vitest-environment jsdom
//
// Task 277 — the RATIFIED footnote pop-out boundary, asserted where it can
// actually drift: across the two layers that have to agree.
//
// A footnote card has three states and the float builder resolves two of them:
// ANCHORED (a live `\footnote`, read from the editor) and UNANCHORED (a parked
// `FootnoteRef`, read from the sidecar — task 316). The third, ORPHANED (a body
// in `orphaned-footnotes.json` whose callout was deleted), is deliberately NOT
// poppable: `CardFloatCtx` carries no orphan list, and building one was
// declined (Gabriel, 2026-08-08).
//
// The audit that produced this task found the two halves disagreeing in
// SILENCE: the orphan card painted `CardDragHandle` — `cursor-grab` plus a
// "Drag to pop out" hint — over a gesture that could not run, next to a
// builder comment claiming footnote atoms are "always live". So the pin is the
// EQUIVALENCE, one row per state: the card offers a lift exactly when the
// builder can resolve a float for it. Reversing the decision moves both ends
// together or fails here.

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
import type { ReactElement } from "react";
// Side effect: registers every kind's `toFloatable` onto CARD_REGISTRY.
import "@/cards/floats";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardFloatCtx } from "@/cards/card-float-ctx";
import { PoppedCardsContext, type PoppedCardsValue } from "@/hooks/usePoppedCards";
import {
  FootnoteCard,
  OrphanedFootnoteCard,
  UnanchoredFootnoteCard,
} from "@/panels/Footnotes/FootnoteCard";
import type { FootnoteInfo } from "@/components/Editor";
import type { FootnoteRef, OrphanedFootnote } from "@/lib/types";

afterEach(cleanup);

const body = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const ANCHORED = {
  footnoteId: "fn-live",
  content: body("a live footnote"),
  number: 1,
  pos: 12,
} as unknown as FootnoteInfo;

const PARKED = {
  id: "fn-parked",
  unanchored: true,
  content: body("a parked footnote"),
  createdAt: "2026-08-02T00:00:00.000Z",
} as unknown as FootnoteRef;

const ORPHAN = {
  footnoteId: "fn-orphan",
  content: body("an orphaned footnote"),
  orphanedAt: "2026-08-02T00:00:00.000Z",
} as unknown as OrphanedFootnote;

/** The whole footnote world this doc has: one live atom, one parked ref, and
 *  an orphan the ctx has no field to carry. */
const CTX = {
  footnotes: [ANCHORED],
  unanchoredFootnotes: [PARKED],
  selectedFootnoteId: null,
  setSelectedFootnoteId: vi.fn(),
  setOverrideEditor: vi.fn(),
  getCitationDisplayText: () => "",
  handleCitationCreated: vi.fn(),
  handleEditFootnote: vi.fn(),
  handleEditFootnoteTitle: vi.fn(),
  handleDeleteFootnote: vi.fn(),
  handleDeleteUnanchoredFootnote: vi.fn(),
  footnoteAiRequests: {},
  editorRef: { current: null },
} as unknown as CardFloatCtx;

const POPPED: PoppedCardsValue = {
  poppedKeys: [],
  isPopped: () => false,
  toggle: vi.fn(),
  toggleAtAnchor: vi.fn(),
  popOutAtRect: vi.fn(),
  close: vi.fn(),
  getFloatPosition: () => undefined,
  setFloatPosition: vi.fn(),
};

/** Does this card OFFER the lift? (the grab-cursor grip is the only promise) */
function offersLift(node: ReactElement): boolean {
  const { container } = render(
    <PoppedCardsContext.Provider value={POPPED}>{node}</PoppedCardsContext.Provider>,
  );
  return container.querySelectorAll(".card-drag-handle").length > 0;
}

/** Can the float subsystem HONOR it? */
const resolves = (id: string) =>
  CARD_REGISTRY.footnote.toFloatable(id, CTX) !== null;

const STATES = [
  {
    name: "anchored — a live \\footnote atom",
    poppable: true,
    id: ANCHORED.footnoteId,
    card: () => (
      <FootnoteCard
        footnote={ANCHORED}
        isSelected={false}
        onSelect={vi.fn()}
        onJump={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    ),
  },
  {
    name: "unanchored — a parked FootnoteRef (task 316 made this poppable)",
    poppable: true,
    id: PARKED.id,
    card: () => (
      <UnanchoredFootnoteCard footnote={PARKED} onEdit={vi.fn()} onDelete={vi.fn()} />
    ),
  },
  {
    name: "orphaned — a body whose callout was deleted (ratified NOT poppable)",
    poppable: false,
    id: ORPHAN.footnoteId,
    card: () => (
      <OrphanedFootnoteCard orphan={ORPHAN} onEdit={vi.fn()} onDelete={vi.fn()} />
    ),
  },
] as const;

describe("footnote pop-out: the card offers exactly what the builder honors", () => {
  for (const s of STATES) {
    it(s.name, () => {
      const offered = offersLift(s.card());
      const honored = resolves(s.id);
      expect(offered).toBe(honored);
      expect(offered).toBe(s.poppable);
    });
  }

  it("the orphan resolves to null even by key — nothing to render, so nothing to offer", () => {
    // Stated separately from the equivalence because it is the FACT the
    // affordance rests on: an orphan reaches neither the live list nor the
    // sidecar half, so a float for it would be an empty window.
    expect(CARD_REGISTRY.footnote.toFloatable(ORPHAN.footnoteId, CTX)).toBeNull();
  });

  it("the orphan card stamps no data-card-key either — no key, no lift, no float", () => {
    const { container } = render(
      <PoppedCardsContext.Provider value={POPPED}>
        <OrphanedFootnoteCard orphan={ORPHAN} onEdit={vi.fn()} onDelete={vi.fn()} />
      </PoppedCardsContext.Provider>,
    );
    const card = container.querySelector("[data-card]") as HTMLElement;
    expect(card.getAttribute("data-card-key")).toBeNull();
  });

  it("the two poppable states keep their existing jump asymmetry", () => {
    // Non-regression for the halves this task does NOT move: a live atom can
    // be jumped to, a parked ref cannot (the citation twin's `isAnchored`
    // fork). Pinned here so "make the orphan honest" can't quietly flatten it.
    expect(CARD_REGISTRY.footnote.toFloatable(ANCHORED.footnoteId, CTX)!.canJump).toBe(true);
    expect(CARD_REGISTRY.footnote.toFloatable(PARKED.id, CTX)!.canJump).toBe(false);
  });
});
