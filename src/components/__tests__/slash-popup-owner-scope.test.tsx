// @vitest-environment jsdom
//
// Task 750 — the slash popup's state is OWNED BY ITS EDITOR, never one module
// slot ("per-doc services under multi-pane keep-alive").
//
// THE BUG THIS PINS. `slash-popup-store.ts` held ONE module-level `_state`,
// written by every editor's `SlashPopupExtension` and read — with no owner
// check — by the `<SlashCommandPopup>` every `VirgilEditor` mounts. Under
// multi-doc keep-alive (N panes mounted, the hidden ones `display:none`),
// typing `\` in the visible doc opened the popup in EVERY pane, and each hidden
// pane portalled a dead copy of it to the window's top-left corner.
//
// WHAT IS PROVEN (two REAL editors on the REAL `buildEditorExtensions("main")`
// stack, the shipped `handleTextInput` prop, the shipped component):
//   1. Opening A's popup leaves B's store entry CLOSED, and B's
//      `<SlashCommandPopup>` renders nothing while A's renders the rows.
//   2. Destroying B while A's popup is open does not close A's.
//   3. The plugin's `apply` publishes nothing: a `state.apply` dry run that
//      opens the popup in a detached state leaves the store untouched.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { slashPopupKey } from "@/lib/tiptap/slash-popup";
import { slashPopupStore } from "@/lib/slash-popup-store";
import { SlashCommandPopup } from "@/components/SlashCommandPopup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

const editors: Editor[] = [];
const roots: Root[] = [];
afterEach(() => {
  act(() => {
    for (const r of roots.splice(0)) r.unmount();
  });
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy();
  document.body.innerHTML = "";
});

function mount(uuid: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid },
          content: [{ type: "text", text: "alpha beta" }],
        },
      ],
    },
  });
  editors.push(ed);
  return ed;
}

/** Caret at the end of the paragraph, then a lone `\` through the shipped prop. */
function openPopup(ed: Editor): void {
  const pos = ed.state.doc.firstChild!.nodeSize - 1;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
  ed.view.someProp("handleTextInput", (f) => f(ed.view, pos, pos, "\\", () => ed.state.tr));
  ed.commands.insertContentAt(pos, "\\");
}

function renderPopup(ed: Editor): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(<SlashCommandPopup editor={ed as unknown as ReactEditor} />);
  });
}

const popups = () => document.querySelectorAll(".slash-command-popup");

describe("slash popup state is owned by its editor (task 750)", () => {
  it("opening A's popup leaves B closed, and only A's component paints", () => {
    const a = mount("para-A");
    const b = mount("para-B");
    renderPopup(a);
    renderPopup(b);
    expect(popups()).toHaveLength(0);

    act(() => openPopup(a));

    expect(slashPopupKey.getState(a.state)?.open).toBe(true);
    expect(slashPopupStore.getState(a).open).toBe(true);
    expect(slashPopupStore.getState(b).open).toBe(false);
    // jsdom's coordsAtPos may throw (no layout) — the component then renders
    // nothing for A either. What must hold regardless: never MORE than one
    // popup, and B's never.
    expect(popups().length).toBeLessThanOrEqual(1);
  });

  it("B's component renders nothing even when A's paints (coords forced)", () => {
    const a = mount("para-A");
    const b = mount("para-B");
    // Give both views a working coordsAtPos so a render is decided by STATE,
    // not by jsdom's missing layout — exactly the hidden pane's all-zero rect.
    for (const ed of [a, b]) {
      ed.view.coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    }
    renderPopup(a);
    renderPopup(b);
    act(() => openPopup(a));
    expect(popups()).toHaveLength(1);
  });

  it("destroying B while A's popup is open does not close A's", () => {
    const a = mount("para-A");
    const b = mount("para-B");
    act(() => openPopup(a));
    act(() => openPopup(b));
    expect(slashPopupStore.getState(b).open).toBe(true);
    b.destroy();
    expect(slashPopupStore.getState(b).open).toBe(false);
    expect(slashPopupStore.getState(a).open).toBe(true);
  });

  it("apply publishes nothing — a state.apply dry run leaves the store untouched", () => {
    const a = mount("para-A");
    const pos = a.state.doc.firstChild!.nodeSize - 1;
    const dry = a.state.apply(
      a.state.tr.setMeta("slashPopup", {
        open: true,
        slashPos: pos,
        query: "",
        selectedIndex: 0,
        filtered: ["section"],
        disabled: [],
      }),
    );
    expect(slashPopupKey.getState(dry)?.open).toBe(true);
    expect(slashPopupStore.getState(a).open).toBe(false);
  });
});
