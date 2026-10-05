// @vitest-environment jsdom
//
// Task 956 — every Outline control is reachable by Tab and operable by
// Enter/Space.
//
// Before: the heading rows, paragraph-title rows, "Document start", the
// edit-mode rename text and the label edit/"+" triggers were click-only
// `<div>`/`<span>`s, while the rows' fold chevrons WERE buttons — so Tab
// walked a column of "Expand section" stops that could fold a section but
// never reach it. Now: text-only controls are `<button type="button">`; the
// heading row, which CONTAINS the chevron and label controls, spreads
// `activatableProps` (role + tab stop + Enter/Space, with the target guard
// that keeps a key on a nested control that control's).
//
// The static half — no panel may regress to a click-only div/span — is
// `role-button-census.test.ts` → "the click-only control".

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
import type { FocusBand } from "@/lib/focus-view";
import { setOutlinePrefs } from "../outline-prefs-store";

const CONTENT = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1, uuid: "h-one", label: "sec:one" }, content: [{ type: "text", text: "One" }] },
    { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "Body." }] },
    { type: "heading", attrs: { level: 2, uuid: "h-sub" }, content: [{ type: "text", text: "Sub" }] },
    { type: "paragraph", attrs: { uuid: "p2" }, content: [{ type: "text", text: "More." }] },
  ],
};

function mount(focusBand: FocusBand | null = null) {
  setOutlinePrefs({ showLabels: true });
  const spies = {
    onScrollTo: vi.fn(),
    onFocusMoveTo: vi.fn(),
    onFocusExpandTo: vi.fn(),
  };
  const noop = () => {};
  const props: OutlineHostProps = {
    content: CONTENT,
    docId: "doc-956",
    onReorderBlocks: noop,
    onRenameHeading: noop,
    onRenameParTitle: noop,
    onUpdateLabel: noop,
    isLabelTaken: () => false,
    activeSectionPath: [],
    activeParTitleIndex: null,
    focusBand,
    onFocusActivate: noop,
    onFocusDeactivate: noop,
    onFocusToggleLock: noop,
    onFocusSnapBoundary: noop,
    ...spies,
  };
  const utils = render(
    <EditorChromeProvider value={{ ...FULL_CHROME, mainTextEditable: true }}>
      <CollabProvider value={{ ...COLLAB_INERT, canEditMainText: true }}>
        <OutlineHost {...props} />
      </CollabProvider>
    </EditorChromeProvider>,
  );
  return { ...utils, ...spies };
}

const row = (root: HTMLElement, pos: string) =>
  root.querySelector<HTMLElement>(`[data-outline-pos="${pos}"]`)!;
const buttonNamed = (root: HTMLElement, name: string) =>
  Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === name) ?? null;

afterEach(cleanup);

describe("Outline rows are keyboard-operable (task 956)", () => {
  it("a heading row is a tab stop with the button role", () => {
    const { container } = mount();
    const h = row(container, "h-0");
    expect(h.tabIndex).toBe(0);
    expect(h.getAttribute("role")).toBe("button");
  });

  it("Enter and Space on a heading row scroll to it", () => {
    const { container, onScrollTo } = mount();
    const h = row(container, "h-0");
    fireEvent.keyDown(h, { key: "Enter" });
    expect(onScrollTo).toHaveBeenLastCalledWith({ uuid: "h-one", index: 0 });
    fireEvent.keyDown(row(container, "h-2"), { key: " " });
    expect(onScrollTo).toHaveBeenLastCalledWith({ uuid: "h-sub", index: 2 });
    expect(onScrollTo).toHaveBeenCalledTimes(2);
  });

  it("Enter on the fold chevron is the chevron's — the row does not also activate", () => {
    const { container, onScrollTo } = mount();
    const chevron = row(container, "h-0").querySelector("button[aria-label$='section']")!;
    expect(chevron).not.toBeNull();
    fireEvent.keyDown(chevron, { key: "Enter" });
    expect(onScrollTo).not.toHaveBeenCalled();
  });

  it("unlocked focus: Enter moves the band, Shift+Enter expands it to the row", () => {
    const band: FocusBand = { active: true, locked: false, startUuid: null, endUuid: null };
    const { container, onFocusMoveTo, onFocusExpandTo, onScrollTo } = mount(band);
    const h = row(container, "h-2");
    fireEvent.keyDown(h, { key: "Enter" });
    expect(onFocusMoveTo).toHaveBeenCalledWith({ uuid: "h-sub", index: 2 });
    fireEvent.keyDown(h, { key: "Enter", shiftKey: true });
    expect(onFocusExpandTo).toHaveBeenCalledWith({ uuid: "h-sub", index: 2 });
    expect(onScrollTo).not.toHaveBeenCalled();
  });

  it("\"Document start\" is a real button that scrolls to the top", () => {
    const { container, onScrollTo } = mount();
    const start = row(container, "docstart");
    expect(start.tagName).toBe("BUTTON");
    expect(start.getAttribute("type")).toBe("button");
    fireEvent.click(start);
    expect(onScrollTo).toHaveBeenCalledWith(null);
  });

  it("the label triggers are buttons, and the \"+\" reveals on focus-within", () => {
    const { container, onScrollTo } = mount();
    const edit = container.querySelector<HTMLElement>('[data-hint="Edit label"]')!;
    const add = container.querySelector<HTMLElement>('[data-hint="Add label"]')!;
    expect(edit.tagName).toBe("BUTTON");
    expect(add.tagName).toBe("BUTTON");
    expect(add.getAttribute("aria-label")).toBe("Add label");
    expect(add.className).toContain("group-focus-within:opacity-100");
    // A key on the nested control is that control's — the row stays put.
    fireEvent.keyDown(add, { key: "Enter" });
    fireEvent.click(add);
    expect(onScrollTo).not.toHaveBeenCalled();
    expect(container.querySelector('input[placeholder="label key"]')).not.toBeNull();
  });

  it("edit mode: the rename trigger is a button that opens the rename input", () => {
    const { container } = mount();
    fireEvent.click(buttonNamed(container, "Edit")!);
    const rename = buttonNamed(container, "One");
    expect(rename).not.toBeNull();
    expect(rename!.getAttribute("type")).toBe("button");
    fireEvent.click(rename!);
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("One");
  });
});
