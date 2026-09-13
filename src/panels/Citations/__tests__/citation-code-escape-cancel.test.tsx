// @vitest-environment jsdom
//
// TASK 555 — ESCAPE MEANS CANCEL. The Code field (the raw-LaTeX editor on a
// citation card) aliased Escape to Enter: one branch, `commitCodeDraft`, so the
// key the user presses to ABANDON an edit was the key that saved it.
//
// Every leg here counts WRITES (`onUpdateCitation` calls and their payloads),
// never the rendered box — task 529's lesson, and doubly true here: `.blur()`
// dispatches `focusout` SYNCHRONOUSLY, so a rendered-value assertion passes on
// an implementation whose commit has already fired with the value being
// cancelled. The `+range` postnote's own 529 legs live one file over, in
// `citation-range-inline.test.tsx`.
//
// The parent is CONTROLLED (it feeds the written command back as the card's
// prop) because that is the real data flow, and because the cancel's restore
// arm is unrepresentable without it: with a frozen prop the card's
// `cit.command` never moves, so "an earlier debounced write already landed"
// cannot happen at all.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "mutateBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

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

import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { useState } from "react";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { BibEntry, CitationRef } from "@/lib/types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ORIGINAL = "\\citep{xenakis2020}";

const CIT: CitationRef = {
  id: "cit1",
  command: ORIGINAL,
  keys: ["xenakis2020"],
  createdAt: "2026-06-11T00:00:00.000Z",
};

const ENTRY: BibEntry = {
  uid: "uid-xen",
  key: "xenakis2020",
  type: "book",
  fields: { author: "Xenakis, Iannis", year: "2020", title: "Formalized Music" },
  raw: "@book{xenakis2020,...}",
};

const REF = { kind: "citation" as const, id: CIT.id };

beforeEach(() => {
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

/** The card inside a parent that OWNS the command, as production does. */
function Harness({ onWrite }: { onWrite: (cmd: string) => void }) {
  const [command, setCommand] = useState(ORIGINAL);
  return (
    <CitationCard
      citation={{ ...CIT, command }}
      isSelected={false}
      bibEntries={[ENTRY]}
      bibPackage="natbib"
      getDisplayText={() => "Xenakis 2020"}
      onSelect={() => {}}
      onJump={() => {}}
      onUpdateCitation={(_id, cmd) => {
        onWrite(cmd);
        setCommand(cmd);
      }}
    />
  );
}

/** Expand the card and open the Code input, focused as the real affordance
 *  leaves it (`autoFocus`; jsdom does not honour the attribute, and `.blur()`
 *  is inert on an unfocused element — so without this the mechanism under test
 *  cannot fire at all). */
function openCode() {
  const onWrite = vi.fn<(cmd: string) => void>();
  render(<Harness onWrite={onWrite} />);
  fireEvent.click(screen.getByLabelText("Expand card"));
  fireEvent.click(screen.getByLabelText("Edit raw LaTeX"));
  const input = screen.getByDisplayValue(ORIGINAL) as HTMLInputElement;
  input.focus();
  return { onWrite, input };
}

describe("Code field — Escape CANCELS (task 555)", () => {
  it("Escape before the debounce lands writes NOTHING", () => {
    vi.useFakeTimers();
    const { onWrite, input } = openCode();

    fireEvent.change(input, { target: { value: "\\citet{xenakis2020}" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onWrite).not.toHaveBeenCalled();

    // …and the dropped debounce cannot fire behind the cancel.
    act(() => void vi.advanceTimersByTime(1000));
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("Escape RESTORES a debounced write that already landed", () => {
    vi.useFakeTimers();
    const { onWrite, input } = openCode();

    fireEvent.change(input, { target: { value: "\\citet{xenakis2020}" } });
    act(() => void vi.advanceTimersByTime(300));
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite.mock.calls[0][0]).toBe("\\citet{xenakis2020}");

    fireEvent.keyDown(input, { key: "Escape" });

    // The LAST write is the command the session opened with.
    expect(onWrite.mock.calls.at(-1)![0]).toBe(ORIGINAL);
  });

  it("Escape closes the editor, showing the ORIGINAL command", () => {
    const { input } = openCode();
    fireEvent.change(input, { target: { value: "\\citet{xenakis2020}" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByDisplayValue("\\citet{xenakis2020}")).toBeNull();
    expect(screen.getByLabelText("Edit raw LaTeX").textContent).toContain(ORIGINAL);
  });

  it("the field is usable again right after a cancel", () => {
    const { onWrite, input } = openCode();
    fireEvent.change(input, { target: { value: "\\citet{xenakis2020}" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onWrite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Edit raw LaTeX"));
    const again = screen.getByDisplayValue(ORIGINAL) as HTMLInputElement;
    again.focus();
    fireEvent.change(again, { target: { value: "\\citealt{xenakis2020}" } });
    fireEvent.keyDown(again, { key: "Enter" });

    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite.mock.calls[0][0]).toBe("\\citealt{xenakis2020}");
  });
});

describe("Code field — the OTHER ending still commits, exactly once (task 529)", () => {
  it("Enter writes exactly ONCE", () => {
    const { onWrite, input } = openCode();
    fireEvent.change(input, { target: { value: "\\citet{xenakis2020}" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite.mock.calls[0][0]).toBe("\\citet{xenakis2020}");
  });

  it("blurring away still writes, once", () => {
    const { onWrite, input } = openCode();
    fireEvent.change(input, { target: { value: "\\citet{xenakis2020}" } });
    fireEvent.blur(input);

    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite.mock.calls[0][0]).toBe("\\citet{xenakis2020}");
  });
});
