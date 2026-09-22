// @vitest-environment jsdom
//
// Task 710 — the Outline offers no control whose action would be discarded.
//
// `OutlinePanel` renders each mutation control only when its handler is
// PRESENT. The Library Reader satisfies `EditorMutationHandlers` in full with
// no-ops, so presence was always true there: the Reader's Outline showed a live
// Edit button (drag / rename → silently reverted), a label "+" whose input
// discarded what was typed, and a Focus button that did nothing. The gate is
// now a CAPABILITY read at the one mount (`OutlineHost`): the host's
// `mainTextEditable` (EditorPane injects its `editable` prop into the chrome
// context) and the collab pen (`canEditMainText`).
//
// Contracts pinned:
//   1. Reader profile (editable=false, full no-op handler set) → no Edit, no
//      Focus, no label "+"; an existing label is still SHOWN, read-only.
//   2. Editor profile (editable, pen held) → Edit, Focus and "+" all render.
//   3. Pen held elsewhere → structure edits (Edit, "+") withheld; Focus stays.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

import { OutlineHost, outlineCapabilities, type OutlineHostProps } from "@/components/editor-layout/panels/outline-host";
import { EditorChromeProvider } from "@/components/editor-layout/chrome-context";
import { FULL_CHROME, READER_CHROME } from "@/components/editor-layout/chrome-config";
import { CollabProvider, COLLAB_INERT } from "@/hooks/useCollab";
import { setOutlinePrefs } from "../outline-prefs-store";

const CONTENT = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, uuid: "h-labelled", label: "sec:one" }, content: [{ type: "text", text: "One" }] },
    { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "Body." }] },
    { type: "heading", attrs: { level: 2, uuid: "h-bare" }, content: [{ type: "text", text: "Two" }] },
    { type: "paragraph", attrs: { uuid: "p2" }, content: [{ type: "text", text: "More." }] },
  ],
};

const noop = () => {};
// The FULL handler set — exactly the Reader's shape: every one present.
const HANDLERS: OutlineHostProps = {
  content: CONTENT,
  docId: "doc-710",
  onScrollTo: noop,
  onReorderBlocks: noop,
  onRenameHeading: noop,
  onRenameParTitle: noop,
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

function mount(editable: boolean, canEditMainText: boolean) {
  setOutlinePrefs({ showLabels: true });
  const chrome = editable ? FULL_CHROME : READER_CHROME;
  return render(
    <EditorChromeProvider value={{ ...chrome, mainTextEditable: editable }}>
      <CollabProvider value={{ ...COLLAB_INERT, canEditMainText }}>
        <OutlineHost {...HANDLERS} />
      </CollabProvider>
    </EditorChromeProvider>,
  );
}

const buttonNamed = (root: HTMLElement, name: string) =>
  Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === name) ?? null;
const addLabel = (root: HTMLElement) => root.querySelector('[data-hint="Add label"]');
const editLabel = (root: HTMLElement) => root.querySelector('[data-hint="Edit label"]');

afterEach(cleanup);

describe("OutlineHost capabilities (task 710)", () => {
  it("Reader profile: no Edit, no Focus, no label +; labels still shown read-only", () => {
    const { container } = mount(false, true);
    expect(buttonNamed(container, "Edit")).toBeNull();
    expect(buttonNamed(container, "Focus")).toBeNull();
    expect(addLabel(container)).toBeNull();
    expect(editLabel(container)).toBeNull();
    expect(container.textContent).toContain("sec:one");
  });

  it("Editor profile: Edit, Focus and the label controls render", () => {
    const { container } = mount(true, true);
    expect(buttonNamed(container, "Edit")).not.toBeNull();
    expect(buttonNamed(container, "Focus")).not.toBeNull();
    expect(addLabel(container)).not.toBeNull();
    expect(editLabel(container)).not.toBeNull();
  });

  it("pen held elsewhere: structure edits withheld, Focus stays", () => {
    const { container } = mount(true, false);
    expect(buttonNamed(container, "Edit")).toBeNull();
    expect(addLabel(container)).toBeNull();
    expect(buttonNamed(container, "Focus")).not.toBeNull();
    expect(container.textContent).toContain("sec:one");
  });

  it("outlineCapabilities is the one derivation", () => {
    expect(outlineCapabilities(false, true)).toEqual({ structure: false, focus: false });
    expect(outlineCapabilities(true, false)).toEqual({ structure: false, focus: true });
    expect(outlineCapabilities(true, true)).toEqual({ structure: true, focus: true });
  });
});
