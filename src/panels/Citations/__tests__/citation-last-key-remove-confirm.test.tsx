// @vitest-environment jsdom
//
// TASK 683 — the per-key "×" on a citation's LAST key.
//
// `CARD_REGISTRY.citation` writes the obligation down in its own comment: a
// citation's content IS its cite keys, deleting them removes the in-text
// `\cite{}` atom, so a citation with keys must confirm (CI-F7-01). The docked
// trash read that declaration (`usePanelCardTryDelete`). The "×" one row above
// it did not — `removeRow` substituted an empty row, `persist` emitted `""`,
// and the EditorPane mirror's `??` let the empty string through as a real
// command. One click, no dialog, and the citation was gone from the user's
// prose, two inches from a trash that would have asked.
//
// Every leg here counts WRITES (`onUpdateCitation` payloads), not the rendered
// row: the destruction is the write, and a rendered assertion would pass on an
// implementation that had already blanked the document.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

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

import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { useState } from "react";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { cardHasContent } from "@/cards/has-content";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { BibEntry, CitationRef } from "@/lib/types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ONE_KEY = "\\citep{xenakis2020}";
const TWO_KEYS = "\\citep{xenakis2020,schaeffer1966}";
const CONFIRM_TEXT =
  "Removing the last key blanks this citation in the document. Remove it?";

const ENTRIES: BibEntry[] = [
  {
    uid: "uid-xen",
    key: "xenakis2020",
    type: "book",
    fields: { author: "Xenakis, Iannis", year: "2020", title: "Formalized Music" },
    raw: "@book{xenakis2020,...}",
  },
  {
    uid: "uid-sch",
    key: "schaeffer1966",
    type: "book",
    fields: { author: "Schaeffer, Pierre", year: "1966", title: "Traité" },
    raw: "@book{schaeffer1966,...}",
  },
];

const REF = { kind: "citation" as const, id: "cit1" };

function makeCitation(command: string, keys: string[]): CitationRef {
  return { id: "cit1", command, keys, createdAt: "2026-09-21T00:00:00.000Z" };
}

