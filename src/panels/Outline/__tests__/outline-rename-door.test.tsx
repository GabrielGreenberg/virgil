// @vitest-environment jsdom
//
// Task 1532 — the Outline's edit-mode rename has an honest door:
//   1. a pod with no durable uuid offers no rename (the commit could not land
//      — the draft used to be discarded silently on Enter);
//   2. the commit hands on the SEED the box opened with, so the mutator can
//      replay the user's edit onto the live heading (rename-seed-rebase.test);
//   3. an empty heading's box opens EMPTY — its seed is the raw text, not the
//      "Untitled" placeholder the row displays.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

import { OutlineHost, type OutlineHostProps } from "@/components/editor-layout/panels/outline-host";
import { EditorChromeProvider } from "@/components/editor-layout/chrome-context";
import { FULL_CHROME } from "@/components/editor-layout/chrome-config";
import { CollabProvider, COLLAB_INERT } from "@/hooks/useCollab";

const CONTENT = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, uuid: "h1" }, content: [{ type: "text", text: "Intro" }] },
    { type: "paragraph", attrs: { uuid: "p1", parTitle: "Claim" }, content: [{ type: "text", text: "Body." }] },
    { type: "heading", attrs: { level: 2, uuid: null }, content: [{ type: "text", text: "Unaddressed" }] },
    { type: "heading", attrs: { level: 2, uuid: "h3" } },
  ],
};

const noop = () => {};

function mount(onRenameHeading: OutlineHostProps["onRenameHeading"], onRenameParTitle: OutlineHostProps["onRenameParTitle"] = noop) {
  const props: OutlineHostProps = {
    content: CONTENT,
    docId: "doc-1532",
    onScrollTo: noop,
    onReorderBlocks: noop,
    onRenameHeading,
    onRenameParTitle,
    onUpdateLabel: noop,
    isLabelTaken: () => false,
    activeSectionPath: [],
    activeParTitleIndex: null,
    focusBand: null,
    onFocusActivate: noop,
    onFocusDeactivate: noop,
    onFocusToggleLock: noop,
    onFocusMoveTo: noop,
    onFocusExpandTo: noop,
    onFocusSnapBoundary: noop,
  };
  const r = render(
    <EditorChromeProvider value={{ ...FULL_CHROME, mainTextEditable: true }}>
      <CollabProvider value={{ ...COLLAB_INERT, canEditMainText: true }}>
        <OutlineHost {...props} />
      </CollabProvider>
    </EditorChromeProvider>,
  );
  fireEvent.click(buttonNamed(r.container, "Edit")!);
  return r;
}

const buttonNamed = (root: HTMLElement, name: string) =>
  Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === name) ?? null;

afterEach(cleanup);

describe("Outline edit-mode rename door (task 1532)", () => {
  it("a uuid-less pod offers no rename: inert, with a hint", () => {
    const onRename = vi.fn();
    const { container } = mount(onRename);
    const row = buttonNamed(container, "Unaddressed")!;
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.getAttribute("data-hint")).toMatch(/can't rename/i);
    fireEvent.click(row);
    expect(container.querySelector("input")).toBeNull();
  });

  it("the commit carries the seed the box opened with", () => {
    const onRename = vi.fn();
    const { container } = mount(onRename);
    fireEvent.click(buttonNamed(container, "Intro")!);
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "An Intro" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("h1", "An Intro", "Intro");
  });

  it("a heading's draft is committed untrimmed (task 707's splice); a title's seed rides too", () => {
    const onRename = vi.fn();
    const onTitle = vi.fn();
    const { container } = mount(onRename, onTitle);
    fireEvent.click(buttonNamed(container, "Intro")!);
    let input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Intro " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("h1", "Intro ", "Intro");

    fireEvent.click(buttonNamed(container, "Claim")!);
    input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Main claim" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onTitle).toHaveBeenCalledWith("p1", "Main claim", "Claim");
  });

  it("Escape cancels; an empty heading opens empty (seed is not the placeholder)", () => {
    const onRename = vi.fn();
    const { container } = mount(onRename);
    fireEvent.click(buttonNamed(container, "Untitled")!);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "Named" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(container.querySelector("input")).toBeNull();
  });
});
