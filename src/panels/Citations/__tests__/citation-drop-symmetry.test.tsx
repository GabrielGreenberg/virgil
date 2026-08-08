// @vitest-environment jsdom
//
// FOLD 3 — the keyless-citation SYMMETRY pin.
//
// One invariant binds three sites that must NEVER disagree (button-disabled ⇔
// spec-declines):
//   1. the upstream disabled drop button  — `CitationCard.dropDisabled`,
//   2. the create-branch command source   — `useCitations.commandFor`,
//   3. the downstream spec decline guard   — `citationDropSpec.createAtom`.
//
// All three now consume ONE shared predicate, `citationCommandOrNull`
// (`@/lib/bib-parser`). This test exercises that predicate AND the two real
// consumer surfaces it directly powers (the rendered card's drop button, and
// the real `citationDropSpec.classifyDrop`), proving they agree for both a
// keyless input (`''`, `\cite{}`) and a valid `\cite{key}`.
//
// TEETH: break `citationCommandOrNull` (e.g. drop the keyless check so it
// returns the command unchanged) and BOTH legs flip — the button enables AND
// the spec classifies `apply` for `\cite{}` — turning this RED.

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

// CitekeyPicker (mounted by a draft card) reaches the Library catalog store,
// which opens indexedDB on mount — absent in jsdom. Stub the hook layer.
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

import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { citationCommandOrNull } from "@/lib/bib-parser";
import { citationDropSpec } from "@/panels/Citations/drop-spec";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { MIME_CITATION, MIME_BIB_MERGE } from "@/lib/marginalia";
import type { CitationRef } from "@/lib/types";
import type { DropCtx, Placement } from "@/components/drop-mode/types";

afterEach(cleanup);

// ── Minimal schema carrying a `citation` atom mirroring the real node ─────
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
    citation: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: false,
      attrs: { command: { default: "" }, displayText: { default: "" }, citationId: { default: "" } },
      parseDOM: [{ tag: "span[data-type=citation]" }],
      toDOM: () => ["span", { "data-type": "citation" }, "[1]"],
    },
  },
});

function liveEditor(): { editor: Editor; getState: () => EditorState } {
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("alpha bravo")]),
    ]),
  });
  const editor = {
    schema,
    get state() { return state; },
    view: {
      get state() { return state; },
      nodeDOM: () => null,
      dispatch: (tr: Transaction) => { state = state.apply(tr); },
      focus: () => {},
    },
  } as unknown as Editor;
  return { editor, getState: () => state };
}

