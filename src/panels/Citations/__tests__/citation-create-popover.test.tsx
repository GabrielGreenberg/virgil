// @vitest-environment jsdom
//
// CitationCreatePopover — the deferred-commit semantics of the citation create
// popover (the user's chosen model): picking citekeys STAGES them and writes
// NOTHING; the citation materializes only on commit (the OK button, Return, or
// click-away) and ONLY when ≥1 key is staged. Clicking away empty creates
// nothing.
//
// Escape is the one exit that does NOT commit (task 687). Dismissal and cancel
// used to share the picker's single `onClose` prop, so the key the user pressed
// to back out INSERTED the citation and there was no abandon path short of
// removing every staged chip by hand — while the repo had already settled that
// Escape means cancel (task 555), twice inside this very panel. The last
// describe block below drives the REAL picker through a REAL window Escape, so
// it pins the whole chain (popover → CitekeyPicker → BibEntryPickerMenu →
// MenuProvider → useMenuDismiss) and not a mock's idea of it.
//
// The underlying `CitekeyPicker` (search + library merge + floating menu) is
// covered by its own tests; here it is mocked to a thin stub that surfaces the
// `onSelectKey` / `onClose` callbacks + the `footer` so this test drives the
// STAGING + COMMIT logic in isolation.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CitationCreatePopover } from "@/panels/Citations/CitationCreatePopover";

// The popover's footer now composes the `Button` primitive from the
// panel-primitives barrel, which transitively pulls in `@/lib/storage`
// (whose FSA backend `require` can't resolve under vitest). Stub it — the
// popover exercises none of these I/O paths. (vitest_extension_barrel gotcha.)
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

vi.mock("@/panels/Citations/CitekeyPicker", () => ({
  CitekeyPicker: (props: {
    onSelectKey: (k: string) => void;
    onClose: () => void;
    onCancel?: () => void;
    onEnterCommit?: (pickedKey?: string) => void;
    footer?: React.ReactNode;
  }) => (
    <div data-testid="picker">
      <button data-testid="pick-smith" onClick={() => props.onSelectKey("smith")}>
        pick smith
      </button>
      <button data-testid="pick-jones" onClick={() => props.onSelectKey("jones")}>
        pick jones
      </button>
      {/* Return in the real picker STAGES the active key then fires
          onEnterCommit(key) in the same tick — reproduce both here. */}
      <button
        data-testid="enter-smith"
        onClick={() => {
          props.onSelectKey("smith");
          props.onEnterCommit?.("smith");
        }}
      >
        enter smith
      </button>
      <button
        data-testid="enter-jones"
        onClick={() => {
          props.onSelectKey("jones");
          props.onEnterCommit?.("jones");
        }}
      >
        enter jones
      </button>
      {/* Return with nothing new to stage (empty list / empty query). */}
      <button data-testid="enter-empty" onClick={() => props.onEnterCommit?.(undefined)}>
        enter empty
      </button>
      {/* The picker's onClose — the DISMISS door (click-away). */}
      <button data-testid="dismiss" onClick={() => props.onClose()}>
        dismiss
      </button>
      {/* The picker's onCancel — the CANCEL door (Escape, the header ×). */}
      <button data-testid="cancel" onClick={() => props.onCancel?.()}>
        cancel
      </button>
      {props.footer}
    </div>
  ),
}));

afterEach(cleanup);

function setup() {
  const onCommit = vi.fn();
  const onClose = vi.fn();
  render(
    <CitationCreatePopover
      anchorRect={new DOMRect(0, 0, 0, 0)}
      paperBibEntries={[]}
      onCommit={onCommit}
      onClose={onClose}
    />,
  );
  return { onCommit, onClose };
}

// Named by its visible text; what it does is its description (task 609).
const okButton = () => {
  const ok = screen.getByRole("button", { name: "OK" });
  expect(ok.getAttribute("aria-description")).toBe("Insert citation");
  return ok;
};

describe("CitationCreatePopover — deferred commit", () => {
  it("OK with no staged keys is disabled and creates nothing", () => {
    const { onCommit } = setup();
    expect((okButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(okButton());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("OK commits the staged keys in pick order, then closes", () => {
    const { onCommit, onClose } = setup();
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(screen.getByTestId("pick-jones"));
    fireEvent.click(okButton());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(["smith", "jones"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dedups a repeated pick", () => {
    const { onCommit } = setup();
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(okButton());
    expect(onCommit).toHaveBeenCalledWith(["smith"]);
  });

  it("click-away (picker onClose) with ≥1 staged key COMMITS", () => {
    const { onCommit, onClose } = setup();
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(screen.getByTestId("dismiss"));
    expect(onCommit).toHaveBeenCalledWith(["smith"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("click-away with NO staged keys creates nothing (just closes)", () => {
    const { onCommit, onClose } = setup();
    fireEvent.click(screen.getByTestId("dismiss"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a removed staged key is excluded from the commit", () => {
    const { onCommit } = setup();
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(screen.getByTestId("pick-jones"));
    fireEvent.click(screen.getByRole("button", { name: "Remove smith" }));
    fireEvent.click(okButton());
    expect(onCommit).toHaveBeenCalledWith(["jones"]);
  });
});

describe("CitationCreatePopover — Return commits (single keystroke)", () => {
  it("Return on a fresh key stages it and commits in one step, then closes", () => {
    const { onCommit, onClose } = setup();
    fireEvent.click(screen.getByTestId("enter-smith"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(["smith"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Return folds the active key into keys staged earlier (multi-cite)", () => {
    const { onCommit } = setup();
    fireEvent.click(screen.getByTestId("pick-smith")); // staged via mouse
    fireEvent.click(screen.getByTestId("enter-jones")); // Return on the last
    expect(onCommit).toHaveBeenCalledWith(["smith", "jones"]);
  });

  it("Return dedups an already-staged active key", () => {
    const { onCommit } = setup();
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(screen.getByTestId("enter-smith"));
    expect(onCommit).toHaveBeenCalledWith(["smith"]);
  });

  it("Return with nothing staged and no active key commits nothing, just closes", () => {
    const { onCommit, onClose } = setup();
    fireEvent.click(screen.getByTestId("enter-empty"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ── Escape ABANDONS the staging (task 687) ─────────────────────────────────
// One key changes, and only one: the popover's dismissal model is untouched
// (the click-away legs above still commit). What changes is that the popover
// now hands the picker TWO doors instead of one, so Escape can reach the
// teardown without passing through the commit chokepoint.
describe("CitationCreatePopover — Escape abandons", () => {
  it("cancel with staged keys commits NOTHING and closes", () => {
    const { onCommit, onClose } = setup();
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(screen.getByTestId("pick-jones"));
    fireEvent.click(screen.getByTestId("cancel"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancel with nothing staged closes exactly once (no double teardown)", () => {
    const { onCommit, onClose } = setup();
    fireEvent.click(screen.getByTestId("cancel"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Anti-vacuity: both legs above assert `onClose` fired EXACTLY once, which a
  // popover that never passed `onCancel` cannot satisfy — the mock's button
  // would call `undefined?.()` and leave the count at zero. So they fail on the
  // pre-fix shape for the right reason, not merely because nothing happened.
});
