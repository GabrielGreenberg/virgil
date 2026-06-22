// @vitest-environment jsdom
//
// CitationCreatePopover — the deferred-commit semantics of the citation create
// popover (the user's chosen model): picking citekeys STAGES them and writes
// NOTHING; the citation materializes only on commit (OK button, or click-away /
// Escape) and ONLY when ≥1 key is staged. Clicking away empty creates nothing.
//
// The underlying `CitekeyPicker` (search + library merge + floating menu) is
// covered by its own tests; here it is mocked to a thin stub that surfaces the
// `onSelectKey` / `onClose` callbacks + the `footer` so this test drives the
// STAGING + COMMIT logic in isolation.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CitationCreatePopover } from "@/panels/Citations/CitationCreatePopover";

vi.mock("@/panels/Citations/CitekeyPicker", () => ({
  CitekeyPicker: (props: {
    onSelectKey: (k: string) => void;
    onClose: () => void;
    footer?: React.ReactNode;
  }) => (
    <div data-testid="picker">
      <button data-testid="pick-smith" onClick={() => props.onSelectKey("smith")}>
        pick smith
      </button>
      <button data-testid="pick-jones" onClick={() => props.onSelectKey("jones")}>
        pick jones
      </button>
      {/* The picker's onClose — what click-away / Escape route through. */}
      <button data-testid="dismiss" onClick={() => props.onClose()}>
        dismiss
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

const okButton = () => screen.getByRole("button", { name: "Insert citation" });

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
