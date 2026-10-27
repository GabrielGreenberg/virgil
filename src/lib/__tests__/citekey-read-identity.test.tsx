// @vitest-environment jsdom
//
// Task 1325 — the bib READERS ask the same citekey identity the mutators do.
//
// Task 1159 folded case in the mutators (`citekeyEq`) but left every reader on
// an exact `Map<string, BibEntry>`, so the app held two answers to "are these
// the same key?" and they met in one gesture: `\cite{smith2020}` against a bib
// holding `Smith2020` rendered "?? ??", the card read the row as missing, and
// the add it offered was refused as a case-twin. Every reader now asks ONE
// door, `bibKeyIndex` / `findBibEntryByKey` (`bib-address.ts`).
//
// Each behavioural leg fails on the pre-fix code; the census pins the shape.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnlyLines } from "./_source-scan";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

const LIB_TWIN = {
  uid: "",
  key: "smith2020",
  type: "article",
  fields: { author: "Smith, Anna", title: "Library Spelling", year: "2021" },
  raw: "",
};

vi.mock("@/hooks/useLibrary", () => ({
  useLibraryItems: () => ({ items: [], loading: false }),
  useLibraryMasterBib: () => ({ entries: [LIB_TWIN], loading: false }),
  useLibraryMemberships: () => ({ membershipMap: new Map(), loading: false }),
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
beforeAll(() => {
  (HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView =
    () => undefined;
});

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { BibEntry, CitationRef } from "@/lib/types";
import { bibKeyIndex, findBibEntryByKey, isCaseTwinHit } from "@/lib/bib-address";
import { formatInlineCitation, formatMinimalCitation } from "@/lib/bib-parser";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { CitekeyPicker } from "@/panels/Citations/CitekeyPicker";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

const SMITH: BibEntry = {
  uid: "uid-smith",
  key: "Smith2020",
  type: "article",
  fields: { author: "Smith, Anna", title: "Bib Spelling", year: "2020" },
  raw: "",
};

describe("bibKeyIndex — the one READ door", () => {
  it("resolves a case-twin, and says it was one", () => {
    const idx = bibKeyIndex([SMITH]);
    expect(idx.get("smith2020")).toBe(SMITH);
    expect(idx.has("SMITH2020")).toBe(true);
    expect(idx.get("jones1999")).toBeUndefined();
    expect(isCaseTwinHit("smith2020", idx.get("smith2020"))).toBe(true);
    expect(isCaseTwinHit("Smith2020", idx.get("Smith2020"))).toBe(false);
  });

  it("prefers the exact spelling, then the FIRST twin in source order", () => {
    const lower = { ...SMITH, uid: "u2", key: "smith2020" };
    const upper = { ...SMITH, uid: "u3", key: "SMITH2020" };
    const idx = bibKeyIndex([SMITH, lower, upper]);
    expect(idx.get("smith2020")).toBe(lower);
    expect(idx.get("SMITH2020")).toBe(upper);
    expect(idx.get("sMiTh2020")).toBe(SMITH);
    expect(findBibEntryByKey([SMITH, lower], "smith2020")).toBe(lower);
    expect(findBibEntryByKey([SMITH, lower], "SMITH2020")).toBe(SMITH);
  });
});

describe("prose display resolves a case-twin", () => {
  it("`\\citep{smith2020}` against bib `Smith2020` renders author + year", () => {
    const out = formatInlineCitation("\\citep{smith2020}", [SMITH], "natbib");
    expect(out).toContain("Smith");
    expect(out).toContain("2020");
    expect(out).not.toContain("??");
    expect(formatMinimalCitation("smith2020", [SMITH])).toBe("Smith (2020)");
  });
});

describe("citation card · a case-twin row is resolved, with a quiet cue", () => {
  const CIT: CitationRef = {
    id: "cit-twin",
    command: "\\citep{smith2020}",
    keys: ["smith2020"],
    createdAt: "2026-10-27T00:00:00.000Z",
  };
  const REF = { kind: "citation" as const, id: CIT.id };
  beforeEach(() => {
    cardStore.clearSelection();
    cardStore.expand(REF);
  });
  afterEach(() => cardStore.collapse(REF));

  function renderCard(overrides: Partial<ComponentProps<typeof CitationCard>> = {}) {
    const onUpdateCitation = vi.fn();
    render(
      <CitationCard
        citation={CIT}
        isSelected={false}
        bibEntries={[SMITH]}
        bibPackage="natbib"
        getDisplayText={() => "Smith 2020"}
        onSelect={vi.fn()}
        onJump={vi.fn()}
        onUpdateCitation={onUpdateCitation}
        onAddBibEntry={vi.fn()}
        {...overrides}
      />,
    );
    return { onUpdateCitation };
  }

  it("the row is NOT 'not in your bibliography'", () => {
    renderCard();
    expect(screen.queryByText(/not in your/)).toBeNull();
    expect(screen.getAllByText(/Bib Spelling/).length).toBeGreaterThan(0);
  });

  it("names the bib's spelling, and 'Use' rewrites the \\cite key to it", () => {
    const { onUpdateCitation } = renderCard();
    const cue = document.querySelector("[data-citekey-case-twin]");
    expect(cue?.getAttribute("data-citekey-case-twin")).toBe("Smith2020");
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(onUpdateCitation).toHaveBeenCalled();
    expect(JSON.stringify(onUpdateCitation.mock.calls.at(-1))).toContain(
      "\\\\citep{Smith2020}",
    );
  });

  it("an exact-spelled row carries no cue", () => {
    renderCard({ citation: { ...CIT, command: "\\citep{Smith2020}", keys: ["Smith2020"] } });
    expect(document.querySelector("[data-citekey-case-twin]")).toBeNull();
  });
});

describe("picker · a library case-twin of a paper entry is the SAME key", () => {
  const ANCHOR = {
    top: 100, bottom: 120, left: 40, right: 140, width: 100, height: 20,
    x: 40, y: 100, toJSON: () => ({}),
  } as DOMRect;

  it("lists one row, adds nothing, and cites the BIB's spelling", () => {
    const add = vi.fn();
    const onSelectKeys = vi.fn();
    render(
      <CitekeyPicker
        open
        anchorRect={ANCHOR}
        onClose={vi.fn()}
        paperBibEntries={[SMITH]}
        onSelectKeys={onSelectKeys}
        onAddBibEntry={add}
      />,
    );
    const input = screen.getByPlaceholderText("Search references or library…");
    fireEvent.change(input, { target: { value: "smith" } });
    expect(screen.queryByText(/Library Spelling/)).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(add).not.toHaveBeenCalled();
    expect(onSelectKeys).toHaveBeenCalledWith(["Smith2020"]);
  });
});

// ---------------------------------------------------------------------------
// CENSUS — no reader builds an exact raw-key bib lookup.
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../../..");
/** The files that answer "which bib entry does this key name?". */
const READER_FILES = [
  "src/lib/bib-parser.ts",
  "src/hooks/useCitations.ts",
  "src/hooks/useAutoAddLibraryEntriesForCitations.ts",
  "src/panels/Citations/CitationCard.tsx",
  "src/panels/Citations/CitekeyPicker.tsx",
  "src/panels/Bibliography/BibliographyPanel.tsx",
];
/** An exact raw-key lookup: a Map/Set keyed by `e.key`, a `.set(e.key, …)`,
 *  or `.find((e) => e.key === key)`. */
const RAW_KEY_LOOKUP =
  /new (?:Map|Set)\(\s*\w+\.map\(\(?\w+\)?\s*=>\s*(?:\[\s*)?\w+\.key\b|\.set\(\w+\.key\s*,|\.find\(\(?\w+\)?\s*=>\s*\w+\.key\s*===/;
const EXEMPT = "citekey-exact";

function rawLookupHits(src: string): string[] {
  const raw = src.split("\n");
  return codeOnlyLines(src)
    .split("\n")
    .filter((l, i) => RAW_KEY_LOOKUP.test(l) && !raw[i].includes(EXEMPT));
}

describe("CENSUS · bib readers ask bibKeyIndex, never a raw-key Map", () => {
  for (const f of READER_FILES) {
    it(`${f} holds no raw-key bib lookup`, () => {
      expect(rawLookupHits(fs.readFileSync(path.join(REPO, f), "utf8"))).toEqual([]);
    });
  }

  it("the census can SEE a rogue lookup (canary)", () => {
    expect(rawLookupHits("const m = new Map(bibEntries.map((e) => [e.key, e]));")).toHaveLength(1);
    expect(rawLookupHits("const s = new Set(paperBibEntries.map((e) => e.key));")).toHaveLength(1);
    expect(rawLookupHits("for (const e of xs) out.set(e.key, e);")).toHaveLength(1);
    expect(rawLookupHits("const hit = bibEntries.find((e) => e.key === key);")).toHaveLength(1);
    expect(rawLookupHits("const m = bibKeyIndex(bibEntries);")).toEqual([]);
  });
});
