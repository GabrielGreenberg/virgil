// @vitest-environment jsdom
//
// Task 1657 — the AI window composer has ONE submit door.
//
// Two defects, one root: there was no single "can this submit, and did it
// land?" door.
//   1. `submitComposer` ignored `requestBibReview`'s verdict (the prop was typed
//      `=> void`) and cleared text + key on the click — a refused write rolled
//      the row back AND lost the user's typed notes (task 1158's rule, which
//      BibEntryCard already honoured). And `requestReview` answered `ok` on an
//      already-pending row while DROPPING the new notes.
//   2. ⌘/Ctrl+Enter called `submitComposer` directly, skipping the Submit
//      button's empty-text gate: an empty "Footnote request" filed an empty
//      draft row.
//
// The contract now: one `composerCanSubmit` predicate read by the button AND
// the door; the draft is cleared only once the write says `ok`; a refusal keeps
// text + key and shows the reason; new notes on a pending row are merged.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { render, screen, cleanup, fireEvent, renderHook, act, waitFor } from "@testing-library/react";
import AIWindow, {
  composerCanSubmit,
  LINKED_CARD_UNKNOWN,
  type AIRequestKind,
  type AIWindowProps,
} from "@/components/AIWindow";
import { useBibReview } from "@/hooks/useBibReview";
import type { AiRequest } from "@/lib/types";

afterEach(cleanup);

function props(over: Partial<AIWindowProps> = {}): AIWindowProps {
  const noop = () => undefined;
  return {
    open: true,
    onClose: noop,
    bibReviewRequests: [],
    bibEntryRequests: [],
    comments: [],
    bibEntries: [],
    panelAiRequests: [],
    panelAiRequestsLoaded: true,
    panelAiRequestsLoadError: false,
    addPanelAiRequest: (() => ({}) as AiRequest) as AIWindowProps["addPanelAiRequest"],
    withdrawPanelAiRequest: noop,
    clearLinkedAiRequest: noop,
    resolveLinkedCard: () => LINKED_CARD_UNKNOWN,
    requestBibReview: () => ({ ok: true }),
    cancelBibReview: noop,
    addEntryRequest: noop,
    removeEntryRequest: noop,
    addComment: noop,
    refreshAll: noop,
    ...over,
  };
}

function openComposer(kind: AIRequestKind) {
  fireEvent.click(screen.getByText("New request"));
  const select = document.querySelector("select") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: kind } });
}
const textarea = () => document.querySelector("textarea") as HTMLTextAreaElement | null;
const keyInput = () =>
  document.querySelector('input[placeholder="e.g. smith2020"]') as HTMLInputElement | null;
const submitButton = () => screen.getByText("Submit").closest("button") as HTMLButtonElement;
const cmdEnter = (el: HTMLElement) =>
  fireEvent.keyDown(el, { key: "Enter", metaKey: true, ctrlKey: true });

