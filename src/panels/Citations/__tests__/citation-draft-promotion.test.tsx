// @vitest-environment jsdom
//
// Task 1512 — a draft citation becomes a real one only at a session ENDING,
// and only on an anchorable (keyed, parseable) command.
//
// Before: the Code field's coalesced live preview wrote whatever was typed
// (`inDocument` is false for a draft, so its guard waved everything through),
// and `CitationsPanel.handleDraftUpdate` promoted ANY non-empty command. Typing
// `\ci` and pausing planted an unparseable `\ci` atom in the prose and tore
// the field down mid-typing — no Enter, no blur, no Escape.
//
// Real panel + real card: the bug lives in the hand-off between them.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

// CitekeyPicker (mounted by a draft card) reaches the Library catalog store,
// which opens indexedDB on mount — absent in jsdom.
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
import { type ComponentProps } from "react";
import CitationsPanel from "@/panels/Citations/CitationsPanel";
import { CONTENT_WRITE_MAX_WAIT_MS } from "@/lib/sidecar-value";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type PanelProps = ComponentProps<typeof CitationsPanel>;

function draftPanel(overrides: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    citations: [],
    bibEntries: [],
    citationStyle: "apa",
    bibPackage: "natbib",
    selectedId: null,
    citationOrder: [],
    onSelect: vi.fn(),
    onScrollToMarker: vi.fn(),
    onUpdateCitation: vi.fn(),
    onDeleteCitation: vi.fn(),
    onSetStyle: vi.fn(),
    onSetBibPackage: vi.fn(),
    getDisplayText: (c: string) => c,
    pendingCreate: "",
    pendingCreateMode: "anchored",
    onCreateCitation: vi.fn(() => "new"),
    onInsertCitation: vi.fn(),
    onClearPendingCreate: vi.fn(),
    onStartCreate: vi.fn(),
    getFormattedBib: () => "",
    getAnnotation: () => "",
    setAnnotation: vi.fn(),
    onRequestReview: vi.fn(),
    onCancelReview: vi.fn(),
    getReviewStatus: () => "none",
    onSaveBibEntry: vi.fn(),
    onAddBibEntry: vi.fn(),
    ...overrides,
  };
  render(<CitationsPanel {...props} />);
  return props;
}

/** Open the draft's Code field ("no command yet") and focus it, as the real
 *  affordance's `autoFocus` leaves it. */
function codeInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("input.card-mono");
  if (!input) throw new Error("Code input not open");
  return input;
}

function openDraftCode(): HTMLInputElement {
  fireEvent.click(screen.getByLabelText("Edit raw LaTeX"));
  const input = codeInput();
  input.focus();
  return input;
}

const promoted = (p: PanelProps) =>
  (p.onCreateCitation as ReturnType<typeof vi.fn>).mock.calls.length +
  (p.onInsertCitation as ReturnType<typeof vi.fn>).mock.calls.length +
  (p.onClearPendingCreate as ReturnType<typeof vi.fn>).mock.calls.length;

describe("draft citation promotes on an ENDING only (task 1512)", () => {
  it("a half-typed `\\ci` past the coalescer's maxWait promotes NOTHING", () => {
    vi.useFakeTimers();
    const props = draftPanel();
    const input = openDraftCode();

    fireEvent.change(input, { target: { value: "\\c" } });
    act(() => void vi.advanceTimersByTime(200));
    fireEvent.change(input, { target: { value: "\\ci" } });
    act(() => void vi.advanceTimersByTime(CONTENT_WRITE_MAX_WAIT_MS + 500));

    expect(promoted(props)).toBe(0);
    // The field the user is typing in is still there.
    expect(screen.getByDisplayValue("\\ci")).toBeTruthy();
  });

  it("even a COMPLETE command is not promoted by the timer — the session must end", () => {
    vi.useFakeTimers();
    const props = draftPanel();
    const input = openDraftCode();

    fireEvent.change(input, { target: { value: "\\citep{xenakis2020}" } });
    act(() => void vi.advanceTimersByTime(CONTENT_WRITE_MAX_WAIT_MS + 500));
    expect(promoted(props)).toBe(0);
  });

  it("Enter on a keyed command promotes exactly once", () => {
    vi.useFakeTimers();
    const props = draftPanel();
    const input = openDraftCode();

    fireEvent.change(input, { target: { value: "\\citep{xenakis2020}" } });
    fireEvent.keyDown(input, { key: "Enter" });
    act(() => void vi.advanceTimersByTime(CONTENT_WRITE_MAX_WAIT_MS + 500));

    expect(props.onCreateCitation).toHaveBeenCalledTimes(1);
    expect(props.onCreateCitation).toHaveBeenCalledWith("\\citep{xenakis2020}");
    expect(props.onInsertCitation).toHaveBeenCalledTimes(1);
    expect(props.onClearPendingCreate).toHaveBeenCalledTimes(1);
  });

  it("Enter on an unparseable or keyless command promotes NOTHING", () => {
    vi.useFakeTimers();
    const props = draftPanel();
    let input = openDraftCode();
    fireEvent.change(input, { target: { value: "\\ci" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(promoted(props)).toBe(0);

    fireEvent.click(screen.getByLabelText("Edit raw LaTeX"));
    input = codeInput();
    input.focus();
    fireEvent.change(input, { target: { value: "\\cite{}" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(promoted(props)).toBe(0);
  });

  it("Escape promotes nothing, even after the coalescer's window", () => {
    vi.useFakeTimers();
    const props = draftPanel();
    const input = openDraftCode();

    fireEvent.change(input, { target: { value: "\\citep{xenakis2020}" } });
    act(() => void vi.advanceTimersByTime(CONTENT_WRITE_MAX_WAIT_MS + 500));
    fireEvent.keyDown(input, { key: "Escape" });
    act(() => void vi.advanceTimersByTime(1000));
    expect(promoted(props)).toBe(0);
  });

  it("picking a key from the draft's picker still promotes (a keyed command through `persist`)", () => {
    const props = draftPanel();
    const search = screen.getByPlaceholderText("Add from library…");
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "kripke1980" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(props.onCreateCitation).toHaveBeenCalledTimes(1);
    expect((props.onCreateCitation as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(
      /\\cite[a-z]*\{kripke1980\}/,
    );
    expect(props.onInsertCitation).toHaveBeenCalledTimes(1);
  });
});
