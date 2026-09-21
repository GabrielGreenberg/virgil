// @vitest-environment jsdom
//
// TASK 686 — THE CARD OWNS ITS TIMERS' LIFETIME, AND UNMOUNT IS AN ENDING.
//
// The Code field commits on a 250 ms debounce. React dispatches no `blur` when
// a component goes away, and `blur` is the event every OTHER ending of this
// field rides — so an unmount with an open draft ended the session ZERO times
// while the orphaned timer still fired, writing the half-typed `\cite` into
// `citations.json` and the `.tex` atom with the session's `codeOriginalRef`
// (the only record of what it replaced) gone with the instance.
//
// Every leg counts WRITES (`onUpdateCitation` payloads), never the rendered
// box — the lesson of tasks 529 and 555, and the only thing that is still
// observable once the component is gone.

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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
const TYPED = "\\citet{xenakis2020}";

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

beforeEach(() => {
  cardStore.collapse({ kind: "citation", id: CIT.id });
  cardStore.clearSelection();
});

/** The card inside a parent that OWNS the command, as production does — the
 *  restore arm is unrepresentable against a frozen prop. */
function Harness({
  onWrite,
  entries = [ENTRY],
  initial = ORIGINAL,
  external,
}: {
  onWrite: (cmd: string) => void;
  entries?: BibEntry[];
  initial?: string;
  external?: (setCommand: (c: string) => void) => void;
}) {
  const [command, setCommand] = useState(initial);
  external?.(setCommand);
  return (
    <CitationCard
      citation={{ ...CIT, command, keys: CIT.keys }}
      isSelected={false}
      bibEntries={entries}
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

function openCode() {
  const onWrite = vi.fn<(cmd: string) => void>();
  const view = render(<Harness onWrite={onWrite} />);
  fireEvent.click(screen.getByLabelText("Expand card"));
  fireEvent.click(screen.getByLabelText("Edit raw LaTeX"));
  const input = screen.getByDisplayValue(ORIGINAL) as HTMLInputElement;
  input.focus();
  return { onWrite, input, unmount: view.unmount };
}

describe("Code field — UNMOUNT ends the session exactly once (task 686)", () => {
  it("unmounting mid-typing writes NOTHING, and the debounce cannot fire after", () => {
    vi.useFakeTimers();
    const { onWrite, input, unmount } = openCode();

    fireEvent.change(input, { target: { value: TYPED } });
    act(() => unmount());

    expect(onWrite).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(5000));
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("unmounting after a debounce LANDED restores the session's baseline", () => {
    vi.useFakeTimers();
    const { onWrite, input, unmount } = openCode();

    fireEvent.change(input, { target: { value: TYPED } });
    act(() => void vi.advanceTimersByTime(300));
    expect(onWrite.mock.calls.at(-1)![0]).toBe(TYPED);

    act(() => unmount());

    // The half-typed command does not get to be the document's truth.
    expect(onWrite.mock.calls.at(-1)![0]).toBe(ORIGINAL);
    act(() => void vi.advanceTimersByTime(5000));
    expect(onWrite.mock.calls.at(-1)![0]).toBe(ORIGINAL);
  });

  it("a session already ended by Escape is not ended a SECOND time", () => {
    vi.useFakeTimers();
    const { onWrite, input, unmount } = openCode();

    fireEvent.change(input, { target: { value: TYPED } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onWrite).not.toHaveBeenCalled();

    act(() => unmount());
    act(() => void vi.advanceTimersByTime(5000));
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("a session already ended by Enter keeps its ONE commit", () => {
    vi.useFakeTimers();
    const { onWrite, input, unmount } = openCode();

    fireEvent.change(input, { target: { value: TYPED } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite.mock.calls[0][0]).toBe(TYPED);

    act(() => unmount());
    act(() => void vi.advanceTimersByTime(5000));

    // Exactly once in the other direction too: the unmount must not revert a
    // commit the user deliberately made.
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("unmounting with NO open session writes nothing at all", () => {
    vi.useFakeTimers();
    const onWrite = vi.fn<(cmd: string) => void>();
    const view = render(<Harness onWrite={onWrite} />);
    fireEvent.click(screen.getByLabelText("Expand card"));
    act(() => view.unmount());
    act(() => void vi.advanceTimersByTime(5000));
    expect(onWrite).not.toHaveBeenCalled();
  });
});

describe("Code field — a cancel never undoes somebody ELSE (task 686)", () => {
  it("Escape leaves a FOREIGN write that arrived mid-session standing", () => {
    vi.useFakeTimers();
    const onWrite = vi.fn<(cmd: string) => void>();
    let setCommand!: (c: string) => void;
    render(
      <Harness onWrite={onWrite} external={(s) => (setCommand = s)} />,
    );
    fireEvent.click(screen.getByLabelText("Expand card"));
    fireEvent.click(screen.getByLabelText("Edit raw LaTeX"));
    const input = screen.getByDisplayValue(ORIGINAL) as HTMLInputElement;
    input.focus();

    fireEvent.change(input, { target: { value: TYPED } });

    // Someone else moves the command while the draft is open — a collaborator,
    // the code pane, an AI request landing on the same citation.
    const FOREIGN = "\\citealt{xenakis2020}";
    act(() => setCommand(FOREIGN));

    fireEvent.keyDown(input, { key: "Escape" });
    act(() => void vi.advanceTimersByTime(5000));

    // Pre-686 the cancel restored the session's OPENING command over the
    // newcomer — "undo what I just did" destroying what somebody else did.
    expect(onWrite).not.toHaveBeenCalled();
  });
});

describe("A row keeps its identity across a resync (task 686)", () => {
  it("an uncommitted +range survives a foreign command echo", () => {
    const onWrite = vi.fn<(cmd: string) => void>();
    let setCommand!: (c: string) => void;
    render(<Harness onWrite={onWrite} external={(s) => (setCommand = s)} />);
    fireEvent.click(screen.getByLabelText("Expand card"));

    // Open the row's "+range" and type without committing.
    fireEvent.click(screen.getByText("+range"));
    const range = screen.getByPlaceholderText("range") as HTMLInputElement;
    fireEvent.change(range, { target: { value: "p. 7" } });
    expect((screen.getByPlaceholderText("range") as HTMLInputElement).value).toBe("p. 7");

    // A foreign echo resyncs `rows`. Pre-686 `rowsFromCommand` minted a fresh
    // `row_N` on every parse, so the row REMOUNTED and the draft died with
    // neither commit nor cancel — an edit session ending ZERO times.
    act(() => setCommand("\\citealt{xenakis2020}"));

    expect((screen.getByPlaceholderText("range") as HTMLInputElement).value).toBe("p. 7");
  });
});

describe("census — the card arms no timer outside its lifetime", () => {
  it("no bare setTimeout / setInterval / requestAnimationFrame in CitationCard.tsx", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/panels/Citations/CitationCard.tsx"),
      "utf8",
    );
    const offenders: string[] = [];
    src.split("\n").forEach((line, i) => {
      // `lifetime.setTimeout(…)` and the `ReturnType<typeof setTimeout>` type
      // position are the sanctioned spellings; a BARE verb is not.
      const bare = /(^|[^.\w])(setTimeout|setInterval|requestAnimationFrame)\s*\(/.exec(line);
      if (!bare) return;
      if (/typeof\s+(setTimeout|setInterval)/.test(line)) return;
      offenders.push(`${i + 1}: ${line.trim()}`);
    });
    expect(
      offenders,
      "a card timer outside its ViewLifetime — arm it through `lifetime.*` (task 686)",
    ).toEqual([]);
  });
});
