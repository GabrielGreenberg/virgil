// @vitest-environment jsdom
//
// Task 1257 — a button that acts on MOUSEDOWN (to beat a focus-driven select
// or a click-outside commit) was keyboard-dead: Enter/Space and an AT "press"
// dispatch only a synthesized `click` (`detail === 0`), and none of these
// buttons acted on click. `pressProps` / `bindPress` (src/lib/press-props.ts)
// add that leg. jsdom has no native-button keyboard activation, so each leg
// asserts the CONTRACT: a `detail: 0` click acts exactly once; a pointer press
// (mousedown, then a `detail: 1` click) acts exactly once — never twice.
import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("katex", () => ({ default: { render: () => undefined } }));

const captured: { editor: import("@tiptap/core").Editor | null } = { editor: null };
vi.mock("@tiptap/react", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...mod,
    useEditor: (...args: Parameters<typeof mod.useEditor>) => {
      const ed = mod.useEditor(...args);
      if (ed) captured.editor = ed;
      return ed;
    },
  };
});

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import RichTextField from "@/components/RichTextField";
import NodeEditPopover from "@/components/NodeEditPopover";
import { PopoutButton, createPopoutButtonEl } from "@/components/panel-primitives";
import { bindPress, pressProps } from "@/lib/press-props";

afterEach(() => {
  cleanup();
  captured.editor = null;
});

/** Keyboard / AT activation: a click no mousedown preceded. */
const keyboardPress = (el: Element) => fireEvent.click(el, { detail: 0 });
/** A pointer press: mousedown (primary), then the trailing click. */
const pointerPress = (el: Element) => {
  fireEvent.mouseDown(el, { button: 0 });
  fireEvent.click(el, { detail: 1 });
};

describe("the press door (src/lib/press-props.ts)", () => {
  it("pressProps: a keyboard click acts once; a pointer press acts once", () => {
    const action = vi.fn();
    render(<button type="button" {...pressProps(action)}>go</button>);
    const btn = screen.getByText("go");
    keyboardPress(btn);
    expect(action).toHaveBeenCalledTimes(1);
    pointerPress(btn);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("pressProps: a right/middle press does nothing (native behaviour kept)", () => {
    const action = vi.fn();
    render(<button type="button" {...pressProps(action)}>go</button>);
    fireEvent.mouseDown(screen.getByText("go"), { button: 2 });
    expect(action).not.toHaveBeenCalled();
  });

  it("pressProps: mousedown prevents default (focus stays put); stopPropagation is opt-in", () => {
    const outer = vi.fn();
    render(
      <div onMouseDown={outer}>
        <button type="button" {...pressProps(() => {})}>a</button>
        <button type="button" {...pressProps(() => {}, { stopPropagation: true })}>b</button>
      </div>,
    );
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    screen.getByText("a").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(outer).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByText("b"), { button: 0 });
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("bindPress: the DOM twin honours the same contract", () => {
    const action = vi.fn();
    const btn = document.createElement("button");
    bindPress(btn, action);
    keyboardPress(btn);
    pointerPress(btn);
    expect(action).toHaveBeenCalledTimes(2);
  });
});

describe("member 1 — the card rich-text toolbar", () => {
  const VALUE = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " plain" },
        ],
      },
    ],
  };
  function mount() {
    render(<RichTextField value={VALUE} instanceKey="press-1257" onChange={vi.fn()} />);
    const editor = captured.editor;
    if (!editor) throw new Error("RichTextField minted no editor");
    return editor;
  }

  it("Bold: a keyboard click toggles the mark exactly once", () => {
    const editor = mount();
    act(() => {
      editor.commands.setTextSelection({ from: 7, to: 12 }); // "plain"
    });
    act(() => {
      keyboardPress(screen.getByText("B"));
    });
    expect(editor.isActive("bold")).toBe(true);
    act(() => {
      pointerPress(screen.getByText("B"));
    });
    // One toggle per press: the pointer press un-bolds, it does not toggle twice.
    expect(editor.isActive("bold")).toBe(false);
  });

  it("Numbered list: a keyboard click wraps the paragraph", () => {
    const editor = mount();
    act(() => {
      editor.commands.setTextSelection(8);
    });
    act(() => {
      keyboardPress(screen.getByLabelText("Numbered list"));
    });
    expect(editor.state.doc.child(0).type.name).toBe("orderedList");
  });

  it("member 4: every toggle announces its state via aria-pressed", () => {
    const editor = mount();
    act(() => {
      editor.commands.setTextSelection(2); // inside "bold"
    });
    expect(screen.getByText("B").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("I").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("Bullet list").getAttribute("aria-pressed")).toBe("false");
    act(() => {
      editor.commands.setTextSelection(8); // inside " plain"
    });
    expect(screen.getByText("B").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("member 2 — Pop-out / Dock", () => {
  it("PopoutButton: a keyboard click pops out once; a pointer press once", () => {
    const onClick = vi.fn();
    render(<PopoutButton isPoppedOut={false} onClick={onClick} />);
    const btn = screen.getByRole("button");
    keyboardPress(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    pointerPress(btn);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("createPopoutButtonEl: the imperative twin answers the keyboard too", () => {
    const onClick = vi.fn();
    const btn = createPopoutButtonEl({ isPoppedOut: true, onClick });
    keyboardPress(btn);
    pointerPress(btn);
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

describe("member 3 — the math popover's Cancel", () => {
  it("a keyboard click on Cancel reverts (closes without saving)", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const rect = { left: 0, top: 0, bottom: 20, right: 40, width: 40, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    render(
      <NodeEditPopover family="math" kind="inline" value="x^2" anchorRect={rect} onSave={onSave} onClose={onClose} />,
    );
    const textarea = screen.getByRole("textbox", { hidden: true });
    fireEvent.change(textarea, { target: { value: "discarded" } });
    keyboardPress(screen.getByRole("button", { hidden: true }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
