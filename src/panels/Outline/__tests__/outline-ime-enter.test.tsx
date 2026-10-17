// @vitest-environment jsdom
//
// Task 1165 — the Outline's inline fields do not commit on the IME's Enter.
//
// With a Japanese/Chinese/Korean input method, the Enter that accepts a
// candidate arrives as a keydown with `isComposing: true` (or Safari's
// `keyCode: 229`). The rename and label inputs used to commit on ANY Enter —
// writing the pre-conversion text into the document. They now ask
// `isCommitEnter`; only a user's Enter commits.
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
import { setOutlinePrefs } from "../outline-prefs-store";

const CONTENT = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, uuid: "h1", label: "sec:one" }, content: [{ type: "text", text: "One" }] },
    { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "Body." }] },
  ],
};

const noop = () => {};

function mount(onRenameHeading: OutlineHostProps["onRenameHeading"], onUpdateLabel: OutlineHostProps["onUpdateLabel"]) {
  setOutlinePrefs({ showLabels: true });
  const props: OutlineHostProps = {
    content: CONTENT,
    docId: "doc-1165",
    onScrollTo: noop,
    onReorderBlocks: noop,
    onRenameHeading,
    onRenameParTitle: noop,
    onUpdateLabel,
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
  return render(
    <EditorChromeProvider value={{ ...FULL_CHROME, mainTextEditable: true }}>
      <CollabProvider value={{ ...COLLAB_INERT, canEditMainText: true }}>
        <OutlineHost {...props} />
      </CollabProvider>
    </EditorChromeProvider>,
  );
}

const buttonNamed = (root: HTMLElement, name: string) =>
  Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === name) ?? null;

afterEach(cleanup);

describe("Outline inline fields ignore the IME's Enter (task 1165)", () => {
  it("heading rename: composing Enter and the 229 marker do not commit; a plain Enter does", () => {
    const onRename = vi.fn();
    const { container } = mount(onRename, noop);
    fireEvent.click(buttonNamed(container, "Edit")!);
    fireEvent.click(buttonNamed(container, "One")!);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "見出し" } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onRename).not.toHaveBeenCalled();
    expect(container.querySelector("input")).toBe(input); // still editing

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("heading label: composing Enter does not commit; a plain Enter does", () => {
    const onLabel = vi.fn();
    const { container } = mount(noop, onLabel);
    fireEvent.click(container.querySelector('[data-hint="Edit label"]')!);
    const input = container.querySelector('input[placeholder="label key"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "sec:二" } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onLabel).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onLabel).toHaveBeenCalled();
  });
});