describe("a refused bib-review write keeps the draft", () => {
  it("keeps text + key and shows the reason", async () => {
    const requestBibReview = vi.fn(async () => ({
      ok: false as const,
      reason: "Not sent — review requests can't be saved for a library paper.",
    }));
    render(<AIWindow {...props({ requestBibReview })} />);
    openComposer("bib-notes");
    fireEvent.change(keyInput()!, { target: { value: "smith2020" } });
    fireEvent.change(textarea()!, { target: { value: "check the page range" } });
    fireEvent.click(submitButton());
    expect(requestBibReview).toHaveBeenCalledWith("smith2020", "notes", "check the page range");
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Not sent — review requests can't be saved for a library paper.",
    );
    expect(textarea()!.value).toBe("check the page range");
    expect(keyInput()!.value).toBe("smith2020");
  });

  it("a write that REJECTS is a refusal too", async () => {
    const requestBibReview = vi.fn(async () => {
      throw new Error("disk full");
    });
    render(<AIWindow {...props({ requestBibReview })} />);
    openComposer("bib-fields");
    fireEvent.change(keyInput()!, { target: { value: "smith2020" } });
    fireEvent.click(submitButton());
    expect((await screen.findByRole("alert")).textContent).toMatch(/disk full/);
    expect(keyInput()!.value).toBe("smith2020");
  });

  it("an ok write clears and closes", async () => {
    const requestBibReview = vi.fn(async () => ({ ok: true as const }));
    render(<AIWindow {...props({ requestBibReview })} />);
    openComposer("bib-notes");
    fireEvent.change(keyInput()!, { target: { value: "smith2020" } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(textarea()).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("⌘Enter goes through the button's gate", () => {
  it("an empty panel-kind composer calls no mutator", async () => {
    const addPanelAiRequest = vi.fn(() => ({}) as AiRequest);
    render(<AIWindow {...props({ addPanelAiRequest })} />);
    openComposer("panel-footnote");
    expect(submitButton().disabled).toBe(true);
    cmdEnter(textarea()!);
    fireEvent.change(textarea()!, { target: { value: "   " } });
    cmdEnter(textarea()!);
    await Promise.resolve();
    expect(addPanelAiRequest).not.toHaveBeenCalled();
    expect(textarea()).not.toBeNull();
  });

  it("a non-empty panel-kind composer submits on ⌘Enter", async () => {
    const addPanelAiRequest = vi.fn(() => ({}) as AiRequest);
    render(<AIWindow {...props({ addPanelAiRequest })} />);
    openComposer("panel-citation");
    fireEvent.change(textarea()!, { target: { value: "find the Frege source" } });
    cmdEnter(textarea()!);
    expect(addPanelAiRequest).toHaveBeenCalledWith("citation", "find the Frege source");
    await waitFor(() => expect(textarea()).toBeNull());
  });
});

describe("one validity predicate for every composer kind", () => {
  const KINDS: AIRequestKind[] = [
    "revision-general",
    "bib-entry",
    "bib-fields",
    "bib-notes",
    "panel-footnote",
    "panel-citation",
  ];
  const CASES: Array<[string, string]> = [
    ["", ""],
    ["some text", ""],
    ["", "smith2020"],
    ["some text", "smith2020"],
  ];
  it.each(KINDS)("%s — the button's disabled state is !composerCanSubmit", (kind) => {
    render(<AIWindow {...props()} />);
    openComposer(kind);
    for (const [text, key] of CASES) {
      fireEvent.change(textarea()!, { target: { value: text } });
      if (keyInput()) fireEvent.change(keyInput()!, { target: { value: key } });
      const effectiveKey = keyInput() ? key : "";
      expect(submitButton().disabled).toBe(!composerCanSubmit(kind, text, effectiveKey));
    }
  });

  it("bib-review kinds need a key; every other kind needs text", () => {
    expect(composerCanSubmit("bib-notes", "notes only", "")).toBe(false);
    expect(composerCanSubmit("bib-notes", "", "k")).toBe(true);
    expect(composerCanSubmit("panel-footnote", "", "k")).toBe(false);
    expect(composerCanSubmit("revision-general", "  ", "")).toBe(false);
  });
});

describe("useBibReview merges new notes into an already-pending row", () => {
  it("a second request with new notes updates the pending row", () => {
    const { result } = renderHook(() => useBibReview(null));
    act(() => { void result.current.requestReview("foo2020", "notes", "first ask"); });
    act(() => { void result.current.requestReview("foo2020", "notes", "the latest ask"); });
    const rows = result.current.requests.filter((r) => r.bibKey === "foo2020");
    expect(rows).toHaveLength(1);
    expect(rows[0].requestNotes).toBe("the latest ask");
    expect(rows[0].status).toBe("pending");
  });

  it("a second request with no notes leaves the pending row's notes alone", () => {
    const { result } = renderHook(() => useBibReview(null));
    act(() => { void result.current.requestReview("foo2020", "fields", "keep me"); });
    act(() => { void result.current.requestReview("foo2020", "fields"); });
    expect(result.current.getRequestNotes("foo2020", "fields")).toBe("keep me");
  });
});
