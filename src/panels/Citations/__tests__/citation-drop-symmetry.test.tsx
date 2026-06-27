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
import { render, screen, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import { citationCommandOrNull } from "@/lib/bib-parser";
import { citationDropSpec } from "@/panels/Citations/drop-spec";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
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
 *  The spec reads the command via `ctx.citations.commandFor(id)` — which after
 *  FOLD 3 returns `citationCommandOrNull(cit.command)`; we feed the raw command
 *  and let the spec's OWN `citationCommandOrNull` gate decide. */
function specWouldAnchor(command: string): boolean {
  const { editor } = liveEditor();
  const ctx = {
    mainEditor: editor,
    citations: { commandFor: (id: string) => (id === CITE_ID ? command : null) },
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
