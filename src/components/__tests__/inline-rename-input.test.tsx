// @vitest-environment jsdom
/**
 * TASK 1013 — the one inline-rename field ends its edit exactly once, through
 * the session door, and states the commit rule once.
 *
 * A blur is driven explicitly AFTER the key: that is the hazard (a blur that
 * reaches `onBlur` after Escape/Enter — e.g. if an exit animation ever delays
 * the unmount). No owner unmounts the field here, so the late blur is real.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, cleanup, fireEvent } from "@testing-library/react";
import {
  InlineRenameInput,
  normalizeRename,
} from "@/components/InlineRenameInput";

afterEach(cleanup);

function setup(initialValue = "Old", emptyValue?: string) {
  const onRename = vi.fn();
  const onClose = vi.fn();
  const { getByRole } = render(
    <InlineRenameInput
      initialValue={initialValue}
      emptyValue={emptyValue}
      onRename={onRename}
      onClose={onClose}
    />,
  );
  const input = getByRole("textbox") as HTMLInputElement;
  return { input, onRename, onClose };
}

describe("InlineRenameInput — an edit ends exactly once", () => {
  it("focuses and selects on mount", () => {
    const { input } = setup("Name");
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(4);
  });

  it("Escape then blur → no rename, closed once", () => {
    const { input, onRename, onClose } = setup();
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape's own blur never commits (the door's window)", () => {
    const { input, onRename, onClose } = setup();
    fireEvent.change(input, { target: { value: "New" } });
    // The real browser path: `session.cancel` calls `el.blur()`, which
    // dispatches focusout synchronously INSIDE the keydown.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.activeElement).not.toBe(input);
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter then blur → renamed exactly once", () => {
    const { input, onRename, onClose } = setup();
    fireEvent.change(input, { target: { value: "  New  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("New");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blur alone → renamed once", () => {
    const { input, onRename, onClose } = setup();
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.blur(input);
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("New");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an unchanged name closes without a rename", () => {
    const { input, onRename, onClose } = setup("Same");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicks inside the box do not reach the row/tab underneath", () => {
    const onRowClick = vi.fn();
    const onRowDouble = vi.fn();
    const { getByRole } = render(
      <div onClick={onRowClick} onDoubleClick={onRowDouble}>
        <InlineRenameInput initialValue="x" onRename={() => {}} onClose={() => {}} />
      </div>,
    );
    const input = getByRole("textbox");
    fireEvent.click(input);
    fireEvent.doubleClick(input);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowDouble).not.toHaveBeenCalled();
  });
});

describe("normalizeRename — the commit rule, once", () => {
  it("trims, maps empty to the owner's emptyValue, and skips no-ops", () => {
    expect(normalizeRename("  A ", "B")).toBe("A");
    expect(normalizeRename("   ", "B")).toBeNull(); // editor: empty = no rename
    expect(normalizeRename("   ", "B", "Untitled")).toBe("Untitled"); // Library
    expect(normalizeRename("", "Untitled", "Untitled")).toBeNull();
    expect(normalizeRename("B", "B")).toBeNull();
  });
});

describe("the three rename surfaces render the one field", () => {
  const REPO = path.resolve(__dirname, "../../..");
  it.each([
    "src/components/editor-layout/TabStrip.tsx",
    "library/components/panel-tabs/PanelTabStrip.tsx",
    "library/components/LibrariesNavigator.tsx",
  ])("%s", (rel) => {
    const src = readFileSync(path.join(REPO, rel), "utf8");
    expect(src).toMatch(/<InlineRenameInput\b/);
    // No hand-rolled twin left behind beside it.
    expect(src).not.toMatch(/function (?:Row|Tab)TitleInput\b/);
    expect(src).not.toMatch(/onBlur=\{commit/);
  });
});
