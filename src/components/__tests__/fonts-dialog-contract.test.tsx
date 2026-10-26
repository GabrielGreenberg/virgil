// @vitest-environment jsdom
//
/**
 * Task 1304 — the Fonts… tool window keeps its pod CHROME (Gabriel's 2026-07-05
 * sanctioned-fork ruling, task 033) but owes the dialog BEHAVIOUR contract
 * every `SystemDialog` has: `role="dialog"` named by its title, Escape that
 * CANCELS it through the shared dialog stack (so with Preferences beside it one
 * press answers exactly one window), and focus given back on close.
 *
 * Pre-fix: no role, no name, and Escape did nothing at all. The FontPicker's
 * list had no Escape either, so the fix that taught the window Escape had to
 * teach the list too — or one press would close the window out from under an
 * open list.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import FontsDialog from "../FontsDialog";
import SystemDialog from "../system-dialog";
import FloatingPanel from "../FloatingPanel";
import { __resetDialogStack } from "../dialog-stack";
import { DEFAULT_PREFS } from "@/hooks/usePreferences";

afterEach(() => {
  cleanup();
  __resetDialogStack();
});

function Fonts({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <FontsDialog
      open={open}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
      prefs={DEFAULT_PREFS}
      onUpdate={() => {}}
    />
  );
}

const escape = () => fireEvent.keyDown(window, { key: "Escape" });

describe("Fonts… carries the dialog behaviour contract (task 1304)", () => {
  it("is a dialog labelled by its own title", () => {
    render(<Fonts onClose={() => {}} />);
    const dlg = screen.getByRole("dialog");
    const title = document.getElementById(dlg.getAttribute("aria-labelledby")!);
    expect(title?.textContent).toBe("Fonts");
    expect(screen.getByRole("dialog", { name: "Fonts" })).toBe(dlg);
  });

  it("DEFECT: Escape closes it", () => {
    const onClose = vi.fn();
    render(<Fonts onClose={onClose} />);
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("with Preferences open beneath, ONE Escape closes only Fonts; the next closes Preferences", () => {
    const onPrefsClose = vi.fn();
    const onFontsClose = vi.fn();
    render(
      <>
        <SystemDialog open variant="draggable" onClose={onPrefsClose}>
          <div>prefs</div>
        </SystemDialog>
        <Fonts onClose={onFontsClose} />
      </>,
    );
    escape();
    expect(onFontsClose).toHaveBeenCalledTimes(1);
    expect(onPrefsClose).not.toHaveBeenCalled();
    escape();
    expect(onPrefsClose).toHaveBeenCalledTimes(1);
    expect(onFontsClose).toHaveBeenCalledTimes(1);
  });

  it("the window the user is IN answers Escape, not the last-mounted one", () => {
    const onPrefsClose = vi.fn();
    const onFontsClose = vi.fn();
    render(
      <>
        <SystemDialog open variant="draggable" onClose={onPrefsClose}>
          <button data-testid="in-prefs">x</button>
        </SystemDialog>
        <Fonts onClose={onFontsClose} />
      </>,
    );
    screen.getByTestId("in-prefs").focus();
    fireEvent.keyDown(screen.getByTestId("in-prefs"), { key: "Escape" });
    expect(onPrefsClose).toHaveBeenCalledTimes(1);
    expect(onFontsClose).not.toHaveBeenCalled();
  });

  it("an open font list takes the first Escape; the window only the second", () => {
    const onClose = vi.fn();
    render(<Fonts onClose={onClose} />);
    // The first FontPicker trigger in the window (Editor body → Family).
    const picker = Array.from(
      screen.getByRole("dialog").querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.className.startsWith("w-full flex"))!;
    act(() => {
      (picker as HTMLButtonElement).click();
    });
    const search = screen.getByPlaceholderText("Search fonts…");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Search fonts…")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives focus back to whatever held it when it opened", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    render(<Fonts onClose={() => {}} />);
    // The user works in the window …
    const inside = screen.getByRole("dialog").querySelector("button")!;
    (inside as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(inside);
    // … and closes it with Escape: focus returns to where it was.
    escape();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe("the dialog contract is OPT-IN on FloatingPanel", () => {
  it("a float without `dialog` is not a dialog and ignores Escape", () => {
    const onChange = vi.fn();
    render(
      <FloatingPanel
        initialX={0}
        initialY={0}
        initialWidth={200}
        initialHeight={200}
        zIndex={1}
        onChange={onChange}
      >
        <div data-testid="card">card</div>
      </FloatingPanel>,
    );
    const root = screen.getByTestId("card").closest("[data-floating-panel]")!;
    expect(root.getAttribute("role")).toBeNull();
    escape();
    expect(screen.getByTestId("card")).toBeTruthy();
  });
});
