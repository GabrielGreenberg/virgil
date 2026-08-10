// @vitest-environment jsdom
//
// Task 316 — the parked cue's PROMISE and its MECHANISM are one declaration.
//
// `UnanchoredFootnoteCard` has always rendered the full parked chrome, tooltip
// included ("Unanchored footnote — drag into the editor to anchor it"), and had
// no way to do that: it threaded no `cardKey`, and the drop button is gated on
// exactly that (`panel-primitives.tsx`, `kind != null && cardKey &&
// isDroppable(kind)`). Both mounts were dead — the docked panel and omni render
// the SAME component — while the citation twin threaded a key unconditionally,
// which is why "anchor the unanchored" worked there and nowhere else.
//
// The legs below are deliberately the ones the PRE-EXISTING guard could not be:
// `card-drop-button.test.tsx` synthesizes its own `cardKey` and renders
// `PanelCard` directly, so it passes on a tree where every real card forgot to
// pass one. These render the REAL card, through both real mounts, and drive the
// REAL gesture.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The card barrel transitively pulls `@/lib/storage`, whose `require` of
// `@/lib/storage-fsa` vitest can't alias (the known barrel/storage gotcha).
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

// Observe the session without a live DropCtx / spec registry — the same seam
// `card-drop-button.test.tsx` uses, so both suites pin the same contract shape.
const beginDropSession = vi.fn((..._args: unknown[]) => true);
const commitDropSession = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/components/drop-mode/controller", () => ({
  beginDropSession: (...args: unknown[]) => beginDropSession(...args),
  commitDropSession: (...args: unknown[]) => commitDropSession(...args),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import { UnanchoredFootnoteCard } from "@/panels/Footnotes/FootnoteCard";
import { buildFootnoteOmniItems } from "@/panels/Footnotes/omni";
import { unanchoredCardTitle } from "@/components/panel-primitives";
import { cardPopKey } from "@/panels/panel-registry";
import type { FootnoteRef } from "@/lib/types";

beforeEach(() => {
  beginDropSession.mockClear();
  commitDropSession.mockClear();
  beginDropSession.mockReturnValue(true);
});
afterEach(cleanup);

const REF = {
  id: "un1",
  unanchored: true,
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "parked body" }] }],
  },
  createdAt: "2026-08-08T00:00:00.000Z",
} as unknown as FootnoteRef;

/** The canonical key the whole app addresses this card by. */
const KEY = cardPopKey("footnote", REF.id);