beforeEach(() => {
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

/** The card inside a parent that OWNS the command, as production does. */
function Harness({
  initial,
  keys,
  anchored,
  onWrite,
}: {
  initial: string;
  keys: string[];
  anchored: boolean;
  onWrite: (cmd: string) => void;
}) {
  const [command, setCommand] = useState(initial);
  // `keys` follows the command the store holds — that is the field the registry
  // declares as this kind's content, and the guard reads it.
  const [liveKeys, setKeys] = useState(keys);
  return (
    <CitationCard
      citation={makeCitation(command, liveKeys)}
      isSelected={false}
      bibEntries={ENTRIES}
      bibPackage="natbib"
      getDisplayText={() => "Xenakis 2020"}
      isAnchored={anchored}
      onSelect={() => {}}
      onJump={() => {}}
      onUpdateCitation={(_id, cmd) => {
        onWrite(cmd);
        setCommand(cmd);
        setKeys(cmd.match(/\{([^}]*)\}/)?.[1].split(",").filter(Boolean) ?? []);
      }}
    />
  );
}

function renderExpanded(
  initial: string,
  keys: string[],
  anchored = true,
): { onWrite: ReturnType<typeof vi.fn> } {
  const onWrite = vi.fn<(cmd: string) => void>();
  render(
    <Harness initial={initial} keys={keys} anchored={anchored} onWrite={onWrite} />,
  );
  fireEvent.click(screen.getByLabelText("Expand card"));
  return { onWrite };
}

function removeKeyButtons(): HTMLElement[] {
  return screen.getAllByLabelText("Remove this key");
}

describe("the LAST key of an ANCHORED citation confirms (task 683)", () => {
  it("the fixture really is content-bearing by the registry SSOT", () => {
    expect(cardHasContent("citation", makeCitation(ONE_KEY, ["xenakis2020"]))).toBe(true);
    expect(cardHasContent("citation", makeCitation("", []))).toBe(false);
  });

  it("clicking × opens the confirm and writes NOTHING", () => {
    const { onWrite } = renderExpanded(ONE_KEY, ["xenakis2020"]);
    fireEvent.click(removeKeyButtons()[0]);
    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("confirming writes the empty command (the user asked for it)", async () => {
    const { onWrite } = renderExpanded(ONE_KEY, ["xenakis2020"]);
    fireEvent.click(removeKeyButtons()[0]);
    fireEvent.click(screen.getByText("Remove", { selector: "button" }));
    await waitFor(() => expect(onWrite).toHaveBeenCalledWith(""));
  });

  it("cancelling leaves the command byte-identical AND the row on screen", async () => {
    const { onWrite } = renderExpanded(ONE_KEY, ["xenakis2020"]);
    fireEvent.click(removeKeyButtons()[0]);
    fireEvent.click(screen.getByText("Cancel", { selector: "button" }));
    await waitFor(() => expect(screen.queryByText(CONFIRM_TEXT)).toBeNull());
    expect(onWrite).not.toHaveBeenCalled();
    // The local row state moves with the write, so a declined gesture cannot
    // leave the card showing a removal it never performed.
    expect(removeKeyButtons()).toHaveLength(1);
    expect(screen.getByLabelText("Edit raw LaTeX").textContent).toContain(ONE_KEY);
  });
});

describe("the doors that must stay frictionless", () => {
  it("an UNANCHORED (parked) citation's last key removes with no confirm", () => {
    const { onWrite } = renderExpanded(ONE_KEY, ["xenakis2020"], false);
    fireEvent.click(removeKeyButtons()[0]);
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    expect(onWrite).toHaveBeenCalledWith("");
  });

  it("removing ONE of two keys never asks — content stays in the prose", () => {
    const { onWrite } = renderExpanded(TWO_KEYS, ["xenakis2020", "schaeffer1966"]);
    fireEvent.click(removeKeyButtons()[0]);
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    expect(onWrite).toHaveBeenCalledWith("\\citep{schaeffer1966}");
  });

  it("a citation that is ALREADY keyless removes its empty row with no confirm", () => {
    const { onWrite } = renderExpanded("", []);
    // The empty row still offers the ×; there is nothing in the prose to lose.
    const buttons = screen.queryAllByLabelText("Remove this row");
    if (buttons.length > 0) fireEvent.click(buttons[0]);
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    expect(onWrite).not.toHaveBeenCalled();
  });
});

describe("the Code field's own emptying doors (task 683)", () => {
  function openCode(initial: string, keys: string[]) {
    const { onWrite } = renderExpanded(initial, keys);
    fireEvent.click(screen.getByLabelText("Edit raw LaTeX"));
    const input = screen.getByDisplayValue(initial) as HTMLInputElement;
    input.focus();
    return { onWrite, input };
  }

  it("the 250 ms live-preview debounce NEVER blanks the atom mid-typing", () => {
    vi.useFakeTimers();
    const { onWrite, input } = openCode(ONE_KEY, ["xenakis2020"]);
    fireEvent.change(input, { target: { value: "" } });
    act(() => void vi.advanceTimersByTime(1000));
    // Pre-683 this wrote "" 250 ms after the last keystroke — no gesture, no
    // dialog, the editing session not even over.
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("COMMITTING an emptied Code field confirms, and cancelling writes nothing", async () => {
    const { onWrite, input } = openCode(ONE_KEY, ["xenakis2020"]);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    expect(onWrite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel", { selector: "button" }));
    await waitFor(() => expect(screen.queryByText(CONFIRM_TEXT)).toBeNull());
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("ESCAPE still cancels silently — a restore is measured against the session's own baseline", () => {
    vi.useFakeTimers();
    const { onWrite, input } = openCode(ONE_KEY, ["xenakis2020"]);
    fireEvent.change(input, { target: { value: "\\citet{xenakis2020}" } });
    act(() => void vi.advanceTimersByTime(300));
    expect(onWrite).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: "Escape" });
    // The restore puts back the command the session opened with. Asking the
    // user to confirm THEIR OWN undo would be the task-555 alias wearing a
    // dialog, so the guard is measured against the session baseline and stays
    // silent.
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    expect(onWrite.mock.calls.at(-1)![0]).toBe(ONE_KEY);
  });
});
