// @vitest-environment jsdom
//
// Task 637 — a card's DELETE affordance is derived from the host write permit,
// not from the card component's memory.
//
// The defect: `READER_CHROME` permits exactly one sidecar (`notes.json`,
// derived from `READER_EDITABLE_CARD_KINDS`), and that permit reached the
// storage funnel but not the card's trash. `cardEditable` was threaded into the
// inner rich-text field ONLY, so a Library Reader footnote or citation card
// rendered a live trash button: pressing it moved React state, wrote nothing,
// said nothing, and had the footnote AND its card back on the next reload. The
// app accepted a destructive gesture it was never going to keep.
//
// What is pinned here is the derivation, on both card shells (`EditableCard`
// and the `PanelCard`-direct kinds) and on the keyboard path — because a card's
// delete is reachable three ways and gating one of them is how this happened.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

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

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  EditableCard,
  PanelCard,
  CARD_THEMES,
  usePanelCardTryDelete,
} from "@/components/panel-primitives";
import { EditorChromeProvider } from "@/components/editor-layout/chrome-context";
import {
  READER_CHROME,
  FULL_CHROME,
  isCardMutationAllowed,
} from "@/components/editor-layout/chrome-config";
import {
  CARD_KIND_SIDECAR,
  cardMutationWritable,
  READER_EDITABLE_CARD_KINDS,
} from "@/lib/host-writability";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";

afterEach(cleanup);

const TRASH = "Delete";

function renderEditable(kind: CardKind, chrome = READER_CHROME, onDelete = vi.fn()) {
  render(
    <EditorChromeProvider value={chrome}>
      <EditableCard
        id="c1"
        cardKind={kind}
        kind={kind}
        selected
        theme={CARD_THEMES.note}
        hideToolbar
        inlineDelete
        value={{ type: "doc", content: [] }}
        onChange={vi.fn()}
        onDelete={onDelete}
      />
    </EditorChromeProvider>,
  );
  return onDelete;
}

// ---------------------------------------------------------------------------
// 1. The derivation — one question, answered from the permit the funnel reads
// ---------------------------------------------------------------------------

describe("the permit a card delete is derived from", () => {
  it("is TOTAL over the kind union — a new card kind cannot skip the question", () => {
    for (const kind of Object.keys(CARD_REGISTRY) as CardKind[]) {
      expect(CARD_KIND_SIDECAR).toHaveProperty(kind);
    }
  });

  it("every kind whose sidecar the Reader refuses is un-deletable there", () => {
    // The three the defect was actually reported on, plus the twin families:
    // each has a real content sidecar, and none of them is `notes.json`.
    for (const kind of [
      "footnote", "citation", "example", "todo", "archive", "report",
      "report-request", "revision-comment", "revision-suggestion",
      "cutter-comment", "cutter-suggestion",
    ] as CardKind[]) {
      expect(isCardMutationAllowed(READER_CHROME, kind)).toBe(false);
    }
  });

  it("is NOT `kind ∈ editableCardKinds` — a Reader highlight's delete still lands", () => {
    // The case that proves the derivation has to go through the SIDECAR. A
    // highlight is not editable in the Reader (it has no body to edit), so a
    // `cardEditable` reuse would have hidden its trash — but it shares the
    // writable `notes.json` with `note`, so its delete genuinely persists and
    // must keep being offered. Hiding a control that works is the same defect
    // wearing the opposite sign.
    expect(READER_EDITABLE_CARD_KINDS.includes("highlight")).toBe(false);
    expect(isCardMutationAllowed(READER_CHROME, "highlight")).toBe(true);
    expect(isCardMutationAllowed(READER_CHROME, "note")).toBe(true);
  });

  it("a host with no whitelist (the whole main app) mutates every kind", () => {
    for (const kind of Object.keys(CARD_REGISTRY) as CardKind[]) {
      expect(isCardMutationAllowed(FULL_CHROME, kind)).toBe(true);
      expect(cardMutationWritable(undefined, kind)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The affordance — all three paths to a delete
// ---------------------------------------------------------------------------

describe("EditableCard under a host that refuses the kind's sidecar", () => {
  it("offers no trash on a footnote card in the Reader", () => {
    renderEditable("footnote");
    expect(screen.queryByLabelText(TRASH)).toBeNull();
  });

  it("offers the trash on a note card in the Reader — the one writable kind", () => {
    const onDelete = renderEditable("note");
    const btn = screen.getByLabelText(TRASH);
    fireEvent.click(btn);
    expect(onDelete).toHaveBeenCalled();
  });

  it("offers the trash on a footnote card in the MAIN app", () => {
    renderEditable("footnote", FULL_CHROME);
    expect(screen.getByLabelText(TRASH)).toBeTruthy();
  });

  it("the shell delete KEY is disarmed too, not just the button", () => {
    // The button is hidden, so the keyboard is the only remaining way in — and
    // a gate that stops at the render is a gate the keyboard walks around.
    const onDelete = renderEditable("footnote");
    const shell = document.querySelector<HTMLElement>("[data-card]")!;
    expect(shell).toBeTruthy();
    fireEvent.keyDown(shell, { key: "Backspace" });
    fireEvent.keyDown(shell, { key: "Delete" });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("… while the SAME key on a writable note card still deletes", () => {
    // The other half, so the leg above cannot pass by the key path being dead.
    const onDelete = renderEditable("note");
    const shell = document.querySelector<HTMLElement>("[data-card]")!;
    fireEvent.keyDown(shell, { key: "Backspace" });
    expect(onDelete).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. The `PanelCard`-direct kinds — citation + both twin suggestions
// ---------------------------------------------------------------------------

function DirectCard({ kind, onDelete }: { kind: CardKind; onDelete: (id: string) => void }) {
  const { tryDelete, dialog } = usePanelCardTryDelete(kind, {}, "d1", onDelete);
  return (
    <PanelCard
      theme={CARD_THEMES.citation}
      selected={false}
      kind={kind}
      onTrashClick={tryDelete}
    >
      <div />
      {dialog}
    </PanelCard>
  );
}

describe("PanelCard-direct cards inherit the same permit", () => {
  it("a citation card offers no trash in the Reader, and does in the main app", () => {
    // `CitationCard` renders via `PanelCard` directly, never through
    // `EditableCard` — which is exactly why the gate lives on `PanelCard`. A
    // fix that stopped at `EditableCard` would have left the second half of the
    // reported defect untouched.
    render(
      <EditorChromeProvider value={READER_CHROME}>
        <DirectCard kind="citation" onDelete={vi.fn()} />
      </EditorChromeProvider>,
    );
    expect(screen.queryByLabelText(TRASH)).toBeNull();
    cleanup();

    render(
      <EditorChromeProvider value={FULL_CHROME}>
        <DirectCard kind="citation" onDelete={vi.fn()} />
      </EditorChromeProvider>,
    );
    expect(screen.getByLabelText(TRASH)).toBeTruthy();
  });

  it("the shared try-delete executor refuses even when invoked directly", () => {
    // `usePanelCardTryDelete` is also what `useCardDeleteKey` arms for these
    // kinds — a path with no button to withhold.
    const onDelete = vi.fn();
    let fire: (() => void) | null = null;
    function Probe() {
      const { tryDelete } = usePanelCardTryDelete("cutter-suggestion", {}, "s1", onDelete);
      fire = tryDelete;
      return null;
    }
    render(
      <EditorChromeProvider value={READER_CHROME}>
        <Probe />
      </EditorChromeProvider>,
    );
    fire!();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
