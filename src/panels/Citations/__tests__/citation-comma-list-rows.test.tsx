// @vitest-environment jsdom
//
// TASK 1144 — a comma list typed into a citation row is that many ROWS.
//
// Task 945 taught the raw commit to read `a,b` as two keys, but only for
// validation: the picker then handed the card the JOINED text and the card
// stored it as ONE row key. One red "not in your bibliography" row, the wrong
// singular/plural shape (one row counted), and — because the card's own echo
// never re-split it — a drop of `a` that missed the dedup and wrote
// `\cite{a,b,a}`. The picker now reports KEYS and the card makes one row each.
//
// Every leg drives the REAL card + REAL picker through the empty row's own
// input, and reads the WRITES (`onUpdateCitation` payloads) plus the rendered
// rows.

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

import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { useState } from "react";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { MIME_BIB_MERGE } from "@/lib/marginalia";
import type { CitationRef } from "@/lib/types";

afterEach(cleanup);

const REF = { kind: "citation" as const, id: "cit1" };

beforeEach(() => {
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

/** The card inside a parent that OWNS the command, as production does — so
 *  the card's own write comes back to it as the echo it must recognise. */
function Harness({ onWrite }: { onWrite: (cmd: string) => void }) {
  const [command, setCommand] = useState("");
  const citation: CitationRef = {
    id: "cit1",
    command,
    keys: [],
    createdAt: "2026-10-16T00:00:00.000Z",
  };
  return (
    <CitationCard
      onAddBibEntry={null}
      citation={citation}
      isDraft
      isSelected={false}
      bibEntries={[]}
      bibPackage="biblatex"
      getDisplayText={() => ""}
      onSelect={() => {}}
      onJump={() => {}}
      onUpdateCitation={(_id, cmd) => {
        onWrite(cmd);
        setCommand(cmd);
      }}
    />
  );
}

function setup() {
  const writes: string[] = [];
  const { container } = render(<Harness onWrite={(c) => writes.push(c)} />);
  const typeAndEnter = (text: string) => {
    const input = screen.getByPlaceholderText("Add from library…") as HTMLInputElement;
    act(() => {
      fireEvent.focus(input);
    });
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
  };
  const cardEl = () => container.querySelector("[data-card]") as HTMLElement;
  return { writes, typeAndEnter, cardEl };
}

const mergeDrop = (bibKey: string) =>
  ({
    types: [MIME_BIB_MERGE],
    getData: (t: string) => (t === MIME_BIB_MERGE ? JSON.stringify({ bibKey }) : ""),
    setData: () => {},
    dropEffect: "",
    effectAllowed: "",
  }) as unknown as DataTransfer;

describe("task 1144 — a typed comma list becomes one row per key", () => {
  it("`a,b` + Enter on the empty row writes two keys, not one joined key", () => {
    const { writes, typeAndEnter } = setup();
    typeAndEnter("smith2001, jones2003");
    // Two ROWS, so the shape follows the package: under biblatex two keyed
    // rows promote to the plural `\\cites` (T6-C16). One joined row stayed
    // `\\cite{smith2001,jones2003}` — the singular a single key gets.
    expect(writes.at(-1)).toBe("\\cites{smith2001}{jones2003}");
    // One "not in your bibliography" row per key — never one for the list.
    expect(screen.queryByText(/smith2001,\s*jones2003/)).toBeNull();
    expect(screen.getAllByText("smith2001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("jones2003").length).toBeGreaterThan(0);
  });

  it("dropping a key the list already put on the card does not duplicate it", () => {
    const { writes, typeAndEnter, cardEl } = setup();
    typeAndEnter("smith2001,jones2003");
    const before = writes.length;
    fireEvent.drop(cardEl(), { dataTransfer: mergeDrop("smith2001") });
    expect(writes.length).toBe(before);
    expect(writes.at(-1)).toBe("\\cites{smith2001}{jones2003}");
  });

  it("a repeated key inside the list lands once", () => {
    const { writes, typeAndEnter } = setup();
    typeAndEnter("smith2001,smith2001,jones2003");
    expect(writes.at(-1)).toBe("\\cites{smith2001}{jones2003}");
  });
});
