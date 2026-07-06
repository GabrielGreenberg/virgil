// @vitest-environment jsdom
//
// Task 055 — BibEntryCard renders through the UNIFIED card-standard header
// (PanelCard `kind="bib"`), not a bespoke hand-rolled header block. Pins the
// contract of the re-slot:
//   1. The unified header (`[data-card-header]`) renders with the
//      "BIBLIOGRAPHY ITEM" overline (via `kindLabelOverride`), like every
//      other card kind — no bespoke absolute top-right control cluster.
//   2. author · year · title still render (moved into the card body/title).
//   3. The occurrence counter (n/N) survives, in the header trailing slot.
//   4. The "Add" affordance survives and still fires onAdd.
//   5. Drag-to-cite survives: the card root is a drag source writing the
//      MIME_CITATION payload.

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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { render, cleanup, fireEvent } from "@testing-library/react";
import BibEntryCard from "@/components/BibEntryCard";
import { MIME_CITATION } from "@/lib/marginalia";
import type { BibEntry } from "@/lib/types";

afterEach(cleanup);

const ENTRY: BibEntry = {
  uid: "u1",
  key: "genette1997",
  type: "book",
  fields: {
    author: "Genette, G.",
    year: "1997",
    title: "Paratexts: Thresholds of interpretation",
  },
  raw: "",
} as BibEntry;

function renderCard(extra: Partial<React.ComponentProps<typeof BibEntryCard>> = {}) {
  return render(
    <BibEntryCard
      entry={ENTRY}
      isSelected
      onClick={() => {}}
      getAnnotation={() => ""}
      setAnnotation={() => {}}
      onRequestReview={() => {}}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      onUpdateBibEntry={() => {}}
      onUpdateBibKeyAndType={() => {}}
      {...extra}
    />,
  );
}

describe("BibEntryCard — unified card-standard header (task 055)", () => {
  it("renders through the unified header with a BIBLIOGRAPHY ITEM overline", () => {
    const { container, getByText } = renderCard();
    // The unified PanelCard header (single source of truth) is present…
    expect(container.querySelector('[data-card-header]')).not.toBeNull();
    // …with the card-standard overline label (uppercased by CSS; DOM text is
    // the raw label).
    expect(getByText("Bibliography item")).toBeTruthy();
  });

  it("still renders author · year · title", () => {
    const { getByText } = renderCard();
    expect(getByText("Genette, G.")).toBeTruthy();
    expect(getByText("1997")).toBeTruthy();
    expect(getByText("Paratexts: Thresholds of interpretation")).toBeTruthy();
  });

  it("keeps the occurrence counter when the entry is cited more than once", () => {
    const { getByText } = renderCard({
      occurrenceInfo: { total: 3, current: 0, onCycle: () => {} },
    });
    expect(getByText("1/3")).toBeTruthy();
  });

  it("keeps the Add affordance and fires onAdd", () => {
    const onAdd = vi.fn();
    const { getByText } = renderCard({
      draggable: false,
      addAction: { onAdd, alreadyAdded: false },
    });
    fireEvent.click(getByText("Add"));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("remains a drag source writing the MIME_CITATION payload", () => {
    const { container } = renderCard();
    const root = container.querySelector('[data-card]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute("draggable")).toBe("true");

    const store: Record<string, string> = {};
    const dataTransfer = {
      setData: (type: string, val: string) => { store[type] = val; },
      getData: (type: string) => store[type] ?? "",
      setDragImage: () => {},
      set effectAllowed(_v: string) {},
      get effectAllowed() { return "copyMove"; },
    };
    fireEvent.dragStart(root, { dataTransfer });
    expect(store[MIME_CITATION]).toBeTruthy();
    expect(store[MIME_CITATION]).toContain("genette1997");
    expect(store["text/plain"]).toContain("\\cite{genette1997}");
  });
});

describe("BibEntryCard — jump affordance uses the canonical JumpChevron (task 068)", () => {
  // The jump-to-citation control renders through `CardJumpTarget`, which wraps
  // the shared `CardJumpChevron` (aria-label "Jump to citation") in a
  // selection-aware opacity envelope. Swapping the retired boxed-arrow
  // `TargetIcon` for the canonical `>` glyph is a picture-only change.
  const JUMP_CHEVRON = "9 6 15 12 9 18"; // JumpChevron polyline SSOT
  const RETIRED_ARROW = "11 9 14 12 11 15"; // old TargetIcon arrowhead

  it("renders the canonical > JumpChevron (not the retired boxed arrow) when onJump is set", () => {
    const { container } = renderCard({ onJump: () => {} });
    const btn = container.querySelector('button[aria-label="Jump to citation"]');
    expect(btn).not.toBeNull();
    // The canonical chevron polyline is present…
    expect(btn!.querySelector(`polyline[points="${JUMP_CHEVRON}"]`)).not.toBeNull();
    // …and the retired boxed-arrow glyph is gone from the whole card.
    expect(container.querySelector('rect[x="6"][y="2"]')).toBeNull();
    expect(container.querySelector(`polyline[points="${RETIRED_ARROW}"]`)).toBeNull();
  });

  it("fades 100% when selected and 60% cited-but-unselected (no layout shift)", () => {
    const sel = renderCard({ onJump: () => {}, isSelected: true });
    const selBtn = sel.container.querySelector('button[aria-label="Jump to citation"]')!;
    expect(selBtn.parentElement!.className).toContain("opacity-100");
    cleanup();

    const unsel = renderCard({ onJump: () => {}, isSelected: false });
    const unselBtn = unsel.container.querySelector('button[aria-label="Jump to citation"]')!;
    expect(unselBtn.parentElement!.className).toContain("opacity-60");
  });

  it("still jumps on click (behavior unchanged by the glyph swap)", () => {
    const onJump = vi.fn();
    const { container } = renderCard({ onJump });
    const btn = container.querySelector('button[aria-label="Jump to citation"]') as HTMLElement;
    fireEvent.click(btn);
    expect(onJump).toHaveBeenCalledTimes(1);
  });
});

describe("Icon-SSOT guardrail — the retired boxed-arrow jump glyphs are gone (task 068)", () => {
  // Mirrors the JumpChevron SSOT discipline: one action (jump-to-source), one
  // glyph. `TargetIcon`/`TargetFileIcon` (arrow-into-a-box) were the last
  // pre-SSOT holdouts; assert nothing in src/ re-introduces them so the glyph
  // can't drift back.
  function walkTsFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === ".next") continue;
        walkTsFiles(full, out);
      } else if (/\.(ts|tsx)$/.test(name)) {
        out.push(full);
      }
    }
    return out;
  }

  const srcRoot = join(process.cwd(), "src");
  const files = walkTsFiles(srcRoot);

  it("defines no TargetIcon / TargetFileIcon component anywhere in src", () => {
    // Exclude the __tests__ tree — the guardrail regexes below name the retired
    // symbols literally, so they'd flag their own source file.
    const offenders = files.filter((f) => {
      if (f.includes("__tests__")) return false;
      const src = readFileSync(f, "utf8");
      return /function\s+Target(File)?Icon\b/.test(src) || /\bCardTargetIcon\b/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("has no surviving arrow-into-a-box inline jump glyph (rect x=6 y=2 + left-arrow)", () => {
    // This test file itself names the retired points in its assertions, so
    // exclude the __tests__ tree from the source sweep.
    const offenders = files.filter((f) => {
      if (f.includes("__tests__")) return false;
      const src = readFileSync(f, "utf8");
      return /rect x="6" y="2"/.test(src) && /polyline points="11 9 14 12 11 15"/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