function inlineCursor(editor: Editor, pos: number): Placement {
  return {
    kind: "inline-cursor",
    editor,
    pos,
    rect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as Placement;
}

const CITE_ID = "sym-cite";
const CITE_KEY = `float:card:citation:${CITE_ID}`;

/** SPEC LEG (real): does `citationDropSpec` classify `apply` for this command?
 *  The spec reads the command via the shared inline-atom card accessor
 *  (`ctx.atomCards.citation.atomAttrsFor(id)`, task 233) — which is fed by
 *  `commandFor`, returning `citationCommandOrNull(cit.command)`; we feed the raw
 *  command and let the spec's OWN `citationCommandOrNull` gate decide. */
function specWouldAnchor(command: string): boolean {
  const { editor } = liveEditor();
  const ctx = {
    mainEditor: editor,
    atomCards: {
      citation: {
        atomAttrsFor: (id: string) => ({ command: id === CITE_ID ? command : null }),
      },
    },
  } as unknown as DropCtx;
  return citationDropSpec.classifyDrop(inlineCursor(editor, 3), CITE_KEY, ctx).kind === "apply";
}

/** BUTTON LEG (real): render the real CitationCard with a draft carrying
 *  `command` and report whether its drop button is ENABLED. */
type CitationCardProps = ComponentProps<typeof CitationCard>;
function buttonEnabledFor(command: string): boolean {
  cardStore.collapse({ kind: "citation", id: CITE_ID });
  cardStore.clearSelection();
  const cit: CitationRef = {
    id: CITE_ID,
    command,
    keys: [],
    createdAt: "2026-06-16T00:00:00.000Z",
  };
  const props: CitationCardProps = {
    citation: cit,
    isDraft: true,
    isSelected: false,
    bibEntries: [],
    bibPackage: "natbib",
    getDisplayText: () => "",
    onSelect: vi.fn(),
    onJump: vi.fn(),
    onUpdateCitation: vi.fn(),
  };
  render(<CitationCard {...props} />);
  const btn = screen.getByLabelText("Drop into text") as HTMLButtonElement;
  const enabled = !btn.disabled;
  cleanup();
  return enabled;
}

describe("FOLD 3 — keyless-citation predicate symmetry (button ⇔ commandFor ⇔ spec)", () => {
  const keylessInputs = ["", "\\cite{}", "\\citep{ }"];
  const keyedInputs = ["\\cite{smith2020}", "\\citep{a,b}"];

  for (const command of keylessInputs) {
    it(`keyless ${JSON.stringify(command)} ⇒ button disabled, spec declines, predicate null (all agree)`, () => {
      // Assert the CONSUMER legs first, so a broken predicate proves the
      // real button render + real spec classify flip — not just the SSOT.
      // Button leg (real CitationCard render) — disabled.
      expect(buttonEnabledFor(command)).toBe(false);
      // Spec leg (real `citationDropSpec.classifyDrop`) — declines (no `apply`).
      expect(specWouldAnchor(command)).toBe(false);
      // commandFor leg: its real body IS `citationCommandOrNull(cit.command)`,
      // so for a draft carrying this command it returns null (declined source),
      // and the SSOT predicate itself reports keyless.
      expect(citationCommandOrNull(command)).toBeNull();
    });
  }

  for (const command of keyedInputs) {
    it(`keyed ${JSON.stringify(command)} ⇒ predicate non-null, button enabled, spec anchors (all agree)`, () => {
      expect(citationCommandOrNull(command)).toBe(command);
      expect(buttonEnabledFor(command)).toBe(true);
      expect(specWouldAnchor(command)).toBe(true);
    });
  }
});

// ── task 083 — drop-path hygiene ─────────────────────────────────────────
//
// The "drop here" ring must PREDICT the drop: it lights iff `handleCardDrop`
// would accept. Two drags share the single `MIME_CITATION` type — a bib-entry
// (payload `{ command, bibKey }`, MERGEABLE) and a citation card's own
// atom-move (payload `{ command, citationId }`, NOT mergeable). `dragover` can
// read `types` but not `getData`, so the fix gives the mergeable drag a
// distinct `MIME_BIB_MERGE` discriminator and gates the ring on it. This
// exercises the real CitationCard render for both drags, over both handlers.
//
// TEETH: revert the ring gate to `MIME_CITATION` and the citation-over-card
// case lights a ring the drop then rejects (RED). Point `handleCardDrop` back
// at `MIME_CITATION` and the citation-payload drop starts merging a `citationId`
// as if it were a `bibKey` (RED on the no-op case).

/** A minimal fake DataTransfer — `dragover` reads only `types`; the drop reads
 *  `getData`. jsdom's DataTransfer is too thin, so we hand-roll both. */
function fakeDT(payload: Record<string, string>): DataTransfer {
  return {
    types: Object.keys(payload),
    getData: (t: string) => payload[t] ?? "",
    setData: () => {},
    dropEffect: "",
    effectAllowed: "",
  } as unknown as DataTransfer;
}

/** A bib-entry drag: BOTH the inline-insert MIME and the merge discriminator. */
const bibEntryDT = () =>
  fakeDT({
    [MIME_CITATION]: JSON.stringify({ command: "\\cite{smith2020}", bibKey: "smith2020" }),
    [MIME_BIB_MERGE]: JSON.stringify({ bibKey: "smith2020" }),
  });

/** A citation card's own atom-move drag: `MIME_CITATION` alone, no merge key. */
const citationAtomDT = () =>
  fakeDT({
    [MIME_CITATION]: JSON.stringify({ command: "\\cite{jones2019}", citationId: "other-cite" }),
  });

function renderCard(command = "") {
  cardStore.collapse({ kind: "citation", id: CITE_ID });
  cardStore.clearSelection();
  const cit: CitationRef = {
    id: CITE_ID,
    command,
    keys: [],
    createdAt: "2026-06-16T00:00:00.000Z",
  };
  const onUpdateCitation = vi.fn();
  const props: CitationCardProps = {
    citation: cit,
    isDraft: true,
    isSelected: false,
    bibEntries: [],
    bibPackage: "natbib",
    getDisplayText: () => "",
    onSelect: vi.fn(),
    onJump: vi.fn(),
    onUpdateCitation,
  };
  const { container } = render(<CitationCard {...props} />);
  const cardEl = container.querySelector("[data-card]") as HTMLElement;
  return { container, cardEl, onUpdateCitation };
}

describe("task 083 — citation drop ring predicts the drop (bib-entry merge only)", () => {
  it("bib-entry drag lights the drop-target ring", () => {
    const { container, cardEl } = renderCard();
    expect(container.querySelector(".ring-drag-target")).toBeNull();
    fireEvent.dragOver(cardEl, { dataTransfer: bibEntryDT() });
    expect(container.querySelector(".ring-drag-target")).not.toBeNull();
  });

  it("a citation card's own atom-move drag does NOT light the ring (no false promise)", () => {
    const { container, cardEl } = renderCard();
    fireEvent.dragOver(cardEl, { dataTransfer: citationAtomDT() });
    expect(container.querySelector(".ring-drag-target")).toBeNull();
  });

  it("bib-entry drop merges the key (the real drop path still lands)", () => {
    const { cardEl, onUpdateCitation } = renderCard();
    fireEvent.drop(cardEl, { dataTransfer: bibEntryDT() });
    expect(onUpdateCitation).toHaveBeenCalledTimes(1);
    // Merged command carries the dropped bib key.
    expect(onUpdateCitation.mock.calls[0][1]).toContain("smith2020");
  });

  it("a citation-payload drop is a silent no-op (no merge, no parent write)", () => {
    const { cardEl, onUpdateCitation } = renderCard();
    fireEvent.drop(cardEl, { dataTransfer: citationAtomDT() });
    expect(onUpdateCitation).not.toHaveBeenCalled();
  });
});