/** How the DOCKED panel mounts it (`FootnotePanel`'s `kind === "ref"` arm). */
function dockedMount(): ReactElement {
  return (
    <UnanchoredFootnoteCard
      footnote={REF}
      onSelect={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

/** How OMNI mounts it — through the REAL builder, so a regression in the
 *  builder's own wiring is caught alongside the card's. */
function omniMount(): ReactElement {
  const items = buildFootnoteOmniItems({
    footnotes: [],
    orphanedFootnotes: [],
    unanchoredFootnotes: [REF],
    onEditUnanchored: vi.fn(),
    onDeleteUnanchored: vi.fn(),
    selectedFootnoteId: null,
    setSelectedFootnoteId: vi.fn(),
    scrollToFootnote: vi.fn(),
    onEditFootnote: vi.fn(),
    onDeleteFootnote: vi.fn(),
    onEditFootnoteTitle: vi.fn(),
    onEditOrphan: vi.fn(),
    onDeleteOrphan: vi.fn(),
    onEditOrphanTitle: vi.fn(),
    setOverrideEditor: vi.fn(),
    getCitationDisplayText: () => "",
    onCitationCreated: () => null,
  });
  expect(items).toHaveLength(1);
  expect(items[0].id).toBe(KEY);
  return items[0].content as ReactElement;
}

const MOUNTS: Array<[string, () => ReactElement]> = [
  ["docked panel", dockedMount],
  ["omni", omniMount],
];

describe("the parked footnote card's re-anchor affordance (task 316)", () => {
  for (const [name, mount] of MOUNTS) {
    it(`exposes an ENABLED "Drop into text" control in the ${name} mount`, () => {
      render(mount());
      const btn = screen.getByLabelText("Drop into text") as HTMLButtonElement;
      // Footnotes are never `dropDisabled` — unlike a keyless citation draft, a
      // footnote can always produce its atom (its body is the only attr, and an
      // empty body is a legal footnote).
      expect(btn.disabled).toBe(false);
    });

    it(`stamps the canonical data-card-key in the ${name} mount`, () => {
      const { container } = render(mount());
      const root = container.querySelector("[data-card]") as HTMLElement;
      expect(root.getAttribute("data-card-key")).toBe(KEY);
    });

    it(`starts a real drop session for its own key from the ${name} mount`, () => {
      render(mount());
      fireEvent.mouseDown(screen.getByLabelText("Drop into text"), { button: 0 });
      expect(beginDropSession).toHaveBeenCalledTimes(1);
      const arg = beginDropSession.mock.calls[0][0] as Record<string, unknown>;
      expect(arg.cardKey).toBe(KEY);
      // The shared `beginCardDropGesture` contract: a docked card has no popout
      // to dim, and the button owns commit-on-mouseup.
      expect(arg.inPlace).toBe(true);
      expect(arg.externalCommit).toBe(true);
    });
  }

  it("keeps the promise and the mechanism on the same card", () => {
    // The defect was never a missing tooltip — it was a tooltip with nothing
    // behind it. Assert both on one render, which is what the cue now is.
    const { container } = render(dockedMount());
    const root = container.querySelector("[data-card]") as HTMLElement;
    expect(root.getAttribute("title")).toBe(unanchoredCardTitle("footnote"));
    expect(screen.getByLabelText("Drop into text")).toBeTruthy();
  });
});

// ── The cue cannot be painted without the key ────────────────────────────────
// The compiler is the primary guard (the cue is a prop whose `cardKey` field is
// required), and it only bites while the dashed/opacity class is unreachable by
// any other route. So: the class constant is module-private, and nobody spells
// it — or the tooltip sentence — by hand.

const SRC_ROOT = join(process.cwd(), "src");
const PRIMITIVES = join(SRC_ROOT, "components", "panel-primitives.tsx");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (f: string) => f.replace(process.cwd() + "/", "");

/** Comments stripped, string literals KEPT — both needles ARE literals, so
 *  blanking strings would make every leg unfalsifiable (task 205's mistake),
 *  while keeping comments would flag every file that merely *discusses* the
 *  cue, this one included. Same shared scanner the other censuses import. */
function code(f: string): string {
  return commentsStripped(readFileSync(f, "utf8"));
}

describe("the parked cue has ONE spelling (task 316 census)", () => {
  const files = [...walk(SRC_ROOT), ...walk(join(process.cwd(), "library"))];

  it("can see the needles it greps for (self-check)", () => {
    // A census that silently matches nothing proves nothing. Both literals must
    // survive the stripper in the file that legitimately owns them.
    const primitives = code(PRIMITIVES);
    expect(primitives).toContain("border-dashed opacity-80");
    expect(primitives).toContain("drag into the editor to anchor it");
    expect(files.length).toBeGreaterThan(500);
  });

  it("nothing outside panel-primitives spells the cue class", () => {
    // A card that hand-spells the class paints the parked look with no
    // `cardKey` — the ORIGINAL shape, re-achieved around the type. Suites are
    // excluded on the same principle the link-surface census uses ("a suite is
    // not a consumer"): a test may name the class to ASSERT the rendered
    // chrome, and this file must be able to name it to grep for it — neither
    // ships a card that paints the cue.
    const hits = files.filter(
      (f) => f !== PRIMITIVES && !f.includes("__tests__") && code(f).includes("border-dashed opacity-80"),
    );
    expect(hits.map(rel)).toEqual([]);
  });

  it("the cue class is not exported (only the prop reaches it)", () => {
    const src = readFileSync(PRIMITIVES, "utf8");
    expect(src).toContain("const UNANCHORED_CARD_CLASS");
    expect(src).not.toContain("export const UNANCHORED_CARD_CLASS");
  });

  it("the tooltip copy has one producer", () => {
    const hits = files.filter(
      (f) =>
        f !== PRIMITIVES &&
        !f.includes("__tests__") &&
        code(f).includes("drag into the editor to anchor it"),
    );
    expect(hits.map(rel)).toEqual([]);
  });
});
