// @vitest-environment jsdom
//
// Task 078 pin — the raw "Code" LaTeX input bypasses the row mutators, so on
// commit it MUST resync the card's local `rows`/`type`/`starred`/`capitalized`
// from the committed command. Without that resync the local state stays stale,
// and the next control that fires `persist()` (a checkbox, the Type select, a
// row edit) re-serializes from the stale rows — silently dropping the key the
// user just added via the Code field.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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

// CitekeyPicker (always mounted by CitationCard, open=false) reaches the
// Library catalog store, which opens indexedDB on mount — absent in jsdom.
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

import { useState } from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { parseCiteCommand } from "@/lib/bib-parser";
import type { CitationRef } from "@/lib/types";

afterEach(cleanup);

/** `useFloatingMenuPosition` renders the menu `visibility: hidden` until its
 *  first measurement lands, and Testing Library's `getByRole` skips elements
 *  hidden from the accessibility tree — so a menu asserted on synchronously is
 *  a menu that is open, correct, and unqueryable. Flush the measurement (and
 *  the dismiss controller's `setTimeout(…, 0)`) before asking about rows. */
async function settleMenu() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const REF = { kind: "citation" as const, id: "cit1" };

beforeEach(() => {
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

/** A controlled parent that echoes `cit.command` back exactly as the real
 *  `useCitations.updateCitation` does (command stored verbatim, keys re-parsed).
 *  `emitted` records every command the card serialized, newest last. */
function Harness({ emitted }: { emitted: string[] }) {
  const [cit, setCit] = useState<CitationRef>({
    id: "cit1",
    command: "\\cite{smith}",
    keys: ["smith"],
    createdAt: "2026-06-11T00:00:00.000Z",
  });
  return (
    <CitationCard
      citation={cit}
      isSelected={false}
      isAnchored
      bibEntries={[]}
      bibPackage="natbib"
      getDisplayText={() => ""}
      onSelect={() => {}}
      onJump={() => {}}
      onUpdateCitation={(_id, command) => {
        emitted.push(command);
        const parsed = parseCiteCommand(command);
        setCit((c) => ({ ...c, command, keys: parsed?.keys ?? c.keys }));
      }}
    />
  );
}

describe("CitationCard — raw Code edit resyncs local state (task 078)", () => {
  it("a key added via the Code field survives a subsequent checkbox toggle", async () => {
    const emitted: string[] = [];
    render(<Harness emitted={emitted} />);

    // Expand the (non-draft) card so the Code row + Type/overflow strip render.
    fireEvent.click(screen.getByLabelText("Expand card"));

    // Open the raw Code editor and add a second key.
    fireEvent.click(screen.getByLabelText("Edit raw LaTeX"));
    const codeInput = screen.getByDisplayValue("\\cite{smith}");
    fireEvent.change(codeInput, { target: { value: "\\cite{smith,jones}" } });
    fireEvent.keyDown(codeInput, { key: "Enter" }); // commit

    expect(emitted.at(-1)).toBe("\\cite{smith,jones}");

    // Toggle the `*` (Full author list) checkbox → fires persist() from the
    // card's local rows. Pre-fix this re-serialized from the STALE single-key
    // rows and dropped `jones`.
    // The overflow menu folded onto `<AnchoredMenu>` + `<MenuToggleRow>` in
    // task 181, so the row is a `menuitemcheckbox` carrying `aria-checked`
    // rather than a native `<input type="checkbox">` inside a `<label>`. Same
    // click, same handler, same assertion below — only the role changed.
    fireEvent.click(screen.getByLabelText("More options"));
    await settleMenu();
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: /Full author list/i }),
    );

    const last = emitted.at(-1)!;
    expect(last).toContain("smith");
    expect(last).toContain("jones"); // the key the bug silently dropped
    expect(last).toMatch(/\\cite\*/); // starred marker applied
  });

  it("the Type select after a Code edit also preserves the added key", () => {
    const emitted: string[] = [];
    render(<Harness emitted={emitted} />);
    fireEvent.click(screen.getByLabelText("Expand card"));

    fireEvent.click(screen.getByLabelText("Edit raw LaTeX"));
    const codeInput = screen.getByDisplayValue("\\cite{smith}");
    fireEvent.change(codeInput, { target: { value: "\\cite{smith,jones}" } });
    fireEvent.keyDown(codeInput, { key: "Enter" });

    // Change the command base via the Type <select> → persist() from rows.
    const typeSelect = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: "citep" } });

    const last = emitted.at(-1)!;
    expect(last).toContain("smith");
    expect(last).toContain("jones");
    expect(last).toMatch(/\\citep/);
  });
});

// ── Task 181: the overflow menu on the `<Menu>` SSOT ───────────────────────
//
// It had been an `absolute right-0 top-full … z-50` surface with its own
// `document` mousedown closer, no Escape and no flip, inside a card body that
// scrolls in a panel list. The one behaviour worth pinning beyond the shared
// contracts is that these are TOGGLES the user flips in runs — the shell's
// `closeOnInsideClick` is opt-in and deliberately NOT set here, so the menu must
// survive repeated activation exactly as the two bare `<label>`s did.
describe("citation overflow menu — task 181", () => {
  it("survives a run of toggles and closes on Escape", async () => {
    const emitted: string[] = [];
    render(<Harness emitted={emitted} />);
    fireEvent.click(screen.getByLabelText("Expand card"));
    fireEvent.click(screen.getByLabelText("More options"));
    await settleMenu();

    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    // Portaled to body at the chrome tier, not an in-flow z-50 the panel list
    // clips when the card sits near the bottom.
    expect(menu.style.position).toBe("fixed");
    expect(menu.style.zIndex).toBe("2000");

    const starred = screen.getByRole("menuitemcheckbox", { name: /Full author list/i });
    const capitalized = screen.getByRole("menuitemcheckbox", { name: /Sentence start/i });
    expect(starred.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(starred);
    fireEvent.click(capitalized);
    // Still open after two toggles, and both states took.
    expect(document.body.querySelector('[role="menu"]')).toBeTruthy();
    expect(
      screen.getByRole("menuitemcheckbox", { name: /Full author list/i })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(emitted.at(-1)).toMatch(/\\Cite\*|\\cite\*/);

    // Escape dismisses — the key the hand-rolled popover ignored entirely.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });
});
