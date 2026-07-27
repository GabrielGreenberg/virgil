// @vitest-environment jsdom
//
// task 240 — the CI-F7-01 PanelCard-direct class, closed for the two suggestion
// cards. `CutterSuggestionCard` + `RevisionSuggestionCard` render via `PanelCard`
// directly (like `CitationCard`), NOT via `EditableCard`, so their docked trash
// button + card-level Delete/Backspace key historically wired straight to the raw
// `onDelete` — bypassing the `cardHasContent` delete-confirm every EditableCard
// sibling and the same suggestion's in-text margin marker (`deleteMarginItem`)
// enforce. A human-authored suggestion with typed `user_text` was one click from
// silent loss. These tests pin that both docked delete paths now route through
// the shared `usePanelCardTryDelete` hook (the same `cardHasContent` SSOT), for
// BOTH kinds — matching the predicate `content-coverage.test.ts` asserts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import type { ReactElement } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { CutterSuggestionCard } from "@/panels/Cutter/CutterSuggestionCard";
import { RevisionSuggestionCard } from "@/panels/Revisions/RevisionSuggestionCard";
import { cardHasContent } from "@/cards/has-content";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type {
  CutterSuggestionCard as CutterSuggestionCardData,
  RevisionSuggestionCard as RevisionSuggestionCardData,
} from "@/lib/types";

afterEach(cleanup);

const CONFIRM_TEXT = "This item has text. Delete it?";

function makeSuggestion(
  overrides: Partial<CutterSuggestionCardData> = {},
): CutterSuggestionCardData {
  // The two kinds share a byte-identical body shape (`kind: "suggestion"` + the
  // 5 suggestion fields), so one factory serves both. Author must be "human" so
  // the field-grid body (not the minimal AI Insert-below body) renders.
  return {
    kind: "suggestion",
    id: "s1",
    createdAt: "2026-07-27T00:00:00.000Z",
    author: "human",
    original_text: "the original passage",
    suggested_text: "a suggested replacement",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "pending",
    links: [],
    ...overrides,
  } as CutterSuggestionCardData;
}

/** Each kind's card component + its shell data-attribute + the anchored-card ref
 *  used to drive expand/select on the shared card store. */
const KINDS = [
  {
    name: "cutter-suggestion",
    Card: CutterSuggestionCard,
    shellAttr: "data-cutter-suggestion-entry",
    ref: { kind: "cutter-suggestion" as const, id: "s1" },
  },
  {
    name: "revision-suggestion",
    Card: RevisionSuggestionCard,
    shellAttr: "data-revision-suggestion-entry",
    ref: { kind: "revision-suggestion" as const, id: "s1" },
  },
] as const;

function renderCard(
  Card: typeof CutterSuggestionCard | typeof RevisionSuggestionCard,
  ref: { kind: "cutter-suggestion" | "revision-suggestion"; id: string },
  card: CutterSuggestionCardData,
  selected: boolean,
  onDelete = vi.fn(),
) {
  // The trash button only renders on the expanded (non-collapsed) body.
  cardStore.expand(ref);
  const common = {
    card: card as CutterSuggestionCardData & RevisionSuggestionCardData,
    selected,
    onUpdateField: vi.fn(),
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onConvert: vi.fn(),
    onDelete,
    onSelect: vi.fn(),
  };
  const CardAny = Card as (props: typeof common) => ReactElement;
  const utils = render(<CardAny {...common} />);
  return { onDelete, ...utils };
}

beforeEach(() => {
  KINDS.forEach((k) => {
    cardStore.collapse(k.ref);
  });
  cardStore.clearSelection();
});

describe.each(KINDS)("$name docked delete-confirm (task 240)", ({ Card, shellAttr, ref }) => {
  it("a suggestion with typed user_text: docked trash opens the confirm (does NOT delete)", () => {
    const card = makeSuggestion({ user_text: "keep this" });
    // Sanity: this fixture IS content-bearing by the SSOT predicate.
    expect(cardHasContent("cutter-suggestion", card)).toBe(true);
    const { onDelete } = renderCard(Card, ref, card, false);
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("confirming the dialog then calls onDelete", async () => {
    const { onDelete } = renderCard(
      Card,
      ref,
      makeSuggestion({ user_text: "keep this" }),
      false,
    );
    fireEvent.click(screen.getByLabelText("Delete"));
    fireEvent.click(screen.getByText("Delete", { selector: "button" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("s1"));
  });

  it("a pristine suggestion (only aiPrefilled original/suggested text) trash deletes immediately — no confirm", () => {
    const card = makeSuggestion({ user_text: "", explanation: "" });
    // Only aiPrefilled fields are set → NOT content-bearing by the SSOT.
    expect(cardHasContent("cutter-suggestion", card)).toBe(false);
    const { onDelete } = renderCard(Card, ref, card, false);
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    expect(onDelete).toHaveBeenCalledWith("s1");
  });

  it("Delete key on a content-bearing selected card opens the confirm (does NOT delete)", () => {
    const { onDelete } = renderCard(
      Card,
      ref,
      makeSuggestion({ explanation: "why this reads better" }),
      true,
    );
    const shell = document.querySelector<HTMLElement>(`[${shellAttr}="s1"]`);
    expect(shell).not.toBeNull();
    fireEvent.keyDown(shell!, { key: "Delete" });
    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("Delete key on a pristine selected card deletes straight through — no confirm", () => {
    const { onDelete } = renderCard(Card, ref, makeSuggestion(), true);
    const shell = document.querySelector<HTMLElement>(`[${shellAttr}="s1"]`);
    fireEvent.keyDown(shell!, { key: "Delete" });
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    expect(onDelete).toHaveBeenCalledWith("s1");
  });
});
